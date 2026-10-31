import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { includesCalendarOccasions, loadCalendarPublicationSources, carerManagementAccess, carerPublicAccess } from './spaceSharing.mjs';
import { buildFeedOccasions } from './calendarOccasions.mjs';
import { buildPublishedIcs } from './calendarPublish.mjs';

const NOW = new Date('2026-10-31T10:00:00Z');
const publication = { familyId: 'synthetic', createdBy: 'employee', mode: 'details', includeOccasions: true };
const event = { id: 'shared-team-meeting', title: 'Shared team meeting', date: '2026-11-05' };
const hr = { members: [{ id: 'private-person', name: 'Private Colleague', birthdate: '1982-11-06' }] };

function fixture(spaceInfo) {
  const calls = [];
  const state = { spaceInfo };
  return {
    calls, state,
    dependencies: {
      readSpaceInfo: async id => { calls.push(['info', id]); return state.spaceInfo; },
      readEvents: async id => { calls.push(['events', id]); return [event]; },
      readOccasions: async id => { calls.push(['HR', id]); return hr; },
      readHiddenLists: async (...args) => { calls.push(['hidden', ...args]); return {}; },
    },
  };
}

test('an already-issued business calendar token never reads or emits staff HR occasions', async () => {
  const f = fixture({ type: 'business', name: 'Team' });
  const sources = await loadCalendarPublicationSources(publication, f.dependencies);
  assert.equal(sources.occasionSources, null);
  assert.deepEqual(f.calls.map(call => call[0]), ['info', 'events', 'hidden']);
  const ics = buildPublishedIcs(sources.events, {
    now: NOW, business: true,
    occasions: sources.occasionSources ? buildFeedOccasions(sources.occasionSources, NOW) : [],
  });
  assert.match(ics, /Shared team meeting/);
  assert.doesNotMatch(ics, /Private Colleague|19821106|birthday/i);
  assert.equal(includesCalendarOccasions(f.state.spaceInfo, publication), false, 'new business links also store no occasion opt-in');
});

test('family feed occasions and shared events remain available, but current business type revokes the old opt-in', async () => {
  const f = fixture({ type: 'family', name: 'Family' });
  const family = await loadCalendarPublicationSources(publication, f.dependencies);
  assert.equal(family.occasionSources, hr);
  const ics = buildPublishedIcs(family.events, { now: NOW, occasions: buildFeedOccasions(family.occasionSources, NOW) });
  assert.match(ics, /Private Colleague/);
  assert.match(ics, /19821106/);
  assert.match(ics, /Shared team meeting/);
  f.state.spaceInfo = { type: 'business' };
  f.calls.length = 0;
  assert.equal((await loadCalendarPublicationSources(publication, f.dependencies)).occasionSources, null);
  assert.equal(f.calls.some(call => call[0] === 'HR'), false, 'old tokens must consult the current space type on every read');
});

test('busy links, absent opt-ins and missing space metadata do not read HR; lookup errors fail closed', async () => {
  for (const [spaceInfo, record] of [[{ type: 'family' }, { ...publication, mode: 'busy' }], [{ type: 'family' }, { ...publication, includeOccasions: undefined }], [null, publication]]) {
    const f = fixture(spaceInfo);
    assert.equal((await loadCalendarPublicationSources(record, f.dependencies)).occasionSources, null);
    assert.equal(f.calls.some(call => call[0] === 'HR'), false);
  }
  const f = fixture({ type: 'business' });
  f.dependencies.readSpaceInfo = async () => { throw new Error('database unavailable'); };
  await assert.rejects(loadCalendarPublicationSources(publication, f.dependencies), /database unavailable/);
  assert.deepEqual(f.calls, [], 'no events or HR fetch happens before authoritative space lookup succeeds');
});

test('business carer management is unsupported for every role while family behavior preserves read-only children', async () => {
  for (const role of ['admin', 'member', 'child']) {
    for (const operation of ['create', 'list', 'revoke']) {
      assert.equal((await carerManagementAccess({ familyId: 'synthetic', role }, operation, async () => ({ type: 'business' }))).status, 403);
    }
  }
  for (const role of ['admin', 'member']) {
    for (const operation of ['create', 'list', 'revoke']) {
      assert.equal(await carerManagementAccess({ familyId: 'synthetic', role }, operation, async () => ({ type: 'family' })), null);
    }
  }
  assert.equal(await carerManagementAccess({ familyId: 'synthetic', role: 'child' }, 'list', async () => ({ type: 'family' })), null);
  for (const operation of ['create', 'revoke']) {
    assert.equal((await carerManagementAccess({ familyId: 'synthetic', role: 'child' }, operation, async () => ({ type: 'family' }))).status, 403);
  }
});

test('legacy business carer tokens return neutral 404; current family links still expire and revoke normally', async () => {
  const oldToken = { familyId: 'synthetic', expiresAt: '2026-11-07T10:00:00Z', snapshot: { children: [{ name: 'Private child', conditions: 'Private condition' }] } };
  assert.equal(await carerPublicAccess(oldToken, async () => ({ type: 'business' }), +NOW), 404);
  assert.equal(await carerPublicAccess({ ...oldToken, revoked: true }, async () => ({ type: 'business' }), +NOW), 404);
  assert.equal(await carerPublicAccess(oldToken, async () => null, +NOW), 404);
  assert.equal(await carerPublicAccess(null, async () => { throw new Error('must not read'); }, +NOW), 404);
  assert.equal(await carerPublicAccess(oldToken, async () => ({ type: 'family' }), +NOW), 200);
  assert.equal(await carerPublicAccess({ ...oldToken, revoked: true }, async () => ({ type: 'family' }), +NOW), 410);
  assert.equal(await carerPublicAccess({ ...oldToken, expiresAt: '2026-10-30T10:00:00Z' }, async () => ({ type: 'family' }), +NOW), 410);
  await assert.rejects(carerPublicAccess(oldToken, async () => { throw new Error('database unavailable'); }, +NOW), /database unavailable/);
});

test('live routes use the tested current-space sharing gates for new links and previously issued tokens', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const management = fs.readFileSync(new URL('./calendarPublicationManagement.mjs', import.meta.url), 'utf8');
  assert.match(management, /includesCalendarOccasions\(await readSpaceInfo\(caller\.familyId\)/);
  assert.match(source, /await loadCalendarPublicationSources\(record,/);
  for (const operation of ['create', 'list', 'revoke']) assert.ok(source.includes(`carerManagementAccess(caller, '${operation}', readSharingSpaceInfo)`));
  assert.ok(source.includes('await carerPublicAccess(v, readSharingSpaceInfo)'));
});
