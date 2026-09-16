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
//                    entry: the new uid joins namedUids, the pending row goes
//   admin cancels  → the pending row is deleted; redemption then finds nothing
//
// v329: REDEEMING NAMES YOU. IT DOES NOT OPEN THE WILL.
//
// Until v329 redemption put the uid straight onto readerUids, so accepting an
// invite opened the entire will and estate page on the spot — while the owner
// was alive and well. Rory sent two of these believing he had named people for
// later, which is what the invite says it does and what everybody assumes it
// does. It is also the shape every comparable feature takes: Apple's Legacy
// Contact names you now and gives you nothing until a death certificate is
// filed. The permission and the moment must be separable, because the whole
// reason the invite travels with a grant is that nobody will be around to
// arrange it later — and that argument justifies NAMING someone early, not
// OPENING it early.
//
// So redemption now grants two things, both of them small:
//
//   • rung one, immediately — WHO HOLDS the signed will (a notary, an office,
//     a person), or that it is lodged in a register. See projectFindability in
//     familyLink.mjs; this is the same rung v326 opened across a family link,
//     for the same reason: a will nobody can find is not protected, it is lost.
//   • standing to ring the doorbell — they can ask for the full read, which
//     opens after RELEASE_WAIT_DAYS unless an admin refuses, or sooner if a
//     second named person agrees and the owner has been quiet. See
//     server/willsRelease.mjs.
//
// readerUids is NEVER widened by a redemption any more. It stays what it always
// was: the list an admin ticks by hand, plus whatever the release mechanism
// opens. An admin who genuinely wants somebody reading it today still can —
// one tap on the same card — but that is now a decision somebody makes, not a
// side effect of an invite being accepted.
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

/** The NAMED list: people an estate invite named, who may not read it yet. */
export function namedList(access) {
  const raw = access && Array.isArray(access.namedUids) ? access.namedUids : [];
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
 * Redeem an estate invite: NAME `uid`. Does not open the will — see the header.
 *
 * Returns { granted, namedUids, readerUids, pendingReaders, reason } and NEVER
 * throws — membership has already been granted by the time this runs, and a
 * failure to attach the naming must not undo somebody joining the vault.
 *
 * `readerUids` is returned UNCHANGED in every path. It is in the return value
 * only so the caller writes one consistent shape; nothing here may widen it.
 *
 * `role` is the role the invite granted. A child is refused here even though
 * create-invite forces an estate invite to 'member': firestore.rules refuses a
 * child regardless (isNamedWillReader → canWriteIn), so naming a child would
 * produce standing the server will not honour when it is used — and a list
 * that says yes while the boundary says no is worse than no entry at all.
 */
export function redeemPendingReader(access, { willReaderId, uid, role, now = new Date() }) {
  const readerUids = readerList(access);
  const namedUids = namedList(access);
  const pending = pendingList(access);
  const unchanged = { granted: false, namedUids, readerUids, pendingReaders: pending };

  if (!willReaderId || !uid) return { ...unchanged, reason: 'not-an-estate-invite' };

  const entry = pending.find((p) => p.id === willReaderId);
  // Cancelled by an admin between sending and redeeming — or already redeemed.
  // Either way there is nothing to honour, and silence is the right answer:
  // the person still joins the vault, they just aren't named.
  if (!entry) return { ...unchanged, reason: 'cancelled' };

  const remaining = pending.filter((p) => p.id !== willReaderId);
  const spent = { namedUids, readerUids, pendingReaders: remaining };

  if (role !== 'member' && role !== 'admin') {
    return { ...spent, granted: false, reason: 'role-not-eligible' };
  }

  // Belt and braces: join-family refuses an expired invite before it ever gets
  // here, so this only fires if the two records disagree — in which case the
  // fail-closed reading is the one to take.
  if (entry.expiresAt && new Date(entry.expiresAt) < new Date(now)) {
    return { ...spent, granted: false, reason: 'expired' };
  }

  // Already reading it by an admin's own hand. Naming them as well would say
  // nothing new, and the row is still spent either way.
  if (readerUids.includes(uid)) {
    return { ...spent, granted: true, reason: 'already-a-reader' };
  }

  if (namedUids.includes(uid)) {
    return { ...spent, granted: true, reason: 'already-named' };
  }

  return {
    ...spent,
    namedUids: [...namedUids, uid],
    granted: true,
    reason: 'named',
  };
}
