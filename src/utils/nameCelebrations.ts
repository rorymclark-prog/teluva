// Name Days & Name Celebrations — the shared resolver and the local half of
// the matching hierarchy.
//
// WHY THIS EXISTS
// nameDay.ts answers one question for one tradition: "what does the Austrian
// Namenskalender suggest for this name?" The feature has since grown two
// requirements that table cannot carry alone:
//
//   1. Names outside that calendar can have a GENUINE celebration of their own
//      (Nityananda Trayodashi for a Shyam) — a different kind of thing from a
//      name day, on a date that may move with a lunar calendar, and never
//      activated without the family confirming the connection.
//   2. Every match must say HOW it matched. 29 September offered to a Rory
//      Michael is only honest as "the day of the second name Michael" — never
//      as Rory's own day.
//
// This module owns both: it merges the legacy nameDay/nameDayFeast pair into
// the NameCelebration shape (so existing Austrian data needs no migration),
// resolves fixed and movable dates per year, and produces the LOCAL
// suggestions — hierarchy steps 1–3, each labelled with which token matched
// and whether it went through the alias table. Steps 4–5 (cultural
// associations, custom family dates) are researched server-side and arrive
// already shaped as NameCelebration.
//
// THE RULES CARRIED OVER FROM nameDay.ts, UNCHANGED:
//   * NEVER INVENT A DAY. No local match means NO local suggestion — Shyam,
//     Nomvula, Kayla get nothing from here, and that is the correct answer.
//   * A suggestion is not a fact. Nothing is celebrated until it is stored
//     with confirmed: true.
import { NameCelebration } from '../types';
import {
  daysUntilNameDay,
  formatNameDay,
  isValidNameDay,
  lookupTokenDetailed,
  splitNameTokens,
} from './nameDay';

/** The slice of FamilyMember this module reads — structural, so tests and
 *  server code can pass plain objects without dragging the whole type in. */
export interface CelebrationsMember {
  name?: string;
  nickname?: string;
  nameDay?: string;
  nameDayFeast?: string;
  nameCelebrations?: NameCelebration[];
  nameCelebrationDismissed?: boolean;
  /** Cron-resolved movable years, keyed by celebration id then year — lives
   *  outside the array so a server write can never collide with a family
   *  member's own edit or delete under mergeShared's preservation policy.
   *  See the field's comment in types.ts. */
  nameCelebrationResolvedDates?: Record<string, Record<string, string>>;
}

/** The id of the implicit celebration synthesised from the legacy nameDay
 *  pair. Stable so UIs can tell it apart from stored entries (it has no
 *  document of its own — editing it means editing member.nameDay). */
export const LEGACY_NAME_DAY_ID = 'legacy-name-day';

export interface ResolvedCelebrations {
  /** The one celebration the family keeps as THE day: confirmed and flagged
   *  primary. Null when nothing confirmed carries the primary flag. */
  primary: NameCelebration | null;
  /** Confirmed celebrations beyond the primary — the opt-in extras. */
  additional: NameCelebration[];
  /** Everything merged, unconfirmed proposals included — for editing UIs.
   *  Celebration surfaces (cron, calendar, OnThisDay) must read primary and
   *  additional, never this. */
  all: NameCelebration[];
}

/**
 * Merge the legacy nameDay pair and nameCelebrations[] into one view.
 *
 * The legacy pair was confirmed by construction — the family tapped or typed
 * it — so it becomes an implicit confirmed name_day. It is treated as an
 * 'exact' Austrian match because that is the only path the legacy UI offered;
 * it yields the primary flag to any explicit confirmed primary so a family
 * that has moved on to the new model is not overruled by its old field.
 */
