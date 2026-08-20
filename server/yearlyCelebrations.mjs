// The yearly family dates the daily-celebrations cron did not know about.
//
// WHAT WAS WRONG. runDailyCelebrations() read exactly three places:
// families/{id}/family_members (birthdays + name celebrations),
// families/{id}/info/info (a business's founding date) and
// families/{id}/calendar_events (deadline reminders). Three other stores of
// recurring family dates were never opened, so none of them ever produced a
// notification:
//   * families/{id}/reference/extendedBirthdays — grandparents, aunts,
//     godparents, close friends. Shown on the Family Calendar, exported to
//     .ics since v226, never pushed.
//   * families/{id}/reference/anniversaries — wedding anniversaries,
//     Valentine's Day, any yearly date the family keeps. Same story.
//   * families/{id}/reference/info's `contacts` — a ContactEntry may carry a
//     birthdate, and that is where the ASSISTANT files a non-family birthday.
//     Its own system prompt promises the family that doing so means the date
//     "gets an ongoing yearly nudge like a family member's birthday does — not
//     just a single reminder". It reached NeedsAttention and OnThisDay inside
//     the app, and nothing else. The promise was never kept.
//
// NOTE the two different "info"s, which is the trap this area sets:
// families/{id}/info/info is FamilyInfoDoc (the space's name, admin, type,
// founding date) while families/{id}/reference/info is FamilyInfo (numbers,
// CONTACTS, providers, vendors). The cron read the first and needed the second.
//
// NO OPT-OUT IS INVENTED HERE. HubSettings.calendarDivisions decides which
// PANELS appear on the Family Calendar screen, and the cron has never consulted
// it — a family with `calendarDivisions.birthdays: false` still gets member
// birthday notifications today. Reading it here would silently give a display
// toggle a second, invisible job, and would make these three sources behave
// differently from the birthdays already being sent. The only opt-out the cron
// honours is the per-celebration `notify` flag on a NameCelebration, which
// these records do not have.
//
// DECEASED EXCLUSION IS PRESERVED. Nothing here reads reference/inMemory, which
// is where departed relatives live — see the guarantee stated above
// runDailyCelebrations in server.js.
//
// Pure functions only — no firebase-admin import — so this is `node --test`able
// without credentials or network, same as calendarPublish.mjs.

/** Gregorian leap year. */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/*
 * 29 FEBRUARY, stated once for both shapes below.
 *
 * Three years in four that date does not exist. Teluva's convention everywhere
 * — the calendar grid, the .ics export, nameDay.ts's nameDayOccurrenceInYear —
 * is that a 29 February slot falls back to 28 February in an ordinary year,
 * rather than rolling forward into March. The cron must agree, or somebody born
 * on a leap day is wished a happy birthday by the app and not by their phone.
 */

/** Does a full 'YYYY-MM-DD' fall on this month/day, ignoring its year? */
export function matchesMonthDay(dateStr, month, day, year) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return false;
  return monthDayFallsOn(`${m[2]}-${m[3]}`, month, day, year);
}

/** Does a year-less 'MM-DD' slot fall on this month/day? */
export function monthDayFallsOn(monthDay, month, day, year) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(monthDay || '').trim());
  if (!m) return false;
  const storedMonth = Number(m[1]);
  const storedDay = Number(m[2]);
  if (storedMonth === month && storedDay === day) return true;
  return storedMonth === 2 && storedDay === 29
    && month === 2 && day === 28
    && Number.isFinite(year) && !isLeapYear(year);
}

/** The year a full 'YYYY-MM-DD' names, or null. */
function yearOf(dateStr) {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(dateStr || '').trim());
  return m ? Number(m[1]) : null;
}

/** An optional origin year, ignoring anything that isn't a real one. */
function originYear(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1000 && n <= 9999 ? n : null;
}

const clean = (v, max = 80) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * The count on TODAY's occurrence.
 *
 * `year` is today's year, so this works unchanged on the 28 February fallback:
 * the occurrence is still this year's, only moved a day. Returns null when
 * there is no origin year to count from — never a guess, and never a zero
 * standing in for "unknown".
 */
