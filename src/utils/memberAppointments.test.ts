import assert from 'node:assert/strict';
import { CalendarEvent } from '../types';
import { memberAppointments, todayIsoLocal, relativeDayLabel } from './memberAppointments';

const ev = (p: Partial<CalendarEvent> & { id: string; date: string }): CalendarEvent => ({
  title: 'Appointment',
  category: 'Appointment',
  remindMe: false,
  ...p,
});

const TODAY = '2026-08-01';

// --- who the appointment belongs to ---------------------------------------
{
  const events = [
    ev({ id: '1', date: '2026-08-25', memberIds: ['rory'] }),
    ev({ id: '2', date: '2026-08-26', memberIds: ['Shyam'] }),
    ev({ id: '3', date: '2026-08-27', memberIds: ['rory', 'Shyam'] }),
    ev({ id: '4', date: '2026-08-28' }), // tagged to nobody
  ];
  const { upcoming } = memberAppointments(events, 'rory', TODAY);
  assert.deepEqual(upcoming.map(e => e.id), ['1', '3'], 'only this person’s appointments, including shared ones');

  const untagged = memberAppointments(events, 'someone-else', TODAY);
  assert.equal(untagged.upcoming.length, 0, 'an untagged event belongs to no one');
}

// --- only appointments, not every event they are tagged in -----------------
{
  const events = [
    ev({ id: 'doc', date: '2026-08-25', memberIds: ['mia'] }),
    ev({ id: 'play', date: '2026-08-26', memberIds: ['mia'], category: 'School' }),
    ev({ id: 'trip', date: '2026-08-27', memberIds: ['mia'], category: 'Travel' }),
    ev({ id: 'bday', date: '2026-08-28', memberIds: ['mia'], category: 'Milestone' }),
  ];
  const { upcoming } = memberAppointments(events, 'mia', TODAY);
  assert.deepEqual(upcoming.map(e => e.id), ['doc'], 'a school play is not a medical appointment');
}

// --- upcoming vs past, and today counts as upcoming ------------------------
{
  const events = [
    ev({ id: 'yesterday', date: '2026-07-31', memberIds: ['x'] }),
    ev({ id: 'today', date: TODAY, memberIds: ['x'] }),
    ev({ id: 'tomorrow', date: '2026-08-02', memberIds: ['x'] }),
  ];
  const { upcoming, past } = memberAppointments(events, 'x', TODAY);
  assert.deepEqual(upcoming.map(e => e.id), ['today', 'tomorrow'], 'today is still ahead of you');
  assert.deepEqual(past.map(e => e.id), ['yesterday']);
}

// --- ordering: soonest first, and time breaks a same-day tie ---------------
{
  const events = [
    ev({ id: 'late', date: '2026-08-25', time: '15:30', memberIds: ['x'] }),
    ev({ id: 'early', date: '2026-08-25', time: '09:00', memberIds: ['x'] }),
    ev({ id: 'notime', date: '2026-08-25', memberIds: ['x'] }),
    ev({ id: 'sooner', date: '2026-08-10', memberIds: ['x'] }),
  ];
  const { upcoming } = memberAppointments(events, 'x', TODAY);
  assert.deepEqual(upcoming.map(e => e.id), ['sooner', 'notime', 'early', 'late'],
    'soonest date first; within a day, earliest time first, and a missing time sorts as 00:00');
}

// --- past runs backwards: most recent first --------------------------------
{
  const events = [
    ev({ id: 'old', date: '2025-01-01', memberIds: ['x'] }),
    ev({ id: 'recent', date: '2026-07-20', memberIds: ['x'] }),
    ev({ id: 'middle', date: '2026-01-15', memberIds: ['x'] }),
  ];
  const { past } = memberAppointments(events, 'x', TODAY);
  assert.deepEqual(past.map(e => e.id), ['recent', 'middle', 'old']);
}

