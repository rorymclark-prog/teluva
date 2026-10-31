import { setTimeout as delay } from 'node:timers/promises';
import { checkRemoveMember, profileAfterRemoval } from '../authz.mjs';

export class RoleManagementError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const validSpaceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\/\x00-\x1f\x7f]/.test(value);

async function membershipTransaction(db, operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await db.runTransaction(operation); }
    catch (error) {
      const retryable = !(error instanceof RoleManagementError) && (
        [10, 'ABORTED', 'aborted'].includes(error?.code)
        || ([3, 'INVALID_ARGUMENT', 'invalid-argument'].includes(error?.code) && /transaction (?:is invalid or closed|has expired)/i.test(error?.message || ''))
      );
      if (!retryable) throw error;
      if (attempt === 2) throw new RoleManagementError(503, 'ROLE_BUSY', 'Another membership change is in progress. Please try again shortly.');
      await delay(100 * 2 ** attempt + Math.floor(Math.random() * 100));
    }
  }
}

/** Explicit spaces cannot be redirected by a second tab's active pointer.
 * The transaction below still authorizes the caller in the selected space. */
export async function resolveRemovalCaller(req, { signedIn, activeMember }) {
  if (req.body?.spaceId === undefined) return activeMember(req);
  if (!validSpaceId(req.body.spaceId)) return { status: 400, error: 'Choose a valid space.' };
  const caller = await signedIn(req);
  return caller.error ? caller : { ...caller, familyId: req.body.spaceId };
}

export async function changeMemberRole({ db, spaceId, callerUid, targetUid, newRole }) {
  if (!validSpaceId(spaceId) || !validUid(callerUid) || !validUid(targetUid)
    || !['admin', 'member', 'child'].includes(newRole)) {
    throw new RoleManagementError(400, 'ROLE_INVALID', 'Choose a valid space, member and role.');
  }
  const roles = db.collection(`families/${spaceId}/roles`);
  const userRef = db.doc(`users/${targetUid}`);
  await membershipTransaction(db, async tx => {
    // Common reads precede caller-specific locks, in the same order as removal.
    const info = await tx.get(db.doc(`families/${spaceId}/info/info`));
    const admins = await tx.get(roles.where('role', '==', 'admin'));
    const caller = await tx.get(roles.doc(callerUid));
    const target = await tx.get(roles.doc(targetUid));
    const user = await tx.get(userRef);
    if (!caller.exists || caller.data().role !== 'admin') throw new RoleManagementError(403, 'ROLE_ADMIN_REQUIRED', 'Only admins of this space can change roles.');
    if (!target.exists || !user.exists) throw new RoleManagementError(404, 'ROLE_MEMBER_MISSING', 'That account is no longer a member of this space.');
    if (target.data().role === 'admin' && newRole !== 'admin') {
      if (admins.size <= 1) throw new RoleManagementError(400, 'ROLE_LAST_ADMIN', 'Promote another admin before changing the only admin’s role.');
      if (targetUid === callerUid) throw new RoleManagementError(400, 'ROLE_SELF_DEMOTION', 'Ask another admin to change your role.');
    }
    const profile = user.data();
    let spaces = Array.isArray(profile.spaces) ? profile.spaces.filter(space => space && typeof space.id === 'string') : [];
    if (!spaces.length && profile.familyId && profile.familyId !== spaceId) {
      spaces = [{ id: profile.familyId, role: profile.role || 'member', type: 'family' }];
    }
    const prior = spaces.find(space => space.id === spaceId);
    const spaceInfo = info.exists ? info.data() : {};
    const entry = prior ? { ...prior, role: newRole } : {
      id: spaceId, role: newRole, type: spaceInfo.type || 'family', ...(spaceInfo.name ? { name: spaceInfo.name } : {}),
    };
    const update = { spaces: [...spaces.filter(space => space.id !== spaceId), entry] };
    if (profile.familyId === spaceId) update.role = newRole;
    tx.set(roles.doc(targetUid), { role: newRole }, { merge: true });
    tx.set(userRef, update, { merge: true });
  });
  return { ok: true, spaceId, uid: targetUid, role: newRole };
}

/** Authorization, last-admin protection, role deletion and the account mirror
 * commit together. Role changes read the same docs/query, so concurrent
 * removals/demotions cannot each rely on the other's disappearing admin. */
