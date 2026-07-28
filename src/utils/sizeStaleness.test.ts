// Standalone assertion test for sizeStaleness — run directly:
//   npx tsx src/utils/sizeStaleness.test.ts
import assert from 'node:assert';
import { staleSizeThresholdMonths, sizeStaleness } from './sizeStaleness';

// Threshold bands scale with age.
assert.strictEqual(staleSizeThresholdMonths(0), 3);
assert.strictEqual(staleSizeThresholdMonths(1.9), 3);
assert.strictEqual(staleSizeThresholdMonths(2), 6);
assert.strictEqual(staleSizeThresholdMonths(5), 6);
assert.strictEqual(staleSizeThresholdMonths(6), 12);
assert.strictEqual(staleSizeThresholdMonths(17), 12);
assert.strictEqual(staleSizeThresholdMonths(18), 36);
assert.strictEqual(staleSizeThresholdMonths(40), 36);

// No birthdate -> never flagged, no matter how old the sizes are.
assert.strictEqual(sizeStaleness({ tops: 'EU 116', lastUpdated: '2020-01-01' }, undefined, '2026-07-28').stale, false);

// No sizes recorded at all -> nothing to go stale about.
assert.strictEqual(sizeStaleness({}, '2019-01-01', '2026-07-28').stale, false);
assert.strictEqual(sizeStaleness(undefined, '2019-01-01', '2026-07-28').stale, false);

// A toddler (age 2, threshold 6 months): 5 months ago is fresh, 7 is stale.
const toddlerBirth = '2024-07-28'; // exactly 2 years before the "today" used below
assert.strictEqual(
  sizeStaleness({ tops: 'EU 92', lastUpdated: '2026-02-28' }, toddlerBirth, '2026-07-28').stale, // ~5 months
  false,
);
assert.strictEqual(
  sizeStaleness({ tops: 'EU 92', lastUpdated: '2025-12-28' }, toddlerBirth, '2026-07-28').stale, // 7 months
  true,
);

// An adult (threshold 36 months): 2 years ago is fresh, 4 years is stale.
const adultBirth = '1985-01-01';
assert.strictEqual(
  sizeStaleness({ shoes: 'EU 43', lastUpdated: '2024-07-28' }, adultBirth, '2026-07-28').stale,
  false,
);
assert.strictEqual(
  sizeStaleness({ shoes: 'EU 43', lastUpdated: '2022-07-28' }, adultBirth, '2026-07-28').stale,
  true,
);

// Sizes recorded but never updated (no lastUpdated at all) -> treated as stale.
const neverUpdated = sizeStaleness({ tops: 'EU 116' }, '2018-01-01', '2026-07-28');
assert.strictEqual(neverUpdated.stale, true);
assert.strictEqual(neverUpdated.monthsSince, null);
assert.strictEqual(neverUpdated.thresholdMonths, 12); // age 8 -> 6-17y band

console.log('sizeStaleness.test.ts: all assertions passed');
