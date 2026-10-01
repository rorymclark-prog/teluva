import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALARM_LEAD_MINUTES, MAX_ALARMS, alarmFeedState, alarmsFor, eventInstant,
  formatAlarmTime, parseLocalStamp, trustedPhoneNow,
} from './alarmFeed.mjs';

// The phone's wall clock, built the way the server reads it: naive, UTC fields.
const at = (s) => parseLocalStamp(s);
const NOW = at('202610010700'); // Thu 1 Oct 2026, 07:00

const dentist = { id: 'a', title: 'Dentist, Dr Weber', date: '2026-10-01', time: '16:30' };
const school = { id: 'b', title: 'School play', date: '2026-10-01', time: '18:00' };

test('parseLocalStamp reads real minutes and rejects everything else', () => {
  assert.equal(formatAlarmTime(at('202610010530')), '2026-10-01 05:30');
  for (const bad of ['', 'x', '20261001053', '2026100105300', '202613010530', '202602300530', '202610012530', '202610010560', null, undefined]) {
    assert.equal(parseLocalStamp(bad), null, String(bad));
  }
});

test('trustedPhoneNow refuses a clock that cannot be a real time zone', () => {
  const server = new Date('2026-10-01T05:00:00Z');
  assert.ok(trustedPhoneNow('202610010700', server), 'Vienna, +2 h');
  assert.ok(trustedPhoneNow('202610011800', server), 'Auckland-ish, +13 h');
  assert.ok(trustedPhoneNow('202609302000', server), 'Hawaii-ish, −9 h');
  assert.equal(trustedPhoneNow('202610030700', server), null, 'two days out');
  assert.equal(trustedPhoneNow('nonsense', server), null);
});

test('eventInstant needs a real date and a real time', () => {
  assert.equal(formatAlarmTime(eventInstant(dentist)), '2026-10-01 16:30');
  assert.equal(eventInstant({ date: '2026-10-01' }), null, 'all-day');
  assert.equal(eventInstant({ date: '2026-10-01', time: '' }), null);
  assert.equal(eventInstant({ date: '2026-10-01', time: '25:00' }), null);
  assert.equal(eventInstant({ date: '2026-02-30', time: '10:00' }), null);
  assert.equal(eventInstant({ date: 'tomorrow', time: '10:00' }), null);
  assert.equal(eventInstant(null), null);
});

test('important appointments get the lead-time alarm; unimportant events do not', () => {
  assert.deepEqual(alarmsFor([dentist, school], NOW, { leadMinutes: 60 }), ['2026-10-01 15:30']);
  assert.deepEqual(alarmsFor([dentist, school], NOW, { leadMinutes: 0 }), ['2026-10-01 16:30']);
});

test("scope 'all' rings for every timed event", () => {
  assert.deepEqual(
    alarmsFor([dentist, school], NOW, { leadMinutes: 0, scope: 'all' }),
    ['2026-10-01 16:30', '2026-10-01 18:00'],
  );
});

test('the family can mark something important, or un-mark a medical one', () => {
  assert.deepEqual(alarmsFor([{ ...school, important: true }], NOW, { leadMinutes: 0 }), ['2026-10-01 18:00']);
  assert.deepEqual(alarmsFor([{ ...dentist, important: false }], NOW, { leadMinutes: 0 }), []);
});

test('a business space has no medical default, so nothing rings unless marked', () => {
  assert.deepEqual(alarmsFor([dentist], NOW, { leadMinutes: 0, business: true }), []);
  assert.deepEqual(alarmsFor([{ ...dentist, important: true }], NOW, { leadMinutes: 0, business: true }), ['2026-10-01 16:30']);
});

test('all-day events never get an alarm, even when marked important', () => {
  assert.deepEqual(alarmsFor([{ id: 'c', title: 'Dentist', date: '2026-10-01', important: true }], NOW, { scope: 'all' }), []);
});

