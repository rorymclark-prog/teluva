import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { changeMemberRole, removeSpaceMember, resolveRemovalCaller, RoleManagementError } from './roleManagement.mjs';

function fixture(activeSpace = 'personal') {
  const records = new Map(Object.entries({
    'families/business/roles/owner': { role: 'admin' },
    'families/business/roles/staff': { role: 'member', email: 'staff@example.test' },
    'families/business/info/info': { type: 'business', name: 'Synthetic business' },
    'users/staff': { familyId: activeSpace, role: activeSpace === 'business' ? 'member' : 'admin', aiConsent: { granted: true }, spaces: [
      { id: 'personal', role: 'admin', type: 'personal' }, { id: 'another-business', role: 'admin', type: 'business' }, { id: 'business', role: 'member', type: 'business', name: 'Keep label' },
    ] },
    'users/owner': { familyId: 'business', role: 'admin', spaces: [{ id: 'business', role: 'admin', type: 'business' }] },
  }));
  const versions = new Map();
  const queryVersions = new Map();
  const snap = path => {
    const data = structuredClone(records.get(path));
    return { exists: records.has(path), data: () => structuredClone(data) };
  };
  const db = {
    doc: path => ({ path }),
    collection: path => ({ doc: id => ({ path: `${path}/${id}` }), where: (field, op, value) => ({ path, field, op, value, query: true }) }),
    runTransaction: async callback => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const writes = [], reads = new Map(), queries = new Map();
        const result = await callback({
          get: async ref => {
            if (ref.query) {
              queries.set(ref.path, queryVersions.get(ref.path) || 0);
              return { size: [...records].filter(([path, data]) => path.startsWith(`${ref.path}/`) && data[ref.field] === ref.value).length };
            }
            reads.set(ref.path, versions.get(ref.path) || 0);
            return snap(ref.path);
          },
          set: (ref, data) => writes.push([ref.path, data]),
          delete: ref => writes.push([ref.path, null]),
        });
        if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)
          || [...queries].some(([path, version]) => (queryVersions.get(path) || 0) !== version)) continue;
        for (const [path, data] of writes) {
          if (data === null) records.delete(path);
          else {
            const merged = { ...records.get(path), ...structuredClone(data) };
            for (const key of Object.keys(merged)) if (merged[key] === '__DELETE__') delete merged[key];
            records.set(path, merged);
          }
          versions.set(path, (versions.get(path) || 0) + 1);
          const collection = path.slice(0, path.lastIndexOf('/'));
          queryVersions.set(collection, (queryVersions.get(collection) || 0) + 1);
        }
        return result;
      }
      throw new Error('Synthetic contention did not settle');
    },
  };
  const change = extra => changeMemberRole({ db, spaceId: 'business', callerUid: 'owner', targetUid: 'staff', newRole: 'child', ...extra });
  const remove = extra => removeSpaceMember({ db, spaceId: 'business', callerUid: 'owner', targetUid: 'staff', deleteField: () => '__DELETE__', ...extra });
  return { db, records, change, remove };
}

test('business role changes work while target is active in personal or another business without changing that active role', async () => {
  for (const activeSpace of ['personal', 'another-business']) {
    const f = fixture(activeSpace);
    const before = structuredClone(f.records.get('users/staff'));
    assert.deepEqual(await f.change(), { ok: true, spaceId: 'business', uid: 'staff', role: 'child' });
    assert.deepEqual(f.records.get('families/business/roles/staff'), { role: 'child', email: 'staff@example.test' });
    const after = f.records.get('users/staff');
    assert.equal(after.familyId, activeSpace);
    assert.equal(after.role, 'admin', 'another space’s active role must not be overwritten');
    assert.deepEqual(after.aiConsent, before.aiConsent);
    assert.deepEqual(after.spaces.filter(space => space.id !== 'business'), before.spaces.filter(space => space.id !== 'business'));
    assert.deepEqual(after.spaces.find(space => space.id === 'business'), { id: 'business', role: 'child', type: 'business', name: 'Keep label' });
  }
});

test('the target active-space mirror changes only when it is the requested space; legacy space lists retain other membership', async () => {
  const f = fixture('business');
  await f.change();
  assert.equal(f.records.get('users/staff').role, 'child');
  const legacy = fixture('personal');
  delete legacy.records.get('users/staff').spaces;
  await legacy.change();
  assert.deepEqual(legacy.records.get('users/staff').spaces, [
    { id: 'personal', role: 'admin', type: 'family' }, { id: 'business', role: 'child', type: 'business', name: 'Synthetic business' },
  ]);
});