// --- the real reported case ------------------------------------------------
{
  // Exactly the record found in Firestore after "I added an appointment via
  // the chat and I can't find it": right date, right time, right person,
  // filed as an Appointment — and invisible on every one of that person's
  // own screens until now.
  const Steiner = ev({
    id: '178531898309948',
    title: 'Appointment with Dr Johann Steiner',
    date: '2026-08-25',
    time: '15:30',
    memberIds: ['1781799906310'],
  });
  const { upcoming } = memberAppointments([Steiner], '1781799906310', TODAY);
  assert.equal(upcoming.length, 1, 'the appointment that started all this now surfaces on the member');
  assert.equal(upcoming[0].title, 'Appointment with Dr Johann Steiner');
}

// --- today, in local time, never UTC --------------------------------------
{
  // 23:30 on the 1st in a UTC+2 zone is still the 1st locally but the 31st in
  // UTC. Using UTC here would show tomorrow's appointment as "today" every
  // evening for half the world — including Vienna.
  const lateEvening = new Date(2026, 7, 1, 23, 30, 0);
  assert.equal(todayIsoLocal(lateEvening), '2026-08-01');

  const earlyMorning = new Date(2026, 7, 1, 0, 15, 0);
  assert.equal(todayIsoLocal(earlyMorning), '2026-08-01');

  assert.match(todayIsoLocal(), /^\d{4}-\d{2}-\d{2}$/);
}

// --- relative labels -------------------------------------------------------
{
  assert.equal(relativeDayLabel('2026-08-01', TODAY), 'today');
  assert.equal(relativeDayLabel('2026-08-02', TODAY), 'tomorrow');
  assert.equal(relativeDayLabel('2026-07-31', TODAY), 'yesterday');
  assert.equal(relativeDayLabel('2026-08-04', TODAY), 'in 3 days');
  assert.equal(relativeDayLabel('2026-07-29', TODAY), '3 days ago');
  assert.equal(relativeDayLabel('2026-08-25', TODAY), 'in 3 weeks');
  assert.equal(relativeDayLabel('2026-12-01', TODAY), 'in 4 months');
  assert.equal(relativeDayLabel('nonsense', TODAY), '', 'a bad date reads as nothing rather than "NaN days ago"');
}

// --- a DST boundary must not shift the count -------------------------------
{
  // Europe/Vienna springs forward on 2026-03-29. Counting in local time would
  // make that day 23 hours and round the difference to the wrong number.
  assert.equal(relativeDayLabel('2026-03-30', '2026-03-29'), 'tomorrow');
  assert.equal(relativeDayLabel('2026-03-29', '2026-03-28'), 'tomorrow');
  // And the autumn transition, where a day is 25 hours.
  assert.equal(relativeDayLabel('2026-10-25', '2026-10-24'), 'tomorrow');
}

// --- untagged Google imports still reach the right person ------------------
{
  // The reported bug end-to-end: an appointment imported from Google, tagged
  // to nobody, whose title names a child. Before the members list was passed
  // in, this filtered to nothing and Ganga's Check-ups screen was empty.
  const family = [{ id: 'Ganga', name: 'Ganga Clark' }, { id: 'vita', name: 'Vita Clark' }];
  const imported = ev({
    id: 'gcal-abc', date: '2026-08-04', time: '15:00',
    title: 'Ganga \u2013 Orthodontist (Dr. Lena Hofer-Mayr)',
    category: 'Appointment', memberIds: [],
  });
  const events = [imported];
  assert.equal(memberAppointments(events, 'Ganga', '2026-07-29', family).upcoming.length, 1);
  assert.equal(memberAppointments(events, 'vita', '2026-07-29', family).upcoming.length, 0);
  // And with no members to match against, behaviour is exactly what it was.
  assert.equal(memberAppointments(events, 'Ganga', '2026-07-29').upcoming.length, 0);
}

console.log('memberAppointments.test.ts: all assertions passed');
