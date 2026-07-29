// A tiny, self-contained sun-sign helper — no external API, no libraries.
// Powers the card's heading, symbol and element tint for the OPT-IN "just for
// fun" astrology view.
//
// This is the DATE-TABLE version, and its boundaries are approximate: the Sun
// changes sign at a particular moment that moves by up to a day and a half from
// year to year, so this is wrong for births near a cusp. The real positions —
// Sun, Moon and Rising, computed from the actual birth moment, with an explicit
// "we can't tell" when the data doesn't support an answer — are in
// utils/birthChart.ts, and that is what the card shows underneath.

export interface ZodiacSign {
  sign: string;
  symbol: string;
  element: 'Fire' | 'Earth' | 'Air' | 'Water';
  blurb: string;
}

// The day each sign STARTS. If the birth day is on/after this month's cutoff it's
// that sign, otherwise it's the previous month's sign.
const STARTS: [month: number, day: number, sign: string][] = [
  [1, 20, 'Aquarius'], [2, 19, 'Pisces'], [3, 21, 'Aries'], [4, 20, 'Taurus'],
  [5, 21, 'Gemini'], [6, 21, 'Cancer'], [7, 23, 'Leo'], [8, 23, 'Virgo'],
  [9, 23, 'Libra'], [10, 23, 'Scorpio'], [11, 22, 'Sagittarius'], [12, 22, 'Capricorn'],
];

const META: Record<string, Omit<ZodiacSign, 'sign'>> = {
  Aries: { symbol: '♈', element: 'Fire', blurb: 'Bold, energetic and always up for a challenge.' },
  Taurus: { symbol: '♉', element: 'Earth', blurb: 'Steady, loyal and fond of life’s comforts.' },
  Gemini: { symbol: '♊', element: 'Air', blurb: 'Curious, chatty and quick-witted.' },
  Cancer: { symbol: '♋', element: 'Water', blurb: 'Caring, intuitive and home-loving.' },
  Leo: { symbol: '♌', element: 'Fire', blurb: 'Warm, confident and happy in the spotlight.' },
  Virgo: { symbol: '♍', element: 'Earth', blurb: 'Thoughtful, practical and great with detail.' },
  Libra: { symbol: '♎', element: 'Air', blurb: 'Charming, fair-minded and drawn to harmony.' },
  Scorpio: { symbol: '♏', element: 'Water', blurb: 'Intense, loyal and deeply feeling.' },
  Sagittarius: { symbol: '♐', element: 'Fire', blurb: 'Adventurous, optimistic and free-spirited.' },
  Capricorn: { symbol: '♑', element: 'Earth', blurb: 'Determined, grounded and quietly ambitious.' },
  Aquarius: { symbol: '♒', element: 'Air', blurb: 'Original, independent and big-hearted.' },
  Pisces: { symbol: '♓', element: 'Water', blurb: 'Dreamy, gentle and wonderfully imaginative.' },
};

export function sunSign(birthdate?: string): ZodiacSign | null {
  if (!birthdate) return null;
  const parts = birthdate.split('-');
  if (parts.length < 3) return null;
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const [, cutoff, thisSign] = STARTS[m - 1];
  const sign = d >= cutoff ? thisSign : STARTS[(m - 2 + 12) % 12][2];
  return { sign, ...META[sign] };
}

// True if the given ISO timestamp falls on the same LOCAL calendar day as
// `now` (defaults to the current moment). Compares y/m/d via the local Date
// getters, not Date#toISOString() (which is UTC) — a Vienna user must not
// have "today's" insight roll over at 01:00. Mirrors the toISODate pattern
// used in NeedsAttention.tsx / utils/vehicle.ts.
export function isSameLocalDay(iso?: string, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

const ELEMENT_TINT: Record<ZodiacSign['element'], string> = {
  Fire: 'bg-clay-100 text-clay-700',
  Earth: 'bg-sage-100 text-sage-700',
  Air: 'bg-dusk-100 text-dusk-700',
  Water: 'bg-rosa-100 text-rosa-700',
};
export const elementTint = (el: ZodiacSign['element']) => ELEMENT_TINT[el];

/**
 * The cache key for a member's persisted "just for fun" blurb.
 *
 * It snapshots the birth details, so editing a birthdate rewrites the blurb —
 * but it deliberately carries a STYLE VERSION too. Without one, improving the
 * writing changed nothing anybody could see: every blurb already written stayed
 * word-for-word forever, because only a birthdate edit invalidated it. Five of
 * the seven blurbs on the live account were still the pre-rewrite text days
 * later, which is precisely what "the astrology is still wishy washy" was.
 *
 * Bump STYLE_VERSION whenever the prompt or the quality filter changes enough
 * that existing blurbs should be rewritten. It costs one generation per member,
 * once, the next time their profile is opened.
 */
// v3: the blurb prompt now receives real computed Moon and Rising signs
// (utils/birthChart.ts), so every v2 blurb was written without them.
const STYLE_VERSION = 'v3';

export function blurbCacheKey(m: {
  birthdate?: string;
  birthTime?: string;
  placeOfBirth?: string;
  birthTimeZone?: string;
  birthLatitude?: number;
  birthLongitude?: number;
}): string {
  // The zone and coordinates belong in this key because they change what the
  // blurb can SAY: filling them in is what turns an unknown rising sign into a
  // known one. Left out, someone would add their birth coordinates and get the
  // same old sun-sign-only paragraph back, with no way to tell why.
  return [
    STYLE_VERSION, m.birthdate || '', m.birthTime || '', m.placeOfBirth || '',
    m.birthTimeZone || '',
    m.birthLatitude !== undefined ? String(m.birthLatitude) : '',
    m.birthLongitude !== undefined ? String(m.birthLongitude) : '',
  ].join('|');
}
