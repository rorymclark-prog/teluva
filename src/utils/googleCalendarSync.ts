import { CalendarEvent } from '../types';

// Outbound Google Calendar sync — the "Teluva event -> Google Calendar" half
// of the integration. The inbound half (Google -> Teluva) lives entirely in
// FamilyCalendar.tsx's handleImportFromGoogle and is untouched by this file.
//
// THE LOOP RISK, AND HOW THIS FILE STOPS IT
// -------------------------------------------
// Every event Teluva has ever imported FROM Google is stored with an id of
// the exact shape "gcal-" + the Google event id (see handleImportFromGoogle).
// That prefix is the ONLY signal we have — and it is a reliable one, because
// nothing else in this codebase mints ids with it — that an event's true
// home is Google, not Teluva. If this file ever pushed a "gcal-*" event back
// out to Google, two bad things happen: (1) a visible duplicate appears on
// the user's Google Calendar next to the original, and (2) if a future
// import run somehow failed to recognise it as already synced, that
// duplicate could get pulled back into Teluva too, and the pair would
// silently multiply on every import/export cycle. isGoogleOriginEventId()
// is the single choke point every push path in this file (and in
// FamilyCalendar.tsx) must check before calling the Google API — refuse
// first, POST second, never the other way round.
//
// The other half of loop safety — never pushing the SAME Teluva-native event
// twice — is enforced by the caller, not here: CalendarEvent.googleSynced
// (set true once a push succeeds, and persisted to Firestore, so it survives
// a reload — never re-derived from in-memory state that a remount could
// lose).
//
// NEVER BULK-PUSHING HISTORY, AND WHY THIS ISN'T A REACT REF
// -------------------------------------------------------------
// The automatic sync path (Dashboard.tsx — see the comment there for why it
// lives in Dashboard and not FamilyCalendar) additionally needs "don't push
// anything that already existed before the user opted in." The first
// implementation of this tracked that with a React ref holding the id set
// "seen so far," reset on mount. That was a real bug: FamilyCalendar (and
// originally this logic) only mounts while the user is actually on the
// Calendar screen, so an event created via the AI chat while the user was
// on a different screen was never "seen," and the moment the user next
// opened Calendar, the ref started fresh and folded that pending event
// silently into its new baseline — it was never pushed. A ref cannot survive
// not being mounted, so it cannot be the mechanism that decides "is this
// pre-existing history."
//
// Instead, HubSettings.autoSyncBaselineIds (see types.ts) is a PERSISTED
// snapshot of every event id that existed at the exact moment the sync
// toggle was switched on, captured once by Dashboard.tsx's onToggleAutoSync
// and written to Firestore alongside the toggle itself. isEligibleForAutoSync
// below checks membership in that snapshot the same way regardless of
// whether the app just started, reloaded, or has been open for a week — it
// needs no "was I watching" state at all, which is what makes it correct
// across mounts, reloads, and tab closes.

/** True for any event id that originated on Google and was pulled in by the importer — see the file header for why these must never be pushed back out. */
export const isGoogleOriginEventId = (id: string): boolean => id.startsWith('gcal-');

/**
 * Builds the Google Calendar API v3 event body for a Teluva CalendarEvent.
 * Pulled out of FamilyCalendar.tsx (where two near-identical copies of this
 * used to live, one for the single-event push button and one for the
 * "export all" bulk button) so there is exactly one place that decides what
 * a pushed event looks like on the Google side.
 *
 * The "[Family Hub]" summary prefix is not cosmetic — handleImportFromGoogle
 * greps for it to skip re-importing events this app itself pushed out, which
 * is the other half of the loop guard (the half that protects against a
 * pushed event coming back in, rather than an imported event going back
 * out).
 */
export function buildGoogleCalendarEventBody(ev: CalendarEvent) {
  const startDateTime = ev.time ? `${ev.date}T${ev.time}:00` : `${ev.date}T09:00:00`;
  const [h, m] = (ev.time || '09:00').split(':').map(Number);
  const endH = String((h + 1) % 24).padStart(2, '0');
  const endM = String(m).padStart(2, '0');
  const endDateTime = `${ev.date}T${endH}:${endM}:00`;

  return {
    summary: `[Family Hub] ${ev.title}`,
    description: `${ev.description || ''}\n\nSynced from Family Hub.\nCategory: ${ev.category}`,
    start: {
      dateTime: startDateTime,
      timeZone: 'Europe/Vienna',
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'Europe/Vienna',
    },
  };
}

// Thrown specifically for a 401 so callers can tell "the token expired"
// (this app's OAuth is in Google's testing mode, where grants only last a
// week — see the sign-in flow in utils/firebase.ts) apart from any other
// failure, and react by asking the user to reconnect rather than just
// showing a generic error.
export class GoogleCalendarAuthError extends Error {}

/**
 * Pushes one Teluva-native event out to the connected Google account's
 * primary calendar. Refuses outright — before making any network call — if
 * the event is Google-origin, so a caller that forgets to filter its own
 * list still can't create a duplicate by accident.
 *
 * Deliberately does NOT touch Teluva's own copy of the event (does not set
 * googleSynced, does not call any save function). Callers own the local
 * side effect, because what "successfully synced" should update — one
 * event, several, a toast, a settings baseline — differs by call site.
 */
export async function pushEventToGoogleCalendar(ev: CalendarEvent, token: string): Promise<void> {
  if (isGoogleOriginEventId(ev.id)) {
    throw new Error('This event came from Google Calendar already — sending it back would create a duplicate, so it was skipped.');
  }

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGoogleCalendarEventBody(ev)),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new GoogleCalendarAuthError('Authorization expired. Please re-authenticate.');
    }
    throw new Error(`Google API returned status ${response.status}`);
  }
}

/**
 * True for an event that is a legitimate candidate to be pushed to Google AT
 * ALL: it did not come from Google in the first place, and it has not
 * already been pushed. This is the baseline rule for every push path —
 * manual single-event, manual "export all", and automatic — but on its own
 * it does NOT stop the automatic path from bulk-exporting history, because
 * it has no notion of "existed before opt-in." The manual paths use exactly
 * this function and nothing more, because a human deliberately clicking
 * "export all" and confirming a count IS allowed to reach into history —
 * that's the point of a manual bulk action. See isEligibleForAutoSync for
 * the stricter rule the unattended path uses.
 */
export function isEligibleForGooglePush(ev: CalendarEvent): boolean {
  return !isGoogleOriginEventId(ev.id) && !ev.googleSynced;
}

/**
 * The rule the AUTOMATIC sync path (Dashboard.tsx) uses: eligible for a
 * push at all (see isEligibleForGooglePush), AND not present in the
 * persisted opt-in baseline — i.e. it did not already exist at the moment
 * the user turned auto-sync on. `baselineIds` should be built from
 * HubSettings.autoSyncBaselineIds (the id snapshot captured at that moment);
 * see the file header for why a persisted snapshot is used instead of
 * in-memory "seen this render" state.
 */
export function isEligibleForAutoSync(ev: CalendarEvent, baselineIds: ReadonlySet<string>): boolean {
  return isEligibleForGooglePush(ev) && !baselineIds.has(ev.id);
}
