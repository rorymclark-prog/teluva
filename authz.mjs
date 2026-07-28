// ---------------------------------------------------------------------------
// Pure authorization decisions for family membership.
//
// Deliberately free of Express, Firebase and any I/O so the rules can be
// unit-tested directly (see authz.test.mjs). server.js does the reads/writes
// and asks these functions what the answer is.
//
// NOTE FOR DEPLOYS: this file is imported by server.js at runtime, so it MUST
// be copied into the runtime image — see the `COPY authz.mjs` line in the
// Dockerfile alongside `COPY server.js`.
// ---------------------------------------------------------------------------

const NO_FAMILY = 'This account is not part of a family yet — create or join one first.';
const NOT_A_MEMBER = 'You no longer have access to this space. Ask an admin to invite you again.';

/**
 * The membership decision on the hot path of every authenticated request.
 *
 * Two documents go in and they play DIFFERENT roles — this is the whole point:
 *
 *   users/{uid}                       → says WHICH space the caller means.
 *                                       A cache for fast UI listing. Never an
 *                                       access grant.
 *   families/{familyId}/roles/{uid}   → says WHETHER they are in it, and AS WHAT.
 *                                       Authoritative. The same doc
 *                                       firestore.rules' isMemberOf() checks.
 *
 * The mirror is never cleaned up by anything that ends a membership, so trusting
 * it for authorization is what made membership unrevocable on the API surface.
 * `role` comes from the roles doc too, so a stale mirror role can't over-grant.
 *
 * @param {object} p
 * @param {boolean} p.profileExists    whether users/{uid} exists
 * @param {object|undefined} p.profile users/{uid} data
 * @param {boolean} p.roleDocExists    whether families/{familyId}/roles/{uid} exists
 * @param {object|undefined} p.roleDoc that doc's data
 * @returns {{ok: true, familyId: string, role: string} | {ok: false, status: number, error: string}}
 */
export function resolveMembership({ profileExists, profile, roleDocExists, roleDoc }) {
  if (!profileExists || !profile) {
    return { ok: false, status: 403, error: NO_FAMILY };
  }
  if (!profile.familyId || typeof profile.familyId !== 'string') {
    return { ok: false, status: 403, error: NO_FAMILY };
  }
  if (!roleDocExists) {
    return { ok: false, status: 403, error: NOT_A_MEMBER };
  }
  return { ok: true, familyId: profile.familyId, role: roleDoc?.role };
}

/**
 * Decide whether a caller may remove `targetUid` from a space.
 *
 * Rules, in the order a reviewer should check them:
 *  1. Only an admin of the space can remove anyone.
 *  2. Nobody can remove themselves through this route. Self-removal is a
 *     DIFFERENT operation ("leave this space") with different semantics — and
 *     allowing it here is the only way an admin could orphan a space by
 *     removing the last admin, so refusing it is also what makes rule 3 hold.
 *  3. A space must never be left without an admin. Given rules 1 and 2 the
 *     caller is an admin who is not the target, so at least one admin always
 *     survives — this check is belt-and-braces against inconsistent role docs
 *     (e.g. a roles collection that somehow reports zero admins) rather than a
 *     reachable path, and it fails CLOSED.
 *  4. You cannot remove someone who is not a member.
 *
 * @param {object} p
 * @param {string} p.callerUid
 * @param {string} p.callerRole      role from the AUTHORITATIVE roles doc
 * @param {string} p.targetUid
 * @param {boolean} p.targetIsMember whether families/{id}/roles/{targetUid} exists
 * @param {string} [p.targetRole]    role from the target's roles doc
 * @param {number} p.adminCount      number of admins in the space INCLUDING the target
 * @returns {{ok: true} | {ok: false, status: number, error: string}}
 */
export function checkRemoveMember({ callerUid, callerRole, targetUid, targetIsMember, targetRole, adminCount }) {
  if (callerRole !== 'admin') {
    return { ok: false, status: 403, error: 'Only admins can remove members.' };
  }
  if (!targetUid) {
    return { ok: false, status: 400, error: 'Missing the member to remove.' };
  }
  if (targetUid === callerUid) {
    return { ok: false, status: 400, error: 'You cannot remove yourself. Ask another admin to remove you.' };
  }
  if (!targetIsMember) {
    return { ok: false, status: 404, error: 'That person is not a member of this space.' };
  }
  if (targetRole === 'admin' && adminCount <= 1) {
    return { ok: false, status: 400, error: 'This space would be left without an admin. Make someone else an admin first.' };
  }
  return { ok: true };
}

/**
 * Work out what a removed member's users/{uid} mirror should become.
 *
 * The mirror holds `spaces[]` (every space they belong to) plus a single
 * ACTIVE-space pointer (`familyId` + `role`). After removal the space must be
 * gone from spaces[], and if it was the active one the pointer must move to a
 * remaining space — or be cleared entirely, which drops them back to the
 * create/join onboarding screen rather than leaving a dangling pointer at a
 * space they can no longer read.
 *
 * @param {Array<{id: string, role?: string, type?: string, name?: string}>} spaces
 * @param {string} removedFamilyId
 * @param {string} [currentFamilyId] the mirror's current active pointer
 * @returns {{spaces: Array, familyId: string|null, role: string|null}}
 */
export function profileAfterRemoval(spaces, removedFamilyId, currentFamilyId) {
  const remaining = (Array.isArray(spaces) ? spaces : []).filter((s) => s && s.id !== removedFamilyId);
  // Only move the active pointer if it actually pointed at the removed space.
  if (currentFamilyId && currentFamilyId !== removedFamilyId) {
    const stillThere = remaining.find((s) => s.id === currentFamilyId);
    if (stillThere) {
      return { spaces: remaining, familyId: currentFamilyId, role: stillThere.role || 'member' };
    }
  }
  const next = remaining[0];
  if (!next) return { spaces: [], familyId: null, role: null };
  return { spaces: remaining, familyId: next.id, role: next.role || 'member' };
}
