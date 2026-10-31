import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DIRECTORY_FIELDS, projectDirectoryEntry, buildDirectory, resolveDirectoryMembership } from './directory.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/* A colleague record as it actually exists — the directory fields buried in
 * the HR file they must not drag out with them. */
const HR_FILE = {
  id: 'm-anna',
  name: 'Anna Mbeki',
  role: 'Manager',
  jobTitle: 'Care coordinator',
  workPhone: '+43 1 234 5678',
  workAddress: 'Hauptstrasse 1',
  employer: 'Care GmbH',
  startDate: '2023-04-01',
  avatarColor: 'bg-blue-500',
  // everything below is the part that must not travel
  phone: '+43 660 111 2222',
  email: 'anna.private@example.com',
  address: 'Wohnung 4, Sonnenweg 9',
  birthdate: '1988-02-14',
  taxNumber: '1234 010288',
  avatarUrl: 'data:image/png;base64,AAAA',
  medical: { bloodGroup: 'O+', conditions: 'asthma' },
  identifiers: { nationalId: '8802145800088' },
  identity: { permitNumber: 'AT-99' },
  financialAccounts: [{ iban: 'AT61...' }],
  documents: [{ id: 'd1', name: 'Contract' }],
  cv: { qualifications: [{ name: 'First aid' }] },
  employeePreferences: { drink: 'tea' },
};

test('the directory card carries the work-facing fields', () => {
  const card = projectDirectoryEntry(HR_FILE);
  assert.equal(card.name, 'Anna Mbeki');
  assert.equal(card.jobTitle, 'Care coordinator');
  assert.equal(card.workPhone, '+43 1 234 5678');
  assert.equal(card.role, 'Manager');
});

test('and NOTHING else — the HR file does not travel with it', () => {
  const card = projectDirectoryEntry(HR_FILE);
  for (const leaked of [
    'phone', 'email', 'address', 'birthdate', 'taxNumber', 'avatarUrl',
    'medical', 'identifiers', 'identity', 'financialAccounts', 'documents',
    'cv', 'employeePreferences',
    /* startDate was on the list for one release, on a justification that
     * turned out to be false — see the header. Work anniversaries are
     * computed client-side from a member list that already excludes
     * colleagues, so nothing had published it and this would have. */
    'startDate',
  ]) {
    assert.ok(!(leaked in card), `${leaked} leaked into the directory card`);
  }
  assert.deepEqual(Object.keys(card).sort(), [
    'avatarColor', 'employer', 'id', 'jobTitle', 'name', 'role',
    'workAddress', 'workPhone',
  ]);
});

/* This is the test that survives the next twenty fields added to FamilyMember.
 * A denylist would pass today and leak on the day somebody adds
 * `disciplinaryNotes`; an allowlist cannot. */
test('a field nobody thought of is refused, not passed through', () => {
  const card = projectDirectoryEntry({
    ...HR_FILE,
    disciplinaryNotes: 'written warning 2026-03',
    salaryBand: 'C4',
    nextOfKin: 'Thandi',
  });
  assert.ok(!('disciplinaryNotes' in card));
  assert.ok(!('salaryBand' in card));
  assert.ok(!('nextOfKin' in card));
});

test('only strings survive, so a field that grows a shape cannot smuggle one', () => {
  const card = projectDirectoryEntry({
    id: 'm-x', name: 'Sipho', avatarColor: 'bg-red-500',
    jobTitle: { current: 'Driver', history: ['Cleaner', 'dismissed 2024'] },
  });
  assert.ok(!('jobTitle' in card));
  assert.equal(card.name, 'Sipho');
});

test('a nameless record is a hole in the list, not a card', () => {
  assert.equal(projectDirectoryEntry({ id: 'm-x', jobTitle: 'Driver' }), null);
  assert.equal(projectDirectoryEntry(null), null);
  assert.equal(projectDirectoryEntry('nope'), null);
});

test('long values are capped rather than trusted', () => {
  const card = projectDirectoryEntry({ id: 'm-x', name: 'A'.repeat(5000) });
  assert.equal(card.name.length, 200);
});

test('the whole directory is sorted and drops the holes', () => {
  const list = buildDirectory([
    { id: '1', name: 'Zanele' },
    { id: '2', jobTitle: 'nobody' },
    { id: '3', name: 'Anna' },
    null,
  ]);
  assert.deepEqual(list.map((m) => m.name), ['Anna', 'Zanele']);
});

