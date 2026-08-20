// Standalone assertion test for virtualEvents.ts — same convention as
// familyDates.test.ts:
//   npx tsx src/utils/virtualEvents.test.ts
// It exits non-zero on failure.
//
// virtualEvents.ts is what finally puts birthdays, extended birthdays, name
// days and anniversaries INTO the calendar month grid (which until now rendered
// only stored CalendarEvent records — so a family member's own birthday never
// appeared on the calendar at all). The risky parts, and therefore what this
// file guards:
//   - projecting a recurring 'MM-DD' onto an ARBITRARY displayed year, not just
//     its next occurrence, including the Feb-29 collapse and a range that
//     straddles New Year;
//   - counting the age/years for THAT occurrence rather than the next one;
//   - the three deliberate exclusions that would otherwise double-count or
//     invent a date (calendar-sourced anniversaries, unresolved movable name
//     celebrations, and — by omission — school dates and vacations, which are
//     already stored events).
import assert from 'node:assert';
import { buildOccasionSeries, buildVirtualEvents, groupVirtualEventsByDate } from './virtualEvents';
import type {
  CalendarAnniversary,
  CalendarBirthday,
  CalendarExtendedBirthday,
  CalendarNameCelebration,
} from './familyDates';
import type { NameCelebration } from '../types';

function birthday(partial: Partial<CalendarBirthday> & Pick<CalendarBirthday, 'memberId' | 'memberName' | 'monthDay' | 'date' | 'turningAge'>): CalendarBirthday {
  return { id: `birthday-${partial.memberId}`, avatarColor: 'bg-blue-500', daysUntil: 0, ...partial };
}

function celebration(partial: Partial<NameCelebration> & Pick<NameCelebration, 'id' | 'title' | 'dateType'>): NameCelebration {
  return {
    kind: 'name_day',
    celebrationOf: 'Test',
    matchType: 'exact',
    explanation: 'test',
    confirmed: true,
    primary: true,
    notify: true,
    ...partial,
  };
}

function nameCelebration(id: string, memberId: string, memberName: string, c: NameCelebration): CalendarNameCelebration {
  return {
    id, memberId, memberName, avatarColor: 'bg-blue-500', celebration: c,
    isPrimary: true, date: null, daysUntil: null, needsResolution: false,
  };
}

// ---------------------------------------------------------------------------
// Birthdays — the headline fix
// ---------------------------------------------------------------------------
{
  // Lena's next birthday is 2026-03-03 and she turns 7 on it → born 2019.
  const lena = birthday({ memberId: 'm1', memberName: 'Lena', monthDay: '03-03', date: '2026-03-03', turningAge: 7 });

  const march2026 = buildVirtualEvents({ birthdays: [lena] }, '2026-03-01', '2026-03-31');
  assert.strictEqual(march2026.length, 1, 'the birthday must appear in its own month');
  assert.strictEqual(march2026[0].date, '2026-03-03');
  assert.strictEqual(march2026[0].title, "Lena's birthday");
  assert.strictEqual(march2026[0].detail, 'turns 7');
  assert.strictEqual(march2026[0].kind, 'birthday');
  assert.deepStrictEqual(march2026[0].memberIds, ['m1'], 'a birthday must be tagged to its member');

  // The whole point of projecting rather than reading `date`: a DIFFERENT year
  // must resolve, with the age counted for that year, not the next occurrence's.
  const march2029 = buildVirtualEvents({ birthdays: [lena] }, '2029-03-01', '2029-03-31');
  assert.strictEqual(march2029.length, 1, 'navigating the grid forward must still show the birthday');
  assert.strictEqual(march2029[0].date, '2029-03-03');
  assert.strictEqual(march2029[0].detail, 'turns 10', 'the age must be for THAT year, not the next occurrence');

  // Past months too — the grid can be navigated backwards.
  const march2022 = buildVirtualEvents({ birthdays: [lena] }, '2022-03-01', '2022-03-31');
  assert.strictEqual(march2022[0]?.detail, 'turns 3', 'a past occurrence must count down correctly');

  assert.strictEqual(
    buildVirtualEvents({ birthdays: [lena] }, '2026-04-01', '2026-04-30').length, 0,
    'a birthday must not leak into a month it does not fall in',
  );

  // No birth year known → no age label, but the day itself still shows.
  const unknown = birthday({ memberId: 'm2', memberName: 'Sam', monthDay: '06-10', date: '2027-06-10', turningAge: null as unknown as number });
  const got = buildVirtualEvents({ birthdays: [unknown] }, '2026-06-01', '2026-06-30');
  assert.strictEqual(got.length, 1, 'a birthday with no age must still appear');
  assert.strictEqual(got[0].detail, undefined, 'no origin year means no age label — never a guessed one');
}

