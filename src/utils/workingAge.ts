import { IdCountry } from '../types';

// ---------------------------------------------------------------------------
// Minimum working age, by the family's country of residence.
//
// WHY THIS EXISTS: a six-year-old's profile was drawing "Employer", "Job
// title", "Work phone" and "Work address". Nothing was broken — the fields
// simply had no business being on a child's record, and on a page a parent
// reads about their own child that lands somewhere between silly and grim.
//
// These are the ages at which employment becomes legally possible at all
// (part-time/light work where a country allows that earlier than full-time),
// not school-leaving ages — the question this answers is "could this person
// plausibly have an employer", not "should they".
//
//   AT  15  general minimum; light work exceptions below it are narrow
//   ZA  15  Basic Conditions of Employment Act — no child under 15 employed
//   UK  13  part-time light work under local byelaws (16 is school-leaving)
//   US  14  FLSA, non-agricultural employment
//   other 15  the ILO Minimum Age Convention floor
//
// The country comes from HubSettings.country — the family's own setting, and
// the same value that already decides which ID and passport fields render.
// Deliberately NOT the member's `nationality`: someone can hold one passport
// and live, and work, somewhere else entirely.
// ---------------------------------------------------------------------------

export const MIN_WORKING_AGE: Record<IdCountry, number> = {
  AT: 15,
  ZA: 15,
  UK: 13,
  US: 14,
  other: 15,
};

export function minWorkingAge(country?: IdCountry): number {
  return MIN_WORKING_AGE[country || 'AT'] ?? 15;
}

/** Whole years old today, or null when the birthdate is missing or unparseable. */
export function ageInYears(birthdate?: string, now: Date = new Date()): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  // A birthdate in the future is a typo, not a negative age — treat it as
  // unknown rather than confidently hiding fields on the strength of it.
  return age < 0 ? null : age;
}

/**
 * Whether the work fields should be hidden for this person.
 *
 * TWO deliberate refusals to guess:
 *
 * 1. An unknown birthdate shows the fields. Most members are adults, and the
 *    birthdate is one of the most commonly blank fields in the app — hiding on
 *    "no birthdate" would strip the employer off half the grown-ups in a vault
 *    for a reason nobody could see.
 *
 * 2. Work details ALREADY ON FILE show the fields, whatever the age. A field
 *    that holds a value and doesn't render is the worst outcome available here:
 *    the data still exists, still reaches the AI context and the emergency
 *    card, and nobody can see it to correct or clear it. If a 12-year-old
 *    somehow has an employer recorded, the fix is to let a person look at it,
 *    not to hide the evidence.
 */
export function hideWorkFields(args: {
  birthdate?: string;
  country?: IdCountry;
  /** Any work value already stored on the member. */
  hasWorkDetails?: boolean;
  now?: Date;
}): boolean {
  if (args.hasWorkDetails) return false;
  const age = ageInYears(args.birthdate, args.now);
  if (age === null) return false;
  return age < minWorkingAge(args.country);
}

/**
 * The one-line explanation shown in place of the fields.
 *
 * Silently vanishing fields read as a bug, and the person most likely to
 * notice is the parent who filled in the birthdate a moment earlier — so the
 * copy names the age, the country, and the fact that it will appear on its own.
 */
export function workingAgeNote(country?: IdCountry): string {
  const age = minWorkingAge(country);
  const where = country === 'ZA' ? 'South Africa'
    : country === 'UK' ? 'the UK'
    : country === 'US' ? 'the US'
    : country === 'other' ? 'most countries'
    : 'Austria';
  return `Work details appear from age ${age}, the youngest anyone can be employed in ${where}.`;
}
