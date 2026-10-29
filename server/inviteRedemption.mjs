import { redeemPendingReader } from './willsInvite.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export class InviteRedemptionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const notFound = () => new InviteRedemptionError(404, 'Invite code not found — ask your family admin to share a fresh one.');
const validSpaceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const roleNames = new Set(['admin', 'member', 'child']);

function retryableTransaction(error) {
  if (error instanceof InviteRedemptionError) return false;
  if ([10, 'ABORTED', 'aborted'].includes(error?.code)) return true;
  // An expired/closed transaction ID can escape the SDK's internal retry loop,
  // especially after lock contention. Start a fresh transaction ID only for
  // these specific INVALID_ARGUMENT failures, never for arbitrary bad input.
  return [3, 'INVALID_ARGUMENT', 'invalid-argument'].includes(error?.code)
    && /transaction (?:is invalid or closed|has expired)/i.test(error?.message || '');
}

async function runInviteTransaction(db, operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await db.runTransaction(operation); }
    catch (error) {
      if (!retryableTransaction(error)) throw error;
      if (attempt === 2) throw new InviteRedemptionError(503, 'This space is busy processing another invite. Please try again shortly.');
      // Codes and attempt numbers are safe to log; invite codes, UIDs, email
      // addresses and request bodies must never appear in contention logs.
      console.warn('[invite] retrying transaction contention', { attempt: attempt + 1, code: error.code });
      await delay(100 * 2 ** attempt + Math.floor(Math.random() * 100));
    }
  }
}

/** Preserve the other spaces and self-owned profile fields when joining. The
 * target entry comes from authoritative membership, never an old mirror role. */
export function profileForMembership(prior, { familyId, role, type, name, email, displayName }) {
  let existing = Array.isArray(prior?.spaces) ? prior.spaces.filter(space => space && validSpaceId(space.id)) : [];
  if (!existing.length && validSpaceId(prior?.familyId) && prior.familyId !== familyId) {
    existing = [{ id: prior.familyId, role: roleNames.has(prior.role) ? prior.role : 'member', type: 'family' }];
  }
  const entry = { id: familyId, role, type: ['family', 'business', 'personal'].includes(type) ? type : 'family' };
  if (typeof name === 'string' && name) entry.name = name;
  return { familyId, role, email, displayName, spaces: [...existing.filter(space => space.id !== familyId), entry] };
}

/**
 * Consume the invite, grant membership and NAME any estate nominee in ONE
 * transaction. Naming never opens the will or changes its release requests.
 *
 * Reading and updating info.membershipRevision provides a shared contention
 * point for two different invite codes. The seat count is always read from the
 * roles collection; the revision is a lock, never a client-writable seat count.
 * All reads precede writes so this runs on real Firestore transactions as well
 * as the concurrency test store. Any failed read/write aborts every change.
 */
export async function redeemFamilyInvite({ db, code, caller, now, planOf, seatLimitFor }) {
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!normalized) throw new InviteRedemptionError(400, 'Missing invite code.');
  if (!/^[A-Z0-9_-]{1,128}$/.test(normalized)) throw notFound();
  if (!caller?.uid || typeof caller.uid !== 'string' || caller.uid.includes('/')) {
    throw new InviteRedemptionError(401, 'Please sign in first.');
  }
  const inviteRef = db.doc(`invites/${normalized}`);

  return runInviteTransaction(db, async tx => {
    const at = now || new Date();
    const timestamp = at.toISOString();
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) throw notFound();
    const invite = inviteSnap.data();
    if (invite.usedBy) throw new InviteRedemptionError(410, 'This invite was already used — ask your admin for a new one.');
    const expiry = typeof invite.expiresAt === 'string' ? Date.parse(invite.expiresAt) : NaN;
    if (!Number.isFinite(expiry) || expiry <= at.getTime()) {
      throw new InviteRedemptionError(410, 'This invite has expired — ask your admin for a new one.');
    }
    if (!validSpaceId(invite.familyId)) throw notFound();
    // Invites are never a route to admin. Old invites without a role retain
    // their historical member default, but unknown/malformed roles fail closed.
    const invitedRole = invite.role === undefined ? 'member' : invite.role;
    if (invitedRole !== 'member' && invitedRole !== 'child') {
      throw new InviteRedemptionError(403, 'This invite cannot grant that role. Ask an admin for a new one.');
    }
    const familyId = invite.familyId;
    const infoRef = db.doc(`families/${familyId}/info/info`);
    const roleRef = db.doc(`families/${familyId}/roles/${caller.uid}`);
    const userRef = db.doc(`users/${caller.uid}`);
    // Acquire the COMMON space lock before per-caller locks. Parallel reads
    // let another invite hold a missing-role lock while waiting for info, then
    // block this transaction's roles query/commit and deadlock both requests.
    const infoSnap = await tx.get(infoRef);
    if (!infoSnap.exists) throw notFound();
    const roleSnap = await tx.get(roleRef);
    const userSnap = await tx.get(userRef);
    const info = infoSnap.data();
    const alreadyMember = roleSnap.exists;
    const existingRole = alreadyMember ? roleSnap.data().role : undefined;
    if (alreadyMember && !roleNames.has(existingRole)) {
      throw new InviteRedemptionError(403, 'This membership needs an admin to review its role.');
    }
    // Rejoining cannot upgrade a child or downgrade an admin/member. Role
    // changes belong to the explicit admin membership controls.
    const role = alreadyMember ? existingRole : invitedRole;
    if (!alreadyMember) {
      const rolesSnap = await tx.get(db.collection(`families/${familyId}/roles`));
      const plan = planOf(info, at);
      const limit = seatLimitFor(plan);
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid membership seat limit');
      if (rolesSnap.size >= limit) {
        throw new InviteRedemptionError(403, `This space already has ${rolesSnap.size} members — the maximum allowed on the ${plan} plan is ${limit}. Ask an admin to upgrade before inviting more.`);
      }
    }
    const hasEstatePointer = typeof invite.willReaderId === 'string' && !!invite.willReaderId;
    const accessRef = hasEstatePointer ? db.doc(`families/${familyId}/reference/willsAccess`) : null;
    const accessSnap = accessRef ? await tx.get(accessRef) : null;
    const estate = redeemPendingReader(accessSnap?.exists ? accessSnap.data() : null, {
      willReaderId: hasEstatePointer ? invite.willReaderId : undefined, uid: caller.uid, role, now: at,
    });
    const profile = profileForMembership(userSnap.exists ? userSnap.data() : null, {
      familyId, role, type: info.type, name: info.name, email: caller.email || '', displayName: caller.displayName || caller.email || '',
    });

    if (!alreadyMember) {
      tx.set(roleRef, { role, email: caller.email || '', displayName: caller.displayName || caller.email || '' });
      const revision = Number.isSafeInteger(info.membershipRevision) && info.membershipRevision >= 0 ? info.membershipRevision : 0;
      tx.set(infoRef, { membershipRevision: revision + 1 }, { merge: true });
    }
    tx.set(userRef, profile, { merge: true });
    if (accessRef && estate.reason !== 'cancelled' && estate.reason !== 'not-an-estate-invite') {
      tx.set(accessRef, {
        namedUids: estate.namedUids,
        readerUids: estate.readerUids,
        pendingReaders: estate.pendingReaders,
        updatedAt: timestamp,
      }, { merge: true });
    }
    tx.set(inviteRef, { usedBy: caller.uid, usedAt: timestamp }, { merge: true });
    return { familyId, role, spaces: profile.spaces, willReaderGranted: estate.granted, alreadyMember };
  });
}
