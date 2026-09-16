// Standalone assertion test for importantEvents.ts:
//   npx tsx src/utils/importantEvents.test.ts
// It exits non-zero on failure.
//
// What this guards: the family's choice about importance always wins, a
// medical appointment is important without anyone writing a flag, the switch
// stores nothing when it agrees with the app, "coming up" includes the booked
// referral rows the calendar derives, and a business space never lists
// anything medical. Also the two chat paths: marking an existing event, and a
// new appointment from chat. Fictional demo family throughout.
import assert from 'node:assert';
import {
  calendarForChat,
  daysToGoLabel,
  importantComingUp,
  importantOverride,
  isAutoImportant,
  isImportantEvent,
  withImportant,
} from './importantEvents';
import { applyCalendarEdits } from './aiApply';
import { buildPatch } from './aiDestructive';
import type { CalendarEvent, FamilyMember, ReferralRecord } from '../types';

const TODAY = '2026-09-14';

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'date'>): CalendarEvent {
  return { category: 'Other', remindMe: false, ...partial };
}

function referral(partial: Partial<ReferralRecord> & Pick<ReferralRecord, 'id'>): ReferralRecord {
  return {
    kind: 'Referral', fileName: 'letter.pdf', fileType: 'application/pdf', fileSize: 1,
    storagePath: 'x', downloadUrl: 'x', addedAt: '2026-09-01T00:00:00Z', ...partial,
  };
}

function member(id: string, name: string, referrals: ReferralRecord[] = []): FamilyMember {
  return { id, name, role: 'Child', referrals } as unknown as FamilyMember;
}

const pediatrician = event({ id: 'e-ped', title: 'Pediatrician — Ben', date: '2026-09-26', time: '09:30', category: 'Appointment' });
const schoolPlay = event({ id: 'e-play', title: "Mia's school play", date: '2026-09-20', time: '16:00', category: 'School' });
const football = event({ id: 'e-foot', title: 'Football practice', date: '2026-09-16', time: '17:00' });

// ── the rule: an explicit choice wins, otherwise medical means important ────
{
  assert.equal(isImportantEvent(pediatrician), true, 'a medical appointment is important with no flag stored');
  assert.equal(isImportantEvent(football), false, 'CONTROL: an ordinary event is not');
  assert.equal(isImportantEvent({ ...schoolPlay, important: true }), true, 'marked by the family: true wins');
  assert.equal(isImportantEvent({ ...pediatrician, important: false }), false, 'un-marked by the family: false wins over the medical rule');
  assert.equal(isImportantEvent(event({ id: 'x', title: 'Termin', date: TODAY, description: 'Zahnärztin, bitte e-card mitnehmen' })), true,
    'the description counts as well as the title');
  assert.equal(isAutoImportant(pediatrician), true);
  assert.equal(isAutoImportant({ ...pediatrician, important: false } as CalendarEvent), true, 'the automatic answer ignores the stored choice');
}

// ── business spaces: no automatic rule ──────────────────────────────────────
{
  assert.equal(isImportantEvent(pediatrician, { business: true }), false, 'no "looks medical" rule in a business space');
  assert.equal(isImportantEvent({ ...football, important: true }, { business: true }), true, 'a hand-marked event still counts');
}

// ── the switch stores only a disagreement with the app ──────────────────────
{
  assert.equal(importantOverride(pediatrician, true), undefined, 'switching ON a medical appointment stores nothing — it already is');
  assert.equal(importantOverride(pediatrician, false), false, 'switching it OFF stores important:false');
  assert.equal(importantOverride(schoolPlay, true), true, 'switching ON an ordinary event stores important:true');
  assert.equal(importantOverride(schoolPlay, false), undefined, 'leaving an ordinary event off stores nothing');
  assert.equal(importantOverride(pediatrician, true, { business: true }), true, 'in a business space every ON is a real choice');

  const marked = withImportant(schoolPlay, true);
  assert.equal(marked.important, true);
  const cleared = withImportant(marked, undefined);
  assert.ok(!('important' in cleared), 'clearing REMOVES the key (what the shared-save merge reads as a delete), never writes undefined');
  assert.equal(cleared.title, schoolPlay.title, 'the rest of the event is kept');
  assert.equal(withImportant(pediatrician, false).important, false);
}