// ---------------------------------------------------------------------------
// Leap years and year-straddling ranges
// ---------------------------------------------------------------------------
{
  const leapling = birthday({ memberId: 'm3', memberName: 'Ada', monthDay: '02-29', date: '2028-02-29', turningAge: 8 });

  const leapYear = buildVirtualEvents({ birthdays: [leapling] }, '2028-02-01', '2028-02-29');
  assert.strictEqual(leapYear[0]?.date, '2028-02-29', 'a leap-year birthday lands on the 29th in a leap year');

  const ordinary = buildVirtualEvents({ birthdays: [leapling] }, '2026-02-01', '2026-02-28');
  assert.strictEqual(ordinary[0]?.date, '2026-02-28', 'in an ordinary year it must collapse to the 28th, not roll into March');
  assert.strictEqual(
    buildVirtualEvents({ birthdays: [leapling] }, '2026-03-01', '2026-03-31').length, 0,
    'the Feb-29 collapse must never push the occurrence into March',
  );

  // A January grid legitimately spills into the previous December, so BOTH
  // years have to be projected or the spill days come back empty.
  const nye = birthday({ memberId: 'm4', memberName: 'Jo', monthDay: '12-31', date: '2026-12-31', turningAge: 40 });
  const straddle = buildVirtualEvents({ birthdays: [nye] }, '2026-12-28', '2027-01-03');
  assert.strictEqual(straddle.length, 1, 'a range straddling New Year must project every year it touches');
  assert.strictEqual(straddle[0].date, '2026-12-31');
}

// ---------------------------------------------------------------------------
// Extended birthdays — the ones Rory reported as missing
// ---------------------------------------------------------------------------
{
  const gran: CalendarExtendedBirthday = {
    id: 'eb1', name: 'Grandma Sue', relationship: 'Grandparent',
    monthDay: '09-14', date: '2026-09-14', daysUntil: 26, turningAge: 80,
  };
  const noYear: CalendarExtendedBirthday = {
    id: 'eb2', name: 'Tom', monthDay: '09-20', date: '2026-09-20', daysUntil: 32, turningAge: null,
  };

  const got = buildVirtualEvents({ extendedBirthdays: [gran, noYear] }, '2026-09-01', '2026-09-30');
  assert.strictEqual(got.length, 2, 'extended birthdays must reach the grid — the originally reported bug');
  assert.strictEqual(got[0].title, "Grandma Sue's birthday");
  assert.strictEqual(got[0].detail, 'turns 80');
  assert.strictEqual(got[0].kind, 'extendedBirthday');
  assert.strictEqual(got[1].detail, undefined, 'no originalYear means no age label');
  assert.strictEqual(got[0].memberIds, undefined, 'an extended birthday is not a FamilyMember — it must not be member-tagged');

  assert.strictEqual(
    buildVirtualEvents({ extendedBirthdays: [gran] }, '2031-09-01', '2031-09-30')[0]?.detail, 'turns 85',
    'an extended birthday must also count correctly in a future year',
  );
}

