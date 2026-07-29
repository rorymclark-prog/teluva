// Standalone assertion test for referralGrouping.ts — no test runner is
// configured in this project (package.json has only vite/tsc scripts), so
// run it directly:
//   npx tsx src/utils/referralGrouping.test.ts
// It exits non-zero on failure. Mirrors readiness.test.ts's convention.
import assert from 'node:assert';
import { normalizeTestKey, buildReferralGroups, ReferralSeries, ReferralSingle } from './referralGrouping';
import { ReferralRecord } from '../types';

function rec(overrides: Partial<ReferralRecord> = {}): ReferralRecord {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    kind: 'Lab result',
    fileName: 'scan.jpg',
    fileType: 'image/jpeg',
    fileSize: 1000,
    storagePath: 'p',
    downloadUrl: 'https://example.com/x',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/* ---------------- normalizeTestKey ---------------- */

// Same test, different capitalization/punctuation/whitespace → same key.
assert.strictEqual(normalizeTestKey('Annual bloods'), normalizeTestKey('annual bloods'));
assert.strictEqual(normalizeTestKey('Annual bloods'), normalizeTestKey('ANNUAL BLOODS'));
assert.strictEqual(normalizeTestKey('Annual bloods'), normalizeTestKey('Annual, bloods!'));
assert.strictEqual(normalizeTestKey('Annual bloods'), normalizeTestKey('  Annual   bloods  '));
assert.strictEqual(normalizeTestKey('Annual bloods'), normalizeTestKey('Annual bloods.'));
assert.strictEqual(normalizeTestKey('HbA1c'), normalizeTestKey('hba1c'));

// Leading/trailing year is stripped so the same recurring test groups across years.
assert.strictEqual(normalizeTestKey('2024 Annual bloods'), normalizeTestKey('Annual bloods'));
assert.strictEqual(normalizeTestKey('Annual bloods 2025'), normalizeTestKey('Annual bloods'));
assert.strictEqual(normalizeTestKey('2024 Annual bloods'), normalizeTestKey('Annual bloods 2026'));
// A year embedded mid-string is NOT a leading/trailing token — left alone,
// so it still normalizes consistently with itself but not with the bare form.
assert.strictEqual(normalizeTestKey('Annual 2024 bloods'), normalizeTestKey('annual 2024 bloods'));

// Genuinely different tests must NOT collapse into the same key.
assert.notStrictEqual(normalizeTestKey('Right knee'), normalizeTestKey('Left knee'));
assert.notStrictEqual(normalizeTestKey('HbA1c'), normalizeTestKey('Lipid panel'));
assert.notStrictEqual(normalizeTestKey('Annual bloods'), normalizeTestKey('Bloods'));
assert.notStrictEqual(normalizeTestKey('Annual bloods'), normalizeTestKey('annual blood test'));

// Empty/missing reason never produces a truthy key.
assert.strictEqual(normalizeTestKey(undefined), '');
assert.strictEqual(normalizeTestKey(null), '');
assert.strictEqual(normalizeTestKey(''), '');
assert.strictEqual(normalizeTestKey('   '), '');
assert.strictEqual(normalizeTestKey('...'), '');

console.log('referralGrouping.test.ts: normalizeTestKey assertions passed');

/* ---------------- buildReferralGroups ---------------- */

function seriesFor(items: ReturnType<typeof buildReferralGroups>, key: string): ReferralSeries {
  const found = items.find((i) => i.type === 'series' && i.key.includes(key));
  assert.ok(found && found.type === 'series', `expected a series matching "${key}"`);
  return found as ReferralSeries;
}

// --- Three same-named lab results across years group into one series, most-recent-first ---
{
  const r1 = rec({ id: 'r1', kind: 'Lab result', reason: 'Annual bloods', date: '2024-03-01' });
  const r2 = rec({ id: 'r2', kind: 'Lab result', reason: 'Annual bloods', date: '2025-03-05' });
  const r3 = rec({ id: 'r3', kind: 'Lab result', reason: 'annual bloods!', date: '2026-03-02' });
  const items = buildReferralGroups([r1, r2, r3]);
  assert.strictEqual(items.length, 1);
  const s = seriesFor(items, 'annual bloods');
  assert.strictEqual(s.records.length, 3);
  assert.deepStrictEqual(s.records.map((r) => r.id), ['r3', 'r2', 'r1']); // newest first
  assert.strictEqual(s.kind, 'Lab result');
}

// --- A single lab result with a reason is NOT forced into a series-of-1 UI ---
{
  const r1 = rec({ id: 'solo', kind: 'Lab result', reason: 'Vitamin D', date: '2026-01-10' });
  const items = buildReferralGroups([r1]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].type, 'single');
  assert.strictEqual((items[0] as ReferralSingle).record.id, 'solo');
}

// --- Genuinely different tests must not be merged into one series ---
{
  const hba1c1 = rec({ id: 'a1', kind: 'Lab result', reason: 'HbA1c', date: '2025-01-01' });
  const hba1c2 = rec({ id: 'a2', kind: 'Lab result', reason: 'HbA1c', date: '2026-01-01' });
  const lipid1 = rec({ id: 'b1', kind: 'Lab result', reason: 'Lipid panel', date: '2025-06-01' });
  const lipid2 = rec({ id: 'b2', kind: 'Lab result', reason: 'Lipid panel', date: '2026-06-01' });
  const items = buildReferralGroups([hba1c1, hba1c2, lipid1, lipid2]);
  const seriesItems = items.filter((i) => i.type === 'series') as ReferralSeries[];
  assert.strictEqual(seriesItems.length, 2);
  assert.ok(seriesItems.every((s) => s.records.length === 2));
}