function countThisYear(origin, year) {
  if (origin == null || !Number.isFinite(year)) return null;
  const n = year - origin;
  return n > 0 ? n : null;
}

// A static map, not a lookup built from the kind string — an unknown kind must
// fall back to something sensible rather than produce an empty title.
const ANNIVERSARY_EMOJI = {
  Wedding: '💞',
  Engagement: '💍',
  Adoption: '🧡',
};

/** Name + month-day, for spotting the same person recorded in two places. */
function personKey(name, monthDay) {
  return `${clean(name).toLowerCase()}|${monthDay}`;
}

/**
 * Every extended birthday, anniversary and contact birthday falling today.
 *
 * Returns the same `{ key, title, body }` shape the cron already collects, so
 * the caller's tag discipline applies unchanged: `key` identifies THE
 * CELEBRATION, never the date, so two people sharing a day survive as two
 * notifications rather than one silently replacing the other.
 */
export function buildYearlyCelebrations(sources = {}, today = {}) {
  const { month, day, year } = today;
  if (!Number.isFinite(month) || !Number.isFinite(day)) return [];

  const out = [];
  // Filled from the dedicated records first, then used to suppress a contact
  // that is the same person. The assistant files "Granny's birthday" as a
  // contact while the Extended Birthdays screen writes its own record, so a
  // family who has done both would otherwise be told twice on the same morning.
  const seen = new Set();

  for (const eb of Array.isArray(sources.extendedBirthdays) ? sources.extendedBirthdays : []) {
    if (!eb || typeof eb !== 'object') continue;
    const name = clean(eb.name);
    const monthDay = clean(eb.date, 5);
    if (!name || !eb.id) continue;
    if (!monthDayFallsOn(monthDay, month, day, year)) continue;
    seen.add(personKey(name, monthDay));

    const age = countThisYear(originYear(eb.originalYear), year);
    const relationship = clean(eb.relationship, 40);
    const sentence = age == null
      ? `Wish ${name} a happy birthday today.`
      : `${name} turns ${age} today.`;
    out.push({
      key: `extbday-${eb.id}`,
      title: `🎂 It's ${name}'s birthday!`,
      // Relationship first, separated rather than possessive: "your family
      // friend" is what a possessive would produce from this free-text field.
      body: relationship ? `${relationship} · ${sentence}` : sentence,
    });
  }

  for (const a of Array.isArray(sources.anniversaries) ? sources.anniversaries : []) {
    if (!a || typeof a !== 'object') continue;
    const title = clean(a.title, 100);
    if (!title || !a.id) continue;
    if (!monthDayFallsOn(clean(a.date, 5), month, day, year)) continue;

    const years = countThisYear(originYear(a.originalYear), year);
    const notes = clean(a.notes, 120);
    const body = years != null
      ? `${years} ${years === 1 ? 'year' : 'years'} today.`
      : (notes || `Today is ${title}.`);
    out.push({
      // 'annivrec-', not 'anniversary' — that bare key belongs to the business
      // founding date already in this run, and a collision would mean one of
      // the two notifications replacing the other.
      key: `annivrec-${a.id}`,
      title: `${ANNIVERSARY_EMOJI[a.kind] || '🎉'} ${title}`,
      body,
    });
  }

  for (const c of Array.isArray(sources.contacts) ? sources.contacts : []) {
    if (!c || typeof c !== 'object') continue;
    const name = clean(c.name);
    if (!name || !c.id) continue;
    if (!matchesMonthDay(c.birthdate, month, day, year)) continue;
    const monthDay = clean(c.birthdate).slice(5);
    if (seen.has(personKey(name, monthDay))) continue;

    const age = countThisYear(yearOf(c.birthdate), year);
    const relation = clean(c.relation, 40);
    const sentence = age == null
      ? `Wish ${name} a happy birthday today.`
      : `${name} turns ${age} today.`;
    out.push({
      key: `contactbday-${c.id}`,
      title: `🎂 It's ${name}'s birthday!`,
      body: relation ? `${relation} · ${sentence}` : sentence,
    });
  }

  return out;
}
