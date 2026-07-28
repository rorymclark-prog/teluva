// Standalone assertion test for measurementUnits — no test runner is configured
// in this project (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/measurementUnits.test.ts
// It exits non-zero on failure.
import assert from 'node:assert';
import {
  toCanonicalHeightCm, toCanonicalWeightKg, fromCanonicalHeightCm, fromCanonicalWeightKg,
  unitSystemForCountry, heightUnitFor, weightUnitFor, shoeSystemForCountry,
} from './measurementUnits';

// Exact metric passthrough.
assert.strictEqual(toCanonicalHeightCm(122, 'cm'), 122);
assert.strictEqual(toCanonicalWeightKg(23.4, 'kg'), 23.4);

// Exact, deterministic imperial conversions — never model arithmetic. These
// two pairs are the same real-world measurement (a 51.6 lb / 23.4 kg scale
// reading; a 48 in / 121.9 cm growth-chart mark) used in the feasibility
// test images, so a mismatch here would mean the two units disagree on the
// same physical reading.
assert.strictEqual(toCanonicalHeightCm(48, 'in'), 121.9);
assert.strictEqual(toCanonicalWeightKg(51.6, 'lb'), 23.4);

// Round-trip back to display units.
assert.strictEqual(fromCanonicalHeightCm(121.9, 'in'), 48);
assert.strictEqual(fromCanonicalWeightKg(23.4, 'lb'), 51.6);
assert.strictEqual(fromCanonicalHeightCm(122, 'cm'), 122);
assert.strictEqual(fromCanonicalWeightKg(23.4, 'kg'), 23.4);

// Invalid input never silently becomes zero or NaN.
assert.strictEqual(toCanonicalHeightCm(0, 'cm'), null);
assert.strictEqual(toCanonicalHeightCm(-5, 'cm'), null);
assert.strictEqual(toCanonicalHeightCm(NaN, 'cm'), null);
assert.strictEqual(toCanonicalWeightKg(0, 'kg'), null);
assert.strictEqual(toCanonicalWeightKg(-1, 'lb'), null);

// Locale defaults — only the US is imperial among the app's supported countries.
assert.strictEqual(unitSystemForCountry('US'), 'imperial');
assert.strictEqual(unitSystemForCountry('AT'), 'metric');
assert.strictEqual(unitSystemForCountry('UK'), 'metric');
assert.strictEqual(unitSystemForCountry('ZA'), 'metric');
assert.strictEqual(unitSystemForCountry('other'), 'metric');
assert.strictEqual(unitSystemForCountry(undefined), 'metric');

assert.strictEqual(heightUnitFor('imperial'), 'in');
assert.strictEqual(heightUnitFor('metric'), 'cm');
assert.strictEqual(weightUnitFor('imperial'), 'lb');
assert.strictEqual(weightUnitFor('metric'), 'kg');

// Shoe-size system is a LABEL only (never a numeric conversion driver).
assert.strictEqual(shoeSystemForCountry('US'), 'US');
assert.strictEqual(shoeSystemForCountry('UK'), 'UK');
assert.strictEqual(shoeSystemForCountry('ZA'), 'UK');
assert.strictEqual(shoeSystemForCountry('AT'), 'EU');
assert.strictEqual(shoeSystemForCountry('other'), 'EU');
assert.strictEqual(shoeSystemForCountry(undefined), 'EU');

console.log('measurementUnits.test.ts: all assertions passed');
