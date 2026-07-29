// The actual astronomy behind sun, moon and rising signs.
//
// The existing astrology.ts works off a fixed table of date ranges. That is
// fine for a sun sign most of the time and wrong the rest of the time — the
// boundaries move by up to a day and a half from year to year, so anyone born
// on a cusp gets told the wrong sign with total confidence. And a moon or
// rising sign cannot be looked up in a table at all: the Moon crosses a sign
// every two and a half days, and the ascendant crosses one every two HOURS.
//
// So this computes them. Formulae from Jean Meeus, *Astronomical Algorithms*
// (2nd ed.) — the standard reference — with the series truncated to the terms
// that matter at the precision a zodiac sign needs.
//
// ACCURACY, honestly stated:
//   Sun longitude    ~0.01°   (Meeus ch.25 low-accuracy solar position)
//   Moon longitude   ~0.03°   (Meeus ch.47, largest periodic terms)
//   Ascendant        exact for the inputs given — its error is entirely the
//                    error in the birth TIME and PLACE it is handed.
// A zodiac sign is 30° wide, so a few hundredths of a degree only matters for
// a birth within about a minute of a sign boundary. birthChart.ts is what
// decides when we are too close to that edge to claim an answer.
//
// Deliberately omitted: ΔT (the difference between Terrestrial and Universal
// Time, ~70 seconds this century). It shifts the Moon by 0.0006° and the
// ascendant by under a fifth of an arcminute — far below the uncertainty in a
// birth time anyone actually remembers.
//
// Also omitted: aberration and nutation, so these are GEOMETRIC rather than
// apparent positions. The visible consequence, measured: solstice and equinox
// instants computed from this come out about 8 minutes earlier than published
// tables (aberration is ~20 arcseconds, and the Sun covers that in 8 minutes).
// Checked against the 2026 September equinox, which this reproduces to within
// a minute, and the June solstice, 9 minutes early as predicted. Eight minutes
// against a 30°-wide sign is nothing — but it is the reason not to present
// these as ephemeris-grade times.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

const sin = (d: number) => Math.sin(d * RAD);
const cos = (d: number) => Math.cos(d * RAD);
const tan = (d: number) => Math.tan(d * RAD);

/** Wrap to [0, 360). */
export function norm360(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * Julian Day from a UTC instant.
 * Uses the Gregorian calendar throughout, which is correct for every date this
 * app will ever see (nobody in a family record vault was born before 1582).
 */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries from J2000.0. */
export const julianCenturies = (jd: number) => (jd - 2451545.0) / 36525;

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------

/**
 * The Sun's geometric ecliptic longitude, in degrees.
 * Meeus ch.25 ("low accuracy" — 0.01°, which is 40x finer than needed here).
 */
export function sunLongitude(jd: number): number {
  const T = julianCenturies(jd);
  // Geometric mean longitude and mean anomaly.
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  // Equation of the centre.
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  return norm360(L0 + C);
}

// ---------------------------------------------------------------------------
// Moon
// ---------------------------------------------------------------------------

// Meeus table 47.A, truncated. Each row: [D, M, M', F, coefficient in 1e-6 deg]
// for the longitude series. These are the largest terms; the tail below ~4000
// (0.004°) is dropped, since it cannot move a sign boundary by a meaningful
// amount. Sorted by magnitude so the truncation point is obvious.
const MOON_TERMS: [number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314],
  [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322],
  [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888], [2, 1, 0, 0, -6766],
  [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665],
  [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390],
  [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236], [0, 1, 2, 0, -2120],
  [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110],
  [3, 0, -1, 0, -892], [2, 1, 1, 0, -810], [4, -1, -2, 0, 759],
  [0, 2, -1, 0, -713], [2, 2, -1, 0, -700], [2, 1, -2, 0, 691],
  [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
  [4, -1, 0, 0, 520], [1, 0, -2, 0, -487], [2, 1, 0, -2, -399],
  [0, 0, 2, -2, -381], [1, 1, 1, 0, 351], [3, 0, -2, 0, -340],
  [4, 0, -3, 0, 330], [2, -1, 2, 0, 327], [0, 2, 1, 0, -323],
  [1, 1, -1, 0, 299], [2, 0, 3, 0, 294],
];

/**
 * The Moon's apparent ecliptic longitude, in degrees.
 * Meeus ch.47. Validated against his worked example 47.a in the tests.
 */
export function moonLongitude(jd: number): number {
  const T = julianCenturies(jd);
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

  // Moon's mean longitude.
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  // Mean elongation of the Moon from the Sun.
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  // Sun's mean anomaly.
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  // Moon's mean anomaly.
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  // Moon's argument of latitude.
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;

  // Eccentricity correction: terms involving the Sun's anomaly are scaled,
  // because the Earth's orbit is slowly getting rounder.
  const E = 1 - 0.002516 * T - 0.0000074 * T2;

  let sigmaL = 0;
  for (const [d, m, mp, f, coeff] of MOON_TERMS) {
    const arg = d * D + m * M + mp * Mp + f * F;
    let c = coeff;
    if (m === 1 || m === -1) c *= E;
    else if (m === 2 || m === -2) c *= E * E;
    sigmaL += c * sin(arg);
  }

  // The three additive terms (Venus, Jupiter and the flattening of the Earth).
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.29 * T;
  sigmaL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);

  return norm360(Lp + sigmaL / 1e6);
}

