import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveMembership } from '../authz.mjs';
import { resolveRequestedMembership, remainingSpacesAfterRemoval } from './requestMembership.mjs';

function fixture() {
  const state = { activeSpace: 'space-b', profileExists: true, signedInError: null };
  const roles = new Map([['space-a:user', 'admin'], ['space-b:user', 'member']]);
  const calls = [];
  const dependencies = {
    signedIn: async () => { calls.push('identity'); return state.signedInError || { uid: 'user', email: 'synthetic@example.test' }; },
    activeMember: async () => {
      calls.push('legacy');
      const role = roles.get(`${state.activeSpace}:user`);
      const verdict = resolveMembership({ profileExists: state.profileExists, profile: { familyId: state.activeSpace, role: 'admin' }, roleDocExists: !!role, roleDoc: { role } });
      return verdict.ok ? { uid: 'user', familyId: verdict.familyId, role: verdict.role } : verdict;
    },
    roleFor: async (space, uid) => { calls.push(`${space}:${uid}`); return roles.get(`${space}:${uid}`); },
  };
  return { state, roles, calls, dependencies, resolve: body => resolveRequestedMembership({ body }, dependencies) };
}

test('explicit space A uses its current role even when another tab selects space B', async () => {
  const f = fixture();
  assert.deepEqual(await f.resolve({ spaceId: 'space-a' }), { uid: 'user', email: 'synthetic@example.test', familyId: 'space-a', role: 'admin' });
  assert.deepEqual(f.calls, ['identity', 'space-a:user']);
  f.roles.set('space-a:user', 'child');
  assert.equal((await f.resolve({ spaceId: 'space-a' })).role, 'child', 'a role in space B or a stale mirror cannot grant admin in A');
});

test('invalid or missing requested memberships fail without falling back to another active space', async () => {
  for (const spaceId of ['', null, '../space-b', 'space/a', {}, 'x'.repeat(129)]) {
    const f = fixture();
    assert.equal((await f.resolve({ spaceId })).status, 400);
    assert.deepEqual(f.calls, []);
  }
  for (const role of [null, undefined, 'owner', '']) {
    const f = fixture();
    f.roles.set('space-a:user', role);
    assert.equal((await f.resolve({ spaceId: 'space-a' })).status, 403);
    assert.equal(f.calls.includes('legacy'), false);
  }
  const f = fixture();
  f.state.signedInError = { status: 401, error: 'Sign in first.' };
  assert.equal((await f.resolve({ spaceId: 'space-a' })).status, 401);
  assert.deepEqual(f.calls, ['identity']);
});

test('GET/DELETE headers select current membership and conflicts or invalid headers never fall back', async () => {
  const f = fixture();
  for (const method of ['GET', 'DELETE']) {
    assert.equal((await resolveRequestedMembership({ method, headers: { 'x-teluva-space-id': 'space-a' } }, f.dependencies)).familyId, 'space-a');
  }
  assert.equal((await resolveRequestedMembership({ body: { spaceId: 'space-a' }, headers: { 'x-teluva-space-id': 'space-a' } }, f.dependencies)).role, 'admin');
  for (const headers of [{ 'x-teluva-space-id': '' }, { 'x-teluva-space-id': '../space-a' }, { 'x-teluva-space-id': ['space-a', 'space-b'] }, { 'x-teluva-space-id': 'space-a,space-b' }]) {
    assert.equal((await resolveRequestedMembership({ headers }, f.dependencies)).status, 400);
  }
  const calls = f.calls.length;
  assert.equal((await resolveRequestedMembership({ body: { spaceId: 'space-a' }, headers: { 'x-teluva-space-id': 'space-b' } }, f.dependencies)).status, 400);
  assert.equal(f.calls.length, calls, 'ambiguous targets are rejected before identity/role work');
  assert.equal(f.calls.includes('legacy'), false);
});

