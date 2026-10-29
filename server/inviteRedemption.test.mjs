import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { InviteRedemptionError, profileForMembership, redeemFamilyInvite } from './inviteRedemption.mjs';

const NOW = new Date('2026-10-29T12:00:00.000Z');
const FUTURE = '2026-11-12T12:00:00.000Z';
const caller = uid => ({ uid, email: `${uid}@example.test`, displayName: uid });
const invite = (extra = {}) => ({ familyId: 'family', role: 'member', createdBy: 'admin', expiresAt: FUTURE, usedBy: null, ...extra });
const effectivePlan = (info, now) => ['paid', 'trial'].includes(info.plan) && (!info.planExpiresAt || Date.parse(info.planExpiresAt) > now.getTime()) ? info.plan : 'free';

/** Optimistic document transactions with atomic commit and retries. Queries
 * deliberately do NOT lock absent documents: the info-doc revision must close
 * the different-invite/last-seat race even without relying on query phantoms. */
class TransactionStore {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial).map(([path, data]) => [path, { data: structuredClone(data), version: 1 }]));
    this.failRead = null;
    this.failWrite = null;
    this.attempts = 0;
  }
  doc(path) { return { path, kind: 'doc' }; }
  collection(path) { return { path, kind: 'query' }; }
  value(path) { return structuredClone(this.records.get(path)?.data); }
  snapshot(path) {
    const entry = this.records.get(path);
    return { exists: !!entry, id: path.split('/').at(-1), data: () => structuredClone(entry?.data) };
  }
  async runTransaction(callback) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      this.attempts += 1;
      const reads = new Map();
      const writes = [];
      const tx = {
        get: async ref => {
          assert.equal(writes.length, 0, 'Firestore requires every read before the first write');
          await Promise.resolve(); // allow competing redemptions to share reads
          if (this.failRead?.(ref.path)) throw new Error('Injected read failure');
          if (ref.kind === 'query') {
            const prefix = `${ref.path}/`;
            const paths = [...this.records.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
            for (const path of paths) reads.set(path, this.records.get(path)?.version || 0);
            return { size: paths.length, docs: paths.map(path => this.snapshot(path)) };
          }
          reads.set(ref.path, this.records.get(ref.path)?.version || 0);
          return this.snapshot(ref.path);
        },
        set: (ref, data, options) => { writes.push({ ref, data: structuredClone(data), merge: options?.merge === true }); },
      };
      const result = await callback(tx);
      // No await between checking versions and committing the whole write set.
      if ([...reads].some(([path, version]) => (this.records.get(path)?.version || 0) !== version)) continue;
      if (writes.some(write => this.failWrite?.(write.ref.path))) throw new Error('Injected commit failure');
      for (const { ref, data, merge } of writes) {
        const previous = this.records.get(ref.path);
        this.records.set(ref.path, {
          data: merge ? { ...previous?.data, ...data } : data,
          version: (previous?.version || 0) + 1,
        });
      }
      return result;
    }
    throw new Error('Transaction retry limit reached');
  }
}

function rig(extra = {}, limits = { free: 2, trial: 4, paid: 4 }) {
  const db = new TransactionStore({
    'families/family/info/info': { name: 'Our family', type: 'family', plan: 'free' },
    'families/family/roles/admin': { role: 'admin' },
    'invites/ONE': invite(),
    'invites/TWO': invite(),
    ...extra,
  });
  const redeem = (uid, code = 'ONE') => redeemFamilyInvite({ db, caller: caller(uid), code, now: NOW, planOf: effectivePlan, seatLimitFor: plan => limits[plan] });
  return { db, redeem };
}

const rejected = (status, message) => error => error instanceof InviteRedemptionError && error.status === status && (!message || message.test(error.message));