export function resolveCelebrations(member: CelebrationsMember): ResolvedCelebrations {
  // Fold the cron's per-year resolutions (stored on the member doc, outside
  // the array — see CelebrationsMember) back into each entry, so every
  // consumer of this resolved view sees one complete resolvedDates cache.
  // Confirm-time resolutions stored on the celebration itself win: both are
  // validated, but those are what the family saw when they confirmed.
  const cronDates = member.nameCelebrationResolvedDates;
  const explicit = (member.nameCelebrations ?? []).map((c) => {
    const extra = cronDates?.[c.id];
    return extra ? { ...c, resolvedDates: { ...extra, ...(c.resolvedDates ?? {}) } } : c;
  });
  const all: NameCelebration[] = [];

  if (member.nameDay && isValidNameDay(member.nameDay)) {
    const explicitPrimary = explicit.some((c) => c.confirmed && c.primary);
    // Skip the implicit entry only when an explicit confirmed PRIMARY
    // name_day stores the same fixed date — that entry IS the migrated
    // Namenstag, and a migrated member must not appear to celebrate the same
    // day twice. A non-primary duplicate must NOT displace it: dropping the
    // legacy entry then would leave no primary at all, and the member's
    // long-standing name day would silently vanish from every surface that
    // reads `primary`.
    const alreadyMigrated = explicit.some(
      (c) => c.confirmed && c.primary && c.kind === 'name_day' && c.dateType === 'fixed' && c.date === member.nameDay,
    );
    if (!alreadyMigrated) {
      all.push({
        id: LEGACY_NAME_DAY_ID,
        kind: 'name_day',
        title: member.nameDayFeast || 'Name day',
        celebrationOf: splitNameTokens(member.name)[0] ?? member.nickname ?? '',
        matchType: 'exact',
        tradition: 'Austrian Namenskalender',
        explanation: member.nameDayFeast
          ? `The family keeps this day as the name day: ${member.nameDayFeast} (${formatNameDay(member.nameDay)}).`
          : `The family keeps ${formatNameDay(member.nameDay)} as the name day.`,
        dateType: 'fixed',
        date: member.nameDay,
        confirmed: true,
        primary: !explicitPrimary,
        // Only the primary notifies by default (spec: "do not generate
        // multiple annual notifications by default"). A legacy day demoted by
        // a newer explicit primary therefore goes quiet — the server cron
        // applies the same rule, so demoting IS how a family silences the
        // Namenstag push without deleting the field.
        notify: !explicitPrimary,
      });
    }
  }
  all.push(...explicit);

  const confirmed = all.filter((c) => c.confirmed);
  // First confirmed primary in merge order wins; any further primary flags are
  // a data inconsistency and land in additional rather than erroring.
  const primary = confirmed.find((c) => c.primary) ?? null;
  const additional = confirmed.filter((c) => c !== primary);
  return { primary, additional, all };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** 'YYYY-MM-DD' → local-midnight Date, or null when malformed or not a real
 *  calendar date. Never `new Date(iso)` — that parses as UTC and shifts the
 *  day in western timezones. */
function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1) return null;
  const maxDay = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > maxDay) return null;
  return new Date(year, month - 1, day);
}

export interface CelebrationDate {
  /** Full 'YYYY-MM-DD', or null when it cannot be known. */
  date: string | null;
  /** True when date is null because the movable rule has no resolution cached
   *  for that year — the caller should trigger resolution, never guess. False
   *  with a null date means the celebration's data is malformed. */
  needsResolution: boolean;
}

/**
 * The Gregorian date this celebration falls on in a given year.
 *
 * Fixed: the stored 'MM-DD' in that year, with the Feb-29 convention shared
 * with daysUntilNameDay and OnThisDay — the slot exists every year and lands
 * on the 28th when there is no 29th.
 * Movable: only ever read from resolvedDates. A missing year is reported as
 * needsResolution, and a cached value that is not a real date in the asked-for
 * year is treated the same — a wrong-year cache entry is worse than none.
 */
