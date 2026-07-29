// Sun, Moon and Rising signs — and, more importantly, knowing when we can't
// honestly give one.
//
// The three signs need very different amounts of information, and pretending
// otherwise is how astrology apps end up confidently wrong:
//
//   SUN     moves ~1° a day. The birth DATE is almost always enough — except
//           on a cusp, where the changeover happens at a particular hour and
//           the date alone genuinely cannot say.
//   MOON    moves ~13° a day, a sign every 2½ days. The date usually pins it,
//           but roughly one birthday in five falls on a day the Moon changes
//           sign, and then the TIME decides it.
//   RISING  moves 360° a day, a sign every ~2 hours. It needs the time to the
//           minute, the time ZONE that time was written in, and WHERE on Earth
//           the person was. Without all four it is not approximate — it is
//           unknown, and any answer is a coin toss between twelve.
//
// So rather than guessing, this propagates the uncertainty. Every missing
// input widens a window of possible birth instants; each body is evaluated at
// both ends of that window; and a sign is only claimed when it is the same
// across the whole window. That turns "we don't know your birth time" from a
// silent wrong answer into a visible "Cancer or Leo — add your birth time".
//
// The astronomy itself is in astronomy.ts, validated against published
// reference positions.

import {
  julianDay, sunLongitude, moonLongitude, obliquity,
  localSiderealTime, ascendant, signFromLongitude, SignName, norm360,
} from './astronomy';
import { wallTimeToInstant, isKnownTimeZone } from './timeZone';

export interface BirthInput {
  /** YYYY-MM-DD */
  birthdate?: string;
  /** HH:MM, in the zone below */
  birthTime?: string;
  /** IANA zone the birth time was recorded in, e.g. 'Europe/Vienna' */
  birthTimeZone?: string;
  /** Degrees, north positive */
  birthLatitude?: number;
  /** Degrees, east positive */
  birthLongitude?: number;
}

export type Certainty = 'exact' | 'between' | 'unknown';

export interface SignReading {
  sign: SignName | null;
  /** When 'between', the other candidate. */
  alternative?: SignName;
  certainty: Certainty;
  /** What the user could add to turn this into an answer. */
  missing?: string;
}

export interface BirthChart {
  sun: SignReading;
  moon: SignReading;
  rising: SignReading;
  /** True when every input needed for a full chart was present and valid. */
  complete: boolean;
}

const UNKNOWN = (missing: string): SignReading => ({ sign: null, certainty: 'unknown', missing });

/**
 * A recorded birth time is only ever accurate to the minute it was written
 * down as, so even an "exact" time is really a window. One minute moves the
 * ascendant by a quarter of a degree — enough to matter within a whisker of a
 * cusp, which is exactly where a confident answer would be a lie.
 */
const MINUTE_MS = 60_000;

/** The widest a time zone can be wrong by, when we don't know which one. */
const MIN_OFFSET_HOURS = -12;
const MAX_OFFSET_HOURS = 14;

interface Window {
  start: Date;
  end: Date;
  /** True when the time and zone were both known. */
  pinned: boolean;
  /** True when the zone was known (needed for a rising sign). */
  zoned: boolean;
}

