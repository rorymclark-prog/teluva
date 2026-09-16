import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_FACT_LABELS, keyFactsSystem, sanitizeKeyFacts } from './keyFacts.mjs';

const POLICY = `
Allianz Travel — Schutzbrief
Policy number: AT-2026-0093481
In an emergency call our 24-hour assistance line: +43 1 525 03-0
When calling, quote reference KL/889-771.
Valid from 01.09.2026 until 30.09.2026
`;

test('keeps facts that are verbatim in the document, tagged from the closed list', () => {
  const out = sanitizeKeyFacts({ facts: [
    { label: 'Policy or booking number', value: 'AT-2026-0093481' },
    { label: 'Reference to quote', value: 'KL/889-771' },
    { label: 'Provider / issuer', value: 'Allianz Travel' },
  ] }, POLICY, true);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { label: 'Policy or booking number', value: 'AT-2026-0093481', verified: true });
});

test('a paraphrase, a verdict, or an unknown label cannot survive', () => {
  const out = sanitizeKeyFacts({ facts: [
    // not in the document — the model "helpfully" reformatted the dates
    { label: 'Valid from', value: '1 September 2026' },
    // interpretation smuggled under a valid label
    { label: 'Amount', value: 'You are fully covered for medical costs' },
    // label not in the closed list
    { label: 'Coverage verdict', value: 'AT-2026-0093481' },
  ] }, POLICY, true);
  assert.deepEqual(out, []);
});

test('phone numbers match on digits, surviving re-punctuation', () => {
  const out = sanitizeKeyFacts({ facts: [
    { label: '24/7 emergency line', value: '+43 1 525 030' },     // dash moved by the model
    { label: 'Phone number', value: '+43 1 525 99-0' },           // digits NOT in the doc
  ] }, POLICY, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, '24/7 emergency line');
});

test('whitespace differences do not kill a real fact', () => {
  const out = sanitizeKeyFacts({ facts: [
    { label: 'Reference to quote', value: 'KL/889-771.' },
  ] }, POLICY.replace('KL/889-771', 'KL/889-771.\n'), true);
  assert.equal(out.length, 1);
});

test('OCR-sourced facts are marked unverified; dupes and overflow are trimmed', () => {
  const facts = Array.from({ length: 20 }, () => ({ label: 'Reference to quote', value: 'KL/889-771' }));
  const out = sanitizeKeyFacts({ facts }, POLICY, false);
  assert.equal(out.length, 1, 'identical facts collapse to one');
  assert.equal(out[0].verified, false);
});

test('garbage shapes return an empty list, never throw', () => {
  assert.deepEqual(sanitizeKeyFacts(null, POLICY, true), []);
  assert.deepEqual(sanitizeKeyFacts({ facts: 'nope' }, POLICY, true), []);
  assert.deepEqual(sanitizeKeyFacts({ facts: [{ label: 42, value: {} }] }, POLICY, true), []);
});

test('the system prompt names every allowed label', () => {
  const sys = keyFactsSystem();
  for (const label of KEY_FACT_LABELS) assert.ok(sys.includes(`"${label}"`), label);
});

test('passport numbers have their own label and the prompt outlaws the mislabels seen live', () => {
  // Live extraction filed a passport number quoted in a consent affidavit as
  // "Policy or booking number" and truncated "BEN JAMES CLARK" to "BEN
  // ROHAN" — both wrong LABELS or partial values the substring filter cannot
  // catch, so the prompt must prevent them at generation.
  const out = sanitizeKeyFacts(
    { facts: [{ label: 'Passport or ID number', value: 'A98871203' }] },
    'holder of South African Passport No: A98871203, hereby consent',
    true,
  );
  assert.deepEqual(out, [{ label: 'Passport or ID number', value: 'A98871203', verified: true }]);
  const sys = keyFactsSystem();
  assert.ok(sys.includes('NEVER a "Policy or booking number"'), 'the passport-vs-policy rule is stated');
  assert.ok(sys.includes('all given names AND all surnames'), 'the complete-name rule is stated');
});

test('a name joined from separate Surname/Name form fields survives; an invented word never does', () => {
  // The SA consent affidavit prints "Surname: CLARK" and "Name: BEN JAMES"
  // as separate fields — the full name exists nowhere as one string, so the
  // verbatim filter would kill the joined name the prompt now asks for.
  // Names get a word-level check instead: every word must be printed.
  const AFFIDAVIT = 'Annexure C. Surname: CLARK  Name: BEN JAMES  Date of birth 22/06/2013';
  const out = sanitizeKeyFacts(
    { facts: [
      { label: 'Name on the document', value: 'BEN JAMES CLARK' },
      // a word NOT printed anywhere → dies even under the relaxed check
      { label: 'Name on the document', value: 'BEN JAMES SMITH' },
      // the relaxation is for names ONLY — recombined words under any other
      // label still face the verbatim filter
      { label: 'Reference to quote', value: 'CLARK 2012' },
    ] },
    AFFIDAVIT,
    true,
  );
  assert.deepEqual(out, [{ label: 'Name on the document', value: 'BEN JAMES CLARK', verified: true }]);
  assert.ok(keyFactsSystem().includes('separate fields, join them into one full name'),
    'the join rule is stated so the model produces the joined name at all');
});

const AFFIDAVIT = `
PARENTAL CONSENT AFFIDAVIT
Child: BEN JAMES CLARK, passport A77410256
Mother: Nomsa Poe, contact +27 84 555 0142
Father: Rory Clark, contact +43 660 555 0148
`;

test('who survives only when the document itself prints it', () => {
  const out = sanitizeKeyFacts({ facts: [
    { label: 'Phone number', value: '+27 84 555 0142', who: 'Mother' },
    // the model concluding whose number it is, with a word the document
    // never prints — the fact survives, the attribution dies
    { label: 'Phone number', value: '+43 660 555 0148', who: 'Dad' },
  ] }, AFFIDAVIT, true);
  assert.equal(out.length, 2);
  assert.equal(out[0].who, 'Mother');
  assert.equal(out[1].who, undefined, 'an attribution the document does not print is dropped');
});

test('a fact without who stays exactly as before', () => {
  const out = sanitizeKeyFacts({ facts: [
    { label: 'Passport or ID number', value: 'A77410256' },
  ] }, AFFIDAVIT, true);
  assert.deepEqual(out, [{ label: 'Passport or ID number', value: 'A77410256', verified: true }]);
});
