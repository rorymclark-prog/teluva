// Google Calendar snapshots are reconciled only after every page succeeds.
// Google expands recurrence exceptions via singleEvents=true; missing instances
// in a complete snapshot remove their mirrored Teluva copy. No source writes.

import type { CalendarEvent, FamilyMember } from '../types';
import { hasMedicalCalendarContext } from './medicalCalendarEvent';
import { resolveEventMembers } from './eventMemberMatch';
import { partitionNewEvents } from './calendarDedup';

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const PAGE_SIZE = 250;
/** Per window. 20 × 250 = 5,000 events a year is far past any family calendar. */
export const MAX_PAGES = 20;

/** A 401/403 from Google: the token is dead or lacks the calendar scope. */
export class GoogleImportAuthError extends Error {}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; cache?: RequestCache }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<any>;
}>;

export interface GoogleEventItem {
  id?: string;
  summary?: string;
  description?: string;
  status?: string;
  eventType?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  start?: { dateTime?: string; date?: string };
}

/**
 * Every page of one query. `truncated` is true when the page cap stopped it
 * with more still on Google's side — reported, never silently swallowed.
 */
async function fetchWindow(
  token: string,
  query: string,
  fetchImpl: FetchLike,
  maxPages: number,
): Promise<{ items: GoogleEventItem[]; truncated: boolean }> {
  const items: GoogleEventItem[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = `${EVENTS_URL}?${query}&maxResults=${PAGE_SIZE}&orderBy=startTime&singleEvents=true&timeZone=Europe%2FVienna` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (res.status === 401 || res.status === 403) throw new GoogleImportAuthError(`Google Calendar API error: ${res.status}`);
    if (!res.ok) throw new Error(`Google Calendar API error: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.items) && data?.kind !== 'calendar#events') throw new Error('Google returned an invalid calendar snapshot; existing events were kept.');
    if (Array.isArray(data?.items)) items.push(...data.items);
    pageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
    if (!pageToken) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/**
 * The past year and next year, as two queries, each paged to
 * the end. Two queries, not one: a single oldest-first query spanning both
 * would let a year of history fill the result before any upcoming
 * appointment (the reason the Calendar screen split them in the first place).
 */
export async function fetchAllGoogleEvents(
  token: string,
  opts: { now?: Date; fetchImpl?: FetchLike; maxPages?: number } = {},
): Promise<{ items: GoogleEventItem[]; truncated: boolean }> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const nowIso = now.toISOString();
  const futureEnd = new Date(now); futureEnd.setFullYear(futureEnd.getFullYear() + 1);
  const [past, future] = await Promise.all([
    fetchWindow(token, `timeMin=${oneYearAgo.toISOString()}&timeMax=${nowIso}`, fetchImpl, maxPages),
    fetchWindow(token, `timeMin=${nowIso}&timeMax=${futureEnd.toISOString()}`, fetchImpl, maxPages),
  ]);
  return { items: [...past.items, ...future.items], truncated: past.truncated || future.truncated };
}

/**
 * Google items → Teluva events, skipping what must not come in: events this
 * app exported ("[Family Hub]"), cancelled instances, the
 * same id twice across the two windows, and anything without a start.
 */
export function googleEventsToCalendarEvents(
  items: readonly GoogleEventItem[],
  existing: readonly CalendarEvent[],
  members: readonly FamilyMember[],
  workTitles: readonly string[] = [],
): CalendarEvent[] {
  const seenThisRun = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const gEv of items) {
    if (!gEv?.id) continue;
    if ((gEv.summary || '').startsWith('[Family Hub]')) continue;
    if (seenThisRun.has(gEv.id)) continue;
    seenThisRun.add(gEv.id);
    const id = 'gcal-' + gEv.id;
    if (gEv.status === 'cancelled') continue;

    const startVal = gEv.start?.dateTime || gEv.start?.date || '';
    if (!startVal) continue;
    const title = gEv.summary || 'Google Calendar event';
    out.push({
      id,
      title,
      date: startVal.substring(0, 10),
      time: gEv.start?.dateTime ? startVal.substring(11, 16) : undefined,
      description: gEv.description || 'Imported from Google Calendar',
      category: classifyGoogleEvent(gEv, workTitles),
      remindMe: true,
      // Google has no idea who lives in the house; read the person out of the
      // title (utils/eventMemberMatch.ts). What stays untagged is what the
      // "whose is this?" prompt asks about (utils/untaggedAppointments.ts).
      memberIds: resolveEventMembers({ title, memberIds: [] }, members).memberIds,
    });
  }
  return out;
}

export interface GoogleImportResult {
  snapshot: CalendarEvent[];
  fresh: CalendarEvent[];
  duplicates: CalendarEvent[];
  /** Items Google returned, before any filtering. */
  fetched: number;
  truncated: boolean;
}

let inFlight = false;

/** True while an import is running anywhere in the app. */
export function isGoogleImportRunning(): boolean {
  return inFlight;
}

/**
 * Fetch, transform and de-duplicate. Returns null — and does nothing — when
 * another import is already running: the second caller's `existing` would be
 * stale the moment the first one saved, and both saving would write the same
 * batch twice. The optional commit keeps the lock through reconciliation and save.
 */
export async function importGoogleEvents(
  token: string,
  existing: readonly CalendarEvent[],
  members: readonly FamilyMember[],
  opts: { now?: Date; fetchImpl?: FetchLike; maxPages?: number; owner?: string; workTitles?: readonly string[]; commit?: (snapshot: CalendarEvent[]) => Promise<void> } = {},
): Promise<GoogleImportResult | null> {
  if (inFlight) return null;
  inFlight = true;
  try {
    const { items, truncated } = await fetchAllGoogleEvents(token, opts);
    if (truncated) throw new Error('Calendar refresh incomplete: too many events. Existing events were kept; please try again.');
    const imported = googleEventsToCalendarEvents(items, [], members, opts.workTitles).map(e => opts.owner ? { ...e, googleImportOwner: opts.owner } : e);
    const { fresh, duplicates } = partitionNewEvents(existing, imported);
    if (opts.commit) await opts.commit(imported);
    return { snapshot: imported, fresh, duplicates, fetched: items.length, truncated };
  } finally {
    inFlight = false;
  }
}

// ---------------------------------------------------------------------------
// When did this device last import?
// ---------------------------------------------------------------------------

/** Start-up imports when the last one is older than this. */
export const STALE_AFTER_HOURS = 4;

// family_ prefix: logout's localStorage sweep (lib/firebase.ts) clears it.
// Keyed by uid (two people sharing a laptop each get their own record) AND by
// space: an import into the family space says nothing about a business space,
// and start-up must never begin pulling a personal calendar into a space
// nobody imported it into.
const lastImportKey = (uid: string, spaceId: string) => `family_gcalLastImport_${uid}_${spaceId || 'default'}`;

export function readLastGoogleImport(uid: string | null | undefined, spaceId: string | null | undefined): string | null {
  if (!uid) return null;
  try {
    const v = localStorage.getItem(lastImportKey(uid, spaceId || ''));
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch {
    return null;
  }
}

export function writeLastGoogleImport(
  uid: string | null | undefined,
  spaceId: string | null | undefined,
  when: Date = new Date(),
): void {
  if (!uid) return;
  try { localStorage.setItem(lastImportKey(uid, spaceId || ''), when.toISOString()); } catch { /* no storage: start-up just imports again */ }
}

export function isGoogleImportStale(lastIso: string | null, nowMs: number, hours = STALE_AFTER_HOURS): boolean {
  if (!lastIso) return true;
  const t = Date.parse(lastIso);
  if (Number.isNaN(t)) return true;
  return nowMs - t > hours * 3600_000;
}

/** "16 days ago", "3 hours ago", "just now". Null in, null out. */
export function describeLastSync(lastIso: string | null, nowMs: number): string | null {
  if (!lastIso) return null;
  const t = Date.parse(lastIso);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Does this space already hold events brought in from Google? */
export function hasGoogleImportedEvents(events: readonly Pick<CalendarEvent, 'id'>[]): boolean {
  return events.some((e) => typeof e.id === 'string' && e.id.startsWith('gcal-'));
}

/**
 * Should the dashboard import from Google as the app starts?
 *
 * Only for someone who already uses the import in THIS space (a last-import
 * record here, or Google events already in the calendar — the second covers
 * everyone who imported before the record existed), never in the demo, never
 * into a business space (a personal calendar has no business there unless
 * someone deliberately imports it on the Calendar screen), never after a
 * deliberate Disconnect, and only when the last import is stale.
 */
export function shouldImportOnStartup(p: {
  demo: boolean;
  uid: string | null | undefined;
  isBusinessSpace: boolean;
  disconnected: boolean;
  lastIso: string | null;
  hasGoogleEvents: boolean;
  nowMs: number;
}): boolean {
  if (p.demo || !p.uid || p.isBusinessSpace || p.disconnected) return false;
  if (!p.lastIso && !p.hasGoogleEvents) return false;
  return isScheduledCalendarRefreshDue(p.lastIso, new Date(p.nowMs));
}

/** The quiet line shown when start-up couldn't import without asking. */
export function staleSyncNote(lastIso: string | null, nowMs: number): string {
  const ago = describeLastSync(lastIso, nowMs);
  return ago ? `Google Calendar last synced ${ago}` : 'Google Calendar hasn’t synced on this device yet';
}

/** Explicit metadata first; medical context wins over vague work vocabulary. */
export function classifyGoogleEvent(event: GoogleEventItem, workTitles: readonly string[] = []): CalendarEvent['category'] {
  const category = event.extendedProperties?.private?.teluvaCategory || event.extendedProperties?.shared?.teluvaCategory;
  const explicit = ['Work', 'Appointment', 'School', 'Travel', 'Milestone', 'Other'].find(value => (category || '').split(',').some(part => part.trim().toLowerCase() === value.toLowerCase()));
  if (explicit) return explicit as CalendarEvent['category'];
  if (hasMedicalCalendarContext({ title: event.summary || '', description: event.description })) return 'Appointment';
  if (workTitles.some(title => title.trim().toLocaleLowerCase() === (event.summary || '').trim().toLocaleLowerCase())) return 'Work';
  if (event.eventType === 'workingLocation' || event.eventType === 'focusTime' || /\b(work|working|shift|dienst|arbeit|unterricht|lesson|teaching|client meeting)\b/i.test(event.summary || '') || /(?:^|\n)category:\s*work\b/i.test(event.description || '')) return 'Work';
  return 'Other';
}

/** Replace only Google's mirrored records in the queried year; keep native events and older history. */
export function reconcileGoogleEvents(existing: readonly CalendarEvent[], snapshot: readonly CalendarEvent[], now = new Date(), owner?: string): CalendarEvent[] {
  const since = new Date(now); since.setFullYear(since.getFullYear() - 1);
  const cutoff = since.toISOString().slice(0, 10);
  const until = new Date(now); until.setFullYear(until.getFullYear() + 1);
  const end = until.toISOString().slice(0, 10);
  const incomingIds = new Set(snapshot.map(e => e.id));
  const retained = existing.filter(e => !incomingIds.has(e.id) && ( !e.id.startsWith('gcal-') || e.date <= cutoff || e.date >= end || (!!owner && !!e.googleImportOwner && e.googleImportOwner !== owner)));
  const prior = new Map(existing.map(e => [e.id, e]));
  const { fresh } = partitionNewEvents(retained, snapshot.map(e => ({ ...e, ...(prior.get(e.id)?.categoryConfirmed ? { category: prior.get(e.id)!.category, categoryConfirmed: true } : {}), memberIds: e.memberIds?.length ? e.memberIds : prior.get(e.id)?.memberIds || [], remindMe: prior.get(e.id)?.remindMe ?? e.remindMe })));
  return [...retained, ...fresh];
}

/** Latest scheduled 07:00/19:00 Vienna slot, including DST changes. */
export function calendarRefreshSlot(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour'));
  if (hour >= 19) return `${date}-19`;
  if (hour >= 7) return `${date}-07`;
  const yesterday = new Date(`${date}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return `${yesterday.toISOString().slice(0, 10)}-19`;
}
export function isScheduledCalendarRefreshDue(lastIso: string | null, now = new Date()): boolean {
  return !lastIso || !Number.isFinite(Date.parse(lastIso)) || calendarRefreshSlot(new Date(lastIso)) !== calendarRefreshSlot(now);
}
