// Ranks calendar events by family relevance for the Agenda and "Upcoming
// shared reminders" lists — pure, no React, so it can be unit-tested
// directly (see eventRelevance.test.ts).
//
// Rory's ask (2026-08-17, live Calendar screenshot): "I want to see
// birthdays and up[]coming renewals of passports and also medical
// appointments... not really my other work stuff." Before this, both lists
// sorted purely by date/time — a Google-imported "Team offsite" and a
// hand-typed "Ganga's dentist" both have category 'Appointment' and would
// interleave by clock time alone, so whichever happened to be timed earliest
// won the top slot regardless of whether it had anything to do with the
// family.
//
// Category alone can't separate them: handleImportFromGoogle in
// FamilyCalendar.tsx hardcodes category:'Appointment' for every event pulled
// from the user's primary Google Calendar, with no inference from the
// event's title/description — so an imported work meeting is
// category-identical to a genuine family appointment. The signal that DOES
// separate them is origin, via the existing 'gcal-' id prefix convention
// (isGoogleOriginEventId, googleCalendarSync.ts): anything imported from
// Google is someone's outside calendar, unfiltered; anything without that
// prefix was typed, dictated, or AI-filed directly into Teluva, which makes
// it family-admin by construction — including a one-off medical/dentist
// visit, which today has nowhere else to live but a plain 'Appointment'
// calendar_event (care_schedule/referral records don't produce calendar
// entries at all yet — a separate, larger gap, not addressed by this sort).
import { CalendarEvent } from '../types';
import { isGoogleOriginEventId } from './googleCalendarSync';

export const RELEVANCE_TIER = {
  /** Birthdays/anniversaries and passport/visa expiry — named explicitly by Rory. */
  MILESTONE_OR_TRAVEL: 0,
  /** Typed, dictated, or AI-filed straight into Teluva — includes one-off medical/dentist visits filed as 'Appointment'. */
  FAMILY_NATIVE: 1,
  /** Pulled in wholesale from a connected Google Calendar, unfiltered. */
  IMPORTED: 2,
} as const;

export function eventRelevanceTier(ev: Pick<CalendarEvent, 'id' | 'category'>): number {
  if (ev.category === 'Milestone' || ev.category === 'Travel') {
    return RELEVANCE_TIER.MILESTONE_OR_TRAVEL;
  }
  if (isGoogleOriginEventId(ev.id)) {
    return RELEVANCE_TIER.IMPORTED;
  }
  return RELEVANCE_TIER.FAMILY_NATIVE;
}

/**
 * Family-relevant events first, then chronological within each tier.
 * `sortKey` picks what breaks ties inside a tier — e.g. `e => e.time || '00:00'`
 * for a single day's agenda, `e => e.date` for a multi-day feed.
 */
export function sortByRelevance<T extends Pick<CalendarEvent, 'id' | 'category'>>(
  events: readonly T[],
  sortKey: (ev: T) => string,
): T[] {
  return [...events].sort((a, b) => {
    const tierDiff = eventRelevanceTier(a) - eventRelevanceTier(b);
    if (tierDiff !== 0) return tierDiff;
    return sortKey(a).localeCompare(sortKey(b));
  });
}
