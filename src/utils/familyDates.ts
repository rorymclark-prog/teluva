// Five more Family Calendar divisions, alongside calendarDocumentExpiries.ts's
// travel-document watch: birthdays, name days & celebrations, medical
// checks, anniversaries & special days, and school dates. Same discipline as
// that file — birthdays/name-celebrations/medical checks read straight off
// the member record (birthdate, resolveCelebrations' merged view,
// careSchedule, referrals); anniversaries read the family's own
// AnniversariesDoc; school dates read the shared CalendarEvent list. None of
// them go through a second, generated copy of the date — editing a
// birthdate, confirming a celebration, updating a care schedule item, adding
// an anniversary, or tagging an event School updates the calendar
// immediately with no second write path to keep in sync.
import type { AnniversaryKind, AnniversaryRecord, CalendarEvent, FamilyMember, NameCelebration } from '../types';
import { daysUntilNameDay, formatNameDay } from './nameDay';
import { resolveCelebrations, daysUntilCelebration } from './nameCelebrations';
import { careNextDue, careDueLabel, CareStatus } from './care';
import { parseDateOnly } from './age';

const DAY_MS = 24 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Same "coming up" window NeedsAttention.tsx's own birthday nudge uses
// (`days > 0 && days <= 21`) — kept as an independent constant rather than an
// import because NeedsAttention doesn't export it, but intentionally the same
// number so the calendar and the nudge digest never disagree about what
// "soon" means for the same birthday. Reused for name celebrations too, so
// every personal-occasion division on this screen shares one "coming up"
// window rather than each inventing its own.
export const OCCASION_WATCH_DAYS = 21;

// ---------------------------------------------------------------------------
// Birthdays
// ---------------------------------------------------------------------------

export interface CalendarBirthday {
  id: string;
  memberId: string;
  memberName: string;
  avatarUrl?: string;
  avatarColor: string;
  /** 'MM-DD' */
  monthDay: string;
  /** Next occurrence, YYYY-MM-DD — derived as today+daysUntil (see buildGiftOccasions' identical comment for why: it can never then disagree with daysUntil). */
  date: string;
  daysUntil: number;
  /** The age they turn ON that occurrence, not their current age. */
  turningAge: number;
}

function monthDayFromBirthdate(birthdate?: string): string | null {
  const d = parseDateOnly(birthdate);
  return d ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : null;
}

export function buildCalendarBirthdays(
  members: readonly FamilyMember[],
  now: Date = new Date(),
): CalendarBirthday[] {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: CalendarBirthday[] = [];

  for (const member of members) {
    const monthDay = monthDayFromBirthdate(member.birthdate);
    if (!monthDay) continue;
    // Reuses nameDay.ts's own next-occurrence math (Feb-29 collapse and
    // year-wrap included) rather than a second copy of that arithmetic.
    const daysUntil = daysUntilNameDay(monthDay, now);
    if (daysUntil == null) continue;

    const occurrence = new Date(t0.getTime() + daysUntil * DAY_MS);
    const birthYear = parseDateOnly(member.birthdate)!.getFullYear();

    out.push({
      id: `birthday-${member.id}`,
      memberId: member.id,
      memberName: member.name,
      avatarUrl: member.avatarUrl,
      avatarColor: member.avatarColor,
      monthDay,
      date: isoFromDate(occurrence),
      daysUntil,
      turningAge: occurrence.getFullYear() - birthYear,
    });
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil || firstName(a.memberName).localeCompare(firstName(b.memberName)));
}

// ---------------------------------------------------------------------------
// Name days & celebrations
// ---------------------------------------------------------------------------

export interface CalendarNameCelebration {
  id: string;
  memberId: string;
  memberName: string;
  avatarUrl?: string;
  avatarColor: string;
  celebration: NameCelebration;
  /** False for an opted-in additional celebration alongside the primary one. */
  isPrimary: boolean;
  /** YYYY-MM-DD of the next KNOWN occurrence, or null when a movable
   *  celebration has no resolution cached at all. */
  date: string | null;
  daysUntil: number | null;
  /** True when the CURRENT year's movable occurrence needs (re-)resolving.
   *  date/daysUntil may still be set alongside it — a cached next-year date
   *  is a real occurrence — never a guessed one, per nameCelebrations.ts. */
  needsResolution: boolean;
}

/**
 * Every CONFIRMED name day / name celebration on the family, primary and
 * additional both — this is a read-only calendar view, not the notification
 * digest, so an opted-in "additional" celebration (notify: false) is still
 * worth showing here even though it never pings anyone.
 *
 * Never reads nameCelebrations.all — only resolveCelebrations' primary/
 * additional, i.e. confirmed entries. An unconfirmed proposal belongs on the
 * member's own profile where it can be confirmed or declined, not on a
 * calendar the whole family reads.
 */
