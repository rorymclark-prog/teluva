// The staff directory: the small, deliberately boring slice of a colleague's
// record that everybody in a business space may see.
//
// Dependency-free (no firebase-admin) so it can be `node --test`ed directly,
// exactly like willsRelease.mjs and willsInvite.mjs next door. server.js does
// the Firestore reads around it.
//
// WHY THIS EXISTS
//
// v330 made a colleague's record an HR file: in a business space,
// firestore.rules lets an employee read their own record and nobody else's.
// That is the right boundary and it left the team list holding one person —
// which is not a directory, it is a bug that happens to be safe.
//
// The fix is NOT to loosen the rule. It is to answer a different, much smaller
// question — "who works here and how do I reach them at work?" — from the
// server, with a projection the client cannot widen.
//
// THE ALLOWLIST IS THE BOUNDARY.
//
// Read that before adding a field. This is a pick, never an omit: a denylist
// would leak every field added to FamilyMember after the day it was written,
// and FamilyMember grows constantly. If a field is not named below it does not
// leave the server, whatever it is called and whenever it was added.
//
// WHAT IS DELIBERATELY NOT HERE, and why:
//
//   phone, email, address   PERSONAL contact. workPhone/workAddress are the
//                           work-facing equivalents and are included instead.
//   birthdate               A colleague-visible birthday is lawful in Austria
//                           on Art. 6(1)(a) CONSENT, not legitimate interest,
//                           and then day+month only — never the year, which is
//                           an age-discrimination datapoint. There is no
//                           consent store yet, so there is no birthday here.
//   avatarUrl               A face photo is a bigger disclosure than a phone
//                           extension and belongs behind the same consent.
//                           avatarColor is included so the initials tile still
//                           looks like the rest of the app.
//   medical, identifiers, identity, taxNumber, financialAccounts, cv,
//   documents, employeePreferences, …
//                           The HR file. The whole point of v330.
//
//   startDate               REMOVED in v333, and the reason is worth keeping.
//                           It was included on the claim that "the
//                           celebrations cron already announces work
//                           anniversaries to the whole team". THAT WAS FALSE.
//                           The cron sends birthdays, name days and the
//                           business's own founding date; work anniversaries
//                           are computed CLIENT-SIDE in NeedsAttention from
//                           the member list, which since v330 holds only the
//                           people this account may read. So an employee's
//                           start date was not already public — the directory
//                           would have been the thing that published it, on a
//                           justification that was checked afterwards instead
//                           of before. A start date is also not work contact,
//                           which is what this screen tells people it shows.
export const DIRECTORY_FIELDS = [
  'id',
  'name',
  'role',        // the business title label — Owner/Manager/Employee/…
  'jobTitle',
  'workPhone',
  'workAddress',
  'employer',
  'avatarColor',
];

/** One member document → the directory card, and nothing else. */
export function projectDirectoryEntry(member) {
  if (!member || typeof member !== 'object') return null;
  const out = {};
  for (const key of DIRECTORY_FIELDS) {
    const v = member[key];
    // Only plain strings survive. A field that arrived as an object or an
    // array is not a directory line, and copying it through would be exactly
    // the accident the allowlist exists to prevent — a future `jobTitle` that
    // becomes { current, history } would otherwise carry the history with it.
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 200);
  }
  // A card with no name is not a person, it is a hole in the list.
  return out.name ? out : null;
}

/** The whole directory, in a stable order the client does not have to sort. */
export function buildDirectory(members) {
  const list = Array.isArray(members) ? members : [];
  return list
    .map(projectDirectoryEntry)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}