test('one transaction grants membership, preserves other profile fields and spends the invite', async () => {
  const { db, redeem } = rig({
    'users/new': { familyId: 'other', role: 'admin', aiConsent: { granted: true }, tourSeenAt: 'before' },
  });
  const result = await redeem('new', ' one ');
  assert.equal(result.familyId, 'family');
  assert.equal(result.role, 'member');
  assert.equal(result.alreadyMember, false);
  assert.deepEqual(db.value('families/family/roles/new'), { role: 'member', email: 'new@example.test', displayName: 'new' });
  assert.equal(db.value('invites/ONE').usedBy, 'new');
  assert.equal(db.value('invites/ONE').usedAt, NOW.toISOString());
  const profile = db.value('users/new');
  assert.deepEqual(profile.aiConsent, { granted: true });
  assert.equal(profile.tourSeenAt, 'before');
  assert.deepEqual(profile.spaces.map(space => space.id), ['other', 'family'], 'legacy membership is backfilled before adding a second space');
  assert.equal(db.value('families/family/info/info').membershipRevision, 1);
});

test('concurrent claims on a one-use invite admit exactly one different person', async () => {
  const { db, redeem } = rig({}, { free: 10, paid: 20 });
  const results = await Promise.allSettled([redeem('first'), redeem('second')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 410).length, 1);
  const winner = db.value('invites/ONE').usedBy;
  const loser = winner === 'first' ? 'second' : 'first';
  assert.ok(db.value(`families/family/roles/${winner}`));
  assert.equal(db.value(`families/family/roles/${loser}`), undefined);
  assert.equal(db.value(`users/${loser}`), undefined, 'a losing request makes no profile write');
  assert.ok(db.attempts > 2, 'one competing transaction retried against the committed invite');
});

test('different invites competing for the last seat cannot overfill a space', async () => {
  const { db, redeem } = rig();
  const results = await Promise.allSettled([redeem('first', 'ONE'), redeem('second', 'TWO')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 403).length, 1);
  const roles = [...db.records.keys()].filter(path => path.startsWith('families/family/roles/'));
  assert.equal(roles.length, 2, 'the founder plus one new member reaches the cap');
  const used = ['ONE', 'TWO'].filter(code => db.value(`invites/${code}`).usedBy);
  assert.equal(used.length, 1, 'the losing invite is not consumed and can be used after capacity changes');
  assert.equal(db.value('families/family/info/info').membershipRevision, 1);
});

test('double submission by the same person never creates duplicate membership or reuses a spent invite', async () => {
  const { db, redeem } = rig();
  const results = await Promise.allSettled([redeem('same'), redeem('same')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 410).length, 1);
  assert.equal(db.value('users/same').spaces.filter(space => space.id === 'family').length, 1);
  await assert.rejects(redeem('same'), rejected(410));
});

test('unknown, used, expired, boundary-expired and malformed invites never grant or consume anything', async () => {
  for (const changes of [
    { usedBy: 'someone' }, { expiresAt: '2026-10-01T00:00:00Z' }, { expiresAt: NOW.toISOString() },
    { expiresAt: 'bad-date' }, { expiresAt: undefined },
  ]) {
    const { db, redeem } = rig({ 'invites/ONE': invite(changes) });
    const before = db.value('invites/ONE');
    await assert.rejects(redeem('new'), rejected(410));
    assert.equal(db.value('families/family/roles/new'), undefined);
    assert.deepEqual(db.value('invites/ONE'), before);
  }
  const { redeem } = rig();
  await assert.rejects(redeem('new', 'MISSING'), rejected(404));
  await assert.rejects(redeem('new', 'bad/path'), rejected(404));
  await assert.rejects(redeem('new', ''), rejected(400));
});

test('an invite cannot grant admin, and a missing family is not recreated by redemption', async () => {
  for (const role of ['admin', 'owner', null]) {
    const { db, redeem } = rig({ 'invites/ONE': invite({ role }) });
    await assert.rejects(redeem('new'), rejected(403));
    assert.equal(db.value('invites/ONE').usedBy, null);
  }
  const { db, redeem } = rig({ 'invites/ONE': invite({ familyId: 'gone' }) });
  await assert.rejects(redeem('new'), rejected(404));
  assert.equal(db.value('families/gone/roles/new'), undefined);
});