test('only an authoritative admin of the requested space may change an existing member, with no writes on denial', async () => {
  for (const callerUid of ['stranger', 'staff']) {
    const f = fixture();
    f.records.set(`users/${callerUid}`, { familyId: 'business', role: 'admin' });
    const before = structuredClone([...f.records]);
    await assert.rejects(f.change({ callerUid }), error => error instanceof RoleManagementError && error.status === 403);
    assert.deepEqual([...f.records], before);
  }
  const f = fixture();
  await assert.rejects(f.change({ targetUid: 'missing' }), error => error.code === 'ROLE_MEMBER_MISSING');
  await assert.rejects(f.change({ spaceId: 'another-business' }), error => error.code === 'ROLE_ADMIN_REQUIRED');
  for (const newRole of ['owner', '', null]) await assert.rejects(f.change({ newRole }), error => error.code === 'ROLE_INVALID');
  await assert.rejects(f.change({ targetUid: '../staff' }), error => error.code === 'ROLE_INVALID');
});

test('the last admin and self-demotion guards are enforced inside the transaction', async () => {
  const f = fixture();
  await assert.rejects(f.change({ targetUid: 'owner', newRole: 'member' }), error => error.code === 'ROLE_LAST_ADMIN');
  f.records.set('families/business/roles/second-admin', { role: 'admin' });
  f.records.set('users/second-admin', { familyId: 'business', role: 'admin', spaces: [{ id: 'business', role: 'admin', type: 'business' }] });
  await assert.rejects(f.change({ targetUid: 'owner', newRole: 'member' }), error => error.code === 'ROLE_SELF_DEMOTION');
  await f.change({ callerUid: 'second-admin', targetUid: 'owner', newRole: 'member' });
  assert.equal(f.records.get('families/business/roles/owner').role, 'member');
  assert.equal(f.records.get('users/owner').role, 'member');
  assert.equal(f.records.get('families/business/roles/second-admin').role, 'admin');
});

test('removal preserves another active space, unrelated fields and legacy mirrors', async () => {
  for (const activeSpace of ['personal', 'another-business']) {
    const f = fixture(activeSpace);
    const before = structuredClone(f.records.get('users/staff'));
    const result = await f.remove();
    assert.equal(f.records.has('families/business/roles/staff'), false);
    assert.deepEqual(f.records.get('users/staff'), { ...before, spaces: before.spaces.filter(space => space.id !== 'business') });
    assert.equal(result.claims.familyId, activeSpace);
    assert.deepEqual(result.claims.familyIds, ['personal', 'another-business']);
    const after = structuredClone([...f.records]);
    await assert.rejects(f.remove(), error => error.status === 404);
    assert.deepEqual([...f.records], after, 'a repeated removal cannot damage another space’s mirror');
  }
  const legacy = fixture('personal');
  delete legacy.records.get('users/staff').spaces;
  await legacy.remove();
  assert.equal(legacy.records.get('users/staff').familyId, 'personal');
  assert.equal(legacy.records.get('users/staff').role, 'admin');
  assert.deepEqual(legacy.records.get('users/staff').spaces, [{ id: 'personal', role: 'admin', type: 'family' }]);
});

test('removing the active membership moves or clears its pointer atomically', async () => {
  const f = fixture('business');
  await f.remove();
  assert.equal(f.records.get('users/staff').familyId, 'personal');
  assert.equal(f.records.get('users/staff').role, 'admin');
  const only = fixture('business');
  only.records.get('users/staff').spaces = [{ id: 'business', role: 'member', type: 'business' }];
  const result = await only.remove();
  assert.deepEqual(result.claims, { familyId: null, familyIds: [] });
  assert.equal('familyId' in only.records.get('users/staff'), false);
  assert.equal('role' in only.records.get('users/staff'), false);
  assert.deepEqual(only.records.get('users/staff').aiConsent, { granted: true });
});

test('removal denial, self-removal and missing membership never write', async () => {
  for (const args of [{ callerUid: 'staff' }, { callerUid: 'stranger' }, { targetUid: 'owner' }, { targetUid: 'missing' }, { spaceId: 'other' }, { targetUid: '../staff' }]) {
    const f = fixture();
    const before = structuredClone([...f.records]);
    await assert.rejects(f.remove(args), error => error instanceof RoleManagementError && error.status >= 400 && error.status < 500);
    assert.deepEqual([...f.records], before);
  }
});

