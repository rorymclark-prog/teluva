// Standalone assertion test for untaggedAppointments.ts:
//   npx tsx src/utils/untaggedAppointments.test.ts
// It exits non-zero on failure.
//
// Rory, 2026-09-13: "Orthopädie Dr. X" imported from Google, tagged to nobody,
// so on nobody's profile. What this guards: exactly the upcoming,
// medical-looking, unowned appointments are asked about; the suggestion is
// the signed-in adult (or the only adult) and never anyone else; tagging
// changes one field on one event and drops nothing. Fictional people.
import assert from 'node:assert';
import {
  isUntaggedMedicalAppointment,
  untaggedMedicalAppointments,
  suggestAppointmentOwner,
  tagEventToMember,
  readDismissedUntagged,
  writeDismissedUntagged,
} from './untaggedAppointments';
import type { CalendarEvent, FamilyMember } from '../types';

{
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

const TODAY = '2026-09-13';
const alex = { id: 'm1', name: 'Alex Muster', role: 'Parent' };
const sam = { id: 'm3', name: 'Sam Muster', role: 'Parent' };
const mia = { id: 'm2', name: 'Mia Muster', role: 'Child' };
const members = [alex, mia] as unknown as FamilyMember[];

function ev(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'date'>): CalendarEvent {
  return { category: 'Appointment', remindMe: true, memberIds: [], ...partial };
}

const ortho = ev({ id: 'gcal-o', title: 'Orthopädie Dr. Beispiel', date: '2026-09-22', time: '10:30' });
const psych = ev({ id: 'gcal-p', title: 'Psychiatrie Ambulanz', date: '2026-10-06', time: '09:00' });
const events: CalendarEvent[] = [
  psych,
  ortho,
  ev({ id: 'past', title: 'Orthopädie Nachkontrolle', date: '2026-08-01' }), // past: left alone
  ev({ id: 'tagged', title: 'Psychiatrie', date: '2026-09-30', memberIds: ['m1'] }), // already someone's
  ev({ id: 'byname', title: 'Mia Zahnarzt', date: '2026-09-25' }), // name in title resolves it
  ev({ id: 'bank', title: 'Termin Bank', date: '2026-09-20', category: 'Other' }), // not medical
  ev({ id: 'party', title: 'Birthday party', date: '2026-09-21', category: 'Other' }),
];

// ── which ones are asked about ─────────────────────────────────────────────
{
  assert.equal(isUntaggedMedicalAppointment(ortho, members), true);
  assert.equal(isUntaggedMedicalAppointment(events.find((e) => e.id === 'tagged')!, members), false, 'tagged: not asked');
  assert.equal(isUntaggedMedicalAppointment(events.find((e) => e.id === 'byname')!, members), false, 'name in title: already resolved');
  assert.equal(isUntaggedMedicalAppointment(events.find((e) => e.id === 'bank')!, members), false, '"Termin" alone is not medical');

  const list = untaggedMedicalAppointments(events, members, TODAY);
  assert.deepEqual(list.map((e) => e.id), ['gcal-o', 'gcal-p'], 'upcoming, medical, unowned — soonest first');

  const afterDismiss = untaggedMedicalAppointments(events, members, TODAY, new Set(['gcal-o']));
  assert.deepEqual(afterDismiss.map((e) => e.id), ['gcal-p'], '"Not now" hides just that one');
}

// ── who is suggested (a highlighted button, never a tag) ───────────────────
{
  assert.equal(suggestAppointmentOwner(members, 'm1'), 'm1', 'the signed-in adult');
  assert.equal(suggestAppointmentOwner(members, 'm2'), 'm1', 'signed in as a child: fall back to the only adult');
  assert.equal(suggestAppointmentOwner(members, undefined), 'm1', 'unknown signer, one adult: that adult');
  const twoParents = [alex, sam, mia] as unknown as FamilyMember[];
  assert.equal(suggestAppointmentOwner(twoParents, undefined), undefined, 'two adults and no idea who is signed in: suggest nobody');
  assert.equal(suggestAppointmentOwner(twoParents, 'm3'), 'm3');
  assert.equal(suggestAppointmentOwner(twoParents, 'nobody'), undefined, 'an id that is not a member suggests nobody');
}

// ── tagging changes one field on one event, and keeps everything else ─────
{
  const rich = ev({
    id: 'gcal-o', title: 'Orthopädie Dr. Beispiel', date: '2026-09-22', time: '10:30',
    description: 'Bring X-rays', googleSynced: true, category: 'Appointment',
  } as Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'date'>);
  const list = [rich, psych];
  const next = tagEventToMember(list, 'gcal-o', 'm1');
  assert.equal(next.length, 2, 'no event dropped (the whole list is what gets saved)');
  assert.deepEqual(next[0], { ...rich, memberIds: ['m1'] }, 'every other key survives');
  assert.equal(next[1], psych, 'other events are the same objects, untouched');
  assert.deepEqual(rich.memberIds, [], 'the input is not mutated');
  assert.equal(untaggedMedicalAppointments(next, members, TODAY).some((e) => e.id === 'gcal-o'), false, 'once tagged it stops being asked about');

  // CONTROL — a rebuild that forgets to spread loses fields, and the
  // deepEqual above is the assertion that would catch it.
  const forgetful = list.map((e) => (e.id === 'gcal-o' ? { id: e.id, title: e.title, date: e.date, category: e.category, remindMe: e.remindMe, memberIds: ['m1'] } : e));
  assert.throws(() => assert.deepEqual(forgetful[0], { ...rich, memberIds: ['m1'] }), 'CONTROL: a non-spreading rebuild drops time/description/googleSynced');
}

// ── "Not now" is per space and survives a reload ───────────────────────────
{
  writeDismissedUntagged('famA', new Set(['gcal-o']));
  assert.deepEqual([...readDismissedUntagged('famA')], ['gcal-o']);
  assert.deepEqual([...readDismissedUntagged('famB')], [], "one space's dismissals never hide another's");
  assert.notEqual((globalThis as any).localStorage.getItem('family_untaggedApptDismissed_famA'), null, 'family_ prefix: cleared on logout');
  const many = new Set(Array.from({ length: 250 }, (_, i) => `e${i}`));
  writeDismissedUntagged('famA', many);
  assert.equal(readDismissedUntagged('famA').size, 200, 'capped so it cannot grow forever');
  (globalThis as any).localStorage.setItem('family_untaggedApptDismissed_famC', 'not json');
  assert.equal(readDismissedUntagged('famC').size, 0, 'garbage in storage reads as nothing dismissed');
}

console.log('untaggedAppointments: which to ask, who to suggest, tag-without-loss, per-space Not now OK (1 control fails as it should)');