export function buildCalendarNameCelebrations(
  members: readonly FamilyMember[],
  now: Date = new Date(),
): CalendarNameCelebration[] {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: CalendarNameCelebration[] = [];

  for (const member of members) {
    const { primary, additional } = resolveCelebrations(member);
    const entries: { celebration: NameCelebration; isPrimary: boolean }[] = [];
    if (primary) entries.push({ celebration: primary, isPrimary: true });
    for (const c of additional) entries.push({ celebration: c, isPrimary: false });

    for (const { celebration, isPrimary } of entries) {
      const countdown = daysUntilCelebration(celebration, now);
      const date = countdown.days == null ? null : isoFromDate(new Date(t0.getTime() + countdown.days * DAY_MS));

      out.push({
        id: `${member.id}-${celebration.id}`,
        memberId: member.id,
        memberName: member.name,
        avatarUrl: member.avatarUrl,
        avatarColor: member.avatarColor,
        celebration,
        isPrimary,
        date,
        daysUntil: countdown.days,
        needsResolution: countdown.needsResolution,
      });
    }
  }

  return out.sort((a, b) => {
    // A movable celebration with nothing resolved has no date to sort BY —
    // it collects at the end rather than being pinned to a sentinel days
    // value, which would silently claim a false position in the ordering.
    if (a.daysUntil == null && b.daysUntil == null) return firstName(a.memberName).localeCompare(firstName(b.memberName));
    if (a.daysUntil == null) return 1;
    if (b.daysUntil == null) return -1;
    return a.daysUntil - b.daysUntil || firstName(a.memberName).localeCompare(firstName(b.memberName));
  });
}

// ---------------------------------------------------------------------------
// Medical checks
// ---------------------------------------------------------------------------
//
// Two genuinely-DATED sources exist on a member record today:
//   - careSchedule[] — recurring checks (dental, medical check-up, eye test,
//     vaccination/booster, specialist review, skin check) with an explicit
//     nextDue, or a lastVisit + intervalMonths to derive one from. careNextDue
//     (utils/care.ts) is reused as-is rather than reimplemented here, so this
//     screen can never disagree with the Medical tab's own "next due" chip.
//   - referrals[] once status is 'booked' — appointmentDate is a real,
//     family-set future date, not a guess.
//
// medical.vaccinations[] is deliberately NOT a source of upcoming dates: a
// Vaccination record carries a `date` (when it was GIVEN) and has no
// interval/next-due field of its own. "Flu shot due every year" only becomes
// a derivable date once the family also has a careSchedule entry for it
// (kind 'Vaccination / booster') — see the handoff notes for this gap.
export type MedicalCheckStatus = CareStatus;

export interface CalendarMedicalCheck {
  id: string;
  memberId: string;
  memberName: string;
  avatarUrl?: string;
  avatarColor: string;
  source: 'care' | 'referral';
  label: string;
  provider?: string;
  /** YYYY-MM-DD, or null when a care item has neither nextDue nor lastVisit+interval to derive one from. */
  date: string | null;
  status: MedicalCheckStatus;
  statusLabel: string;
}

// Matches careNextDue's own "due-soon" window (1.5 months, see care.ts) so a
// booked referral appointment and a recurring check-up are flagged "coming
// up soon" on the same footing rather than two different thresholds.
const REFERRAL_DUE_SOON_DAYS = 45;

export function buildCalendarMedicalChecks(
  members: readonly FamilyMember[],
  now: Date = new Date(),
): CalendarMedicalCheck[] {
  const nowMs = now.getTime();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: CalendarMedicalCheck[] = [];

  for (const member of members) {
    for (const item of member.careSchedule || []) {
      const due = careNextDue(item, nowMs);
      out.push({
        id: `care-${item.id}`,
        memberId: member.id,
        memberName: member.name,
        avatarUrl: member.avatarUrl,
        avatarColor: member.avatarColor,
        source: 'care',
        label: item.kind,
        provider: item.provider,
        date: due.date ? isoFromDate(due.date) : null,
        status: due.status,
        statusLabel: careDueLabel(due),
      });
    }

    for (const r of member.referrals || []) {
      if (r.status !== 'booked' || !r.appointmentDate) continue;
      const appt = parseDateOnly(r.appointmentDate);
      if (!appt) continue;
      const daysUntil = Math.round((appt.getTime() - t0.getTime()) / DAY_MS);
      const status: MedicalCheckStatus =
        daysUntil < 0 ? 'overdue' : daysUntil <= REFERRAL_DUE_SOON_DAYS ? 'due-soon' : 'ok';
      const statusLabel =
        status === 'overdue' ? 'Overdue'
        : daysUntil === 0 ? 'Today'
        : daysUntil === 1 ? 'Tomorrow'
        : `In ${daysUntil} days`;

      out.push({
        id: `referral-${r.id}`,
        memberId: member.id,
        memberName: member.name,
        avatarUrl: member.avatarUrl,
        avatarColor: member.avatarColor,
        source: 'referral',
        label: r.reason || r.kind,
        provider: r.providerName,
        date: r.appointmentDate,
        status,
        statusLabel,
      });
    }
  }

  // Dated items first — soonest/most-overdue first, since an old overdue
  // date sorts before a near-future one — undated ('unknown') items last.
  return out.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || firstName(a.memberName).localeCompare(firstName(b.memberName));
    if (a.date) return -1;
    if (b.date) return 1;
    return firstName(a.memberName).localeCompare(firstName(b.memberName));
  });
}

