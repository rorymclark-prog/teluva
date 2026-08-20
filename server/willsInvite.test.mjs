// Unit tests for the estate-invite transitions. Pure logic, no Firestore, no
// network — safe to run anywhere.
//
// Run with:  node --test server/willsInvite.test.mjs
//
// The thing under test is a PERMISSION moving between two lists, so the cases
// that matter are the ones where it must NOT move: a cancelled invite, a child,
// an expired row. A false negative here means the person handling an estate has
// to phone someone; a false positive means somebody reads a will they were
// never given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPendingReader, removePendingReader, redeemPendingReader, pendingList, readerList } from './willsInvite.mjs';

const entry = (id, extra = {}) => ({ id, name: `Person ${id}`, invitedAt: '2026-08-20T10:00:00.000Z', ...extra });

// ---------------------------------------------------------------------------
// Normalisation — every doc written before this feature existed lacks the field
// ---------------------------------------------------------------------------

test('pendingList/readerList tolerate a doc that predates the feature', () => {
  assert.deepEqual(pendingList(null), []);
  assert.deepEqual(pendingList({ readerUids: ['u1'] }), []);
  assert.deepEqual(pendingList({ pendingReaders: 'nonsense' }), []);
  assert.deepEqual(readerList(null), []);
  assert.deepEqual(readerList({ readerUids: null }), []);
});

test('rows without an id are dropped rather than carried forward', () => {
  const access = { pendingReaders: [entry('a'), { name: 'no id' }, null, { id: '' }] };
  assert.deepEqual(pendingList(access).map((p) => p.id), ['a']);
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

test('addPendingReader appends to an empty doc', () => {
  assert.deepEqual(addPendingReader(null, entry('a')), [entry('a')]);
});

test('addPendingReader keeps the existing rows', () => {
  const access = { pendingReaders: [entry('a')] };
  assert.deepEqual(addPendingReader(access, entry('b')).map((p) => p.id), ['a', 'b']);
});

test('"send again" replaces the dead row instead of stacking a second one', () => {
  const access = { pendingReaders: [entry('old'), entry('other')] };
  const next = addPendingReader(access, entry('new'), 'old');
  assert.deepEqual(next.map((p) => p.id), ['other', 'new']);
});

test('a repeated id cannot appear twice', () => {
  const access = { pendingReaders: [entry('a')] };
  assert.deepEqual(addPendingReader(access, entry('a')).map((p) => p.id), ['a']);
});

test('an entry with no id throws — a row nothing can redeem is a silent dead end', () => {
  assert.throws(() => addPendingReader(null, { name: 'Carl' }), /entry\.id is required/);
});

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

test('removePendingReader drops exactly one row', () => {
  const access = { pendingReaders: [entry('a'), entry('b')] };
  assert.deepEqual(removePendingReader(access, 'a').map((p) => p.id), ['b']);
});

test('cancelling an unknown id is a no-op, not an error', () => {
  const access = { pendingReaders: [entry('a')] };
  assert.deepEqual(removePendingReader(access, 'zzz').map((p) => p.id), ['a']);
});

// ---------------------------------------------------------------------------
// Redeeming — the grant
// ---------------------------------------------------------------------------

test('redeeming moves the uid onto readerUids and consumes the row', () => {
  const access = { readerUids: ['u-old'], pendingReaders: [entry('a'), entry('b')] };
  const r = redeemPendingReader(access, { willReaderId: 'a', uid: 'u-new', role: 'member' });
  assert.equal(r.granted, true);
  assert.equal(r.reason, 'granted');
  assert.deepEqual(r.readerUids, ['u-old', 'u-new']);
  assert.deepEqual(r.pendingReaders.map((p) => p.id), ['b']);
});

test('an ordinary invite (no willReaderId) grants nothing and changes nothing', () => {
  const access = { readerUids: ['u-old'], pendingReaders: [entry('a')] };
  const r = redeemPendingReader(access, { willReaderId: undefined, uid: 'u-new', role: 'member' });
  assert.equal(r.granted, false);
  assert.equal(r.reason, 'not-an-estate-invite');
  assert.deepEqual(r.readerUids, ['u-old']);
  assert.deepEqual(r.pendingReaders.map((p) => p.id), ['a']);
});

test('CANCELLED: an admin who changed their mind is obeyed — the id is simply gone', () => {
  const access = { readerUids: [], pendingReaders: [entry('other')] };
  const r = redeemPendingReader(access, { willReaderId: 'a', uid: 'u-new', role: 'member' });
  assert.equal(r.granted, false);
  assert.equal(r.reason, 'cancelled');
  assert.deepEqual(r.readerUids, []);
  // The other person's invite must survive somebody else's failed redemption.
  assert.deepEqual(r.pendingReaders.map((p) => p.id), ['other']);
});

test('a CHILD is refused even holding a valid estate invite, and the row is still spent', () => {
  const access = { readerUids: [], pendingReaders: [entry('a')] };
  const r = redeemPendingReader(access, { willReaderId: 'a', uid: 'u-kid', role: 'child' });
  assert.equal(r.granted, false);
  assert.equal(r.reason, 'role-not-eligible');
  assert.deepEqual(r.readerUids, [], 'firestore.rules refuses a child anyway — never write a grant it will not honour');
  assert.deepEqual(r.pendingReaders, [], 'the code is spent: leaving the row would show a pending grant that can never land');
});

test('an expired row is refused and consumed', () => {
  const access = { readerUids: [], pendingReaders: [entry('a', { expiresAt: '2026-08-01T00:00:00.000Z' })] };
  const r = redeemPendingReader(access, { willReaderId: 'a', uid: 'u-new', role: 'member', now: '2026-08-20T00:00:00.000Z' });
  assert.equal(r.granted, false);
  assert.equal(r.reason, 'expired');
  assert.deepEqual(r.readerUids, []);
  assert.deepEqual(r.pendingReaders, []);
});

test('a row inside its window is honoured', () => {
  const access = { readerUids: [], pendingReaders: [entry('a', { expiresAt: '2026-09-01T00:00:00.000Z' })] };
  const r = redeemPendingReader(access, { willReaderId: 'a', uid: 'u-new', role: 'member', now: '2026-08-20T00:00:00.000Z' });
  assert.equal(r.granted, true);
  assert.deepEqual(r.readerUids, ['u-new']);
});

test('an existing named reader redeeming again is not duplicated', () => {
  const access = { readerUids: ['u-new'], pendingReaders: [entry('a')] };
  const r = redeemPendingReader(access, { willReaderId: 'a', uid: 'u-new', role: 'member' });
  assert.equal(r.granted, true);
  assert.equal(r.reason, 'already-a-reader');
  assert.deepEqual(r.readerUids, ['u-new']);
  assert.deepEqual(r.pendingReaders, []);
});

test('an admin redeeming an estate invite is fine (they can read it regardless)', () => {
  const access = { readerUids: [], pendingReaders: [entry('a')] };
  const r = redeemPendingReader(access, { willReaderId: 'a', uid: 'u-adm', role: 'admin' });
  assert.equal(r.granted, true);
  assert.deepEqual(r.readerUids, ['u-adm']);
});

test('nothing mutates the document it was handed', () => {
  const access = { readerUids: ['u-old'], pendingReaders: [entry('a')] };
  redeemPendingReader(access, { willReaderId: 'a', uid: 'u-new', role: 'member' });
  addPendingReader(access, entry('b'));
  removePendingReader(access, 'a');
  assert.deepEqual(access.readerUids, ['u-old']);
  assert.deepEqual(access.pendingReaders.map((p) => p.id), ['a']);
});
