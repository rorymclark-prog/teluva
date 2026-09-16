// "Which person am I?" — the join the app never had.
//
// Teluva has always known what you are ALLOWED to do (FamilyRole on
// `users/{uid}`, enforced by firestore.rules) and never known WHO YOU ARE. No
// field on FamilyMember pointed at an auth uid; nothing matched a signed-in
// account to a profile record. The consequence was invisible but total: every
// screen in the app is whole-family, because a personalised one was not
// expressible. There is no "your trip", no "your documents" — only "the
// family's", which is the right default for a parent looking after everyone and
// the wrong one for a sixteen-year-old abroad who needs one specific folder.
//
// SECURITY BOUNDARY, stated once and meant literally: nothing in this file may
// ever be used to decide access. resolveMe() answers a cosmetic question — whose
// name goes in the greeting, whose trip is promoted to the top of Pulse. It is
// derived from client-writable data (FamilyMember.linkedUid, FamilyMember.email)
// and could therefore be pointed anywhere by anyone who can already write a
// member record. What that buys an attacker is a wrong greeting. Every real
// permission decision stays where it already is: FamilyRole for the client's
// affordances, firestore.rules for the actual answer. If you ever find yourself
// writing `if (isMe(...)) { allow ... }`, stop.

import type { FamilyMember } from '../types';

export type MeMatch = 'linked' | 'email' | 'none';

export interface MeResult {
  member: FamilyMember | null;
  /** How the match was made — 'email' is a heuristic, 'linked' is explicit. */
  via: MeMatch;
}

/**
 * Find the profile record belonging to the signed-in account.
 *
 * Two strategies, deliberately ordered:
 *
 * 1. `linkedUid` — explicit, set by an admin. Always wins.
 * 2. email — a fallback so this works on day one for families who signed up
 *    long before linkedUid existed, without a migration or an admin having to
 *    link every person by hand. It is a heuristic and is treated as one: the
 *    match is case-insensitive and trimmed, and an email shared by two profiles
 *    matches NEITHER, because a wrong guess about who you are is worse than no
 *    guess (it would put someone else's trip on your home screen).
 */
export function resolveMe(
  members: readonly FamilyMember[],
  uid: string | null | undefined,
  email: string | null | undefined,
): MeResult {
  if (uid) {
    const linked = members.filter((member) => member.linkedUid === uid);
    // Two profiles claiming the same uid is a data error, not a tie to break.
    if (linked.length === 1) return { member: linked[0], via: 'linked' };
    if (linked.length > 1) return { member: null, via: 'none' };
  }

  const wanted = email?.trim().toLowerCase();
  if (wanted) {
    const matches = members.filter((member) => member.email?.trim().toLowerCase() === wanted);
    if (matches.length === 1) return { member: matches[0], via: 'email' };
  }

  return { member: null, via: 'none' };
}

/** Convenience for the common "is this row me?" check in a list. */
export function isMe(member: Pick<FamilyMember, 'id'>, me: FamilyMember | null): boolean {
  return !!me && me.id === member.id;
}
