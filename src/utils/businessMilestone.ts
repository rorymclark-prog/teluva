// Business Milestones — shared date math for a business space's founding date
// and its yearly anniversary. The business-space equivalent of a person's
// birthday: founding date on the space, anniversary in the calendar, a short
// AI-written note for it.
//
// This is duplicated (in spirit) server-side in server.js's
// /api/business-milestone-note endpoint, the same way sunSignFromBirthdate is
// duplicated between server.js and src/utils/astrology.ts — keep both in sync
// if the definition of "years since founding" is ever revised.

function parseISODate(s?: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Local-time YYYY-MM-DD formatter — avoids the off-by-one-day bug from
// Date#toISOString() (UTC conversion) in timezones ahead of UTC (e.g. Vienna).
// Mirrors NeedsAttention.tsx's toISODate().
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Whole years elapsed since foundingDate, as of `now` (local time). Returns
// null when foundingDate is missing/unparseable. Never negative — a founding
// date in the future (which the server rejects on save, but a stale doc could
// still hold one) reads as 0 rather than a negative "years".
export function yearsSinceFounding(foundingDate: string | undefined, now: Date = new Date()): number | null {
  const founded = parseISODate(foundingDate);
  if (!founded) return null;
  let years = now.getFullYear() - founded.getFullYear();
  const anniversaryThisYear = new Date(now.getFullYear(), founded.getMonth(), founded.getDate());
  if (now.getTime() < anniversaryThisYear.getTime()) years -= 1;
  return Math.max(0, years);
}

// Next upcoming anniversary of foundingDate (today counts as "next" if it IS
// today), plus which anniversary number it is. Mirrors the birthday-nudge date
// math in NeedsAttention.tsx's computeNudges().
export function nextAnniversary(foundingDate: string | undefined, now: Date = new Date()): { date: Date; years: number } | null {
  const founded = parseISODate(foundingDate);
  if (!founded) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), founded.getMonth(), founded.getDate());
  if (next.getTime() < today.getTime()) next = new Date(today.getFullYear() + 1, founded.getMonth(), founded.getDate());
  const years = next.getFullYear() - founded.getFullYear();
  return { date: next, years };
}
