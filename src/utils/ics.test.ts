import assert from 'node:assert/strict';
import {
  unfoldIcs, parseIcsLine, unescapeIcsText, escapeIcsText,
  parseIcsDate, parseRrule, expandRecurrence, parseIcs, buildIcs,
} from './ics';
import type { CalendarEvent } from '../types';

const MEMBERS = [
  { id: 'sophie', name: 'Sophie Clark' },
  { id: 'Ganga', name: 'Ganga Clark' },
];

// ---------------------------------------------------------------------------
// Lexing — the parts every real .ics file exercises and hand-written test
// fixtures usually don't.
// ---------------------------------------------------------------------------

// Apple Calendar folds aggressively; a parser that ignores folding truncates
// every long title at 75 characters and never says so.
{
  const folded = 'SUMMARY:Sophie – appointment with the orthodontist about\r\n  the retainer';
  assert.deepEqual(unfoldIcs(folded), ['SUMMARY:Sophie – appointment with the orthodontist about the retainer']);
  assert.deepEqual(unfoldIcs('A:1\r\nB:2'), ['A:1', 'B:2'], 'plain lines are untouched');
  assert.deepEqual(unfoldIcs('A:1\n\tcontinued'), ['A:1continued'], 'a tab continues a line too');
}

{
  // Values contain colons all the time — a URL, "mailto:", a time in a title.
  const p = parseIcsLine('DTSTART;TZID=Europe/Vienna:20260815T150000')!;
  assert.equal(p.name, 'DTSTART');
  assert.equal(p.params.TZID, 'Europe/Vienna');
  assert.equal(p.value, '20260815T150000');

  const url = parseIcsLine('URL:https://example.com/a:b')!;
  assert.equal(url.value, 'https://example.com/a:b', 'only the FIRST colon separates');

  const quoted = parseIcsLine('ATTENDEE;CN="Clark, Sophie":mailto:s@example.com')!;
  assert.equal(quoted.params.CN, 'Clark, Sophie', 'a semicolon rule must not split inside quotes');
  assert.equal(quoted.value, 'mailto:s@example.com');

  assert.equal(parseIcsLine('NOCOLONHERE'), null);
}

{
  assert.equal(unescapeIcsText('Bring the form\\, signed\\; then wait\\nRoom 4'), 'Bring the form, signed; then wait\nRoom 4');
  assert.equal(unescapeIcsText('C:\\\\Users'), 'C:\\Users');
  assert.equal(unescapeIcsText('line\\Nbreak'), 'line\nbreak', '\\N is as valid as \\n');
  // Round trip.
  const messy = 'Dr Weiß, room 4; bring ID\nand the card\\file';
  assert.equal(unescapeIcsText(escapeIcsText(messy)), messy);
}

// ---------------------------------------------------------------------------
// Dates. The three shapes are NOT interchangeable and getting them confused
// silently shifts every appointment by the UTC offset.
// ---------------------------------------------------------------------------

{
  const allDay = parseIcsDate('20260815', { VALUE: 'DATE' })!;
  assert.deepEqual(allDay, { date: '2026-08-15', allDay: true });
  assert.equal(allDay.time, undefined, 'an all-day event has no time to show');

  // Absolute UTC must be converted to local, or a 15:00 Vienna appointment
  // displays as 13:00 in summer.
  const utc = parseIcsDate('20260815T130000Z')!;
  const expected = new Date(Date.UTC(2026, 7, 15, 13, 0, 0));
  assert.equal(utc.allDay, false);
  assert.equal(utc.time, `${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`);

  // Floating: no zone means "this time, wherever you are". Taken literally.
  const floating = parseIcsDate('20260815T150000')!;
  assert.deepEqual(floating, { date: '2026-08-15', time: '15:00', allDay: false });

  assert.equal(parseIcsDate('nonsense'), null);
  assert.equal(parseIcsDate(''), null);
}

