import type { CalendarEvent } from '../types';
import { deepEqual, mergeShared, mergeIdList } from './mergeShared';

/** Capture write intent before asynchronous cloud work; unchanged records require no reads. */
export function calendarWriteBatches(events: readonly CalendarEvent[], base: ReadonlyMap<string, CalendarEvent>, size = 100): CalendarEvent[][] {
  const changed = events.filter(e => e.id && !deepEqual(base.get(e.id), e));
  const batches: CalendarEvent[][] = [];
  for (let offset = 0; offset < changed.length; offset += size) batches.push(changed.slice(offset, offset + size));
  return batches;
}
export function mergeCalendarWrite(local: CalendarEvent, base: CalendarEvent | undefined, server: CalendarEvent | undefined): CalendarEvent {
  if (!base && server && !local.googleImportOwner) {
    // Older app versions did not persist a merge base. Without it, a differing
    // value cannot be distinguished from an edit made on another device.
    const conflicts = Object.keys(local).filter(key => key !== 'id' && (local as any)[key] !== undefined && (server as any)[key] !== undefined && !deepEqual((local as any)[key], (server as any)[key]));
    if (conflicts.length) throw new Error('Some older pending calendar edits conflict with the cloud. Both copies were preserved; reconnect and refresh Google Calendar before retrying imported events.');
  }
  return mergeShared(base, local, server);
}

export interface CalendarSaveOptions { removedGoogleIds?: readonly string[] }
/** Only explicit mirrored-source removals can bypass a missing legacy index baseline. */
export function reconcileCalendarIndex(base: string[] | undefined, local: string[], server: string[], removedGoogleIds: readonly string[] = []): string[] {
  const removed = new Set(removedGoogleIds.filter(id => id.startsWith('gcal-')));
  const kept = new Set(local);
  return mergeIdList(base, local, server).filter(id => kept.has(id) || !removed.has(id));
}
export function removedGoogleMirrorIds(before: readonly CalendarEvent[], after: readonly CalendarEvent[]): string[] {
  const kept = new Set(after.map(e => e.id));
  return before.filter(e => e.id.startsWith('gcal-') && !kept.has(e.id)).map(e => e.id);
}

const writesBySpace = new Map<string, Promise<void>>();
/** Local writes retain their order; different spaces can save independently. */
export async function withCalendarWriteLock<T>(space: string, write: () => Promise<T>): Promise<T> {
  const previous = writesBySpace.get(space) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  writesBySpace.set(space, current);
  await previous;
  try { return await write(); }
  finally { release(); if (writesBySpace.get(space) === current) writesBySpace.delete(space); }
}

/** Reject delayed reads after local changes, account switches, or pending writes. */
export function canAdoptCalendarRead(start: { space: string; uid: string; cache: string | null }, current: { space: string; uid?: string; cache: string | null; dirty: boolean }): boolean {
  return start.space === current.space && start.uid === current.uid && !current.dirty && start.cache === current.cache;
}

/** Evict only redundant Google merge bases; never calendar data or native baselines. */
export function evictGoogleMergeBases(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, uid: string, space: string): void {
  const prefix = `family_mergeBase_${uid}_${space}::event:gcal-`;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
}