test('existing roles are never promoted/demoted by an invite, even above the seat cap', async () => {
  for (const [priorRole, inviteRole] of [['admin', 'child'], ['member', 'child'], ['child', 'member']]) {
    const { db, redeem } = rig({
      'families/family/roles/existing': { role: priorRole, displayName: 'Kept role record' },
      'families/family/roles/extra': { role: 'member' },
      'invites/ONE': invite({ role: inviteRole }),
      'users/existing': { familyId: 'family', role: 'admin', spaces: [{ id: 'family', role: 'admin', type: 'family' }], interviewSeenAt: 'keep' },
    });
    db.failRead = path => path === 'families/family/roles'; // no capacity query is needed for an existing membership
    const result = await redeem('existing');
    assert.equal(result.alreadyMember, true);
    assert.equal(result.role, priorRole);
    assert.equal(db.value('families/family/roles/existing').role, priorRole);
    assert.equal(db.value('families/family/roles/existing').displayName, 'Kept role record');
    assert.equal(db.value('users/existing').role, priorRole, 'the cached mirror is repaired from the role doc');
    assert.equal(db.value('users/existing').interviewSeenAt, 'keep');
  }
});

test('simultaneously joining two spaces preserves both memberships and profile consent', async () => {
  const { db, redeem } = rig({
    'families/second/info/info': { name: 'Work', type: 'business', plan: 'free' },
    'families/second/roles/founder': { role: 'admin' },
    'invites/TWO': invite({ familyId: 'second' }),
    'users/shared': { aiConsent: { granted: true }, displayName: 'Old' },
  });
  await Promise.all([redeem('shared', 'ONE'), redeem('shared', 'TWO')]);
  assert.deepEqual(db.value('users/shared').spaces.map(space => space.id).sort(), ['family', 'second']);
  assert.deepEqual(db.value('users/shared').aiConsent, { granted: true });
  assert.ok(db.value('families/family/roles/shared'));
  assert.ok(db.value('families/second/roles/shared'));
});

test('estate naming, membership and invite consumption commit together WITHOUT opening the will', async () => {
  const pending = { id: 'pending', name: 'Trusted person', expiresAt: FUTURE };
  const { db, redeem } = rig({
    'invites/ONE': invite({ willReaderId: 'pending' }),
    'families/family/reference/willsAccess': {
      namedUids: ['previous-nominee'], readerUids: ['old'], pendingReaders: [pending, { id: 'other' }],
      releaseRequests: [{ id: 'release', status: 'waiting' }],
    },
  });
  const result = await redeem('reader');
  assert.equal(result.willReaderGranted, true);
  assert.deepEqual(db.value('families/family/reference/willsAccess').namedUids, ['previous-nominee', 'reader']);
  assert.deepEqual(db.value('families/family/reference/willsAccess').readerUids, ['old'], 'accepting an invite must never grant a full read');
  assert.deepEqual(db.value('families/family/reference/willsAccess').releaseRequests, [{ id: 'release', status: 'waiting' }], 'redemption cannot settle or erase a pending release request');
  assert.deepEqual(db.value('families/family/reference/willsAccess').pendingReaders, [{ id: 'other' }]);
  assert.equal(db.value('invites/ONE').usedBy, 'reader');
  assert.equal(db.value('families/family/roles/reader').role, 'member');
});

test('failure to commit estate naming leaves invite, membership, profile and pending reader unchanged', async () => {
  const access = { readerUids: [], pendingReaders: [{ id: 'pending', expiresAt: FUTURE }] };
  const { db, redeem } = rig({ 'invites/ONE': invite({ willReaderId: 'pending' }), 'families/family/reference/willsAccess': access });
  db.failWrite = path => path.endsWith('/willsAccess');
  await assert.rejects(redeem('reader'), /Injected commit failure/);
  assert.equal(db.value('families/family/roles/reader'), undefined);
  assert.equal(db.value('users/reader'), undefined);
  assert.equal(db.value('invites/ONE').usedBy, null);
  assert.deepEqual(db.value('families/family/reference/willsAccess'), access);
});

