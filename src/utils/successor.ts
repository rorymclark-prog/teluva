// Access-status logic for the designated successor ("if something happens to
// you, who takes over the vault") — pure so WillsEstateView stays a thin
// renderer and this stays trivially reasoned about. See DesignatedSuccessor
// in types.ts for why this is COMPUTED rather than stored: a stored "can
// they get in" flag would go stale the moment someone's role changes
// elsewhere in the app (FamilySettings), and a stale "yes they can get in"
// is exactly the failure mode this whole feature exists to prevent.
import { DesignatedSuccessor, FamilyMember, FamilyMemberRole } from '../types';

export type SuccessorAccess =
  | 'admin'       // already an admin — can sign in and act today
  | 'member'      // has an account here, but isn't an admin
  | 'no-account'  // resolved to a family member, but no matching signed-in account
  | 'unknown';    // free-text name only (not an app member) — nothing to check

export interface SuccessorAccessResult {
  status: SuccessorAccess;
  label: string;
}

/**
 * Matches a designated successor to a signed-in account by EMAIL — the only
 * reliable link between a FamilyMember profile (birthdate, clothing sizes,
 * no login of its own) and a families/{id}/roles entry (uid, email, actual
 * sign-in access). Case-insensitive, mirrors the forMember matching
 * WillsEstateView already does when attaching a scan to a member.
 */
export function resolveSuccessorAccess(
  successor: DesignatedSuccessor | undefined,
  members: FamilyMember[],
  roles: Record<string, FamilyMemberRole>,
): SuccessorAccessResult | null {
  if (!successor || !successor.name.trim()) return null;

  const member = successor.memberId
    ? members.find((m) => m.id === successor.memberId)
    : members.find((m) => m.name.trim().toLowerCase() === successor.name.trim().toLowerCase());

  const email = member?.email?.trim().toLowerCase();
  const role = email
    ? Object.values(roles).find((r) => r.email?.trim().toLowerCase() === email)
    : undefined;

  if (role?.role === 'admin') {
    return { status: 'admin', label: 'Can already sign in — is an admin' };
  }
  if (role) {
    return { status: 'member', label: "Has an account here, but isn't an admin yet — make them admin from Members & roles" };
  }
  if (member) {
    return { status: 'no-account', label: "Doesn't have access to this vault yet — invite them from Members & roles" };
  }
  return { status: 'unknown', label: "Can't check access from here — make sure they're able to sign in" };
}
