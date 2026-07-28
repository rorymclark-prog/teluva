// Standalone assertion test for getEmergencyNumbers — no test runner is
// configured in this project (package.json has only vite/tsc scripts), so
// run it directly:
//   npx tsx src/utils/emergencyNumbers.test.ts
// It exits non-zero on failure.
import assert from 'node:assert';
import { getEmergencyNumbers } from './emergencyNumbers';

// UK: 999 primary, 112 also works.
const uk = getEmergencyNumbers('UK');
assert.deepStrictEqual(uk.numbers.map((n) => n.number), ['999', '112']);
assert.strictEqual(uk.note, undefined);

// South Africa: 112 (mobile), 10111 police, 10177 ambulance — all present.
const za = getEmergencyNumbers('ZA');
assert.deepStrictEqual(za.numbers.map((n) => n.number), ['112', '10111', '10177']);

// USA: 911 only.
const us = getEmergencyNumbers('US');
assert.deepStrictEqual(us.numbers.map((n) => n.number), ['911']);

// Austria: ambulance/police/fire + EU-wide 112, all four present.
const at = getEmergencyNumbers('AT');
assert.deepStrictEqual(at.numbers.map((n) => n.number), ['144', '133', '122', '112']);

// 'other' and unset/unknown must NEVER show nothing — fall back to 112 with
// a note explaining why (this is the safety-critical case: no country set).
const other = getEmergencyNumbers('other');
assert.deepStrictEqual(other.numbers.map((n) => n.number), ['112']);
assert.ok(other.note && other.note.includes('112'));

const unset = getEmergencyNumbers(undefined);
assert.deepStrictEqual(unset.numbers.map((n) => n.number), ['112']);
assert.ok(unset.note);

const garbage = getEmergencyNumbers('not-a-real-country');
assert.deepStrictEqual(garbage.numbers.map((n) => n.number), ['112']);

console.log('emergencyNumbers.test.ts: all assertions passed');