// ---------------------------------------------------------------------------
// Name celebrations — fixed project, movable NEVER guess
// ---------------------------------------------------------------------------
{
  const fixed = nameCelebration('m5-c1', 'm5', 'Michael', celebration({
    id: 'c1', title: 'Michaelitag', dateType: 'fixed', date: '09-29',
  }));

  const got = buildVirtualEvents({ nameCelebrations: [fixed] }, '2027-09-01', '2027-09-30');
  assert.strictEqual(got.length, 1, 'a fixed name day must project onto any year');
  assert.strictEqual(got[0].date, '2027-09-29');
  assert.strictEqual(got[0].title, 'Michaelitag');
  assert.strictEqual(got[0].detail, 'Michael', 'the name day carries whose day it is');

  // Movable: only the years the server actually resolved.
  const movable = nameCelebration('m6-c2', 'm6', 'Ganga', celebration({
    id: 'c2', title: 'Kartik Purnima', dateType: 'movable',
    movableRule: 'Kartik Purnima', resolvedDates: { '2026': '2026-11-24' },
  }));

  const resolved = buildVirtualEvents({ nameCelebrations: [movable] }, '2026-11-01', '2026-11-30');
  assert.strictEqual(resolved.length, 1, 'a RESOLVED movable celebration must appear');
  assert.strictEqual(resolved[0].date, '2026-11-24');

  const unresolved = buildVirtualEvents({ nameCelebrations: [movable] }, '2027-11-01', '2027-11-30');
  assert.strictEqual(unresolved.length, 0, 'an UNRESOLVED year must emit nothing — a projected lunar date would be invented');

  // A fixed celebration with no date at all must not throw or emit a bad entry.
  const broken = nameCelebration('m7-c3', 'm7', 'X', celebration({ id: 'c3', title: 'Nameless', dateType: 'fixed' }));
  assert.strictEqual(buildVirtualEvents({ nameCelebrations: [broken] }, '2026-01-01', '2026-12-31').length, 0);
}

// ---------------------------------------------------------------------------
// Anniversaries — and the calendar-sourced exclusion
// ---------------------------------------------------------------------------
{
  const wedding: CalendarAnniversary = {
    id: 'a1', title: 'Rory & Maria', kind: 'Wedding',
    monthDay: '07-12', date: '2027-07-12', daysUntil: 100, years: 15,
  };
  const valentines: CalendarAnniversary = {
    id: 'a2', title: "Valentine's Day", kind: 'Other',
    monthDay: '02-14', date: '2027-02-14', daysUntil: 200, years: null,
  };
  // buildCalendarAnniversaries also surfaces free-text EVENTS that read as an
  // anniversary. Those are already stored CalendarEvents and are already in the
  // grid — projecting them would show two dots for one thing.
  const fromEvent: CalendarAnniversary = {
    id: 'calendar-ev99', title: 'Our anniversary dinner', kind: 'Other',
    monthDay: '07-12', date: '2026-07-12', daysUntil: 5, years: null,
  };

  const got = buildVirtualEvents({ anniversaries: [wedding, valentines, fromEvent] }, '2026-01-01', '2026-12-31');
  assert.ok(got.some((v) => v.sourceId === 'a1'), 'a stored anniversary record must appear');
  assert.ok(got.some((v) => v.sourceId === 'a2'), "Valentine's must appear even with no origin year");
  assert.ok(
    !got.some((v) => v.sourceId === 'calendar-ev99'),
    'a calendar-sourced anniversary must NOT be projected — it is already a stored event in the grid',
  );

  assert.strictEqual(got.find((v) => v.sourceId === 'a1')?.detail, '14 years', 'years must count for the displayed year');
  assert.strictEqual(got.find((v) => v.sourceId === 'a2')?.detail, undefined, 'no origin year means no count');

  const singular = buildVirtualEvents({ anniversaries: [wedding] }, '2013-07-01', '2013-07-31');
  assert.strictEqual(singular[0]?.detail, '1 year', 'the first anniversary must read "1 year", not "1 years"');
}

