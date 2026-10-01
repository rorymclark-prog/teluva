import type { CalendarEvent } from '../types';
import { deepEqual, mergeShared } from './mergeShared';

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
