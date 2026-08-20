// Pure state transitions for the ESTATE INVITE — the one invite that carries a
// permission with it. Dependency-free (no firebase-admin) so it can be
// `node --test`ed directly; server.js does the Firestore reads/writes around it.
//
// WHY THIS EXISTS
//
// v230 locked families/{id}/reference/willsEstate to admins plus a list of
// explicitly named readers (reference/willsAccess.readerUids). That works for
// people who are already in the vault, and not at all for the person it most
// needs to work for: whoever handles the estate is usually not on the app, and
// the moment the grant actually matters is the moment the admin is not around
// to come back and tick a box. So the grant travels WITH the invite:
//
//   create-invite  → mint invites/{code} with a willReaderId, and mirror a
//                    PendingWillReader entry (same id, no code) into willsAccess
//   join-family    → after membership is granted, look up that id and move the
//                    entry: the new uid joins readerUids, the pending row goes
//   admin cancels  → the pending row is deleted; redemption then finds nothing
//
// pendingReaders is the SINGLE SOURCE OF TRUTH for "this invite carries will
// access". invites/{code}.willReaderId is only a pointer. That asymmetry is
// what makes cancelling real: an admin who changes their mind deletes the row
// they can see, and no second write has to succeed for that to take effect.
//
// EVERY REFUSAL PATH STILL CONSUMES THE ROW. A redemption that doesn't grant
// (wrong role, expired, already a reader) must not leave the entry sitting in
// the admin's list saying "waiting for them to join" — the code behind it is
// spent and can never be redeemed again, so the row would be a lie that only
// looks like a pending grant.

/** The pending list, defensively normalised — a doc may predate the field. */
export function pendingList(access) {
  const raw = access && Array.isArray(access.pendingReaders) ? access.pendingReaders : [];
  return raw.filter((p) => p && typeof p.id === 'string' && p.id);
}

/** The reader list, same treatment. */
export function readerList(access) {
  const raw = access && Array.isArray(access.readerUids) ? access.readerUids : [];
  return raw.filter((u) => typeof u === 'string' && u);
}

/**
 * The pendingReaders array after sending an estate invite.
 *
 * `replaceId` covers "send again": an invite that expired unredeemed leaves a
 * dead row, and re-inviting the same person must replace it rather than stack
 * a second one — otherwise the admin's list slowly fills with the same name.
 * Also self-defends against a duplicate id.
 */
export function addPendingReader(access, entry, replaceId = null) {
  if (!entry || typeof entry.id !== 'string' || !entry.id) {
    throw new Error('addPendingReader: entry.id is required');
  }
  const kept = pendingList(access).filter((p) => p.id !== entry.id && p.id !== replaceId);
  return [...kept, entry];
}

/** Cancel: drop one row by id. Unknown id is a no-op, not an error. */
export function removePendingReader(access, id) {
  return pendingList(access).filter((p) => p.id !== id);
}

/**
 * Redeem an estate invite: move `uid` from the pending row onto readerUids.
 *
 * Returns { granted, readerUids, pendingReaders, reason } and NEVER throws —
 * membership has already been granted by the time this runs, and a failure to
 * attach the reader grant must not undo somebody joining the vault.
 *
 * `role` is the role the invite granted. A child is refused here even though
 * create-invite forces an estate invite to 'member': firestore.rules refuses a
 * child regardless (isNamedWillReader → canWriteIn), so writing a child's uid
 * onto this list would produce a grant the server does not honour — an access
 * list that says yes while the boundary says no is worse than no grant at all.
 */
export function redeemPendingReader(access, { willReaderId, uid, role, now = new Date() }) {
  const readerUids = readerList(access);
  const pending = pendingList(access);
  const unchanged = { granted: false, readerUids, pendingReaders: pending };

  if (!willReaderId || !uid) return { ...unchanged, reason: 'not-an-estate-invite' };

  const entry = pending.find((p) => p.id === willReaderId);
  // Cancelled by an admin between sending and redeeming — or already redeemed.
  // Either way there is nothing to honour, and silence is the right answer:
  // the person still joins the vault, they just don't get the estate page.
  if (!entry) return { ...unchanged, reason: 'cancelled' };

  const remaining = pending.filter((p) => p.id !== willReaderId);

  if (role !== 'member' && role !== 'admin') {
    return { granted: false, readerUids, pendingReaders: remaining, reason: 'role-not-eligible' };
  }

  // Belt and braces: join-family refuses an expired invite before it ever gets
  // here, so this only fires if the two records disagree — in which case the
  // fail-closed reading is the one to take.
  if (entry.expiresAt && new Date(entry.expiresAt) < new Date(now)) {
    return { granted: false, readerUids, pendingReaders: remaining, reason: 'expired' };
  }

  if (readerUids.includes(uid)) {
    // Already a named reader (an existing member redeeming an estate invite).
    // Nothing to add, but the row is still spent.
    return { granted: true, readerUids, pendingReaders: remaining, reason: 'already-a-reader' };
  }

  return { granted: true, readerUids: [...readerUids, uid], pendingReaders: remaining, reason: 'granted' };
}
