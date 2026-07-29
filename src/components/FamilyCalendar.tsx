import React, { useState, useEffect, useRef } from 'react';
import { CalendarEvent, FamilyMember } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import {
  Calendar, Clock, Plus, Trash2, Edit2,
  Users, Check, Bell, ChevronLeft, ChevronRight, AlertCircle, X, Info,
  Cloud, RefreshCcw, Loader2, LogIn, Send, Download, ScanLine, Link2
} from 'lucide-react';
import { initAuth, googleSignIn, logout, getAccessToken, invalidateAccessToken, connectGoogleAccess } from '../utils/firebase';
import { auth } from '../lib/firebase';
import { compressImageToAvatar } from '../utils/imageCompress';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  pushEventToGoogleCalendar,
  isGoogleOriginEventId,
  isEligibleForGooglePush,
  GoogleCalendarAuthError,
} from '../utils/googleCalendarSync';
import { partitionNewEvents } from '../utils/calendarDedup';
import { resolveEventMembers } from '../utils/eventMemberMatch';
import { parseIcs, buildIcs } from '../utils/ics';
import {
  CalendarFeed, mergeFeedEvents, removeFeedEvents, feedIdForUrl, describeSync, suggestFeedLabel,
} from '../utils/calendarFeeds';

// Bug fix #1: local-date helper avoids UTC-day-shift for Vienna (UTC+1/+2)
const todayLocal = () => new Date().toLocaleDateString('en-CA');

/** One published outbound feed, as /api/calendar-publish/list returns it. */
interface PublishedLink {
  token: string;
  path: string;
  mode: 'details' | 'busy';
  label: string;
  createdAt: string;
  createdByName: string;
  lastFetchedAt: string | null;
  fetchCount: number;
}

interface FamilyCalendarProps {
  members: FamilyMember[];
  events: CalendarEvent[];
  onSaveEvents: (events: CalendarEvent[]) => void;
  // Opt-in outbound sync switch (HubSettings.autoSyncEventsToGoogle, owned by
  // Dashboard). Default OFF — see the toggle in the Google Calendar Sync
  // Panel below and the auto-sync effect further down this file for what
  // flipping it on actually does and does not do.
  autoSyncEnabled: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
  /** Subscribed external calendars (HubSettings.calendarFeeds), owned by Dashboard. */
  calendarFeeds: CalendarFeed[];
  onSaveCalendarFeeds: (feeds: CalendarFeed[]) => void;
}

