// A referral's booked appointment, and how it meets the calendar.
//
// THE REPORT (2026-09-13). "I have an orthopaedic surgeon appointment this
// month and a psychiatry appointment in a few weeks and it didn't pick up any
// of these in calendar or when I ask the chat."
//
// A letter that says "Termin am 22.09. um 10:30" was scanned, filed as a
// referral, and stayed status 'open' with no appointment date: the scan reader
// had no field to put the date in. Even a referral booked by hand only ever
// showed on the Medical checks panel, never on the calendar grid. This module
// holds the small rules those paths now share, so the form, the scan and the
// assistant can't each decide them differently:
//
//   - referralStatusForAppointment: a date means booked, clearing it means
//     open again, and a referral already marked done is never pulled back.
//   - appointmentMatchesEvent: "is this calendar entry the same appointment?"
//     Used to keep the grid from showing the same visit twice (a derived
//     referral row next to the real event) and to stop the assistant adding
//     a second event for an appointment already on the calendar.
//   - buildReferralAppointments: the booked, still-upcoming referral
//     appointments, minus any that already have a real calendar event. These
//     are DERIVED at render time and never written to calendar_events (one
//     fact, one writer: the referral owns its date).

import type { CalendarEvent, FamilyMember, ReferralRecord, ReferralStatus } from '../types';
import { resolveEventMembers } from './eventMemberMatch';
import { isMedicalFlaggedEvent } from './eventKeywordFlags';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && ISO_DATE.test(s);
}

export function isHhMm(s: unknown): s is string {
  return typeof s === 'string' && HH_MM.test(s);
}

/**
 * The status a referral should carry once its appointment date is `date`.
 *
 * - A date is set: 'booked' — unless the user has already moved it on to
 *   'done' (the appointment happened, the result is in), which a date must
 *   never undo.
 * - The date is cleared: a 'booked' referral goes back to 'open' (there is no
 *   appointment any more); any other status is left as it was.
 */
export function referralStatusForAppointment(
  current: ReferralStatus | undefined,
  appointmentDate: string | undefined | null,
): ReferralStatus {
  if (appointmentDate && appointmentDate.trim()) return current === 'done' ? 'done' : 'booked';
  if (current === 'booked') return 'open';
  return current || 'open';
}

/**
 * The status to save from the Referrals form. The rule above applies only
 * when the appointment date actually CHANGED: a referral the user marked
 * "Booked" with the quick buttons but no date yet must not be flipped back to
 * open just because they later fixed a typo in its reason.
 */
export function referralStatusOnSave(
  initialStatus: ReferralStatus | undefined,
  initialDate: string | undefined,
  nextDate: string | undefined,
): ReferralStatus {
  const before = (initialDate || '').trim();
  const after = (nextDate || '').trim();
  if (before === after && initialStatus) return initialStatus;
  return referralStatusForAppointment(initialStatus, after);
}

/**
 * An update to an existing referral, with the status rule applied.
 *
 * "My appointment is on the 22nd" arrives from the assistant as an
 * update_record that sets appointmentDate only. Merged as-is, the referral
 * stayed 'open' — and off the calendar, which shows booked ones. A status the
 * patch sets explicitly always wins; otherwise it follows the date.
 */
export function referralPatchWithStatus<T extends Record<string, unknown>>(
  record: { status?: ReferralStatus } | undefined,
  patch: T,
): T & { status?: ReferralStatus } {
  if (!('appointmentDate' in patch) || 'status' in patch) return patch;
  const date = typeof patch.appointmentDate === 'string' ? patch.appointmentDate : undefined;
  return { ...patch, status: referralStatusForAppointment(record?.status, date) };
}

/** "Orthopaedic surgeon — Dr Example": what the referral is for, then who. */
export function referralAppointmentTitle(
  rec: Pick<ReferralRecord, 'reason' | 'kind' | 'providerName'>,
): string {
  const what = (rec.reason || '').trim() || String(rec.kind || 'Appointment');
  const who = (rec.providerName || '').trim();
  return who ? `${what} — ${who}` : what;
}

// ---------------------------------------------------------------------------
// Is this calendar entry the same appointment?
// ---------------------------------------------------------------------------

/** Words that say nothing about WHICH appointment it is. */
const GENERIC = new Set([
  'appointment', 'appt', 'appointments', 'termin', 'termine', 'dr', 'doctor', 'doc', 'prof',
  'med', 'univ', 'mag', 'with', 'for', 'the', 'and', 'und', 'bei', 'beim', 'der', 'die', 'das',
  'den', 'dem', 'mit', 'von', 'zum', 'zur', 'am', 'um', 'an', 'in', 'at', 'on', 'of', 'to',
  'visit', 'check', 'follow', 'up', 'new', 'first', 'erst', 'erstes', 'second', 'next',
  'meeting', 'call', 'medical', 'arzt', 'arztin', 'facharzt', 'facharztin', 'ordination',
  'praxis', 'clinic', 'klinik', 'hospital', 'spital', 'ambulanz', 'referral', 'uberweisung',
  'letter', 'brief', 'mr', 'mrs', 'ms', 'frau', 'herr',
]);

