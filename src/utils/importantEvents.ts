// Which calendar events are "important", and which of them are coming up.
//
// Importance is DERIVED, like the referral rows on the grid: the app works it
// out at read time and only stores the family's own choice about it. That
// keeps it one fact, one writer — a medical appointment is important because
// it is medical, not because an importer once wrote `important: true` on it,
// and it stops being important the moment the family says so.
//
//   important: true   the family marked it (any event, any space)
//   important: false  the family un-marked one the app would have marked
//   absent            the app decides: medical appointments are important
//
// Business spaces get no automatic rule. The rule is "it looks medical", and a
// business space never shows anything medical (not even as a side effect like
// an unexplained star), so there only an event someone marked by hand counts.
//
// The server has a port of isImportantEvent for the published .ics feed
// (server/importantEvents.mjs); importantEventsParity.test.ts pins the two.

import type { CalendarEvent, FamilyMember } from '../types';
import { isMedicalFlaggedEvent } from './eventKeywordFlags';
import { resolveEventMembers } from './eventMemberMatch';
import { buildReferralAppointments } from './referralAppointment';

export interface ImportanceOptions {
  /** A business space: no automatic rule, and nothing medical. */
  business?: boolean;
}

type ImportanceFields = Pick<CalendarEvent, 'title' | 'description' | 'important'>;

/** What the app would decide on its own, before any choice the family made. */
export function isAutoImportant(
  ev: Pick<CalendarEvent, 'title' | 'description'>,
  opts: ImportanceOptions = {},
): boolean {
  if (opts.business) return false;
  return isMedicalFlaggedEvent(ev);
}

/** Is this event important? The family's own choice wins; otherwise the app decides. */
export function isImportantEvent(ev: ImportanceFields, opts: ImportanceOptions = {}): boolean {
  if (typeof ev.important === 'boolean') return ev.important;
  return isAutoImportant(ev, opts);
}

/**
 * The value to store when the family sets the switch to `chosen`: nothing at
 * all when that is what the app would decide anyway, so a later change of
 * title (or of the rule) still applies to it.
 */
export function importantOverride(
  ev: Pick<CalendarEvent, 'title' | 'description'>,
  chosen: boolean,
  opts: ImportanceOptions = {},
): boolean | undefined {
  return chosen === isAutoImportant(ev, opts) ? undefined : chosen;
}

/**
 * `ev` with its importance choice set to `override`, the key removed when
 * there is none. Removing the key (rather than writing undefined) is what the
 * shared-save merge in db.ts sees as "cleared": a key that was there before
 * and is gone now is deleted from the stored event.
 */
export function withImportant<T extends CalendarEvent>(ev: T, override: boolean | undefined): T {
  const { important: _previous, ...rest } = ev;
  return (typeof override === 'boolean' ? { ...rest, important: override } : rest) as T;
}

/**
 * The calendar as the assistant sees it: `important: true` on every event
 * that IS important, whoever decided, and no `important` key on the rest. The
 * model is never asked to re-derive the medical rule, and a stored `false`
 * (an un-marked appointment) reads the same as any ordinary event. For the
 * request only — never saved.
 */
export function calendarForChat<T extends CalendarEvent>(events: readonly T[], opts: ImportanceOptions = {}): T[] {
  return events.map((ev) => withImportant(ev, isImportantEvent(ev, opts) ? true : undefined));
}

// ---------------------------------------------------------------------------
// Important — coming up
// ---------------------------------------------------------------------------

export interface ImportantItem {
  /** Stable React key. */
  key: string;
  /** A real calendar event, or a booked referral's derived appointment. */
  source: 'event' | 'referral';
  /** The calendar event id, or the referral id. */
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM when known. */
  time?: string;
  /** Who it is for: tagged, or named in the title. */
  memberIds: string[];
  /** 0 = today. */
  daysUntil: number;
}

export interface ComingUpOptions extends ImportanceOptions {
  /** How far ahead to look, counting today as day 0. Default 30. */
  days?: number;
  /** Include booked referral appointments (the Medical checks switch). Default true. */
  includeReferrals?: boolean;
}

function daysBetween(fromIso: string, toIso: string): number {
  // UTC midnight on both sides, as relativeDayLabel does: no DST in the sum.
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

/**
 * Important events from today to `days` ahead, soonest first (then by time,
 * untimed first). Booked referral appointments are included: they are
 * medical, so always important, but they are derived rows and never carry a
 * stored flag. In a business space nothing medical is listed, whoever marked
 * it, and referrals never are.
 */
export function importantComingUp(
  events: readonly CalendarEvent[],
  members: readonly FamilyMember[],
  todayIso: string,
  opts: ComingUpOptions = {},
): ImportantItem[] {
  const horizon = opts.days ?? 30;
  const business = !!opts.business;
  const out: ImportantItem[] = [];

  for (const ev of events) {
    if (!ev || typeof ev.date !== 'string') continue;
    const daysUntil = daysBetween(todayIso, ev.date);
    if (!(daysUntil >= 0 && daysUntil <= horizon)) continue;
    if (!isImportantEvent(ev, { business })) continue;
    if (business && isMedicalFlaggedEvent(ev)) continue;
    out.push({
      key: `event:${ev.id}`,
      source: 'event',
      id: ev.id,
      title: ev.title,
      date: ev.date,
      time: ev.time || undefined,
      memberIds: resolveEventMembers(ev, members).memberIds,
      daysUntil,
    });
  }

  if (!business && opts.includeReferrals !== false) {
    for (const r of buildReferralAppointments(members, events, todayIso)) {
      const daysUntil = daysBetween(todayIso, r.date);
      if (!(daysUntil >= 0 && daysUntil <= horizon)) continue;
      out.push({
        key: `referral:${r.referralId}:${r.date}`,
        source: 'referral',
        id: r.referralId,
        title: r.title,
        date: r.date,
        time: r.time,
        memberIds: [r.memberId],
        daysUntil,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

/** "Today" / "Tomorrow" / "In 5 days". */
export function daysToGoLabel(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}
