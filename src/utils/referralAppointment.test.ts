// Standalone assertion test for referralAppointment.ts:
//   npx tsx src/utils/referralAppointment.test.ts
// It exits non-zero on failure.
//
// Rory, 2026-09-13: an orthopaedic-surgeon appointment this month and a
// psychiatry one in a few weeks, both on paper, neither on the calendar. What
// this guards: a referral with a booked date reaches the calendar grid as a
// derived row, the same visit is never shown twice, and the status follows
// the date without ever undoing a 'done'. Fictional people throughout.
import assert from 'node:assert';
import {
  appointmentMatchesEvent,
  buildReferralAppointments,
  referralAppointmentTitle,
  referralPatchWithStatus,
  referralStatusOnSave,
  referralStatusForAppointment,
} from './referralAppointment';
import { buildOccasionSeries, buildVirtualEvents } from './virtualEvents';
import { buildCalendarMedicalChecks } from './familyDates';
import { applyCalendarEdits } from './aiApply';
import type { CalendarEvent, FamilyMember, ReferralRecord } from '../types';

const TODAY = '2026-09-13';

function referral(partial: Partial<ReferralRecord> & Pick<ReferralRecord, 'id'>): ReferralRecord {
  return {
    kind: 'Referral', fileName: 'letter.pdf', fileType: 'application/pdf', fileSize: 1,
    storagePath: 'x', downloadUrl: 'x', addedAt: '2026-09-01T00:00:00Z', ...partial,
  };
}

function member(id: string, name: string, referrals: ReferralRecord[] = [], role = 'Parent'): FamilyMember {
  return { id, name, role, referrals } as unknown as FamilyMember;
}

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'date'>): CalendarEvent {
  return { category: 'Appointment', remindMe: true, ...partial };
}

// ── status follows the appointment date ─────────────────────────────────────
{
  assert.equal(referralStatusForAppointment('open', '2026-09-22'), 'booked', 'a date on an open referral books it');
  assert.equal(referralStatusForAppointment(undefined, '2026-09-22'), 'booked', 'a date on a status-less referral books it');
  assert.equal(referralStatusForAppointment('booked', '2026-09-22'), 'booked');
  assert.equal(referralStatusForAppointment('done', '2026-09-22'), 'done', 'a date must never pull a done referral back to booked');
  assert.equal(referralStatusForAppointment('booked', ''), 'open', 'clearing the date re-opens a booked referral');
  assert.equal(referralStatusForAppointment('booked', undefined), 'open');
  assert.equal(referralStatusForAppointment('done', ''), 'done', 'clearing the date leaves done alone');
  assert.equal(referralStatusForAppointment(undefined, undefined), 'open');
  assert.equal(referralStatusForAppointment('open', '   '), 'open', 'whitespace is not a date');
}

// ── the Referrals form: only a CHANGED date moves the status ───────────────
{
  assert.equal(referralStatusOnSave(undefined, undefined, '2026-09-22'), 'booked', 'a new referral with a date saves booked');
  assert.equal(referralStatusOnSave(undefined, undefined, ''), 'open', 'a new referral without a date saves open');
  assert.equal(referralStatusOnSave('open', '', '2026-09-22'), 'booked', 'typing a date books it');
  assert.equal(referralStatusOnSave('booked', '2026-09-22', ''), 'open', 'clearing the date re-opens it');
  assert.equal(referralStatusOnSave('done', '2026-09-22', '2026-09-29'), 'done', 'moving the date on a done referral leaves it done');
  assert.equal(referralStatusOnSave('booked', undefined, ''), 'booked',
    'a referral marked Booked by hand with no date yet stays booked when something else is edited');
  assert.equal(referralStatusOnSave('open', '2026-09-22', '2026-09-22'), 'open',
    'an unchanged date respects a status the user set by hand');
}

// ── a chat update that sets only the date also books it ────────────────────
{
  assert.deepStrictEqual(referralPatchWithStatus({ status: 'open' }, { appointmentDate: '2026-09-22', appointmentTime: '10:30' }),
    { appointmentDate: '2026-09-22', appointmentTime: '10:30', status: 'booked' });
  assert.deepStrictEqual(referralPatchWithStatus({ status: 'done' }, { appointmentDate: '2026-09-22' }),
    { appointmentDate: '2026-09-22', status: 'done' }, 'done is never undone');
  assert.deepStrictEqual(referralPatchWithStatus({ status: 'booked' }, { appointmentDate: '' }),
    { appointmentDate: '', status: 'open' }, 'clearing the date re-opens');
  assert.deepStrictEqual(referralPatchWithStatus({ status: 'open' }, { appointmentDate: '2026-09-22', status: 'open' }),
    { appointmentDate: '2026-09-22', status: 'open' }, 'an explicit status in the patch wins');
  assert.deepStrictEqual(referralPatchWithStatus({ status: 'open' }, { notes: 'x' }), { notes: 'x' },
    'a patch that does not touch the date does not touch the status');
}