/** Lowercase, strip accents ("Orthopädie" → "orthopadie"), split into words. */
function tokens(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ae/g, 'a') // "orthopaedic" and "orthopädie" share a stem
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !GENERIC.has(t));
}

/**
 * Two words name the same thing. Long words compare on a six-letter stem so
 * "orthopaedic" meets "Orthopädie" and "psychiatry" meets "Psychiater" —
 * English letter, Austrian calendar. Short words must match exactly.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6) return a.slice(0, 6) === b.slice(0, 6);
  return false;
}

export interface AppointmentFacts {
  date: string;
  memberId: string;
  /** What it is: a referral's reason/kind, or a proposed event's title. */
  title?: string;
  /** Who it is with: "Dr Example", "Orthopädie Beispielspital". */
  provider?: string;
}

/**
 * Is `ev` the calendar's copy of this appointment?
 *
 * Same day, and the event is this person's (tagged, or named in its title) or
 * nobody's in particular, and it shares a meaningful word with the
 * appointment's title or provider. Person names never count as that shared
 * word: "Mia — dentist" and "Mia — eye test" on one day are two visits.
 */
export function appointmentMatchesEvent(
  ev: Pick<CalendarEvent, 'date' | 'title' | 'memberIds' | 'description'>,
  appt: AppointmentFacts,
  members: readonly Pick<FamilyMember, 'id' | 'name'>[],
): boolean {
  if (!ev || ev.date !== appt.date) return false;
  const owners = resolveEventMembers(ev, members).memberIds;
  if (owners.length > 0 && !owners.includes(appt.memberId)) return false;

  const names = new Set(members.flatMap((m) => tokens(m.name)));
  const want = [...tokens(appt.title), ...tokens(appt.provider)].filter((t) => !names.has(t));
  if (want.length === 0) return false;
  const have = [...tokens(ev.title), ...tokens(ev.description)].filter((t) => !names.has(t));
  return want.some((w) => have.some((h) => sameWord(w, h)));
}

// ---------------------------------------------------------------------------
// Booked referral appointments, for the calendar grid
// ---------------------------------------------------------------------------

export interface ReferralAppointment {
  referralId: string;
  memberId: string;
  memberName: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, when the letter or the user gave one. */
  time?: string;
  title: string;
  provider?: string;
}

/**
 * Does a real calendar event already stand for this referral's booked visit?
 *
 * Yes when it is on the same day, is this member's (or nobody's in
 * particular), and either shares a word with the referral
 * (appointmentMatchesEvent) or is a medical/Appointment entry that is plainly
 * this member's. The second arm
 * covers "Mia – Ortho" typed by hand next to a referral that says "Knee":
 * no shared word, but one person rarely has two medical visits on one day,
 * and a duplicate on the grid is the more visible failure.
 */
export function eventCoversReferral(
  ev: Pick<CalendarEvent, 'date' | 'title' | 'memberIds' | 'description' | 'category'>,
  r: Pick<ReferralRecord, 'appointmentDate' | 'reason' | 'kind' | 'providerName'>,
  memberId: string,
  members: readonly Pick<FamilyMember, 'id' | 'name'>[],
): boolean {
  if (!r.appointmentDate || ev.date !== r.appointmentDate) return false;
  const facts: AppointmentFacts = {
    date: r.appointmentDate,
    memberId,
    title: (r.reason || '').trim() || String(r.kind || ''),
    provider: r.providerName,
  };
  if (appointmentMatchesEvent(ev, facts, members)) return true;
  const { memberIds, explicit } = resolveEventMembers(ev, members);
  const isThisPersons = memberIds.includes(memberId) && (explicit || memberIds.length === 1);
  return isThisPersons && (ev.category === 'Appointment' || isMedicalFlaggedEvent(ev));
}

/**
 * Every booked referral whose appointment is today or later, as a calendar
 * row — except where a real calendar event already stands for that visit
 * (eventCoversReferral). The real event wins because it is the one the user
 * can edit, move and sync; the derived row only exists to fill the gap.
 */
export function buildReferralAppointments(
  members: readonly FamilyMember[],
  events: readonly CalendarEvent[],
  todayIso: string,
): ReferralAppointment[] {
  const out: ReferralAppointment[] = [];
  for (const m of members) {
    for (const r of m.referrals || []) {
      if (r.status !== 'booked' || !isIsoDate(r.appointmentDate)) continue;
      if (r.appointmentDate < todayIso) continue;
      if (events.some((ev) => eventCoversReferral(ev, r, m.id, members))) continue;
      out.push({
        referralId: r.id,
        memberId: m.id,
        memberName: m.name,
        date: r.appointmentDate,
        time: isHhMm(r.appointmentTime) ? r.appointmentTime : undefined,
        title: referralAppointmentTitle(r),
        provider: r.providerName?.trim() || undefined,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}
