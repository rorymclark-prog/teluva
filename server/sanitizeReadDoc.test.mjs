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

/* The two scope flags the evaluated source closes over.
 *
 * Declared as `let` and driven by the helper below rather than fixed, because
 * a suite that only ever exercises the CLOSED posture is testing a
 * configuration production does not run: both of these are "1" in
 * run-service.yaml. The gate has to be proven in both states — closed, so the
 * refusal is real, and open, so the flag is genuinely the thing deciding and
 * not a category check that denies regardless. */
let FEATURE_INSURANCE_READER = false;
let FEATURE_MEDICAL_READER = false;
// eslint-disable-next-line no-eval
const sanitizeReadDoc = eval(`(${fnSrc.replace('function sanitizeReadDoc', 'function')})`);
void isEligible; void FEATURE_INSURANCE_READER; void FEATURE_MEDICAL_READER;   // closed over by the evaluated source

/** Run `fn` with the reader flags set, then put them back however it exits. */
function withFlags({ insurance = false, medical = false }, fn) {
  const prevI = FEATURE_INSURANCE_READER;
  const prevM = FEATURE_MEDICAL_READER;
  FEATURE_INSURANCE_READER = insurance;
  FEATURE_MEDICAL_READER = medical;
  try { return fn(); } finally {
    FEATURE_INSURANCE_READER = prevI;
    FEATURE_MEDICAL_READER = prevM;
  }
}

const LEASE = { id: '1785493248830419', name: 'Home Lease Agreement - Treustraße 54', category: 'Legal' };
const DOCS = [LEASE, { id: '1781850807102478', name: 'Rory Clark - Rosuvastatin HCS Medication', category: 'Medical' }];
const ask = (raw, docs = DOCS, space = 'family') => sanitizeReadDoc(raw, docs, space);

test('an exact id resolves', () => {
  assert.equal(ask({ id: LEASE.id, name: 'whatever', question: 'q' })?.id, LEASE.id);
});

test('the profile "doc-" id resolves to the vault document', () => {
  /* THE ACTUAL PRODUCTION FAILURE, from the logs:
   *   readDoc DROPPED: id "doc-1785493248830419" ... match none of the 19 sent
   * One file, two ids: the vault list has "1785493248830419" and the owner's
   * profile has "doc-1785493248830419". The model quoted the profile one — the
   * more specific, person-attached form — and the read silently never ran. The
   * user saw "I'll check your Home Lease Agreement" and then nothing, for days.
   */
  assert.equal(ask({ id: `doc-${LEASE.id}`, question: 'q' })?.id, LEASE.id);
});

test('a "doc-" id for a document not in the list is still refused', () => {
  assert.equal(ask({ id: 'doc-9999999999999999', question: 'q' }), null);
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
  withFlags({ medical: false }, () => {
    assert.equal(ask({ id: 'wrong', name: 'Rory Clark - Rosuvastatin HCS Medication', question: 'q' }), null);
  });
  // Business is not a flag and never opens — it is checked before anything
  // else and holds whatever the two reader flags are set to.
  withFlags({ insurance: true, medical: true }, () => {
    assert.equal(ask({ id: LEASE.id, name: LEASE.name, question: 'q' }, DOCS, 'business'), null);
  });
});

test('the medical gate follows FEATURE_MEDICAL_READER in BOTH directions', () => {
  const med = DOCS[1];
  // Closed: the refusal above is real.
  withFlags({ medical: false }, () => {
    assert.equal(ask({ id: med.id, name: med.name, question: 'q' }), null, 'flag off denies');
  });
  /* Open — and this is the assertion that matters, because it is the
   * configuration production actually runs (FEATURE_MEDICAL_READER=1 in
   * run-service.yaml). Without it the suite would pass identically against a
   * server that denied every medical document no matter what the flag said,
   * and the feature would have been "shipped" while being off. */
  withFlags({ medical: true }, () => {
    assert.equal(ask({ id: med.id, name: med.name, question: 'q' })?.id, med.id, 'flag on admits');
  });
});

test('a question is carried through whole, not truncated to a keyword', () => {
  const q = 'under what conditions can I call an electrician or plumber for repairs, and who pays for it';
  assert.equal(ask({ id: LEASE.id, name: LEASE.name, question: q })?.question, q);
});
