// Standalone assertion test for googleCalendarImport.ts:
//   npx tsx src/utils/googleCalendarImport.test.ts
// It exits non-zero on failure.
//
// Rory, 2026-09-13: two appointments in Google Calendar never reached Teluva.
// The import only ran from the Calendar screen, and each window stopped at
// Google's first page of 250. What this guards: every page is read, the
// start-up decision imports only when due and only for someone already using
// the import in that space, and the "last synced" line reads right. No
// network: a fake fetch serves fixture pages. Fictional people throughout.
import assert from 'node:assert';
import {
  fetchAllGoogleEvents,
  googleEventsToCalendarEvents,
  importGoogleEvents,
  isGoogleImportRunning,
  isGoogleImportStale,
  describeLastSync,
  shouldImportOnStartup,
  staleSyncNote,
  readLastGoogleImport,
  writeLastGoogleImport,
  hasGoogleImportedEvents,
  GoogleImportAuthError,
  type GoogleEventItem,
} from './googleCalendarImport';
import type { CalendarEvent, FamilyMember } from '../types';

// Node has no localStorage of its own; a Map-backed one stands in.
{
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

const members = [
  { id: 'm1', name: 'Alex Muster', role: 'Parent' },
  { id: 'm2', name: 'Mia Muster', role: 'Child' },
] as unknown as FamilyMember[];

const NOW = new Date('2026-09-13T08:00:00Z');

function item(id: string, summary: string, start: string, allDay = false): GoogleEventItem {
  return { id, summary, start: allDay ? { date: start } : { dateTime: start } };
}

/**
 * A fake Calendar API: `pages[window]` is the list of pages that window
 * returns, each with a nextPageToken except the last. Records every URL.
 */
function fakeFetch(pages: { past: GoogleEventItem[][]; future: GoogleEventItem[][] }, status = 200) {
  const urls: string[] = [];
  const impl = async (url: string) => {
    urls.push(url);
    const windowName = url.includes('timeMax=') ? 'past' : 'future';
    const m = url.match(/pageToken=([^&]+)/);
    const idx = m ? Number(decodeURIComponent(m[1]).split('-')[1]) : 0;
    const list = pages[windowName];
    const body = {
      items: list[idx] || [],
      ...(idx + 1 < list.length ? { nextPageToken: `${windowName}-${idx + 1}` } : {}),
    };
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { impl, urls };
}

// ── paging: every page of both windows, not just the first 250 ─────────────
{
  const future = [
    [item('f1', 'Dentist', '2026-09-15T09:00:00+02:00')],
    [item('f2', 'Parents evening', '2026-09-18T18:00:00+02:00')],
    // Page three: where an appointment a few weeks out lands on a busy calendar.
    [item('f3', 'Psychiatrie Ambulanz', '2026-10-06T09:00:00+02:00')],
  ];
  const past = [
    [item('p1', 'Old thing', '2026-01-10T10:00:00+01:00')],
    [item('p2', 'Older thing', '2026-02-10T10:00:00+01:00')],
  ];
  const { impl, urls } = fakeFetch({ past, future });
  const r = await fetchAllGoogleEvents('tok', { now: NOW, fetchImpl: impl });
  assert.deepEqual(r.items.map((i) => i.id).sort(), ['f1', 'f2', 'f3', 'p1', 'p2'], 'every page of both windows is read');
  assert.equal(r.truncated, false);
  assert.equal(urls.length, 5, 'one request per page');
  assert.ok(urls.every((u) => u.includes('maxResults=250') && u.includes('singleEvents=true')));
  assert.ok(urls.some((u) => u.includes('pageToken=future-2')), 'follows nextPageToken');

  // CONTROL — the old behaviour (one page per window) really does miss the
  // appointment on page three, so the assertion above can fail.
  const firstPageOnly = await fetchAllGoogleEvents('tok', { now: NOW, fetchImpl: fakeFetch({ past, future }).impl, maxPages: 1 });
  assert.ok(!firstPageOnly.items.some((i) => i.id === 'f3'), 'CONTROL: stopping at one page loses the psychiatry appointment');
  assert.equal(firstPageOnly.truncated, true, 'and says it stopped early rather than pretending it read everything');
}

// ── the time window is unchanged: past year to now, and now onwards ───────
{
  const { impl, urls } = fakeFetch({ past: [[]], future: [[]] });
  await fetchAllGoogleEvents('tok', { now: NOW, fetchImpl: impl });
  const pastUrl = urls.find((u) => u.includes('timeMax='))!;
  const futureUrl = urls.find((u) => !u.includes('timeMax='))!;
  assert.ok(pastUrl.includes('timeMin=2025-09-13T08:00:00.000Z') && pastUrl.includes('timeMax=2026-09-13T08:00:00.000Z'));
  assert.ok(futureUrl.includes('timeMin=2026-09-13T08:00:00.000Z'), 'future window has no upper bound');
}

// ── a dead token is a distinct error the callers can act on ────────────────
{
  const { impl } = fakeFetch({ past: [[]], future: [[]] }, 401);
  await assert.rejects(fetchAllGoogleEvents('tok', { now: NOW, fetchImpl: impl }), GoogleImportAuthError);
  const { impl: impl500 } = fakeFetch({ past: [[]], future: [[]] }, 500);
  await assert.rejects(fetchAllGoogleEvents('tok', { now: NOW, fetchImpl: impl500 }), (e: unknown) => !(e instanceof GoogleImportAuthError));
}

// ── transform: same events the Calendar screen always made ─────────────────
{
  const existing: CalendarEvent[] = [
    { id: 'gcal-already', title: 'Already here', date: '2026-09-20', category: 'Appointment', remindMe: true },
  ];
  const out = googleEventsToCalendarEvents([
    item('already', 'Already here', '2026-09-20T10:00:00+02:00'),
    item('x1', 'Orthopädie Dr. Beispiel', '2026-09-22T10:30:00+02:00'),
    item('x1', 'Orthopädie Dr. Beispiel', '2026-09-22T10:30:00+02:00'), // same id from the other window
    item('x2', '[Family Hub] Exported by us', '2026-09-23T10:00:00+02:00'),
    item('x3', 'Mia - Zahnarzt', '2026-09-24', true),
    { id: 'x4', summary: 'No start' },
  ], existing, members);
  assert.deepEqual(out.map((e) => e.id), ['gcal-x1', 'gcal-x3']);
  const ortho = out[0];
  assert.equal(ortho.date, '2026-09-22');
  assert.equal(ortho.time, '10:30');
  assert.equal(ortho.category, 'Appointment');
  assert.deepEqual(ortho.memberIds, [], 'no name in the title: untagged (the whose-is-this prompt asks)');
  assert.equal(out[1].time, '12:00', 'all-day keeps the old noon placeholder');
  assert.deepEqual(out[1].memberIds, ['m2'], 'a name in the title is read on the way in');
}

// ── importGoogleEvents: one at a time ─────────────────────────────────────
{
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const slow = async (url: string) => {
    await gate;
    return { ok: true, status: 200, json: async () => ({ items: url.includes('timeMax=') ? [] : [item('n1', 'Dentist', '2026-09-15T09:00:00+02:00')] }) };
  };
  const first = importGoogleEvents('tok', [], members, { now: NOW, fetchImpl: slow });
  assert.equal(isGoogleImportRunning(), true);
  const second = await importGoogleEvents('tok', [], members, { now: NOW, fetchImpl: slow });
  assert.equal(second, null, 'a second import while one runs does nothing (it would save the same batch twice)');
  release();
  const r = await first;
  assert.ok(r && r.fresh.length === 1 && r.fetched === 1);
  assert.equal(isGoogleImportRunning(), false, 'the lock is released afterwards');

  // Released after a failure too.
  const { impl: bad } = fakeFetch({ past: [[]], future: [[]] }, 500);
  await assert.rejects(importGoogleEvents('tok', [], members, { now: NOW, fetchImpl: bad }));
  assert.equal(isGoogleImportRunning(), false, 'a failed import does not leave the lock held');
}

// ── stale / last-synced wording ───────────────────────────────────────────
{
  const now = Date.parse('2026-09-13T08:00:00Z');
  assert.equal(isGoogleImportStale(null, now), true, 'never imported = due');
  assert.equal(isGoogleImportStale('2026-09-13T05:00:00Z', now), false, '3 hours ago is fresh');
  assert.equal(isGoogleImportStale('2026-09-13T03:00:00Z', now), true, '5 hours ago is due');
  assert.equal(isGoogleImportStale('garbage', now), true);

  assert.equal(describeLastSync('2026-08-28T08:00:00Z', now), '16 days ago');
  assert.equal(describeLastSync('2026-09-12T07:00:00Z', now), 'yesterday');
  assert.equal(describeLastSync('2026-09-13T05:00:00Z', now), '3 hours ago');
  assert.equal(describeLastSync('2026-09-13T07:59:30Z', now), 'just now');
  assert.equal(describeLastSync(null, now), null);
  assert.equal(staleSyncNote('2026-08-28T08:00:00Z', now), 'Google Calendar last synced 16 days ago');
  assert.ok(staleSyncNote(null, now).includes('hasn’t synced'));
}

// ── start-up: only when due, only for someone already importing here ──────
{
  const now = Date.parse('2026-09-13T08:00:00Z');
  const base = {
    demo: false, uid: 'u1', isBusinessSpace: false, disconnected: false,
    lastIso: '2026-08-28T08:00:00Z', hasGoogleEvents: true, nowMs: now,
  };
  assert.equal(shouldImportOnStartup(base), true, 'stale, and this person imports here: import');
  assert.equal(shouldImportOnStartup({ ...base, lastIso: null }), true, 'no record yet but Google events already here (everyone before this release)');
  assert.equal(shouldImportOnStartup({ ...base, lastIso: '2026-09-13T06:00:00Z' }), false, 'imported two hours ago: not due');
  assert.equal(shouldImportOnStartup({ ...base, lastIso: null, hasGoogleEvents: false }), false, 'never used the import in this space: never start it uninvited');
  assert.equal(shouldImportOnStartup({ ...base, disconnected: true }), false, 'a deliberate Disconnect is respected');
  assert.equal(shouldImportOnStartup({ ...base, isBusinessSpace: true }), false, 'never pulls a personal calendar into a business space at start-up');
  assert.equal(shouldImportOnStartup({ ...base, demo: true }), false);
  assert.equal(shouldImportOnStartup({ ...base, uid: null }), false);
}

// ── the record is per person AND per space ────────────────────────────────
{
  writeLastGoogleImport('u1', 'famA', new Date('2026-09-10T00:00:00Z'));
  assert.equal(readLastGoogleImport('u1', 'famA'), '2026-09-10T00:00:00.000Z');
  assert.equal(readLastGoogleImport('u1', 'bizB'), null, 'an import into one space says nothing about another');
  assert.equal(readLastGoogleImport('u2', 'famA'), null, 'nor about another person on the same device');
  assert.equal(readLastGoogleImport(null, 'famA'), null);
  // family_ prefix so the logout sweep in lib/firebase.ts clears it.
  assert.notEqual((globalThis as any).localStorage.getItem('family_gcalLastImport_u1_famA'), null, 'stored under a family_-prefixed key');
}

{
  assert.equal(hasGoogleImportedEvents([{ id: 'gcal-1' }, { id: 'local' }]), true);
  assert.equal(hasGoogleImportedEvents([{ id: 'local' }]), false);
}

console.log('googleCalendarImport: paging, window, lock, start-up decision and last-synced wording OK (1 control fails as it should)');