function twoAdmins() {
  const f = fixture('business');
  f.records.set('families/business/roles/staff', { role: 'admin' });
  f.records.get('users/staff').role = 'admin';
  f.records.get('users/staff').spaces.find(space => space.id === 'business').role = 'admin';
  return f;
}

test('mutual removal and removal racing demotion retain an authoritative admin', async () => {
  for (const demote of [false, true]) {
    const f = twoAdmins();
    const results = await Promise.allSettled([
      f.remove(),
      demote ? f.change({ callerUid: 'staff', targetUid: 'owner', newRole: 'member' }) : f.remove({ callerUid: 'staff', targetUid: 'owner' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const admins = [...f.records].filter(([path, value]) => path.startsWith('families/business/roles/') && value.role === 'admin');
    assert.equal(admins.length, 1, 'the last-admin checks share one atomic serialization boundary');
    for (const uid of ['owner', 'staff']) {
      const role = f.records.get(`families/business/roles/${uid}`);
      const user = f.records.get(`users/${uid}`);
      if (!role) assert.equal(user.spaces.some(space => space.id === 'business'), false);
      else assert.equal(user.spaces.find(space => space.id === 'business').role, role.role);
    }
  }
});

test('explicit removal scope never follows another tab’s active pointer; legacy calls remain authoritative', async () => {
  let legacyReads = 0;
  const deps = { signedIn: async () => ({ uid: 'owner' }), activeMember: async () => { legacyReads += 1; return { uid: 'owner', familyId: 'other-business', role: 'admin' }; } };
  const explicit = await resolveRemovalCaller({ body: { spaceId: 'business' } }, deps);
  assert.deepEqual(explicit, { uid: 'owner', familyId: 'business' });
  assert.equal(legacyReads, 0);
  assert.equal((await resolveRemovalCaller({ body: {} }, deps)).familyId, 'other-business');
  assert.equal(legacyReads, 1);
  assert.equal((await resolveRemovalCaller({ body: { spaceId: '../bad' } }, deps)).status, 400);
  const f = fixture();
  await assert.rejects(removeSpaceMember({ db: f.db, spaceId: 'other-business', callerUid: explicit.uid, targetUid: 'staff', deleteField: () => '__DELETE__' }), error => error.status === 403);
});

test('contention retries use a fresh transaction and never partially change mirrors', async () => {
  const f = fixture();
  const run = f.db.runTransaction;
  let attempts = 0;
  f.db.runTransaction = async operation => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('transaction aborted'), { code: 10 });
    return run(operation);
  };
  await f.remove();
  assert.equal(attempts, 2);
  assert.equal(f.records.has('families/business/roles/staff'), false);
  assert.equal(f.records.get('users/staff').spaces.some(space => space.id === 'business'), false);
  const busy = fixture();
  const before = structuredClone([...busy.records]);
  let retries = 0;
  busy.db.runTransaction = async () => { retries += 1; throw Object.assign(new Error('transaction aborted'), { code: 10 }); };
  await assert.rejects(busy.remove(), error => error instanceof RoleManagementError && error.status === 503 && error.code === 'ROLE_BUSY');
  assert.equal(retries, 3, 'retries are bounded');
  assert.deepEqual([...busy.records], before);
});

test('the live route runs external cleanup after committed removal and client sends/cross-checks its captured scope', () => {
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const route = source.slice(source.indexOf("app.post('/api/remove-member'"), source.indexOf("app.post('/api/switch-space'"));
  assert.ok(route.indexOf('await removeSpaceMember(') < route.indexOf('setCustomUserClaims('));
  assert.match(route, /resolveRemovalCaller\(req/);
  assert.match(route, /spaceId: familyId/);
  assert.doesNotMatch(route, /rolesCol\.doc\(targetUid\)\.delete/);
  const client = fs.readFileSync(new URL('../src/utils/db.ts', import.meta.url), 'utf8');
  const remove = client.slice(client.indexOf('export async function removeFamilyMember('), client.indexOf('export async function setFamilyMemberRole('));
  assert.match(remove, /const spaceAtStart = FAMILY_ID/);
  assert.match(remove, /spaceId: spaceAtStart/);
  assert.match(remove, /auth\.currentUser\?\.uid === user\.uid/);
  assert.match(remove, /data\.spaceId !== spaceAtStart/);
});
