// Standalone assertion test for familyDates.ts — same convention as
// eventRelevance.test.ts:
//   npx tsx src/utils/familyDates.test.ts
// It exits non-zero on failure.
//
// Focused on the 2026-08-19 addition: buildCalendarMedicalChecks and
// buildCalendarAnniversaries now also scan the shared CalendarEvent list via
// eventKeywordFlags.ts, so a hand-typed reminder with no structured record
// behind it (Rory's diabetes-sensor example) still surfaces on the right
// Family Calendar panel. The care/referral/AnniversaryRecord paths already
// existed before this change and are only lightly re-checked here to make
// sure adding the events param didn't disturb them.
import assert from 'node:assert';
import {
  buildCalendarMedicalChecks,
  buildCalendarAnniversaries,
  buildCalendarExtendedBirthdays,
  buildCalendarVacations,
} from './familyDates';
import type { CalendarEvent, FamilyMember, AnniversaryRecord, ExtendedBirthday } from '../types';

const NOW = new Date('2026-08-19T09:00:00');

function makeMember(id: string, name: string): FamilyMember {
  return { id, name, role: 'Child', avatarColor: 'bg-blue-500', clothingSizes: {}, documents: [] };
}

function makeEvent(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'date'>): CalendarEvent {
  return { category: 'Other', remindMe: false, ...partial };
}

const Ganga = makeMember('m-Ganga', 'Ganga');

// ── medical checks: a keyword-flagged calendar event with no care/referral
//    record behind it must still appear ──────────────────────────────────
{
  const events = [
    makeEvent({ id: 'ev-sensor', title: 'Sensor', date: '2026-08-25', memberIds: ['m-Ganga'] }),
  ];
  const checks = buildCalendarMedicalChecks([Ganga], events, NOW);
  const flagged = checks.find((c) => c.id === 'calendar-ev-sensor');
  assert.ok(flagged, 'a bare "Sensor" calendar event must produce a Medical checks entry — no care/referral record needed');
  assert.strictEqual(flagged!.source, 'calendar', 'its source must be "calendar", not "care" or "referral"');
  assert.strictEqual(flagged!.memberId, 'm-Ganga', 'the tagged member must be resolved by id');
  assert.strictEqual(flagged!.memberName, 'Ganga', 'the tagged member\'s name must be used');
  assert.strictEqual(flagged!.status, 'due-soon', '6 days out must be due-soon (within the 45-day window)');
}

// ── medical checks: an untagged flagged event falls back to a family-level
//    row rather than being dropped ────────────────────────────────────────
{
  const events = [makeEvent({ id: 'ev-dentist', title: "Dentist", date: '2026-09-01' })];
  const checks = buildCalendarMedicalChecks([Ganga], events, NOW);
  const flagged = checks.find((c) => c.id === 'calendar-ev-dentist');
  assert.ok(flagged, 'an untagged medical-sounding event must still be included');
  assert.strictEqual(flagged!.memberId, '', 'an untagged event must not be misattributed to a member');
  assert.strictEqual(flagged!.memberName, 'Family', 'an untagged event must fall back to a Family label');
}

// ── medical checks: status thresholds (due-soon / ok), and a past-dated
//    flagged event is DROPPED, not shown "overdue" forever ─────────────────
// Rory (2026-08-19, live screenshot): the Medical checks panel was flooded
// with old flagged calendar events stuck as "Overdue" indefinitely. Unlike a
// referral (status stays 'booked' until someone resolves it — genuinely
// still outstanding), a plain calendar event carries no such state, so once
// its date passes there is no real "overdue" signal left to give.
{
  const events = [
    makeEvent({ id: 'ev-past', title: 'Blood test', date: '2026-08-01' }), // 18 days in the past
    makeEvent({ id: 'ev-far', title: 'Blood test far out', date: '2027-08-01' }), // ~1 year out
  ];
  const checks = buildCalendarMedicalChecks([Ganga], events, NOW);
  assert.ok(!checks.some((c) => c.id === 'calendar-ev-past'), 'a past-dated flagged calendar event must be dropped, not shown as overdue forever');
  assert.strictEqual(checks.find((c) => c.id === 'calendar-ev-far')!.status, 'ok', 'a far-future flagged event must be ok, not due-soon');
}

// ── medical checks: a real referral still shows "overdue" indefinitely —
//    only the free-text calendar-event path changed, not referrals ────────
{
  const memberWithReferral: FamilyMember = {
    ...Ganga,
    id: 'm-referral',
    referrals: [{ id: 'r-1', kind: 'Specialist', status: 'booked', appointmentDate: '2026-08-01' }] as any,
  };
  const checks = buildCalendarMedicalChecks([memberWithReferral], [], NOW);
  const referral = checks.find((c) => c.id === 'referral-r-1');
  assert.ok(referral, 'a booked referral must still appear');
  assert.strictEqual(referral!.status, 'overdue', 'a booked referral past its date must still show overdue — it has a real "still outstanding" state, unlike a calendar event');
}

