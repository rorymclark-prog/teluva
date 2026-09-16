// The nightly reminder digest: what has a deadline, and WHO is allowed to be
// told about it.
//
// Dependency-free (no firebase-admin) so it can be `node --test`ed directly,
// exactly like directory.mjs and willsRelease.mjs next door. server.js does
// the Firestore reads around it.
//
// WHY THIS IS ITS OWN FILE
//
// Until v337 these functions lived inline in server.js and the digest was a
// single `sendToFamily`. In a household that is right — the whole point is
// that everyone hears the passport is about to lapse. In a BUSINESS space the
// same push read:
//
//     "Katharina Moser's Austrian passport expires in 7 days"
//
// to every phone in the company. Every label built by memberDeadlines() names
// a person and states a fact off their HR file: a passport, a residence
// permit, a medical check-up, a lapsing certificate. v330 made that record
// admin-only in firestore.rules and v333 routed personal CELEBRATIONS through
// sendToAdmins for the same reason — the deadline digest was simply missed,
// and it is the more sensitive of the two (a birthday is a date; a residence
// permit is immigration status, and a check-up is health data under Art. 9).
//
// So every item now carries `personal`. splitDigests() is the whole boundary:
// in a business space the personal half goes to admins and the shared half
// (tomorrow's calendar) goes to everyone; a family space still gets exactly
// one digest containing both, unchanged.
//
// THE TAGS MUST DIFFER. A notification `tag` is a REPLACEMENT KEY. Sending
// both halves of a business digest under `reminders-MM-DD` would leave one
// surviving notification on the phone, silently overwriting the other — the
// same trap the celebrations loop hit with two people born on the same day.

/* The rungs at which a deadline is worth a push. Not a countdown: 90 days is
 * "book the appointment", 30 is "do it now", 7 and 0 are the last calls.
 * Anything between two rungs sends nothing, so a family with one expiring
 * passport hears about it four times over three months, not ninety. */
export const EXPIRY_THRESHOLDS = [90, 30, 7, 0];

// Whole days from today (Vienna) until an ISO date. Negative = already past.
export function daysUntil(dateStr, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((then - today) / 86400000);
}

export const dueWord = (d) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);

/* Everything with a deadline attached to a person. Returns
 * [{label, days, personal: true}].
 *
 * `personal` is true for EVERY item this function can return, and that is not
 * an accident of the current list — it is the contract. Each label opens with
 * a person's name and discloses something off their file. If a deadline is
 * ever added here that is NOT about a person (a company licence, say), it does
 * not belong in this function; put it beside tomorrowsEvents() instead, or the
 * business boundary quietly widens by one field. */
export function memberDeadlines(mem, today) {
  const out = [];
  const name = String(mem.name || 'Someone').trim();
  const add = (dateStr, label) => {
    const d = daysUntil(dateStr, today);
    if (d !== null && EXPIRY_THRESHOLDS.includes(d)) out.push({ label, days: d, personal: true });
  };

  for (const p of mem.passports || []) {
    add(p.expiryDate, `${name}'s ${p.country || ''} passport expires ${dueWord(daysUntil(p.expiryDate, today))}`.replace(/\s+/g, ' '));
  }
  // Residence permits are the highest-stakes of the lot: letting one lapse has
  // consequences a renewed passport does not.
  for (const v of (mem.travel && mem.travel.visas) || []) {
    add(v.expiryDate, `${name}'s ${v.permitType || 'permit'} for ${v.country || ''} expires ${dueWord(daysUntil(v.expiryDate, today))}`.replace(/\s+/g, ' '));
  }
  for (const c of mem.careSchedule || []) {
    add(c.nextDue, `${name}'s ${String(c.kind || 'check-up').toLowerCase()} is due ${dueWord(daysUntil(c.nextDue, today))}`);
  }
  /* Certificates and licences off the CV tab. The tab has recorded an expiry
   * date and drawn an "Expires soon" chip since it shipped, and the AI prompt
   * offers to remind you — but nothing ever sent. A first-aid certificate or a
   * forklift licence lapsing is the single most business-shaped deadline in
   * the app, and it was the one thing the nightly job did not look at. */
  for (const q of (mem.cv && mem.cv.qualifications) || []) {
    add(q.expiryDate, `${name}'s ${String(q.name || 'certificate').trim()} expires ${dueWord(daysUntil(q.expiryDate, today))}`);
  }
  return out;
}

/* Calendar entries for tomorrow only. "Anniversaries and doctors appointments"
 * in the owner's words — but the night before, which is when a reminder can
 * still change what you do. Same-day is handled by the celebrations pass.
 *
 * Shared, not personal: a calendar entry is something the space put on a
 * shared calendar on purpose. Whoever wrote it chose who could see it. */
export function tomorrowsEvents(events, today) {
  return events
    .filter((e) => daysUntil(e.date, today) === 1)
    .map((e) => ({ label: `Tomorrow: ${String(e.title || 'an event').trim()}`, days: 1, personal: false }));
}

/* Two lines at most: a notification nobody can read at a glance is ignored,
 * and the app is one tap away for the rest. Most urgent first, so the
 * truncated body still leads with what matters. */
export function digestText(items) {
  const due = [...items].sort((a, b) => a.days - b.days);
  return {
    title: due.length === 1 ? 'Teluva reminder' : `${due.length} things need attention`,
    body: due.slice(0, 2).map((d) => d.label).join('\n')
      + (due.length > 2 ? `\n…and ${due.length - 2} more` : ''),
  };
}

/* WHO HEARS WHAT. Returns [{audience, items, tagSuffix}] — server.js maps
 * 'admins'/'everyone' onto sendToAdmins/sendToFamily and stamps the date onto
 * the tag. Empty groups are dropped so nobody gets a digest of nothing.
 *
 * A family space gets ONE group of everything, exactly as before v337: no
 * household is served by hiding a child's check-up from a parent, and the
 * personal flag is simply not consulted. */
export function splitDigests(items, { isBusiness }) {
  if (!isBusiness) return items.length ? [{ audience: 'everyone', items, tagSuffix: '' }] : [];
  const personal = items.filter((i) => i.personal);
  const shared = items.filter((i) => !i.personal);
  const out = [];
  if (personal.length) out.push({ audience: 'admins', items: personal, tagSuffix: '-hr' });
  if (shared.length) out.push({ audience: 'everyone', items: shared, tagSuffix: '' });
  return out;
}
