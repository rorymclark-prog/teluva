import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RELEASE_WAIT_DAYS, QUIET_DAYS, APPROVALS_FOR_FAST_RELEASE,
  releaseRequests, ownerIsQuiet, approversOf, releaseDecision, daysUntilRelease,
  requestRelease, approveRelease, declineRelease, settleReleases,
} from './willsRelease.mjs';

const T0 = '2026-08-01T00:00:00.000Z';
const at = (days) => new Date(Date.parse(T0) + days * 86400000).toISOString();
const ELIGIBLE = ['u-anna', 'u-thandi', 'u-sipho'];

const withRequest = (extra = {}) => ({
  releaseRequests: [{
    id: 'r1', requestedBy: 'u-anna', requestedByName: 'Anna',
    requestedAt: T0, approvals: ['u-anna'], ...extra,
  }],
});

/* ── the slow door: silence releases, and cannot deadlock ─────────────────── */

test('one person asking is not enough on the day they ask', () => {
  const d = releaseDecision(withRequest().releaseRequests[0], { now: at(1), ownerLastSeenAt: at(0) });
  assert.equal(d.release, false);
  assert.equal(d.reason, 'pending');
});

test('silence releases it after the wait, with no approval from anybody', () => {
  const r = withRequest().releaseRequests[0];
  assert.equal(releaseDecision(r, { now: at(RELEASE_WAIT_DAYS - 0.1), ownerLastSeenAt: at(0) }).release, false);
  const d = releaseDecision(r, { now: at(RELEASE_WAIT_DAYS), ownerLastSeenAt: at(0) });
  assert.equal(d.release, true);
  assert.equal(d.reason, 'waited-out');
});

/* THE PROPERTY THE WHOLE DESIGN RESTS ON. An owner who is alive and active
   still cannot stop the clock by ignoring it — only by declining. If activity
   blocked the slow door, being busy would be indistinguishable from being
   dead, and the will would never open. */
test('an ACTIVE owner does not block the slow door, only a decline does', () => {
  const r = withRequest().releaseRequests[0];
  const d = releaseDecision(r, { now: at(RELEASE_WAIT_DAYS), ownerLastSeenAt: at(RELEASE_WAIT_DAYS) });
  assert.equal(d.release, true, 'ignoring a request for seven days still releases it');
});

test('a decline is permanent — it does not pause a clock that later resumes', () => {
  const r = withRequest({ declinedAt: at(1) }).releaseRequests[0];
  for (const day of [2, RELEASE_WAIT_DAYS, 400]) {
    const d = releaseDecision(r, { now: at(day), ownerLastSeenAt: at(0) });
    assert.equal(d.release, false, `a declined request released on day ${day}`);
    assert.equal(d.reason, 'declined');
  }
});

test('two approvals do not revive a declined request', () => {
  const access = withRequest({ declinedAt: at(1) });
  const out = approveRelease(access, {
    requestId: 'r1', uid: 'u-thandi', eligibleUids: ELIGIBLE, now: at(2), ownerLastSeenAt: at(-60),
  });
  assert.equal(out.changed, false);
  assert.equal(out.reason, 'declined');
});

/* ── the fast door: two agree, and only while the owner is quiet ──────────── */

test('two approvals open it at once when the owner has been quiet', () => {
  const access = withRequest();
  const out = approveRelease(access, {
    requestId: 'r1', uid: 'u-thandi', eligibleUids: ELIGIBLE,
    now: at(1), ownerLastSeenAt: at(-QUIET_DAYS - 1),
  });
  assert.equal(out.released, true);
  assert.equal(out.reason, 'two-approvals-owner-quiet');
  assert.equal(out.request.releasedBecause, 'two-approvals-owner-quiet');
});

/* THE HOLE THE GATE EXISTS TO CLOSE. Two heirs agreeing is not a check on the
   heirs — it is a shared key. While the owner is demonstrably alive they must
   get their seven days to say no. */
