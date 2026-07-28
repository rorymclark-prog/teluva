// Standalone assertion test for funeralCover.ts — no test runner is configured
// in this project (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/funeralCover.test.ts
// It exits non-zero on failure. Mirrors speechLocale.test.ts's style.
import assert from 'node:assert';
import {
  isFuneralPolicy, waitingPeriodEndISO, daysUntilWaitingPeriodEnd, inWaitingPeriod,
  claimDeadlineFromDeath, claimDeadlineLabel,
} from './funeralCover';

// --- isFuneralPolicy ---
assert.strictEqual(isFuneralPolicy('Funeral cover'), true);
assert.strictEqual(isFuneralPolicy('Burial society'), true);
assert.strictEqual(isFuneralPolicy('Repatriation cover'), true);
assert.strictEqual(isFuneralPolicy('Home contents'), false);
assert.strictEqual(isFuneralPolicy(undefined), false);
assert.strictEqual(isFuneralPolicy(''), false);

// --- waitingPeriodEndISO: derive from startDate + waitingPeriodMonths ---
assert.strictEqual(
  waitingPeriodEndISO({ startDate: '2026-01-15', waitingPeriodMonths: 6, waitingPeriodEndDate: undefined }),
  '2026-07-15',
);
// An explicit override always wins over the derived date.
assert.strictEqual(
  waitingPeriodEndISO({ startDate: '2026-01-15', waitingPeriodMonths: 6, waitingPeriodEndDate: '2026-03-01' }),
  '2026-03-01',
);
// Missing inputs → null, not a guess.
assert.strictEqual(waitingPeriodEndISO({ startDate: undefined, waitingPeriodMonths: 6, waitingPeriodEndDate: undefined }), null);
assert.strictEqual(waitingPeriodEndISO({ startDate: '2026-01-15', waitingPeriodMonths: undefined, waitingPeriodEndDate: undefined }), null);
assert.strictEqual(waitingPeriodEndISO({ startDate: '2026-01-15', waitingPeriodMonths: 0, waitingPeriodEndDate: undefined }), null);

// --- daysUntilWaitingPeriodEnd / inWaitingPeriod ---
{
  const now = new Date(2026, 0, 1).getTime(); // 1 Jan 2026, local midnight
  const policy = { startDate: '2025-10-01', waitingPeriodMonths: 6, waitingPeriodEndDate: undefined }; // ends 2026-04-01
  const days = daysUntilWaitingPeriodEnd(policy, now);
  assert.strictEqual(days, 90); // Jan(31 incl 1st→31=30) + Feb(28) + Mar(31) = 90 days to Apr 1 2026
  assert.strictEqual(inWaitingPeriod(policy, now), true);
}
{
  // Waiting period already over (policy started well over 6 months ago).
  const now = new Date(2026, 6, 1).getTime(); // 1 Jul 2026
  const policy = { startDate: '2025-01-01', waitingPeriodMonths: 6, waitingPeriodEndDate: undefined }; // ends 2025-07-01
  assert.strictEqual(inWaitingPeriod(policy, now), false);
  const days = daysUntilWaitingPeriodEnd(policy, now);
  assert.ok(days !== null && days < 0);
}
{
  // No waiting-period data at all → not "in" a waiting period (nothing to nudge about).
  const policy = { startDate: undefined, waitingPeriodMonths: undefined, waitingPeriodEndDate: undefined };
  assert.strictEqual(inWaitingPeriod(policy), false);
  assert.strictEqual(daysUntilWaitingPeriodEnd(policy), null);
}

// --- claimDeadlineFromDeath ---
{
  const deadline = claimDeadlineFromDeath('2026-01-10', 6);
  assert.ok(deadline);
  assert.strictEqual(deadline!.getFullYear(), 2026);
  assert.strictEqual(deadline!.getMonth(), 6); // July (0-indexed)
  assert.strictEqual(deadline!.getDate(), 10);
}
assert.strictEqual(claimDeadlineFromDeath('2026-01-10', undefined), null);
assert.strictEqual(claimDeadlineFromDeath('2026-01-10', 0), null);
assert.strictEqual(claimDeadlineFromDeath('not-a-date', 6), null);

// --- claimDeadlineLabel ---
assert.strictEqual(claimDeadlineLabel(6), 'Claim must be lodged within 6 months of death');
assert.strictEqual(claimDeadlineLabel(1), 'Claim must be lodged within 1 month of death');
assert.strictEqual(claimDeadlineLabel(undefined), null);
assert.strictEqual(claimDeadlineLabel(0), null);

console.log('funeralCover.test.ts: all assertions passed');
