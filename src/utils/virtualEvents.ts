// Virtual calendar entries — the missing bridge between the two halves of the
// Family Calendar.
//
// THE PROBLEM THIS SOLVES. The month grid renders exactly one thing: stored
// CalendarEvent records (`events.filter(e => e.date === dateStr)`). Everything
// else on that screen — birthdays, extended birthdays, name days, medical
// checks, anniversaries, school dates, vacations — is a SEPARATE, derived data
// path (utils/familyDates.ts's build* functions) that terminates in the summary
// cards further down and touches the grid not at all. The visible consequence:
// a family member's own birthday does not appear on the calendar. Neither does
// a name day or a wedding anniversary. Rory reported this against extended
// birthdays; it was never specific to them.
//
// WHY NOT JUST STORE THEM AS EVENTS. Because the derived path exists precisely
// to avoid that. familyDates.ts's header states the rule: birthdays and name
// celebrations read straight off the member record so that "editing a
// birthdate, confirming a celebration [...] updates the calendar immediately
// with no second write path to keep in sync." Materialising a CalendarEvent per
// birthday would reintroduce exactly the staleness that design prevents — a
// birthdate correction would leave last year's generated event behind.
//
// SO: this module projects those derived occurrences into read-only, virtual,
// event-shaped objects at RENDER time, for whatever date range the grid is
// currently showing. Nothing here is ever written to Firestore, and a
// VirtualCalendarEvent is deliberately NOT a CalendarEvent — it has no id in
// the events collection, so it must never reach the event editor, the delete
// path, Google sync, or the published feed's own selection logic.
//
// WHAT IS DELIBERATELY NOT PROJECTED:
//   - School dates and vacations. Both are derived FROM stored events
//     (category 'School' / 'Travel'), so they are ALREADY in the grid as real
//     events. Projecting them would double-count every one of them.
//   - Anniversary entries whose id starts with 'calendar-'. Same reason:
//     buildCalendarAnniversaries also picks up free-text events that merely
//     READ as an anniversary, and those are already stored events.
//   - Medical checks. Mixed provenance (referrals + calendar-flagged events),
//     and a medical appointment is a private, individually-dated thing rather
//     than a recurring family occasion — it does not belong in the same "this
//     comes back every year" projection as a birthday. Left for a later pass.
//   - Movable name celebrations with no cached resolution for the year in
//     question. NameCelebration.resolvedDates is documented as "a cache, not a
//     fact [...] A missing year means 'unknown until resolved', never 'guess'".
//     A projected date would be an invented one, so those years emit nothing.
import type {
  CalendarAnniversary,
  CalendarBirthday,
  CalendarExtendedBirthday,
  CalendarNameCelebration,
} from './familyDates';
import { isLeapYear, nameDayOccurrenceInYear } from './nameDay';

export type VirtualEventKind = 'birthday' | 'extendedBirthday' | 'nameDay' | 'anniversary';