// ── title reads "what — who" ───────────────────────────────────────────────
{
  assert.equal(referralAppointmentTitle({ kind: 'Referral', reason: 'Orthopaedic surgeon', providerName: 'Dr Example' }), 'Orthopaedic surgeon — Dr Example');
  assert.equal(referralAppointmentTitle({ kind: 'Specialist letter' }), 'Specialist letter', 'falls back to the kind');
}

const ortho = referral({ id: 'r1', reason: 'Orthopaedic surgeon', providerName: 'Dr Anna Beispiel', status: 'booked', appointmentDate: '2026-09-22', appointmentTime: '10:30' });
const psych = referral({ id: 'r2', reason: 'Psychiatry', providerName: 'Psychiatrische Ambulanz Musterspital', status: 'booked', appointmentDate: '2026-10-06' });
const alex = member('m1', 'Alex Muster', [ortho, psych]);
const mia = member('m2', 'Mia Muster', [], 'Child');
const members = [alex, mia];

// ── booked referrals with a future date become calendar rows ───────────────
{
  const got = buildReferralAppointments(members, [], TODAY);
  assert.deepStrictEqual(got.map((a) => a.referralId), ['r1', 'r2'], 'both booked appointments must reach the calendar');
  assert.equal(got[0].title, 'Orthopaedic surgeon — Dr Anna Beispiel');
  assert.equal(got[0].time, '10:30');
  assert.equal(got[0].memberId, 'm1');
  assert.equal(got[1].time, undefined);
}

// ── only booked, dated, today-or-later referrals ───────────────────────────
{
  const past = referral({ id: 'p', status: 'booked', appointmentDate: '2026-09-01' });
  const open = referral({ id: 'o', status: 'open', appointmentDate: '2026-09-30' });
  const done = referral({ id: 'd', status: 'done', appointmentDate: '2026-09-30' });
  const noDate = referral({ id: 'n', status: 'booked' });
  const badDate = referral({ id: 'b', status: 'booked', appointmentDate: '22.09.2026' });
  const today = referral({ id: 't', status: 'booked', appointmentDate: TODAY, appointmentTime: '25:00' });
  const got = buildReferralAppointments([member('m', 'Sam', [past, open, done, noDate, badDate, today])], [], TODAY);
  assert.deepStrictEqual(got.map((a) => a.referralId), ['t'], 'only a booked referral dated today or later is shown');
  assert.equal(got[0].time, undefined, 'an impossible time is dropped, not shown');
}

// ── a real event for the same visit wins; the derived row steps aside ──────
{
  // Imported from Google, German, untagged: "Orthopädie" shares a stem with
  // "Orthopaedic", so it is the same visit.
  const german = event({ id: 'gcal-1', title: 'Termin Orthopädie', date: '2026-09-22', memberIds: [] });
  assert.deepStrictEqual(buildReferralAppointments(members, [german], TODAY).map((a) => a.referralId), ['r2']);

  // Provider surname in the description is enough too.
  const byProvider = event({ id: 'e2', title: 'Knee', description: 'bei Dr. Beispiel', date: '2026-09-22', memberIds: ['m1'] });
  assert.deepStrictEqual(buildReferralAppointments(members, [byProvider], TODAY).map((a) => a.referralId), ['r2']);

  // A medical entry explicitly tagged to Alex on that day covers it even with no shared word.
  const tagged = event({ id: 'e3', title: 'Ortho', date: '2026-09-22', memberIds: ['m1'], category: 'Other' });
  const taggedAppt = event({ id: 'e3b', title: 'Knee thing', date: '2026-09-22', memberIds: ['m1'] });
  assert.deepStrictEqual(buildReferralAppointments(members, [taggedAppt], TODAY).map((a) => a.referralId), ['r2']);
  assert.deepStrictEqual(
    buildReferralAppointments(members, [tagged], TODAY).map((a) => a.referralId), ['r1', 'r2'],
    'a non-appointment, non-medical tagged entry with no shared word does NOT cover the visit',
  );

  // Someone else's appointment that day must NOT hide Alex's.
  const mias = event({ id: 'e4', title: 'Orthopädie', date: '2026-09-22', memberIds: ['m2'] });
  assert.deepStrictEqual(buildReferralAppointments(members, [mias], TODAY).map((a) => a.referralId), ['r1', 'r2']);

  // A different day must not hide it either.
  const otherDay = event({ id: 'e5', title: 'Orthopädie', date: '2026-09-23' });
  assert.deepStrictEqual(buildReferralAppointments(members, [otherDay], TODAY).map((a) => a.referralId), ['r1', 'r2']);

  // An unrelated untagged event that day ("Parents' evening") must not hide it.
  const unrelated = event({ id: 'e6', title: "Parents' evening", date: '2026-09-22', category: 'School' });
  assert.deepStrictEqual(buildReferralAppointments(members, [unrelated], TODAY).map((a) => a.referralId), ['r1', 'r2']);
}

