// Standalone assertion test for planLimits — no test runner is configured in
// this project (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/planLimits.test.ts
// It exits non-zero on failure. Mirrors the style of speechLocale.test.ts.
import assert from 'node:assert';
import {
  PLAN_LIMITS, planFromField, monthKeyUtc, resetDateLabelUtc,
  isAiLimitReached, canAddMember, aiLimitMessage, seatLimitMessage,
  resolvePlan, TRIAL_DAYS, trialExpiryIso,
} from './planLimits';

// --- Plan limits table ------------------------------------------------------
assert.strictEqual(PLAN_LIMITS.free.aiActionsPerMonth, 30);
assert.strictEqual(PLAN_LIMITS.free.seats, 10);
assert.strictEqual(PLAN_LIMITS.paid.aiActionsPerMonth, 2000);
assert.strictEqual(PLAN_LIMITS.paid.seats, 200);

// --- planFromField: anything other than exactly "paid" is "free" -----------
assert.strictEqual(planFromField('paid'), 'paid');
assert.strictEqual(planFromField('free'), 'free');
assert.strictEqual(planFromField(undefined), 'free');
assert.strictEqual(planFromField(null), 'free');
assert.strictEqual(planFromField(''), 'free');
assert.strictEqual(planFromField('PAID'), 'free'); // case-sensitive on purpose — the field is server-written, never guessed
assert.strictEqual(planFromField(123), 'free');

// --- monthKeyUtc: UTC-based YYYY-MM, independent of local timezone ---------
assert.strictEqual(monthKeyUtc(new Date('2026-07-28T12:00:00Z')), '2026-07');
assert.strictEqual(monthKeyUtc(new Date('2026-01-01T00:00:00Z')), '2026-01');
assert.strictEqual(monthKeyUtc(new Date('2026-12-31T23:59:59Z')), '2026-12');
// A moment that is 1 August LOCAL time (e.g. UTC+2) but still 31 July in UTC
// must key to July — this is the whole point of pinning to UTC rather than
// local time, since spaces have no stored timezone to be "local" to.
assert.strictEqual(monthKeyUtc(new Date('2026-07-31T23:30:00Z')), '2026-07');

// --- resetDateLabelUtc: always the 1st of the NEXT UTC month ---------------
assert.strictEqual(resetDateLabelUtc(new Date('2026-07-28T12:00:00Z')), '1 August');
assert.strictEqual(resetDateLabelUtc(new Date('2026-07-01T00:00:00Z')), '1 August');
assert.strictEqual(resetDateLabelUtc(new Date('2026-07-31T23:59:59Z')), '1 August');
// Year-end wrap: December's "next month" is January of the FOLLOWING year.
assert.strictEqual(resetDateLabelUtc(new Date('2026-12-15T00:00:00Z')), '1 January');

// --- isAiLimitReached: boundary behaviour, both plans -----------------------
assert.strictEqual(isAiLimitReached(0, 'free'), false);
assert.strictEqual(isAiLimitReached(29, 'free'), false); // one action left
assert.strictEqual(isAiLimitReached(30, 'free'), true);  // exactly at the cap — reached
assert.strictEqual(isAiLimitReached(31, 'free'), true);  // somehow over — still reached
assert.strictEqual(isAiLimitReached(1999, 'paid'), false);
assert.strictEqual(isAiLimitReached(2000, 'paid'), true);
assert.strictEqual(isAiLimitReached(2001, 'paid'), true);

// --- aiLimitMessage: human, and names the reset date ------------------------
const freeMsg = aiLimitMessage('free', new Date('2026-07-28T12:00:00Z'));
assert.ok(freeMsg.includes('30 AI actions'), 'names the free-plan limit');
assert.ok(freeMsg.includes('1 August'), 'names the reset date');
assert.ok(freeMsg.toLowerCase().includes('still work'), 'reassures the rest of the app still works');
assert.ok(!/error|code/i.test(freeMsg), 'reads as a human sentence, not an error code');

// --- canAddMember: normal cases ---------------------------------------------
assert.strictEqual(canAddMember(0, 'free'), true);
assert.strictEqual(canAddMember(9, 'free'), true);   // 10th member fits
assert.strictEqual(canAddMember(10, 'free'), false); // space already has 10 — the 11th is refused
assert.strictEqual(canAddMember(199, 'paid'), true);
assert.strictEqual(canAddMember(200, 'paid'), false);

// --- canAddMember: the "already over limit" GRANDFATHER case ---------------
// A space that is already well over its plan's seat limit (e.g. it grew to
// 25 members while paid, then was downgraded to free — limit 10) must still
// REFUSE any new join. This function says nothing about removing anyone
// already in — it is only ever consulted at join time — so existing members
// keep working; only the decision for a hypothetical NEW join is asserted here.
assert.strictEqual(canAddMember(25, 'free'), false);
assert.strictEqual(canAddMember(250, 'free'), false);
// Exactly at an inflated count equal to the OTHER plan's limit still refuses
// under the current (lower) plan — the decision uses the space's ACTUAL plan,
// never the count itself, to pick the limit.
assert.strictEqual(canAddMember(200, 'free'), false);

// --- seatLimitMessage: names the actual limit that applied ------------------
const seatMsg = seatLimitMessage(10, 'free');
assert.ok(seatMsg.includes('10 members'));
assert.ok(seatMsg.includes('free plan'));
assert.ok(seatMsg.includes('10'));

// --- resolvePlan: lazy expiry ------------------------------------------------
const NOW = new Date('2026-07-28T12:00:00Z');
assert.strictEqual(resolvePlan(null, NOW), 'free');
assert.strictEqual(resolvePlan(undefined, NOW), 'free');
assert.strictEqual(resolvePlan({}, NOW), 'free');
assert.strictEqual(resolvePlan({ plan: 'free' }, NOW), 'free');
// No expiry at all — the original pre-trial precedent (a hand-flipped field
// with no end date) stays paid forever.
assert.strictEqual(resolvePlan({ plan: 'paid' }, NOW), 'paid');
// Still in the future — paid.
assert.strictEqual(resolvePlan({ plan: 'paid', planExpiresAt: '2026-08-11T12:00:00Z' }, NOW), 'paid');
// Exactly at the expiry instant — expired (inclusive boundary, same as
// isAiLimitReached treating "at the cap" as reached).
assert.strictEqual(resolvePlan({ plan: 'paid', planExpiresAt: '2026-07-28T12:00:00Z' }, NOW), 'free');
// In the past — expired.
assert.strictEqual(resolvePlan({ plan: 'paid', planExpiresAt: '2026-01-01T00:00:00Z' }, NOW), 'free');
// A garbage/unparseable expiry must not crash or silently grant paid forever
// — treated as "no usable expiry", so it stays paid (same as absent), not
// thrown away as free. The field is server-written, but this keeps a typo
// from either crashing the client or silently expiring a real grant early.
assert.strictEqual(resolvePlan({ plan: 'paid', planExpiresAt: 'not-a-date' }, NOW), 'paid');

// --- trialExpiryIso: exactly TRIAL_DAYS days out, UTC ------------------------
assert.strictEqual(TRIAL_DAYS, 14);
assert.strictEqual(trialExpiryIso(new Date('2026-07-01T09:00:00Z')), '2026-07-15T09:00:00.000Z');
// Month-end rollover handled by native Date UTC arithmetic, not manual math.
assert.strictEqual(trialExpiryIso(new Date('2026-07-25T00:00:00Z')), '2026-08-08T00:00:00.000Z');

console.log('planLimits.test.ts: all assertions passed');
