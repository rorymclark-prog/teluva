import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOwnEvent,
  selectPublishableEvents,
  redactEvent,
  escapeIcsText,
  foldLine,
  eventUid,
  buildPublishedIcs,
  publicationState,
  ymdUtc,
  MAX_PUBLISHED_EVENTS,
} from './calendarPublish.mjs';

const NOW = new Date('2026-07-29T12:00:00Z');
const ev = (over = {}) => ({ id: 'e1', title: 'Dentist', date: '2026-08-03', category: 'Appointment', ...over });

// --------------------------------------------------------------------------
// Echo guard
// --------------------------------------------------------------------------

test('an event typed in Teluva is publishable', () => {
  assert.equal(isOwnEvent(ev()), true);
});

test('an event from a subscription is never republished', () => {
  assert.equal(isOwnEvent(ev({ feedId: 'feed-abc' })), false);
});

test('events imported from Google or an .ics file are never republished', () => {
  assert.equal(isOwnEvent(ev({ id: 'gcal-123' })), false);
  assert.equal(isOwnEvent(ev({ id: 'ics-123' })), false);
});

test('THE ECHO LOOP: subscribing both ways does not duplicate the calendar', () => {
  // Teluva subscribes to Apple (events arrive with a feedId), and Apple
  // subscribes to Teluva. If the feed republished what it imported, Apple
  // would receive a second copy of its own event under a different UID and
  // nothing would ever collapse the two.
  const fromApple = ev({ id: 'feed-x-2026-08-03-0', feedId: 'feed-x', title: 'Apple: Standup' });
  const typedHere = ev({ id: 'own-1', title: 'Swimming' });
  const out = selectPublishableEvents([fromApple, typedHere], NOW);
  assert.deepEqual(out.map((e) => e.id), ['own-1']);
});

// --------------------------------------------------------------------------
// Window + ordering
// --------------------------------------------------------------------------

test('events far outside the window are dropped', () => {
  const out = selectPublishableEvents([
    ev({ id: 'ancient', date: '2010-01-01' }),
    ev({ id: 'soon', date: '2026-08-03' }),
    ev({ id: 'far-future', date: '2099-01-01' }),
  ], NOW);
  assert.deepEqual(out.map((e) => e.id), ['soon']);
});

test('window edges are inclusive on both sides', () => {
  const back = ymdUtc(new Date(NOW.getTime() - 400 * 86400000));
  const fwd = ymdUtc(new Date(NOW.getTime() + 800 * 86400000));
  const out = selectPublishableEvents([
    ev({ id: 'oldest', date: back }),
    ev({ id: 'newest', date: fwd }),
  ], NOW);
  assert.equal(out.length, 2);
});

test('malformed dates never reach the serializer', () => {
  const out = selectPublishableEvents([
    ev({ id: 'a', date: 'someday' }),
    ev({ id: 'b', date: '' }),
    ev({ id: 'c', date: undefined }),
    ev({ id: 'ok' }),
  ], NOW);
  assert.deepEqual(out.map((e) => e.id), ['ok']);
});

test('output is date-ordered and capped', () => {
  const many = Array.from({ length: MAX_PUBLISHED_EVENTS + 50 }, (_, i) =>
    ev({ id: `e${i}`, date: '2026-08-03' }));
  assert.equal(selectPublishableEvents(many, NOW).length, MAX_PUBLISHED_EVENTS);

  const out = selectPublishableEvents([
    ev({ id: 'later', date: '2026-09-01' }),
    ev({ id: 'earlier', date: '2026-08-01' }),
  ], NOW);
  assert.deepEqual(out.map((e) => e.id), ['earlier', 'later']);
});

test('a non-array is tolerated rather than throwing inside a public route', () => {
  assert.deepEqual(selectPublishableEvents(null, NOW), []);
  assert.deepEqual(selectPublishableEvents(undefined, NOW), []);
});

// --------------------------------------------------------------------------
// Privacy
// --------------------------------------------------------------------------

test('busy mode removes the title, the note and the category', () => {
  const r = redactEvent(ev({ title: 'Oncology follow-up', description: 'Bring the scan results', category: 'Appointment' }), 'busy');
  assert.equal(r.title, 'Busy');
  assert.equal(r.description, '');
  assert.equal(r.category, '');
  assert.equal(r.date, '2026-08-03');   // the slot itself is still shared
});

test('busy mode leaks nothing into the served file', () => {
  const ics = buildPublishedIcs([
    ev({ title: 'Oncology follow-up', description: 'Bring the scan results', time: '09:30' }),
  ], { mode: 'busy', now: NOW });
  assert.ok(!ics.includes('Oncology'));
  assert.ok(!ics.includes('scan results'));
  assert.ok(!ics.includes('Appointment'));
  assert.ok(ics.includes('SUMMARY:Busy'));
  assert.ok(ics.includes('DTSTART:20260803T093000'));
});

