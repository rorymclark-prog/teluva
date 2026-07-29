import assert from 'node:assert/strict';
import { computeBirthChart, birthWindow, describeReading } from './birthChart';

// A fully specified birth: Vienna, with time and place. Everything should be
// answerable. (Not a real person — a fixture.)
const FULL = {
  birthdate: '1990-06-15',
  birthTime: '14:30',
  birthTimeZone: 'Europe/Vienna',
  birthLatitude: 48.2082,
  birthLongitude: 16.3738,
};

// ---------------------------------------------------------------------------
// The complete case
// ---------------------------------------------------------------------------
{
  const c = computeBirthChart(FULL);
  assert.equal(c.sun.certainty, 'exact');
  assert.equal(c.sun.sign, 'Gemini', '15 June is Gemini');
  assert.equal(c.moon.certainty, 'exact');
  assert.ok(c.moon.sign, 'a moon sign is available once the time is known');
  assert.equal(c.rising.certainty, 'exact');
  assert.ok(c.rising.sign);
  assert.equal(c.complete, true);
}

// ---------------------------------------------------------------------------
// Degrading, one input at a time. This is the actual point of the module: what
// it REFUSES to say matters more than what it says.
// ---------------------------------------------------------------------------
{
  // No place → no rising sign. Not an approximate one. None.
  const { birthLatitude, birthLongitude, ...noPlace } = FULL;
  const c = computeBirthChart(noPlace);
  assert.equal(c.sun.certainty, 'exact');
  assert.equal(c.moon.certainty, 'exact', 'the Moon does not care where you were');
  assert.equal(c.rising.certainty, 'unknown');
  assert.equal(c.rising.sign, null, 'a rising sign without a place would be one guess in twelve');
  assert.match(c.rising.missing!, /place of birth/);
  assert.equal(c.complete, false);
}

{
  // No time → no rising sign, and the Moon becomes uncertain or unknown.
  const { birthTime, ...noTime } = FULL;
  const c = computeBirthChart(noTime);
  assert.equal(c.sun.certainty, 'exact', 'the Sun barely moves in a day');
  assert.equal(c.rising.certainty, 'unknown');
  assert.match(c.rising.missing!, /time of birth/);
  assert.ok(c.moon.certainty !== 'exact' || c.moon.sign, 'the Moon is either pinned or honestly hedged');
}

{
  // A time with no zone is a clock reading with no clock. The rising sign is
  // unknowable — an hour of error is half a sign.
  const { birthTimeZone, ...noZone } = FULL;
  const c = computeBirthChart(noZone);
  assert.equal(c.rising.certainty, 'unknown');
  assert.match(c.rising.missing!, /time zone/);
}

{
  const c = computeBirthChart({});
  for (const r of [c.sun, c.moon, c.rising]) {
    assert.equal(r.certainty, 'unknown');
    assert.equal(r.sign, null);
    assert.match(r.missing!, /date of birth/);
  }
}

// ---------------------------------------------------------------------------
// Cusps — the case a fixed date-range table gets wrong with total confidence.
// ---------------------------------------------------------------------------
{
  // The Sun crossed into Virgo on 23 August 1990 at 09:25 UTC (computed, not
  // remembered — the first figure written here was wrong by six hours and the
  // test passed anyway, which is exactly how a plausible number survives).
  // Someone born that morning in Vienna is a Leo; that evening, a Virgo. A
  // fixed table saying "23 August = Virgo" is wrong for half of that day.
  const morning = computeBirthChart({
    birthdate: '1990-08-23', birthTime: '02:00', birthTimeZone: 'Europe/Vienna',
  });
  const evening = computeBirthChart({
    birthdate: '1990-08-23', birthTime: '22:00', birthTimeZone: 'Europe/Vienna',
  });
  assert.equal(morning.sun.sign, 'Leo');
  assert.equal(evening.sun.sign, 'Virgo');
  assert.notEqual(morning.sun.sign, evening.sun.sign, 'the same date, two different sun signs');
}

{
  // And with no time on that same cusp date, it must say so rather than pick.
  const c = computeBirthChart({ birthdate: '1990-08-23' });
  assert.equal(c.sun.certainty, 'between');
  assert.deepEqual(
    [c.sun.sign, c.sun.alternative].sort(),
    ['Leo', 'Virgo'],
    'both candidates are named, and neither is presented as the answer',
  );
  assert.match(c.sun.missing!, /time of birth/);
}

{
  // A day nowhere near a boundary stays certain even with nothing but a date.
  const c = computeBirthChart({ birthdate: '1990-08-10' });
  assert.equal(c.sun.certainty, 'exact');
  assert.equal(c.sun.sign, 'Leo');
}

// ---------------------------------------------------------------------------
// The Moon changes sign every 2½ days, so about one birthday in five lands on
// a changeover. Verified by counting rather than asserted from memory.
// ---------------------------------------------------------------------------
{
  let hedged = 0;
  const DAYS = 200;
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.UTC(1990, 0, 1 + i));
    const iso = d.toISOString().slice(0, 10);
    const c = computeBirthChart({ birthdate: iso, birthTimeZone: 'Europe/Vienna' });
    if (c.moon.certainty !== 'exact') hedged++;
  }
  const pct = (100 * hedged) / DAYS;
  assert.ok(pct > 15 && pct < 60, `expected the Moon to be undecidable on a sizeable minority of dates, got ${pct.toFixed(0)}%`);
}

