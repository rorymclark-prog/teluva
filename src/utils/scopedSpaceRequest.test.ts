import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createScopedSpacePost } from './scopedSpaceRequest';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function fixture() {
  const state = { uid: 'user-a', spaceId: 'space-a', token: Promise.resolve('synthetic-token') };
  const requests: { route: string; body: any }[] = [];
  const wire: { method: string; headers: Headers; body: unknown }[] = [];
  const dependencies = {
    getUser: () => state.uid ? { uid: state.uid, getIdToken: () => state.token } : null,
    getSpace: () => state.spaceId,
    fetch: (async (route: string | URL | Request, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const headers = new Headers(init.headers);
      wire.push({ method: String(init.method), headers, body: init.body });
      requests.push({ route: String(route), body });
      return new Response(JSON.stringify({ spaceId: body.spaceId || headers.get('x-teluva-space-id'), code: 'SYNTHETIC', pendingId: 'pending' }), { status: 200 });
    }) as typeof fetch,
  };
  return { state, requests, wire, dependencies, post: createScopedSpacePost(dependencies) };
}

test('all bounded actions send the visible space, including ordinary and estate invite intent', async () => {
  const f = fixture();
  for (const [route, body] of [
    ['/api/create-invite', { role: 'child' }], ['/api/create-invite', { willReader: true, forName: 'Synthetic', replacePendingId: 'pending' }],
    ['/api/rename-space', { name: 'Synthetic name' }], ['/api/set-founding-date', { foundingDate: '2020-01-01' }],
    ['/api/delete-family', { confirmName: 'Synthetic name' }], ['/api/leave-family', {}],
    ['/api/calendar-publish/create', { mode: 'details', includeOccasions: true }], ['/api/calendar-publish/list', {}], ['/api/calendar-publish/revoke', { token: 'synthetic-token' }],
  ] as const) {
    await f.post(route, body, 'Failed');
    assert.deepEqual(f.requests.at(-1), { route, body: { ...body, spaceId: 'space-a' } });
  }
  await f.post('/api/rename-space', { spaceId: 'space-b', name: 'Reserved scope' }, 'Failed');
  assert.equal(f.requests.at(-1)?.body.spaceId, 'space-a', 'a payload cannot override the captured space');
});

test('an account or local space change during token refresh stops before a request is sent', async () => {
  for (const property of ['uid', 'spaceId'] as const) {
    const f = fixture();
    const token = deferred<string>();
    f.state.token = token.promise;
    const action = f.post('/api/create-invite', { role: 'member' }, 'Failed');
    f.state[property] = 'changed';
    token.resolve('synthetic-token');
    await assert.rejects(action, /account or space changed/);
    assert.deepEqual(f.requests, []);
  }
});

test('another tab changing the server active pointer does not change the explicit request target', async () => {
  const f = fixture();
  const token = deferred<string>();
  f.state.token = token.promise;
  const action = f.post('/api/delete-family', { confirmName: 'Same name in both spaces' }, 'Failed');
  let serverActiveSpace = 'space-a';
  serverActiveSpace = 'space-b';
  token.resolve('synthetic-token');
  await action;
  assert.equal(serverActiveSpace, 'space-b');
  assert.equal(f.requests[0].body.spaceId, 'space-a');
});

test('late response or JSON parsing cannot hand another account or space an invite code', async () => {
  for (const phase of ['response', 'json'] as const) {
    const f = fixture();
    const response = deferred<Response>();
    const json = deferred<unknown>();
    const jsonStarted = deferred<void>();
    let jsonRead = false;
    f.dependencies.fetch = (async () => response.promise) as typeof fetch;
    const post = createScopedSpacePost(f.dependencies);
    const action = post('/api/create-invite', { role: 'member' }, 'Failed');
    const value = { ok: true, json: async () => { jsonRead = true; jsonStarted.resolve(); return json.promise; } } as Response;
    await Promise.resolve();
    if (phase === 'response') f.state.uid = 'user-b';
    response.resolve(value);
    if (phase === 'json') { await jsonStarted.promise; f.state.spaceId = 'space-b'; }
    json.resolve({ spaceId: 'space-a', code: 'SYNTHETIC' });
    await assert.rejects(action, /account or space changed/);
    if (phase === 'response') assert.equal(jsonRead, false);
  }
});

