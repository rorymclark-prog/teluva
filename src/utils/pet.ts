import { Pet, PetHealthRecord } from '../types';
import { parseDateOnly } from './age';

// ---------------------------------------------------------------------------
// A pet's dated obligations, its age, and how it is labelled — the pet
// equivalent of utils/vehicle.ts, and deliberately built to the same bones so
// there is one way to read a deadline in this app rather than two.
//
// THE ONE RULE THAT IS NOT COSMETIC: a pet with a deceasedDate emits nothing.
// No deadline, no nudge, no calendar birthday. The reminder engine is
// indiscriminate by design — it will happily tell a family their dead dog's
// worming treatment is overdue, every day, forever, because a date is a date.
// That is the failure this file exists to prevent, which is why it is enforced
// HERE, in the resolver every caller already goes through, rather than in each
// of NeedsAttention, the calendar and the pets list separately.
// ---------------------------------------------------------------------------

export interface PetDeadline {
  kind: 'vaccination' | 'treatment' | 'insurance' | 'licence';
  label: string;
  date: string;   // YYYY-MM-DD
  days: number;   // days until (negative = overdue)
}

export function petDaysUntil(dateStr?: string): number | null {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** True once a deceasedDate is on file — a real date, not just any text. */
export function isDeceased(p: Pet): boolean {
  return !!parseDateOnly(p.deceasedDate);
}

const VACCINATION_TYPES = ['vaccination', 'vaccine', 'booster', 'impfung'];

/** A health record that is a vaccination, by its `type` or, failing that, its text. */
function isVaccinationRecord(r: PetHealthRecord): boolean {
  const hay = `${r.type || ''} ${r.what || ''}`.toLowerCase();
  return VACCINATION_TYPES.some((t) => hay.includes(t));
}

/**
 * When the next vaccination is owed.
 *
 * TWO PLACES CAN HOLD THIS, so exactly one function decides — the same
 * arrangement (and the same reasoning) as vehicle.ts's nextServiceDate:
 *
 *   1. `pet.nextVaccinationDue` — typed into the field on purpose. Wins.
 *   2. Otherwise the SOONEST FUTURE `nextDue` on a vaccination health record,
 *      which is what the vaccination card itself says.
 *
 * Explicit beats derived because a human overriding a field is making a
 * statement, and a silently-recomputed value that ignores them is how a field
 * comes to look broken. Past `nextDue` dates from old records are skipped: a
 * booster given in 2019 and due in 2020 is history, not a deadline — but an
 * explicit override IS returned even when overdue, because "the rabies shot
 * was due in March and we never went" is precisely the thing to be nagged
 * about.
 */
export function nextVaccinationDate(p: Pet): string | null {
  if (p.nextVaccinationDue) return p.nextVaccinationDue;

  const upcoming = (p.healthLog || [])
    .filter((r) => isVaccinationRecord(r) && !!parseDateOnly(r.nextDue))
    .map((r) => r.nextDue as string)
    .filter((iso) => {
      const days = petDaysUntil(iso);
      return days !== null && days >= 0;
    })
    .sort();

  return upcoming[0] || null;
}

export function petDeadlines(p: Pet): PetDeadline[] {
  if (isDeceased(p)) return [];

  const out: PetDeadline[] = [];
  const push = (kind: PetDeadline['kind'], label: string, date?: string | null) => {
    if (!date) return;
    const days = petDaysUntil(date);
    if (days === null) return;
    out.push({ kind, label, date, days });
  };
  push('vaccination', 'Vaccination due', nextVaccinationDate(p));
  push('treatment', 'Flea / worm treatment due', p.nextTreatmentDue);
  push('insurance', 'Pet insurance renewal', p.insuranceRenewal);
  push('licence', 'Pet licence renewal', p.licenceExpiry);
  return out.sort((a, b) => a.days - b.days);
}

export function petLabel(p: Pet): string {
  const n = (p.name || '').trim();
  if (n) return n;
  return (p.species || '').trim() || 'Pet';
}

/**
 * How old the pet is, in words, or null when there is no birthdate.
 *
 * Under two years old, months are what people actually say ("14 months"), and
 * they are also the ages at which the difference matters most — a puppy's
 * vaccination schedule is measured in weeks. Over two, years.
 *
 * NEVER states an estimated birthdate as fact. `birthdateEstimated` turns
 * "7 years" into "about 7 years", everywhere, because the alternative is the
 * app inventing a certainty about a rescue that its own record does not have.
 */
export function petAgeLabel(p: Pet, now: Date = new Date()): string | null {
  const born = parseDateOnly(p.birthdate);
  if (!born) return null;

  const end = parseDateOnly(p.deceasedDate) || now;
  if (end.getTime() < born.getTime()) return null;

  let months = (end.getFullYear() - born.getFullYear()) * 12 + (end.getMonth() - born.getMonth());
  if (end.getDate() < born.getDate()) months -= 1;
  if (months < 0) months = 0;

  const prefix = p.birthdateEstimated ? 'about ' : '';
  if (months < 24) {
    return `${prefix}${months} ${months === 1 ? 'month' : 'months'}`;
  }
  const years = Math.floor(months / 12);
  return `${prefix}${years} ${years === 1 ? 'year' : 'years'}`;
}

/** Newest first — a medical history is read from the most recent visit backwards. */
export function sortHealthLog(log: readonly PetHealthRecord[]): PetHealthRecord[] {
  return [...log].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
