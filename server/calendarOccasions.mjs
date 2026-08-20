// Derived family occasions for the PUBLISHED feed — birthdays, extended
// birthdays and anniversaries, expressed as yearly rules.
//
// WHY THIS EXISTS. calendarPublish.mjs serves the events a family filed. But
// birthdays are not filed: they are read off the member record every time the
// app draws a calendar (see src/utils/familyDates.ts, and virtualEvents.ts for
// the same projection on the client). So a family who subscribed their phone to
// the Teluva feed got every dentist appointment and not one birthday — the same
// gap the month grid had before v225.
//
// WHY IT IS A SEPARATE FILE FROM calendarPublish.mjs. That module is
// deliberately narrow: "the feed carries ONLY calendar events — never members,
// documents, medical records, IDs". This one reaches into member records, so it
// is the piece that widens what a leaked feed URL can reveal, and it should be
// obvious in the file list that it exists. Two rules keep that widening honest,
// both enforced by the caller in server.js:
//   * occasions are OPT-IN per published link (`includeOccasions`), so a link
//     shared before this feature existed keeps serving exactly what its owner
//     agreed to share. Silently adding a child's year of birth to a URL that is
//     already in someone else's calendar app is not a thing to do.
//   * never in 'busy' mode. Busy mode exists so a link can go to someone
//     outside the family without saying why a slot is taken; a feed full of
//     "Lena's birthday" would defeat it in one line.
//
// WHAT IS NOT HERE: name days. Resolving those correctly needs the whole
// name-celebration model — the legacy nameDay/nameDayFeast migration, the
// primary/opted-in flags, and the cron's per-year cache for movable rules
// (src/utils/nameCelebrations.ts's resolveCelebrations). The daily-celebrations
// cron in server.js already carries a partial second copy of that logic; a
// third one here is how three surfaces end up disagreeing about which day a
// family keeps. Name days DO reach the .ics download, which runs on the client
// and uses the real model. Until resolveCelebrations is shared rather than
// re-derived, the feed is honestly one division short.
//
// Pure functions only — no firebase-admin import — so this is `node --test`able
// without credentials or network, same as calendarPublish.mjs.

/** Gregorian leap year. Mirrors src/utils/nameDay.ts's isLeapYear. */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A real 'MM-DD' slot. Probed against 2000, a leap year, so 02-29 passes. */
function isMonthDay(value) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const probe = new Date(Date.UTC(2000, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * DTSTART for a recurring slot.
 *
 * A 29 February series must anchor on a year that HAS a 29 February, or the
 * rule describes a different day from the record. What happens in ordinary
 * years is the recurrence rule's job (see yearlyRrule in calendarPublish.mjs),
 * not the anchor's.
 */
export function anchorIso(monthDay, preferredYear) {
  if (!isMonthDay(monthDay)) return null;
  if (!Number.isInteger(preferredYear) || preferredYear < 1000 || preferredYear > 9999) return null;
  let year = preferredYear;
  if (monthDay === '02-29') while (!isLeapYear(year)) year -= 1;
  return `${year}-${monthDay}`;
}

/** 'YYYY-MM-DD' → { monthDay, year }, or null. */
function splitBirthdate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m || !isMonthDay(`${m[2]}-${m[3]}`)) return null;
  return { monthDay: `${m[2]}-${m[3]}`, year: Number(m[1]) };
}

function describe(...parts) {
  const kept = parts.filter((p) => typeof p === 'string' && p.trim());
  return kept.length ? kept.join(' · ') : '';
}

/** An optional origin year, or null. Rejects anything that isn't a real year. */
function originYear(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1000 && n <= 9999 ? n : null;
}

/**
 * Build the occasion series for one family.
 *
 * `members` are the raw families/{id}/family_members docs — living people only.
 * The deceased live in the separate `inMemory` reference doc and are never read
 * here, the same guarantee the celebrations cron makes.
 *
 * `now` only decides the anchor year for occasions that have no origin year of
 * their own; it never limits which occasions are returned. A series has no end.
 */
export function buildFeedOccasions(sources = {}, now = new Date()) {
  const thisYear = now.getFullYear();
  const out = [];

  for (const member of Array.isArray(sources.members) ? sources.members : []) {
    if (!member || typeof member !== 'object') continue;
    const born = splitBirthdate(member.birthdate);
    if (!born) continue;
    const date = anchorIso(born.monthDay, born.year);
    if (!date) continue;
    const name = String(member.name || '').trim();
    if (!name) continue;
    out.push({
      id: `virtual-birthday-${member.id}`,
      title: `${name}'s birthday`,
      date,
      repeat: 'yearly',
      description: describe(`Born ${born.year}`, 'From Teluva'),
      category: 'Birthday',
    });
  }

  for (const eb of Array.isArray(sources.extendedBirthdays) ? sources.extendedBirthdays : []) {
    if (!eb || typeof eb !== 'object') continue;
    const year = originYear(eb.originalYear);
    const date = anchorIso(eb.date, year ?? thisYear);
    if (!date) continue;
    const name = String(eb.name || '').trim();
    if (!name) continue;
    out.push({
      id: `virtual-extendedBirthday-${eb.id}`,
      title: `${name}'s birthday`,
      date,
      repeat: 'yearly',
      description: describe(eb.relationship, year == null ? '' : `Born ${year}`, 'From Teluva'),
      category: 'Birthday',
    });
  }

  for (const a of Array.isArray(sources.anniversaries) ? sources.anniversaries : []) {
    if (!a || typeof a !== 'object') continue;
    const year = originYear(a.originalYear);
    const date = anchorIso(a.date, year ?? thisYear);
    if (!date) continue;
    const title = String(a.title || '').trim();
    if (!title) continue;
    out.push({
      id: `virtual-anniversary-${a.id}`,
      title,
      date,
      repeat: 'yearly',
      description: describe(year == null ? '' : `Since ${year}`, 'From Teluva'),
      category: 'Anniversary',
    });
  }

  // Sorted by the day of the year, so the feed's occasion block reads as a
  // calendar rather than as whatever order Firestore handed the documents back.
  return out
    .filter((o) => /^virtual-[A-Za-z0-9._-]+$/.test(o.id))
    .sort((x, y) => x.date.slice(5).localeCompare(y.date.slice(5)) || x.title.localeCompare(y.title));
}

/**
 * Which divisions the family has switched OFF in their calendar settings.
 * The feed honours the same toggles as the app's own calendar — a birthday
 * hidden in Teluva must not reappear on somebody's phone.
 */
export function applyDivisionSettings(sources, divisions) {
  const on = (key) => !divisions || divisions[key] !== false;
  return {
    members: on('birthdays') ? sources.members : [],
    extendedBirthdays: on('extendedBirthdays') ? sources.extendedBirthdays : [],
    anniversaries: on('anniversaries') ? sources.anniversaries : [],
  };
}
