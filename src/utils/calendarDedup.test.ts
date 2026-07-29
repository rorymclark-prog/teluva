import assert from 'node:assert/strict';
import { CalendarEvent } from '../types';
import {
  calendarEventKey, findDuplicateEvent, partitionNewEvents, findExistingDuplicateGroups,
} from './calendarDedup';

const ev = (p: Partial<CalendarEvent> & { id: string; date: string; title: string }): CalendarEvent => ({
  category: 'Other',
  remindMe: false,
  ...p,
});

// --- the key ignores what routes disagree about ---------------------------
{
  // The same appointment arriving from the assistant and from a Google import
  // disagrees on category and member tags. If either were in the key, the
  // duplicate would sail through — which is the whole bug.
  const a = ev({ id: 'a', date: '2026-08-25', time: '15:30', title: 'Dr Steiner', category: 'Appointment', memberIds: ['rory'] });
  const b = ev({ id: 'gcal-x', date: '2026-08-25', time: '15:30', title: 'Dr Steiner', category: 'Other', memberIds: [] });
  assert.equal(calendarEventKey(a), calendarEventKey(b));
}

// --- title comparison is forgiving about case and spacing -----------------
{
  const a = ev({ id: 'a', date: '2026-08-07', time: '20:00', title: 'Klara' });
  const b = ev({ id: 'b', date: '2026-08-07', time: '20:00', title: '  Klara  ' });
  const c = ev({ id: 'c', date: '2026-08-07', time: '20:00', title: 'Klara   Meyer' });
  const d = ev({ id: 'd', date: '2026-08-07', time: '20:00', title: 'Klara Meyer' });
  assert.equal(calendarEventKey(a), calendarEventKey(b));
  assert.equal(calendarEventKey(c), calendarEventKey(d), 'runs of whitespace collapse');
  assert.notEqual(calendarEventKey(a), calendarEventKey(c), 'but a different name is a different event');
}

// --- a missing time and an empty time are the same all-day entry ----------
{
  const a = ev({ id: 'a', date: '2026-09-20', title: 'Re-test Ferritin' });
  const b = ev({ id: 'b', date: '2026-09-20', time: '', title: 'Re-test Ferritin' });
  const timed = ev({ id: 'c', date: '2026-09-20', time: '09:00', title: 'Re-test Ferritin' });
  assert.equal(calendarEventKey(a), calendarEventKey(b));
  assert.notEqual(calendarEventKey(a), calendarEventKey(timed), 'a timed event is not the all-day one');
}

// --- findDuplicateEvent ----------------------------------------------------
{
  const existing = [ev({ id: 'a', date: '2026-08-25', time: '15:30', title: 'Dr Steiner' })];
  assert.equal(findDuplicateEvent(existing, { date: '2026-08-25', time: '15:30', title: 'dr Steiner' })?.id, 'a');
  assert.equal(findDuplicateEvent(existing, { date: '2026-08-26', time: '15:30', title: 'Dr Steiner' }), undefined, 'a different day is a different appointment');
  assert.equal(findDuplicateEvent(existing, { date: '', time: '15:30', title: 'Dr Steiner' }), undefined, 'no date, no judgement');
  assert.equal(findDuplicateEvent(existing, { date: '2026-08-25', time: '15:30', title: '   ' }), undefined, 'no title, no judgement');
}

// --- the four-copies case, reproduced --------------------------------------
{
  // Applying the same assistant suggestion four times over twelve minutes.
  // Each Apply saw a calendar that already contained the previous copies.
  const title = 'Vita & Ganga: Re-test Ferritin and Vitamin D';
  let calendar: CalendarEvent[] = [];
  for (let i = 0; i < 4; i++) {
    const candidate = ev({ id: `copy-${i}`, date: '2026-09-20', title });
    const { fresh } = partitionNewEvents(calendar, [candidate]);
    calendar = [...calendar, ...fresh];
  }
  assert.equal(calendar.length, 1, 'four Applies of the same thing leave one event');
  assert.equal(calendar[0].id, 'copy-0', 'and it is the first one, not the last');
}

// --- a batch containing its own duplicate ---------------------------------
{
  // A photographed notice listing the same parents' evening twice.
  const batch = [
    ev({ id: 'n1', date: '2026-09-01', time: '18:00', title: 'Parents evening' }),
    ev({ id: 'n2', date: '2026-09-01', time: '18:00', title: 'Parents Evening' }),
    ev({ id: 'n3', date: '2026-09-02', time: '18:00', title: 'Sports day' }),
  ];
  const { fresh, duplicates } = partitionNewEvents([], batch);
  assert.deepEqual(fresh.map(e => e.id), ['n1', 'n3']);
  assert.deepEqual(duplicates.map(e => e.id), ['n2']);
}

// --- two different Google ids, one real appointment -----------------------
{
  // Exactly the "Klara" pairs found in the live vault: distinct Google event
  // ids — one a recurring instance, one a moved exception of it — describing
  // the same thing. The id-based check in the importer cannot see this.
  const existing = [ev({ id: 'gcal-ggrprj5oh7jknseh596poinvs8', date: '2026-08-17', time: '18:00', title: 'Klara', category: 'Appointment' })];
  const incoming = [ev({ id: 'gcal-_6op46di46p1k2b9j84p44b9k8p1k6ba18gp44ba66gs3ce268kok6dpk74_20260817T160000Z', date: '2026-08-17', time: '18:00', title: 'Klara', category: 'Appointment' })];
  const { fresh, duplicates } = partitionNewEvents(existing, incoming);
  assert.equal(fresh.length, 0);
  assert.equal(duplicates.length, 1);
}

// --- an incomplete event is never silently swallowed ----------------------
{
  // Better a stray row the user can see and delete than a silent drop.
  const batch = [
    ev({ id: 'x', date: '', title: 'No date' }),
    ev({ id: 'y', date: '2026-09-01', title: '' }),
  ];
  const { fresh, duplicates } = partitionNewEvents([], batch);
  assert.equal(fresh.length, 2, 'events we cannot judge are kept, not discarded');
  assert.equal(duplicates.length, 0);
}

// --- finding the mess already made ----------------------------------------
{
  const events = [
    ev({ id: 'f1', date: '2026-09-20', title: 'Re-test Ferritin' }),
    ev({ id: 'f2', date: '2026-09-20', title: 'Re-test Ferritin' }),
    ev({ id: 'f3', date: '2026-09-20', title: 'Re-test Ferritin' }),
    ev({ id: 'k1', date: '2026-08-07', time: '20:00', title: 'Klara' }),
    ev({ id: 'k2', date: '2026-08-07', time: '20:00', title: 'Klara' }),
    ev({ id: 'solo', date: '2026-08-08', title: 'Dentist' }),
  ];
  const groups = findExistingDuplicateGroups(events);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 3, 'biggest group first');
  assert.deepEqual(groups[0].map(e => e.id), ['f1', 'f2', 'f3']);
  assert.deepEqual(groups[1].map(e => e.id), ['k1', 'k2']);
  const extras = groups.reduce((n, g) => n + g.length - 1, 0);
  assert.equal(extras, 3, 'three rows are removable');
}

console.log('calendarDedup.test.ts: all assertions passed');
