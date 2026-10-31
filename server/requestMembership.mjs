/** A request's explicit space selects the authoritative role lookup. The
 * account-wide active pointer is only a compatibility path for old clients. */
export async function resolveRequestedMembership(req, { signedIn, activeMember, roleFor }) {
  const bodySpace = req.body?.spaceId;
  const headerSpace = req.headers?.['x-teluva-space-id'];
  if (bodySpace !== undefined && headerSpace !== undefined && bodySpace !== headerSpace) {
    return { status: 400, error: 'The requested space does not match. Reload before trying again.' };
  }
  const spaceId = bodySpace === undefined ? headerSpace : bodySpace;
  if (spaceId === undefined) return activeMember(req);
  if (typeof spaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(spaceId)) {
    return { status: 400, error: 'Choose a valid space.' };
  }
  const caller = await signedIn(req);
  if (caller.error) return caller;
  const role = await roleFor(spaceId, caller.uid);
  if (!['admin', 'member', 'child'].includes(role)) {
    return { status: 403, error: 'You no longer have access to this space.' };
  }
  return { ...caller, familyId: spaceId, role };
}

/** Legacy accounts can have an active space without a spaces[] entry. Deleting
 * an unrelated space must not erase that account's active-space mirror. */
export function remainingSpacesAfterRemoval(profile, removedSpaceId) {
  const spaces = (Array.isArray(profile.spaces) ? profile.spaces : []).filter(space => space && space.id !== removedSpaceId);
  const active = profile.familyId;
  if (typeof active === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(active)
    && active !== removedSpaceId && !spaces.some(space => space.id === active)) {
    spaces.push({ id: active, role: profile.role || 'member', type: 'family' });
  }
  return spaces;
}
