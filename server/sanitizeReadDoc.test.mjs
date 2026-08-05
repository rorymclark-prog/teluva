/* sanitizeReadDoc decides whether the reader opens at all.
 *
 * When it returns null the user sees an assistant that says "I'll check your
 * lease" and then does nothing — no passages, no button, no error, nothing in
 * the logs. That silence is the reason this file exists: the function is the
 * single point where a document read can vanish, and until now nothing tested
 * it. The function is read out of the running server.js rather than copied, so
 * these cases cannot pass against a version of the code that no longer exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEligible } from './docRead.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const start = SRC.indexOf('function sanitizeReadDoc(');
assert.ok(start > 0, 'sanitizeReadDoc not found in server.js');
const rest = SRC.slice(start);
const fnSrc = rest.slice(0, rest.indexOf('\n}\n') + 3);

const FEATURE_INSURANCE_READER = false;
// eslint-disable-next-line no-eval
const sanitizeReadDoc = eval(`(${fnSrc.replace('function sanitizeReadDoc', 'function')})`);
void isEligible; void FEATURE_INSURANCE_READER;   // closed over by the evaluated source

const LEASE = { id: '1785493248830419', name: 'Home Lease Agreement - Treustraße 54', category: 'Legal' };
const DOCS = [LEASE, { id: '1781850807102478', name: 'Rory Clark - Rosuvastatin HCS Medication', category: 'Medical' }];
const ask = (raw, docs = DOCS, space = 'family') => sanitizeReadDoc(raw, docs, space);

test('an exact id resolves', () => {
  assert.equal(ask({ id: LEASE.id, name: 'whatever', question: 'q' })?.id, LEASE.id);
});

test('a WRONG id with the right name still resolves', () => {
  // Vault ids are 16 digits minted from Date.now(). One transposed digit used
  // to mean the reader silently never opened — which is indistinguishable, to
  // the person holding the phone, from the feature being broken.
  const out = ask({ id: '1785493248830491', name: LEASE.name, question: 'q' });
  assert.equal(out?.id, LEASE.id, 'falls back to the name');
});

test('the returned id is the vault\'s, never the model\'s', () => {
  // The client looks the document up by this id; echoing back a mangled one
  // would move the failure downstream instead of fixing it.
  assert.equal(ask({ id: 'not-an-id', name: '  home lease agreement - Treustraße 54 ', question: 'q' })?.id, LEASE.id);
});

test('case folding does not have to survive ß — the name match is a bonus, not the contract', () => {
  // "TREUSTRASSE" is the correct uppercase of "Treustraße", and lowercasing it
  // back gives "strasse", not "straße". So a name mangled through case DOESN'T
  // resolve, and that is fine: the id is still the primary key and this
  // fallback exists only for the digit-transposition case. Recorded as a test
  // so nobody later "fixes" it with a fuzzy match — a fuzzy match here would
  // let the model open the wrong document, which is far worse than opening none.
  assert.equal(ask({ id: 'nope', name: 'HOME LEASE AGREEMENT - TREUSTRASSE 54', question: 'q' }), null);
});

test('a document the client never sent is still refused', () => {
  // The whole security property: the candidate list is only ever the documents
  // THIS request carried, so the model cannot name a file the user lacks.
  assert.equal(ask({ id: 'x', name: "Somebody Else's Lease", question: 'q' }), null);
  assert.equal(ask({ id: LEASE.id, name: LEASE.name, question: 'q' }, []), null);
});

test('the medical and business gates are not bypassed by the name fallback', () => {
  assert.equal(ask({ id: 'wrong', name: 'Rory Clark - Rosuvastatin HCS Medication', question: 'q' }), null);
  assert.equal(ask({ id: LEASE.id, name: LEASE.name, question: 'q' }, DOCS, 'business'), null);
});

test('a question is carried through whole, not truncated to a keyword', () => {
  const q = 'under what conditions can I call an electrician or plumber for repairs, and who pays for it';
  assert.equal(ask({ id: LEASE.id, name: LEASE.name, question: q })?.question, q);
});