test('details mode keeps the title and note', () => {
  const ics = buildPublishedIcs([ev({ description: 'Back molar' })], { mode: 'details', now: NOW });
  assert.ok(ics.includes('SUMMARY:Dentist'));
  assert.ok(ics.includes('DESCRIPTION:Back molar'));
});

// --------------------------------------------------------------------------
// Serialization
// --------------------------------------------------------------------------

test('TEXT escaping handles backslash first', () => {
  // Escaping the comma before the backslash would double-escape the backslash.
  assert.equal(escapeIcsText('a\\b,c;d'), 'a\\\\b\\,c\\;d');
  assert.equal(escapeIcsText('line1\nline2'), 'line1\\nline2');
  assert.equal(escapeIcsText(null), '');
});

test('folding counts octets, not characters', () => {
  const line = 'SUMMARY:' + 'ü'.repeat(60);          // 120 octets, 60 chars
  const folded = foldLine(line);
  assert.ok(folded.includes('\r\n '), 'should have folded');
  for (const seg of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(seg, 'utf8') <= 75, `segment too long: ${Buffer.byteLength(seg, 'utf8')}`);
  }
});

test('folding never splits a code point', () => {
  // An emoji straddling the 75-octet boundary must move to the next line
  // whole — half a surrogate pair is invalid UTF-8 and some clients drop the
  // entire event rather than the bad character.
  const line = 'SUMMARY:' + 'a'.repeat(66) + '🎂🎂🎂';
  const folded = foldLine(line);
  const rejoined = folded.split('\r\n ').join('');
  assert.equal(rejoined, line);
  assert.ok(!/�/.test(Buffer.from(folded, 'utf8').toString('utf8')));
});

test('short lines are returned untouched', () => {
  assert.equal(foldLine('SUMMARY:Dentist'), 'SUMMARY:Dentist');
});

test('the UID is stable when the event is edited', () => {
  const before = eventUid(ev({ id: 'abc', title: 'Dentist', date: '2026-08-03' }));
  const after = eventUid(ev({ id: 'abc', title: 'Dentist — moved', date: '2026-09-14', time: '11:00' }));
  assert.equal(before, after, 'a moved appointment must move, not be deleted and recreated');
});

test('the UID is safe to put in a content line', () => {
  assert.match(eventUid(ev({ id: 'a b:c;d,e\nf' })), /^[A-Za-z0-9._@-]+$/);
});

test('an all-day event gets a DATE-valued start and the following day as end', () => {
  const ics = buildPublishedIcs([ev({ date: '2026-08-03' })], { now: NOW });
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260803'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20260804'));
});

test('a late event rolls its end date over midnight', () => {
  const ics = buildPublishedIcs([ev({ date: '2026-08-31', time: '23:30' })], { now: NOW });
  assert.ok(ics.includes('DTSTART:20260831T233000'));
  assert.ok(ics.includes('DTEND:20260901T003000'), ics);
});

test('times are floating — no zone is invented', () => {
  const ics = buildPublishedIcs([ev({ time: '15:00' })], { now: NOW });
  assert.ok(ics.includes('DTSTART:20260803T150000'));
  assert.ok(!ics.includes('DTSTART:20260803T150000Z'));
  assert.ok(!ics.includes('TZID'));
});

test('the calendar declares a refresh interval both ways', () => {
  const ics = buildPublishedIcs([], { now: NOW, refreshMinutes: 60 });
  assert.ok(ics.includes('X-PUBLISHED-TTL:PT60M'));
  assert.ok(ics.includes('REFRESH-INTERVAL;VALUE=DURATION:PT60M'));
});

test('every line ends CRLF and the calendar is closed', () => {
  const ics = buildPublishedIcs([ev()], { now: NOW });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'found a bare LF');
});

test('an empty family calendar is still a valid feed', () => {
  const ics = buildPublishedIcs([], { now: NOW });
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('END:VCALENDAR'));
  assert.ok(!ics.includes('BEGIN:VEVENT'));
});

test('a calendar name with a comma does not break the property', () => {
  const ics = buildPublishedIcs([], { calendarName: 'Clark, family', now: NOW });
  assert.ok(ics.includes('X-WR-CALNAME:Clark\\, family'));
});

// --------------------------------------------------------------------------
// Reminders on important events (VALARM)
// --------------------------------------------------------------------------

/** The VALARM blocks inside the one VEVENT whose UID starts with `id`. */
function alarmsFor(ics, id) {
  const block = ics.split('BEGIN:VEVENT').find((b) => b.includes(`UID:${id}@`)) || '';
  return block.split('BEGIN:VALARM').slice(1).map((a) => a.split('END:VALARM')[0]);
}

