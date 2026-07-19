// Derive a person's age AT a given date from their birthdate. Used by keepsake
// features (Sayings, Family Words) so age is never stored — it's always computed
// from birthdate + the date the thing happened.

// Parse a 'YYYY-MM-DD' string as LOCAL midnight. new Date('YYYY-MM-DD') parses as
// UTC and can shift the day by one in western timezones.
export function parseDateOnly(value?: string): Date | null {
  if (!value) return null;
  const parts = value.split('-');
  if (parts.length < 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

// Whole years old at `atISO` given `birthISO`. Returns null if either is missing
// or unparseable, or if the date is before birth (a data-entry mistake).
export function ageYearsAt(birthISO?: string, atISO?: string): number | null {
  const b = parseDateOnly(birthISO);
  const at = parseDateOnly(atISO);
  if (!b || !at) return null;
  if (at.getTime() < b.getTime()) return null;
  let age = at.getFullYear() - b.getFullYear();
  const m = at.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age--;
  return age < 0 ? null : age;
}

// A friendly label: "age 6" for 2+, "18 months" / "3 months" for under 2, so an
// early quote reads naturally. Returns null when age can't be derived.
export function ageLabelAt(birthISO?: string, atISO?: string): string | null {
  const b = parseDateOnly(birthISO);
  const at = parseDateOnly(atISO);
  if (!b || !at || at.getTime() < b.getTime()) return null;
  const years = ageYearsAt(birthISO, atISO);
  if (years === null) return null;
  if (years >= 2) return `age ${years}`;
  const months = Math.max(0, Math.round((at.getTime() - b.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)));
  return `${months} month${months === 1 ? '' : 's'} old`;
}

export const todayISO = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
