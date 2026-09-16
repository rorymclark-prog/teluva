// Which calendar events are "important", server side.
//
// src/utils/importantEvents.ts owns the rule and the client uses it
// everywhere: the family's own choice (`important: true` / `false`) wins,
// otherwise a medical appointment is important, and a business space has no
// automatic rule at all. The published .ics feed runs on the server, cannot
// import a .ts module, and needs the same answer to decide which events get a
// reminder (VALARM) — so this is that rule ported, together with the medical
// keyword net it stands on (src/utils/eventKeywordFlags.ts).
//
// Pinned to the client by src/utils/importantEventsParity.test.ts: the keyword
// list must be identical, in the same order, and a fixture table run through
// both isImportantEvent implementations must agree. Change one side without
// the other and that test fails.
//
// Pure functions only — no firebase-admin import — so this is `node --test`able
// without credentials or network, same as calendarPublish.mjs.

// Copied from eventKeywordFlags.ts (DIABETES, then GENERAL_MEDICAL _EN, then
// _DE). The parity test deep-equals this against the client's MEDICAL_KEYWORDS.
export const MEDICAL_KEYWORDS = [
  'diabetes', 'diabetic', 'insulin', 'glucose', 'blood sugar', 'blood glucose',
  'glucometer', 'glucose meter', 'cgm', 'continuous glucose monitor',
  'flash glucose', 'sensor change', 'sensor swap', 'change sensor', 'sensor',
  'dexcom', 'freestyle libre', 'freestyle', 'libre', 'omnipod', 'medtronic',
  'minimed', 'tandem pump', 'insulin pump', 'infusion set', 'cannula',
  'pod change', 'site change', 'lancet', 'test strip', 'test strips',
  'ketone', 'ketones', 'hypo', 'hypoglycemia', 'hypoglycaemia',
  'hyperglycemia', 'hyperglycaemia', 'a1c', 'hba1c', 'endocrinologist',
  'endo appointment', 'insulin pen', 'basal rate', 'bolus', 'carb count',

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
  'psychiatry', 'psychiatric', 'orthopedist', 'orthopaedist', 'orthopedics',
  'orthopaedics', 'surgeon', 'neurologist', 'urologist', 'rheumatologist',
  'oncologist', 'endocrinology', 'radiology', 'mental health', 'hospital',
  'clinic', 'outpatient', 'consultant appointment', 'pre-op', 'post-op',

  'arzt', 'ärztin', 'hausarzt', 'hausärztin', 'facharzt', 'fachärztin',
  'zahnarzt', 'zahnärztin', 'kinderarzt', 'kinderärztin', 'augenarzt',
  'frauenarzt', 'frauenärztin', 'hno-arzt', 'impfung', 'impftermin',
  'untersuchung', 'vorsorgeuntersuchung', 'blutabnahme', 'blutbild', 'mrt',
  'röntgen', 'krankenhaus', 'ordination', 'apotheke', 'rezept',
  'physiotherapie', 'arzttermin',
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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Same matcher as the client: whole word or phrase, Unicode letter/digit
// boundaries (not \b, which does not know "Ä"), title and description.
const MEDICAL_RE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}_])(?:${MEDICAL_KEYWORDS.map((k) => escapeRegExp(k).replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}_])`,
  'iu',
);

export function isMedicalFlaggedEvent(ev) {
  const t = ev && typeof ev.title === 'string' ? ev.title : '';
  const d = ev && typeof ev.description === 'string' ? ev.description : '';
  return (!!t && MEDICAL_RE.test(t)) || (!!d && MEDICAL_RE.test(d));
}

/**
 * Is this event important? `important: true/false` is the family's choice and
 * wins; otherwise a medical event is, except in a business space, which has
 * no automatic rule.
 * @param {{ title?: string, description?: string, important?: boolean }} ev
 * @param {{ business?: boolean }} [opts]
 */
export function isImportantEvent(ev, opts = {}) {
  if (!ev) return false;
  if (typeof ev.important === 'boolean') return ev.important;
  if (opts.business) return false;
  return isMedicalFlaggedEvent(ev);
}