// ---------------------------------------------------------------------------
// Range handling, ordering, grouping
// ---------------------------------------------------------------------------
{
  const a = birthday({ memberId: 'm8', memberName: 'Zoe', monthDay: '05-10', date: '2026-05-10', turningAge: 5 });
  const b = birthday({ memberId: 'm9', memberName: 'Ann', monthDay: '05-02', date: '2026-05-02', turningAge: 9 });

  const got = buildVirtualEvents({ birthdays: [a, b] }, '2026-05-01', '2026-05-31');
  assert.deepStrictEqual(got.map((v) => v.date), ['2026-05-02', '2026-05-10'], 'results must be date-sorted');

  // Bounds are inclusive at both ends.
  assert.strictEqual(buildVirtualEvents({ birthdays: [b] }, '2026-05-02', '2026-05-02').length, 1, 'both bounds are inclusive');

  assert.strictEqual(buildVirtualEvents({ birthdays: [a] }, '2026-05-31', '2026-05-01').length, 0, 'an inverted range must return nothing');
  assert.strictEqual(buildVirtualEvents({}, '2026-01-01', '2026-12-31').length, 0, 'no sources must be safe');

  const grouped = groupVirtualEventsByDate(got);
  assert.strictEqual(grouped.get('2026-05-02')?.length, 1);
  assert.strictEqual(grouped.get('2026-05-10')?.length, 1);
  assert.strictEqual(grouped.get('2026-05-11'), undefined, 'a day with nothing on it must have no bucket');

  // Ids must be unique per occurrence, or React keys collide across a
  // multi-year range.
  const multiYear = buildVirtualEvents({ birthdays: [a] }, '2026-01-01', '2028-12-31');
  assert.strictEqual(multiYear.length, 3, 'a three-year range must yield three occurrences');
  assert.strictEqual(new Set(multiYear.map((v) => v.id)).size, 3, 'each occurrence needs its own id');
}

// ---------------------------------------------------------------------------
// buildOccasionSeries — the export shape: rules, not dates
// ---------------------------------------------------------------------------
{
  const NOW = new Date(2026, 7, 20);          // 2026-08-20, local

  const lena = birthday({ memberId: 'm1', memberName: 'Lena', monthDay: '03-03', date: '2026-03-03', turningAge: 7 });
  const [series] = buildOccasionSeries({ birthdays: [lena] }, NOW);
  assert.strictEqual(series.repeat, 'yearly', 'a birthday must export as a repeating series, not a list of dates');
  assert.strictEqual(series.date, '2019-03-03', 'DTSTART must anchor on the birth year when it is known');
  assert.strictEqual(series.title, "Lena's birthday");
  assert.ok(series.description?.includes('Born 2019'), 'the year belongs in the note, not the title — a title cannot say "turns 7" on a series');
  assert.strictEqual(series.category, 'Birthday');
  assert.strictEqual(series.id, 'virtual-birthday-m1', 'the id is the .ics UID and must not carry a date');

  // One entry per occasion, however many years are on screen — that is the
  // whole difference from buildVirtualEvents.
  assert.strictEqual(buildOccasionSeries({ birthdays: [lena] }, NOW).length, 1);

  // No birth year → anchor on the current year rather than inventing one.
  const unknown = birthday({ memberId: 'm2', memberName: 'Sam', monthDay: '06-10', date: '2027-06-10', turningAge: null as unknown as number });
  const [samSeries] = buildOccasionSeries({ birthdays: [unknown] }, NOW);
  assert.strictEqual(samSeries.date, '2026-06-10', 'an unknown birth year anchors on today, not on year zero');
  assert.ok(!samSeries.description?.includes('Born'), 'no birth year means no "Born" note');

  // A 29 February series must anchor on a year that HAS a 29 February, or the
  // exported rule describes a different day from the record.
  const leapling = birthday({ memberId: 'm3', memberName: 'Ada', monthDay: '02-29', date: '2028-02-29', turningAge: 8 });
  assert.strictEqual(buildOccasionSeries({ birthdays: [leapling] }, NOW)[0].date, '2020-02-29');
  const leaplingNoYear = birthday({ memberId: 'm3b', memberName: 'Ada', monthDay: '02-29', date: '2028-02-29', turningAge: null as unknown as number });
  assert.strictEqual(
    buildOccasionSeries({ birthdays: [leaplingNoYear] }, NOW)[0].date, '2024-02-29',
    'with no birth year the anchor steps back to the nearest leap year, never onto a 29 February that does not exist',
  );
}

