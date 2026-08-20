// The name-celebration merge, server side.
//
// WHY THIS FILE EXISTS. A member's celebrated day is not one field. It is the
// legacy nameDay/nameDayFeast pair, PLUS the nameCelebrations[] array that
// superseded it, PLUS the cron's per-year resolutions for movable rules which
// are cached in a sibling field (nameCelebrationResolvedDates) so a server
// write can never collide with a family member's own edit. Working out what a
// person actually celebrates means merging all three, and getting the legacy
// migration case right — which is the part that bites.
//
// src/utils/nameCelebrations.ts owns the canonical version and the client uses
// it everywhere. The published .ics feed runs on the server, cannot import a
// .ts module, and until now simply had no name days in it at all: subscribe
// your phone to the family feed and you got every birthday and not one
// Namenstag (calendarOccasions.mjs said so in its own header). This is that
// module ported, and pinned to it by src/utils/nameCelebrationsParity.test.ts
// — a fixture table run through BOTH implementations, asserting identical
// output. Change one without the other and that test fails.
//
// WHAT IS DELIBERATELY NOT SHARED WITH IT: the local Austrian suggestion table
// (suggestLocal). The server must never derive a name day from a name — see
// server.js above researchNameCelebrations, and nameDay.ts's first rule: NEVER
// INVENT A DAY. Only what the family actually stored is read here.
//
// STILL A SECOND COPY, KNOWINGLY: the daily-celebrations cron in server.js
// carries its own inline version of this merge. It is not collapsed into this
// module because the cron interleaves on-demand movable-rule resolution (with
// a per-run budget) into the same loop, and because its notify gate is
// deliberately stricter than the calendar's — it suppresses a legacy Namenstag
// that a confirmed same-date entry duplicates, where the calendar shows both.
// Folding those together is a change to a notification path and belongs in its
// own commit with its own fixtures, not as a side effect of fixing the feed.
//
// Pure functions only — no firebase-admin import — so this is `node --test`able
// without credentials or network, same as calendarPublish.mjs.

/** The synthesised entry's id. Mirrors LEGACY_NAME_DAY_ID in nameCelebrations.ts. */
export const LEGACY_NAME_DAY_ID = 'legacy-name-day';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A real 'MM-DD' slot. 29 February is legitimate — a name day is a slot in the
 * church calendar, and it lands on the 28th in ordinary years. Mirrors
 * isValidNameDay in src/utils/nameDay.ts.
 */
export function isValidNameDay(value) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return false;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= maxDay;
}