// ── appointmentMatchesEvent: names are never the shared word ───────────────
{
  const facts = { date: '2026-09-22', memberId: 'm2', title: 'Mia dentist' };
  assert.ok(!appointmentMatchesEvent(event({ id: 'x', title: 'Mia — eye test', date: '2026-09-22' }), facts, members),
    'two visits for one person on one day share only her name — not the same appointment');
  assert.ok(appointmentMatchesEvent(event({ id: 'y', title: 'Dentist', date: '2026-09-22' }), facts, members));
  assert.ok(appointmentMatchesEvent(event({ id: 'z', title: 'Psychiater', date: '2026-10-06' }),
    { date: '2026-10-06', memberId: 'm1', title: 'Psychiatry appointment' }, members),
    'English "psychiatry" meets Austrian "Psychiater"');
  assert.ok(!appointmentMatchesEvent(event({ id: 'g', title: 'Appointment', date: '2026-10-06' }),
    { date: '2026-10-06', memberId: 'm1', title: 'Appointment' }, members),
    'generic words alone ("Appointment") never make two entries the same visit');
}

// ── projected onto the grid: in range only, read-only, never exported ─────
{
  const rows = buildReferralAppointments(members, [], TODAY);
  const sept = buildVirtualEvents({ referralAppointments: rows }, '2026-09-01', '2026-09-30');
  assert.equal(sept.length, 1, 'only the September appointment falls in the September grid');
  assert.equal(sept[0].kind, 'referralAppointment');
  assert.equal(sept[0].date, '2026-09-22');
  assert.equal(sept[0].detail, '10:30 · Alex Muster');
  assert.deepStrictEqual(sept[0].memberIds, ['m1']);
  assert.ok(sept[0].id.startsWith('virtual:'), 'namespaced so it can never collide with a stored event id');
  const oct = buildVirtualEvents({ referralAppointments: rows }, '2026-10-01', '2026-10-31');
  assert.equal(oct[0].detail, 'Alex Muster', 'no time → just the person');
  // Private one-off appointments are not family occasions and must not reach the .ics export.
  assert.equal(buildOccasionSeries({ referralAppointments: rows } as never).length, 0);
}

// ── Medical checks panel: one visit, one row ───────────────────────────────
// A scanned letter now books the referral AND proposes a calendar event, so
// the panel would otherwise list the same orthopaedic visit twice.
{
  const now = new Date(2026, 8, 13);
  const sameVisit = event({ id: 'e1', title: 'Orthopaedic surgeon — Dr Anna Beispiel', date: '2026-09-22', memberIds: ['m1'] });
  const otherVisit = event({ id: 'e2', title: 'Dentist', date: '2026-09-24', memberIds: ['m2'] });
  const rows = buildCalendarMedicalChecks(members, [sameVisit, otherVisit], now);
  assert.deepStrictEqual(
    rows.map((r) => r.id).sort(),
    ['calendar-e2', 'referral-r1', 'referral-r2'],
    'the calendar copy of a booked referral is dropped; an unrelated medical event stays',
  );
  // CONTROL: with the referral NOT booked, the calendar row must come back —
  // proving the dedupe is what removed it, not some other filter.
  const unbooked = [member('m1', 'Alex Muster', [{ ...ortho, status: 'open' }, psych]), mia];
  assert.ok(
    buildCalendarMedicalChecks(unbooked, [sameVisit, otherVisit], now).some((r) => r.id === 'calendar-e1'),
    'CONTROL: an open referral must not hide the calendar event',
  );
}

// ── the assistant never books the same visit twice ─────────────────────────
// The existing entry came from Google, in German, at a different time; the
// proposal came from a scanned letter, in English. Same person, same day.
{
  const existing = [event({ id: 'gcal-9', title: 'Orthopädie Dr. Beispiel', date: '2026-09-22', time: '10:00', memberIds: ['m1'] })];
  const proposal = { kind: 'calendar_event' as const, title: 'Orthopaedic surgeon — Dr Anna Beispiel', date: '2026-09-22', time: '10:30', category: 'Appointment', memberNames: ['Alex Muster'] };
  assert.equal(applyCalendarEdits(existing, [proposal], members).length, 1, 'the same visit must not be added a second time');

  // CONTROL: the same proposal for a different person, or a different day, IS added.
  assert.equal(applyCalendarEdits(existing, [{ ...proposal, memberNames: ['Mia Muster'] }], members).length, 2,
    'CONTROL: another person\'s appointment that day is a new event');
  assert.equal(applyCalendarEdits(existing, [{ ...proposal, date: '2026-09-29' }], members).length, 2,
    'CONTROL: the same wording on another day is a new event');
  // Two different visits for one person on one day are both kept.
  assert.equal(applyCalendarEdits(existing, [{ ...proposal, title: 'Blood test' }], members).length, 2,
    'a different appointment the same day is a new event');
  // Two copies of the same proposal in ONE batch (scan + chat) collapse to one.
  assert.equal(applyCalendarEdits([], [proposal, { ...proposal, time: '10:30', title: 'Orthopaedic surgeon' }], members).length, 1,
    'two proposals for the same visit in one batch collapse to one');
}

console.log('referralAppointment.test.ts: all assertions passed');
