// A tiny, self-contained sun-sign helper — no external API, no libraries. Powers
// the OPT-IN "just for fun" astrology view. Sun sign only (from the birth date);
// birth time + place are captured for flavour, not a full chart computation.

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
