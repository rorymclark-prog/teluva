import { useEffect, useRef, useState } from 'react';
import { subscribeReferenceDoc, SharedDocName } from '../utils/db';

// Live updates for the shared reference documents (shopping list, recipes,
// slips, vault, household, …), which several family members edit at once from
// different phones.
//
// WHY A VIEW SHOULD SUBSCRIBE
// ---------------------------
// Two reasons, and the second one is the important one:
//
//  1. UX — you see your partner's addition without reloading.
//  2. CORRECTNESS — utils/db.ts merges every write against "the value this
//     client last saw". A view that loaded once at mount and never refetched
//     hands the merge a base that is minutes old, and while the merge is built
//     to survive that (it resolves every ambiguity toward keeping data), the
//     price of a stale base is that a DELETE the user makes can be declined as
//     "made on stale information". A subscribed view is never stale, so its
//     writes are clean, unambiguous diffs.
//
// WHAT THE USER SEES WHEN A REMOTE CHANGE ARRIVES
// -----------------------------------------------
// The deliberate choice here is: **apply silently while idle, defer while the
// user is mid-edit.** Rewriting the list under someone's fingers — reordering
// rows they are about to tap, or yanking the record out of the form they are
// typing into — is worse than a moment's staleness. So:
//
//   * idle (just looking at the list)  → the change lands immediately, no
//     prompt, no banner. This is a shared family list; a shopping item quietly
//     appearing is exactly what people expect.
//   * busy (`hold` is true — a modal/inline editor is open, a save is in
//     flight) → the snapshot is held. `pendingRemote` goes true so the view can
//     show a quiet "someone else made a change" hint if it wants to, and the
//     held value is applied the instant `hold` goes false.
//
// Nothing is ever dropped: the newest held snapshot always wins and always
// eventually lands. The user's own in-progress form state is separate React
// state and is never touched by either path.

interface Options {
  /** True while the user is mid-edit; incoming snapshots wait until it clears. */
  hold?: boolean;
  /** Skip subscribing entirely (e.g. demo mode, signed out). */
  disabled?: boolean;
}

/**
 * Subscribe to one shared reference document.
 *
 * @param name  which document (see SHARED_DOCS in utils/db.ts)
 * @param apply called with the server's value when it should be adopted into
 *              the view's state. Must be safe to call repeatedly.
 * @returns true while a remote change is being held back by `hold`.
 */
export function useSharedDoc<T>(
  name: SharedDocName,
  apply: (value: T) => void,
  { hold = false, disabled = false }: Options = {},
): boolean {
  const [pendingRemote, setPendingRemote] = useState(false);

  // Refs so a changing `apply`/`hold` never tears down the Firestore listener.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const holdRef = useRef(hold);
  // The newest snapshot we have not adopted yet, with its commit callback
  // (commit is what promotes it to the merge base — see subscribeReferenceDoc).
  const heldRef = useRef<{ value: T; commit: () => void } | null>(null);
  const firstRef = useRef(true);

  const flush = () => {
    const held = heldRef.current;
    if (!held) return;
    heldRef.current = null;
    applyRef.current(held.value);
    held.commit();
    setPendingRemote(false);
  };

  useEffect(() => {
    if (disabled) return;
    firstRef.current = true;
    const unsubscribe = subscribeReferenceDoc<T>(name, (value, commit) => {
      if (value === null) return;         // document does not exist yet
      // The very first snapshot is just the current server state, which the
      // view's own initial load already produced — adopt it silently even when
      // holding, so we never show "someone changed this" for our own data.
      const isFirst = firstRef.current;
      firstRef.current = false;
      heldRef.current = { value, commit };
      if (isFirst || !holdRef.current) flush();
      else setPendingRemote(true);
    });
    return () => {
      unsubscribe();
      heldRef.current = null;
    };
    // `name`/`disabled` are the only things that should re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, disabled]);

  useEffect(() => {
    holdRef.current = hold;
    if (!hold) flush();      // the editor closed — land whatever was waiting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold]);

  return pendingRemote;
}