/** '03-19' → '19 March'. '' for anything malformed, never 'NaN undefined'. */
export function formatNameDay(value) {
  if (!isValidNameDay(value)) return '';
  const [m, d] = String(value).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Split a name into tokens on whitespace and dashes. Mirrors nameDay.ts. */
export function splitNameTokens(value) {
  return String(value || '').split(/[\s\-–]+/).filter(Boolean);
}

/**
 * Merge the legacy nameDay pair and nameCelebrations[] into one view.
 *
 * Returns { primary, additional, all }. Celebration surfaces read primary and
 * additional — both are confirmed. `all` includes unconfirmed proposals and is
 * for editing UIs only; nothing is celebrated until the family confirmed it.
 *
 * A faithful port of resolveCelebrations() in src/utils/nameCelebrations.ts,
 * including the two rules that are easy to get subtly wrong:
 *
 *   * the legacy entry is skipped ONLY when an explicit confirmed PRIMARY
 *     name_day stores the same fixed date — that entry IS the migrated
 *     Namenstag. A non-primary duplicate must not displace it, or the member
 *     would be left with no primary at all and their long-standing name day
 *     would vanish from every surface that reads `primary`.
 *   * the legacy entry only carries primary/notify while no explicit confirmed
 *     primary exists. Demoting it is how a family silences the Namenstag push
 *     without deleting the field.
 */
export function resolveCelebrations(member) {
  const m = member && typeof member === 'object' ? member : {};
  // Fold the cron's per-year resolutions back into each entry so every
  // consumer sees one complete resolvedDates cache. Confirm-time resolutions
  // stored on the celebration itself win: both are validated, but those are
  // what the family saw when they confirmed.
  const cronDates = m.nameCelebrationResolvedDates;
  const source = Array.isArray(m.nameCelebrations) ? m.nameCelebrations : [];
  const explicit = source.filter((c) => c && typeof c === 'object').map((c) => {
    const extra = cronDates && typeof cronDates === 'object' ? cronDates[c.id] : null;
    return extra && typeof extra === 'object'
      ? { ...c, resolvedDates: { ...extra, ...(c.resolvedDates ?? {}) } }
      : c;
  });
  const all = [];

  if (m.nameDay && isValidNameDay(m.nameDay)) {
    const explicitPrimary = explicit.some((c) => c.confirmed && c.primary);
    const alreadyMigrated = explicit.some(
      (c) => c.confirmed && c.primary && c.kind === 'name_day' && c.dateType === 'fixed' && c.date === m.nameDay,
    );
    if (!alreadyMigrated) {
      all.push({
        id: LEGACY_NAME_DAY_ID,
        kind: 'name_day',
        title: m.nameDayFeast || 'Name day',
        celebrationOf: splitNameTokens(m.name)[0] ?? m.nickname ?? '',
        matchType: 'exact',
        tradition: 'Austrian Namenskalender',
        explanation: m.nameDayFeast
          ? `The family keeps this day as the name day: ${m.nameDayFeast} (${formatNameDay(m.nameDay)}).`
          : `The family keeps ${formatNameDay(m.nameDay)} as the name day.`,
        dateType: 'fixed',
        date: m.nameDay,
        confirmed: true,
        primary: !explicitPrimary,
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

/**
 * The confirmed celebrations that should PUSH for this member today's run —
 * the cron's gate, lifted out of server.js so it is testable and so there is
 * one merge rather than two.
 *
 * Stricter than resolveCelebrations' primary/additional in one specific way,
 * and the difference is deliberate: a confirmed, notifying, fixed name_day on
 * the same date as the legacy Namenstag REPLACES it even when it is not the
 * member's primary. resolveCelebrations keeps both (the calendar shows both
 * rows, which is honest — they are two records of the same day), but two
 * notifications for one day is just congratulating a migrated member twice.
 *
 * Returns entries in merge order. The legacy Namenstag, when it survives,
 * carries id LEGACY_NAME_DAY_ID — server.js keys its notification off that,
 * because the Namenstag's wording predates nameCelebrations and stays as it is.
 */
export function notifiableCelebrations(member) {
  const { primary, additional } = resolveCelebrations(member);
  const confirmed = primary ? [primary, ...additional] : additional;
  const notifying = confirmed.filter((c) => c.notify);
  const legacy = notifying.find((c) => c.id === LEGACY_NAME_DAY_ID);
  if (!legacy) return notifying;
  const replaced = notifying.some(
    (c) => c.id !== LEGACY_NAME_DAY_ID && c.kind === 'name_day' && c.dateType === 'fixed' && c.date === legacy.date,
  );
  return replaced ? notifying.filter((c) => c.id !== LEGACY_NAME_DAY_ID) : notifying;
}

/**
 * Every confirmed MOVABLE celebration on this member — the ones whose date
 * only a model can work out, and which are therefore useless until the cron
 * has resolved a year for them.
 *
 * NOT filtered by notify, and that is the whole point. The cron used to skip
 * `notify: false` entries entirely, which quietly starved them: an "additional"
 * celebration a family chose to see but not be pinged about kept only the two
 * years resolved at confirm time, and then went dark — in the published feed,
 * in the app's countdown, everywhere — with no error anywhere. server.js still
 * spends its model budget on notifying entries FIRST and only lets these use
 * what is left above a reserve, so keeping them alive cannot cost a family a
 * birthday notification on a busy run.
 */
export function resolvableCelebrations(member) {
  const { primary, additional } = resolveCelebrations(member);
  const confirmed = primary ? [primary, ...additional] : additional;
  return confirmed.filter((c) => c.dateType === 'movable' && typeof c.movableRule === 'string' && c.movableRule);
}