test('two approvals do NOT open it while the owner is active — they wait', () => {
  const access = withRequest();
  const out = approveRelease(access, {
    requestId: 'r1', uid: 'u-thandi', eligibleUids: ELIGIBLE,
    now: at(1), ownerLastSeenAt: at(0),
  });
  assert.equal(out.released, false);
  assert.equal(out.reason, 'approved-still-pending');
  assert.deepEqual(out.grantUids, []);
  // and the slow door still finishes the job
  assert.equal(releaseDecision(out.request, { now: at(RELEASE_WAIT_DAYS), ownerLastSeenAt: at(0) }).release, true);
});

test('the quiet boundary is exactly QUIET_DAYS, not a day either side', () => {
  assert.equal(ownerIsQuiet(at(0), at(QUIET_DAYS - 0.1)), false);
  assert.equal(ownerIsQuiet(at(0), at(QUIET_DAYS)), true);
});

/* Absent means "no evidence of life", not "recently active" — see the header.
   It skips the WAIT for two people who already agree; it grants nothing alone. */
test('a missing last-seen counts as quiet, and still grants nothing on its own', () => {
  assert.equal(ownerIsQuiet(undefined, at(0)), true);
  assert.equal(ownerIsQuiet(null, at(0)), true);
  assert.equal(ownerIsQuiet('not a date', at(0)), true);
  const alone = releaseDecision(withRequest().releaseRequests[0], { now: at(1), ownerLastSeenAt: undefined });
  assert.equal(alone.release, false, 'one person plus silence is still the slow door');
});

test('one approval is never the fast door, however quiet the owner', () => {
  assert.equal(APPROVALS_FOR_FAST_RELEASE, 2);
  const d = releaseDecision(withRequest().releaseRequests[0], { now: at(1), ownerLastSeenAt: at(-999) });
  assert.equal(d.release, false);
});

/* ── asking is agreeing ──────────────────────────────────────────────────── */

test('the requester counts as the first approver, so two means asker plus one', () => {
  const out = requestRelease({}, { id: 'r9', uid: 'u-anna', name: 'Anna', eligibleUids: ELIGIBLE, now: T0 });
  assert.deepEqual(out.request.approvals, ['u-anna']);
  const second = approveRelease({ releaseRequests: [out.request] }, {
    requestId: 'r9', uid: 'u-thandi', eligibleUids: ELIGIBLE, now: at(1), ownerLastSeenAt: at(-60),
  });
  assert.equal(second.released, true, 'the asker plus one other is two people agreeing');
});

test('approving twice is not two people', () => {
  const access = withRequest();
  const out = approveRelease(access, {
    requestId: 'r1', uid: 'u-anna', eligibleUids: ELIGIBLE, now: at(1), ownerLastSeenAt: at(-60),
  });
  assert.equal(out.changed, false);
  assert.equal(out.reason, 'already-approved');
  assert.equal(out.released, false);
});

test('a duplicate uid already on the list does not count twice either', () => {
  const dupe = withRequest({ approvals: ['u-anna', 'u-anna', 'u-anna'] }).releaseRequests[0];
  assert.deepEqual(approversOf(dupe), ['u-anna']);
  assert.equal(releaseDecision(dupe, { now: at(1), ownerLastSeenAt: at(-60) }).release, false);
});

/* ── who may ask, and who gets in ────────────────────────────────────────── */

test('somebody not named can neither ask nor approve', () => {
  assert.equal(requestRelease({}, { id: 'x', uid: 'u-stranger', eligibleUids: ELIGIBLE, now: T0 }).changed, false);
  const out = approveRelease(withRequest(), {
    requestId: 'r1', uid: 'u-stranger', eligibleUids: ELIGIBLE, now: at(1), ownerLastSeenAt: at(-60),
  });
  assert.equal(out.released, false);
  assert.equal(out.reason, 'not-eligible');
});

