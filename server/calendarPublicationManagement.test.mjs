import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCalendarPublicationHandlers } from './calendarPublicationManagement.mjs';
import { resolveRequestedMembership } from './requestMembership.mjs';
import { loadCalendarPublicationSources } from './spaceSharing.mjs';

function fixture() {
  const state = { activeSpace: 'space-b', roleA: 'member', roleB: 'admin', typeA: 'business' };
  const records = new Map([
    ['link-a', { id: 'link-a', familyId: 'space-a', createdBy: 'original-a', createdAt: '2026-01-01T00:00:00Z', mode: 'details', revoked: false }],
    ['link-b', { id: 'link-b', familyId: 'space-b', createdBy: 'original-b', createdAt: '2026-01-02T00:00:00Z', mode: 'details', revoked: false }],
    ['revoked-a', { id: 'revoked-a', familyId: 'space-a', revoked: true }],
  ]);
  const calls = [];
  let tokenSequence = 0;
  const membership = {
    signedIn: async () => ({ uid: 'signed-in-user', displayName: 'Synthetic User' }),
    activeMember: async () => {
      calls.push(['legacy', state.activeSpace]);
      return { uid: 'signed-in-user', displayName: 'Synthetic User', familyId: state.activeSpace, role: state.activeSpace === 'space-a' ? state.roleA : state.roleB };
    },
    roleFor: async (spaceId, uid) => { calls.push(['role', spaceId, uid]); return spaceId === 'space-a' ? state.roleA : spaceId === 'space-b' ? state.roleB : null; },
  };
  const handlers = createCalendarPublicationHandlers({
    member: req => resolveRequestedMembership(req, membership),
    readSpaceInfo: async id => { calls.push(['info', id]); return { type: id === 'space-a' ? state.typeA : 'family' }; },
    readPublication: async token => { calls.push(['read', token]); return records.get(token) || null; },
    writePublication: async (token, data) => { calls.push(['write', token]); records.set(token, { ...records.get(token), ...structuredClone(data), id: token }); },
    listPublications: async id => { calls.push(['list', id]); return [...records.values()].filter(record => record.familyId === id); },
    makeToken: () => `synthetic-token-${++tokenSequence}`,
    now: () => new Date('2026-10-31T12:00:00Z'), logError: () => {},
  });
  const invoke = async (operation, body, extra = {}) => {
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handlers[operation]({ body, ...extra }, response);
    return response;
  };
  return { state, records, calls, handlers, invoke };
}

test('create/list/revoke bind to explicit A while another tab points at B', async () => {
  const f = fixture();
  const created = await f.invoke('create', { spaceId: 'space-a', mode: 'details', label: ' Site rota ', includeOccasions: true });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.spaceId, 'space-a');
  const stored = f.records.get(created.body.token);
  assert.equal(stored.familyId, 'space-a');
  assert.equal(stored.label, 'Site rota');
  assert.equal(stored.includeOccasions, false, 'business publications cannot expose HR-derived occasions');
  const listed = await f.invoke('list', { spaceId: 'space-a' });
  assert.equal(listed.body.spaceId, 'space-a');
  assert.deepEqual(listed.body.links.map(link => link.token), [created.body.token, 'link-a']);
  assert.equal(listed.body.links.some(link => link.token === 'link-b'), false);
  const revoked = await f.invoke('revoke', { spaceId: 'space-a', token: 'link-a' });
  assert.equal(revoked.body.spaceId, 'space-a');
  assert.equal(f.records.get('link-a').revoked, true);
  assert.equal(f.records.get('link-b').revoked, false);
  assert.equal(f.calls.some(call => call[0] === 'legacy'), false);
  assert.ok(f.calls.filter(call => call[0] === 'role').every(call => call[1] === 'space-a'));
});

test('missing A membership cannot borrow B admin rights or reach any publication store', async () => {
  for (const operation of ['create', 'list', 'revoke']) {
    const f = fixture();
    f.state.roleA = null;
    const before = structuredClone([...f.records]);
    const response = await f.invoke(operation, { spaceId: 'space-a', token: 'link-a', includeOccasions: true });
    assert.equal(response.statusCode, 403, operation);
    assert.deepEqual([...f.records], before);
    assert.deepEqual(f.calls.map(call => call[0]), ['role'], 'denied membership never falls back or reads link data');
  }
});