// ── coming up: window, order, who, referrals ────────────────────────────────
{
  const ben = member('ben', 'Ben Muster');
  const mia = member('mia', 'Mia Muster', [
    referral({ id: 'r-ortho', reason: 'Orthopaedic surgeon', providerName: 'Dr Beispiel', status: 'booked', appointmentDate: '2026-09-22', appointmentTime: '10:30' }),
    referral({ id: 'r-open', reason: 'Eye test', status: 'open' }),
    referral({ id: 'r-later', reason: 'Dermatology', status: 'booked', appointmentDate: '2026-11-30' }),
  ]);
  const members = [ben, mia];
  const events = [
    pediatrician,                                                           // day 12, untagged: "Ben" is in the title
    { ...schoolPlay, important: true, memberIds: ['mia'] },                 // day 6, marked
    football,                                                               // not important
    event({ id: 'e-today', title: 'Dentist', date: TODAY, memberIds: ['mia'] }),                 // day 0, no time
    event({ id: 'e-today2', title: 'Blood test', date: TODAY, time: '08:00', memberIds: ['ben'] }), // day 0, 08:00
    event({ id: 'e-past', title: 'Dentist', date: '2026-09-13' }),          // yesterday
    event({ id: 'e-far', title: 'Dentist', date: '2026-10-15' }),           // day 31
    event({ id: 'e-edge', title: 'Hospital appointment', date: '2026-10-14' }), // day 30: inside
    { ...pediatrician, id: 'e-unmarked', date: '2026-09-15', important: false },
  ];

  const items = importantComingUp(events, members, TODAY);
  assert.deepEqual(items.map((i) => i.id), ['e-today', 'e-today2', 'e-play', 'r-ortho', 'e-ped', 'e-edge'],
    'soonest first, untimed before timed on the same day; yesterday, day 31, un-marked and ordinary events left out');
  assert.deepEqual(items.map((i) => i.daysUntil), [0, 0, 6, 8, 12, 30]);

  const ortho = items.find((i) => i.id === 'r-ortho')!;
  assert.equal(ortho.source, 'referral', 'a booked referral appointment is included as a derived row');
  assert.equal(ortho.time, '10:30');
  assert.deepEqual(ortho.memberIds, ['mia']);
  assert.ok(ortho.title.includes('Orthopaedic surgeon'));
  assert.ok(!items.some((i) => i.id === 'r-open' || i.id === 'r-later'), 'an open referral, or one outside the window, is not');

  assert.deepEqual(items.find((i) => i.id === 'e-ped')!.memberIds, ['ben'], 'an untagged import is matched to the person its title names');
  assert.equal(new Set(items.map((i) => i.key)).size, items.length, 'keys are unique');

  assert.deepEqual(importantComingUp(events, members, TODAY, { days: 7 }).map((i) => i.id), ['e-today', 'e-today2', 'e-play'], 'the window is configurable');
  assert.ok(!importantComingUp(events, members, TODAY, { includeReferrals: false }).some((i) => i.source === 'referral'),
    'referral rows follow the Medical checks switch');

  // A real event that already stands for the referral's visit replaces the derived row.
  const covered = [...events, event({ id: 'e-ortho', title: 'Orthopädie Dr. Beispiel', date: '2026-09-22', time: '10:30', category: 'Appointment', memberIds: ['mia'] })];
  const once = importantComingUp(covered, members, TODAY).filter((i) => i.date === '2026-09-22');
  assert.deepEqual(once.map((i) => i.id), ['e-ortho'], 'the same visit is listed once');

  // Business: nothing medical, whoever marked it, and no referrals.
  const business = importantComingUp([...events, { ...football, important: true }], members, TODAY, { business: true });
  assert.deepEqual(business.map((i) => i.id), ['e-foot', 'e-play'], 'only hand-marked, non-medical events');
  const markedMedical = importantComingUp([{ ...pediatrician, important: true }], members, TODAY, { business: true });
  assert.deepEqual(markedMedical, [], 'a medical event is never listed in a business space, even when marked');
  assert.equal(importantComingUp([{ ...pediatrician, important: true }], [ben], TODAY).length, 1, 'CONTROL: the same event is listed in a family space');

  assert.deepEqual(importantComingUp([], [], TODAY), [], 'nothing coming up is an empty list (the card hides)');
}

