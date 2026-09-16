// Pure state transitions for RELEASING the will to someone already named.
// Dependency-free (no firebase-admin) so it can be `node --test`ed directly;
// server.js does the Firestore reads/writes around it, exactly as with
// willsInvite.mjs next door.
//
// WHY THIS EXISTS
//
// Until now the only way anybody read the will was an admin ticking a box or
// sending an invite that granted full access on acceptance. Both need the
// admin to be alive and reachable, which is the one thing you cannot assume
// about the moment this matters. There is no death detection in this app and
// there is not going to be: a mechanism that decides somebody has died is a
// mechanism that will one day be wrong about it.
//
// So the release is asked for by the person who needs it, and the owner's
// silence is what grants it.
//
// TWO DOORS, AND NEITHER CAN BE THE ONLY ONE
//
//   TWO PEOPLE AGREE  → immediate, but only while the owner has been quiet.
//   ONE PERSON ASKS   → released after RELEASE_WAIT_DAYS of nobody objecting.
//
// The wait cannot be removed. Two-of-two deadlocks in three ordinary cases:
// only one person was ever named; both named people were in the same accident;
// one of them refuses, which is likeliest exactly when the will is contested.
// A mechanism whose failure mode is "the will is never read" is not a
// safeguard. Silence, by contrast, cannot deadlock — it is the default state
// of the world.
//
// The fast door cannot be the only one either, and for the opposite reason:
// the two people best placed to agree are usually the two heirs, and two heirs
// agreeing is not a check on the heirs, it is a shared key. So the fast door
// is available only when the owner has not opened the app in QUIET_DAYS.
//
// INACTIVITY IS A PERMISSION TO SKIP THE WAIT. IT IS NEVER A TRIGGER.
//
// Read that twice before changing anything here. Nothing in this file releases
// anything because somebody was quiet. Quiet only decides whether two people
// who ALREADY AGREE have to wait seven days. An inactivity timer that grants
// access on its own fires while you are in hospital and stays silent when you
// are dead, and it is the single most tempting wrong thing to build here.

/** Days a request sits before silence releases it. */
export const RELEASE_WAIT_DAYS = 7;
/** Days without the owner opening the app before the fast door opens. */
export const QUIET_DAYS = 14;
/** Approvals needed for the fast door. Two, and the requester counts as one. */
export const APPROVALS_FOR_FAST_RELEASE = 2;

const DAY = 24 * 60 * 60 * 1000;

/* Milliseconds, or null — and the type check is NOT redundant.
 *
 * `new Date(null).getTime()` is 0, a perfectly finite number, so a request
 * whose `requestedAt` came back null reads as 1st January 1970 and its seven
 * days ran out half a century ago. Number.isFinite alone let that through and
 * released the will on the spot. Only a string or a Date is a time here;
 * everything else is a refusal. */