{
  // Giving the time resolves most of those. Same dates, with a time and zone.
  let hedgedNoTime = 0, hedgedWithTime = 0;
  for (let i = 0; i < 120; i++) {
    const iso = new Date(Date.UTC(1990, 0, 1 + i)).toISOString().slice(0, 10);
    if (computeBirthChart({ birthdate: iso, birthTimeZone: 'Europe/Vienna' }).moon.certainty !== 'exact') hedgedNoTime++;
    if (computeBirthChart({ birthdate: iso, birthTime: '14:30', birthTimeZone: 'Europe/Vienna' }).moon.certainty !== 'exact') hedgedWithTime++;
  }
  assert.ok(hedgedWithTime < hedgedNoTime / 5,
    `adding a birth time should resolve most Moon ambiguity (${hedgedNoTime} -> ${hedgedWithTime})`);
}

// ---------------------------------------------------------------------------
// The rising sign really does depend on the place — if it didn't, the field
// would be pointless and nobody would notice it was being ignored.
// ---------------------------------------------------------------------------
{
  const vienna = computeBirthChart(FULL);
  const capeTown = computeBirthChart({ ...FULL, birthLatitude: -33.9249, birthLongitude: 18.4241 });
  const sydney = computeBirthChart({ ...FULL, birthLatitude: -33.8688, birthLongitude: 151.2093 });
  assert.ok(vienna.rising.sign && capeTown.rising.sign && sydney.rising.sign);
  // Sydney is 135° of longitude away — nine hours of sidereal time, so the
  // ascendant cannot possibly be the same sign.
  assert.notEqual(vienna.rising.sign, sydney.rising.sign, 'longitude must change the rising sign');
}

{
  // Two hours apart is a different rising sign, always. That is the property
  // that makes the birth time non-negotiable for this one.
  const seen = new Set<string>();
  for (const t of ['00:30', '02:30', '04:30', '06:30', '08:30', '10:30']) {
    const c = computeBirthChart({ ...FULL, birthTime: t });
    seen.add(c.rising.sign!);
  }
  assert.ok(seen.size >= 5, `six two-hourly births should give ~six rising signs, got ${seen.size}`);
}

// ---------------------------------------------------------------------------
// Bad input must not throw — these fields are free text on a form.
// ---------------------------------------------------------------------------
{
  const junk = [
    { birthdate: 'yesterday' },
    { birthdate: '1990-13-45' },
    { birthdate: '1990-06-15', birthTime: '99:99' },
    { birthdate: '1990-06-15', birthTime: '14:30', birthTimeZone: 'Mars/Olympus' },
    { birthdate: '1990-06-15', birthTime: '14:30', birthTimeZone: 'Europe/Vienna', birthLatitude: 999, birthLongitude: 999 },
    { birthdate: '1990-06-15', birthLatitude: NaN, birthLongitude: NaN },
  ];
  for (const input of junk) {
    assert.doesNotThrow(() => computeBirthChart(input as never), `threw on ${JSON.stringify(input)}`);
    const c = computeBirthChart(input as never);
    for (const r of [c.sun, c.moon, c.rising]) {
      if (r.certainty !== 'unknown') assert.ok(r.sign, 'a claimed reading always has a sign');
    }
  }
  // An out-of-range latitude is not a place, so no rising sign is offered.
  assert.equal(
    computeBirthChart({ ...FULL, birthLatitude: 999, birthLongitude: 999 }).rising.certainty,
    'unknown',
  );
  // An unknown zone falls back to "we don't know which clock", not to a guess.
  assert.equal(
    computeBirthChart({ ...FULL, birthTimeZone: 'Mars/Olympus' }).rising.certainty,
    'unknown',
  );
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
{
  assert.equal(birthWindow({}), null);
  const pinned = birthWindow(FULL)!;
  assert.equal(pinned.pinned, true);
  assert.equal(pinned.end.getTime() - pinned.start.getTime(), 2 * 60_000, 'an exact time is still a one-minute window');

  const noZone = birthWindow({ birthdate: '1990-06-15', birthTime: '14:30' })!;
  assert.equal(noZone.pinned, false);
  assert.equal((noZone.end.getTime() - noZone.start.getTime()) / 3600_000, 26, 'world time zones span 26 hours');
}

// ---------------------------------------------------------------------------
// The sentence the card shows
// ---------------------------------------------------------------------------
{
  const c = computeBirthChart({ birthdate: '1990-08-23' });
  assert.match(describeReading('Sun', c.sun), /Sun: (Leo or Virgo|Virgo or Leo) — add the time of birth to be sure/);
  assert.equal(describeReading('Sun', computeBirthChart(FULL).sun), 'Sun: Gemini');
  assert.match(describeReading('Rising', computeBirthChart({ birthdate: '1990-06-15' }).rising), /^Rising: needs /);
}

console.log('birthChart.test.ts: all assertions passed');