test('omitted space keeps the legacy authoritative membership check, including denial of missing mirrors or removed roles', async () => {
  const f = fixture();
  assert.deepEqual(await f.resolve({}), { uid: 'user', familyId: 'space-b', role: 'member' });
  assert.deepEqual(f.calls, ['legacy']);
  f.roles.delete('space-b:user');
  assert.equal((await f.resolve(undefined)).status, 403);
  f.roles.set('space-b:user', 'admin');
  f.state.profileExists = false;
  assert.equal((await f.resolve({})).status, 403);
});

test('a failed explicit-role lookup never consults another space or fabricates a role', async () => {
  const f = fixture();
  f.dependencies.roleFor = async () => { throw new Error('database unavailable'); };
  await assert.rejects(f.resolve({ spaceId: 'space-a' }), /database unavailable/);
  assert.equal(f.calls.includes('legacy'), false);
});

test('delete cleanup preserves another active space even for legacy missing or incomplete membership lists', () => {
  for (const spaces of [undefined, [], [{ id: 'space-a', role: 'admin', type: 'business' }]]) {
    assert.deepEqual(remainingSpacesAfterRemoval({ familyId: 'space-b', role: 'admin', spaces }, 'space-a'), [{ id: 'space-b', role: 'admin', type: 'family' }]);
  }
  const existing = { id: 'space-b', role: 'admin', type: 'personal', name: 'Other space' };
  assert.deepEqual(remainingSpacesAfterRemoval({ familyId: 'space-b', role: 'admin', spaces: [{ id: 'space-a', role: 'admin' }, existing] }, 'space-a'), [existing]);
  assert.deepEqual(remainingSpacesAfterRemoval({ familyId: 'space-a', role: 'admin' }, 'space-a'), []);
});

test('only the bounded invite/settings/lifecycle routes opt in and echo the authorized space', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  for (const route of ['create-invite', 'rename-space', 'set-founding-date', 'delete-family', 'leave-family']) {
    const start = source.indexOf(`app.post('/api/${route}'`);
    const end = source.indexOf('\n});', start);
    assert.ok(start > 0 && end > start);
    const handler = source.slice(start, end);
    assert.equal((handler.match(/await requireRequestedMember\(req\)/g) || []).length, 1, route);
    assert.match(handler, /spaceId: (?:caller\.familyId|familyId)/, route);
    if (['create-invite', 'rename-space', 'set-founding-date'].includes(route)) assert.match(handler, /caller\.role !== 'admin'/, route);
    if (route === 'delete-family') assert.match(handler, /roleSnap\.data\(\)\.role !== 'admin'/);
  }
  assert.match(source, /activeMember: requireMember/);
  assert.match(source, /families\/\$\{spaceId\}\/roles\/\$\{uid\}/);
  assert.match(source, /const spaces = remainingSpacesAfterRemoval\(data, familyId\)/);
});

test('business file-routing/status and milestone routes use requested membership without dropping their gates', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  for (const [method, path] of [['get', 'inbound-mail/address'], ['get', 'gmail-bridge/status'], ['post', 'gmail-bridge/token'], ['delete', 'gmail-bridge/token'], ['post', 'business-milestone-note']]) {
    const start = source.indexOf(`app.${method}('/api/${path}'`);
    const handler = source.slice(start, source.indexOf('\n});', start));
    assert.ok(start > 0);
    assert.match(handler, /await requireRequestedMember\(req\)/);
    assert.match(handler, /spaceId: (?:caller\.familyId|familyId)/);
    if (path === 'gmail-bridge/token') assert.match(handler, /caller\.role !== 'admin'/);
    if (path === 'business-milestone-note') {
      assert.match(handler, /aiGateBlocked\(caller\)/);
      assert.match(handler, /infoData\.type !== 'business'/);
      assert.match(handler, /checkAiUsage\(caller\.familyId\)/);
    }
  }
  const member = source.slice(source.indexOf('async function requireRequestedMember'), source.indexOf('// AI gate'));
  assert.match(member, /users\/\$\{caller\.uid\}/);
  assert.match(member, /profile\.aiConsent\?\.granted === true/);
  assert.match(member, /AI_CONSENT_VERSION/);
});
