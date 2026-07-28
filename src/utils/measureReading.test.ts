// Standalone assertion test for measureReading — run directly:
//   npx tsx src/utils/measureReading.test.ts
import assert from 'node:assert';
import { isInterpolatedSource } from './measureReading';

// The two "interpolating a mark" source kinds — the ones the model was caught
// self-reporting "high" confidence on while being a centimetre off a real
// photo's true mark. These must always be treated as needing a manual check.
assert.strictEqual(isInterpolatedSource('ruler_or_growth_chart'), true);
assert.strictEqual(isInterpolatedSource('tape_measure'), true);

// Reading a printed/displayed digit is a different, more reliable class.
assert.strictEqual(isInterpolatedSource('scale'), false);
assert.strictEqual(isInterpolatedSource('size_label'), false);
assert.strictEqual(isInterpolatedSource('unknown'), false);

console.log('measureReading.test.ts: all assertions passed');