{
  // A named zone is resolved through Intl, DST included. 15:00 Vienna in
  // August is 13:00 UTC; in January it is 14:00 UTC. If this ever regressed to
  // a fixed offset, one of the two would be an hour out.
  const summer = parseIcsDate('20260815T150000', { TZID: 'Europe/Vienna' })!;
  const winter = parseIcsDate('20260115T150000', { TZID: 'Europe/Vienna' })!;
  const asUtc = (d: string, t: string) => {
    const [y, m, day] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return new Date(y, m - 1, day, h, mi).toISOString();
  };
  assert.equal(asUtc(summer.date, summer.time!), '2026-08-15T13:00:00.000Z');
  assert.equal(asUtc(winter.date, winter.time!), '2026-01-15T14:00:00.000Z');
}

{
  // An unrecognised zone must keep the event, not throw it away.
  const r = parseIcsDate('20260815T150000', { TZID: 'Mars/Olympus_Mons' })!;
  assert.equal(r.date, '2026-08-15');
  assert.equal(r.time, '15:00', 'the written time is kept as-is');
  assert.equal(r.zoneUnknown, true, 'and the uncertainty is reported, not hidden');
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

{
  const r = parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=6')!;
  assert.equal(r.freq, 'WEEKLY');
  assert.equal(r.interval, 2);
  assert.equal(r.count, 6);
  assert.deepEqual(r.byDay, [2, 4]);
  assert.deepEqual(r.unsupported, []);

  assert.equal(parseRrule('FREQ=SECONDLY'), null, 'a frequency we cannot honour is not guessed at');
  assert.equal(parseRrule(''), null);

  // BYDAY on MONTHLY means "the third Tuesday" — declared unsupported rather
  // than applied as if it meant the weekly thing.
  assert.ok(parseRrule('FREQ=MONTHLY;BYDAY=3TU')!.unsupported.includes('BYDAY'));
  assert.ok(parseRrule('FREQ=MONTHLY;BYSETPOS=-1')!.unsupported.includes('BYSETPOS'));
}

{
  const today = new Date(2026, 6, 29);
  const weekly = expandRecurrence('2026-08-04', parseRrule('FREQ=WEEKLY;COUNT=4'), today);
  assert.deepEqual(weekly, ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']);

  const monthly = expandRecurrence('2026-08-04', parseRrule('FREQ=MONTHLY;COUNT=3'), today);
  assert.deepEqual(monthly, ['2026-08-04', '2026-09-04', '2026-10-04']);

  const until = expandRecurrence('2026-08-04', parseRrule('FREQ=WEEKLY;UNTIL=20260819'), today);
  assert.deepEqual(until, ['2026-08-04', '2026-08-11', '2026-08-18'], 'UNTIL is inclusive of its own day');

  const byDay = expandRecurrence('2026-08-04', parseRrule('FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4'), today);
  assert.deepEqual(byDay, ['2026-08-04', '2026-08-06', '2026-08-11', '2026-08-13']);

  // An endless rule must terminate, and must not run to the heat death of the
  // universe just because nobody wrote a COUNT.
  const forever = expandRecurrence('2026-08-04', parseRrule('FREQ=DAILY'), today);
  assert.ok(forever.length > 100 && forever.length <= 400, `bounded, got ${forever.length}`);
  assert.equal(forever[0], '2026-08-04');

  // No rule, or one we couldn't read: the event still exists on its own date.
  assert.deepEqual(expandRecurrence('2026-08-04', null, today), ['2026-08-04']);
}

// ---------------------------------------------------------------------------
// Whole files. These are the real shapes Apple Calendar and Outlook emit.
// ---------------------------------------------------------------------------

const APPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 15.2//EN',
  'CALSCALE:GREGORIAN',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Vienna',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:A1B2C3@icloud.com',
  'DTSTART;TZID=Europe/Vienna:20260815T150000',
  'DTEND;TZID=Europe/Vienna:20260815T160000',
  'SUMMARY:Sophie – Orthodontist (Dr. Lena Hofer-Mayr)',
  'LOCATION:Ahornweg 42\\, 1120 Wien',
  'DESCRIPTION:Bring the referral\\nand the e-card',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:D4E5F6@icloud.com',
  'DTSTART;VALUE=DATE:20260901',
  'SUMMARY:First day of school',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

{
  const r = parseIcs(APPLE, MEMBERS, new Date(2026, 6, 29));
  assert.equal(r.sourceCount, 2);
  assert.equal(r.events.length, 2);

  const ortho = r.events[0];
  assert.equal(ortho.title, 'Sophie – Orthodontist (Dr. Lena Hofer-Mayr)');
  // A TZID event is an absolute moment, so its LOCAL date depends on where it
  // is being read: 15:00 in Vienna is still 15 August in Europe, but already
  // the 16th for a reader in UTC+14. Asserting the literal '2026-08-15' passed
  // in five time zones and failed in Kiritimati — the behaviour was right and
  // the assertion was provincial. Derive it instead.
  const viennaInstant = new Date(Date.UTC(2026, 7, 15, 13, 0, 0)); // 15:00 Vienna, summer
  const expectedDate = `${viennaInstant.getFullYear()}-${String(viennaInstant.getMonth() + 1).padStart(2, '0')}-${String(viennaInstant.getDate()).padStart(2, '0')}`;
  assert.equal(ortho.date, expectedDate);
  assert.equal(ortho.category, 'Appointment');
  // The whole point of the earlier eventMemberMatch work, reused here: an
  // imported appointment lands on the right person's profile.
  assert.deepEqual(ortho.memberIds, ['sophie']);
  assert.match(ortho.description!, /Bring the referral\nand the e-card/);
  assert.match(ortho.description!, /Location: Ahornweg 42, 1120 Wien/);

  const school = r.events[1];
  assert.equal(school.date, '2026-09-01');
  assert.equal(school.time, undefined, 'an all-day event gets no invented 12:00');
  assert.deepEqual(school.memberIds, [], 'nobody is named in the title, so nobody is tagged');
}

const OUTLOOK = [
  'BEGIN:VCALENDAR',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E008',
  'DTSTART:20260910T080000Z',
  'DTEND:20260910T090000Z',
  'SUMMARY:Ganga swimming lesson',
  'RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3',
  'EXDATE:20260917T080000Z',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:CANCELLED-ONE',
  'DTSTART:20260912T080000Z',
  'SUMMARY:Cancelled parents evening',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

{
  const r = parseIcs(OUTLOOK, MEMBERS, new Date(2026, 6, 29));
  const titles = r.events.map((e) => e.title);
  assert.ok(!titles.includes('Cancelled parents evening'), 'a cancelled event must not be resurrected');
  assert.match(r.warnings.join(' '), /cancelled/i, 'and the user is told it was left out');

  const swims = r.events.filter((e) => e.title === 'Ganga swimming lesson');
  assert.equal(swims.length, 2, 'three weekly occurrences minus the one EXDATE removes');
  assert.ok(!swims.some((e) => e.date === '2026-09-17'), 'the excluded date is gone');
  assert.deepEqual(swims[0].memberIds, ['Ganga']);
  // Every generated occurrence needs its own id, or they collapse into one row.
  assert.equal(new Set(swims.map((e) => e.id)).size, swims.length);
}

{
  // REGRESSION: recurrence is expanded in the event's own time zone.
  //
  // The Outlook fixture above repeats every Thursday at 08:00Z and cancels one
  // occurrence with EXDATE. Read from Samoa (UTC-11) that instant is 21:00 on
  // WEDNESDAY, so an implementation that converts to local time first and then
  // applies BYDAY=TH generates days the event never falls on — and the EXDATE
  // then matches none of them, resurrecting a cancelled swimming lesson. This
  // is asserted here rather than left to whoever happens to run the suite in
  // an unusual zone, because it passed in five time zones before it failed.
  const r = parseIcs(OUTLOOK, MEMBERS, new Date(2026, 6, 29));
  const swims = r.events.filter((e) => e.title === 'Ganga swimming lesson');
  assert.equal(swims.length, 2, 'the cancelled occurrence stays cancelled in every time zone');
  // Ids key off the source date, so they are stable wherever the file is opened.
  assert.deepEqual(
    swims.map((e) => e.id).sort(),
    ['ics-040000008200E00074C5B7101A82E008-2026-09-10', 'ics-040000008200E00074C5B7101A82E008-2026-09-24'],
  );
}

{
  // Re-importing the same file must produce the same ids — that is what lets
  // the calendar's existing dedup recognise them as already-present.
  const a = parseIcs(APPLE, MEMBERS, new Date(2026, 6, 29)).events.map((e) => e.id);
  const b = parseIcs(APPLE, MEMBERS, new Date(2026, 6, 29)).events.map((e) => e.id);
  assert.deepEqual(a, b);
  assert.ok(a.every((id) => id.startsWith('ics-')), 'and are marked as file imports');
}

{
  // Malformed input is normal — people export half a file, or the wrong file.
  assert.doesNotThrow(() => parseIcs(''));
  assert.doesNotThrow(() => parseIcs('not a calendar at all'));
  assert.equal(parseIcs('').events.length, 0);

  const noStart = parseIcs('BEGIN:VEVENT\r\nSUMMARY:No date\r\nEND:VEVENT', MEMBERS);
  assert.equal(noStart.events.length, 0);
  assert.match(noStart.warnings.join(' '), /no start date/i, 'a dropped event is always reported');

  const noTitle = parseIcs('BEGIN:VEVENT\r\nDTSTART:20260815T150000\r\nEND:VEVENT', MEMBERS);
  assert.equal(noTitle.events[0].title, 'Untitled appointment');
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const OUT: CalendarEvent[] = [
  { id: 'e1', title: 'Sophie; dentist, 3pm', date: '2026-08-15', time: '15:00', category: 'Appointment', remindMe: true, description: 'Room 4\nbring card' },
  { id: 'e2', title: 'School starts', date: '2026-09-01', category: 'School', remindMe: false },
];

{
  const ics = buildIcs(OUT, 'Teluva', new Date(Date.UTC(2026, 6, 29, 12, 0, 0)));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /\r\n/, 'CRLF line endings, as the spec requires');

  // Separators inside a value must be escaped or the file is corrupt.
  assert.match(ics, /SUMMARY:Sophie\\; dentist\\, 3pm/);
  assert.match(ics, /DESCRIPTION:Room 4\\nbring card/);

  assert.match(ics, /DTSTART:20260815T150000/);
  assert.match(ics, /DTEND:20260815T160000/, 'a timed event gets an hour, not zero length');
  assert.match(ics, /DTSTART;VALUE=DATE:20260901/);
  assert.match(ics, /DTEND;VALUE=DATE:20260902/, 'an all-day DTEND is exclusive — the next day');
}

{
  // The real test of a writer is whether a reader accepts it.
  const ics = buildIcs(OUT, 'Teluva', new Date(Date.UTC(2026, 6, 29, 12, 0, 0)));
  const back = parseIcs(ics, MEMBERS, new Date(2026, 6, 29));
  assert.equal(back.events.length, 2, 'everything we wrote comes back');
  assert.equal(back.events[0].title, 'Sophie; dentist, 3pm', 'punctuation survives the round trip');
  assert.equal(back.events[0].date, '2026-08-15');
  assert.equal(back.events[0].time, '15:00', 'a floating time is not shifted by a zone we never set');
  assert.equal(back.events[1].date, '2026-09-01');
  assert.equal(back.events[1].time, undefined);
  assert.deepEqual(back.warnings, [], 'our own output produces no complaints');
}

{
  // An event whose hour would roll past midnight must not write an end time
  // that is earlier than its start on the same day.
  const late = buildIcs([{ id: 'l', title: 'Late', date: '2026-08-15', time: '23:30', category: 'Other', remindMe: false }]);
  assert.match(late, /DTSTART:20260815T233000/);
  assert.match(late, /DTEND:20260816T003000/, 'it rolls to the next day');
}

{
  assert.doesNotThrow(() => buildIcs([]));
  assert.match(buildIcs([]), /BEGIN:VCALENDAR/);
  // A malformed row must not take the whole export down.
  assert.doesNotThrow(() => buildIcs([{ id: 'x', title: '', date: '', category: 'Other', remindMe: false } as CalendarEvent]));
}

// ---------------------------------------------------------------------------
// Derived occasions — birthdays and anniversaries, written as RULES
// ---------------------------------------------------------------------------
//
// These are not stored events, so they are not in `events` at all. The point of
// exporting them as a recurring series rather than a list of dates is that the
// importing calendar keeps generating them forever; a materialised list would
// put a silent expiry on the file — the year it ran out, birthdays would stop.
{
  const NOW = new Date(Date.UTC(2026, 6, 29, 12, 0, 0));
  const ics = buildIcs([], 'Teluva', NOW, [
    { id: 'virtual-birthday-m1', kind: 'birthday', title: "Lena's birthday", date: '2019-03-03', repeat: 'yearly', description: 'Born 2019 · From Teluva', category: 'Birthday' },
    { id: 'virtual-nameDay-m6-c2-2026-11-24', kind: 'nameDay', title: 'Kartik Purnima', date: '2026-11-24', repeat: 'once', category: 'Name day' },
  ]);

  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  // Identical to what server/calendarPublish.mjs writes for the same occasion,
  // so a family that imports this file AND subscribes to the feed gets one
  // birthday per person rather than two.
  assert.match(ics, /UID:virtual-birthday-m1@teluva\.app\r\n/, 'the UID must be stable and must match the feed — a moving UID makes a calendar delete and recreate');
  assert.match(ics, /DTSTART;VALUE=DATE:20190303/, 'the series anchors on the birth year');
  assert.match(ics, /DTEND;VALUE=DATE:20190304/);
  assert.match(ics, /RRULE:FREQ=YEARLY/);
  assert.match(ics, /SUMMARY:Lena's birthday/);
  assert.match(ics, /CATEGORIES:Birthday/);
  assert.match(ics, /TRANSP:TRANSPARENT/, 'a birthday must not mark the day busy in anyone’s free/busy view');

  // The movable one gets no rule at all.
  const movableBlock = ics.slice(ics.indexOf('UID:virtual-nameDay'));
  assert.ok(!movableBlock.includes('RRULE'), 'a resolved movable date must never be given a yearly rule');
}

{
  // 29 February taken literally fires only in leap years, which would hide the
  // birthday three years out of four. Teluva's own rule falls back to the 28th.
  const leap = buildIcs([], 'Teluva', new Date(Date.UTC(2026, 6, 29)), [
    { id: 'virtual-birthday-m3', kind: 'birthday', title: "Ada's birthday", date: '2020-02-29', repeat: 'yearly', category: 'Birthday' },
  ]);
  assert.match(leap, /RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1/);
  assert.ok(!/RRULE:FREQ=YEARLY\r\n/.test(leap), 'the plain yearly rule would skip three years in four');
}

{
  // The round trip. Re-importing your own export must NOT turn derived
  // occasions into stored events — that second copy would stop following the
  // member record the moment a birthdate was corrected.
  const ics = buildIcs(OUT, 'Teluva', new Date(Date.UTC(2026, 6, 29, 12, 0, 0)), [
    { id: 'virtual-birthday-m1', kind: 'birthday', title: "Lena's birthday", date: '2019-03-03', repeat: 'yearly', category: 'Birthday' },
    { id: 'virtual-anniversary-a1', kind: 'anniversary', title: 'Rory & Maria', date: '2012-07-12', repeat: 'yearly', category: 'Anniversary' },
  ]);
  const back = parseIcs(ics, MEMBERS, new Date(2026, 6, 29));
  assert.equal(back.sourceCount, 4, 'all four VEVENTs are seen');
  assert.equal(back.events.length, 2, 'only the two real events are imported');
  assert.ok(!back.events.some((e) => e.title.includes('birthday')), 'a derived birthday must never become a stored event');
  assert.match(back.warnings.join(' '), /birthdays and anniversaries were left out/i, 'and the skip is reported, never silent');

  // Somebody ELSE's calendar file is a different case — a VEVENT that merely
  // says "birthday" in its title is theirs to import as an ordinary event.
  const foreign = parseIcs(
    'BEGIN:VEVENT\r\nUID:abc123@example.com\r\nSUMMARY:Nana’s birthday\r\nDTSTART;VALUE=DATE:20260303\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT',
    MEMBERS, new Date(2026, 6, 29),
  );
  assert.ok(foreign.events.length > 0, 'only Teluva’s OWN derived UIDs are skipped, not every birthday on earth');
}

console.log('ics.test.ts: all assertions passed');