// ── labels ─────────────────────────────────────────────────────────────────
assert.equal(daysToGoLabel(0), 'Today');
assert.equal(daysToGoLabel(1), 'Tomorrow');
assert.equal(daysToGoLabel(9), 'In 9 days');

// ── chat: what the assistant is shown ──────────────────────────────────────
{
  const shown = calendarForChat([pediatrician, { ...schoolPlay, important: true }, football, { ...pediatrician, id: 'e-off', important: false }]);
  assert.deepEqual(shown.map((e) => e.important), [true, true, undefined, undefined]);
  assert.ok(!('important' in shown[3]), 'an un-marked appointment reads like any ordinary event, not as important:false');
  assert.equal(calendarForChat([pediatrician], { business: true })[0].important, undefined, 'no automatic mark in a business space');
}

// ── chat: "mark my appointment as important" is an update ───────────────────
{
  assert.deepEqual(buildPatch('calendar_event', { important: 'true' }), { important: true });
  assert.deepEqual(buildPatch('calendar_event', { important: true as unknown as string }), { important: true }, 'a real boolean from the model works too');
  assert.deepEqual(buildPatch('calendar_event', { important: 'no' }), { important: false });
  assert.deepEqual(buildPatch('calendar_event', { important: 'maybe' }), {}, 'a garbled value is dropped, never guessed');
  assert.deepEqual(buildPatch('calendar_event', { title: 'Psychiatry', important: 'false' }), { title: 'Psychiatry', important: false });
  assert.deepEqual(buildPatch('passport', { important: 'true' } as Record<string, string>), {}, 'CONTROL: other kinds do not take it');
}

// ── chat: a new appointment is important without the flag ───────────────────
{
  const members = [member('ben', 'Ben Muster'), member('mia', 'Mia Muster')];
  const add = (e: Record<string, unknown>) => applyCalendarEdits([], [{ kind: 'calendar_event', title: '', date: '2026-10-06', category: 'Appointment', ...e } as never], members)[0];

  const psych = add({ title: 'Psychiatry — Dr Beispiel', time: '09:00', memberNames: ['Mia Muster'] });
  assert.ok(!('important' in psych), 'a new medical appointment stores no flag');
  assert.equal(isImportantEvent(psych), true, '…and is important all the same');

  const psychFlagged = add({ title: 'Psychiatry — Dr Beispiel', important: true });
  assert.ok(!('important' in psychFlagged), 'a redundant important:true from the model is not written either');

  const play = add({ title: 'Parents evening', category: 'School', important: true });
  assert.equal(play.important, true, 'asked to mark a non-medical event: stored');

  const off = add({ title: 'Dentist — Ben', important: false });
  assert.equal(off.important, false, 'asked NOT to mark a medical one: stored as false');

  const plain = add({ title: 'Parents evening', category: 'School' });
  assert.ok(!('important' in plain), 'CONTROL: nothing said, nothing stored');

  const business = applyCalendarEdits([], [{ kind: 'calendar_event', title: 'Dentist', date: '2026-10-06', category: 'Appointment', important: true } as never], members, { business: true })[0];
  assert.equal(business.important, true, 'in a business space a mark is always a real choice');
}

console.log('importantEvents.test.ts: all assertions passed');
