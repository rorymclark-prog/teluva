import { CalendarEvent } from '../types';
import { calendarEventKey, findExistingDuplicateGroups } from './calendarDedup';

// Cleaning up duplicates that are ALREADY in the vault.
//
// calendarDedup.ts stops new ones arriving. It cannot help with the ones that
// got in before it existed — a live vault has nine, in seven groups, and the
// only way to be rid of them today is to delete nine rows by hand and hope you
// picked the right copy each time.
//
// This finds them and proposes which copy to keep. It never deletes anything
// itself: the caller shows the list, the person confirms. Deleting somebody's
// appointments because two records looked alike to a string comparison is not
// a decision this file gets to make on its own.

export interface DuplicateGroup {
  /** The shared identity — same day, same time, same name. */
  key: string;
  /** Human-readable, for the confirmation list. */
  title: string;
  date: string;
  time?: string;
  /** The copy worth keeping — the one carrying the most information. */
  keep: CalendarEvent;
  /** The rest. */
  remove: CalendarEvent[];
}

/**
 * How much a copy is worth keeping. Higher wins.
 *
 * The copies of a duplicated appointment are rarely identical: one was typed
 * with a note and the people tagged, the other arrived from an import with
 * neither. Keeping whichever happened to be first in the array would throw
 * that away roughly half the time — so richness decides, and array order only
 * breaks a genuine tie.
 */
function informationScore(ev: CalendarEvent): number {
  let score = 0;
  if ((ev.description || '').trim()) score += 4;
  score += Math.min((ev.memberIds || []).length, 4) * 2;
  if (ev.category && ev.category !== 'Other') score += 1;
  if (ev.remindMe) score += 1;
  // A copy already pushed out to Google is the one the outside world is
  // holding a reference to; removing it would orphan that copy.
  if (ev.googleSynced) score += 8;
  return score;
}

/**
 * Every group of two or more records that a person would read as the same
 * appointment.
 *
 * SUBSCRIBED EVENTS ARE DELIBERATELY EXCLUDED. An event carrying a feedId is
 * owned by its feed: deleting it here removes it until the next refresh, which
 * puts it straight back. Offering to remove something that returns on its own
 * would be worse than not offering at all — the fix for a duplicated
 * subscription is to unsubscribe from one of the feeds.
 */
export function findDuplicateGroups(events: readonly CalendarEvent[]): DuplicateGroup[] {
  // Grouping itself is calendarDedup's job — same key, one definition of "the
  // same appointment" for detecting them on the way in and cleaning them up
  // afterwards. All this adds is the choice of which copy survives.
  const eligible = events.filter((ev) => ev && !ev.feedId);

  const groups: DuplicateGroup[] = findExistingDuplicateGroups(eligible).map((bucket) => {
    let keep = bucket[0];
    for (const ev of bucket.slice(1)) {
      if (informationScore(ev) > informationScore(keep)) keep = ev;
    }
    return {
      key: calendarEventKey(keep),
      title: keep.title,
      date: keep.date,
      time: keep.time,
      keep,
      remove: bucket.filter((ev) => ev !== keep),
    };
  });

  // Chronological, so the list reads like the calendar does.
  groups.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date)));
  return groups;
}

/** Total number of records that would be removed. */
export function duplicateCount(groups: readonly DuplicateGroup[]): number {
  return groups.reduce((n, g) => n + g.remove.length, 0);
}

/**
 * The event list with every extra copy dropped.
 *
 * Identity is by id, and an id that appears in no group is untouched — so this
 * is safe to apply to a list that has changed since the groups were computed
 * (another device syncing mid-review), which would otherwise delete by index
 * and hit the wrong rows.
 */
export function removeDuplicates(
  events: readonly CalendarEvent[],
  groups: readonly DuplicateGroup[],
): { events: CalendarEvent[]; removed: number } {
  const doomed = new Set<string>();
  for (const g of groups) for (const ev of g.remove) if (ev.id) doomed.add(ev.id);
  if (!doomed.size) return { events: [...events], removed: 0 };
  const kept = events.filter((ev) => !(ev.id && doomed.has(ev.id)));
  return { events: kept, removed: events.length - kept.length };
}

/** One line per group, for the confirmation list. */
export function describeGroup(g: DuplicateGroup): string {
  const extra = g.remove.length;
  const when = g.time ? `${g.date} · ${g.time}` : g.date;
  return `${g.title} — ${when} (${extra + 1} copies, ${extra} to remove)`;
}