/* A caller who forgets the allowlist must get a refusal, never an open door. */
test('a missing allowlist refuses instead of allowing', () => {
  for (const bad of [undefined, null, 'u-anna', {}]) {
    assert.equal(requestRelease({}, { id: 'x', uid: 'u-anna', eligibleUids: bad, now: T0 }).changed, false);
    assert.equal(approveRelease(withRequest(), {
      requestId: 'r1', uid: 'u-thandi', eligibleUids: bad, now: at(1), ownerLastSeenAt: at(-60),
    }).released, false);
  }
});

test('when it opens, BOTH approvers get in — not only the one who asked', () => {
  const out = approveRelease(withRequest(), {
    requestId: 'r1', uid: 'u-thandi', eligibleUids: ELIGIBLE, now: at(1), ownerLastSeenAt: at(-60),
  });
  assert.deepEqual(out.grantUids.sort(), ['u-anna', 'u-thandi']);
});

test('the slow door also lets in everyone who had agreed', () => {
  const access = withRequest({ approvals: ['u-anna', 'u-thandi'] });
  const out = settleReleases(access, { now: at(RELEASE_WAIT_DAYS), ownerLastSeenAt: at(0) });
  assert.equal(out.changed, true);
  assert.deepEqual(out.grantUids.sort(), ['u-anna', 'u-thandi']);
});

/* ── one live request per person ─────────────────────────────────────────── */

test('asking twice does not start a second clock', () => {
  const first = requestRelease({}, { id: 'a', uid: 'u-anna', eligibleUids: ELIGIBLE, now: T0 });
  const second = requestRelease({ releaseRequests: [first.request] }, {
    id: 'b', uid: 'u-anna', eligibleUids: ELIGIBLE, now: at(3),
  });
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'already-pending');
  assert.equal(second.releaseRequests.length, 1);
  assert.equal(second.releaseRequests[0].requestedAt, T0, 'the original clock is not restarted');
});

test('a declined person may ask again, and it is a fresh clock', () => {
  const access = withRequest({ declinedAt: at(1) });
  const again = requestRelease(access, { id: 'r2', uid: 'u-anna', eligibleUids: ELIGIBLE, now: at(2) });
  assert.equal(again.changed, true);
  assert.equal(again.releaseRequests.length, 2, 'the declined one stays on the record');
  assert.equal(again.request.requestedAt, at(2));
});

/* ── the sweep ───────────────────────────────────────────────────────────── */

test('settling releases only what is actually due', () => {
  const access = {
    releaseRequests: [
      { id: 'due', requestedBy: 'u-anna', requestedAt: T0, approvals: ['u-anna'] },
      { id: 'fresh', requestedBy: 'u-thandi', requestedAt: at(RELEASE_WAIT_DAYS - 1), approvals: ['u-thandi'] },
      { id: 'dead', requestedBy: 'u-sipho', requestedAt: T0, approvals: ['u-sipho'], declinedAt: at(1) },
    ],
  };
  const out = settleReleases(access, { now: at(RELEASE_WAIT_DAYS), ownerLastSeenAt: at(0) });
  assert.deepEqual(out.grantUids, ['u-anna']);
  assert.equal(out.releaseRequests.find((r) => r.id === 'due').releasedAt, at(RELEASE_WAIT_DAYS));
  assert.equal(out.releaseRequests.find((r) => r.id === 'fresh').releasedAt, undefined);
  assert.equal(out.releaseRequests.find((r) => r.id === 'dead').releasedAt, undefined);
});

test('settling twice does not re-release or re-grant', () => {
  const once = settleReleases(withRequest(), { now: at(RELEASE_WAIT_DAYS), ownerLastSeenAt: at(0) });
  const twice = settleReleases({ releaseRequests: once.releaseRequests }, {
    now: at(RELEASE_WAIT_DAYS + 5), ownerLastSeenAt: at(0),
  });
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.grantUids, []);
  assert.equal(twice.releaseRequests[0].releasedAt, at(RELEASE_WAIT_DAYS), 'the timestamp is not rewritten');
});

