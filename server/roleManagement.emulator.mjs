// Optional real-engine verification. Synthetic localhost project only:
// firebase emulators:exec --config firebase.invites.emulator.json --only firestore --project rules-probe "node --test server/roleManagement.emulator.mjs"
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { changeMemberRole, removeSpaceMember, RoleManagementError } from './roleManagement.mjs';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  || (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== 'rules-probe')) {
  throw new Error('Membership race checks require a localhost Firestore emulator and the synthetic rules-probe project. Production is never allowed.');
}
const runId = crypto.randomUUID();
const app = initializeApp({ projectId: 'rules-probe' }, `membership-probe-${runId}`);
const db = getFirestore(app);
const cleanup = new Map();
const remember = path => { const ref = db.doc(path); cleanup.set(path, ref); return ref; };
let sequence = 0;
const outcomes = results => JSON.stringify(results.map(result => result.status === 'fulfilled' ? { status: 'fulfilled' }
  : { status: 'rejected', name: result.reason?.name, statusCode: result.reason?.status, code: result.reason?.code, message: String(result.reason?.message || '').slice(0, 200) }));

async function fixture(otherActive = false) {
  const prefix = `membership-probe-${runId}-${++sequence}`;
  const spaceId = `${prefix}-business`;
  const otherId = `${prefix}-personal`;
  const uids = ['first', 'second'].map(suffix => `${prefix}-${suffix}`);
  const batch = db.batch();
  batch.set(remember(`families/${spaceId}/info/info`), { type: 'business', name: 'Synthetic membership probe' });
  for (const uid of uids) {
    batch.set(remember(`families/${spaceId}/roles/${uid}`), { role: 'admin' });
    batch.set(remember(`users/${uid}`), {
      familyId: otherActive ? otherId : spaceId, role: 'admin', aiConsent: { granted: true },
      spaces: [{ id: spaceId, role: 'admin', type: 'business' }, ...(otherActive ? [{ id: otherId, role: 'admin', type: 'personal' }] : [])],
    });
  }
  await batch.commit();
  const remove = (callerUid, targetUid) => removeSpaceMember({ db, spaceId, callerUid, targetUid, deleteField: () => FieldValue.delete() });
  const demote = (callerUid, targetUid) => changeMemberRole({ db, spaceId, callerUid, targetUid, newRole: 'member' });
  const value = async path => { const snap = await db.doc(path).get(); return snap.exists ? snap.data() : null; };
  return { spaceId, otherId, uids, remove, demote, value };
}

test('real Firestore serializes removals with other removals and demotions', async t => {
  try {
    for (const demote of [false, true]) {
      await t.test(demote ? 'removal versus demotion retains an admin and consistent mirrors' : 'two admins cannot concurrently remove each other', async () => {
        for (let round = 0; round < 2; round += 1) {
          const f = await fixture();
          const [first, second] = f.uids;
          const results = await Promise.allSettled([f.remove(first, second), demote ? f.demote(second, first) : f.remove(second, first)]);
          assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, outcomes(results));
          assert.equal(results.filter(result => result.status === 'rejected' && result.reason instanceof RoleManagementError && result.reason.status === 403).length, 1, outcomes(results));
          const roles = await db.collection(`families/${f.spaceId}/roles`).get();
          assert.equal(roles.docs.filter(doc => doc.data().role === 'admin').length, 1);
          for (const uid of f.uids) {
            const role = await f.value(`families/${f.spaceId}/roles/${uid}`);
            const user = await f.value(`users/${uid}`);
            if (!role) {
              assert.deepEqual(user.spaces, []);
              assert.equal('familyId' in user, false);
              assert.equal('role' in user, false);
            } else {
              assert.equal(user.familyId, f.spaceId);
              assert.equal(user.role, role.role);
              assert.equal(user.spaces.find(space => space.id === f.spaceId).role, role.role);
            }
            assert.deepEqual(user.aiConsent, { granted: true });
          }
        }
      });
    }
    await t.test('removal keeps another active space and a repeat is inert', async () => {
      const f = await fixture(true);
      const before = await f.value(`users/${f.uids[1]}`);
      const result = await f.remove(...f.uids);
      const after = await f.value(`users/${f.uids[1]}`);
      assert.deepEqual(after, { ...before, spaces: [{ id: f.otherId, role: 'admin', type: 'personal' }] });
      assert.deepEqual(result.claims, { familyId: f.otherId, familyIds: [f.otherId] });
      await assert.rejects(f.remove(...f.uids), error => error instanceof RoleManagementError && error.status === 404);
      assert.deepEqual(await f.value(`users/${f.uids[1]}`), after);
    });
  } finally {
    const refs = [...cleanup.values()];
    for (let offset = 0; offset < refs.length; offset += 400) {
      const batch = db.batch();
      refs.slice(offset, offset + 400).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
    await db.terminate();
    await deleteApp(app);
  }
});