// ── medical checks: a non-matching event must not appear at all ────────────
{
  const events = [makeEvent({ id: 'ev-offsite', title: 'Team offsite', date: '2026-08-25' })];
  const checks = buildCalendarMedicalChecks([Ganga], events, NOW);
  assert.ok(!checks.some((c) => c.id === 'calendar-ev-offsite'), 'an unrelated calendar event must not be pulled into Medical checks');
}

// ── medical checks: omitting events entirely must not throw (default param) ─
{
  assert.doesNotThrow(() => buildCalendarMedicalChecks([Ganga]), 'events must be optional, defaulting to none');
}

// ── anniversaries: existing AnniversaryRecord behaviour is undisturbed by
//    the new events param ─────────────────────────────────────────────────
{
  const records: AnniversaryRecord[] = [
    { id: 'a-1', title: 'Wedding anniversary', kind: 'Wedding', date: '08-24', originalYear: 2015, createdAt: '2020-01-01' },
  ];
  const list = buildCalendarAnniversaries(records, [], NOW);
  assert.strictEqual(list.length, 1, 'a confirmed AnniversaryRecord must still appear with no events passed');
  assert.strictEqual(list[0].years, 11, 'the recurring years-since calculation must be unaffected');
}

// ── anniversaries: a flagged upcoming calendar event is included, dated
//    literally, with no assumed recurrence ─────────────────────────────────
{
  const events = [makeEvent({ id: 'ev-vday', title: "Valentine's Day dinner", date: '2026-08-22' })];
  const list = buildCalendarAnniversaries([], events, NOW);
  const flagged = list.find((a) => a.id === 'calendar-ev-vday');
  assert.ok(flagged, 'a flagged calendar event must appear in the anniversaries list');
  assert.strictEqual(flagged!.kind, 'Other', 'a flagged calendar event has no confirmed kind');
  assert.strictEqual(flagged!.years, null, 'a flagged calendar event has no known origin year, so years must be null');
  assert.strictEqual(flagged!.daysUntil, 3, 'daysUntil must be computed off its literal date');
}

// ── anniversaries: a flagged but already-past event must be dropped, not
//    treated as recurring ──────────────────────────────────────────────────
{
  const events = [makeEvent({ id: 'ev-past', title: 'Our anniversary', date: '2026-01-01' })];
  const list = buildCalendarAnniversaries([], events, NOW);
  assert.ok(!list.some((a) => a.id === 'calendar-ev-past'), 'a past-dated flagged event must not linger — it is not assumed to recur');
}

// ── extended birthdays: basic next-occurrence + age math ────────────────────
{
  const list: ExtendedBirthday[] = [
    { id: 'eb-1', name: 'Grandma Sue', relationship: 'Grandmother', date: '08-24', originalYear: 1958, createdAt: '2020-01-01' },
    { id: 'eb-2', name: 'Auntie Jo', date: '01-01', createdAt: '2020-01-01' }, // no originalYear
  ];
  const out = buildCalendarExtendedBirthdays(list, NOW);
  const sue = out.find((b) => b.id === 'eb-1');
  assert.ok(sue, 'Grandma Sue must appear');
  assert.strictEqual(sue!.daysUntil, 5, 'daysUntil must be computed off the MM-DD, same math as member birthdays');
  assert.strictEqual(sue!.turningAge, NOW.getFullYear() - 1958, 'turningAge must be derived from originalYear');
  const jo = out.find((b) => b.id === 'eb-2');
  assert.ok(jo, 'Auntie Jo must appear even with no originalYear');
  assert.strictEqual(jo!.turningAge, null, 'turningAge must be null when originalYear is unknown — never guessed');
}

// ── extended birthdays: omitting the list entirely must not throw ──────────
{
  assert.doesNotThrow(() => buildCalendarExtendedBirthdays([]), 'an empty list must be handled cleanly');
}

// ── vacation countdown: only Travel-category events, future-only, no cap ───
{
  const events = [
    makeEvent({ id: 'ev-trip', title: 'Flight to Cape Town', date: '2026-08-25', category: 'Travel' }),
    makeEvent({ id: 'ev-trip-far', title: 'Flight to Vienna', date: '2028-01-01', category: 'Travel' }), // ~1.4 years out — must NOT be capped, unlike School dates
    makeEvent({ id: 'ev-trip-past', title: 'Old flight', date: '2026-01-01', category: 'Travel' }),
    makeEvent({ id: 'ev-school', title: 'Term starts', date: '2026-08-25', category: 'School' }),
  ];
  const vacations = buildCalendarVacations(events, NOW);
  assert.ok(vacations.some((v) => v.id === 'ev-trip'), 'an upcoming Travel-category event must appear');
  assert.ok(vacations.some((v) => v.id === 'ev-trip-far'), 'a far-future Travel event must still appear — vacations have no upper horizon');
  assert.ok(!vacations.some((v) => v.id === 'ev-trip-past'), 'a past Travel event must be dropped');
  assert.ok(!vacations.some((v) => v.id === 'ev-school'), 'a non-Travel-category event must never appear here');
}

console.log('familyDates.test.ts: all assertions passed');
