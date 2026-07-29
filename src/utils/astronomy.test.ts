import assert from 'node:assert/strict';
import {
  julianDay, sunLongitude, moonLongitude, obliquity,
  greenwichSiderealTime, localSiderealTime, ascendant, midheaven,
  signFromLongitude, degreesIntoSign, norm360,
} from './astronomy';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Julian Day — everything else is built on this, so an error here is invisible
// and total.
// ---------------------------------------------------------------------------
{
  // J2000.0 epoch: 2000 January 1 at 12:00 UT is JD 2451545.0, by definition.
  assert.equal(julianDay(new Date(Date.UTC(2000, 0, 1, 12, 0, 0))), 2451545.0);
  // Meeus's worked examples, whose answers the sun/moon tests below depend on.
  assert.equal(julianDay(new Date(Date.UTC(1992, 3, 12, 0, 0, 0))), 2448724.5);
  assert.equal(julianDay(new Date(Date.UTC(1992, 9, 13, 0, 0, 0))), 2448908.5);
  assert.equal(julianDay(new Date(Date.UTC(1957, 9, 4, 19, 26, 24))), 2436116.31, 'Sputnik 1 launch, Meeus 7.a');
}

// ---------------------------------------------------------------------------
// Sun — checked against Meeus, *Astronomical Algorithms*, example 25.a.
// 1992 October 13.0 TD: true geometric longitude 199.90988°.
// ---------------------------------------------------------------------------
{
  const lon = sunLongitude(2448908.5);
  assert.ok(
    Math.abs(lon - 199.90988) < 0.01,
    `sun longitude ${lon.toFixed(5)} differs from Meeus 25.a (199.90988) by more than 0.01°`,
  );
  assert.equal(signFromLongitude(lon), 'Libra', '199.9° is late Libra');
}

{
  // The equinoxes are a second, independent check: the Sun is at longitude 0
  // at the March equinox and 180° at the September one. If the series were
  // subtly wrong these would drift by hours.
  const march = sunLongitude(julianDay(new Date(Date.UTC(2026, 2, 20, 14, 46, 0))));
  assert.ok(Math.abs(norm360(march + 180) - 180) < 0.02, `March equinox longitude was ${march.toFixed(4)}, expected ~0`);
  const sept = sunLongitude(julianDay(new Date(Date.UTC(2026, 8, 23, 0, 5, 0))));
  assert.ok(Math.abs(sept - 180) < 0.02, `September equinox longitude was ${sept.toFixed(4)}, expected ~180`);
}

{
  // A full year must advance the Sun exactly once round, monotonically.
  let prev = sunLongitude(julianDay(new Date(Date.UTC(2026, 0, 1))));
  let wraps = 0;
  for (let d = 1; d <= 365; d++) {
    const lon = sunLongitude(julianDay(new Date(Date.UTC(2026, 0, 1 + d))));
    if (lon < prev) wraps++;
    prev = lon;
  }
  assert.equal(wraps, 1, 'the Sun goes round once a year, and only once');
}

// ---------------------------------------------------------------------------
// Moon — Meeus example 47.a. 1992 April 12.0 TD: λ = 133.162655°.
// This is THE canonical test for a lunar longitude routine.
// ---------------------------------------------------------------------------
{
  const lon = moonLongitude(2448724.5);
  assert.ok(
    Math.abs(lon - 133.162655) < 0.03,
    `moon longitude ${lon.toFixed(5)} differs from Meeus 47.a (133.162655) by more than 0.03°`,
  );
  assert.equal(signFromLongitude(lon), 'Leo');
}

{
  // The Moon completes a circuit in a tropical month, ~27.32 days. Measuring
  // it catches an error in the mean-longitude rate, which the single-instant
  // check above cannot: a wrong rate still passes at the one epoch it was
  // tuned to.
  const start = julianDay(new Date(Date.UTC(2026, 0, 1)));
  const lon0 = moonLongitude(start);
  let crossings = 0;
  let prev = lon0;
  const DAYS = 273; // ten tropical months
  for (let i = 1; i <= DAYS * 4; i++) {
    const lon = moonLongitude(start + i / 4);
    if (lon < prev) crossings++;
    prev = lon;
  }
  assert.equal(crossings, 10, `expected 10 circuits in 273 days, saw ${crossings}`);
}

// ---------------------------------------------------------------------------
// Obliquity and sidereal time
// ---------------------------------------------------------------------------
{
  // Obliquity at J2000.0 is 23.4392911°, and it decreases very slowly.
  assert.ok(Math.abs(obliquity(2451545.0) - 23.4392911) < 1e-5);
  assert.ok(obliquity(julianDay(new Date(Date.UTC(2026, 0, 1)))) < obliquity(2451545.0), 'it is still shrinking');
  assert.ok(Math.abs(obliquity(julianDay(new Date(Date.UTC(1900, 0, 1)))) - 23.452) < 0.01);
}

{
  // Meeus example 12.a: 1987 April 10, 0h UT → GMST 13h 10m 46.3668s.
  const gmst = greenwichSiderealTime(julianDay(new Date(Date.UTC(1987, 3, 10, 0, 0, 0))));
  const expected = (13 + 10 / 60 + 46.3668 / 3600) * 15;
  assert.ok(Math.abs(gmst - expected) < 0.001, `GMST ${gmst.toFixed(5)}° vs expected ${expected.toFixed(5)}°`);
}

