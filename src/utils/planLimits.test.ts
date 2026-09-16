// Standalone assertion test for planLimits — no test runner is configured in
// this project (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/planLimits.test.ts
// It exits non-zero on failure. Mirrors the style of speechLocale.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import {
  PLAN_LIMITS, planFromField, monthKeyUtc, resetDateLabelUtc,
  isAiLimitReached, canAddMember, aiLimitMessage, seatLimitMessage,
  resolvePlan, TRIAL_DAYS, trialExpiryIso, GLOBAL_AI_ACTIONS_PER_MONTH,
} from './planLimits';

// --- Plan limits table ------------------------------------------------------
// These are money, not preferences: an AI action costs roughly $0.06, so the
// numbers are asserted literally rather than "greater than zero".
assert.strictEqual(PLAN_LIMITS.free.aiActionsPerMonth, 5);
assert.strictEqual(PLAN_LIMITS.free.seats, 10);
assert.strictEqual(PLAN_LIMITS.trial.aiActionsPerMonth, 100);
assert.strictEqual(PLAN_LIMITS.trial.seats, 200);
assert.strictEqual(PLAN_LIMITS.paid.aiActionsPerMonth, 2000);
assert.strictEqual(PLAN_LIMITS.paid.seats, 200);
// The tiers must stay ordered. A trial that outspends the paid plan, or a free
// tier that matches the trial, means somebody edited one number in isolation.
assert.ok(PLAN_LIMITS.free.aiActionsPerMonth < PLAN_LIMITS.trial.aiActionsPerMonth);
assert.ok(PLAN_LIMITS.trial.aiActionsPerMonth < PLAN_LIMITS.paid.aiActionsPerMonth);
assert.strictEqual(GLOBAL_AI_ACTIONS_PER_MONTH, 5000);

// --- planFromField: an allowlist of tier names, everything else is free ----
assert.strictEqual(planFromField('paid'), 'paid');
assert.strictEqual(planFromField('trial'), 'trial');
// The important negative: an unrecognised value must NOT fall through to the
// expensive tier. "not free means paid" would make a typo cost $120 a month.
assert.strictEqual(planFromField('Trial'), 'free');
assert.strictEqual(planFromField('premium'), 'free');
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
assert.strictEqual(isAiLimitReached(4, 'free'), false); // one action left
assert.strictEqual(isAiLimitReached(5, 'free'), true);  // exactly at the cap — reached
assert.strictEqual(isAiLimitReached(6, 'free'), true);  // somehow over — still reached
assert.strictEqual(isAiLimitReached(99, 'trial'), false);
assert.strictEqual(isAiLimitReached(100, 'trial'), true);
assert.strictEqual(isAiLimitReached(1999, 'paid'), false);
assert.strictEqual(isAiLimitReached(2000, 'paid'), true);
assert.strictEqual(isAiLimitReached(2001, 'paid'), true);

// --- aiLimitMessage: human, and names the reset date ------------------------
const freeMsg = aiLimitMessage('free', new Date('2026-07-28T12:00:00Z'));
assert.ok(freeMsg.includes('5 AI actions'), 'names the free-plan limit');
assert.ok(freeMsg.includes('1 August'), 'names the reset date');
assert.ok(freeMsg.toLowerCase().includes('still work'), 'reassures the rest of the app still works');
assert.ok(!/error|code/i.test(freeMsg), 'reads as a human sentence, not an error code');
const trialMsg = aiLimitMessage('trial', new Date('2026-07-28T12:00:00Z'));
assert.ok(trialMsg.includes('100 AI actions'), 'names the trial limit, not the free one');

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

// --- resolvePlan: a trial resolves to 'trial', NEVER to 'paid' --------------
// This is the whole point of the tier existing. Every new space is stamped
// 'trial' with a 180-day expiry; if that resolved to 'paid' the way it used to,
// every signup would carry the 2,000-action ceiling for six months and the free
// number would be irrelevant to what the app costs to run.
assert.strictEqual(resolvePlan({ plan: 'trial', planExpiresAt: '2026-08-11T12:00:00Z' }, NOW), 'trial');
assert.strictEqual(resolvePlan({ plan: 'trial' }, NOW), 'trial');
// An expired trial drops to free, lazily, exactly like an expired paid grant.
assert.strictEqual(resolvePlan({ plan: 'trial', planExpiresAt: '2026-01-01T00:00:00Z' }, NOW), 'free');
assert.strictEqual(resolvePlan({ plan: 'trial', planExpiresAt: '2026-07-28T12:00:00Z' }, NOW), 'free');
// An unexpired grant never promotes: a trial cannot become paid by waiting.
assert.notStrictEqual(resolvePlan({ plan: 'trial', planExpiresAt: '2099-01-01T00:00:00Z' }, NOW), 'paid');