test('only alarms strictly inside the next 24 hours are created', () => {
  const ev = (date, time) => ({ id: `${date}${time}`, title: 'Doctor', date, time });
  // NOW is 07:00 on the 1st.
  assert.deepEqual(alarmsFor([ev('2026-10-01', '07:00')], NOW, { leadMinutes: 0 }), [], 'now is already gone');
  assert.deepEqual(alarmsFor([ev('2026-10-01', '07:01')], NOW, { leadMinutes: 0 }), [], 'inside the one-minute slack');
  assert.deepEqual(alarmsFor([ev('2026-10-01', '07:02')], NOW, { leadMinutes: 0 }), ['2026-10-01 07:02']);
  assert.deepEqual(alarmsFor([ev('2026-10-02', '06:58')], NOW, { leadMinutes: 0 }), ['2026-10-02 06:58'], 'just inside 24 h');
  assert.deepEqual(alarmsFor([ev('2026-10-02', '06:59')], NOW, { leadMinutes: 0 }), [], 'at the 24 h edge: ambiguous, so left for the next run');
  assert.deepEqual(alarmsFor([ev('2026-10-02', '10:00')], NOW, { leadMinutes: 0 }), [], 'a day away: the Clock would ring at the wrong day');
  assert.deepEqual(alarmsFor([ev('2026-09-30', '16:00')], NOW, { leadMinutes: 0 }), [], 'yesterday');
});

test('the lead is applied before the window, so an early alarm for a later appointment counts', () => {
  const ev = { id: 'z', title: 'Surgery', date: '2026-10-02', time: '08:00' };
  assert.deepEqual(alarmsFor([ev], NOW, { leadMinutes: 120 }), ['2026-10-02 06:00']);
  assert.deepEqual(alarmsFor([ev], NOW, { leadMinutes: 0 }), [], 'the appointment itself is beyond 24 h');
});

test('a lead that crosses midnight lands on the previous day', () => {
  const ev = { id: 'z', title: 'Surgery', date: '2026-10-02', time: '00:30' };
  assert.deepEqual(alarmsFor([ev], NOW, { leadMinutes: 60 }), ['2026-10-01 23:30']);
});

test('two appointments that want the same alarm produce one', () => {
  const twin = { ...dentist, id: 'a2', title: 'Physio' };
  assert.deepEqual(alarmsFor([dentist, twin], NOW, { leadMinutes: 0 }), ['2026-10-01 16:30']);
});

test('results are soonest first and capped', () => {
  const early = { id: 'e', title: 'Blood test', date: '2026-10-01', time: '09:00' };
  assert.deepEqual(alarmsFor([dentist, early], NOW, { leadMinutes: 0 }), ['2026-10-01 09:00', '2026-10-01 16:30']);
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: `m${i}`, title: 'Doctor', date: '2026-10-01', time: `${String(8 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`,
  }));
  assert.equal(alarmsFor(many, NOW, { leadMinutes: 0 }).length, MAX_ALARMS);
});

test('an unknown lead falls back to an hour rather than to nothing or to NaN', () => {
  assert.deepEqual(alarmsFor([dentist], NOW, { leadMinutes: 37 }), ['2026-10-01 15:30']);
  assert.deepEqual(alarmsFor([dentist], NOW, {}), ['2026-10-01 15:30']);
  assert.deepEqual(ALARM_LEAD_MINUTES, [0, 15, 30, 60, 120]);
});

test('garbage in the event list is skipped, not thrown', () => {
  assert.deepEqual(alarmsFor([null, undefined, 5, {}, { title: 'Dentist' }, dentist], NOW, { leadMinutes: 0 }), ['2026-10-01 16:30']);
  assert.deepEqual(alarmsFor(undefined, NOW), []);
});

test('feed state: revoked, expired and missing all read as not-there', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  assert.equal(alarmFeedState({ familyId: 'f' }, now), 'active');
  assert.equal(alarmFeedState({ familyId: 'f', revoked: true }, now), 'revoked');
  assert.equal(alarmFeedState({ familyId: 'f', expiresAt: '2026-09-01T00:00:00Z' }, now), 'expired');
  assert.equal(alarmFeedState({ familyId: 'f', expiresAt: 'garbage' }, now), 'revoked');
  assert.equal(alarmFeedState({}, now), 'missing');
  assert.equal(alarmFeedState(null, now), 'missing');
});
