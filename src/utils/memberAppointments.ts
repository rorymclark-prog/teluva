import { CalendarEvent, FamilyMember } from '../types';
import { eventBelongsToMember } from './eventMemberMatch';

// Which calendar events belong on a person's health screens.
//
// WHY THIS ISN'T A NEW FIELD ON MedicalRecord
// --------------------------------------------
// The complaint this exists to fix: "I added an appointment with Dr Steiner
// through the chat, and I can't find it in check-ups, and I can't find it
// under medical." It was never lost — it was in the calendar, correctly, with
// the right date, time and person attached. There was simply nowhere on the
// member's own screens that looked at the calendar.
//
// The obvious fix is to add `appointments?: Appointment[]` to MedicalRecord
// and have the assistant write to both. That is the wrong fix, and it is the
// wrong fix in a way this codebase has already been bitten by: two stores
// holding the same fact drift apart the moment one write path forgets the
// other. Editing the date in the calendar would leave a stale copy under
// Medical, deleting it in one place would leave an orphan in the other, and
// every new write path (chat, scan-a-notice, Google import) would have to
// remember both forever.
//
// So the calendar event stays the single record of an appointment, and these
// helpers let a member's screens READ it. One fact, one owner, shown wherever
// it is useful.

/**
 * Appointments for one person, soonest first.
 *
 * Deliberately narrowed to category 'Appointment': it is what the assistant
 * files a doctor's visit as (see the calendar_event rules in server.js) and
 * what the Add-event form defaults to for one. A member-tagged School play or
 * Travel date is a real event but is not what someone opens the Medical tab
 * looking for, and sweeping them in would make this list noise.
 *
 * `todayIso` is passed in rather than read from the clock so this is testable
 * and so a caller rendering several members uses one consistent "today".
 *
 * `members` is needed because "whose appointment is this?" is not simply
 * `memberIds.includes(id)`. Anything imported from Google Calendar arrives
 * untagged — Google does not know who lives here — so a real appointment
 * titled "Ganga – Orthodontist" was reaching the calendar and appearing on
 * nobody's profile. See utils/eventMemberMatch.ts.
 */
export function memberAppointments(
  events: readonly CalendarEvent[],
  memberId: string,
  todayIso: string,
  members: readonly Pick<FamilyMember, 'id' | 'name'>[] = [],
): { upcoming: CalendarEvent[]; past: CalendarEvent[] } {
  const mine = events.filter(
    (ev) => ev.category === 'Appointment' && eventBelongsToMember(ev, memberId, members),
  );

  // String comparison is correct and cheap for YYYY-MM-DD, and — unlike
  // new Date(ev.date) — has no timezone in it to shift an appointment across
  // midnight. Today counts as upcoming: an appointment at 15:30 is still
  // ahead of you at breakfast.
  const upcoming = mine
    .filter((ev) => ev.date >= todayIso)
    .sort((a, b) => (a.date === b.date
      ? (a.time || '00:00').localeCompare(b.time || '00:00')
      : a.date.localeCompare(b.date)));

  const past = mine
    .filter((ev) => ev.date < todayIso)
    .sort((a, b) => (a.date === b.date
      ? (b.time || '00:00').localeCompare(a.time || '00:00')
      : b.date.localeCompare(a.date)));

  return { upcoming, past };
}

/** Local calendar day as YYYY-MM-DD — never UTC, which is a day out for half the world each evening. */
export function todayIsoLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "in 3 days" / "tomorrow" / "today" / "2 weeks ago" — relative to todayIso, both dates being YYYY-MM-DD. */
export function relativeDayLabel(dateIso: string, todayIso: string): string {
  // Parse as UTC midnight on both sides: the difference between two dates
  // handled identically is exact, and no local DST transition can make a day
  // 23 or 25 hours long in the middle of the subtraction.
  const a = Date.parse(`${dateIso}T00:00:00Z`);
  const b = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return '';
  const days = Math.round((a - b) / 86400000);

  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) {
    if (days < 7) return `in ${days} days`;
    if (days < 14) return 'next week';
    if (days < 60) return `in ${Math.round(days / 7)} weeks`;
    return `in ${Math.round(days / 30)} months`;
  }
  const ago = -days;
  if (ago < 7) return `${ago} days ago`;
  if (ago < 14) return 'last week';
  if (ago < 60) return `${Math.round(ago / 7)} weeks ago`;
  return `${Math.round(ago / 30)} months ago`;
}