// --- Same reason, different kind (Lab result vs Imaging) must NOT group together ---
{
  const lab = rec({ id: 'l1', kind: 'Lab result', reason: 'Right knee', date: '2026-01-01' });
  const img1 = rec({ id: 'i1', kind: 'Imaging', reason: 'Right knee', date: '2025-01-01' });
  const img2 = rec({ id: 'i2', kind: 'Imaging', reason: 'Right knee', date: '2026-02-01' });
  const items = buildReferralGroups([lab, img1, img2]);
  const seriesItems = items.filter((i) => i.type === 'series') as ReferralSeries[];
  assert.strictEqual(seriesItems.length, 1); // only the two Imaging records
  assert.strictEqual(seriesItems[0].kind, 'Imaging');
  assert.strictEqual(seriesItems[0].records.length, 2);
  const singleItems = items.filter((i) => i.type === 'single') as ReferralSingle[];
  assert.ok(singleItems.some((i) => i.record.id === 'l1'));
}

// --- Repeat Imaging of the same body part groups; unrelated Imaging doesn't ---
{
  const knee1 = rec({ id: 'k1', kind: 'Imaging', reason: 'Right knee X-ray', date: '2025-04-01' });
  const knee2 = rec({ id: 'k2', kind: 'Imaging', reason: 'Right knee X-ray', date: '2026-04-01' });
  const chest = rec({ id: 'c1', kind: 'Imaging', reason: 'Chest X-ray', date: '2026-05-01' });
  const items = buildReferralGroups([knee1, knee2, chest]);
  const seriesItems = items.filter((i) => i.type === 'series') as ReferralSeries[];
  assert.strictEqual(seriesItems.length, 1);
  assert.strictEqual(seriesItems[0].records.length, 2);
  const singleItems = items.filter((i) => i.type === 'single') as ReferralSingle[];
  assert.strictEqual(singleItems.length, 1);
  assert.strictEqual(singleItems[0].record.id, 'c1');
}

// --- Ungroupable kinds (Referral, Specialist letter, Sick note, Other) never group,
//     even with an identical reason string repeated ---
{
  const s1 = rec({ id: 's1', kind: 'Sick note', reason: 'Flu', date: '2025-01-01' });
  const s2 = rec({ id: 's2', kind: 'Sick note', reason: 'Flu', date: '2026-01-01' });
  const ref1 = rec({ id: 'ref1', kind: 'Referral', reason: 'Right knee', date: '2025-01-01' });
  const ref2 = rec({ id: 'ref2', kind: 'Referral', reason: 'Right knee', date: '2026-01-01' });
  const items = buildReferralGroups([s1, s2, ref1, ref2]);
  assert.ok(items.every((i) => i.type === 'single'));
  assert.strictEqual(items.length, 4);
}

// --- Missing/empty reason never groups, even across identical-kind records ---
{
  const noReason1 = rec({ id: 'n1', kind: 'Lab result', date: '2025-01-01' });
  const noReason2 = rec({ id: 'n2', kind: 'Lab result', date: '2026-01-01' });
  const items = buildReferralGroups([noReason1, noReason2]);
  assert.ok(items.every((i) => i.type === 'single'));
  assert.strictEqual(items.length, 2);
}

// --- Records without a `date` fall back to `addedAt` for sort order, both within a
//     series and for the overall newest-first ordering ---
{
  const older = rec({ id: 'old', kind: 'Lab result', reason: 'Thyroid panel', addedAt: '2025-01-01T00:00:00.000Z' });
  const newer = rec({ id: 'new', kind: 'Lab result', reason: 'Thyroid panel', addedAt: '2026-01-01T00:00:00.000Z' });
  const items = buildReferralGroups([older, newer]);
  const s = seriesFor(items, 'thyroid panel');
  assert.deepStrictEqual(s.records.map((r) => r.id), ['new', 'old']);
}

// --- Overall ordering interleaves series and singles by most-recent date, newest first ---
{
  const oldSeriesA = rec({ id: 'sa1', kind: 'Lab result', reason: 'Iron panel', date: '2024-01-01' });
  const oldSeriesB = rec({ id: 'sa2', kind: 'Lab result', reason: 'Iron panel', date: '2024-06-01' });
  const midSingle = rec({ id: 'single-mid', kind: 'Sick note', reason: 'Flu', date: '2025-01-01' });
  const newSingle = rec({ id: 'single-new', kind: 'Referral', reason: 'Dermatology', date: '2026-06-01' });
  const items = buildReferralGroups([oldSeriesA, oldSeriesB, midSingle, newSingle]);
  const labels = items.map((i) => (i.type === 'single' ? i.record.id : `series:${i.records[0].id}`));
  assert.deepStrictEqual(labels, ['single-new', 'single-mid', 'series:sa2']);
}

console.log('referralGrouping.test.ts: buildReferralGroups assertions passed');
console.log('referralGrouping.test.ts: all assertions passed');