function parseDateParts(birthdate?: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((birthdate || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

function parseTimeParts(birthTime?: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((birthTime || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return [h, mi];
}

/**
 * The range of instants this birth could have happened at, given what we know.
 * Returns null if we don't even have a date.
 */
export function birthWindow(input: BirthInput): Window | null {
  const date = parseDateParts(input.birthdate);
  if (!date) return null;
  const [y, mo, d] = date;
  const time = parseTimeParts(input.birthTime);
  const zone = input.birthTimeZone && isKnownTimeZone(input.birthTimeZone) ? input.birthTimeZone : null;

  if (time && zone) {
    const inst = wallTimeToInstant(y, mo, d, time[0], time[1], 0, zone);
    if (inst) {
      return {
        start: new Date(inst.getTime() - MINUTE_MS),
        end: new Date(inst.getTime() + MINUTE_MS),
        pinned: true,
        zoned: true,
      };
    }
  }

  if (time && !zone) {
    // We know the clock but not which clock. The instant could be anywhere in
    // the 26-hour band of world time zones.
    const naive = Date.UTC(y, mo - 1, d, time[0], time[1], 0);
    return {
      start: new Date(naive - MAX_OFFSET_HOURS * 3600_000),
      end: new Date(naive - MIN_OFFSET_HOURS * 3600_000),
      pinned: false,
      zoned: false,
    };
  }

  // No time at all: the whole of that local day, anywhere on Earth.
  const dayStart = Date.UTC(y, mo - 1, d, 0, 0, 0);
  const dayEnd = Date.UTC(y, mo - 1, d, 23, 59, 59);
  return {
    start: new Date(dayStart - (zone ? 0 : MAX_OFFSET_HOURS * 3600_000)),
    end: new Date(dayEnd - (zone ? 0 : MIN_OFFSET_HOURS * 3600_000)),
    pinned: false,
    zoned: !!zone,
  };
}

/**
 * Read a body's sign across a window.
 *
 * Both the Sun and the Moon move steadily forwards in longitude, so checking
 * the two ends is enough: if they agree, nothing in between disagreed. The
 * `maxSpan` guard catches the case where the window is so wide the body has
 * moved through more than one sign boundary, where "A or B" would itself be a
 * false narrowing.
 */
function readBody(
  win: Window,
  longitudeAt: (jd: number) => number,
  maxSpan: number,
  missing: string,
): SignReading {
  const a = longitudeAt(julianDay(win.start));
  const b = longitudeAt(julianDay(win.end));
  const span = norm360(b - a);
  const signA = signFromLongitude(a);
  const signB = signFromLongitude(b);

  if (signA === signB && span < 30) return { sign: signA, certainty: 'exact' };
  if (span > maxSpan) return UNKNOWN(missing);
  return { sign: signA, alternative: signB, certainty: 'between', missing };
}

export function computeBirthChart(input: BirthInput): BirthChart {
  const win = birthWindow(input);
  if (!win) {
    const none = UNKNOWN('a date of birth');
    return { sun: none, moon: { ...none }, rising: { ...none }, complete: false };
  }

  const sun = readBody(win, sunLongitude, 30, 'the time of birth');
  const moon = readBody(
    win, moonLongitude, 30,
    win.pinned ? 'a more precise birth time' : 'the time of birth',
  );

  // The ascendant needs everything: the exact moment AND the spot on Earth.
  // There is no partial credit here — a rising sign computed without a place
  // is not "roughly right", it is one of twelve guesses.
  let rising: SignReading;
  const hasPlace =
    typeof input.birthLatitude === 'number' && Number.isFinite(input.birthLatitude) &&
    typeof input.birthLongitude === 'number' && Number.isFinite(input.birthLongitude) &&
    Math.abs(input.birthLatitude) <= 90 && Math.abs(input.birthLongitude) <= 180;

  if (!win.pinned) {
    rising = UNKNOWN(win.zoned ? 'the time of birth' : 'the time of birth and its time zone');
  } else if (!hasPlace) {
    rising = UNKNOWN('the place of birth');
  } else {
    const lat = input.birthLatitude!;
    const lon = input.birthLongitude!;
    const at = (dt: Date) => {
      const jd = julianDay(dt);
      return ascendant(localSiderealTime(jd, lon), lat, obliquity(jd));
    };
    const a = at(win.start);
    const b = at(win.end);
    const signA = signFromLongitude(a);
    const signB = signFromLongitude(b);
    rising = signA === signB
      ? { sign: signA, certainty: 'exact' }
      : { sign: signA, alternative: signB, certainty: 'between', missing: 'a birth time to the exact minute' };
  }

  return {
    sun, moon, rising,
    complete: sun.certainty === 'exact' && moon.certainty === 'exact' && rising.certainty === 'exact',
  };
}

/** One line describing a reading, for the card. */
export function describeReading(label: string, r: SignReading): string {
  if (r.certainty === 'exact' && r.sign) return `${label}: ${r.sign}`;
  if (r.certainty === 'between' && r.sign && r.alternative) {
    return `${label}: ${r.sign} or ${r.alternative} — add ${r.missing} to be sure`;
  }
  return `${label}: needs ${r.missing}`;
}