// ---------------------------------------------------------------------------
// Anniversaries & special days
// ---------------------------------------------------------------------------

export interface CalendarAnniversary {
  id: string;
  title: string;
  kind: AnniversaryKind;
  memberIds?: string[];
  /** 'MM-DD' */
  monthDay: string;
  /** Next occurrence, YYYY-MM-DD — same today+daysUntil derivation as
   *  CalendarBirthday.date, for the same reason: it can never then disagree
   *  with daysUntil. */
  date: string;
  daysUntil: number;
  /** Years since AnniversaryRecord.originalYear, on THIS occurrence — mirrors
   *  CalendarBirthday.turningAge. Null when the record has no originalYear
   *  (e.g. Valentine's Day isn't counting up from an origin year). */
  years: number | null;
}

/**
 * Every recurring anniversary/special day on the family's own AnniversariesDoc
 * (utils/db.ts: loadAnniversaries), with its next occurrence resolved from the
 * stored 'MM-DD'. Reuses nameDay.ts's next-occurrence math — the exact same
 * function buildCalendarBirthdays uses — rather than a second copy of that
 * Feb-29/year-wrap arithmetic.
 */
export function buildCalendarAnniversaries(
  anniversaries: readonly AnniversaryRecord[],
  now: Date = new Date(),
): CalendarAnniversary[] {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: CalendarAnniversary[] = [];

  for (const a of anniversaries) {
    const daysUntil = daysUntilNameDay(a.date, now);
    if (daysUntil == null) continue;

    const occurrence = new Date(t0.getTime() + daysUntil * DAY_MS);

    out.push({
      id: a.id,
      title: a.title,
      kind: a.kind,
      memberIds: a.memberIds,
      monthDay: a.date,
      date: isoFromDate(occurrence),
      daysUntil,
      years: a.originalYear != null ? occurrence.getFullYear() - a.originalYear : null,
    });
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// School dates
// ---------------------------------------------------------------------------

// Same six-month planning horizon FamilyCalendar's own "upcoming" agenda list
// uses for `upcomingReminders` (see the render function, near the top) — kept
// as an independent constant rather than an import for the same reason
// OCCASION_WATCH_DAYS above is: NeedsAttention-style modules don't export
// their internal constants, and this way the calendar's six-month view and
// this division can never quietly drift apart on what "upcoming" means.
export const SCHOOL_DATES_WINDOW_DAYS = 180;

export interface CalendarSchoolDate {
  id: string;
  title: string;
  /** YYYY-MM-DD, straight off the source CalendarEvent — never recomputed. */
  date: string;
  time?: string;
  daysUntil: number;
  memberIds?: string[];
  description?: string;
}

/**
 * Upcoming School-category events, straight off the shared calendar events
 * list — no new data source, just the same category === 'School' tag a
 * scanned notice or the AI chat already applies (see the "Scan notice" flow
 * in this file and AIChatbot.tsx). Bounded to the same SCHOOL_DATES_WINDOW_DAYS
 * horizon as the calendar's own six-month agenda, so this division can never
 * show something the rest of the screen calls "too far out to plan around".
 */
export function buildCalendarSchoolDates(
  events: readonly CalendarEvent[],
  now: Date = new Date(),
): CalendarSchoolDate[] {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const out: CalendarSchoolDate[] = [];

  for (const e of events) {
    if (e.category !== 'School') continue;
    const evDate = parseDateOnly(e.date);
    if (!evDate) continue;
    const daysUntil = Math.round((evDate.getTime() - t0) / DAY_MS);
    if (daysUntil < 0 || daysUntil > SCHOOL_DATES_WINDOW_DAYS) continue;

    out.push({
      id: e.id,
      title: e.title,
      date: e.date,
      time: e.time,
      daysUntil,
      memberIds: e.memberIds,
      description: e.description,
    });
  }

  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title));
}
