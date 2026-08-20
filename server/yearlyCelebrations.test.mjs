import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeapYear,
  matchesMonthDay,
  monthDayFallsOn,
  buildYearlyCelebrations,
} from './yearlyCelebrations.mjs';

const TODAY = { month: 3, day: 14, year: 2026 };

test('isLeapYear follows the Gregorian rule, centuries included', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
});

test('matchesMonthDay ignores the stored year', () => {
  assert.equal(matchesMonthDay('1987-03-14', 3, 14, 2026), true);
  assert.equal(matchesMonthDay('2011-03-14', 3, 14, 2026), true);
  assert.equal(matchesMonthDay('1987-03-15', 3, 14, 2026), false);
});

test('matchesMonthDay refuses anything that is not a full date', () => {
  for (const bad of ['', null, undefined, '03-14', '1987-3-14', 'tomorrow', '1987-03-14T00:00:00Z']) {
    assert.equal(matchesMonthDay(bad, 3, 14, 2026), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('matchesMonthDay tolerates surrounding whitespace', () => {
  assert.equal(matchesMonthDay('  1987-03-14 ', 3, 14, 2026), true);
});

test('monthDayFallsOn matches a bare MM-DD and rejects a full date', () => {
  assert.equal(monthDayFallsOn('03-14', 3, 14, 2026), true);
  assert.equal(monthDayFallsOn('03-15', 3, 14, 2026), false);
  // A full date in an MM-DD field is a data error, not something to guess at.
  assert.equal(monthDayFallsOn('1987-03-14', 3, 14, 2026), false);
});

/* 29 FEBRUARY — the convention the whole app shares. In an ordinary year the
 * slot collapses to the 28th; in a leap year it stays put and the 28th is NOT
 * a match, or a leap-day person would be wished twice. */
test('a 29 February date falls on 28 February in an ordinary year', () => {
  assert.equal(matchesMonthDay('2004-02-29', 2, 28, 2026), true);
  assert.equal(monthDayFallsOn('02-29', 2, 28, 2026), true);
});

test('a 29 February date stays on the 29th in a leap year', () => {
  assert.equal(matchesMonthDay('2004-02-29', 2, 29, 2028), true);
  assert.equal(matchesMonthDay('2004-02-29', 2, 28, 2028), false);
  assert.equal(monthDayFallsOn('02-29', 2, 29, 2028), true);
  assert.equal(monthDayFallsOn('02-29', 2, 28, 2028), false);
});

test('the 28 February fallback does not fire for someone born on the 28th', () => {
  // Only 02-29 collapses. A real 28 February birthday matches on its own day
  // in every year, leap or not, and must never be doubled up.
  assert.equal(matchesMonthDay('1990-02-28', 2, 28, 2026), true);
  assert.equal(matchesMonthDay('1990-02-28', 2, 29, 2028), false);
});

test('the fallback needs a real year to ask about leapness', () => {
  assert.equal(monthDayFallsOn('02-29', 2, 28, undefined), false);
  assert.equal(monthDayFallsOn('02-29', 2, 28, NaN), false);
});

test('extended birthdays falling today become one celebration each', () => {
  const out = buildYearlyCelebrations({
    extendedBirthdays: [
      { id: 'eb1', name: 'Granny Sue', relationship: 'Grandmother', date: '03-14', originalYear: 1946 },
      { id: 'eb2', name: 'Uncle Tom', date: '03-14' },
      { id: 'eb3', name: 'Not today', date: '07-01', originalYear: 1980 },
    ],
  }, TODAY);
  assert.deepEqual(out, [
    {
      key: 'extbday-eb1',
      title: "🎂 It's Granny Sue's birthday!",
      body: 'Grandmother · Granny Sue turns 80 today.',
    },
    {
      key: 'extbday-eb2',
      title: "🎂 It's Uncle Tom's birthday!",
      body: 'Wish Uncle Tom a happy birthday today.',
    },
  ]);
});

test('an extended birthday on 29 February is announced on the 28th', () => {
  const [only] = buildYearlyCelebrations(
    { extendedBirthdays: [{ id: 'eb9', name: 'Leap Nan', date: '02-29', originalYear: 1948 }] },
    { month: 2, day: 28, year: 2026 },
  );
  assert.equal(only.key, 'extbday-eb9');
  assert.equal(only.body, 'Leap Nan turns 78 today.');
});

test('anniversaries carry their own emoji and a year count when known', () => {
  const out = buildYearlyCelebrations({
    anniversaries: [
      { id: 'a1', title: 'Rory & Maria', kind: 'Wedding', date: '03-14', originalYear: 2012 },
      { id: 'a2', title: 'The day we met', kind: 'Other', date: '03-14' },
      { id: 'a3', title: "Ana's adoption day", kind: 'Adoption', date: '03-14', originalYear: 2025 },
    ],
  }, TODAY);
  assert.deepEqual(out.map((c) => [c.key, c.title, c.body]), [
    ['annivrec-a1', '💞 Rory & Maria', '14 years today.'],
    ['annivrec-a2', '🎉 The day we met', 'Today is The day we met.'],
    ['annivrec-a3', "🧡 Ana's adoption day", '1 year today.'],
  ]);
});

test('an anniversary with no origin year falls back to its notes', () => {
  const [only] = buildYearlyCelebrations(
    { anniversaries: [{ id: 'a4', title: 'Oma & Opa', date: '03-14', notes: 'Call them in the morning.' }] },
    TODAY,
  );
  assert.equal(only.body, 'Call them in the morning.');
});

test('an unknown anniversary kind still gets a title', () => {
  const [only] = buildYearlyCelebrations(
    { anniversaries: [{ id: 'a5', title: 'Something new', kind: 'Housewarming', date: '03-14' }] },
    TODAY,
  );
  assert.equal(only.title, '🎉 Something new');
});

test('contact birthdays are the promise the AI prompt makes, and are kept', () => {
  const out = buildYearlyCelebrations({
    contacts: [
      { id: 'c1', name: 'Frau Berger', relation: 'Neighbour', birthdate: '1955-03-14' },
      { id: 'c2', name: 'Dr Weiss', relation: 'Paediatrician' },
      { id: 'c3', name: 'School office', birthdate: '1999-07-01' },
    ],
  }, TODAY);
  assert.deepEqual(out, [{
    key: 'contactbday-c1',
    title: "🎂 It's Frau Berger's birthday!",
    body: 'Neighbour · Frau Berger turns 71 today.',
  }]);
});

test('a contact recorded ALSO as an extended birthday is announced once', () => {
  // The assistant files "Granny's birthday" as a contact; the Extended
  // Birthdays screen writes its own record. A family that has done both must
  // not be told twice on the same morning.
  const out = buildYearlyCelebrations({
    extendedBirthdays: [{ id: 'eb1', name: 'Granny Sue', date: '03-14', originalYear: 1946 }],
    contacts: [{ id: 'c1', name: 'granny sue', birthdate: '1946-03-14' }],
  }, TODAY);
  assert.deepEqual(out.map((c) => c.key), ['extbday-eb1']);
});

test('two different people sharing a day both survive', () => {
  const out = buildYearlyCelebrations({
    extendedBirthdays: [
      { id: 'eb1', name: 'Lena', date: '03-14' },
      { id: 'eb2', name: 'Mia', date: '03-14' },
    ],
    contacts: [{ id: 'c1', name: 'Frau Berger', birthdate: '1955-03-14' }],
    anniversaries: [{ id: 'a1', title: 'Rory & Maria', kind: 'Wedding', date: '03-14' }],
  }, TODAY);
  // Distinct keys are the whole point: the caller tags each notification
  // `celebration-M-D-<key>`, so a shared key would mean one phone notification
  // silently replacing another. Sisters with the same birthday.
  assert.equal(new Set(out.map((c) => c.key)).size, out.length);
  assert.equal(out.length, 4);
});

test('no anniversary key can collide with the business founding date', () => {
  // server.js pushes the business anniversary under the bare key 'anniversary'
  // in the same run. A record keyed the same way would overwrite it.
  const out = buildYearlyCelebrations(
    { anniversaries: [{ id: 'a1', title: 'Ours', date: '03-14' }] },
    TODAY,
  );
  assert.notEqual(out[0].key, 'anniversary');
  assert.ok(out[0].key.startsWith('annivrec-'));
});

test('records missing an id or a name are skipped, not half-announced', () => {
  const out = buildYearlyCelebrations({
    extendedBirthdays: [{ name: 'No id', date: '03-14' }, { id: 'eb', date: '03-14' }],
    anniversaries: [{ id: 'a', date: '03-14' }, { title: 'No id', date: '03-14' }],
    contacts: [{ name: 'No id', birthdate: '1980-03-14' }],
  }, TODAY);
  assert.deepEqual(out, []);
});

test('a future or same-year origin never produces a count', () => {
  // Clock skew or a typo must not announce "turns 0" or "turns -3".
  const out = buildYearlyCelebrations({
    extendedBirthdays: [
      { id: 'eb1', name: 'Baby', date: '03-14', originalYear: 2026 },
      { id: 'eb2', name: 'Typo', date: '03-14', originalYear: 2099 },
      { id: 'eb3', name: 'Junk', date: '03-14', originalYear: 'nineteen eighty' },
    ],
  }, TODAY);
  assert.deepEqual(out.map((c) => c.body), [
    'Wish Baby a happy birthday today.',
    'Wish Typo a happy birthday today.',
    'Wish Junk a happy birthday today.',
  ]);
});

test('missing, empty and malformed sources all yield nothing', () => {
  assert.deepEqual(buildYearlyCelebrations(), []);
  assert.deepEqual(buildYearlyCelebrations({}, TODAY), []);
  assert.deepEqual(buildYearlyCelebrations({
    extendedBirthdays: 'not an array',
    anniversaries: { id: 'a' },
    contacts: [null, 42, 'x'],
  }, TODAY), []);
});

test('an incomplete "today" produces nothing rather than guessing', () => {
  const sources = { extendedBirthdays: [{ id: 'eb1', name: 'Sue', date: '03-14' }] };
  assert.deepEqual(buildYearlyCelebrations(sources, {}), []);
  assert.deepEqual(buildYearlyCelebrations(sources, { month: 3 }), []);
});

test('long free text cannot run away into the notification', () => {
  const [only] = buildYearlyCelebrations({
    extendedBirthdays: [{
      id: 'eb1',
      name: 'x'.repeat(500),
      relationship: 'y'.repeat(500),
      date: '03-14',
    }],
  }, TODAY);
  assert.equal(only.title.length < 120, true);
  assert.equal(only.body.length < 200, true);
});

test('nothing here reads or references the inMemory doc', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(
    new URL('./yearlyCelebrations.mjs', import.meta.url), 'utf8',
  ));
  // The deceased-exclusion guarantee is a property of what this module can
  // reach: it takes plain arrays and opens nothing, so the only way it could
  // ever surface a departed relative is if someone wired inMemory into it.
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.equal(/inMemory/.test(code), false);
});
