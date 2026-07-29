import assert from 'node:assert/strict';
import {
  mergeFeedEvents, removeFeedEvents, feedIdForUrl, describeSync, suggestFeedLabel,
} from './calendarFeeds';
import type { CalendarEvent } from '../types';

const ev = (p: Partial<CalendarEvent> & { id: string }): CalendarEvent => ({
  title: 'Thing', date: '2026-08-15', category: 'Appointment', remindMe: true, ...p,
});

const FEED = 'feed-abc';
const OTHER = 'feed-xyz';

// ---------------------------------------------------------------------------
// The behaviour that separates a subscription from an import.
// ---------------------------------------------------------------------------

{
  // Cancelled at the source → gone from here. An import can never do this,
  // which is exactly why repeated importing is not syncing.
  const existing = [
    ev({ id: 'a', feedId: FEED }),
    ev({ id: 'b', feedId: FEED }),
  ];
  const r = mergeFeedEvents(existing, [ev({ id: 'a' })], FEED);
  assert.deepEqual(r.events.map((e) => e.id), ['a']);
  assert.equal(r.removed, 1);
  assert.equal(r.added, 0);
  assert.equal(r.unchanged, 1);
}

{
  // Moved at the source → moved here, not duplicated.
  const existing = [ev({ id: 'a', feedId: FEED, date: '2026-08-15', time: '15:00' })];
  const r = mergeFeedEvents(existing, [ev({ id: 'a', date: '2026-08-22', time: '16:00' })], FEED);
  assert.equal(r.events.length, 1, 'one event, not two');
  assert.equal(r.events[0].date, '2026-08-22');
  assert.equal(r.events[0].time, '16:00');
  assert.equal(r.updated, 1);
  assert.equal(r.added, 0);
}

{
  const r = mergeFeedEvents([], [ev({ id: 'a' }), ev({ id: 'b' })], FEED);
  assert.equal(r.added, 2);
  assert.ok(r.events.every((e) => e.feedId === FEED), 'every incoming event is stamped with its feed');
}

// ---------------------------------------------------------------------------
// Ownership. A feed refresh must never disturb anything it didn't create —
// this is the assumption that makes wholesale replacement safe.
// ---------------------------------------------------------------------------

{
  const existing = [
    ev({ id: 'mine', title: 'Typed by hand' }),                       // no feedId
    ev({ id: 'gcal-1', title: 'From Google' }),                       // Google import
    ev({ id: 'ics-1', title: 'From a file' }),                        // file import
    ev({ id: 'other', feedId: OTHER, title: 'A different feed' }),
    ev({ id: 'a', feedId: FEED, title: 'Old' }),
  ];
  const r = mergeFeedEvents(existing, [], FEED);
  const ids = r.events.map((e) => e.id).sort();
  assert.deepEqual(ids, ['gcal-1', 'ics-1', 'mine', 'other'], 'only this feed’s events were touched');
  assert.equal(r.removed, 1);
  // And the survivors are untouched objects, not rebuilt ones.
  assert.equal(r.events.find((e) => e.id === 'mine')!.title, 'Typed by hand');
  assert.equal(r.events.find((e) => e.id === 'other')!.feedId, OTHER);
}

{
  // Two feeds can hold the same-id event without stealing it from each other.
  const existing = [ev({ id: 'dup', feedId: OTHER, title: 'Theirs' })];
  const r = mergeFeedEvents(existing, [ev({ id: 'dup', title: 'Ours' })], FEED);
  assert.equal(r.events.length, 2);
  assert.equal(r.events.filter((e) => e.id === 'dup').length, 2);
}

// ---------------------------------------------------------------------------
// Unsubscribing takes its events with it.
// ---------------------------------------------------------------------------

