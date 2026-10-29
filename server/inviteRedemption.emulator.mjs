// Optional integration verification against a real, isolated Firestore engine.
// Run: npm run test:invite-transactions
// This filename deliberately stays outside the regular *.test.mjs test glob.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { InviteRedemptionError, redeemFamilyInvite } from './inviteRedemption.mjs';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
  throw new Error('Invite integration checks require a localhost Firestore emulator. Run npm run test:invite-transactions; production access is never allowed.');
}
const projectId = 'rules-probe';
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error('Invite integration checks only use the synthetic rules-probe project.');
}
const runId = crypto.randomUUID();
const app = initializeApp({ projectId }, `invite-transaction-probe-${runId}`);
const db = getFirestore(app);
const cleanupRefs = new Map();
const remember = path => {
  const ref = db.doc(path);
  cleanupRefs.set(path, ref);
  return ref;
};
const now = new Date();
const contentionRepeats = Math.min(8, Math.max(1, Number(process.env.TELUVA_INVITE_PROBE_REPEATS) || 1));
const outcomes = results => JSON.stringify(results.map(result => result.status === 'fulfilled'
  ? { status: 'fulfilled' }
  : { status: 'rejected', name: result.reason?.name, code: result.reason?.code,
    httpStatus: result.reason?.status, message: String(result.reason?.message || '').slice(0, 300) }));
const expiry = new Date(now.getTime() + 14 * 86_400_000).toISOString();
const planOf = (info, at) => ['paid', 'trial'].includes(info.plan)
  && (!info.planExpiresAt || Date.parse(info.planExpiresAt) > at.getTime()) ? info.plan : 'free';
const seatLimitFor = plan => plan === 'free' ? 10 : 200;
const caller = uid => ({ uid, email: `${uid}@example.test`, displayName: `Synthetic ${uid}` });
let fixtureNumber = 0;

async function fixture({ memberCount = 1, estate = false, existing = [] } = {}) {
  const index = ++fixtureNumber;
  const familyId = `invite-probe-${runId}-${index}`;
  const codes = [`PROBE_${runId}_${index}_ONE`, `PROBE_${runId}_${index}_TWO`].map(value => value.toUpperCase());
  const uids = ['first', 'second', 'child', 'existing'].map(name => `invite-probe-${runId}-${index}-${name}`);
  const batch = db.batch();
  batch.set(remember(`families/${familyId}/info/info`), { name: 'Synthetic invite probe', type: 'family', plan: 'free' });
  for (let member = 0; member < memberCount; member += 1) {
    batch.set(remember(`families/${familyId}/roles/seed-${member}`), { role: member === 0 ? 'admin' : 'member' });
  }
  for (const { uid, role } of existing) batch.set(remember(`families/${familyId}/roles/${uid}`), { role });
  for (const uid of uids) {
    remember(`families/${familyId}/roles/${uid}`);
    remember(`users/${uid}`);
  }
  for (const [codeIndex, code] of codes.entries()) {
    batch.set(remember(`invites/${code}`), {
      familyId, role: 'member', createdBy: 'synthetic-admin', createdAt: now.toISOString(),
      expiresAt: expiry, usedBy: null,
      ...(estate ? { willReaderId: `pending-${codeIndex}` } : {}),
    });
  }
  if (estate) {
    batch.set(remember(`families/${familyId}/reference/willsAccess`), {
      namedUids: ['previous-synthetic-nominee'], readerUids: ['previous-synthetic-reader'],
      pendingReaders: codes.map((_, codeIndex) => ({ id: `pending-${codeIndex}`, name: 'Synthetic nominee', expiresAt: expiry })),
      releaseRequests: [{ id: 'synthetic-release', status: 'waiting', requestedAt: now.toISOString() }],
    });
  }
  await batch.commit();
  const redeem = (uid, code = codes[0]) => redeemFamilyInvite({ db, code, caller: caller(uid), now, planOf, seatLimitFor });
  const value = async path => { const snap = await db.doc(path).get(); return snap.exists ? snap.data() : undefined; };
  return { familyId, codes, uids, redeem, value };
}