test('a viewer in A stays read-only even with B admin rights; foreign tokens cannot be revoked', async () => {
  const f = fixture();
  f.state.roleA = 'child';
  for (const operation of ['create', 'revoke']) {
    assert.equal((await f.invoke(operation, { spaceId: 'space-a', token: 'link-a' })).statusCode, 403);
  }
  assert.equal((await f.invoke('list', { spaceId: 'space-a' })).statusCode, 200);
  assert.equal(f.calls.some(call => call[0] === 'write'), false);
  f.state.roleA = 'member';
  assert.equal((await f.invoke('revoke', { spaceId: 'space-a', token: 'link-b' })).statusCode, 403);
  assert.equal(f.records.get('link-b').revoked, false);
  assert.equal((await f.invoke('revoke', { spaceId: 'space-a', token: '../link-b' })).statusCode, 400);
  assert.deepEqual((await f.invoke('revoke', { spaceId: 'space-a', token: 'missing' })).body, { ok: true, spaceId: 'space-a' });
});

test('the creator and their current hidden-list ownership survive explicit-space management', async () => {
  const f = fixture();
  f.state.typeA = 'family';
  const created = await f.invoke('create', { spaceId: 'space-a', mode: 'details', includeOccasions: true, createdBy: 'spoofed-owner', createdByName: 'Spoofed name' });
  const record = f.records.get(created.body.token);
  assert.equal(record.createdBy, 'signed-in-user');
  assert.equal(record.createdByName, 'Synthetic User');
  assert.equal(record.includeOccasions, true);
  f.state.activeSpace = 'space-b';
  const reads = [];
  const sources = await loadCalendarPublicationSources(record, {
    readSpaceInfo: async id => { reads.push(['info', id]); return { type: 'family' }; },
    readEvents: async id => { reads.push(['events', id]); return []; },
    readOccasions: async id => { reads.push(['occasions', id]); return {}; },
    readHiddenLists: async (id, owner) => { reads.push(['hidden', id, owner]); return { ownerUid: owner, ownerList: ['synthetic-hidden-person'] }; },
  });
  assert.ok(reads.every(read => read[1] === 'space-a'));
  assert.deepEqual(reads.find(read => read[0] === 'hidden'), ['hidden', 'space-a', 'signed-in-user']);
  assert.equal(sources.hiddenLists.ownerUid, 'signed-in-user');
  assert.deepEqual(sources.hiddenLists.ownerList, ['synthetic-hidden-person']);
  await f.invoke('revoke', { spaceId: 'space-a', token: created.body.token });
  assert.equal(f.records.get(created.body.token).createdBy, 'signed-in-user', 'revocation does not rewrite a publication’s privacy owner');
});

test('legacy GET list and old body-less create/revoke retain authoritative active-space behavior', async () => {
  const f = fixture();
  const listed = await f.invoke('list', undefined, { method: 'GET' });
  assert.deepEqual(listed.body.links.map(link => link.token), ['link-b']);
  assert.equal(listed.body.spaceId, 'space-b');
  const created = await f.invoke('create', { mode: 'busy' });
  assert.equal(f.records.get(created.body.token).familyId, 'space-b');
  assert.equal((await f.invoke('revoke', { token: created.body.token })).statusCode, 200);
});

test('live routes use requested membership and scoped database wrappers replace all three direct UI calls', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf('const calendarPublicationHandlers = createCalendarPublicationHandlers(');
  const management = server.slice(start, server.indexOf('// Automatic phone alarms', start));
  assert.match(management, /member: requireRequestedMember/);
  for (const operation of ['create', 'list', 'revoke']) assert.ok(management.includes(`app.post('/api/calendar-publish/${operation}', calendarPublicationHandlers.${operation})`));
  assert.ok(management.includes("app.get('/api/calendar-publish/list', calendarPublicationHandlers.list)"));
  const db = fs.readFileSync(new URL('../src/utils/db.ts', import.meta.url), 'utf8');
  for (const [name, operation] of [['createCalendarPublication', 'create'], ['listCalendarPublications', 'list'], ['revokeCalendarPublication', 'revoke']]) {
    const begin = db.indexOf(`export async function ${name}(`);
    const wrapper = db.slice(begin, db.indexOf('\n}', begin));
    assert.ok(wrapper.includes(`await scopedSpacePost('/api/calendar-publish/${operation}'`));
  }
  const calendar = fs.readFileSync(new URL('../src/components/FamilyCalendar.tsx', import.meta.url), 'utf8');
  assert.ok(calendar.includes('await createCalendarPublication('));
  assert.ok(calendar.includes('await listCalendarPublications()'));
  assert.ok(calendar.includes('await revokeCalendarPublication(link.token)'));
  assert.doesNotMatch(calendar, /publishApi\(/);
  assert.ok(calendar.includes('calendarSpaceRef.current === spaceAtStart && auth.currentUser?.uid === uid'));
  assert.match(server, /readFeedHiddenLists\(familyId, createdBy\)/);
});
