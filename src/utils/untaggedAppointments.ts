// "Untagged appointments — whose is this?"
//
// Rory, 2026-09-13: an orthopaedic-surgeon appointment and a psychiatry one,
// both in his Google Calendar, both imported, and neither on his profile. A
// Google import tags nobody (Google has no idea who lives in the house), and
// resolveEventMembers can only rescue an entry whose TITLE names someone.
// People don't write their own name on their own appointments — "Orthopädie
// Dr. X" is what an adult types for himself — so exactly the appointments of
// the person holding the calendar are the ones that stay untagged.
//
// Guessing is not the answer: on a shared family calendar "the account owner"
// is a guess about whose appointment it is, and a medical appointment
// silently filed on the wrong person's profile is worse than one on nobody's.
// So the app ASKS, one tap per appointment, on the two screens where the gap
// is visible: the calendar's event view and a person's Medical appointments.
// A suggestion can be prefilled (the signed-in adult), but it is only ever a
// highlighted button — nothing is tagged until someone taps.
//
// Scope: upcoming, medical-looking (eventKeywordFlags), and nobody resolved.
// Past ones are left alone — a two-year backlog of untagged entries is a chore
// list nobody asked for, and the upcoming ones are what someone acts on.

import type { CalendarEvent, FamilyMember } from '../types';
import { resolveEventMembers } from './eventMemberMatch';
import { isMedicalFlaggedEvent } from './eventKeywordFlags';

export function isUntaggedMedicalAppointment(
  ev: Pick<CalendarEvent, 'title' | 'memberIds' | 'description'>,
  members: readonly Pick<FamilyMember, 'id' | 'name'>[],
): boolean {
  return resolveEventMembers(ev, members).memberIds.length === 0 && isMedicalFlaggedEvent(ev);
}

/** Upcoming (today or later) untagged medical appointments, soonest first. */
export function untaggedMedicalAppointments(
  events: readonly CalendarEvent[],
  members: readonly Pick<FamilyMember, 'id' | 'name'>[],
  todayIso: string,
  dismissed: ReadonlySet<string> = new Set(),
): CalendarEvent[] {
  return events
    .filter((ev) => ev.date >= todayIso && !dismissed.has(ev.id) && isUntaggedMedicalAppointment(ev, members))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

const isAdult = (m: Pick<FamilyMember, 'role'>) => m.role !== 'Child';

/**
 * Whose button to highlight. The signed-in person when they are an adult
 * member; otherwise the only adult in the space, if there is exactly one.
 * Anything else — two parents, no idea who is signed in — suggests nobody.
 * `meId` comes from utils/me.ts resolveMe: cosmetic, never a permission.
 */
export function suggestAppointmentOwner(
  members: readonly Pick<FamilyMember, 'id' | 'role'>[],
  meId: string | null | undefined,
): string | undefined {
  const me = meId ? members.find((m) => m.id === meId) : undefined;
  if (me && isAdult(me)) return me.id;
  const adults = members.filter(isAdult);
  return adults.length === 1 ? adults[0].id : undefined;
}

/**
 * The events list with ONE event tagged to one member. Every other key on the
 * event is kept (spread), and every other event is returned untouched — the
 * whole list is what gets saved, so anything dropped here would be deleted.
 */
export function tagEventToMember(
  events: readonly CalendarEvent[],
  eventId: string,
  memberId: string,
): CalendarEvent[] {
  return events.map((ev) => (ev.id === eventId ? { ...ev, memberIds: [memberId] } : ev));
}

// Per-device "not now". Keyed per space so one family's dismissals never hide
// another's prompts; prefixed family_ so logout's localStorage sweep clears it.
const DISMISS_KEY = (spaceId: string) => `family_untaggedApptDismissed_${spaceId || 'default'}`;

export function readDismissedUntagged(spaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY(spaceId));
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeDismissedUntagged(spaceId: string, ids: ReadonlySet<string>): void {
  try {
    // Capped: ids of long-past events are useless and this must not grow forever.
    localStorage.setItem(DISMISS_KEY(spaceId), JSON.stringify([...ids].slice(-200)));
  } catch { /* private mode / quota — the prompt just comes back, which is harmless */ }
}