test('real Firestore transactions enforce atomic invite admission and estate nomination', async t => {
  try {
    await t.test('same invite concurrently redeemed by different callers admits exactly one', async () => {
      const f = await fixture();
      const results = await Promise.allSettled([f.redeem(f.uids[0]), f.redeem(f.uids[1])]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, outcomes(results));
      assert.equal(results.filter(result => result.status === 'rejected' && result.reason instanceof InviteRedemptionError && result.reason.status === 410).length, 1, outcomes(results));
      const invite = await f.value(`invites/${f.codes[0]}`);
      const winner = invite.usedBy;
      const loser = f.uids.find(uid => uid !== winner && f.uids.slice(0, 2).includes(uid));
      assert.ok(await f.value(`families/${f.familyId}/roles/${winner}`));
      assert.equal(await f.value(`families/${f.familyId}/roles/${loser}`), undefined);
      assert.equal(await f.value(`users/${loser}`), undefined);
      assert.equal((await db.collection(`families/${f.familyId}/roles`).get()).size, 2);
    });

    await t.test('different invites competing for one remaining seat cannot overfill the space', async () => {
      for (let round = 0; round < contentionRepeats; round += 1) {
      const f = await fixture({ memberCount: 9 });
      const results = await Promise.allSettled([f.redeem(f.uids[0], f.codes[0]), f.redeem(f.uids[1], f.codes[1])]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, outcomes(results));
      assert.equal(results.filter(result => result.status === 'rejected' && result.reason instanceof InviteRedemptionError && result.reason.status === 403).length, 1, outcomes(results));
      assert.equal((await db.collection(`families/${f.familyId}/roles`).get()).size, 10);
      const invites = await Promise.all(f.codes.map(code => f.value(`invites/${code}`)));
      assert.equal(invites.filter(invite => !!invite.usedBy).length, 1, 'the losing invite remains usable');
      assert.equal((await f.value(`families/${f.familyId}/info/info`)).membershipRevision, 1);
      }
    });

    await t.test('existing membership at capacity keeps its role and does not consume another seat', async () => {
      const f = await fixture({ memberCount: 9 });
      const uid = f.uids[3];
      await db.doc(`families/${f.familyId}/roles/${uid}`).set({ role: 'admin' });
      await db.doc(`users/${uid}`).set({ aiConsent: { granted: true }, spaces: [{ id: 'synthetic-other-space', role: 'member', type: 'business' }] });
      await db.doc(`invites/${f.codes[0]}`).set({ role: 'child' }, { merge: true });
      const result = await f.redeem(uid);
      assert.equal(result.alreadyMember, true);
      assert.equal(result.role, 'admin');
      assert.equal((await db.collection(`families/${f.familyId}/roles`).get()).size, 10);
      assert.equal((await f.value(`families/${f.familyId}/roles/${uid}`)).role, 'admin');
      const profile = await f.value(`users/${uid}`);
      assert.deepEqual(profile.aiConsent, { granted: true });
      assert.equal(profile.spaces.length, 2);
      assert.equal((await f.value(`invites/${f.codes[0]}`)).usedBy, uid);
    });

    await t.test('estate nomination commits with admission and never opens or releases the will', async () => {
      const f = await fixture({ memberCount: 9, estate: true });
      const results = await Promise.allSettled([f.redeem(f.uids[0], f.codes[0]), f.redeem(f.uids[1], f.codes[1])]);
      const successIndex = results.findIndex(result => result.status === 'fulfilled');
      assert.notEqual(successIndex, -1, outcomes(results));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, outcomes(results));
      const loserIndex = successIndex === 0 ? 1 : 0;
      const winner = f.uids[successIndex];
      const loser = f.uids[loserIndex];
      assert.equal(results[successIndex].value.willReaderGranted, true);
      const access = await f.value(`families/${f.familyId}/reference/willsAccess`);
      assert.deepEqual(access.namedUids, ['previous-synthetic-nominee', winner]);
      assert.deepEqual(access.readerUids, ['previous-synthetic-reader']);
      assert.deepEqual(access.releaseRequests, [{ id: 'synthetic-release', status: 'waiting', requestedAt: now.toISOString() }]);
      assert.deepEqual(access.pendingReaders.map(entry => entry.id), [`pending-${loserIndex}`]);
      assert.equal((await f.value(`invites/${f.codes[successIndex]}`)).usedBy, winner);
      assert.equal((await f.value(`invites/${f.codes[loserIndex]}`)).usedBy, null);
      assert.equal(await f.value(`families/${f.familyId}/roles/${loser}`), undefined);
      assert.equal(await f.value(`users/${loser}`), undefined);
    });
  } finally {
    // Delete exactly the synthetic paths registered above, including possible
    // membership writes. Never enumerate or clear someone else's project data.
    const refs = [...cleanupRefs.values()];
    for (let index = 0; index < refs.length; index += 400) {
      const batch = db.batch();
      refs.slice(index, index + 400).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
    await db.terminate();
    await deleteApp(app);
  }
});
