// Subscribed calendars — the difference between importing and syncing.
//
// An import is a one-way paste: whatever was in the file becomes events here,
// and nothing ever takes them away again. Move an appointment in Outlook and
// you get a second copy; cancel it and the old one sits there forever. That is
// what the .ics FILE import does, and it is the right behaviour for a file.
//
// A SUBSCRIPTION is a mirror. The feed is the source of truth for the events it
// owns, so every refresh replaces that feed's events wholesale: moved
// appointments move, cancelled ones disappear, new ones appear. That is only
// safe because ownership is explicit — every event carries the id of the feed
// it came from, and mergeFeedEvents will not touch an event it does not own.
//
// THE COROLLARY, worth saying plainly in the UI: edits made here to an event
// that came from a feed are overwritten on the next refresh. It is somebody
// else's calendar; we are showing a copy of it.

import { CalendarEvent } from '../types';

export interface CalendarFeed {
  id: string;
  /** The subscription URL, as normalised by the server. */
  url: string;
  /** What the user calls it — "Klara's Outlook", "School calendar". */
  label: string;
  addedAt: string;
  lastSyncedAt?: string;
  lastError?: string;
  /** How many events the last successful refresh produced. */
  eventCount?: number;
}

/** A short, stable id for a feed. Derived from the URL so the same calendar
 *  added twice is recognisably the same subscription. */
export function feedIdForUrl(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  return `feed-${h.toString(36)}`;
}

/**
 * Fold a feed's freshly fetched events into the calendar.
 *
 * Everything the feed owns is replaced; everything else is left exactly as it
 * was. Returns the new event list plus a summary of what changed, so the UI can
 * say something truthful instead of "done".
 */
export function mergeFeedEvents(
  existing: readonly CalendarEvent[],
  incoming: readonly CalendarEvent[],
  feedId: string,
): { events: CalendarEvent[]; added: number; removed: number; updated: number; unchanged: number } {
  const owned = new Map<string, CalendarEvent>();
  const others: CalendarEvent[] = [];
  for (const ev of existing) {
    if (ev.feedId === feedId) owned.set(ev.id, ev);
    else others.push(ev);
  }

  const stamped = incoming.map((ev) => ({ ...ev, feedId }));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const seen = new Set<string>();

  for (const ev of stamped) {
    seen.add(ev.id);
    const before = owned.get(ev.id);
    if (!before) { added++; continue; }
    if (sameEvent(before, ev)) unchanged++;
    else updated++;
  }

  // Anything the feed used to have and no longer does has been cancelled or
  // deleted at the source. Dropping it is the entire point of subscribing.
  let removed = 0;
  for (const id of owned.keys()) if (!seen.has(id)) removed++;

  return { events: [...others, ...stamped], added, removed, updated, unchanged };
}

/** Would a user notice a difference between these two? */
function sameEvent(a: CalendarEvent, b: CalendarEvent): boolean {
  return (
    a.title === b.title &&
    a.date === b.date &&
    (a.time || '') === (b.time || '') &&
    (a.description || '') === (b.description || '') &&
    (a.memberIds || []).join(',') === (b.memberIds || []).join(',')
  );
}

/** Remove a subscription and everything it put on the calendar. */
export function removeFeedEvents(
  existing: readonly CalendarEvent[],
  feedId: string,
): { events: CalendarEvent[]; removed: number } {
  const events = existing.filter((e) => e.feedId !== feedId);
  return { events, removed: existing.length - events.length };
}

/** A one-line, honest summary of a refresh. */
export function describeSync(r: { added: number; removed: number; updated: number; unchanged: number }): string {
  const bits: string[] = [];
  if (r.added) bits.push(`${r.added} new`);
  if (r.updated) bits.push(`${r.updated} changed`);
  if (r.removed) bits.push(`${r.removed} removed`);
  if (!bits.length) return 'Up to date — nothing changed.';
  return `Synced: ${bits.join(', ')}.`;
}

/**
 * A label to suggest for a newly added feed, taken from its host.
 * "p12-caldav.icloud.com" -> "iCloud", "outlook.office365.com" -> "Outlook".
 */
export function suggestFeedLabel(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'Calendar'; }
  if (host.includes('icloud')) return 'iCloud calendar';
  if (host.includes('office') || host.includes('outlook') || host.includes('live.com')) return 'Outlook calendar';
  if (host.includes('google')) return 'Google calendar';
  if (host.includes('proton')) return 'Proton calendar';
  if (host.includes('fastmail')) return 'Fastmail calendar';
  if (host.includes('yahoo')) return 'Yahoo calendar';
  const parts = host.replace(/^www\./, '').split('.');
  const name = parts.length > 1 ? parts[parts.length - 2] : host;
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} calendar` : 'Calendar';
}
