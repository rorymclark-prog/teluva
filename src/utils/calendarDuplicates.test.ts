import assert from 'node:assert/strict';
import { CalendarEvent } from '../types';
import {
  findDuplicateGroups, duplicateCount, removeDuplicates, describeGroup,
} from './calendarDuplicates';

const ev = (p: Partial<CalendarEvent> & { id: string; date: string; title: string }): CalendarEvent => ({
  category: 'Other',
  remindMe: false,
  ...p,
});

// --- the actual live vault, reconstructed ---------------------------------
{
  // Four identical copies from the assistant's Apply being tapped repeatedly,
  // plus a pair of Google-imported "Klara" rows with different Google ids.
  const events: CalendarEvent[] = [
    ev({ id: 'a1', date: '2026-09-20', title: 'Vita & Ganga: Re-test Ferritin and Vitamin D', time: '10:00' }),
    ev({ id: 'a2', date: '2026-09-20', title: 'Vita & Ganga: Re-test Ferritin and Vitamin D', time: '10:00' }),
    ev({ id: 'a3', date: '2026-09-20', title: 'Vita & Ganga: Re-test Ferritin and Vitamin D', time: '10:00' }),
    ev({ id: 'a4', date: '2026-09-20', title: 'Vita & Ganga: Re-test Ferritin and Vitamin D', time: '10:00' }),
    ev({ id: 'gcal-k1', date: '2026-08-07', title: 'Klara', time: '20:00' }),
    ev({ id: 'gcal-k2', date: '2026-08-07', title: 'Klara', time: '20:00' }),
    ev({ id: 'solo', date: '2026-08-04', title: "Mia's school play", time: '16:00' }),
  ];

  const groups = findDuplicateGroups(events);
  assert.equal(groups.length, 2, 'two groups');
  assert.equal(duplicateCount(groups), 4, '3 extra ferritin copies + 1 extra Klara');

  const { events: cleaned, removed } = removeDuplicates(events, groups);
  assert.equal(removed, 4);
  assert.equal(cleaned.length, 3);
  assert.ok(cleaned.some((e) => e.id === 'solo'), 'an event with no duplicate is untouched');
  assert.equal(cleaned.filter((e) => e.title.startsWith('Vita')).length, 1, 'exactly one copy survives');
}

// --- the richest copy is the one that survives ----------------------------
{
  // Keeping whichever came first in the array would throw away the note and
  // the member tags about half the time.
  const bare = ev({ id: 'bare', date: '2026-08-25', title: 'Dr Steiner', time: '15:30' });
  const rich = ev({
    id: 'rich', date: '2026-08-25', title: 'Dr Steiner', time: '15:30',
    description: 'Bring the referral', memberIds: ['rory'], category: 'Appointment', remindMe: true,
  });
  assert.equal(findDuplicateGroups([bare, rich])[0].keep.id, 'rich');
  assert.equal(findDuplicateGroups([rich, bare])[0].keep.id, 'rich', 'order must not decide it');
}

// --- a copy the outside world already points at wins ----------------------
{
  // googleSynced means this exact record was pushed to Google Calendar.
  // Removing it would leave that copy orphaned over there.
  const local = ev({ id: 'local', date: '2026-08-25', title: 'Dentist', description: 'a note here' });
  const pushed = ev({ id: 'pushed', date: '2026-08-25', title: 'Dentist', googleSynced: true });
  assert.equal(findDuplicateGroups([local, pushed])[0].keep.id, 'pushed');
}

// --- subscribed events are never offered for removal ----------------------
{
  // A feed owns its events. Deleting one removes it until the next refresh
  // puts it straight back, so offering is worse than staying quiet.
  const feedA = ev({ id: 'feed-x-1', date: '2026-08-07', title: 'Standup', time: '09:00', feedId: 'feed-x' });
  const feedB = ev({ id: 'feed-x-2', date: '2026-08-07', title: 'Standup', time: '09:00', feedId: 'feed-x' });
  assert.deepEqual(findDuplicateGroups([feedA, feedB]), []);

  // ...and a subscribed copy never drags a typed-in one into a group either.
  const typed = ev({ id: 'typed', date: '2026-08-07', title: 'Standup', time: '09:00' });
  assert.deepEqual(findDuplicateGroups([feedA, typed]), []);
}

