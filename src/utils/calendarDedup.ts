import { CalendarEvent } from '../types';

// One rule for "is this the same appointment as one we already have?", shared
// by every path that can add a calendar event.
//
// WHAT WENT WRONG
// ----------------
// A live vault had 9 duplicate events across 7 groups, from two unrelated
// causes that both reduce to "nothing ever checked":
//
//   1. Four identical copies of "Vita & Ganga: Re-test Ferritin and Vitamin D",
//      all Teluva-native ids, created over about twelve minutes. That is the
//      assistant's Apply being used more than once for the same thing — asked
//      again, or tapped again. applyCalendarEdits appended unconditionally, so
//      each Apply produced another copy.
//
//   2. Six pairs of Google-imported events ("Klara" at various times), each
//      pair with two DIFFERENT Google event ids. Those are two real entries on
//      the Google side — in one case a recurring series' instance alongside a
//      moved exception of the same instance. The importer copied both
//      faithfully. Faithful, but useless: two rows a person cannot tell apart.
//
// The "gcal-" prefix guard in googleCalendarSync.ts prevents the LOOP (an
// imported event being pushed back out and re-imported). It cannot help here,
// because these were never the same event — they only look identical to a
// human. This file is that second, human-level check.
//
// DELIBERATELY NOT INCLUDED IN THE KEY
// -------------------------------------
// category and memberIds. The same appointment arriving by two routes can
// disagree about both — the assistant files a doctor's visit as 'Appointment'
// while a Google import of the same thing may land as 'Other', and an imported
// event has no member tags at all. Including them would make near-identical
// records look distinct and let the duplicate through, which is the entire
// failure being fixed.

/**
 * The identity of an appointment as a person perceives it: same day, same
 * time, same name. Title is compared case- and whitespace-insensitively
 * because "Klara" and "Klara " are not two appointments.
 */
export function calendarEventKey(ev: Pick<CalendarEvent, 'date' | 'time' | 'title'>): string {
  const title = (ev.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  // A missing time and an empty time are the same thing — an all-day entry.
  const time = (ev.time || '').trim();
  return `${ev.date}|${time}|${title}`;
}

/**
 * The event in `existing` that `candidate` would duplicate, or undefined.
 *
 * An event with NO date is never a duplicate of anything: it cannot be
 * displayed on a day, so treating two of them as the same record would be
 * guessing.
 */
export function findDuplicateEvent(
  existing: readonly CalendarEvent[],
  candidate: Pick<CalendarEvent, 'date' | 'time' | 'title'>,
): CalendarEvent | undefined {
  if (!candidate.date || !(candidate.title || '').trim()) return undefined;
  const key = calendarEventKey(candidate);
  return existing.find((ev) => calendarEventKey(ev) === key);
}

/**
 * Split candidates into the ones worth adding and the ones already covered —
 * checking each accepted candidate against the ones before it too, so a single
 * batch containing the same event twice only adds it once.
 */
export function partitionNewEvents<T extends Pick<CalendarEvent, 'date' | 'time' | 'title'>>(
  existing: readonly CalendarEvent[],
  candidates: readonly T[],
): { fresh: T[]; duplicates: T[] } {
  const seen = new Set(existing.map(calendarEventKey));
  const fresh: T[] = [];
  const duplicates: T[] = [];

  for (const c of candidates) {
    if (!c.date || !(c.title || '').trim()) { fresh.push(c); continue; }
    const key = calendarEventKey(c);
    if (seen.has(key)) { duplicates.push(c); continue; }
    seen.add(key);
    fresh.push(c);
  }
  return { fresh, duplicates };
}

/**
 * Groups of events already in the vault that duplicate each other, most
 * copies first. Each group's first entry is the one to keep — the others are
 * safe to remove. Used to clean up the mess the missing checks already made.
 */
export function findExistingDuplicateGroups(events: readonly CalendarEvent[]): CalendarEvent[][] {
  const groups = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    if (!ev.date || !(ev.title || '').trim()) continue;
    const key = calendarEventKey(ev);
    const g = groups.get(key);
    if (g) g.push(ev); else groups.set(key, [ev]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .sort((a, b) => b.length - a.length);
}
