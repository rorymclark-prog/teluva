import { HeartHandshake, Sparkle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnniversaryKind } from '../types';

// Pure quick-add + kind-display logic for AnniversariesView.tsx, split into
// its own module (rather than living in the component file) so the Computus
// date math below can be unit-tested directly, without pulling in
// AnniversariesView's own db.ts/Firebase imports just to reach it.

// --- Kind display: stored value → what a person reads -----------------------

export const KINDS: AnniversaryKind[] = ['Wedding', 'Engagement', 'Adoption', 'Anniversary', 'Religious', 'Other'];

// Every other kind reads fine as its bare stored word; 'Religious' alone
// needed a friendlier phrase, so this covers all six rather than
// special-casing one.
export const KIND_LABELS: Record<AnniversaryKind, string> = {
  Wedding: 'Wedding',
  Engagement: 'Engagement',
  Adoption: 'Adoption',
  Anniversary: 'Anniversary',
  Religious: 'Religious or spiritual',
  Other: 'Other',
};

// One icon per kind for the picker and the row list. Deliberately a single
// shared icon for the five pre-existing kinds (there was only ever one icon —
// HeartHandshake — before this change) and a new, neutral one for 'Religious'
// that doesn't read as any one tradition's own symbol (no cross/crescent/
// star — see the same reasoning on ANNIVERSARY_EMOJI in
// server/yearlyCelebrations.mjs).
export const KIND_ICONS: Record<AnniversaryKind, LucideIcon> = {
  Wedding: HeartHandshake,
  Engagement: HeartHandshake,
  Adoption: HeartHandshake,
  Anniversary: HeartHandshake,
  Religious: Sparkle,
  Other: HeartHandshake,
};

// --- Computus: Easter Sunday date math ---------------------------------------
// Two independent, deterministic calendar algorithms behind the Easter quick-
// add chips — closed-form computations, not memorized or guessed dates. Same
// discipline nameDay.ts states for movable dates: verify, don't recall. Both
// verified against WebSearch results on 2026-09-16 before shipping (see
// AnniversariesView.test.ts and this change's report for the exact reference
// dates checked): Western Easter 2024-03-31, 2025-04-20, 2026-04-05,
// 2027-03-28; Orthodox Easter 2025-04-20 (the rare year the two coincide),
// 2026-04-12.

/**
 * Western (Gregorian) Easter Sunday for `year`, as 'MM-DD'. The Anonymous
 * Gregorian algorithm (Meeus/Jones/Butcher) — the standard closed-form
 * computation for this, valid for any Gregorian-calendar year.
 */
export function gregorianEaster(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Orthodox (Eastern) Easter Sunday for `year`, as a Gregorian-calendar
 * 'MM-DD'. Meeus's Julian-calendar algorithm gives the date on the Julian
 * calendar; +13 days converts that to the Gregorian date a family's own
 * calendar actually uses. That offset is only correct for 1900-2099 (it
 * becomes 14 days from 2100) — fine for this app's lifetime so far, but not
 * something to reuse past 2099 without re-deriving it.
 */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const julianMonth = Math.floor((d + e + 114) / 31);
  const julianDay = ((d + e + 114) % 31) + 1;
  const gDate = new Date(Date.UTC(year, julianMonth - 1, julianDay));
  gDate.setUTCDate(gDate.getUTCDate() + 13);
  return `${String(gDate.getUTCMonth() + 1).padStart(2, '0')}-${String(gDate.getUTCDate()).padStart(2, '0')}`;
}