test('an existing child cannot use an estate member invite to upgrade role or gain will access', async () => {
  const { db, redeem } = rig({
    'families/family/roles/child': { role: 'child' },
    'invites/ONE': invite({ willReaderId: 'pending' }),
    'families/family/reference/willsAccess': { readerUids: [], pendingReaders: [{ id: 'pending', expiresAt: FUTURE }] },
  });
  const result = await redeem('child');
  assert.equal(result.role, 'child');
  assert.equal(result.willReaderGranted, false);
  assert.deepEqual(db.value('families/family/reference/willsAccess'), { namedUids: [], readerUids: [], pendingReaders: [], updatedAt: NOW.toISOString() });
});

test('an already named person or reader is not duplicated or given new estate access', async () => {
  for (const existing of [
    { namedUids: ['existing'], readerUids: [] },
    { namedUids: [], readerUids: ['existing'] },
  ]) {
    const { db, redeem } = rig({
      'families/family/roles/existing': { role: 'member' },
      'invites/ONE': invite({ willReaderId: 'pending' }),
      'families/family/reference/willsAccess': { ...existing, pendingReaders: [{ id: 'pending', expiresAt: FUTURE }] },
    });
    const result = await redeem('existing');
    assert.equal(result.willReaderGranted, true);
    const access = db.value('families/family/reference/willsAccess');
    assert.deepEqual(access.namedUids, existing.namedUids);
    assert.deepEqual(access.readerUids, existing.readerUids);
    assert.deepEqual(access.pendingReaders, []);
  }
});

test('a cancelled estate grant does not block joining and never regains estate access', async () => {
  const { db, redeem } = rig({
    'invites/ONE': invite({ willReaderId: 'cancelled' }),
    'families/family/reference/willsAccess': { readerUids: [], pendingReaders: [{ id: 'other' }] },
  });
  const result = await redeem('new');
  assert.equal(result.willReaderGranted, false);
  assert.equal(db.value('invites/ONE').usedBy, 'new');
  assert.deepEqual(db.value('families/family/reference/willsAccess'), { readerUids: [], pendingReaders: [{ id: 'other' }] });
});

test('unavailable seat/membership reads fail closed without spending the invite', async () => {
  const { db, redeem } = rig();
  db.failRead = path => path === 'families/family/roles';
  await assert.rejects(redeem('new'), /Injected read failure/);
  assert.equal(db.value('invites/ONE').usedBy, null);
  assert.equal(db.value('families/family/roles/new'), undefined);
});

test('an exhausted SDK ABORTED or closed transaction restarts with a fresh transaction and keeps the same strict grant', async () => {
  for (const failure of [
    Object.assign(new Error('Transaction lock timeout.'), { code: 10 }),
    Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'), { code: 3 }),
  ]) {
    const { db, redeem } = rig();
    const transact = db.runTransaction.bind(db);
    let calls = 0;
    db.runTransaction = async operation => { if (++calls === 1) throw failure; return transact(operation); };
    const result = await redeem('new');
    assert.equal(calls, 2);
    assert.equal(result.role, 'member');
    assert.equal(db.value('invites/ONE').usedBy, 'new');
    assert.equal(db.value('families/family/info/info').membershipRevision, 1, 'retries never grant twice');
  }
});

test('persistent transaction contention returns an explicit retryable refusal without partial grants', async () => {
  const { db, redeem } = rig();
  let calls = 0;
  db.runTransaction = async () => { calls += 1; throw Object.assign(new Error('ABORTED: transaction contention'), { code: 10 }); };
  await assert.rejects(redeem('new'), rejected(503, /try again/i));
  assert.equal(calls, 3, 'fresh transaction retries are strictly bounded');
  assert.equal(db.value('invites/ONE').usedBy, null);
  assert.equal(db.value('families/family/roles/new'), undefined);
  assert.equal(db.value('users/new'), undefined);
});