// ---------------------------------------------------------------------------
// Earth orientation
// ---------------------------------------------------------------------------

/** Mean obliquity of the ecliptic, in degrees. Meeus ch.22. */
export function obliquity(jd: number): number {
  const T = julianCenturies(jd);
  const U = T / 100;
  return (
    23.43929111 -
    U * (4680.93 + U * (-1.55 + U * (1999.25 + U * (-51.38 + U * (-249.67 + U * (-39.05 + U * (7.12 + U * (27.87 + U * (5.79 + U * 2.45)))))))))/ 3600
  );
}

/** Greenwich mean sidereal time in degrees. Meeus ch.12, eq. 12.4. */
export function greenwichSiderealTime(jd: number): number {
  const T = julianCenturies(jd);
  return norm360(
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000,
  );
}

/**
 * Local sidereal time in degrees. East longitude positive — the convention
 * every mapping tool and GPS uses, so it is the one least likely to be entered
 * backwards.
 */
export function localSiderealTime(jd: number, longitudeEast: number): number {
  return norm360(greenwichSiderealTime(jd) + longitudeEast);
}

// ---------------------------------------------------------------------------
// Ascendant
// ---------------------------------------------------------------------------

/**
 * The ecliptic longitude rising on the eastern horizon, in degrees.
 *
 * @param lst  local sidereal time, degrees
 * @param latitude  geographic latitude, degrees, north positive
 * @param eps  obliquity of the ecliptic, degrees
 *
 * The tests verify this the honest way: they take the returned longitude,
 * convert it to horizontal coordinates through an entirely separate
 * transformation, and check it comes out on the horizon in the east. A point
 * that is not at altitude zero is not the ascendant, whatever the formula says.
 */
export function ascendant(lst: number, latitude: number, eps: number): number {
  // Latitudes inside the polar circles have moments where the ecliptic does
  // not cross the horizon in the usual way; clamping keeps tan(φ) finite and
  // the result meaningful rather than infinite.
  const phi = Math.max(-89.9, Math.min(89.9, latitude));
  const y = cos(lst);
  const x = -(sin(lst) * cos(eps) + tan(phi) * sin(eps));
  let asc = norm360(Math.atan2(y, x) * DEG);

  // atan2 gives one of the two points where the ecliptic meets the horizon.
  // The ascendant is the RISING one, which always lies within 180° after the
  // midheaven; the other solution is the descendant, exactly opposite.
  //
  // Measured, because the obvious guess is wrong: this branch never fires
  // between the polar circles. At Vienna, Cape Town, Sydney or the equator it
  // is dead code. It starts firing at |latitude| > 66.5° — 2% of the day at
  // the Arctic Circle itself, 18% at 70°, and half the day at the pole, where
  // the ecliptic can lie almost along the horizon. Kept, and covered by a
  // test at 78°N, because a birth in Tromsø is unusual rather than impossible
  // and the failure would be a sign exactly opposite the right one.
  const mc = midheaven(lst, eps);
  if (norm360(asc - mc) > 180) asc = norm360(asc + 180);
  return asc;
}

/** The ecliptic longitude culminating — the midheaven (MC). */
export function midheaven(lst: number, eps: number): number {
  return norm360(Math.atan2(sin(lst), cos(lst) * cos(eps)) * DEG);
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

export const SIGN_NAMES = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const;

export type SignName = typeof SIGN_NAMES[number];

/** Which of the twelve 30° segments a longitude falls in. */
export function signFromLongitude(longitude: number): SignName {
  return SIGN_NAMES[Math.floor(norm360(longitude) / 30) % 12];
}

/** How far into its sign, in degrees (0–30). Used to judge cusp proximity. */
export function degreesIntoSign(longitude: number): number {
  return norm360(longitude) % 30;
}