test('a timed important event is reminded a day and two hours before', () => {
  const ics = buildPublishedIcs([ev({ id: 'school-play', title: 'School play', time: '16:00', category: 'School', important: true })], { now: NOW });
  const alarms = alarmsFor(ics, 'school-play');
  assert.equal(alarms.length, 2);
  assert.ok(alarms[0].includes('\r\nACTION:DISPLAY\r\n'));
  assert.ok(alarms[0].includes('\r\nDESCRIPTION:School play\r\n'), 'DISPLAY requires a DESCRIPTION');
  assert.ok(alarms[0].includes('\r\nTRIGGER:-P1D\r\n'));
  assert.ok(alarms[1].includes('\r\nTRIGGER:-PT2H\r\n'));
  // Nested inside the event, not after it: the alarm closes before the event does.
  assert.match(ics, /END:VALARM\r\nEND:VEVENT/);
});

test('an all-day important event is reminded once, at 09:00 the day before', () => {
  const ics = buildPublishedIcs([ev({ id: 'passport', title: 'Passport renewal', category: 'Other', important: true })], { now: NOW });
  const alarms = alarmsFor(ics, 'passport');
  assert.equal(alarms.length, 1);
  assert.ok(alarms[0].includes('\r\nTRIGGER:-PT15H\r\n'), 'midnight minus 15 hours is 09:00 the day before');
});

test('a medical appointment is reminded without anyone marking it', () => {
  const ics = buildPublishedIcs([ev({ id: 'dentist', title: 'Dentist — Ben', time: '09:30' })], { now: NOW });
  assert.equal(alarmsFor(ics, 'dentist').length, 2);
});

test('CONTROL: an ordinary event gets no reminder', () => {
  const ics = buildPublishedIcs([ev({ id: 'football', title: 'Football practice', time: '17:00', category: 'Other' })], { now: NOW });
  assert.equal(alarmsFor(ics, 'football').length, 0);
  assert.ok(!ics.includes('BEGIN:VALARM'));
});

test('an appointment the family un-marked gets no reminder', () => {
  const ics = buildPublishedIcs([ev({ id: 'dentist', title: 'Dentist — Ben', time: '09:30', important: false })], { now: NOW });
  assert.equal(alarmsFor(ics, 'dentist').length, 0);
});

test('busy mode never carries a reminder, even on an important event', () => {
  // An alarm on some slots and not others would say which ones matter.
  const events = [
    ev({ id: 'dentist', title: 'Dentist — Ben', time: '09:30' }),
    ev({ id: 'school-play', title: 'School play', time: '16:00', important: true }),
  ];
  const ics = buildPublishedIcs(events, { now: NOW, mode: 'busy' });
  assert.ok(!ics.includes('BEGIN:VALARM'));
  assert.ok(!ics.includes('Dentist') && !ics.includes('School play'));
  // CONTROL: the same events in details mode do get them.
  assert.ok(buildPublishedIcs(events, { now: NOW }).includes('BEGIN:VALARM'));
});

test('a business feed reminds only what someone marked by hand', () => {
  const events = [
    ev({ id: 'dentist', title: 'Dentist', time: '09:30' }),
    ev({ id: 'audit', title: 'Tax audit', time: '10:00', category: 'Other', important: true }),
  ];
  const ics = buildPublishedIcs(events, { now: NOW, business: true });
  assert.equal(alarmsFor(ics, 'dentist').length, 0, 'no automatic medical rule in a business space');
  assert.equal(alarmsFor(ics, 'audit').length, 2);
});

test('a long reminder text is folded like every other line', () => {
  const title = 'Kinderärztin — Vorsorgeuntersuchung für Ben, bitte e-card und Impfpass mitnehmen';
  const ics = buildPublishedIcs([ev({ id: 'long', title, time: '08:00' })], { now: NOW });
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.ok(ics.split('\r\n ').join('').includes(`DESCRIPTION:${escapeIcsText(title)}`));
});

// --------------------------------------------------------------------------
// Publication lifecycle — fails closed
// --------------------------------------------------------------------------

test('a live publication serves', () => {
  assert.equal(publicationState({ familyId: 'fam' }, NOW), 'active');
  assert.equal(publicationState({ familyId: 'fam', expiresAt: '2027-01-01T00:00:00Z' }, NOW), 'active');
});

test('revoked, expired and missing all stop serving', () => {
  assert.equal(publicationState({ familyId: 'fam', revoked: true }, NOW), 'revoked');
  assert.equal(publicationState({ familyId: 'fam', expiresAt: '2026-01-01T00:00:00Z' }, NOW), 'expired');
  assert.equal(publicationState(null, NOW), 'missing');
  assert.equal(publicationState(undefined, NOW), 'missing');
});

test('a malformed record is treated as revoked, not as live', () => {
  // Fail closed: an unparseable expiry must never read as "no expiry".
  assert.equal(publicationState({ familyId: 'fam', expiresAt: 'whenever' }, NOW), 'revoked');
  assert.equal(publicationState({ revoked: false }, NOW), 'missing');
  assert.equal(publicationState({ familyId: '' }, NOW), 'missing');
});
