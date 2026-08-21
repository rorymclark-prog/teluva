import { AnniversaryRecord, CalendarEvent } from '../types';
import { isAnniversaryFlaggedEvent } from './eventKeywordFlags';

// ---------------------------------------------------------------------------
// Anniversaries the calendar already knows about, but the Anniversaries screen
// doesn't.
//
// WHY THIS EXISTS: Rory, looking at a card that read "Nothing saved yet" —
// "the calendar already notes maria and my anniversary yet this didnt update".
//
// He was right, and it is the same shape as the birthday split-brain: ONE fact
// with TWO stores. A wedding anniversary can live as a calendar event (typed
// there, or synced in from Google) or as an AnniversaryRecord. FamilyCalendar
// merges both — familyDates.ts's buildCalendarAnniversaries takes the saved
// records AND the flagged events. AnniversariesView read only the saved
// records, so the screen whose entire job is "yearly dates, so you don't have
// to hunt for them in the calendar" was the one place in the app that could
// not see the date sitting in the calendar.
//
// WHAT THIS IS NOT: an importer. A calendar event carries a single dated
// occurrence and no promise that it repeats; an AnniversaryRecord is a
// recurring MM-DD, and inventing that recurrence on the family's behalf would
// put a date on next year's calendar that nobody chose. So these are
// SUGGESTIONS — surfaced, one tap away from being kept, and saved only when
// someone confirms the form. Same contract as the quick-add chips beside them.
// ---------------------------------------------------------------------------

export interface AnniversarySuggestion {
  /** The source event's id, so a suggestion can be dismissed or traced back. */
  eventId: string;
  title: string;
  /** 'MM-DD' — what an AnniversaryRecord stores. */
  monthDay: string;
  /** The event's own full date, kept for display ("in your calendar on …"). */
  eventDate: string;
  daysUntil: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' → a local Date at midnight, or null. */
function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Anniversary-shaped calendar events that are not already filed as records.
 *
 * Deduped on MONTH-DAY alone, deliberately not on the title. The calendar
 * event is very often worded differently from the record the family later
 * saved — "Rory & Maria" in Google, "Wedding Anniversary" here — and matching
 * on title would keep suggesting a date they have already kept. Two genuinely
 * different special days sharing one calendar day is much rarer than one day
 * worded two ways, so month-day is the safer key.
 *
 * Past events are dropped rather than kept: a suggestion the family can act on
 * is useful, and last February's Valentine's entry is not.
 */
export function anniversarySuggestions(
  events: readonly CalendarEvent[],
  saved: readonly AnniversaryRecord[],
  now: Date = new Date(),
  limit = 6,
): AnniversarySuggestion[] {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const takenMonthDays = new Set(saved.map((a) => a.date));

  const out: AnniversarySuggestion[] = [];
  const seen = new Set<string>();

  for (const ev of events) {
    if (!isAnniversaryFlaggedEvent(ev)) continue;
    const d = parseIso(ev.date);
    if (!d) continue;

    const daysUntil = Math.round((d.getTime() - t0.getTime()) / DAY_MS);
    if (daysUntil < 0) continue;

    const monthDay = ev.date.slice(5);
    if (takenMonthDays.has(monthDay)) continue;
    // A recurring calendar entry arrives as many separate events, one per
    // year. Without this, the same anniversary is offered three times.
    if (seen.has(monthDay)) continue;
    seen.add(monthDay);

    out.push({
      eventId: ev.id,
      title: (ev.title || '').trim() || 'Anniversary',
      monthDay,
      eventDate: ev.date,
      daysUntil,
    });
  }

  out.sort((a, b) => (a.daysUntil !== b.daysUntil ? a.daysUntil - b.daysUntil : a.title.localeCompare(b.title)));
  return out.slice(0, limit);
}
