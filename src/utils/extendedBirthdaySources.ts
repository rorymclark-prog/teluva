import type { ContactEntry, ExtendedBirthday } from '../types';

/*
 * One list of "birthdays we keep for people who aren't family members".
 *
 * THE SPLIT-BRAIN THIS CLOSES. Teluva grew two homes for the same fact:
 *
 *   ContactEntry.birthdate       (families/{id}/reference/info → contacts[])
 *   ExtendedBirthday             (families/{id}/reference/extendedBirthdays)
 *
 * ContactEntry.birthdate came first, and its own comment describes exactly
 * what ExtendedBirthday was later built to do — "lets a contact who isn't a
 * full family member (a grandparent, godparent, etc.) still get a birthday
 * nudge". The successor arrived; nobody retired the predecessor. So the two
 * had wildly different reach for identical data: an ExtendedBirthday shows on
 * the calendar grid, exports to .ics and rides the published feed, while a
 * contact's birthday reached NeedsAttention and OnThisDay and stopped dead.
 * And the ASSISTANT was pointed at the weaker one — its system prompt promised
 * "an ongoing yearly nudge like a family member's birthday does" for a birthday
 * filed as a contact, which meant an AI-filed "Granny's birthday" never reached
 * the family's calendar at all.
 *
 * From v228 the assistant writes ExtendedBirthday (the `extended_birthday`
 * edit kind), the contact form no longer offers a birthday field, and existing
 * contact birthdays have been migrated across (scripts/migrate-contact-birthdays.mjs).
 *
 * THIS FUNCTION IS THE SAFETY NET, not the main path. Two things still produce
 * a contact birthday after all that: a family whose migration hasn't run, and
 * a phone running a cached older build of the PWA — which in this app is
 * measured in days, not minutes. Rather than let those quietly become
 * second-class again, every surface reads through here, so a contact birthday
 * behaves identically to a real one wherever it still exists.
 */

/** Name + month-day, for spotting the same person recorded in both homes. */
function personKey(name: string, monthDay: string): string {
  return `${name.trim().toLowerCase()}|${monthDay}`;
}

/**
 * Extended birthdays, plus any contact birthday not already recorded as one.
 *
 * A dedicated `ExtendedBirthday` always wins: it is the richer record (it can
 * carry a relationship and notes) and it is the one the family can edit.
 * Matching is by name + day, which is deliberately conservative — two people
 * genuinely sharing a name AND a birthday is rarer than the same person
 * written down twice, and the cost of being wrong is one duplicate row rather
 * than a birthday that vanishes.
 */
export function withContactBirthdays(
  extendedBirthdays: readonly ExtendedBirthday[],
  contacts: readonly ContactEntry[] = [],
): ExtendedBirthday[] {
  const out = [...extendedBirthdays];
  const seen = new Set(out.map((eb) => personKey(eb.name || '', eb.date || '')));

  for (const c of contacts) {
    if (!c || !c.id || !c.birthdate) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(c.birthdate).trim());
    if (!m) continue;
    const name = (c.name || '').trim();
    if (!name) continue;

    const monthDay = `${m[2]}-${m[3]}`;
    const key = personKey(name, monthDay);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      /* 'contact-' prefixed so the origin stays legible downstream — this id
       * becomes part of the .ics UID, and a subscriber's calendar matches on
       * UID alone. Migrating this person later moves them onto their real
       * ExtendedBirthday id, which reads to a subscribed calendar as a delete
       * and a re-add of the same birthday. Harmless once, and only for records
       * the migration hasn't reached yet. */
      id: `contact-${c.id}`,
      name,
      relationship: c.relation?.trim() || undefined,
      date: monthDay,
      // A contact birthdate is always a full date, so the year is always known.
      originalYear: Number(m[1]),
      notes: c.note?.trim() || undefined,
      createdAt: '',
    });
  }

  return out;
}

/** Did this entry come from a contact rather than the Extended Birthdays list? */
export const isFromContact = (eb: { id: string }) => eb.id.startsWith('contact-');