// --- things that only LOOK like duplicates --------------------------------
{
  const differentTime = [
    ev({ id: 'a', date: '2026-08-07', title: 'Klara', time: '20:00' }),
    ev({ id: 'b', date: '2026-08-07', title: 'Klara', time: '21:00' }),
  ];
  assert.deepEqual(findDuplicateGroups(differentTime), [], 'a different time is a different appointment');

  const differentDay = [
    ev({ id: 'a', date: '2026-08-07', title: 'Klara', time: '20:00' }),
    ev({ id: 'b', date: '2026-08-08', title: 'Klara', time: '20:00' }),
  ];
  assert.deepEqual(findDuplicateGroups(differentDay), []);

  // An all-day entry and a timed one on the same day are not the same thing.
  const allDayVsTimed = [
    ev({ id: 'a', date: '2026-08-07', title: 'Klara' }),
    ev({ id: 'b', date: '2026-08-07', title: 'Klara', time: '20:00' }),
  ];
  assert.deepEqual(findDuplicateGroups(allDayVsTimed), []);
}

// --- untitled and undated records are left completely alone ---------------
{
  const junk = [
    ev({ id: 'a', date: '', title: 'Klara' }),
    ev({ id: 'b', date: '', title: 'Klara' }),
    ev({ id: 'c', date: '2026-08-07', title: '   ' }),
    ev({ id: 'd', date: '2026-08-07', title: '' }),
  ];
  assert.deepEqual(findDuplicateGroups(junk), [], 'nothing that cannot be shown on a day is comparable');
}

// --- removal is by id, so a list that moved underneath us is still safe ----
{
  const events = [
    ev({ id: 'a1', date: '2026-09-20', title: 'Ferritin' }),
    ev({ id: 'a2', date: '2026-09-20', title: 'Ferritin' }),
  ];
  const groups = findDuplicateGroups(events);

  // Another device syncs while the person is reading the confirmation list:
  // the array order changes and a new event appears.
  const changed = [
    ev({ id: 'new', date: '2026-10-01', title: 'Something else' }),
    events[1],
    events[0],
  ];
  const { events: cleaned, removed } = removeDuplicates(changed, groups);
  assert.equal(removed, 1);
  assert.ok(cleaned.some((e) => e.id === 'new'), 'the new event survives');
  assert.ok(cleaned.some((e) => e.id === groups[0].keep.id), 'the kept copy survives');
}

// --- an empty proposal removes nothing ------------------------------------
{
  const events = [ev({ id: 'a', date: '2026-08-07', title: 'Klara' })];
  const { events: same, removed } = removeDuplicates(events, []);
  assert.equal(removed, 0);
  assert.deepEqual(same.map((e) => e.id), ['a']);
}

// --- the confirmation line says how many copies and how many go -----------
{
  const groups = findDuplicateGroups([
    ev({ id: 'a', date: '2026-09-20', title: 'Ferritin', time: '10:00' }),
    ev({ id: 'b', date: '2026-09-20', title: 'Ferritin', time: '10:00' }),
    ev({ id: 'c', date: '2026-09-20', title: 'Ferritin', time: '10:00' }),
  ]);
  assert.equal(describeGroup(groups[0]), 'Ferritin — 2026-09-20 · 10:00 (3 copies, 2 to remove)');

  const allDay = findDuplicateGroups([
    ev({ id: 'a', date: '2026-09-20', title: 'Ferritin' }),
    ev({ id: 'b', date: '2026-09-20', title: 'Ferritin' }),
  ]);
  assert.equal(describeGroup(allDay[0]), 'Ferritin — 2026-09-20 (2 copies, 1 to remove)');
}

// --- groups read in calendar order ----------------------------------------
{
  const groups = findDuplicateGroups([
    ev({ id: 'l1', date: '2026-09-20', title: 'Later' }),
    ev({ id: 'l2', date: '2026-09-20', title: 'Later' }),
    ev({ id: 'e1', date: '2026-08-01', title: 'Earlier' }),
    ev({ id: 'e2', date: '2026-08-01', title: 'Earlier' }),
  ]);
  assert.deepEqual(groups.map((g) => g.title), ['Earlier', 'Later']);
}

console.log('calendarDuplicates.test.ts: all assertions passed');
