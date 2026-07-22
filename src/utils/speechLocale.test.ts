// Standalone assertion test for speechLocaleFor — no test runner is configured
// in this project (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/speechLocale.test.ts
// It exits non-zero on failure.
import assert from 'node:assert';
import { speechLocaleFor } from './speechLocale';

// Every known LangCode maps to its BCP-47 speech locale.
assert.strictEqual(speechLocaleFor('en'), 'en-US');
assert.strictEqual(speechLocaleFor('de'), 'de-AT'); // Vienna → Austrian German
assert.strictEqual(speechLocaleFor('es'), 'es-ES');
assert.strictEqual(speechLocaleFor('fr'), 'fr-FR');
assert.strictEqual(speechLocaleFor('pt'), 'pt-PT');
assert.strictEqual(speechLocaleFor('it'), 'it-IT');
assert.strictEqual(speechLocaleFor('nl'), 'nl-NL');
assert.strictEqual(speechLocaleFor('pl'), 'pl-PL');
assert.strictEqual(speechLocaleFor('af'), 'af-ZA');

// Unknown code returns the caller-supplied fallback (the browser default).
assert.strictEqual(speechLocaleFor('xx', 'fr-CA'), 'fr-CA');
assert.strictEqual(speechLocaleFor('', 'de-DE'), 'de-DE');

// Default fallback is en-US when none is passed.
assert.strictEqual(speechLocaleFor('xx'), 'en-US');
assert.strictEqual(speechLocaleFor('zz'), 'en-US');

console.log('speechLocale.test.ts: all assertions passed');
