import assert from 'node:assert/strict';
import { calendarWriteBatches, canAdoptCalendarRead, evictGoogleMergeBases, mergeCalendarWrite, reconcileCalendarIndex, removedGoogleMirrorIds, withCalendarWriteLock } from './calendarPersistence';
import { mergeIdList } from './mergeShared';
import type { CalendarEvent } from '../types';
const events: CalendarEvent[] = Array.from({ length: 2000 }, (_, i) => ({ id: `event-${i}`, title: 'Work', date: '2026-10-01', category: 'Work', remindMe: true }));
const base = new Map(events.map(e => [e.id, e]));
const local = events.map(e => e.id === 'event-7' ? { ...e, time: '10:00' } : e);
assert.deepEqual(calendarWriteBatches(local, base).map(b => b.map(e => e.id)), [['event-7']], 'one edit in a huge calendar reads/writes only that event');
assert.equal(calendarWriteBatches(events, new Map()).length, 20, 'first import/retry is bounded to 100 per transaction');
assert.ok(calendarWriteBatches(events, new Map()).every(b => b.length <= 100));
const remote = { ...events[7], description: 'Added from phone' };
assert.deepEqual(mergeCalendarWrite(local[7], events[7], remote), { ...remote, time: '10:00' }, 'Mac time edit preserves phone description');
assert.deepEqual(mergeIdList(['deleted', 'kept'], ['kept'], ['deleted', 'kept', 'phone-added']), ['kept', 'phone-added'], 'source removals preserve concurrently added native events');
assert.deepEqual(calendarWriteBatches([], base), [], 'removing all events needs only an index commit');
console.log('calendarPersistence: bounded delta writes and cross-device merges OK');
assert.throws(() => mergeCalendarWrite({ ...events[7], time: '10:00' }, undefined, { ...events[7], time: '11:00' }), /conflict/, 'legacy pending edits must not overwrite a different cloud version without a merge base');
assert.deepEqual(mergeCalendarWrite(events[7], undefined, { ...events[7], description: 'Only on phone' }), { ...events[7], description: 'Only on phone' }, 'a richer cloud record keeps fields missing locally');

assert.deepEqual(reconcileCalendarIndex(undefined, ['kept'], ['gcal-cancelled', 'kept', 'phone-native'], ['gcal-cancelled', 'phone-native']), ['kept', 'phone-native'], 'legacy source removals drop only Google mirrors, and preserve unknown phone events');
assert.deepEqual(reconcileCalendarIndex(undefined, ['gcal-moved'], ['gcal-moved'], ['gcal-moved']), ['gcal-moved'], 'a moved instance that remains locally is kept');
assert.deepEqual(removedGoogleMirrorIds([{ ...events[0], id: 'gcal-removed' }, events[1]], [events[1]]), ['gcal-removed']);

{
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const first = withCalendarWriteLock('family', async () => { order.push('first'); await gate; order.push('first done'); });
  const second = withCalendarWriteLock('family', async () => { order.push('second'); });
  await withCalendarWriteLock('business', async () => { order.push('other space'); });
  assert.deepEqual(order, ['first', 'other space'], 'a second local save waits; another space remains independent');
  release(); await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'other space', 'first done', 'second']);
  await assert.rejects(withCalendarWriteLock('family', async () => { throw new Error('offline'); }), /offline/);
  await withCalendarWriteLock('family', async () => { order.push('retry'); });
  assert.equal(order.at(-1), 'retry', 'a failed cloud save releases the queue for retry');
}

{
  const start = { space: 'household', uid: 'mac', cache: 'old snapshot' };
  const current = { ...start, dirty: false };
  assert.equal(canAdoptCalendarRead(start, current), true);
  // Cloud read started first; source refresh finishes and is acknowledged before the read returns.
  assert.equal(canAdoptCalendarRead(start, { ...current, cache: 'refreshed snapshot' }), false, 'acknowledged newer calendar must survive a delayed old cloud read');
  assert.equal(canAdoptCalendarRead(start, { ...current, dirty: true }), false, 'pending edits survive even if the serialized cache did not change');
  assert.equal(canAdoptCalendarRead(start, { ...current, space: 'business' }), false);
  assert.equal(canAdoptCalendarRead(start, { ...current, uid: 'phone' }), false);
}

{
  const keys = ['family_mergeBase_mac_household::event:gcal-1', 'family_mergeBase_mac_household::event:gcal-2', 'family_mergeBase_mac_household::event:native', 'family_mergeBase_phone_household::event:gcal-1', 'family_mergeBase_mac_business::event:gcal-1', 'family_calendar_v2_household'];
  const storage = { get length() { return keys.length; }, key: (i: number) => keys[i] ?? null, removeItem: (key: string) => { keys.splice(keys.indexOf(key), 1); } };
  evictGoogleMergeBases(storage, 'mac', 'household');
  assert.deepEqual(keys, ['family_mergeBase_mac_household::event:native', 'family_mergeBase_phone_household::event:gcal-1', 'family_mergeBase_mac_business::event:gcal-1', 'family_calendar_v2_household'], 'quota recovery keeps actual calendar data, native edit baselines and other spaces/accounts');
}