export async function removeSpaceMember({ db, spaceId, callerUid, targetUid, deleteField }) {
  if (!validSpaceId(spaceId) || !validUid(callerUid) || !validUid(targetUid)) {
    throw new RoleManagementError(400, 'ROLE_INVALID', 'Choose a valid space and member.');
  }
  const roles = db.collection(`families/${spaceId}/roles`);
  const userRef = db.doc(`users/${targetUid}`);
  return membershipTransaction(db, async tx => {
    await tx.get(db.doc(`families/${spaceId}/info/info`));
    const admins = await tx.get(roles.where('role', '==', 'admin'));
    const caller = await tx.get(roles.doc(callerUid));
    const target = await tx.get(roles.doc(targetUid));
    const user = await tx.get(userRef);
    const verdict = checkRemoveMember({
      callerUid, callerRole: caller.exists ? caller.data().role : null, targetUid,
      targetIsMember: target.exists, targetRole: target.exists ? target.data().role : null, adminCount: admins.size,
    });
    if (!verdict.ok) throw new RoleManagementError(verdict.status, 'ROLE_REMOVE_DENIED', verdict.error);
    let claims = { familyId: null, familyIds: [] };
    if (user.exists) {
      const profile = user.data();
      let spaces = Array.isArray(profile.spaces) ? profile.spaces.filter(space => space && validSpaceId(space.id)) : [];
      // A legacy mirror may have an active space but no spaces[] entry. Keep
      // that separate space rather than clearing it during unrelated removal.
      const activeOther = validSpaceId(profile.familyId) && profile.familyId !== spaceId;
      if (activeOther && !spaces.some(space => space.id === profile.familyId)) {
        spaces = [...spaces, { id: profile.familyId, role: profile.role || 'member', type: 'family' }];
      }
      const next = profileAfterRemoval(spaces, spaceId, profile.familyId);
      const update = { spaces: next.spaces };
      if (!activeOther) {
        update.familyId = next.familyId || deleteField();
        update.role = next.role || deleteField();
      }
      tx.set(userRef, update, { merge: true });
      claims = { familyId: activeOther ? profile.familyId : next.familyId, familyIds: next.spaces.map(space => space.id) };
    }
    tx.delete(roles.doc(targetUid));
    return { ok: true, spaceId, removed: targetUid, claims };
  });
}

/** Self-departure shares the admin-query read set with removals and role
 * changes. Checking counts outside this transaction would let two admins
 * each leave while relying on the other, or race another admin's demotion. */
export async function leaveSpaceMember({ db, spaceId, callerUid, deleteField }) {
  if (!validSpaceId(spaceId) || !validUid(callerUid)) {
    throw new RoleManagementError(400, 'ROLE_INVALID', 'Choose a valid space and member.');
  }
  const roles = db.collection(`families/${spaceId}/roles`);
  const userRef = db.doc(`users/${callerUid}`);
  return membershipTransaction(db, async tx => {
    // Keep the common prefix in exactly the same order as demotion/removal.
    await tx.get(db.doc(`families/${spaceId}/info/info`));
    const admins = await tx.get(roles.where('role', '==', 'admin'));
    const members = await tx.get(roles);
    const caller = await tx.get(roles.doc(callerUid));
    const user = await tx.get(userRef);
    const role = caller.exists ? caller.data().role : null;
    if (!['admin', 'member', 'child'].includes(role)) {
      throw new RoleManagementError(403, 'ROLE_MEMBER_MISSING', 'You no longer have access to this space.');
    }
    if (members.size <= 1) {
      throw new RoleManagementError(400, 'ROLE_ONLY_MEMBER', "You're the only member — delete the family instead if you want to remove it.");
    }
    if (role === 'admin' && admins.size <= 1) {
      throw new RoleManagementError(400, 'ROLE_LAST_ADMIN', "You're the only admin — promote another member to admin first, or delete the family instead.");
    }
    let claims = { familyId: null, familyIds: [] };
    if (user.exists) {
      const profile = user.data();
      let spaces = Array.isArray(profile.spaces) ? profile.spaces.filter(space => space && validSpaceId(space.id)) : [];
      const activeOther = validSpaceId(profile.familyId) && profile.familyId !== spaceId;
      if (activeOther && !spaces.some(space => space.id === profile.familyId)) {
        spaces = [...spaces, { id: profile.familyId, role: profile.role || 'member', type: 'family' }];
      }
      const next = profileAfterRemoval(spaces, spaceId, profile.familyId);
      const update = { spaces: next.spaces };
      if (!activeOther) {
        update.familyId = next.familyId || deleteField();
        update.role = next.role || deleteField();
      }
      tx.set(userRef, update, { merge: true });
      claims = { familyId: activeOther ? profile.familyId : next.familyId, familyIds: next.spaces.map(space => space.id) };
    }
    tx.delete(roles.doc(callerUid));
    return { ok: true, spaceId, claims };
  });
}