export default function FamilyCalendar({ members, events, onSaveEvents, autoSyncEnabled, onToggleAutoSync, calendarFeeds, onSaveCalendarFeeds }: FamilyCalendarProps) {
  const { isAdmin, canWrite, aiEligible, aiConsent } = useFamilyCtx();
  const aiOn = aiEligible && aiConsent;  // AI scan is off until the user opts in
  // Bug fix #1: replaced hardcoded new Date('2026-05-22') with real today
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth()); // 0-indexed
  // Bug fix #6: use todayLocal() instead of toISOString().split('T')[0]
  const [selectedDateStr, setSelectedDateStr] = useState(todayLocal());

  // Google Calendar Connection States
  const [needsAuth, setNeedsAuth] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleCalendarSyncing, setIsGoogleCalendarSyncing] = useState(false);
  const [calendarSyncError, setCalendarSyncError] = useState<string | null>(null);

  // Bug fix #2: run-once ref prevents stale-closure duplicate imports
  const hasAutoImported = useRef(false);

  // Calendar-file (.ics) import/export — for Apple, Outlook and everything
  // else Teluva has no API connection to.
  const icsInputRef = useRef<HTMLInputElement>(null);
  const [isImportingIcs, setIsImportingIcs] = useState(false);
  const [icsNote, setIcsNote] = useState<string | null>(null);
  // Subscribed calendars — id of the feed currently syncing, or 'adding'.
  const [feedUrlInput, setFeedUrlInput] = useState('');
  const [feedBusy, setFeedBusy] = useState<string | null>(null);

  // Sync state observer
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, cachedToken) => {
        setUser(currentUser);
        setToken(cachedToken);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
        setUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Bug fix #2: auto-sync fires only once per mount
  useEffect(() => {
    if (token && !hasAutoImported.current) {
      hasAutoImported.current = true;
      handleImportFromGoogle();
    }
  }, [token]);

  const handleLoginGoogle = async () => {
    setIsLoggingIn(true);
    setCalendarSyncError(null);
    try {
      // Someone already signed in to Teluva with Google doesn't need to sign in
      // AGAIN to reconnect the calendar — they need a fresh API token, which is
      // a much smaller thing to ask for. Try that first; it's usually silent,
      // and at worst it's one click instead of the whole sign-in popup.
      const existing = auth.currentUser;
      if (existing) {
        const t = await connectGoogleAccess();
        if (t) {
          setToken(t);
          setUser(existing);
          setNeedsAuth(false);
          triggerReminderNotification('Successfully connected to Google Calendar!');
          return;
        }
      }
      // Not signed in, or the token request couldn't complete — the original
      // full sign-in flow, unchanged.
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
        triggerReminderNotification('Successfully connected to Google Calendar!');
      }
    } catch (err: any) {
      console.error(err);
      setCalendarSyncError('Failed to authorize with Google Calendar.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // --- Subscribed calendars -------------------------------------------------
  //
  // Fetching happens on OUR server (see server/feedUrl.mjs) because the URL
  // comes from a user and pointing a server at an arbitrary address is the most
  // dangerous thing this app does. The browser only ever parses the text that
  // comes back, with exactly the same parser the file import uses.
  const syncFeed = async (feed: CalendarFeed, opts: { announce?: boolean } = {}) => {
    setFeedBusy(feed.id);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const res = await fetch('/api/calendar-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: feed.url }),
      });
      const data = await res.json();
      // CRITICAL: only merge on success. mergeFeedEvents treats an empty list as
      // "this calendar has no events" and deletes everything the feed owns —
      // correct for a real empty calendar, catastrophic for a failed request.
      if (!res.ok || typeof data.ics !== 'string') {
        throw new Error(data.error || 'Could not fetch that calendar.');
      }

      const parsed = parseIcs(data.ics, members);
      const merged = mergeFeedEvents(events, parsed.events, feed.id);
      onSaveEvents(merged.events);
      onSaveCalendarFeeds(
        calendarFeeds.map((f) => (f.id === feed.id
          ? { ...f, lastSyncedAt: new Date().toISOString(), lastError: undefined, eventCount: parsed.events.length }
          : f)),
      );
      if (opts.announce) {
        setIcsNote([describeSync(merged), ...parsed.warnings].join('\n'));
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not fetch that calendar.';
      console.error('[feed] sync failed', err);
      onSaveCalendarFeeds(calendarFeeds.map((f) => (f.id === feed.id ? { ...f, lastError: message } : f)));
      if (opts.announce) setIcsNote(message);
      return false;
    } finally {
      setFeedBusy(null);
    }
  };

  const handleAddFeed = async () => {
    const url = feedUrlInput.trim();
    if (!url) return;
    setIcsNote(null);
    const id = feedIdForUrl(url.replace(/^webcal:\/\//i, 'https://'));
    if (calendarFeeds.some((f) => f.id === id)) {
      setIcsNote('That calendar is already subscribed — use Refresh on it instead.');
      return;
    }
    const feed: CalendarFeed = {
      id,
      url,
      label: suggestFeedLabel(url),
      addedAt: new Date().toISOString(),
    };
    // Save the subscription first so a failed first fetch still leaves
    // something on screen to retry or remove, rather than vanishing.
    onSaveCalendarFeeds([...calendarFeeds, feed]);
    setFeedUrlInput('');
    await syncFeed(feed, { announce: true });
  };

  const handleRefreshFeed = (feed: CalendarFeed) => {
    setIcsNote(null);
    return syncFeed(feed, { announce: true });
  };

  const handleRemoveFeed = (feed: CalendarFeed) => {
    const { events: kept, removed } = removeFeedEvents(events, feed.id);
    onSaveEvents(kept);
    onSaveCalendarFeeds(calendarFeeds.filter((f) => f.id !== feed.id));
    setIcsNote(`Unsubscribed from ${feed.label}${removed ? ` and removed its ${removed} ${removed === 1 ? 'event' : 'events'}` : ''}.`);
  };

  // --- Publishing OUR calendar outward -------------------------------------
  //
  // The other direction: a link the family pastes into Apple/Outlook/Google so
  // Teluva's events show up there. Deliberately blunt about what the link is —
  // a calendar app cannot sign in, so the URL itself is the password, and the
  // person creating it needs to understand that before they send it anywhere.
  const [publishedLinks, setPublishedLinks] = useState<PublishedLink[] | null>(null);
  const [publishBusy, setPublishBusy] = useState<string | null>(null);
  const [publishMode, setPublishMode] = useState<'details' | 'busy'>('details');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const publishApi = async (path: string, init?: RequestInit) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in again.');
    const idToken = await user.getIdToken();
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'That did not work. Please try again.');
    return data;
  };

  const loadPublishedLinks = async () => {
    try {
      const data = await publishApi('/api/calendar-publish/list');
      setPublishedLinks(data.links || []);
    } catch {
      setPublishedLinks([]);   // never block the panel on this
    }
  };

  const handlePublish = async () => {
    setPublishBusy('creating');
    setIcsNote(null);
    try {
      const data = await publishApi('/api/calendar-publish/create', {
        method: 'POST',
        body: JSON.stringify({ mode: publishMode }),
      });
      await loadPublishedLinks();
      const url = `${window.location.origin}${data.path}`;
      // Copying immediately is the whole point — the link is unreadable and
      // nobody is going to retype 43 characters of base64.
      try { await navigator.clipboard.writeText(url); setCopiedToken(data.token); } catch { /* clipboard blocked */ }
      setIcsNote(`Calendar link created and copied. Paste it into Apple Calendar, Outlook or Google as a subscribed calendar.`);
    } catch (e: any) {
      setIcsNote(e?.message || 'Could not create the link.');
    } finally {
      setPublishBusy(null);
    }
  };

  const handleRevokePublish = async (link: PublishedLink) => {
    if (!window.confirm('Turn this link off? Anyone using it — including your own Apple or Outlook calendar — will stop receiving these events.')) return;
    setPublishBusy(link.token);
    try {
      await publishApi('/api/calendar-publish/revoke', { method: 'POST', body: JSON.stringify({ token: link.token }) });
      await loadPublishedLinks();
      setIcsNote('That link is off. It will stop working within the hour, wherever it was used.');
    } catch (e: any) {
      setIcsNote(e?.message || 'Could not turn that link off.');
    } finally {
      setPublishBusy(null);
    }
  };

  const copyPublishedLink = async (link: PublishedLink) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${link.path}`);
      setCopiedToken(link.token);
      window.setTimeout(() => setCopiedToken((t) => (t === link.token ? null : t)), 2500);
    } catch {
      setIcsNote('Could not copy — select the link and copy it manually.');
    }
  };

  // Refresh every subscription once per mount. Quietly — nobody opened the
  // calendar to read a sync report.
  const hasSyncedFeeds = useRef(false);
  useEffect(() => {
    if (hasSyncedFeeds.current || !calendarFeeds.length || !canWrite) return;
    hasSyncedFeeds.current = true;
    (async () => {
      for (const f of calendarFeeds) await syncFeed(f);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarFeeds.length, canWrite]);

  // Load any existing published links once, so a family that already has one
  // sees it rather than being invited to create a second.
  useEffect(() => {
    if (publishedLinks !== null || !auth.currentUser) return;
    loadPublishedLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // --- Calendar files (.ics): every calendar that isn't Google -------------
  //
  // Runs entirely on the device. Nothing is uploaded, no account is connected,
  // and the file never leaves the browser — which is also why this works for a
  // calendar we have no API relationship with at all.
  const handleImportIcsFile = async (file: File) => {
    setIsImportingIcs(true);
    setIcsNote(null);
    try {
      const text = await file.text();
      const { events: parsed, warnings, sourceCount } = parseIcs(text, members);

      if (sourceCount === 0) {
        setIcsNote('That file has no appointments in it. Export a calendar as .ics and try that one.');
        return;
      }
      if (parsed.length === 0) {
        setIcsNote(`Nothing could be imported from that file.${warnings.length ? '\n' + warnings.join('\n') : ''}`);
        return;
      }

      // The same two-stage dedup the Google import uses: exact id first (so
      // re-importing the same file is a no-op), then the human-level pass that
      // catches the same appointment arriving with a different id.
      const notAlreadyHere = parsed.filter((ev) => !events.some((e) => e.id === ev.id));
      const { fresh, duplicates } = partitionNewEvents(events, notAlreadyHere);
      const skipped = parsed.length - fresh.length;

      if (fresh.length === 0) {
        setIcsNote(`Everything in that file is already on your calendar — nothing added.${warnings.length ? '\n' + warnings.join('\n') : ''}`);
        return;
      }

      onSaveEvents([...events, ...fresh]);
      const bits = [`Added ${fresh.length} ${fresh.length === 1 ? 'appointment' : 'appointments'} from ${file.name}.`];
      if (skipped) bits.push(`${skipped} ${skipped === 1 ? 'was' : 'were'} already here${duplicates.length ? ' or looked identical' : ''}.`);
      bits.push(...warnings);
      setIcsNote(bits.join('\n'));
    } catch (err) {
      console.error('[ics] import failed', err);
      setIcsNote('That file couldn’t be read. It should be a .ics calendar file.');
    } finally {
      setIsImportingIcs(false);
    }
  };

  const handleDownloadIcs = () => {
    try {
      const ics = buildIcs(events, 'Teluva');
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'teluva-calendar.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a tick, not immediately — Safari cancels an in-flight
      // download if the object URL disappears the moment the click returns.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setIcsNote(`Saved ${events.length} ${events.length === 1 ? 'event' : 'events'} as teluva-calendar.ics — open it in Apple Calendar, Outlook or anything else.`);
    } catch (err) {
      console.error('[ics] export failed', err);
      setIcsNote('Could not build the calendar file.');
    }
  };

  // Manual, single-event "push this to Google" — the cloud icon next to an
  // event in the agenda list. Also the function the automatic sync effect
  // (further down) calls for each newly-created event once the opt-in
  // toggle is on, so this is the ONE place a Teluva event actually leaves
  // the app. isGoogleOriginEventId() is checked as a hard stop before any
  // network call, not just as a UI hint — see the comment in
  // src/utils/googleCalendarSync.ts for why an event Teluva imported FROM
  // Google must never be sent back to Google.
  const pushEventToGoogle = async (ev: CalendarEvent) => {
    if (!token) {
      triggerReminderNotification('Please connect Google Calendar first.');
      return;
    }
    if (isGoogleOriginEventId(ev.id)) {
      // The cloud button is hidden for imported events in the JSX below, so
      // this only fires if something calls pushEventToGoogle directly (e.g.
      // the auto-sync effect) — kept as a second line of defence rather than
      // trusting the UI alone to prevent the export/import loop.
      triggerReminderNotification('This event came from Google Calendar already — nothing to export.');
      return;
    }

    setIsGoogleCalendarSyncing(true);
    setCalendarSyncError(null);
    try {
      await pushEventToGoogleCalendar(ev, token);
      // Mark this event as synced so it's never pushed a second time — by a
      // repeat click of this same button, or by the auto-sync effect if the
      // opt-in toggle is also on for future events.
      onSaveEvents(events.map(e => (e.id === ev.id ? { ...e, googleSynced: true } : e)));
      triggerReminderNotification(`Exported "${ev.title}" to Google Calendar!`);
    } catch (err: any) {
      console.error(err);
      if (err instanceof GoogleCalendarAuthError) {
        setNeedsAuth(true);
        setToken(null);
        // Also clear the SHARED token cache (utils/firebase.ts), not just
        // this component's local `token` state — Dashboard.tsx's automatic
        // sync effect reads that same cache independently via
        // getAccessToken(), and without this it would keep retrying the
        // exact token that just failed here.
        invalidateAccessToken();
      }
      setCalendarSyncError(err.message || 'Error exporting to Google Calendar.');
    } finally {
      setIsGoogleCalendarSyncing(false);
    }
  };

  // NOTE ON WHERE THE AUTOMATIC PUSH ACTUALLY HAPPENS: it is NOT in this
  // component. An earlier version of this feature lived entirely here, as a
  // useEffect watching `events` with a React ref tracking "ids seen so far."
  // That was broken: this component is only mounted while the user is on
  // the Calendar tab (see `{mainView === 'calendar' && <FamilyCalendar .../>}`
  // in Dashboard.tsx), so an event created via the AI chat while the user
  // was looking at a profile never reached this effect at all — and the
  // moment the user DID open Calendar, the ref started fresh and treated
  // that already-pending event as part of the "existing" baseline, so it
  // was silently never pushed. A per-mount ref cannot be the mechanism that
  // decides "is this new" for a component that isn't always mounted.
  //
  // The automatic push now lives in Dashboard.tsx, which owns `events` and
  // is mounted for the app's entire session regardless of which tab is
  // showing, and it reads the Google access token via
  // utils/firebase.ts's getAccessToken() — the same module-level token this
  // component's handleLoginGoogle populates — rather than duplicating the
  // connect/refresh flow. See the comment on that effect for the full
  // reasoning, and utils/googleCalendarSync.ts's file header for why the
  // "never bulk-push history" guarantee is now a persisted id snapshot
  // (HubSettings.autoSyncBaselineIds) instead of in-memory "seen" state.
  //
  // This component still owns: the manual per-event push button and the
  // manual "export all" bulk button just below, and the opt-in toggle UI in
  // the Sync Panel (autoSyncEnabled / onToggleAutoSync props) — Dashboard
  // is what actually persists the toggle and captures the baseline snapshot
  // when it flips on.

  // Bulk "export all" — a manual, explicitly-confirmed action, distinct from
  // the automatic per-new-event sync below. IMPORTANT: this used to loop
  // over the raw `events` array and push every single one, which for a
  // household whose calendar is mostly events already IMPORTED from Google
  // (id prefix "gcal-") meant every "Export all" click created a fresh
  // duplicate of nearly the entire calendar on the Google side — the exact
  // export/import corruption risk this integration has to avoid. It now
  // only ever touches events that pass isEligibleForGooglePush: Teluva-
  // native (never "gcal-") and not already marked googleSynced from a
  // previous push. Re-clicking this button is therefore safe — the second
  // click has nothing left to do for events the first click already sent.
  const handleExportAllToGoogle = async () => {
    if (!token) return;
    const eligible = events.filter(isEligibleForGooglePush);
    if (eligible.length === 0) {
      triggerReminderNotification('Nothing to export — every Family Hub event is already on Google Calendar or came from there.');
      return;
    }
    const skipped = events.length - eligible.length;
    const confirmPush = window.confirm(
      `Ready to push ${eligible.length} event${eligible.length !== 1 ? 's' : ''} to your Google Calendar?` +
      (skipped > 0 ? ` (${skipped} already came from Google or were exported before, so they'll be skipped.)` : '')
    );
    if (!confirmPush) return;

    setIsGoogleCalendarSyncing(true);
    setCalendarSyncError(null);
    const syncedIds = new Set<string>();
    let authExpired = false;
    for (const ev of eligible) {
      try {
        await pushEventToGoogleCalendar(ev, token);
        syncedIds.add(ev.id);
      } catch (e) {
        console.error('Batch sync failure for event id ' + ev.id, e);
        if (e instanceof GoogleCalendarAuthError) {
          // Stop the batch rather than burning through the rest of a
          // (potentially large) confirmed export against a token already
          // known to be dead, and clear the shared cache so Dashboard's
          // independent auto-sync effect doesn't retry it either.
          authExpired = true;
          break;
        }
      }
    }
    if (syncedIds.size > 0) {
      onSaveEvents(events.map(e => (syncedIds.has(e.id) ? { ...e, googleSynced: true } : e)));
    }
    setIsGoogleCalendarSyncing(false);
    if (authExpired) {
      setNeedsAuth(true);
      setToken(null);
      invalidateAccessToken();
      setCalendarSyncError(`Authorization expired after ${syncedIds.size} of ${eligible.length} events — reconnect to send the rest.`);
    } else {
      triggerReminderNotification(`Successfully exported ${syncedIds.size} event${syncedIds.size !== 1 ? 's' : ''} to Google Calendar!`);
    }
  };

  const handleImportFromGoogle = async () => {
    if (!token) return;
    setIsGoogleCalendarSyncing(true);
    setCalendarSyncError(null);
    try {
      // Check token scopes first if possible
      try {
        const tokenInfoRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`);
        if (tokenInfoRes.ok) {
          const tokenInfo = await tokenInfoRes.json();
          if (tokenInfo.scope && !tokenInfo.scope.includes('calendar') && !tokenInfo.scope.includes('calendar.events')) {
            setNeedsAuth(true);
            setToken(null);
            throw new Error('You did not grant Google Calendar permissions. You MUST check the box for Google Calendar on the sign-in screen.');
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('permissions')) throw e;
      }

      // A genuine backfill needs to reach back before the user started using this
      // app, not just forward from today — this was previously a hardcoded
      // absolute date (2026-01-01), which both missed anything entered before
      // that and would silently drift further wrong every year it wasn't
      // updated. One year back is enough to catch "I already had this on my
      // Google Calendar" appointments without pulling in irrelevant ancient
      // history. maxResults raised from 30 to 250 (a higher one-time cap, not
      // full pageToken pagination) so a real year-plus backfill isn't silently
      // truncated on the very first import.
      //
      // Past and future are fetched as TWO SEPARATE requests, each with their
      // own 250 cap. A single request spanning both (timeMin=1yr-ago, no
      // timeMax) sorts oldest-first, so an active calendar's past events alone
      // could exhaust the entire cap and silently crowd out every upcoming
      // appointment — the opposite of what an import is for. The future
      // request has no timeMax, so it reaches at least a year out and further
      // for anything already on the calendar beyond that.
      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const nowIso = now.toISOString();
      const gcalHeaders = { headers: { 'Authorization': `Bearer ${token}` } };
      const [pastRes, futureRes] = await Promise.all([
        fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${oneYearAgo.toISOString()}&timeMax=${nowIso}&maxResults=250&orderBy=startTime&singleEvents=true`, gcalHeaders),
        fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${nowIso}&maxResults=250&orderBy=startTime&singleEvents=true`, gcalHeaders),
      ]);

      if (!pastRes.ok) throw new Error(`Google Calendar API error: ${pastRes.status}`);
      if (!futureRes.ok) throw new Error(`Google Calendar API error: ${futureRes.status}`);

      const [pastData, futureData] = await Promise.all([pastRes.json(), futureRes.json()]);
      const googleEvents = [...(pastData.items || []), ...(futureData.items || [])];

      if (googleEvents.length === 0) {
        triggerReminderNotification('No events found in Google Calendar.');
        return;
      }

      const importedEvents: CalendarEvent[] = [];
      const seenThisRun = new Set<string>();
      googleEvents.forEach((gEv: any) => {
        // Bug fix #5: skip events previously exported from Family Hub
        if ((gEv.summary || '').startsWith('[Family Hub]')) return;

        // The past/future requests' boundaries could in principle both return
        // the same event; guard against double-adding it in this run.
        if (seenThisRun.has(gEv.id)) return;
        seenThisRun.add(gEv.id);

        // Bug fix #5: dedupe by Google event id instead of case-insensitive title
        const exists = events.some(e => e.id === 'gcal-' + gEv.id);
        if (exists) return;

        const startVal = gEv.start?.dateTime || gEv.start?.date || '';
        if (!startVal) return;

        const datePart = startVal.substring(0, 10); // YYYY-MM-DD
        let timePart = '12:00';
        if (gEv.start?.dateTime) {
          timePart = startVal.substring(11, 16); // HH:MM
        }

        importedEvents.push({
          // Bug fix #5: id is now 'gcal-' + gEv.id so dedup works on next run
          id: 'gcal-' + gEv.id,
          title: gEv.summary || 'Google Appointment',
          date: datePart,
          time: timePart,
          description: gEv.description || 'Imported from Google Calendar',
          category: 'Appointment',
          remindMe: true,
          // Google has no idea who lives in this house, so every imported
          // event used to arrive tagged to nobody — which meant a real
          // appointment titled "Ganga - Orthodontist" landed on the calendar
          // and appeared on nobody's Medical or Check-ups screen. Read the
          // person out of the title on the way in. See
          // utils/eventMemberMatch.ts for why the title and not the
          // description, and why an explicit tag always wins.
          memberIds: resolveEventMembers(
            { title: gEv.summary || '', memberIds: [] },
            members,
          ).memberIds,
        });
      });

      // Second, human-level dedup pass. The id check above only catches an
      // event we have ALREADY imported under the same Google id. It cannot
      // catch two DIFFERENT Google ids that describe the same appointment —
      // and that is what a real calendar produced: six pairs of identical
      // "Klara" entries, one pair being a recurring instance alongside a moved
      // exception of that same instance. Both are real on Google's side; in
      // here they are two rows nobody can tell apart. See utils/calendarDedup.
      const { fresh, duplicates } = partitionNewEvents(events, importedEvents);

      if (fresh.length === 0) {
        triggerReminderNotification(
          duplicates.length > 0
            ? `Nothing new — ${duplicates.length} matched something already on your calendar.`
            : 'All events are already matched.',
        );
      } else {
        onSaveEvents([...events, ...fresh]);
        triggerReminderNotification(
          `Imported ${fresh.length} new entr${fresh.length === 1 ? 'y' : 'ies'} from Google Calendar!` +
          (duplicates.length > 0 ? ` (${duplicates.length} skipped as duplicates.)` : ''),
        );
      }
    } catch (err: any) {
      console.error(err);
      setCalendarSyncError(err.message || 'Failed to import from Google Calendar.');
    } finally {
      setIsGoogleCalendarSyncing(false);
    }
  };

  // --- Scan notice / flyer to extract calendar events ---
  const [isScanningNotice, setIsScanningNotice] = useState(false);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [noticeResult, setNoticeResult] = useState<{ events: any[]; reply: string } | null>(null);
  const scanFileRef = useRef<HTMLInputElement>(null);

  const handleScanNotice = async (file: File) => {
    if (!aiOn) { setNoticeError('Turn on the AI assistant in Settings first.'); return; }
    setIsScanningNotice(true);
    setNoticeError(null);
    setNoticeResult(null);
    try {
      let dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      let mimeType = file.type || 'application/octet-stream';
      if (mimeType.startsWith('image/')) {
        dataUrl = await compressImageToAvatar(dataUrl, 1600, 0.82);
        mimeType = 'image/jpeg';
      }
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in first.');
      const token = await user.getIdToken();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: 'Read this school notice, event flyer, or newsletter. Extract EVERY event, date, appointment and deadline as calendar_event edits — include date (YYYY-MM-DD), time if visible, a clear title, and category (School for school events). Today\'s date is provided in the system context.',
          // Only what event-tagging needs — never raw members (avatars, docs, accounts)
          context: { members: members.map(m => ({ id: m.id, name: m.name, nickname: m.nickname, role: m.role })), calendar: events },
          history: [],
          image: { mimeType, data: dataUrl.split(',')[1] },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not read the notice.');
      const calEdits = (data.edits || []).filter((e: any) => e.kind === 'calendar_event');
      if (calEdits.length === 0) throw new Error(data.reply || 'No events found in this image — try a clearer photo of the notice.');
      setNoticeResult({ events: calEdits, reply: data.reply || '' });
    } catch (e: any) {
      setNoticeError(e?.message || 'Could not read the notice.');
    } finally {
      setIsScanningNotice(false);
    }
  };

  const handleApplyNoticeEvents = () => {
    if (!noticeResult) return;
    const today = new Date().toLocaleDateString('en-CA');
    const VALID_CATS = ['Milestone', 'Appointment', 'School', 'Travel', 'Other'];
    const newEvents: CalendarEvent[] = noticeResult.events.map((e: any) => ({
      id: 'scan-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      title: e.title || 'Event',
      date: e.date || today,
      time: e.time || undefined,
      description: '',
      category: (VALID_CATS.includes(e.category) ? e.category : 'School') as CalendarEvent['category'],
      remindMe: true,
      memberIds: [],
    }));
    // Photographing the same school notice twice is an easy thing to do, and
    // before this it produced a second set of every date on it.
    const { fresh, duplicates } = partitionNewEvents(events, newEvents);
    if (fresh.length > 0) onSaveEvents([...events, ...fresh]);
    setNoticeResult(null);
    triggerReminderNotification(
      fresh.length === 0
        ? 'Everything on that notice is already on the calendar.'
        : `Added ${fresh.length} event${fresh.length !== 1 ? 's' : ''} from the notice.` +
          (duplicates.length > 0 ? ` (${duplicates.length} already there.)` : ''),
    );
  };

  // Form states for Add/Edit
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Two fixed-inset-0 overlays live in this component (the scan-notice
  // preview and the add/edit event form). Either one open should lock the
  // page behind it; the refcounted hook makes a single call safe even if
  // both were somehow open at once.
  useBodyScrollLock(!!noticeResult || isFormOpen);

  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  // Bug fix #6: use todayLocal() instead of toISOString().split('T')[0]
  const [eventDate, setEventDate] = useState(todayLocal());
  const [eventTime, setEventTime] = useState('12:00');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'Milestone' | 'Appointment' | 'School' | 'Travel' | 'Other'>('Other');
  const [remindMe, setRemindMe] = useState(true);
  const [taggedMemberIds, setTaggedMemberIds] = useState<string[]>([]);
  const [reminderNote, setReminderNote] = useState<string | null>(null);

  // Month properties
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay(); // 0 is Sunday
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayIndex = getFirstDayOfMonth(currentYear, currentMonth);

  // Chevron Controls
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // Build Calendar grid cells
  const calendarCells: (Date | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(new Date(currentYear, currentMonth, d));
  }

  // Format date correctly YYYY-MM-DD (local, not UTC)
  const formatDateString = (dateObj: Date) => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Handle Select Day
  const handleDaySelect = (dateObj: Date | null) => {
    if (dateObj) {
      const dateStr = formatDateString(dateObj);
      setSelectedDateStr(dateStr);
      setEventDate(dateStr);
    }
  };

  // Open Form to Add
  const handleOpenAddForm = () => {
    setEditingEventId(null);
    setTitle('');
    setEventDate(selectedDateStr);
    setEventTime('12:00');
    setDescription('');
    setCategory('Other');
    setRemindMe(true);
    setTaggedMemberIds([]);
    setIsFormOpen(true);
  };

  // Open Form to Edit — read-only for non-writers
  const handleOpenEditForm = (ev: CalendarEvent) => {
    if (!canWrite) return;
    setEditingEventId(ev.id);
    setTitle(ev.title);
    setEventDate(ev.date);
    setEventTime(ev.time || '12:00');
    setDescription(ev.description || '');
    setCategory(ev.category);
    setRemindMe(ev.remindMe);
    // Pre-fill with the name-matched person when nobody was tagged, so
    // opening an inferred event and saving it promotes the guess to a real
    // tag — and clearing the box is how you tell the app the guess was wrong.
    setTaggedMemberIds(resolveEventMembers(ev, members).memberIds);
    setIsFormOpen(true);
  };

  // Commit Event
  const handleCommitEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !eventDate) return;

    if (editingEventId) {
      // Edit mode
      const updatedList = events.map(ev => {
        if (ev.id === editingEventId) {
          return {
            ...ev,
            title: title.trim(),
            date: eventDate,
            time: eventTime || undefined,
            description: description.trim() || undefined,
            category,
            remindMe,
            memberIds: taggedMemberIds,
          };
        }
        return ev;
      });
      onSaveEvents(updatedList);
      triggerReminderNotification('Calendar event updated successfully!');
    } else {
      // Create mode
      const newEvent: CalendarEvent = {
        id: 'ev-' + Date.now(),
        title: title.trim(),
        date: eventDate,
        time: eventTime || undefined,
        description: description.trim() || undefined,
        category,
        remindMe,
        memberIds: taggedMemberIds,
      };
      onSaveEvents([...events, newEvent]);
      triggerReminderNotification(
        remindMe
          ? `Event added — tagged family members will see it on the shared calendar.`
          : `Event added to the shared calendar.`
      );
    }

    setIsFormOpen(false);
  };

  // Delete Event
  const handleDeleteEvent = (eventId: string) => {
    const ev = events.find(e => e.id === eventId);
    const ok = window.confirm(`Delete "${ev?.title || 'this event'}" from the family calendar? This can't be undone.`);
    if (!ok) return;
    const updated = events.filter(e => e.id !== eventId);
    onSaveEvents(updated);
    triggerReminderNotification('Shared calendar entry deleted.');
  };

  const handleToggleMemberTag = (memberId: string) => {
    if (taggedMemberIds.includes(memberId)) {
      setTaggedMemberIds(taggedMemberIds.filter(id => id !== memberId));
    } else {
      setTaggedMemberIds([...taggedMemberIds, memberId]);
    }
  };

  const triggerReminderNotification = (text: string) => {
    setReminderNote(text);
    setTimeout(() => setReminderNote(null), 3000);
  };

  // Find events on selected day
  const selectedDayEvents = events.filter(e => e.date === selectedDateStr)
    .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

  // Quick reminder feed (Events in the next 12 days from today)
  const todayTime = new Date(todayLocal()).getTime();
  const upcomingReminders = events.filter(e => {
    const evTime = new Date(e.date).getTime();
    const diffDays = (evTime - todayTime) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 12;
  }).sort((a, b) => a.date.localeCompare(b.date));

  // Real today string for highlighting the calendar cell
  const realTodayStr = todayLocal();

  return (
    <div className="space-y-6">
      {/* Toast notification */}
      {reminderNote && (
        <div className="p-4 rounded-2xl bg-ink-900 text-white text-sm flex items-center gap-2.5 animate-bounce shadow-lift">
          <Bell className="w-4 h-4 text-sage-400 shrink-0" />
          <span>{reminderNote}</span>
        </div>
      )}

      {/* Header bar */}
      <section className="border-b border-cream-300/50 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-ink-900 flex items-center gap-2">
            <span className="w-1.5 h-4 bg-clay-400 rounded-full inline-block"></span>
            Family calendar
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">Shared planning schedule. Coordinate flights, medical appointments, milestones, and school schedules seamlessly.</p>
        </div>

        <div className="flex items-center gap-2 ml-auto sm:ml-0 flex-wrap">
          {canWrite && (
            <>
              <input
                ref={scanFileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleScanNotice(f); }}
              />
              <button
                onClick={() => scanFileRef.current?.click()}
                disabled={isScanningNotice || !aiOn}
                className="btn-quiet text-sm disabled:opacity-50"
                title="Photograph a school notice, flyer, or an old reminder/appointment card — AI extracts every date automatically"
              >
                {isScanningNotice ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                <span>{isScanningNotice ? 'Reading…' : 'Scan notice'}</span>
              </button>
              <button
                onClick={handleOpenAddForm}
                className="btn-primary text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Add event</span>
              </button>
            </>
          )}
        </div>
      </section>

      {/* Scan error */}
      {noticeError && (
        <div className="p-4 rounded-2xl bg-rosa-50 border border-rosa-100 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rosa-600 mt-0.5 shrink-0" />
          <p className="text-[13px] text-rosa-700 flex-1">{noticeError}</p>
          <button onClick={() => setNoticeError(null)} className="text-rosa-400 hover:text-rosa-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Scan result preview modal */}
      {noticeResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="anim-fade fixed inset-0 bg-ink-900/60 backdrop-blur-sm" onClick={() => setNoticeResult(null)} />
          <div className="anim-pop relative bg-white border border-cream-300/70 rounded-3xl p-6 shadow-lift w-full max-w-md space-y-4">
            <SheetGrabber onClose={() => setNoticeResult(null)} />
            <div className="flex items-center justify-between pb-3 border-b border-cream-200">
              <h3 className="text-lg font-display font-semibold text-ink-900">Events found</h3>
              <button onClick={() => setNoticeResult(null)} className="p-1 hover:bg-cream-100 rounded-xl text-ink-400"><X className="w-4 h-4" /></button>
            </div>
            {noticeResult.reply && (
              <p className="text-[13px] text-ink-600 leading-relaxed">{noticeResult.reply}</p>
            )}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {noticeResult.events.map((e: any, i: number) => (
                <div key={i} className="p-3 rounded-xl bg-dusk-50 border border-dusk-100 text-[13px]">
                  <p className="font-semibold text-ink-900">{e.title}</p>
                  <p className="text-ink-500 font-mono tabular-nums text-[12px] mt-0.5">{e.date}{e.time ? ` · ${e.time}` : ''}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2 border-t border-cream-200">
              <button onClick={() => setNoticeResult(null)} className="btn-quiet flex-1">Dismiss</button>
              <button onClick={handleApplyNoticeEvents} className="btn-primary flex-1">
                <Check className="w-4 h-4" />
                Add {noticeResult.events.length} event{noticeResult.events.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Calendar Sync Panel */}
      <div className="card rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-sage-100 text-sage-600 border border-sage-200 shrink-0">
            <Cloud className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[13px] font-semibold text-ink-800 flex items-center gap-2">
              Google Calendar sync
              {needsAuth ? (
                <span className="chip bg-cream-200 text-ink-500">Offline</span>
              ) : (
                <span className="chip bg-sage-100 text-sage-700 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sage-500 animate-pulse"></span>
                  Connected
                </span>
              )}
            </h4>
            <p className="text-[13px] text-ink-400 mt-0.5">
              {needsAuth
                ? "Link your Google account to bring in appointments you already had scheduled there — even from before you started using Family Hub — and keep new ones in sync."
                : `Active connection with ${user?.email || 'Google account'}.`
              }
            </p>

            {/* Opt-in outbound sync toggle. Deliberately only shown once
                connected (no token, nothing to push to) and only to
                canWrite members (matches the edit/delete/manual-push
                controls elsewhere in this component — this is a setting
                that changes what happens to EVERY new event the whole
                family adds, not a personal preference). Off by default:
                HubSettings.autoSyncEventsToGoogle is undefined until
                someone deliberately flips this, so nothing is ever pushed
                to a family's Google account without them asking for it. */}
            {!needsAuth && canWrite && (
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSyncEnabled}
                  onClick={() => onToggleAutoSync(!autoSyncEnabled)}
                  className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${autoSyncEnabled ? 'bg-clay-500' : 'bg-cream-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-soft transition-transform ${autoSyncEnabled ? 'translate-x-4' : ''}`} />
                </button>
                <span className="text-[12px] font-semibold text-ink-600">
                  Automatically send new events to Google Calendar
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {calendarSyncError && (
            <span className="text-[12px] text-rosa-700 font-medium mr-2 max-w-[200px] truncate leading-tight">
              ⚠️ {calendarSyncError}
            </span>
          )}

          {needsAuth ? (
            <button
              onClick={handleLoginGoogle}
              disabled={isLoggingIn}
              className="btn-primary w-full sm:w-auto"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authorizing...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Connect Google Calendar</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              <button
                onClick={handleImportFromGoogle}
                disabled={isGoogleCalendarSyncing}
                className="btn-quiet flex-1 sm:flex-none disabled:opacity-50"
                title="Pulls in appointments from the past year plus everything upcoming, including ones scheduled before you started using Family Hub"
              >
                {isGoogleCalendarSyncing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-ink-400" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>Import schedule</span>
              </button>

              <button
                onClick={handleExportAllToGoogle}
                disabled={isGoogleCalendarSyncing}
                className="btn-primary flex-1 sm:flex-none disabled:opacity-50"
              >
                {isGoogleCalendarSyncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>Export all events</span>
              </button>
            </div>
          )}
        </div>

        {/* Any other calendar — Apple, Outlook, Proton, anything.
            Google is the only calendar Teluva talks to over an API. Every other
            one is reached two ways: a SUBSCRIPTION (a link that keeps itself up
            to date) or a one-off FILE. The subscription is the one people
            actually want, so it comes first. */}
        <div className="mt-4 pt-4 border-t border-cream-200 space-y-3">
          <div>
            <p className="text-[13px] font-semibold text-ink-800">On a different calendar?</p>
            <p className="text-[12px] text-ink-500 leading-snug mt-0.5">
              Apple, Outlook, Proton and the rest all give you a private link to your calendar.
              Paste it here once and Teluva keeps itself up to date from it — appointments that move,
              move; ones that get cancelled disappear.
            </p>
          </div>

          {/* Subscriptions */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="url"
                value={feedUrlInput}
                onChange={(e) => setFeedUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddFeed(); } }}
                placeholder="Paste your calendar’s private link"
                className="field flex-1 text-[13px]"
                disabled={!canWrite}
              />
              <button
                type="button"
                onClick={handleAddFeed}
                disabled={feedBusy !== null || !feedUrlInput.trim() || !canWrite}
                className="btn-primary shrink-0 disabled:opacity-40"
              >
                {feedBusy === 'adding' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                <span>Subscribe</span>
              </button>
            </div>

            <details className="text-[12px] text-ink-500">
              <summary className="cursor-pointer font-semibold text-ink-600">Where do I find that link?</summary>
              <ul className="mt-1.5 space-y-1 pl-4 list-disc leading-snug">
                <li><b>Apple / iCloud</b> — calendar.icloud.com, click the ⁠share icon next to the calendar, tick Public Calendar, copy the link.</li>
                <li><b>Outlook</b> — Settings → Calendar → Shared calendars → Publish a calendar → pick ICS.</li>
                <li><b>Google</b> — calendar settings → Integrate calendar → <i>Secret address in iCal format</i>.</li>
              </ul>
              <p className="mt-1.5 leading-snug">
                Anyone with that link can read that calendar, so treat it like a password and use the
                private/secret one rather than making a calendar public where you can choose.
              </p>
            </details>

            {calendarFeeds.length > 0 && (
              <ul className="space-y-1.5">
                {calendarFeeds.map((f) => (
                  <li key={f.id} className="flex items-start gap-2 rounded-xl border border-cream-300 bg-cream-50 px-3 py-2">
                    <RefreshCcw className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${feedBusy === f.id ? 'animate-spin text-clay-500' : 'text-ink-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-ink-800 truncate">{f.label}</p>
                      <p className="text-[11px] text-ink-400">
                        {f.lastError
                          ? <span className="text-rosa-700">{f.lastError}</span>
                          : f.lastSyncedAt
                            ? `${f.eventCount ?? 0} events · updated ${new Date(f.lastSyncedAt).toLocaleString()}`
                            : 'Not synced yet'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRefreshFeed(f)}
                      disabled={feedBusy !== null || !canWrite}
                      className="text-[11px] font-semibold text-clay-600 hover:text-clay-800 shrink-0 cursor-pointer disabled:opacity-40"
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveFeed(f)}
                      disabled={feedBusy !== null || !canWrite}
                      className="text-[11px] font-semibold text-ink-400 hover:text-rosa-700 shrink-0 cursor-pointer disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[12px] text-ink-500 leading-snug pt-1 border-t border-cream-200">
            Or bring in a one-off <code className="text-[11px]">.ics</code> file — a copy taken at that
            moment rather than a live link.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={icsInputRef}
              type="file"
              accept=".ics,text/calendar"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Reset first: picking the SAME file twice fires no change
                // event otherwise, which reads as "the button is broken".
                e.target.value = '';
                if (f) handleImportIcsFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => icsInputRef.current?.click()}
              disabled={isImportingIcs || !canWrite}
              className="btn-quiet flex-1 sm:flex-none disabled:opacity-50"
            >
              {isImportingIcs ? <Loader2 className="w-4 h-4 animate-spin text-ink-400" /> : <Download className="w-4 h-4" />}
              <span>Import a calendar file</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadIcs}
              disabled={events.length === 0}
              className="btn-quiet flex-1 sm:flex-none disabled:opacity-50"
              title="Save these events as a .ics file you can open in Apple Calendar, Outlook or anything else"
            >
              <Send className="w-4 h-4" />
              <span>Save as calendar file</span>
            </button>
          </div>

          {/* The other direction: Teluva's own events, published as a feed the
              family's normal calendar app subscribes to. */}
          <div className="pt-3 border-t border-cream-200 space-y-2">
            <p className="text-[13px] font-semibold text-ink-800">Show Teluva in your own calendar</p>
            <p className="text-[12px] text-ink-500 leading-snug">
              Create a link, paste it into Apple Calendar, Outlook or Google as a subscribed calendar,
              and these events appear alongside everything else — updating by themselves about once an hour.
            </p>

            {publishedLinks !== null && publishedLinks.length === 0 && (
              <>
                <div className="flex gap-2 flex-wrap items-center">
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-600 cursor-pointer">
                    <input
                      type="radio"
                      name="publish-mode"
                      checked={publishMode === 'details'}
                      onChange={() => setPublishMode('details')}
                    />
                    <span>Full details</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-600 cursor-pointer">
                    <input
                      type="radio"
                      name="publish-mode"
                      checked={publishMode === 'busy'}
                      onChange={() => setPublishMode('busy')}
                    />
                    <span>Busy only — no titles</span>
                  </label>
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={publishBusy !== null || !canWrite}
                    className="btn-primary shrink-0 disabled:opacity-40 ml-auto"
                  >
                    {publishBusy === 'creating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    <span>Create link</span>
                  </button>
                </div>
                <p className="text-[11.5px] text-ink-500 leading-snug bg-cream-100 border border-cream-300 rounded-xl px-3 py-2">
                  <b>Read this before you share it.</b> A calendar app can’t sign in, so the link itself is
                  the password — anyone who has it can see these events without an account. It only ever
                  shows calendar entries, never documents, IDs or medical records, and you can turn it off
                  at any time. Choose <b>Busy only</b> if someone outside the family needs to see when
                  you’re free without seeing why.
                </p>
              </>
            )}

            {publishedLinks && publishedLinks.length > 0 && (
              <ul className="space-y-1.5">
                {publishedLinks.map((l) => (
                  <li key={l.token} className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ink-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-ink-800">
                          {l.mode === 'busy' ? 'Busy only — no titles shared' : 'Full details'}
                        </p>
                        <p className="text-[11px] text-ink-400">
                          {l.lastFetchedAt
                            ? `Last read ${new Date(l.lastFetchedAt).toLocaleString()}`
                            : 'Not read yet — paste it into your calendar app'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyPublishedLink(l)}
                        className="text-[11px] font-semibold text-clay-600 hover:text-clay-800 shrink-0 cursor-pointer"
                      >
                        {copiedToken === l.token ? 'Copied' : 'Copy link'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevokePublish(l)}
                        disabled={publishBusy !== null || !canWrite}
                        className="text-[11px] font-semibold text-ink-400 hover:text-rosa-700 shrink-0 cursor-pointer disabled:opacity-40"
                      >
                        {publishBusy === l.token ? '…' : 'Turn off'}
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-400 break-all font-mono">
                      {window.location.origin}{l.path}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <details className="text-[12px] text-ink-500">
              <summary className="cursor-pointer font-semibold text-ink-600">Where do I paste it?</summary>
              <ul className="mt-1.5 space-y-1 pl-4 list-disc leading-snug">
                <li><b>iPhone / iPad</b> — Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.</li>
                <li><b>Mac</b> — Calendar → File → New Calendar Subscription.</li>
                <li><b>Outlook</b> — Add calendar → Subscribe from web.</li>
                <li><b>Google Calendar</b> — Other calendars → + → From URL.</li>
              </ul>
              <p className="mt-1.5 leading-snug">
                Events you typed into Teluva are the only ones published. Anything Teluva pulled in from
                another calendar stays out, so nothing bounces back and shows up twice.
              </p>
            </details>
          </div>

          {icsNote && (
            <p className="text-[12px] text-ink-600 bg-cream-100 border border-cream-300 rounded-xl px-3 py-2 whitespace-pre-line">
              {icsNote}
            </p>
          )}
        </div>
      </div>

      {/* Main Layout: Calendar Grid (LEFT) + Daily Activities (RIGHT) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* MONTH CALENDAR CONTAINER */}
        <div className="lg:col-span-7 card rounded-2xl p-5 space-y-4">

          {/* Calendar Header with Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-ink-600" />
              <h4 className="text-[13px] font-semibold text-ink-800">
                {monthNames[currentMonth]} <span className="tabular-nums">{currentYear}</span>
              </h4>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={handlePrevMonth}
                className="p-1 px-1.5 hover:bg-cream-100 rounded-xl border border-cream-300 text-ink-500 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1 px-1.5 hover:bg-cream-100 rounded-xl border border-cream-300 text-ink-500 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday Labels */}
          <div className="grid grid-cols-7 gap-1 text-center pb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((wd, i) => {
              // Today's column gets a 2px clay accent underline
              const today = new Date(realTodayStr);
              const isTodayCol = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDay() === i;
              return (
                <span
                  key={wd}
                  className={`text-[11px] font-mono uppercase tracking-wide text-ink-400 pb-1 ${
                    isTodayCol ? 'border-b-2 border-clay-400' : ''
                  }`}
                >
                  {wd}
                </span>
              );
            })}
          </div>

          {/* Day Cells */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cellDate, index) => {
              if (cellDate === null) {
                return <div key={`empty-${index}`} className="aspect-square bg-cream-100/60 rounded-xl" />;
              }

              const dateStr = formatDateString(cellDate);
              const isSelected = selectedDateStr === dateStr;
              // Bug fix #1: compare against real today string, not hardcoded date
              const isCurrentDay = realTodayStr === dateStr;

              const dayEvents = events.filter(e => e.date === dateStr);
              const hasEvents = dayEvents.length > 0;

              return (
                <button
                  // Bug fix #3: key now includes year+month to avoid cross-month collisions
                  key={`day-${cellDate.getFullYear()}-${cellDate.getMonth()}-${cellDate.getDate()}`}
                  onClick={() => handleDaySelect(cellDate)}
                  className={`aspect-square relative rounded-xl transition-all duration-150 flex flex-col items-center justify-center cursor-pointer border text-xs ${
                    isSelected
                      ? 'bg-clay-500 border-clay-500 text-white font-bold shadow-soft scale-105 z-10'
                      : isCurrentDay
                        ? 'bg-clay-50 ring-1 ring-clay-300 border-clay-200 text-ink-900 hover:shadow-sm hover:-translate-y-px'
                        : 'bg-white border-cream-200 text-ink-700 hover:border-cream-300 hover:bg-cream-50 hover:shadow-sm hover:-translate-y-px'
                  }`}
                >
                  {isCurrentDay && !isSelected ? (
                    <span className="w-5 h-5 flex items-center justify-center rounded-full bg-clay-500 text-white text-[11px] font-bold leading-none tabular-nums">
                      {cellDate.getDate()}
                    </span>
                  ) : (
                    <span className="text-xs leading-none tabular-nums">{cellDate.getDate()}</span>
                  )}

                  {/* Event Marker Dots — category pastels */}
                  {hasEvents && (
                    <div className="absolute bottom-1.5 flex space-x-0.5 justify-center">
                      {dayEvents.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          className={`w-1 h-1 rounded-full ${
                            isSelected
                              ? 'bg-white/80'
                              : e.category === 'School' ? 'bg-dusk-500' :
                                e.category === 'Travel' ? 'bg-honey-500' :
                                e.category === 'Appointment' ? 'bg-rosa-500' :
                                e.category === 'Milestone' ? 'bg-sage-500' :
                                'bg-ink-400'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Color Code Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3.5 border-t border-cream-200 text-[12px] text-ink-500 font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-dusk-500 inline-block"></span>
              <span>School</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-honey-500 inline-block"></span>
              <span>Travel</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rosa-500 inline-block"></span>
              <span>Appointment</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sage-500 inline-block"></span>
              <span>Milestone</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-ink-400 inline-block"></span>
              <span>Other</span>
            </div>
          </div>
        </div>

        {/* RIGHT AREA: Day events + Upcoming feed */}
        <div className="lg:col-span-5 space-y-6">

          {/* EVENTS ON SELECTED DAY */}
          <section className="card rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-cream-200">
              <h4 className="text-[13px] font-semibold text-ink-800">
                Agenda: <span className="font-mono tabular-nums">{selectedDateStr}</span>
              </h4>
              <span className="section-label">
                {selectedDayEvents.length} items
              </span>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="text-center py-8 flex flex-col items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                <p className="text-ink-400 text-[13px] italic">
                  No events scheduled. Choose a date and click "Schedule new event" to start.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map(ev => {
                  // Not `ev.memberIds` directly: an event imported from
                  // Google before this app learned to read names out of
                  // titles has no tags at all, and showing it as "All family"
                  // is simply wrong when the title says whose it is.
                  const resolved = resolveEventMembers(ev, members);
                  const assignedMembers = members.filter(m => resolved.memberIds.includes(m.id));
                  const matchedByName = !resolved.explicit;

                  // Tinted-fill event chip: ~15% alpha of the category color, full-strength text, 8px radius
                  const catStyle =
                    ev.category === 'School' ? { bg: 'bg-dusk-500/15', border: 'border-dusk-500/20', text: 'text-dusk-700' } :
                    ev.category === 'Travel' ? { bg: 'bg-honey-500/15', border: 'border-honey-500/20', text: 'text-honey-700' } :
                    ev.category === 'Appointment' ? { bg: 'bg-rosa-500/15', border: 'border-rosa-500/20', text: 'text-rosa-700' } :
                    ev.category === 'Milestone' ? { bg: 'bg-sage-500/15', border: 'border-sage-500/20', text: 'text-sage-700' } :
                    { bg: 'bg-ink-400/15', border: 'border-ink-400/20', text: 'text-ink-700' };

                  return (
                    <div
                      key={ev.id}
                      className={`m-px p-4 rounded-lg border flex flex-col gap-2.5 transition-all text-xs ${catStyle.bg} ${catStyle.border}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <h5 className={`font-semibold leading-snug text-[13px] ${catStyle.text}`}>{ev.title}</h5>
                          {ev.time && (
                            <p className="flex items-center gap-1 text-[12px] font-semibold text-ink-500 font-mono tabular-nums">
                              <Clock className="w-3 h-3" />
                              {ev.time}
                            </p>
                          )}
                        </div>

                        {/* Category chip — tinted-fill, 8px radius, full-strength text */}
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg px-2.5 py-0.5 leading-tight shrink-0 ${catStyle.bg} ${catStyle.text}`}>
                          {ev.category}
                        </span>
                      </div>

                      {ev.description && (
                        <p className="text-[12px] text-ink-600 leading-snug italic">
                          &ldquo;{ev.description}&rdquo;
                        </p>
                      )}

                      {/* Tagged members + actions */}
                      <div className="flex items-center justify-between pt-2 border-t border-cream-300/50">
                        <div className="flex items-center space-x-1.5">
                          <Users className="w-3 h-3 text-ink-400 mr-0.5" />
                          {assignedMembers.length === 0 ? (
                            <span className="text-[12px] text-ink-400">All family</span>
                          ) : (
                            <div className="flex -space-x-1">
                              {assignedMembers.map(m => (
                                m.avatarUrl ? (
                                  <span
                                    key={m.id}
                                    className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center border-2 border-white shrink-0"
                                    title={m.name}
                                  >
                                    <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                                  </span>
                                ) : (
                                  <span
                                    key={m.id}
                                    className={`w-5 h-5 rounded-full ${m.avatarColor} text-[10px] font-bold text-white flex items-center justify-center border-2 border-white shrink-0`}
                                    title={m.name}
                                  >
                                    {m.name.charAt(0)}
                                  </span>
                                )
                              ))}
                            </div>
                          )}
                          {matchedByName && (
                            // Shown, not hidden: this person was read out of
                            // the event's title because nobody tagged it. If
                            // the guess is wrong, Edit assigns it properly and
                            // the explicit tag wins from then on.
                            <span className="text-[11px] text-ink-400 italic" title="Nobody was tagged on this event, so the name in its title was used.">
                              by name
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5 shrink-0">
                          {ev.remindMe && (
                            <span className="chip bg-ink-900 text-white">
                              <Bell className="w-2.5 h-2.5" />
                              Alert on
                            </span>
                          )}
                          {/* Hidden (not just disabled) for anything not eligible — a
                              "gcal-" event Teluva imported FROM Google, or an event
                              already pushed out — so there's no button on screen that
                              would create a duplicate if tapped. See
                              isEligibleForGooglePush in utils/googleCalendarSync.ts. */}
                          {!needsAuth && canWrite && isEligibleForGooglePush(ev) && (
                            <button
                              onClick={() => pushEventToGoogle(ev)}
                              className="p-1 hover:bg-cream-100 rounded-lg text-sage-600 transition-colors"
                              title="Sync to Google Calendar"
                            >
                              <Cloud className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canWrite && (
                            <button
                              onClick={() => handleOpenEditForm(ev)}
                              className="p-1 hover:bg-cream-100 rounded-lg text-ink-500 transition-colors"
                              title="Edit event"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          )}
                          {canWrite && (
                            <button
                              onClick={() => handleDeleteEvent(ev.id)}
                              className="p-1 hover:bg-rosa-50 rounded-lg text-rosa-600 transition-colors"
                              title="Delete event"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* UPCOMING REMINDERS SIDEBAR */}
          <section className="card rounded-2xl p-5 space-y-4">
            <h4 className="text-[13px] font-semibold text-ink-800 flex items-center gap-2 pb-2 border-b border-cream-200">
              <Bell className="w-4 h-4 text-ink-400" />
              Upcoming shared reminders
            </h4>

            {upcomingReminders.length === 0 ? (
              <div className="text-center py-6 flex flex-col items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
                  <Bell className="w-5 h-5" />
                </div>
                <p className="text-ink-400 text-[13px] italic">
                  No reminders in the next 12 days.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 text-xs leading-normal max-h-56 overflow-y-auto pr-1">
                {upcomingReminders.slice(0, 5).map(rem => (
                  <div key={rem.id} className="flex gap-2.5 items-start bg-cream-100 border border-cream-200 p-2.5 rounded-xl hover:bg-cream-200/50 transition-colors">
                    <Info className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink-800 truncate pr-0.5 text-[13px]">{rem.title}</p>
                      <p className="font-mono tabular-nums text-[11px] text-ink-400 mt-0.5">{rem.date} {rem.time ? `• ${rem.time}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>

      {/* ADD / EDIT EVENT MODAL */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="anim-fade fixed inset-0 bg-ink-900/60 backdrop-blur-sm" onClick={() => setIsFormOpen(false)} />

          <div className="anim-pop relative bg-white border border-cream-300/70 rounded-3xl p-6 shadow-lift w-full max-w-md space-y-4">
            <SheetGrabber onClose={() => setIsFormOpen(false)} />
            <div className="flex items-center justify-between pb-3 border-b border-cream-200">
              <h3 className="text-lg font-display font-semibold text-ink-900">
                {editingEventId ? 'Edit event' : 'New event'}
              </h3>
              <button onClick={() => setIsFormOpen(false)} className="p-1 hover:bg-cream-100 rounded-xl text-ink-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCommitEvent} className="space-y-4">
              <div>
                <label className="field-label">Event title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Leo's dental clinic visit"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="field"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Date</label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="field font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="field-label">Time</label>
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="field font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="field"
                  >
                    <option value="School">School / Homework</option>
                    <option value="Appointment">Medical appointment</option>
                    <option value="Travel">Family travel / Flights</option>
                    <option value="Milestone">Family milestone</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex items-center space-x-2 pt-7">
                  <input
                    type="checkbox"
                    id="remindBox"
                    checked={remindMe}
                    onChange={(e) => setRemindMe(e.target.checked)}
                    className="w-4 h-4 border-cream-300 text-clay-500 bg-white rounded focus:ring-clay-300 accent-clay-500"
                  />
                  <label htmlFor="remindBox" className="text-[13px] font-semibold text-ink-700 select-none cursor-pointer">
                    Enable reminders
                  </label>
                </div>
              </div>

              <div>
                <label className="field-label">Tag family members</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {members.map(m => {
                    const isTagged = taggedMemberIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleToggleMemberTag(m.id)}
                        className={`px-3 py-1.5 text-[12px] font-semibold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
                          isTagged
                            ? 'bg-clay-500 text-white border-clay-500 shadow-soft'
                            : 'bg-white text-ink-600 border-cream-300 hover:bg-cream-100'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${m.avatarColor}`}></span>
                        <span>{m.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="field-label">Description</label>
                <textarea
                  rows={2}
                  placeholder="Details for flights, doctor addresses or specific preparations..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="field"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-cream-200">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                >
                  {editingEventId ? 'Save edits' : 'Schedule event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