export interface VirtualCalendarEvent {
  /** Unique per occurrence, e.g. 'virtual:birthday:m_12:2026-03-03'. Namespaced
   *  so it can never collide with a real CalendarEvent id. */
  id: string;
  kind: VirtualEventKind;
  /** The id of the record this was derived from (member, ExtendedBirthday,
   *  AnniversaryRecord…), so a click can deep-link back to the real thing. */
  sourceId: string;
  title: string;
  /** YYYY-MM-DD of THIS occurrence — not the next one. */
  date: string;
  /** 'turns 7', '12 years' — the count for this specific occurrence, or
   *  undefined when the source has no origin year to count from. */
  detail?: string;
  memberIds?: string[];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function isoFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Every year touched by an inclusive YYYY-MM-DD range. A grid month always
 * spills a few days either side, so a January view legitimately spans two
 * years and both have to be projected.
 */
function yearsInRange(startIso: string, endIso: string): number[] {
  const from = Number(startIso.slice(0, 4));
  const to = Number(endIso.slice(0, 4));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const out: number[] = [];
  for (let y = from; y <= to; y++) out.push(y);
  return out;
}

/**
 * Project one recurring 'MM-DD' slot onto every year in the range, keeping the
 * occurrences that land inside it. Returns ISO date strings.
 */
function occurrencesInRange(monthDay: string, startIso: string, endIso: string): string[] {
  const out: string[] = [];
  for (const year of yearsInRange(startIso, endIso)) {
    const occurrence = nameDayOccurrenceInYear(monthDay, year);
    if (!occurrence) continue;
    const iso = isoFromDate(occurrence);
    if (iso >= startIso && iso <= endIso) out.push(iso);
  }
  return out;
}

/**
 * The origin year behind a "next occurrence + count on that occurrence" pair.
 *
 * familyDates.ts's build* functions resolve only the NEXT occurrence and the
 * age/years count on it. To label an arbitrary year's occurrence we need the
 * origin year back — and deriving it here avoids widening four public
 * interfaces (and their tests) purely to carry a number that is already
 * recoverable from what they return.
 */
function originYear(nextOccurrenceIso: string, countOnThatOccurrence: number | null): number | null {
  if (countOnThatOccurrence == null) return null;
  const year = Number(nextOccurrenceIso.slice(0, 4));
  return Number.isFinite(year) ? year - countOnThatOccurrence : null;
}

export interface VirtualEventSources {
  birthdays?: readonly CalendarBirthday[];
  extendedBirthdays?: readonly CalendarExtendedBirthday[];
  nameCelebrations?: readonly CalendarNameCelebration[];
  anniversaries?: readonly CalendarAnniversary[];
}

/**
 * Materialise the recurring, derived family occasions that fall inside an
 * inclusive YYYY-MM-DD range.
 *
 * Both bounds are inclusive. Results are sorted by date, then by kind, then by
 * title, so a day's dots and its agenda list always agree on ordering.
 */
export function buildVirtualEvents(
  sources: VirtualEventSources,
  startIso: string,
  endIso: string,
): VirtualCalendarEvent[] {
  const out: VirtualCalendarEvent[] = [];
  if (!startIso || !endIso || endIso < startIso) return out;

  for (const b of sources.birthdays ?? []) {
    const born = originYear(b.date, b.turningAge);
    for (const iso of occurrencesInRange(b.monthDay, startIso, endIso)) {
      const age = born == null ? null : Number(iso.slice(0, 4)) - born;
      out.push({
        id: `virtual:birthday:${b.memberId}:${iso}`,
        kind: 'birthday',
        sourceId: b.memberId,
        title: `${b.memberName}'s birthday`,
        date: iso,
        detail: age == null ? undefined : `turns ${age}`,
        memberIds: [b.memberId],
      });
    }
  }

  for (const eb of sources.extendedBirthdays ?? []) {
    const born = originYear(eb.date, eb.turningAge);
    for (const iso of occurrencesInRange(eb.monthDay, startIso, endIso)) {
      const age = born == null ? null : Number(iso.slice(0, 4)) - born;
      out.push({
        id: `virtual:extendedBirthday:${eb.id}:${iso}`,
        kind: 'extendedBirthday',
        sourceId: eb.id,
        title: `${eb.name}'s birthday`,
        date: iso,
        detail: age == null ? undefined : `turns ${age}`,
      });
    }
  }

  for (const nc of sources.nameCelebrations ?? []) {
    const { celebration } = nc;
    if (celebration.dateType === 'fixed') {
      if (!celebration.date) continue;
      for (const iso of occurrencesInRange(celebration.date, startIso, endIso)) {
        out.push({
          id: `virtual:nameDay:${nc.id}:${iso}`,
          kind: 'nameDay',
          sourceId: nc.memberId,
          title: celebration.title,
          date: iso,
          detail: nc.memberName,
          memberIds: [nc.memberId],
        });
      }
      continue;
    }
    // Movable: only years the server has actually resolved. No projection, no
    // guess — see the header note on resolvedDates.
    for (const iso of Object.values(celebration.resolvedDates ?? {})) {
      if (typeof iso !== 'string' || iso < startIso || iso > endIso) continue;
      out.push({
        id: `virtual:nameDay:${nc.id}:${iso}`,
        kind: 'nameDay',
        sourceId: nc.memberId,
        title: celebration.title,
        date: iso,
        detail: nc.memberName,
        memberIds: [nc.memberId],
      });
    }
  }

  for (const a of sources.anniversaries ?? []) {
    // Already a stored CalendarEvent — projecting it would double-count.
    if (a.id.startsWith('calendar-')) continue;
    const origin = originYear(a.date, a.years);
    for (const iso of occurrencesInRange(a.monthDay, startIso, endIso)) {
      const years = origin == null ? null : Number(iso.slice(0, 4)) - origin;
      out.push({
        id: `virtual:anniversary:${a.id}:${iso}`,
        kind: 'anniversary',
        sourceId: a.id,
        title: a.title,
        date: iso,
        detail: years == null ? undefined : `${years} ${years === 1 ? 'year' : 'years'}`,
        memberIds: a.memberIds,
      });
    }
  }

  return out.sort(
    (x, y) => x.date.localeCompare(y.date) || x.kind.localeCompare(y.kind) || x.title.localeCompare(y.title),
  );
}

// ---------------------------------------------------------------------------
// The same occasions, as SERIES rather than occurrences
// ---------------------------------------------------------------------------
//
// buildVirtualEvents above answers "what falls in this month" — the right shape
// for a grid that redraws every time you page. An exported .ics file wants the
// opposite: not a list of dates but the RULE behind them, so that a calendar
// which imports the file once keeps showing the birthday every year afterwards
// without Teluva ever being asked again. Materialising N years of occurrences
// into the file instead would put a silent expiry date on the export — the year
// the list runs out, birthdays would simply stop, with nothing to explain why.
//
// So this returns one entry per OCCASION, anchored on its origin, and leaves the
// repetition to RRULE (see utils/ics.ts). The exclusions are identical to
// buildVirtualEvents' — see the header — because they are about provenance, not
// about how the dates are rendered.

export interface RecurringOccasion {
  /** Stable for the life of the occasion — it becomes the .ics UID, and a UID
   *  that moves makes a calendar delete-and-recreate rather than update. */
  id: string;
  kind: VirtualEventKind;
  title: string;
  /** DTSTART, YYYY-MM-DD: the origin year when known (so the series reads as
   *  "since 1987"), otherwise the current year. */
  date: string;
  /** 'yearly' repeats forever. 'once' is a single dated entry — used for
   *  movable celebrations, whose dates are resolved per year and must never be
   *  extrapolated by a rule. */
  repeat: 'yearly' | 'once';
  description?: string;
  /** Free text for the .ics CATEGORIES property — NOT a CalendarEvent category. */
  category: string;
}

/**
 * The DTSTART for a recurring 'MM-DD' slot.
 *
 * A 29 February slot must anchor on a year that HAS a 29 February, or the
 * exported rule would describe a different day from the one the record means.
 * Stepping back to the nearest leap year keeps the anchor truthful; how the
 * ordinary years are handled is the recurrence rule's job, not the anchor's.
 */
function anchorIso(monthDay: string, preferredYear: number): string | null {
  let year = preferredYear;
  if (monthDay === '02-29') while (!isLeapYear(year)) year -= 1;
  const occurrence = nameDayOccurrenceInYear(monthDay, year);
  return occurrence ? isoFromDate(occurrence) : null;
}

function describe(...parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length ? kept.join(' · ') : undefined;
}

/**
 * Every recurring family occasion as a series, for export.
 *
 * `today` only decides the anchor year for occasions with no origin year of
 * their own (an extended birthday recorded without a birth year, a fixed name
 * day, Valentine's Day) — it never limits which occasions are returned.
 */
export function buildOccasionSeries(
  sources: VirtualEventSources,
  today: Date = new Date(),
): RecurringOccasion[] {
  const out: RecurringOccasion[] = [];
  const thisYear = today.getFullYear();

  for (const b of sources.birthdays ?? []) {
    const born = originYear(b.date, b.turningAge);
    const date = anchorIso(b.monthDay, born ?? thisYear);
    if (!date) continue;
    out.push({
      id: `virtual-birthday-${b.memberId}`,
      kind: 'birthday',
      title: `${b.memberName}'s birthday`,
      date,
      repeat: 'yearly',
      description: describe(born == null ? null : `Born ${born}`, 'From Teluva'),
      category: 'Birthday',
    });
  }

  for (const eb of sources.extendedBirthdays ?? []) {
    const born = originYear(eb.date, eb.turningAge);
    const date = anchorIso(eb.monthDay, born ?? thisYear);
    if (!date) continue;
    out.push({
      id: `virtual-extendedBirthday-${eb.id}`,
      kind: 'extendedBirthday',
      title: `${eb.name}'s birthday`,
      date,
      repeat: 'yearly',
      description: describe(eb.relationship, born == null ? null : `Born ${born}`, 'From Teluva'),
      category: 'Birthday',
    });
  }

  for (const nc of sources.nameCelebrations ?? []) {
    const { celebration } = nc;
    if (celebration.dateType === 'fixed') {
      const date = celebration.date ? anchorIso(celebration.date, thisYear) : null;
      if (!date) continue;
      out.push({
        id: `virtual-nameDay-${nc.id}`,
        kind: 'nameDay',
        title: celebration.title,
        date,
        repeat: 'yearly',
        description: describe(nc.memberName, 'From Teluva'),
        category: 'Name day',
      });
      continue;
    }
    // Movable: one dated entry per year the server has actually resolved, and
    // no rule at all. FREQ=YEARLY on an Easter-derived date would have the
    // importing calendar inventing every future occurrence on the wrong day —
    // the exact guess resolvedDates exists to refuse.
    for (const iso of Object.values(celebration.resolvedDates ?? {})) {
      if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      out.push({
        id: `virtual-nameDay-${nc.id}-${iso}`,
        kind: 'nameDay',
        title: celebration.title,
        date: iso,
        repeat: 'once',
        description: describe(nc.memberName, 'From Teluva'),
        category: 'Name day',
      });
    }
  }

  for (const a of sources.anniversaries ?? []) {
    if (a.id.startsWith('calendar-')) continue;   // already a stored event
    const origin = originYear(a.date, a.years);
    const date = anchorIso(a.monthDay, origin ?? thisYear);
    if (!date) continue;
    out.push({
      id: `virtual-anniversary-${a.id}`,
      kind: 'anniversary',
      title: a.title,
      date,
      repeat: 'yearly',
      description: describe(origin == null ? null : `Since ${origin}`, 'From Teluva'),
      category: 'Anniversary',
    });
  }

  return out.sort(
    (x, y) => x.date.slice(5).localeCompare(y.date.slice(5)) || x.title.localeCompare(y.title),
  );
}

/** Group virtual events by their ISO date, for O(1) lookup per grid cell. */
export function groupVirtualEventsByDate(
  items: readonly VirtualCalendarEvent[],
): Map<string, VirtualCalendarEvent[]> {
  const map = new Map<string, VirtualCalendarEvent[]>();
  for (const item of items) {
    const bucket = map.get(item.date);
    if (bucket) bucket.push(item);
    else map.set(item.date, [item]);
  }
  return map;
}