const ms = (v) => {
  if (typeof v !== 'string' && !(v instanceof Date)) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** The request list, defensively normalised — a doc may predate the field. */
export function releaseRequests(access) {
  const raw = access && Array.isArray(access.releaseRequests) ? access.releaseRequests : [];
  return raw.filter((r) => r && typeof r.id === 'string' && r.id);
}

/**
 * Has the owner been quiet long enough for the fast door?
 *
 * A MISSING TIMESTAMP MEANS QUIET. This is the one default in this file that
 * opens something rather than closing it, and it is deliberate: `ownerLastSeenAt`
 * is written by admins when they open the vault, so it is absent for every
 * household that predates the field and for every owner who has genuinely never
 * come back. Treating absent as "recently active" would leave those households
 * permanently on the slow door with no way to ever reach the fast one — and the
 * slow door still runs, so nothing is lost that silence would not grant anyway
 * seven days later. Absent means we have no evidence of life, not that we have
 * evidence of death: it makes two people who agree wait less, and grants
 * nothing on its own.
 */
export function ownerIsQuiet(ownerLastSeenAt, now = new Date()) {
  const seen = ms(ownerLastSeenAt);
  if (seen === null) return true;
  const at = ms(now);
  if (at === null) return false;
  return at - seen >= QUIET_DAYS * DAY;
}

/** Distinct approver uids on a request. The requester is always among them. */
export function approversOf(request) {
  const raw = Array.isArray(request?.approvals) ? request.approvals : [];
  const seen = new Set();
  for (const u of raw) if (typeof u === 'string' && u) seen.add(u);
  return [...seen];
}

/**
 * Should this request open the will right now, and on which grounds?
 *
 * Returns { release, reason }. The reason is carried into the stored record and
 * shown to the owner afterwards, because "your will was opened" is not a
 * complete sentence — "opened because Anna and Thandi both asked while you had
 * not used the app for a month" is.
 */
export function releaseDecision(request, { now = new Date(), ownerLastSeenAt } = {}) {
  if (!request || typeof request !== 'object') return { release: false, reason: 'no-request' };
  // A decline kills the request permanently. It does not pause it: a paused
  // request would quietly resume the clock the owner thought they had stopped.
  if (request.declinedAt) return { release: false, reason: 'declined' };
  if (request.releasedAt) return { release: false, reason: 'already-released' };

  const approvals = approversOf(request);
  if (approvals.length >= APPROVALS_FOR_FAST_RELEASE && ownerIsQuiet(ownerLastSeenAt, now)) {
    return { release: true, reason: 'two-approvals-owner-quiet' };
  }

  const at = ms(request.requestedAt);
  const nowMs = ms(now);
  // An unreadable requestedAt must NOT release. The fail-closed reading is the
  // only safe one: a clock we cannot read is not a clock that has run out.
  if (at === null || nowMs === null) return { release: false, reason: 'pending' };
  if (nowMs - at >= RELEASE_WAIT_DAYS * DAY) return { release: true, reason: 'waited-out' };

  return { release: false, reason: 'pending' };
}

/** Whole days left on the slow door, or null when it is not the deciding path. */
export function daysUntilRelease(request, now = new Date()) {
  const at = ms(request?.requestedAt);
  const nowMs = ms(now);
  if (at === null || nowMs === null) return null;
  const left = Math.ceil((at + RELEASE_WAIT_DAYS * DAY - nowMs) / DAY);
  return left > 0 ? left : 0;
}

/**
 * Somebody named asks to read the will.
 *
 * `eligibleUids` is the allowlist the CALLER resolves — named readers and
 * designated successors. It is passed in rather than derived here because this
 * file has no database, and it is REQUIRED rather than optional so that a
 * caller who forgets it gets a refusal instead of an open door.
 */
export function requestRelease(access, { id, uid, name, eligibleUids, now = new Date() }) {
  const existing = releaseRequests(access);
  const unchanged = { changed: false, releaseRequests: existing };

  if (!id || !uid) return { ...unchanged, reason: 'bad-request' };
  if (!Array.isArray(eligibleUids) || !eligibleUids.includes(uid)) {
    return { ...unchanged, reason: 'not-eligible' };
  }
  // One live request per person. Otherwise ten requests are ten clocks, and the
  // owner has to decline each of them to stop what is really one asking.
  const live = existing.find(
    (r) => r.requestedBy === uid && !r.declinedAt && !r.releasedAt,
  );
  if (live) return { ...unchanged, reason: 'already-pending', request: live };

  const request = {
    id,
    requestedBy: uid,
    requestedByName: typeof name === 'string' ? name.trim().slice(0, 120) : '',
    requestedAt: new Date(now).toISOString(),
    // ASKING IS AGREEING. The requester is the first approver, so "two people
    // agree" means the asker plus one — not the asker plus two.
    approvals: [uid],
  };
  return { changed: true, releaseRequests: [...existing, request], request, reason: 'requested' };
}

/** A second named person agrees. May open the will immediately — see the header. */
export function approveRelease(access, { requestId, uid, eligibleUids, now = new Date(), ownerLastSeenAt }) {
  const existing = releaseRequests(access);
  const unchanged = { changed: false, releaseRequests: existing, released: false };

  if (!requestId || !uid) return { ...unchanged, reason: 'bad-request' };
  if (!Array.isArray(eligibleUids) || !eligibleUids.includes(uid)) {
    return { ...unchanged, reason: 'not-eligible' };
  }
  const request = existing.find((r) => r.id === requestId);
  if (!request) return { ...unchanged, reason: 'no-such-request' };
  if (request.declinedAt) return { ...unchanged, reason: 'declined' };
  if (request.releasedAt) return { ...unchanged, reason: 'already-released' };

  const approvals = approversOf(request);
  if (approvals.includes(uid)) return { ...unchanged, reason: 'already-approved', request };

  const next = { ...request, approvals: [...approvals, uid] };
  const decision = releaseDecision(next, { now, ownerLastSeenAt });
  const settled = decision.release
    ? { ...next, releasedAt: new Date(now).toISOString(), releasedBecause: decision.reason }
    : next;

  return {
    changed: true,
    releaseRequests: existing.map((r) => (r.id === requestId ? settled : r)),
    request: settled,
    released: decision.release,
    // Who gets in when it opens: BOTH approvers, not only the asker. Neither
    // should have to relay to the other what the will says — that is where the
    // arguments start, and it is the reason two of them agreed in the first place.
    grantUids: decision.release ? approversOf(settled) : [],
    reason: decision.release ? decision.reason : 'approved-still-pending',
  };
}

/** The owner (or any admin) says no. Permanent for that request. */
export function declineRelease(access, { requestId, uid, now = new Date() }) {
  const existing = releaseRequests(access);
  const request = existing.find((r) => r.id === requestId);
  if (!request) return { changed: false, releaseRequests: existing, reason: 'no-such-request' };
  if (request.releasedAt) {
    // Too late is TOO LATE, and saying so plainly beats a button that appears
    // to undo something it cannot. Revoking the reader is a separate act.
    return { changed: false, releaseRequests: existing, reason: 'already-released' };
  }
  if (request.declinedAt) return { changed: false, releaseRequests: existing, reason: 'already-declined' };

  const settled = { ...request, declinedAt: new Date(now).toISOString(), declinedBy: uid || '' };
  return {
    changed: true,
    releaseRequests: existing.map((r) => (r.id === requestId ? settled : r)),
    request: settled,
    reason: 'declined',
  };
}

/**
 * The sweep: release anything whose clock has run out.
 *
 * Called on read rather than by a scheduler, the same lazy pattern the trial
 * expiry uses. That means the release lands the next time ANYBODY opens the
 * vault — including the person waiting, whose own visit is what settles it.
 * A cron would be tidier and would also be a second writer to this document.
 */
export function settleReleases(access, { now = new Date(), ownerLastSeenAt } = {}) {
  const existing = releaseRequests(access);
  const grantUids = [];
  let changed = false;

  const next = existing.map((r) => {
    const decision = releaseDecision(r, { now, ownerLastSeenAt });
    if (!decision.release) return r;
    changed = true;
    for (const u of approversOf(r)) if (!grantUids.includes(u)) grantUids.push(u);
    return { ...r, releasedAt: new Date(now).toISOString(), releasedBecause: decision.reason };
  });

  return { changed, releaseRequests: next, grantUids };
}