test('a released request cannot be declined afterwards, and says so', () => {
  const once = settleReleases(withRequest(), { now: at(RELEASE_WAIT_DAYS), ownerLastSeenAt: at(0) });
  const out = declineRelease({ releaseRequests: once.releaseRequests }, {
    requestId: 'r1', uid: 'u-owner', now: at(RELEASE_WAIT_DAYS + 1),
  });
  assert.equal(out.changed, false);
  assert.equal(out.reason, 'already-released');
});

/* ── fail closed on rubbish ──────────────────────────────────────────────── */

test('an unreadable requestedAt never releases', () => {
  for (const bad of ['tomorrow', '', null, undefined, {}]) {
    const r = { id: 'r', requestedBy: 'u-anna', requestedAt: bad, approvals: ['u-anna'] };
    assert.equal(releaseDecision(r, { now: at(9999), ownerLastSeenAt: at(0) }).release, false,
      `a request with requestedAt=${JSON.stringify(bad)} released on the slow door`);
  }
});

test('a request list full of rubbish is filtered, not trusted', () => {
  const access = { releaseRequests: [null, 'x', {}, { id: '' }, { id: 'ok', requestedAt: T0 }] };
  assert.deepEqual(releaseRequests(access).map((r) => r.id), ['ok']);
  assert.deepEqual(releaseRequests(null), []);
  assert.deepEqual(releaseRequests({ releaseRequests: 'nope' }), []);
});

test('a bad now does not release, and does not throw', () => {
  const r = withRequest().releaseRequests[0];
  assert.equal(releaseDecision(r, { now: 'rubbish', ownerLastSeenAt: at(0) }).release, false);
  assert.equal(releaseDecision(null, { now: at(9) }).release, false);
});

test('the free-text name is bounded — it renders on the owner’s phone', () => {
  const out = requestRelease({}, {
    id: 'r', uid: 'u-anna', name: 'z'.repeat(9000), eligibleUids: ELIGIBLE, now: T0,
  });
  assert.equal(out.request.requestedByName.length, 120);
});

test('days remaining counts down and floors at zero', () => {
  const r = withRequest().releaseRequests[0];
  assert.equal(daysUntilRelease(r, T0), RELEASE_WAIT_DAYS);
  assert.equal(daysUntilRelease(r, at(RELEASE_WAIT_DAYS)), 0);
  assert.equal(daysUntilRelease(r, at(999)), 0);
  assert.equal(daysUntilRelease({ requestedAt: 'nope' }, T0), null);
});

/* ── the rule that must survive every future edit ─────────────────────────── */

test('NOTHING in this file releases on inactivity alone', () => {
  // Every quiet-owner path still requires a second person or a served wait.
  for (const days of [QUIET_DAYS, 90, 3650]) {
    const d = releaseDecision(
      { id: 'r', requestedBy: 'u-anna', requestedAt: at(days - 0.5), approvals: ['u-anna'] },
      { now: at(days), ownerLastSeenAt: at(-days) },
    );
    assert.equal(d.release, false,
      'a lone request released early purely because the owner was quiet');
  }
  // And with no request at all there is nothing to release, ever.
  assert.deepEqual(settleReleases({}, { now: at(9999), ownerLastSeenAt: at(-9999) }).grantUids, []);
});

test('the reason inactivity must never be a trigger is written down, not just known', () => {
  const src = readFileSync(new URL('./willsRelease.mjs', import.meta.url), 'utf8');
  assert.match(src, /INACTIVITY IS A PERMISSION TO SKIP THE WAIT\. IT IS NEVER A TRIGGER\./);
  assert.match(src, /fires while you are in hospital and stays silent when you\s*\n\/\/ are dead/);
});