{
  // Sidereal time runs about 4 minutes a day fast on solar time — that is the
  // whole reason a birth chart needs the date as well as the clock.
  const a = greenwichSiderealTime(julianDay(new Date(Date.UTC(2026, 0, 1, 12))));
  const b = greenwichSiderealTime(julianDay(new Date(Date.UTC(2026, 0, 2, 12))));
  const gain = norm360(b - a);
  assert.ok(Math.abs(gain - 0.9856 * 1) < 0.01, `a sidereal day gains ~0.9856°, got ${gain.toFixed(4)}`);
  // East longitude advances local sidereal time.
  assert.ok(Math.abs(norm360(localSiderealTime(2451545.0, 15) - greenwichSiderealTime(2451545.0)) - 15) < 1e-9);
}

// ---------------------------------------------------------------------------
// Ascendant — verified INDEPENDENTLY, not against itself.
//
// The claim "this longitude is rising" is checkable: convert that ecliptic
// point to horizontal coordinates through a completely separate chain
// (ecliptic → equatorial → hour angle → altitude/azimuth) and it must sit on
// the horizon, on the eastern side. A formula with the wrong quadrant, the
// wrong sign on latitude, or the descendant instead of the ascendant fails
// this immediately, where it would sail through any "looks plausible" check.
// ---------------------------------------------------------------------------

function horizontalOfEclipticPoint(lambda: number, lst: number, lat: number, eps: number) {
  // Ecliptic (latitude 0) → equatorial.
  const sinL = Math.sin(lambda * RAD), cosL = Math.cos(lambda * RAD);
  const sinE = Math.sin(eps * RAD), cosE = Math.cos(eps * RAD);
  const ra = Math.atan2(sinL * cosE, cosL) * DEG;
  const dec = Math.asin(sinL * sinE) * DEG;
  // Hour angle, then altitude and azimuth.
  const H = norm360(lst - ra);
  const sinAlt =
    Math.sin(dec * RAD) * Math.sin(lat * RAD) +
    Math.cos(dec * RAD) * Math.cos(lat * RAD) * Math.cos(H * RAD);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  // Azimuth measured from north, through east.
  const az = norm360(
    Math.atan2(
      -Math.cos(dec * RAD) * Math.sin(H * RAD),
      Math.sin(dec * RAD) * Math.cos(lat * RAD) - Math.cos(dec * RAD) * Math.sin(lat * RAD) * Math.cos(H * RAD),
    ) * DEG,
  );
  return { alt, az };
}

{
  const eps = 23.4392911;
  const places: [string, number][] = [
    ['Vienna', 48.21], ['Cape Town', -33.92], ['Reykjavik', 64.13],
    ['equator', 0], ['Sydney', -33.87], ['Quito', -0.18],
    // Inside the polar circles the quadrant correction in ascendant() is the
    // difference between the ascendant and its exact opposite. Every latitude
    // above is outside them, where that branch is dead code — so without
    // these two rows, deleting the correction entirely still passed this
    // whole suite. Verified by doing exactly that.
    ['Tromso', 69.65], ['Longyearbyen', 78.22], ['Antarctic base', -77.85],
  ];
  for (const [name, lat] of places) {
    for (let lst = 0; lst < 360; lst += 7) {
      const asc = ascendant(lst, lat, eps);
      const { alt, az } = horizontalOfEclipticPoint(asc, lst, lat, eps);
      assert.ok(
        Math.abs(alt) < 1e-6,
        `${name} lst=${lst}: the ascendant must be ON the horizon, got altitude ${alt.toFixed(6)}°`,
      );
      assert.ok(
        az > 0 && az < 180,
        `${name} lst=${lst}: the ascendant must be in the EAST (azimuth 0–180), got ${az.toFixed(2)}° — this is the descendant`,
      );
    }
  }
}

{
  // The midheaven is the point culminating: due south in the north, due north
  // in the south, and at its highest either way.
  const eps = 23.4392911;
  for (let lst = 0; lst < 360; lst += 11) {
    const mc = midheaven(lst, eps);
    const { az } = horizontalOfEclipticPoint(mc, lst, 48.21, eps);
    assert.ok(Math.abs(az - 180) < 1e-6 || Math.abs(az) < 1e-6 || Math.abs(az - 360) < 1e-6,
      `the MC is on the meridian; azimuth was ${az.toFixed(4)}`);
  }
}

{
  // Over a sidereal day the ascendant sweeps every sign exactly once. A stuck
  // quadrant would show up here as a missing or doubled sign.
  const seen = new Set<string>();
  for (let lst = 0; lst < 360; lst += 0.25) seen.add(signFromLongitude(ascendant(lst, 48.21, 23.44)));
  assert.equal(seen.size, 12, 'all twelve signs rise each day');
}

{
  // Extremes must not produce NaN or Infinity — a birth inside the Arctic
  // Circle is unusual, not impossible.
  for (const lat of [89.9, -89.9, 90, -90, 66.6]) {
    const asc = ascendant(123, lat, 23.44);
    assert.ok(Number.isFinite(asc), `latitude ${lat} produced ${asc}`);
    assert.ok(asc >= 0 && asc < 360);
  }
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------
{
  assert.equal(signFromLongitude(0), 'Aries');
  assert.equal(signFromLongitude(29.999), 'Aries');
  assert.equal(signFromLongitude(30), 'Taurus');
  assert.equal(signFromLongitude(359.999), 'Pisces');
  assert.equal(signFromLongitude(360), 'Aries', 'wraps');
  assert.equal(signFromLongitude(-1), 'Pisces', 'and wraps backwards');
  assert.equal(degreesIntoSign(45), 15);
  assert.equal(degreesIntoSign(360), 0);
}

console.log('astronomy.test.ts: all assertions passed');