test('junk in gives an empty directory, never a throw', () => {
  assert.deepEqual(buildDirectory(undefined), []);
  assert.deepEqual(buildDirectory('members'), []);
});

/* The allowlist is only a boundary while it stays an allowlist. If somebody
 * rewrites the projection as "copy the member, then delete the secrets", this
 * fails — which is the point. */
test('the projection is a pick, never an omit', () => {
  const src = readFileSync(resolve(here, 'directory.mjs'), 'utf8');
  assert.ok(/for \(const key of DIRECTORY_FIELDS\)/.test(src));
  assert.ok(!/\bdelete out\[/.test(src));
  assert.ok(!/\.\.\.member/.test(src));
});

test('nothing beyond work contact is on the list', () => {
  /* The screen tells people it shows work contact only. A start date is not
     work contact, and a directory that quietly exceeds its own caption is
     the same failure as copy that promises a notification nothing sends. */
  assert.ok(!DIRECTORY_FIELDS.includes('startDate'));
});

test('the fields that need consent in Austria are not on the list', () => {
  for (const f of ['birthdate', 'avatarUrl', 'phone', 'email', 'address']) {
    assert.ok(!DIRECTORY_FIELDS.includes(f), `${f} must not be in DIRECTORY_FIELDS`);
  }
});

test('an explicit space is authorized independently of another tab’s active pointer', async () => {
  const reads = [];
  let activeReads = 0;
  const caller = await resolveDirectoryMembership({ body: { spaceId: 'visible-business' } }, {
    signedIn: async () => ({ uid: 'employee', email: 'employee@example.test' }),
    activeMember: async () => { activeReads += 1; return { uid: 'employee', familyId: 'other-business', role: 'admin' }; },
    roleFor: async (spaceId, uid) => { reads.push({ spaceId, uid }); return spaceId === 'visible-business' ? 'member' : null; },
  });
  assert.equal(caller.familyId, 'visible-business');
  assert.equal(caller.role, 'member', 'a stale active-space admin role never elevates the requested space');
  assert.deepEqual(reads, [{ spaceId: 'visible-business', uid: 'employee' }]);
  assert.equal(activeReads, 0);
});

test('a provided space requires current authoritative membership and rejects arbitrary paths', async () => {
  const deps = {
    signedIn: async () => ({ uid: 'outsider' }),
    activeMember: async () => ({ uid: 'outsider', familyId: 'owned-business', role: 'admin' }),
    roleFor: async () => null,
  };
  assert.equal((await resolveDirectoryMembership({ body: { spaceId: 'other-business' } }, deps)).status, 403);
  assert.equal((await resolveDirectoryMembership({ body: { spaceId: '../other-business' } }, deps)).status, 400);
  assert.equal((await resolveDirectoryMembership({ body: { spaceId: 3 } }, deps)).status, 400);
  const denied = await resolveDirectoryMembership({ body: { spaceId: 'other-business' } }, { ...deps, signedIn: async () => ({ status: 401, error: 'Sign in' }) });
  assert.equal(denied.status, 401);
});

test('older directory clients retain their authoritative active-space membership lookup', async () => {
  const caller = { uid: 'employee', familyId: 'active-business', role: 'member' };
  const result = await resolveDirectoryMembership({ body: {} }, {
    signedIn: async () => { throw new Error('Should use legacy membership helper'); },
    activeMember: async () => caller,
    roleFor: async () => { throw new Error('Should use legacy membership helper'); },
  });
  assert.equal(result, caller);
});

test('the live endpoint echoes the authorized space and retains the safe projection', () => {
  const source = readFileSync(resolve(here, '../server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/business/directory'");
  const endpoint = source.slice(start, source.indexOf("app.post('/api/wills-release/state'", start));
  assert.match(endpoint, /resolveDirectoryMembership\(req/);
  assert.match(endpoint, /families\/\$\{spaceId\}\/roles\/\$\{uid\}/);
  assert.match(endpoint, /familyId: caller\.familyId, members/);
  assert.match(endpoint, /buildDirectory\(snap\.docs\.map\(recordFromSnapshot\)\)/);
});