test('domain refusals, permission failures and unrelated invalid arguments are not retried', async () => {
  for (const failure of [
    new InviteRedemptionError(403, 'Capacity reached'),
    Object.assign(new Error('Permission denied'), { code: 7 }),
    Object.assign(new Error('Invalid field name'), { code: 3 }),
  ]) {
    const { db, redeem } = rig();
    let calls = 0;
    db.runTransaction = async () => { calls += 1; throw failure; };
    await assert.rejects(redeem('new'), error => error === failure);
    assert.equal(calls, 1);
    assert.equal(db.value('invites/ONE').usedBy, null);
  }
});

test('a production retry rechecks expiry against the new attempt time', async () => {
  const { db } = rig({ 'invites/ONE': invite({ expiresAt: new Date(Date.now() + 50).toISOString() }) });
  const transact = db.runTransaction.bind(db);
  let calls = 0;
  db.runTransaction = async operation => {
    if (++calls === 1) throw Object.assign(new Error('ABORTED: transaction contention'), { code: 10 });
    return transact(operation);
  };
  await assert.rejects(redeemFamilyInvite({ db, caller: caller('new'), code: 'ONE', planOf: effectivePlan, seatLimitFor: () => 2 }), rejected(410));
  assert.equal(calls, 2);
  assert.equal(db.value('invites/ONE').usedBy, null);
});

test('expired paid plan applies the current lower seat cap', async () => {
  const { db, redeem } = rig({
    'families/family/info/info': { plan: 'paid', planExpiresAt: '2026-10-28T12:00:00Z' },
    'families/family/roles/second': { role: 'member' },
  });
  await assert.rejects(redeem('new'), rejected(403, /free plan is 2/));
  assert.equal(db.value('invites/ONE').usedBy, null);
});

test('an active trial retains the production trial plan seat allowance', async () => {
  const { db, redeem } = rig({
    'families/family/info/info': { plan: 'trial', planExpiresAt: FUTURE },
    'families/family/roles/second': { role: 'member' },
  });
  await redeem('new');
  assert.equal(db.value('families/family/roles/new').role, 'member', 'active trial does not accidentally use the lower free seat cap');
});

test('profile construction preserves other entries and deduplicates only the target space', () => {
  const prior = { spaces: [{ id: 'other', role: 'admin', type: 'business', name: 'Work' }, { id: 'family', role: 'admin' }, { id: 'family', role: 'child' }] };
  const result = profileForMembership(prior, { familyId: 'family', role: 'member', type: 'family', name: 'Family', email: 'a@example.test', displayName: 'A' });
  assert.equal(result.spaces.length, 2);
  assert.deepEqual(result.spaces[0], prior.spaces[0]);
  assert.equal(result.spaces[1].role, 'member');
  assert.equal(prior.spaces.length, 3, 'the previous profile is never mutated');
});

test('the live join route calls the atomic service rather than split grant/consume helpers', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const join = server.slice(server.indexOf("app.post('/api/join-family'"), server.indexOf('// --- Remove a member', server.indexOf("app.post('/api/join-family'")));
  assert.match(join, /await redeemFamilyInvite\(/);
  assert.match(join, /keyedRateLimited\(`join-uid\|\$\{caller\.uid\}`/);
  assert.match(join, /ipRateLimited\('join', req/);
  assert.doesNotMatch(join, /grantMembership\(|grantEstateAccessFromInvite\(|seatCapCheck\(|inviteRef\.set\(/);
  assert.ok(join.indexOf('await redeemFamilyInvite(') < join.indexOf('setCustomUserClaims('), 'claims refresh follows atomic membership commit');
  assert.match(server, /import \{ redeemFamilyInvite, InviteRedemptionError \} from '\.\/server\/inviteRedemption\.mjs'/);
});
