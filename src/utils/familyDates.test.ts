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
import { buildCalendarMedicalChecks, buildCalendarAnniversaries } from './familyDates';
import type { CalendarEvent, FamilyMember, AnniversaryRecord } from '../types';

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

// ── medical checks: status thresholds (overdue / due-soon / ok) ────────────
{
  const events = [
    makeEvent({ id: 'ev-overdue', title: 'Blood test', date: '2026-08-01' }), // 18 days in the past
    makeEvent({ id: 'ev-far', title: 'Blood test far out', date: '2027-08-01' }), // ~1 year out
  ];
  const checks = buildCalendarMedicalChecks([Ganga], events, NOW);
  assert.strictEqual(checks.find((c) => c.id === 'calendar-ev-overdue')!.status, 'overdue', 'a past-dated flagged event must be overdue');
  assert.strictEqual(checks.find((c) => c.id === 'calendar-ev-far')!.status, 'ok', 'a far-future flagged event must be ok, not due-soon');
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

console.log('familyDates.test.ts: all assertions passed');
