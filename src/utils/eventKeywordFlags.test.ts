// Standalone assertion test for eventKeywordFlags.ts — same convention as
// eventRelevance.test.ts:
//   npx tsx src/utils/eventKeywordFlags.test.ts
// It exits non-zero on failure.
//
// Covers Rory's 2026-08-19 ask: a diabetes-sensor calendar reminder, typed
// in his own obscure shorthand, never surfaced on the Medical checks panel.
// The bar here is recall — a real medical/anniversary event must be caught
// even when worded briefly or in German — with a few explicit checks that
// the word-boundary matching doesn't fire on unrelated words that merely
// contain a keyword as a substring.
import assert from 'node:assert';
import { isMedicalFlaggedEvent, isAnniversaryFlaggedEvent, MEDICAL_KEYWORDS, ANNIVERSARY_KEYWORDS } from './eventKeywordFlags';

// ── medical: obscure/short real-world phrasing must still be caught ────────
{
  assert.ok(isMedicalFlaggedEvent({ title: 'Sensor' }), 'a bare "Sensor" title must be flagged medical — Rory\'s own example');
  assert.ok(isMedicalFlaggedEvent({ title: 'change sensor' }), '"change sensor" must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Dexcom' }), 'a bare brand name must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Libre swap' }), '"Libre swap" must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Ganga - pod change' }), '"pod change" (Omnipod) must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Mia', description: 'blood sugar check before school' }), 'a match in description alone must be flagged, not just title');
  assert.ok(isMedicalFlaggedEvent({ title: 'HbA1c' }), 'HbA1c abbreviation must be flagged');
}

// ── medical: general appointment vocabulary ─────────────────────────────────
{
  assert.ok(isMedicalFlaggedEvent({ title: "Ganga's dentist" }), 'dentist must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Flu jab' }), 'flu jab must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Eye test' }), 'eye test must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'GP appointment' }), 'GP appointment must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'MRI scan' }), 'MRI must be flagged');
}

// ── medical: Austrian/German vocabulary (Rory is in Vienna) ────────────────
{
  assert.ok(isMedicalFlaggedEvent({ title: 'Zahnarzt Termin' }), 'Zahnarzt (dentist) must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Hausärztin' }), 'Hausärztin must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Impftermin Ganga' }), 'Impftermin (vaccination appointment) must be flagged');
  assert.ok(isMedicalFlaggedEvent({ title: 'Blutabnahme' }), 'Blutabnahme (blood draw) must be flagged');
}

// ── medical: word-boundary correctness — no false positives from substrings ─
{
  assert.ok(!isMedicalFlaggedEvent({ title: 'Enter the competition' }), '"Enter" must not match "ent" as a substring');
  assert.ok(!isMedicalFlaggedEvent({ title: 'Book the GPS for the trip' }), '"GPS" must not match "gp" as a substring');
  assert.ok(!isMedicalFlaggedEvent({ title: 'Team offsite' }), 'an unrelated work event must not be flagged');
  assert.ok(!isMedicalFlaggedEvent({ title: '' }), 'an empty title must not be flagged');
  assert.ok(!isMedicalFlaggedEvent({}), 'an event with neither title nor description must not throw or match');
}

// ── medical: case-insensitivity ─────────────────────────────────────────────
{
  assert.ok(isMedicalFlaggedEvent({ title: 'DIABETES CHECK' }), 'matching must be case-insensitive');
  assert.ok(isMedicalFlaggedEvent({ title: 'sensor' }), 'lowercase must match too');
}

// ── anniversary: phrase vs. bare-word discipline ────────────────────────────
{
  assert.ok(isAnniversaryFlaggedEvent({ title: 'Our anniversary' }), 'anniversary must be flagged');
  assert.ok(isAnniversaryFlaggedEvent({ title: "Valentine's Day" }), "Valentine's Day (with apostrophe) must be flagged");
  assert.ok(isAnniversaryFlaggedEvent({ title: 'Valentines Day' }), 'Valentines Day (no apostrophe) must be flagged too');
  assert.ok(isAnniversaryFlaggedEvent({ title: "Mother's Day" }), "Mother's Day must be flagged");
  assert.ok(isAnniversaryFlaggedEvent({ title: "Father's Day brunch" }), "Father's Day must be flagged");
  assert.ok(isAnniversaryFlaggedEvent({ title: "New Year's Eve party" }), "New Year's Eve must be flagged");
  assert.ok(isAnniversaryFlaggedEvent({ title: 'Hochzeitstag' }), 'Hochzeitstag (German wedding anniversary) must be flagged');
  // "mother"/"father" alone are deliberately excluded — see the comment in
  // eventKeywordFlags.ts — precisely so this doesn't fire on everyday mentions.
  assert.ok(!isAnniversaryFlaggedEvent({ title: 'Call mother' }), '"mother" alone must NOT be flagged — too broad');
  assert.ok(!isAnniversaryFlaggedEvent({ title: "Mother's group meetup" }), '"mother\'s" without "day" must NOT be flagged');
}

// ── keyword lists themselves are non-trivial and non-empty ─────────────────
{
  assert.ok(MEDICAL_KEYWORDS.length > 50, 'the medical keyword list must be genuinely extensive, not a handful of terms');
  assert.ok(ANNIVERSARY_KEYWORDS.length >= 8, 'the anniversary keyword list must cover the named occasions');
}

console.log('eventKeywordFlags.test.ts: all assertions passed');