{
  const NOW = new Date(2026, 7, 20);

  const gran: CalendarExtendedBirthday = {
    id: 'eb1', name: 'Grandma Sue', relationship: 'Grandparent',
    monthDay: '09-14', date: '2026-09-14', daysUntil: 26, turningAge: 80,
  };
  const [granSeries] = buildOccasionSeries({ extendedBirthdays: [gran] }, NOW);
  assert.strictEqual(granSeries.date, '1946-09-14');
  assert.ok(granSeries.description?.includes('Grandparent'), 'an extended birthday carries the relationship — you need it to know who this is');

  const fixed = nameCelebration('m5-c1', 'm5', 'Michael', celebration({
    id: 'c1', title: 'Michaelitag', dateType: 'fixed', date: '09-29',
  }));
  const movable = nameCelebration('m6-c2', 'm6', 'Ganga', celebration({
    id: 'c2', title: 'Kartik Purnima', dateType: 'movable',
    movableRule: 'Kartik Purnima', resolvedDates: { '2026': '2026-11-24', '2027': '2027-11-13' },
  }));

  const days = buildOccasionSeries({ nameCelebrations: [fixed, movable] }, NOW);
  const fixedOut = days.filter((o) => o.title === 'Michaelitag');
  assert.strictEqual(fixedOut.length, 1);
  assert.strictEqual(fixedOut[0].repeat, 'yearly', 'a fixed name day repeats every year');
  assert.strictEqual(fixedOut[0].date, '2026-09-29');

  const movableOut = days.filter((o) => o.title === 'Kartik Purnima');
  assert.strictEqual(movableOut.length, 2, 'a movable celebration exports one entry per RESOLVED year');
  assert.ok(movableOut.every((o) => o.repeat === 'once'), 'a movable date must never carry a yearly rule — the importing calendar would invent every future occurrence on the wrong day');
  assert.strictEqual(new Set(movableOut.map((o) => o.id)).size, 2, 'each resolved year needs its own UID');

  const unresolved = nameCelebration('m7-c3', 'm7', 'X', celebration({
    id: 'c3', title: 'Unresolved', dateType: 'movable', movableRule: 'X',
  }));
  assert.strictEqual(buildOccasionSeries({ nameCelebrations: [unresolved] }, NOW).length, 0, 'no resolved year means nothing to export');
}

{
  const NOW = new Date(2026, 7, 20);

  const wedding: CalendarAnniversary = {
    id: 'a1', title: 'Rory & Maria', kind: 'Wedding',
    monthDay: '07-12', date: '2027-07-12', daysUntil: 100, years: 15,
  };
  const valentines: CalendarAnniversary = {
    id: 'a2', title: "Valentine's Day", kind: 'Other',
    monthDay: '02-14', date: '2027-02-14', daysUntil: 200, years: null,
  };
  const fromEvent: CalendarAnniversary = {
    id: 'calendar-ev99', title: 'Our anniversary dinner', kind: 'Other',
    monthDay: '07-12', date: '2026-07-12', daysUntil: 5, years: null,
  };

  const got = buildOccasionSeries({ anniversaries: [wedding, valentines, fromEvent] }, NOW);
  assert.strictEqual(got.length, 2, 'a calendar-sourced anniversary is already a stored event and must not be exported twice');
  const w = got.find((o) => o.id === 'virtual-anniversary-a1')!;
  assert.strictEqual(w.date, '2012-07-12', 'the anniversary anchors on the year it started');
  assert.ok(w.description?.includes('Since 2012'));
  const v = got.find((o) => o.id === 'virtual-anniversary-a2')!;
  assert.strictEqual(v.date, '2026-02-14', "Valentine's has no origin year, so it anchors on today");
  assert.ok(!v.description?.includes('Since'));

  assert.deepStrictEqual(buildOccasionSeries({}, NOW), [], 'no sources must be safe');
}

console.log('virtualEvents.test.ts: all assertions passed');
