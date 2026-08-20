import type { FamilyRole, FamilyMemberRole, WillsAccessDoc } from '../types';

/*
 * Who may open Wills & Estate.
 *
 * THE RULE IS THE BOUNDARY, NOT THIS FILE. firestore.rules decides; everything
 * here exists so the app doesn't show a locked person a screen that will fail,
 * and doesn't leave them looking at a stale local copy of a document they are
 * no longer allowed to read. Treat a `true` from here as "show the screen",
 * never as "it is safe to reveal this".
 *
 * Kept deliberately in step with the rule, which reads:
 *
 *   match /reference/willsEstate {
 *     allow read:  if isAdminOf(familyId) || isNamedWillReader(familyId);
 *     allow write: if isAdminOf(familyId);
 *   }
 *
 * If you change one, change the other and the test that pins them together.
 */

/** Can this person open the wills & estate document at all? */
export function canReadWills(
  role: FamilyRole | null,
  uid: string | null,
  access: WillsAccessDoc | null,
): boolean {
  if (role === 'admin') return true;
  if (!uid || !role) return false;
  // A child is never a named reader even if a uid somehow ended up on the
  // list — this feature exists because Rory did not want the kids in the will,
  // and an accidental grant should not be the thing that undoes that.
  if (role === 'child') return false;
  return (access?.readerUids || []).includes(uid);
}

/**
 * Should this device throw away its cached plaintext copy of the will?
 *
 * Only when we KNOW who this is AND know they are denied. A null role means
 * "not resolved yet" or "signed out", and both of those happen on an ADMIN's
 * own device — purging there would delete their offline copy and, worse, the
 * dirty flag that marks an edit they made offline and haven't synced yet.
 * Absence of permission is not the same as permission being absent.
 */
export function shouldPurgeLocalWills(
  role: FamilyRole | null,
  uid: string | null,
  access: WillsAccessDoc | null,
): boolean {
  if (!uid || !role) return false;
  return !canReadWills(role, uid, access);
}

/** Can this person CHANGE it — records, successor, the letter? Admins only. */
export function canWriteWills(role: FamilyRole | null): boolean {
  return role === 'admin';
}

/** Can this person grant or revoke someone else's access? Admins only. */
export const canManageWillsAccess = canWriteWills;

/**
 * The people an admin can choose between when granting access.
 *
 * Admins are excluded because they already have it — offering a toggle that
 * cannot be turned off reads as a bug. Children are excluded outright; see
 * canReadWills. Sorted by name so the list doesn't reshuffle between renders.
 */
export function grantableMembers(
  roles: Record<string, FamilyMemberRole>,
): { uid: string; label: string; email?: string }[] {
  return Object.entries(roles)
    .filter(([, r]) => r?.role === 'member')
    .map(([uid, r]) => ({
      uid,
      label: (r.displayName || r.email || 'Unnamed member').trim(),
      email: r.email,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Grant/revoke, returning the next list. Idempotent in both directions. */
export function withReader(access: WillsAccessDoc | null, uid: string, granted: boolean): string[] {
  const current = access?.readerUids || [];
  if (granted) return current.includes(uid) ? [...current] : [...current, uid];
  return current.filter((u) => u !== uid);
}

/**
 * Reader uids that no longer correspond to a grantable person.
 *
 * A grant outlives the person it was for: remove someone from the family, or
 * promote them to admin, and their uid sits on this list forever — silently
 * re-granting access if they are ever re-added as a member. The admin panel
 * shows these so they can be cleared, rather than pretending the list is
 * always clean.
 */
export function staleReaders(
  access: WillsAccessDoc | null,
  roles: Record<string, FamilyMemberRole>,
): string[] {
  return (access?.readerUids || []).filter((uid) => roles[uid]?.role !== 'member');
}