test('wrong-space or missing echoes are refused, while server denials remain visible', async () => {
  for (const reply of [{ spaceId: 'space-b' }, {}]) {
    const f = fixture();
    f.dependencies.fetch = (async () => new Response(JSON.stringify(reply))) as typeof fetch;
    await assert.rejects(createScopedSpacePost(f.dependencies)('/api/leave-family', {}, 'Failed'), /space response changed/);
  }
  const f = fixture();
  f.dependencies.fetch = (async () => new Response(JSON.stringify({ error: 'Not an admin of this space' }), { status: 403 })) as typeof fetch;
  await assert.rejects(createScopedSpacePost(f.dependencies)('/api/rename-space', {}, 'Failed'), /Not an admin of this space/);
  f.state.uid = '';
  await assert.rejects(f.post('/api/create-invite', {}, 'Failed'), /Sign in/);
  f.state.uid = 'user-a'; f.state.spaceId = '';
  await assert.rejects(f.post('/api/create-invite', {}, 'Failed'), /Choose an available space/);
});

test('GET status and DELETE mutations carry the same captured authenticated space; GET never has a body', async () => {
  const f = fixture();
  for (const method of ['GET', 'DELETE'] as const) {
    await f.post('/api/gmail-bridge/token', {}, 'Failed', { method });
    const sent = f.wire.at(-1)!;
    assert.equal(sent.method, method);
    assert.equal(sent.headers.get('x-teluva-space-id'), 'space-a');
    assert.equal(sent.headers.get('authorization'), 'Bearer synthetic-token');
    if (method === 'GET') assert.equal(sent.body, undefined);
    else assert.deepEqual(JSON.parse(String(sent.body)), { spaceId: 'space-a' });
  }
});

test('GET/DELETE cannot start after identity changes and cannot return wrong-space status', async () => {
  for (const method of ['GET', 'DELETE'] as const) {
    const f = fixture();
    const token = deferred<string>(); f.state.token = token.promise;
    const action = f.post('/api/gmail-bridge/status', {}, 'Failed', { method });
    f.state.spaceId = 'space-b'; token.resolve('synthetic-token');
    await assert.rejects(action, /account or space changed/);
    assert.deepEqual(f.wire, []);
    const wrong = fixture();
    wrong.dependencies.fetch = (async () => new Response(JSON.stringify({ spaceId: 'space-b', connected: true }))) as typeof fetch;
    await assert.rejects(createScopedSpacePost(wrong.dependencies)('/api/gmail-bridge/status', {}, 'Failed', { method }), /space response changed/);
  }
});

test('ordinary invite UI and all assigned database wrappers use the shared captured-scope helper', () => {
  const db = fs.readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../components/FamilySettings.tsx', import.meta.url), 'utf8');
  assert.ok(db.includes('getUser: () => auth.currentUser, getSpace: () => FAMILY_ID'));
  for (const name of ['createEstateInvite', 'createMemberInvite', 'renameSpace', 'saveFoundingDate', 'deleteFamily', 'leaveFamily']) {
    const start = db.indexOf(`export async function ${name}(`);
    const end = db.indexOf('\n}', start);
    assert.ok(start > 0 && end > start, name);
    assert.match(db.slice(start, end), /await scopedSpacePost/, name);
  }
  assert.ok(settings.includes('await createMemberInvite(inviteRole)'));
  assert.doesNotMatch(settings, /fetch\('\/api\/create-invite'/);
  assert.ok(settings.includes('await saveFoundingDate('), 'the actual founding-date form in Business Settings uses the scoped wrapper');
});

test('business mail and milestone clients retain nullable status UX and use scoped requests instead of direct fetches', () => {
  const db = fs.readFileSync(new URL('./db.ts', import.meta.url), 'utf8');
  for (const name of ['fetchInboundMailAddress', 'fetchGmailBridgeStatus', 'createGmailBridgeToken', 'revokeGmailBridgeToken', 'generateBusinessMilestoneNote']) {
    const start = db.indexOf(`export async function ${name}(`);
    const handler = db.slice(start, db.indexOf('\n}', start));
    assert.match(handler, /await scopedSpacePost/, name);
    assert.doesNotMatch(handler, /await fetch\(/, name);
    if (name === 'fetchInboundMailAddress' || name === 'fetchGmailBridgeStatus') assert.match(handler, /catch \{\s*return null;/);
  }
  const important = fs.readFileSync(new URL('../components/ImportantInfo.tsx', import.meta.url), 'utf8');
  assert.ok(important.includes('await generateBusinessMilestoneNote()'));
  assert.doesNotMatch(important, /fetch\('\/api\/business-milestone-note'/);
});