{
  const existing = [
    ev({ id: 'a', feedId: FEED }), ev({ id: 'b', feedId: FEED }),
    ev({ id: 'mine' }), ev({ id: 'c', feedId: OTHER }),
  ];
  const r = removeFeedEvents(existing, FEED);
  assert.deepEqual(r.events.map((e) => e.id).sort(), ['c', 'mine']);
  assert.equal(r.removed, 2);
  // Removing a feed that isn't there is a no-op, not a wipe.
  assert.equal(removeFeedEvents(existing, 'feed-nothing').removed, 0);
}

// ---------------------------------------------------------------------------
// "Changed" must mean changed, or every refresh claims to have done something.
// ---------------------------------------------------------------------------

{
  const same = ev({ id: 'a', feedId: FEED, title: 'T', date: '2026-08-15', time: '15:00', description: 'd', memberIds: ['m1'] });
  const identical = ev({ id: 'a', title: 'T', date: '2026-08-15', time: '15:00', description: 'd', memberIds: ['m1'] });
  assert.equal(mergeFeedEvents([same], [identical], FEED).unchanged, 1);
  assert.equal(mergeFeedEvents([same], [identical], FEED).updated, 0);

  for (const change of [
    { title: 'Different' }, { date: '2026-08-16' }, { time: '16:00' },
    { description: 'other' }, { memberIds: ['m2'] },
  ]) {
    const r = mergeFeedEvents([same], [{ ...identical, ...change }], FEED);
    assert.equal(r.updated, 1, `a change to ${Object.keys(change)[0]} counts as an update`);
  }
  // An absent time and an empty-string time are the same thing to a reader.
  const noTime = ev({ id: 'a', feedId: FEED, title: 'T', date: '2026-08-15' });
  assert.equal(mergeFeedEvents([noTime], [ev({ id: 'a', title: 'T', date: '2026-08-15', time: '' })], FEED).unchanged, 1);
}

// ---------------------------------------------------------------------------
// Ids and labels
// ---------------------------------------------------------------------------

{
  const a = feedIdForUrl('https://example.com/cal.ics');
  assert.equal(a, feedIdForUrl('https://example.com/cal.ics'), 'stable across calls');
  assert.notEqual(a, feedIdForUrl('https://example.com/other.ics'));
  assert.match(a, /^feed-[a-z0-9]+$/);
}

{
  assert.equal(suggestFeedLabel('https://p12-caldav.icloud.com/published/2/abc'), 'iCloud calendar');
  assert.equal(suggestFeedLabel('https://outlook.office365.com/owa/calendar/x/reachcalendar.ics'), 'Outlook calendar');
  assert.equal(suggestFeedLabel('https://calendar.google.com/calendar/ical/x/basic.ics'), 'Google calendar');
  assert.equal(suggestFeedLabel('https://schule.example.at/termine.ics'), 'Example calendar');
  assert.equal(suggestFeedLabel('not a url'), 'Calendar');
}

{
  assert.equal(describeSync({ added: 0, removed: 0, updated: 0, unchanged: 5 }), 'Up to date — nothing changed.');
  assert.equal(describeSync({ added: 2, removed: 1, updated: 3, unchanged: 0 }), 'Synced: 2 new, 3 changed, 1 removed.');
  assert.equal(describeSync({ added: 1, removed: 0, updated: 0, unchanged: 0 }), 'Synced: 1 new.');
}

// ---------------------------------------------------------------------------
// A refresh that returns nothing is treated as "the calendar is empty", which
// is why the caller must never call this on a FAILED fetch — it would silently
// delete every event the feed had. Guarded here as documentation of the
// contract, and enforced at the call site.
// ---------------------------------------------------------------------------
{
  const existing = [ev({ id: 'a', feedId: FEED }), ev({ id: 'b', feedId: FEED })];
  const r = mergeFeedEvents(existing, [], FEED);
  assert.equal(r.events.length, 0);
  assert.equal(r.removed, 2, 'an empty feed genuinely means no events — callers must not pass a failed fetch');
}

console.log('calendarFeeds.test.ts: all assertions passed');