// --- trialExpiryIso: exactly TRIAL_DAYS days out, UTC ------------------------
assert.strictEqual(TRIAL_DAYS, 90);
assert.strictEqual(trialExpiryIso(new Date('2026-07-01T09:00:00Z')), '2026-09-29T09:00:00.000Z');
// Month-end and year rollover handled by native Date UTC arithmetic, not manual math.
assert.strictEqual(trialExpiryIso(new Date('2026-11-25T00:00:00Z')), '2027-02-23T00:00:00.000Z');

// --- the OTHER copy of this constant ----------------------------------------
// server.js declares its own TRIAL_DAYS because it ships standalone with no
// TypeScript in the runtime image, and ITS copy is what stamps planExpiresAt
// onto a new space. So the constant above is decorative on its own: editing it
// alone changes the number nobody sees and leaves every real signup on the old
// trial. Nothing else in the suite would notice, which is why this reads the
// server file directly.
{
  const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  const m = serverSrc.match(/^const TRIAL_DAYS = (\d+);$/m);
  assert.ok(m, 'server.js no longer declares TRIAL_DAYS — find where it stamps planExpiresAt now.');
  assert.strictEqual(
    Number(m[1]),
    TRIAL_DAYS,
    `server.js stamps a ${m[1]}-day trial while planLimits.ts says ${TRIAL_DAYS}. The server's number is the real one.`,
  );
}

// --- the SERVER's copy of the limits table is the one that costs money ------
// planLimits.ts is display-only; server.js enforces. The TRIAL_DAYS check above
// already proved that class of drift is real, and the limits table is worse:
// editing only the TypeScript would show every user a number the server does
// not honour, in either direction. So every figure is pinned to the server file
// itself, not to a second copy of the same constant.
{
  const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  const table = serverSrc.match(/const PLAN_LIMITS = \{([\s\S]*?)\n\};/);
  assert.ok(table, 'server.js no longer declares PLAN_LIMITS — find what enforces the limits now.');
  for (const plan of ['free', 'trial', 'paid'] as const) {
    const row = table![1].match(
      new RegExp(`${plan}: \\{ aiActionsPerMonth: (\\d+), seats: (\\d+) \\}`),
    );
    assert.ok(row, `server.js PLAN_LIMITS has no '${plan}' row — the client offers a tier the server cannot price.`);
    assert.strictEqual(
      Number(row![1]), PLAN_LIMITS[plan].aiActionsPerMonth,
      `server.js allows ${row![1]} AI actions on '${plan}' while planLimits.ts says ${PLAN_LIMITS[plan].aiActionsPerMonth}. The server's number is the real one.`,
    );
    assert.strictEqual(
      Number(row![2]), PLAN_LIMITS[plan].seats,
      `server.js allows ${row![2]} seats on '${plan}' while planLimits.ts says ${PLAN_LIMITS[plan].seats}.`,
    );
  }

  // The whole-app ceiling — the only limit that bounds the bill regardless of
  // how many people sign up, so its absence is worth failing the build over.
  const globalDefault = serverSrc.match(/const GLOBAL_AI_DEFAULT = (\d+);/);
  assert.ok(globalDefault, 'server.js no longer declares GLOBAL_AI_DEFAULT — the app-wide AI ceiling is gone.');
  assert.strictEqual(
    Number(globalDefault![1]), GLOBAL_AI_ACTIONS_PER_MONTH,
    'the app-wide AI ceiling differs between server.js and planLimits.ts',
  );

  // A per-space cap cannot bound the bill (cost scales with signups), so the
  // global check must actually be consulted before a Gemini call — and BEFORE
  // the per-space read, which fails open.
  assert.ok(
    /async function checkAiUsage[\s\S]{0,400}?getGlobalAiStatus\(\)/.test(serverSrc),
    'checkAiUsage no longer consults the app-wide ceiling first — the bill is unbounded again.',
  );
  assert.ok(
    serverSrc.includes('globalUsage/${key}'),
    'nothing increments the app-wide counter, so the ceiling can never be reached.',
  );

  // Every new space must be stamped 'trial'. Stamping 'paid' is exactly the bug
  // this tier was created to fix: it handed every signup the 2,000-action paid
  // allowance for 180 days and made the free number irrelevant to the bill.
  assert.ok(
    !/plan: 'paid', planExpiresAt: trialExpiryIso\(\)/.test(serverSrc),
    "a new space is being stamped plan:'paid' with a trial expiry — that is the 2,000-action ceiling for every signup.",
  );
  const stamps = serverSrc.match(/plan: 'trial', planExpiresAt: trialExpiryIso\(\)/g) || [];
  assert.strictEqual(stamps.length, 2, 'both /api/create-family and /api/create-space must stamp a trial');
}

console.log('planLimits.test.ts: all assertions passed');