export function celebrationDateInYear(celebration: NameCelebration, year: number): CelebrationDate {
  if (celebration.dateType === 'fixed') {
    if (!isValidNameDay(celebration.date)) return { date: null, needsResolution: false };
    const [m, d] = String(celebration.date).split('-').map(Number);
    const day = m === 2 && d === 29 && !isLeap(year) ? 28 : d;
    return { date: `${year}-${pad2(m)}-${pad2(day)}`, needsResolution: false };
  }
  const cached = celebration.resolvedDates?.[String(year)];
  if (cached) {
    const parsed = parseIsoDate(cached);
    if (parsed && parsed.getFullYear() === year) return { date: cached, needsResolution: false };
  }
  return { date: null, needsResolution: true };
}

export interface CelebrationCountdown {
  /** Whole days from `today` to the next KNOWN occurrence (0 = today), or
   *  null when no upcoming occurrence is cached at all. */
  days: number | null;
  /** True when a movable date still awaits per-year resolution. Can be true
   *  alongside a non-null `days`: the countdown then targets the nearest
   *  CACHED occurrence (next year's) while the current year is unresolved and
   *  might yet hold a sooner one — a real date on file must not vanish from
   *  every surface just because a nearer one is still unknown. */
  needsResolution: boolean;
}

/**
 * Days until this celebration next occurs. Fixed dates delegate to
 * daysUntilNameDay (same rollover and Feb-29 behaviour as everything else);
 * movable dates try this year's resolution and, when that has already passed
 * or is not cached, next year's. Nothing cached and upcoming surfaces as
 * needsResolution rather than a silently absent celebration.
 */
export function daysUntilCelebration(
  celebration: NameCelebration,
  today: Date = new Date(),
): CelebrationCountdown {
  if (celebration.dateType === 'fixed') {
    const days = isValidNameDay(celebration.date) ? daysUntilNameDay(String(celebration.date), today) : null;
    return { days, needsResolution: false };
  }

  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const thisYear = celebrationDateInYear(celebration, t0.getFullYear());
  if (thisYear.date) {
    const occurrence = parseIsoDate(thisYear.date)!;
    const days = Math.round((occurrence.getTime() - t0.getTime()) / 86400000);
    if (days >= 0) return { days, needsResolution: false };

    const nextYear = celebrationDateInYear(celebration, t0.getFullYear() + 1);
    if (nextYear.date) {
      const next = parseIsoDate(nextYear.date)!;
      return { days: Math.round((next.getTime() - t0.getTime()) / 86400000), needsResolution: false };
    }
    return { days: null, needsResolution: true };
  }

  // This year unresolved. A cached NEXT-year date is still a real occurrence
  // worth counting down to — the alternative was throwing a known date away
  // and reporting nothing. needsResolution stays true because the current
  // year may hold a sooner occurrence; once it resolves, the countdown snaps
  // to whichever comes first.
  if (thisYear.needsResolution) {
    const nextYear = celebrationDateInYear(celebration, t0.getFullYear() + 1);
    if (nextYear.date) {
      const next = parseIsoDate(nextYear.date)!;
      return { days: Math.round((next.getTime() - t0.getTime()) / 86400000), needsResolution: true };
    }
  }
  return { days: null, needsResolution: thisYear.needsResolution };
}

export interface LocalSuggestion {
  /** Steps 1–3 of the hierarchy. Steps 4–5 never come from the local table. */
  matchType: 'exact' | 'variant' | 'second_name';
  /** The token from the member's name (or nickname) that matched. */
  token: string;
  /** The catalogued name the token maps to — 'Maria' for a 'Mia'. The UI
   *  needs this to explain a variant or alias match honestly. */
  matchedName: string;
  /** True when the token reached the catalogue through the alias table rather
   *  than being a catalogued name itself. Always true for 'variant'; for
   *  'second_name' it says whether the LATER token itself needed an alias. */
  viaAlias: boolean;
  /** True when the matching token was the nickname, not a given name. */
  viaNickname: boolean;
  date: string;   // 'MM-DD'
  feast: string;
  alsoOn?: { date: string; feast: string };
  kind: 'name_day';
  tradition: 'Austrian Namenskalender';
  explanation: string;
}

