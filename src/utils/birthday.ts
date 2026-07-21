// Pure helpers for the yearly birthday-photo prompt (growing-up timelapse).
// No AI, no cost — derive whether we should nudge for "this year's photo" from
// the member's birthdate + the photos already on file. Kept out of
// NeedsAttention so the nudge list stays thin (mirrors care.ts).
import { FamilyMember } from '../types';

const DAY = 1000 * 60 * 60 * 24;

// How close to the birthday we start (and stop) prompting for that year's photo.
// A ±window means the reminder appears in the weeks before AND after the day,
// which is when people actually take and upload the shot.
export const BIRTHDAY_PHOTO_WINDOW_DAYS = 30;

/** True when a photo tagged with `year` already exists for this member. */
export function hasBirthdayPhotoForYear(m: FamilyMember, year: number): boolean {
  return (m.birthdayPhotos || []).some((p) => p.year === year);
}

/** Age (whole years) the member turns/turned on their birthday in `year`. */
export function ageOnBirthday(m: FamilyMember, year: number): number | undefined {
  if (!m.birthdate) return undefined;
  const bd = new Date(m.birthdate);
  if (isNaN(bd.getTime())) return undefined;
  const age = year - bd.getFullYear();
  return age >= 0 ? age : undefined;
}

/**
 * If the member's birthday (any nearby year's occurrence) falls within
 * ±BIRTHDAY_PHOTO_WINDOW_DAYS of `now` AND no photo is filed for that year yet,
 * returns the year to prompt for. Otherwise null.
 *
 * Checking prev/this/next-year occurrences makes the window robust across the
 * Dec↔Jan boundary (a late-December birthday still prompts in early January).
 */
export function birthdayPhotoNudge(
  m: FamilyMember,
  now: number = Date.now(),
): { year: number } | null {
  if (!m.birthdate) return null;
  const bd = new Date(m.birthdate);
  if (isNaN(bd.getTime())) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();

  let best: { year: number; absDays: number } | null = null;
  for (const year of [y - 1, y, y + 1]) {
    const occ = new Date(year, bd.getMonth(), bd.getDate());
    occ.setHours(0, 0, 0, 0);
    const days = Math.round((occ.getTime() - today.getTime()) / DAY);
    const absDays = Math.abs(days);
    if (absDays <= BIRTHDAY_PHOTO_WINDOW_DAYS && (!best || absDays < best.absDays)) {
      best = { year, absDays };
    }
  }

  if (!best) return null;
  if (hasBirthdayPhotoForYear(m, best.year)) return null;
  return { year: best.year };
}
