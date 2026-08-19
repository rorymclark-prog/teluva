// Flags free-text CalendarEvents into the Family Calendar's "quick view"
// panels (Medical checks, Anniversaries & special days) even when the event
// was never given the matching category, or has no structured record behind
// it at all.
//
// Built 2026-08-19: Rory typed a diabetes-sensor reminder straight into the
// calendar in his own shorthand and it never showed up on Medical checks —
// that panel only ever reads careSchedule[]/referrals[] (see
// buildCalendarMedicalChecks in familyDates.ts), so a hand-typed
// CalendarEvent had nowhere to be recognised no matter its wording, however
// obviously medical a person would find it.
//
// This is a RECALL-first keyword net, not a precision-first classifier: a
// false positive (an unrelated event shows up under Medical checks once)
// costs a glance; a false negative (a real medical reminder stays invisible)
// is the exact failure this exists to prevent. When extending these lists,
// err on the side of adding a term rather than leaving one out — EXCEPT for
// a bare word that is common outside a medical/anniversary context (e.g.
// "mother", "check", "pump" alone), where a full phrase is used instead to
// keep the panel from filling with noise.
//
// Matching is whole-word/whole-phrase (word-boundary regex, so "ent" never
// matches inside "enter"), case-insensitive, against both an event's title
// AND its description — not a plain .includes(), which would also catch
// "ENT" inside "ENTITLEMENT" or "GP" inside "GPS".

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(keywords: readonly string[]): (text: string | undefined) => boolean {
  const pattern = keywords.map((k) => escapeRegExp(k).replace(/\s+/g, '\\s+')).join('|');
  const re = new RegExp(`\\b(?:${pattern})\\b`, 'i');
  return (text) => !!text && re.test(text);
}

// --- Medical ----------------------------------------------------------------

// Rory's own example: a diabetes device reminder, written obscurely. Brand
// names and short device words are kept even where they're a little
// ambiguous ("sensor" alone can mean a smart-home sensor too) because a
// missed medical reminder is the worse failure of the two.
const DIABETES_KEYWORDS = [
  'diabetes', 'diabetic', 'insulin', 'glucose', 'blood sugar', 'blood glucose',
  'glucometer', 'glucose meter', 'cgm', 'continuous glucose monitor',
  'flash glucose', 'sensor change', 'sensor swap', 'change sensor', 'sensor',
  'dexcom', 'freestyle libre', 'freestyle', 'libre', 'omnipod', 'medtronic',
  'minimed', 'tandem pump', 'insulin pump', 'infusion set', 'cannula',
  'pod change', 'site change', 'lancet', 'test strip', 'test strips',
  'ketone', 'ketones', 'hypo', 'hypoglycemia', 'hypoglycaemia',
  'hyperglycemia', 'hyperglycaemia', 'a1c', 'hba1c', 'endocrinologist',
  'endo appointment', 'insulin pen', 'basal rate', 'bolus', 'carb count',
];

const GENERAL_MEDICAL_KEYWORDS_EN = [
  'doctor', 'dr appointment', "dr's appointment", 'physician', 'dentist',
  'dental', 'orthodontist', 'orthodontics', 'braces tightening', 'check-up',
  'checkup', 'physical exam', 'annual physical', 'wellness visit',
  'vaccination', 'vaccine', 'immunization', 'immunisation', 'booster shot',
  'flu shot', 'flu jab', 'jab', 'blood test', 'bloodwork', 'blood draw',
  'lab test', 'lab work', 'x-ray', 'xray', 'mri', 'ct scan', 'ultrasound',
  'biopsy', 'surgery', 'operation', 'procedure', 'prescription', 'refill',
  'pharmacy', 'medication', 'meds', 'therapy session', 'physio',
  'physiotherapy', 'occupational therapy', 'speech therapy', 'counselling',
  'counseling', 'psychologist', 'psychiatrist', 'therapist appointment',
  'allergy test', 'allergist', 'dermatologist', 'skin check', 'mole check',
  'optometrist', 'ophthalmologist', 'eye exam', 'eye test', 'audiologist',
  'hearing test', 'cardiologist', 'gynaecologist', 'gynecologist',
  'obstetrician', 'pediatrician', 'paediatrician', 'orthopedic',
  'orthopaedic', 'ent appointment', 'ear nose throat', 'specialist',
  'follow-up appointment', 'follow up appointment', 'urgent care',
  'emergency room', 'hospital appointment', 'clinic appointment',
  'health check', 'medical exam', 'gp appointment',
];

// Rory is in Vienna — Austrian/German medical vocabulary is just as likely
// to appear in a hand-typed calendar entry as English.
const GENERAL_MEDICAL_KEYWORDS_DE = [
  'arzt', 'ärztin', 'hausarzt', 'hausärztin', 'facharzt', 'fachärztin',
  'zahnarzt', 'zahnärztin', 'kinderarzt', 'kinderärztin', 'augenarzt',
  'frauenarzt', 'frauenärztin', 'hno-arzt', 'impfung', 'impftermin',
  'untersuchung', 'vorsorgeuntersuchung', 'blutabnahme', 'blutbild', 'mrt',
  'röntgen', 'krankenhaus', 'ordination', 'apotheke', 'rezept',
  'physiotherapie', 'arzttermin',
];

export const MEDICAL_KEYWORDS: readonly string[] = [
  ...DIABETES_KEYWORDS,
  ...GENERAL_MEDICAL_KEYWORDS_EN,
  ...GENERAL_MEDICAL_KEYWORDS_DE,
];

const medicalMatcher = buildMatcher(MEDICAL_KEYWORDS);

export function isMedicalFlaggedEvent(ev: { title?: string; description?: string }): boolean {
  return medicalMatcher(ev.title) || medicalMatcher(ev.description);
}

// --- Anniversaries & special days -------------------------------------------

// "mother"/"father" alone are deliberately NOT in this list — far too common
// outside the sense meant here ("call mother", "mother-in-law visit") — so
// Mother's/Father's Day are matched as full phrases instead.
export const ANNIVERSARY_KEYWORDS: readonly string[] = [
  'anniversary', 'wedding anniversary', 'dating anniversary',
  'engagement anniversary', 'our anniversary', 'engaged', 'valentine',
  // 'valentine' alone matches "Valentine's Day" (the apostrophe is itself a
  // word boundary) but NOT the no-apostrophe "Valentines Day" — 's' there
  // is glued straight onto the word with no boundary — hence both forms:
  'valentines', 'valentinstag', "mother's day", 'mothers day', 'muttertag',
  "father's day", 'fathers day', 'vatertag', "new year's eve",
  'new years eve', 'nye', 'jahrestag', 'hochzeitstag',
];

const anniversaryMatcher = buildMatcher(ANNIVERSARY_KEYWORDS);

export function isAnniversaryFlaggedEvent(ev: { title?: string; description?: string }): boolean {
  return anniversaryMatcher(ev.title) || anniversaryMatcher(ev.description);
}