/**
 * The local table's suggestion — hierarchy steps 1–3, labelled.
 *
 *   1. exact — the FIRST given-name token is a catalogued name itself.
 *   2. variant — the first token matched only through the alias table, or the
 *      nickname matched (a nickname is offered as a variant even when it is a
 *      catalogued name itself: it is not the registered first name, so the
 *      family must confirm the connection — the conservative direction).
 *   3. second_name — a LATER given-name token matched. Never presented as the
 *      first name's day; `token` says which name it actually belongs to.
 *
 * Given-name tokens are tried before the nickname, matching suggestNameDay's
 * order — the passport name outranks what the fridge magnet says.
 *
 * Returns null when there is nothing honest to suggest: no match (the
 * ordinary case for most of the world's names), the family already dismissed
 * the question, the member already has an answer (stored nameDay or any
 * confirmed celebration), or religious suggestions are suppressed — the
 * Namenskalender is a church calendar, so every suggestion it produces is a
 * religious suggestion.
 */
export function suggestLocal(
  member: CelebrationsMember,
  opts?: { suppressReligiousSuggestions?: boolean },
): LocalSuggestion | null {
  if (member.nameCelebrationDismissed) return null;
  if (opts?.suppressReligiousSuggestions) return null;
  if (member.nameDay && isValidNameDay(member.nameDay)) return null;
  if ((member.nameCelebrations ?? []).some((c) => c.confirmed)) return null;

  const tokens = splitNameTokens(member.name);
  const firstName = tokens[0];

  const build = (
    token: string,
    hit: NonNullable<ReturnType<typeof lookupTokenDetailed>>,
    matchType: LocalSuggestion['matchType'],
    viaNickname: boolean,
  ): LocalSuggestion => {
    const when = `${hit.feast} (${formatNameDay(hit.date)})`;
    let explanation: string;
    if (matchType === 'exact') {
      explanation = `${hit.matched} is in the Austrian Namenskalender: ${when}.`;
    } else if (matchType === 'variant') {
      explanation = viaNickname
        ? `The nickname ${token} is a recognised form of ${hit.matched}, kept on ${when}.`
        : `${token} is a recognised form of ${hit.matched}, kept on ${when}.`;
    } else {
      // "Second name" is the spec's own word for any later given name.
      const via = hit.viaAlias ? `, a form of ${hit.matched},` : '';
      explanation = `${firstName} has no day of its own in the Austrian Namenskalender. The second name ${token}${via} is kept on ${when}.`;
    }
    return {
      matchType,
      token,
      matchedName: hit.matched,
      viaAlias: hit.viaAlias,
      viaNickname,
      date: hit.date,
      feast: hit.feast,
      alsoOn: hit.alsoOn,
      kind: 'name_day',
      tradition: 'Austrian Namenskalender',
      explanation,
    };
  };

  // Step 1 / 2: the first given name, exact or through an alias.
  if (firstName) {
    const hit = lookupTokenDetailed(firstName);
    if (hit) return build(firstName, hit, hit.viaAlias ? 'variant' : 'exact', false);
  }

  // Step 3: later given names — Rory Michael finds Michael here, and the
  // result says so instead of pretending Rory has a day.
  for (const token of tokens.slice(1)) {
    const hit = lookupTokenDetailed(token);
    if (hit) return build(token, hit, 'second_name', false);
  }

  // Nickname last, as in suggestNameDay: a Mia recorded only as a nickname
  // still finds Maria, but never ahead of what the given names say.
  for (const token of splitNameTokens(member.nickname)) {
    const hit = lookupTokenDetailed(token);
    if (hit) return build(token, hit, 'variant', true);
  }

  return null;
}
