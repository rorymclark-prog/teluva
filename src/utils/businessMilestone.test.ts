// Standalone assertion test — no test runner is configured in this project
// (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/businessMilestone.test.ts
// It exits non-zero on failure. Mirrors speechLocale.test.ts's convention.
import assert from 'node:assert';
import {
  yearsSinceFounding, nextAnniversary, ordinal, toISODate,
  nextMilestoneAnniversary, headcountTrend,
} from './businessMilestone';
import { BusinessMilestoneEntry, HeadcountLog } from '../types';

// --- ordinal ---
assert.strictEqual(ordinal(1), '1st');
assert.strictEqual(ordinal(2), '2nd');
assert.strictEqual(ordinal(3), '3rd');
assert.strictEqual(ordinal(4), '4th');
assert.strictEqual(ordinal(11), '11th'); // teen exception
assert.strictEqual(ordinal(12), '12th');
assert.strictEqual(ordinal(13), '13th');
assert.strictEqual(ordinal(21), '21st');
assert.strictEqual(ordinal(100), '100th');
assert.strictEqual(ordinal(101), '101st');

// --- toISODate ---
assert.strictEqual(toISODate(new Date(2026, 0, 5)), '2026-01-05'); // zero-padded

// --- yearsSinceFounding ---
assert.strictEqual(yearsSinceFounding(undefined), null);
assert.strictEqual(yearsSinceFounding('not-a-date'), null);
// Anniversary already passed this year → full years elapsed
assert.strictEqual(yearsSinceFounding('2020-01-15', new Date(2026, 5, 1)), 6);
// Anniversary not yet reached this year → one less
assert.strictEqual(yearsSinceFounding('2020-12-15', new Date(2026, 5, 1)), 5);
// Exactly on the anniversary
assert.strictEqual(yearsSinceFounding('2020-06-01', new Date(2026, 5, 1)), 6);
// Future founding date never goes negative
assert.strictEqual(yearsSinceFounding('2099-01-01', new Date(2026, 5, 1)), 0);

// --- nextAnniversary ---
assert.strictEqual(nextAnniversary(undefined), null);
{
  // Anniversary later this year → same year, correct "years" count
  const r = nextAnniversary('2020-08-15', new Date(2026, 5, 1));
  assert.ok(r);
  assert.strictEqual(toISODate(r!.date), '2026-08-15');
  assert.strictEqual(r!.years, 6);
}
{
  // Anniversary already passed this year → rolls to next year
  const r = nextAnniversary('2020-02-15', new Date(2026, 5, 1));
  assert.ok(r);
  assert.strictEqual(toISODate(r!.date), '2027-02-15');
  assert.strictEqual(r!.years, 7);
}
{
  // Anniversary is TODAY → counts as "next" (today), matching the
  // birthday-nudge convention documented in NeedsAttention.tsx.
  const r = nextAnniversary('2020-06-01', new Date(2026, 5, 1));
  assert.ok(r);
  assert.strictEqual(toISODate(r!.date), '2026-06-01');
  assert.strictEqual(r!.years, 6);
}
// Reused directly for a per-employee work anniversary (member.startDate) —
// same function, no separate helper, confirmed here works identically.
{
  const r = nextAnniversary('2023-03-10', new Date(2026, 2, 1));
  assert.ok(r);
  assert.strictEqual(toISODate(r!.date), '2026-03-10');
  assert.strictEqual(r!.years, 3);
}

// --- nextMilestoneAnniversary ---
assert.strictEqual(nextMilestoneAnniversary([]), null);
{
  const milestones: BusinessMilestoneEntry[] = [
    { id: 'a', title: 'First customer', date: '2022-09-01', kind: 'First customer' },
    { id: 'b', title: 'New location', date: '2023-11-20', kind: 'New location' },
    { id: 'c', title: 'Bad date', date: 'nonsense', kind: 'Other' },
  ];
  // As of 2026-08-25, the nearest upcoming anniversary should be 'a' (Sep 1),
  // not 'b' (Nov 20) — even though 'b' is a later calendar date overall, 'a'
  // is closer from "today".
  const r = nextMilestoneAnniversary(milestones, new Date(2026, 7, 25));
  assert.ok(r);
  assert.strictEqual(r!.milestone.id, 'a');
  assert.strictEqual(toISODate(r!.date), '2026-09-01');
  assert.strictEqual(r!.years, 4);
}

// --- headcountTrend ---
assert.strictEqual(headcountTrend([]), null);
{
  const log: HeadcountLog[] = [
    { id: '1', date: '2024-01-01', count: 3 },
    { id: '2', date: '2025-01-01', count: 5 },
    { id: '3', date: '2026-01-01', count: 8 },
  ];
  const t = headcountTrend(log);
  assert.ok(t);
  assert.strictEqual(t!.first.count, 3);
  assert.strictEqual(t!.latest.count, 8);
  assert.strictEqual(t!.deltaSinceFirst, 5);
  assert.strictEqual(t!.isAllTimeHigh, true);
}
{
  // Out-of-order input still sorts correctly by date, and a dip after a peak
  // is correctly NOT an all-time high.
  const log: HeadcountLog[] = [
    { id: '1', date: '2026-01-01', count: 4 }, // latest by date, but a dip
    { id: '2', date: '2024-01-01', count: 3 },
    { id: '3', date: '2025-01-01', count: 9 }, // the actual peak
  ];
  const t = headcountTrend(log);
  assert.ok(t);
  assert.strictEqual(t!.first.count, 3);
  assert.strictEqual(t!.latest.count, 4);
  assert.strictEqual(t!.deltaSinceFirst, 1);
  assert.strictEqual(t!.isAllTimeHigh, false);
}

console.log('businessMilestone.test.ts: all assertions passed');