/** The Nth Sunday of `month` (1-12) in `year`, as 'MM-DD'. */
function nthSundayOfMonth(year: number, month: number, n: number): string {
  const first = new Date(year, month - 1, 1);
  const firstSunday = 1 + ((7 - first.getDay()) % 7);
  const day = new Date(year, month - 1, firstSunday + (n - 1) * 7);
  return `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

// --- Quick-add ("one-click") chips ------------------------------------------
// Pre-fills the form's title/date/kind for a handful of well-known recurring
// days — the user still confirms and taps Save, nothing is created on click.
// Valentine's Day, New Year's Eve and the two Women's Days are genuinely
// fixed 'MM-DD' dates. Mother's/Father's Day are NOT — they move by year
// (Nth Sunday of a month) — so rather than build the same movable-date
// machinery Name Celebrations has (out of scope here), this computes the
// date fresh for the CURRENT year only, at the moment the chip is clicked.
// The form shows an honest caveat so the family can adjust it.
//
// Rory (2026-08-19): "we need to have mothers day, name days, fathersday
// womans day etc etc". Father's Day genuinely differs by country — Austria
// keeps the 2nd Sunday of June, South Africa the 3rd — and this family spans
// both, so rather than pick one and be wrong for half the household, both
// are separate chips. Same reasoning for the two Women's Days: International
// Women's Day (8 March, UN-designated) and South Africa's National Women's
// Day (9 August, a public holiday commemorating the 1956 women's march) are
// different days entirely, not two names for the same one. All four dates
// verified via live search on 2026-08-19, not recalled — see nameDay.ts for
// why this file never guesses a moving/regional date from memory.
//
// Religious & spiritual days added 2026-09-16 (Rory: "i think we should have
// options to add religious or spiritually important days"), split into three
// treatments by how safely a date can be filled in — never a guess, per the
// same house rule:
//   FIXED    — Christmas (25 Dec) is a genuine fixed Gregorian date,
//              prefilled like Valentine's Day.
//   COMPUTED — Western and Orthodox Easter follow a real calendrical formula
//              (gregorianEaster/orthodoxEaster above), computed fresh for the
//              current year, exactly like Mother's/Father's Day above — not
//              memorized, not looked up.
//   LUNAR/LUNISOLAR — Ramadan, the two Eids, the Jewish High Holidays,
//              Hanukkah, Passover, Diwali, Vesak and Lunar New Year all
//              follow a calendar this app has no conversion for, and several
//              depend on local moon sighting on top of that. Their date is
//              left BLANK on purpose (`dateless: true`) with a `caveat`
//              shown once picked — the family fills in this year's date
//              themselves, the same way they would type any other date from
//              scratch.
// Deliberately a spread across traditions (Christian, Muslim, Jewish, Hindu,
// Buddhist) rather than one — see this change's report for which dates were
// verified and how.
export type QuickAddKey =
  | 'valentines'
  | 'mothers'
  | 'fathers-at'
  | 'fathers-za'
  | 'womens-intl'
  | 'womens-za'
  | 'nye'
  | 'christmas'
  | 'easter'
  | 'orthodox-easter'
  | 'ramadan-start'
  | 'eid-fitr'
  | 'eid-adha'
  | 'rosh-hashanah'
  | 'yom-kippur'
  | 'hanukkah'
  | 'passover'
  | 'diwali'
  | 'vesak'
  | 'lunar-new-year';

export interface QuickAddDef {
  key: QuickAddKey;
  label: string;
  title: string;
  kind: AnniversaryKind;
  /** True when no safe date can be prefilled — see the LUNAR/LUNISOLAR note above. */
  dateless?: boolean;
  /** Shown next to the Date field once this chip is picked. */
  caveat?: string;
}

export const QUICK_ADDS: QuickAddDef[] = [
  { key: 'valentines', label: "Valentine's Day", title: "Valentine's Day", kind: 'Other' },
  { key: 'mothers', label: "Mother's Day", title: "Mother's Day", kind: 'Other' },
  { key: 'fathers-at', label: "Father's Day (Austria)", title: "Father's Day", kind: 'Other' },
  { key: 'fathers-za', label: "Father's Day (South Africa)", title: "Father's Day", kind: 'Other' },
  { key: 'womens-intl', label: "International Women's Day", title: "International Women's Day", kind: 'Other' },
  { key: 'womens-za', label: "National Women's Day (SA)", title: "National Women's Day", kind: 'Other' },
  { key: 'nye', label: "New Year's Eve", title: "New Year's Eve", kind: 'Other' },
  // --- Religious & spiritual — fixed / computed ---
  { key: 'christmas', label: 'Christmas', title: 'Christmas', kind: 'Religious' },
  { key: 'easter', label: 'Easter Sunday', title: 'Easter Sunday', kind: 'Religious' },
  { key: 'orthodox-easter', label: 'Orthodox Easter', title: 'Orthodox Easter', kind: 'Religious' },
  // --- Religious & spiritual — lunar/lunisolar, date left blank ---
  {
    key: 'ramadan-start', label: 'Ramadan (start)', title: 'Start of Ramadan', kind: 'Religious', dateless: true,
    caveat: "Ramadan's start depends on the Islamic lunar calendar and moon sighting, and varies by year and sometimes by country — add this year's date yourselves.",
  },
  {
    key: 'eid-fitr', label: 'Eid al-Fitr', title: 'Eid al-Fitr', kind: 'Religious', dateless: true,
    caveat: "Eid al-Fitr marks the end of Ramadan and moves with the Islamic lunar calendar, sometimes confirmed only a day or two ahead by moon sighting — add this year's date yourselves.",
  },
  {
    key: 'eid-adha', label: 'Eid al-Adha', title: 'Eid al-Adha', kind: 'Religious', dateless: true,
    caveat: "Eid al-Adha follows the Islamic lunar calendar and moves every year — add this year's date yourselves.",
  },
  {
    key: 'rosh-hashanah', label: 'Rosh Hashanah', title: 'Rosh Hashanah', kind: 'Religious', dateless: true,
    caveat: "Rosh Hashanah follows the Hebrew lunisolar calendar and moves every year — add this year's date yourselves.",
  },
  {
    key: 'yom-kippur', label: 'Yom Kippur', title: 'Yom Kippur', kind: 'Religious', dateless: true,
    caveat: "Yom Kippur follows the Hebrew lunisolar calendar and moves every year — add this year's date yourselves.",
  },
  {
    key: 'hanukkah', label: 'Hanukkah', title: 'Hanukkah (first night)', kind: 'Religious', dateless: true,
    caveat: "Hanukkah follows the Hebrew lunisolar calendar and moves every year — add this year's first night yourselves.",
  },
  {
    key: 'passover', label: 'Passover', title: 'Passover (first night)', kind: 'Religious', dateless: true,
    caveat: "Passover follows the Hebrew lunisolar calendar and moves every year — add this year's first night yourselves.",
  },
  {
    key: 'diwali', label: 'Diwali', title: 'Diwali', kind: 'Religious', dateless: true,
    caveat: "Diwali follows the Hindu lunisolar calendar and moves every year — add this year's date yourselves.",
  },
  {
    key: 'vesak', label: 'Vesak', title: 'Vesak (Buddha Day)', kind: 'Religious', dateless: true,
    caveat: "Vesak follows the Buddhist lunisolar calendar and its date (even its month) varies by country — add this year's date yourselves.",
  },
  {
    key: 'lunar-new-year', label: 'Lunar New Year', title: 'Lunar New Year', kind: 'Religious', dateless: true,
    caveat: "Lunar New Year follows the Chinese lunisolar calendar and moves every year — add this year's date yourselves.",
  },
];

export function quickAddDate(key: QuickAddKey): string {
  const year = new Date().getFullYear();
  switch (key) {
    case 'valentines': return '02-14';
    case 'nye': return '12-31';
    case 'mothers': return nthSundayOfMonth(year, 5, 2);     // 2nd Sunday of May — same in Austria and South Africa
    case 'fathers-at': return nthSundayOfMonth(year, 6, 2);  // 2nd Sunday of June — Austria's Vatertag
    case 'fathers-za': return nthSundayOfMonth(year, 6, 3);  // 3rd Sunday of June — South Africa
    case 'womens-intl': return '03-08';                      // International Women's Day — fixed
    case 'womens-za': return '08-09';                        // National Women's Day — fixed SA public holiday
    case 'christmas': return '12-25';                        // fixed Gregorian date
    case 'easter': return gregorianEaster(year);              // computed fresh, see gregorianEaster above
    case 'orthodox-easter': return orthodoxEaster(year);      // computed fresh, see orthodoxEaster above
    // Lunar/lunisolar observances — the date genuinely cannot be filled in
    // from a formula the way Easter can. Left blank on purpose; applyQuickAdd
    // never calls this branch for a `dateless` chip, but the switch stays
    // exhaustive over every QuickAddKey rather than falling through to a
    // silent `undefined`.
    case 'ramadan-start':
    case 'eid-fitr':
    case 'eid-adha':
    case 'rosh-hashanah':
    case 'yom-kippur':
    case 'hanukkah':
    case 'passover':
    case 'diwali':
    case 'vesak':
    case 'lunar-new-year':
      return '';
  }
}
