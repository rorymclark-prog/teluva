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
// Matching is whole-word/whole-phrase (so "ent" never matches inside
// "enter"), case-insensitive, against both an event's title AND its
// description — not a plain .includes(), which would also catch "ENT" inside
// "ENTITLEMENT" or "GP" inside "GPS".
//
// WHY NOT \b. JavaScript's \b only knows ASCII letters, even with the 'u'
// flag. To it, "Ä" is not a word character, so a keyword that STARTS with an
// umlaut ("ärztin", "Übelkeit") could never match as a standalone word: there
// is no \b between a space and an "Ä". "Hausärztin" worked only because its
// first letter is ASCII. The boundaries below are Unicode letters/digits
// instead. (No lookbehind: a regex literal with one is a SyntaxError on
// Safari before 16.4, which would take the whole module, and the calendar
// with it, down on an older iPad. A consumed leading character does the same
// job for a yes/no test.)

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(keywords: readonly string[]): (text: string | undefined) => boolean {
  const pattern = keywords.map((k) => escapeRegExp(k).replace(/\s+/g, '\\s+')).join('|');
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, 'iu');
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
  // 2026-09-13: Rory's orthopaedic-surgeon and psychiatry appointments.
  // 'orthopaedic'/'psychiatrist' were already here; the specialty nouns and
  // the other specialists a referral letter sends people to were not.
  'psychiatry', 'psychiatric', 'orthopedist', 'orthopaedist', 'orthopedics',
  'orthopaedics', 'surgeon', 'neurologist', 'urologist', 'rheumatologist',
  'oncologist', 'endocrinology', 'radiology', 'mental health', 'hospital',
  'clinic', 'outpatient', 'consultant appointment', 'pre-op', 'post-op',
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
  // 2026-09-13, same report. Austrian usage: a specialist is a "Facharzt" with
  // an "Ordination" (already above); hospitals run "Ambulanzen" (outpatient
  // clinics, not ambulances) and are "Spital" as often as "Krankenhaus".
  // Deliberately NOT here, each for being common outside medicine:
  //   'termin' (any appointment at all), 'vorstellung' (also a theatre
  //   performance), 'überweisung' (also a bank transfer), 'ordi' (too short).
  'orthopädie', 'orthopäde', 'orthopädin', 'psychiatrie', 'psychiater',
  'psychiaterin', 'psychotherapie', 'psychotherapeut', 'psychotherapeutin',
  'psychologe', 'psychologin', 'chirurg', 'chirurgin', 'chirurgie',
  'unfallchirurgie', 'ambulanz', 'spital', 'klinik', 'facharzttermin',
  'kontrolltermin', 'nachkontrolle', 'op-termin', 'befundbesprechung',
  'befund', 'ultraschall', 'neurologe', 'neurologin', 'neurologie',
  'kardiologe', 'kardiologin', 'kardiologie', 'dermatologe', 'dermatologin',
  'hautarzt', 'hautärztin', 'urologe', 'urologie', 'radiologie',
  'internist', 'internistin', 'gynäkologe', 'gynäkologin', 'augenärztin',
  'logopädie', 'ergotherapie', 'wahlarzt', 'wahlärztin', 'kassenarzt',
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

// --- Birthdays & name days --------------------------------------------------

// Used by utils/hiddenPeople.ts, and only there: a hand-typed "Nora's
// birthday" is hidden along with Nora's other dates, while "Dinner with Nora"
// is not a date of hers and stays. Matched against the TITLE only by that
// caller — a description that mentions a birthday in passing does not make
// the event one.
export const BIRTHDAY_KEYWORDS: readonly string[] = [
  'birthday', 'birthdays', 'bday', 'b-day', "b'day", 'birthday party',
  'name day', 'nameday', 'name-day',
  'geburtstag', 'geburtstage', 'geburtstagsfeier', 'geburtstagsparty',
  'geburtstagsfest', 'geburtstagsessen', 'namenstag',
];

const birthdayMatcher = buildMatcher(BIRTHDAY_KEYWORDS);

export function isBirthdayFlaggedTitle(title: string | undefined): boolean {
  return birthdayMatcher(title);
}

export function isAnniversaryFlaggedTitle(title: string | undefined): boolean {
  return anniversaryMatcher(title);
}
