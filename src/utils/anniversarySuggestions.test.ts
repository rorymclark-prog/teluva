import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnniversaryRecord, CalendarEvent } from '../types';
import { anniversarySuggestions } from './anniversarySuggestions';

// Guards the fix for: "the calendar already notes maria and my anniversary yet
// this didnt update" — a screen whose entire purpose is to save you hunting
// through the calendar, reporting "Nothing saved yet" about a date that was
// sitting in the calendar.

const here = path.dirname(fileURLToPath(import.meta.url));   // never .pathname — a space in the path silently no-ops
const root = path.resolve(here, '../..');

const NOW = new Date(2026, 7, 20);   // 2026-08-20, local

const ev = (p: Partial<CalendarEvent> & { id: string; date: string; title: string }): CalendarEvent => ({
  category: 'Other', remindMe: false, ...p,
});
const rec = (p: Partial<AnniversaryRecord> & { date: string }): AnniversaryRecord => ({
  id: 'r', title: 'Saved', kind: 'Anniversary', createdAt: '2026-01-01', ...p,
});

// --- the reported case ------------------------------------------------------
{
  const events = [ev({ id: 'g1', date: '2026-09-14', title: 'Our Anniversary' })];
  const out = anniversarySuggestions(events, [], NOW);
  assert.equal(out.length, 1, 'an anniversary in the calendar must be offered');
  assert.equal(out[0].title, 'Our Anniversary');
  assert.equal(out[0].monthDay, '09-14', 'the record stores a recurring month-day');
  assert.equal(out[0].daysUntil, 25);
}

// --- a date already kept is not nagged about --------------------------------
{
  // The event must itself be anniversary-shaped, or this proves nothing about
  // dedupe — it would just be an event the matcher ignored.
  const events = [ev({ id: 'g1', date: '2026-09-14', title: 'Rory & Maria anniversary' })];
  assert.equal(anniversarySuggestions(events, [], NOW).length, 1, 'precondition: this event IS a suggestion when nothing is saved');
  // Deliberately a DIFFERENT title on the saved record. Matching on title
  // would keep offering a date the family has already filed, because the
  // calendar wording and the record wording are almost never the same.
  const saved = [rec({ date: '09-14', title: 'Wedding Anniversary' })];
  assert.deepEqual(anniversarySuggestions(events, saved, NOW), []);
}

// --- a recurring calendar entry is one suggestion, not one per year ---------
{
  const events = [
    ev({ id: 'g1', date: '2026-09-14', title: 'Our Anniversary' }),
    ev({ id: 'g2', date: '2027-09-14', title: 'Our Anniversary' }),
    ev({ id: 'g3', date: '2028-09-14', title: 'Our Anniversary' }),
  ];
  const out = anniversarySuggestions(events, [], NOW);
  assert.equal(out.length, 1, 'a yearly Google entry must not be offered three times');
  assert.equal(out[0].eventDate, '2026-09-14', 'and it is the soonest one that is shown');
}

// --- the past is not a suggestion -------------------------------------------
{
  const events = [ev({ id: 'g1', date: '2026-02-14', title: "Valentine's Day" })];
  assert.deepEqual(anniversarySuggestions(events, [], NOW), [], 'February is gone; there is nothing to act on');
  // Today itself still counts.
  assert.equal(anniversarySuggestions([ev({ id: 'g2', date: '2026-08-20', title: 'Anniversary' })], [], NOW).length, 1);
}

// --- only anniversary-shaped events -----------------------------------------
{
  const events = [
    ev({ id: 'a', date: '2026-09-01', title: 'Dentist' }),
    ev({ id: 'b', date: '2026-09-02', title: 'Parents evening' }),
    ev({ id: 'c', date: '2026-09-03', title: 'Hochzeitstag' }),   // German, and in the keyword list
  ];
  const out = anniversarySuggestions(events, [], NOW);
  assert.deepEqual(out.map(s => s.eventId), ['c']);
}

// --- soonest first, and bounded ---------------------------------------------
{
  const events = [
    ev({ id: 'far', date: '2026-12-31', title: "New Year's Eve" }),
    ev({ id: 'near', date: '2026-08-25', title: 'Anniversary' }),
  ];
  assert.deepEqual(anniversarySuggestions(events, [], NOW).map(s => s.eventId), ['near', 'far']);

  const many = Array.from({ length: 20 }, (_, i) =>
    ev({ id: `m${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, title: 'Anniversary' }));
  assert.equal(anniversarySuggestions(many, [], NOW).length, 6, 'the block must not become a wall');
}

// --- degenerate input --------------------------------------------------------
{
  assert.deepEqual(anniversarySuggestions([], [], NOW), []);
  assert.deepEqual(anniversarySuggestions([ev({ id: 'x', date: '', title: 'Anniversary' })], [], NOW), []);
  assert.deepEqual(anniversarySuggestions([ev({ id: 'x', date: 'soon', title: 'Anniversary' })], [], NOW), []);
  const untitled = anniversarySuggestions([ev({ id: 'x', date: '2026-09-14', title: '', description: 'anniversary' })], [], NOW);
  assert.equal(untitled[0]?.title, 'Anniversary', 'a title-less event still needs something to show');
}

// --- wiring: the screen must actually use it --------------------------------
{
  const view = fs.readFileSync(path.join(root, 'src/components/AnniversariesView.tsx'), 'utf8');
  assert.ok(view.includes('anniversarySuggestions(events, anniversaries)'), 'the view must compute suggestions');
  assert.ok(view.includes('loadCalendarEvents()'), 'the view must load calendar events');

  // The bug was the copy as much as the data: a screen saying "Nothing saved
  // yet" while the calendar held the date.
  assert.ok(!/anniversaries\.length === 0 \? 'Nothing saved yet'/.test(view),
    'the header must not claim nothing is saved when the calendar has something');
  assert.ok(/anniversaries\.length === 0 && suggestions\.length === 0 \? \(/.test(view),
    'the empty state must only show when there is genuinely nothing to offer');

  // Suggestions must PREFILL, never write. A record claims the date repeats
  // every year; a calendar event never promised that.
  const keep = view.slice(view.indexOf('const keepSuggestion'), view.indexOf('// ── Members ──'));
  assert.ok(keep.includes('setIsFormOpen(true)'), 'keeping a suggestion opens the form');
  for (const forbidden of ['persist(', 'saveAnniversaries(']) {
    assert.ok(!keep.includes(forbidden), `keepSuggestion must not ${forbidden} — the family confirms the recurrence`);
  }
  assert.ok(!/originalYear:/.test(keep),
    "originalYear must stay blank — the event's year is this occurrence, not the year they married");
}

console.log('anniversarySuggestions.test.ts: all assertions passed');
