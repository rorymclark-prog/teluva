import { CalendarEvent, FamilyMember } from '../types';

// Working out WHO a calendar event is actually for.
//
// THE PROBLEM
// -----------
// "I have an appointment for Ganga in my calendar but nothing shows up under
// Ganga for check-ups or appointments."
//
// The event was real, on the right day, titled "Ganga – Orthodontist (Dr Lena
// Hofer-Mayr)". It showed as "All family" because it arrived from a Google
// Calendar import, and the importer sets `memberIds: []` on every single event
// — Google has no idea who lives in this house. A person's Medical and
// Check-ups screens read appointments tagged to them, so an untagged one lands
// on the calendar and appears on nobody's profile.
//
// Asking the user to tag them by hand is not a fix. Children are the people
// most of these appointments are FOR and the least likely to be keeping their
// own calendar, so a parent's calendar is where a child's whole medical life
// lives, untagged, hundreds of entries deep.
//
// WHAT THIS DOES
// --------------
// If nobody is explicitly tagged, read the title: a title that names a family
// member is about that family member. That is not a guess about the world, it
// is how people already write calendar entries for someone else.
//
// Explicit tags always win. This only ever fills a vacuum, so a user who tags
// an event by hand is never overruled by a name that happens to be in the
// title.
//
// WHY TITLE ONLY, NOT THE DESCRIPTION
// -----------------------------------
// A description is where the incidental mentions live — "drop Ganga at school
// first", "ask about Vita's referral". Those name a person the appointment is
// not for. The title is the one place where naming someone reliably means the
// entry belongs to them.

/** Lowercase and strip accents, so "Zoë" and "Zoe" are the same person. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Escape a name for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Names that are also ordinary calendar words. "May" would otherwise claim
// every "May half term", and "June" every "June exams". For these, a bare
// mention is not enough — see the attribution patterns in titleNamesPerson.
const AMBIGUOUS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'summer', 'winter', 'spring', 'autumn', 'easter', 'noel',
]);

// A name this short matches too much to be trusted on its own — an initial, an
// abbreviation, a room number. Two-letter names exist; they need the explicit
// tag rather than a lucky substring.
const MIN_NAME_LENGTH = 3;

/**
 * Does `title` name this person in a way that says the entry is theirs?
 *
 * The plain case is a whole-word mention: "Ganga – Orthodontist", "Dentist for
 * Vita", "Nomvula swimming". Word boundaries do the real work here — they are
 * why "Vita" does not match "vitamin" and "Jo" would not match "John".
 *
 * For a name that doubles as a calendar word, the mention must additionally
 * look like an attribution: leading the title ("May – dentist"), possessive
 * ("May's dentist"), or introduced by for/with ("dentist for May").
 */
function titleNamesPerson(title: string, name: string): boolean {
  const n = normalize(name).trim();
  if (n.length < MIN_NAME_LENGTH) return false;
  const t = normalize(title);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'u');
  if (!re.test(t)) return false;

  if (!AMBIGUOUS.has(n)) return true;

  const e = escapeRe(n);
  return (
    new RegExp(`^\\s*${e}\\s*[-–—:,&]`, 'u').test(t) ||   // "May – dentist", "May & Vita: ..."
    new RegExp(`${e}'?s(?![\\p{L}\\p{N}])`, 'u').test(t) || // "May's dentist"
    new RegExp(`\\b(?:for|with)\\s+${e}(?![\\p{L}\\p{N}])`, 'u').test(t) // "dentist for May"
  );
}

/**
 * Every candidate name for one member: the full name and the first name.
 *
 * Both are tried because calendars are written either way — "Ganga" on a
 * family calendar, "Ganga Clark" on one shared with a school. Later parts of
 * the name are deliberately not tried on their own: a surname is shared by the
 * whole household, so matching it would tag a sibling's appointment to
 * everyone.
 */
function candidateNames(member: Pick<FamilyMember, 'name'>): string[] {
  const full = (member.name || '').trim();
  if (!full) return [];
  const first = full.split(/\s+/)[0];
  return full === first ? [full] : [full, first];
}

/**
 * Who this event is for.
 *
 * `explicit` is true when the answer came from the event's own memberIds, and
 * false when it was read out of the title. Callers show that difference rather
 * than hiding it — an inferred tag is a helpful guess, and the user should be
 * able to see it is one and correct it.
 *
 * Returns an empty list, with `explicit: true`, for an event that genuinely
 * belongs to the whole family. There is nothing to infer and nothing to flag.
 */
export function resolveEventMembers(
  ev: Pick<CalendarEvent, 'title' | 'memberIds'>,
  members: readonly Pick<FamilyMember, 'id' | 'name'>[],
): { memberIds: string[]; explicit: boolean } {
  const tagged = ev.memberIds || [];
  if (tagged.length > 0) return { memberIds: [...tagged], explicit: true };

  const title = ev.title || '';
  if (!title.trim()) return { memberIds: [], explicit: true };

  const matched = members
    .filter((m) => candidateNames(m).some((n) => titleNamesPerson(title, n)))
    .map((m) => m.id);

  return matched.length > 0
    ? { memberIds: matched, explicit: false }
    : { memberIds: [], explicit: true };
}

/** Convenience for the one question most callers actually have. */
export function eventBelongsToMember(
  ev: Pick<CalendarEvent, 'title' | 'memberIds'>,
  memberId: string,
  members: readonly Pick<FamilyMember, 'id' | 'name'>[],
): boolean {
  return resolveEventMembers(ev, members).memberIds.includes(memberId);
}
