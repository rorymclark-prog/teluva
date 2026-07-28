// Persistence for FirstRunTour.tsx.
//
// WHY users/{uid}, not localStorage: this app is explicitly multi-device
// (Google sign-in, PWA install on phone + desktop). A per-device flag means
// anyone who signs in on a second phone or after clearing site data sees the
// "first run" tour again — annoying for exactly the people who already know
// their way around. users/{uid} is the SAME doc setAiConsent() already
// writes to (see FamilyContext.tsx), so this follows an established pattern
// rather than inventing a new one.
//
// localStorage is still used as a same-device CACHE only, so a repeat visit
// never even has to wait on a Firestore round-trip to know to stay hidden —
// but it is never the source of truth, and a cache miss always falls back to
// the real read. Demo mode has no real account, so it's localStorage-only
// there (nothing to be cross-device about).
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

const LS_PREFIX = 'tresa_tour_seen_';
const LS_DEMO_KEY = `${LS_PREFIX}demo`;

function lsKey(uid: string): string {
  return `${LS_PREFIX}${uid}`;
}

function readLocal(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    // Private-browsing / storage-disabled — treat as "unknown", not "seen".
    return false;
  }
}

function writeLocal(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Best-effort only — Firestore (for real accounts) remains the source of truth.
  }
}

/** Has this person already seen (or explicitly skipped) the first-run tour? */
export async function getTourSeen(uid: string | null, demo: boolean): Promise<boolean> {
  if (demo) return readLocal(LS_DEMO_KEY);
  if (!uid) return true; // not signed in yet — nothing to show

  if (readLocal(lsKey(uid))) return true;

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const seen = !!snap.data()?.tourSeenAt;
    if (seen) writeLocal(lsKey(uid));
    return seen;
  } catch {
    // Offline / read failed — fail closed (never seen) is tempting, but a
    // flaky connection would then re-show the tour on every load, which is
    // worse than occasionally under-showing it. Treat as seen; the tour is
    // still reachable any time from Hub settings.
    return true;
  }
}

/** Mark the tour as done (finished OR skipped — both count as "seen"). */
export async function markTourSeen(uid: string | null, demo: boolean): Promise<void> {
  if (demo) {
    writeLocal(LS_DEMO_KEY);
    return;
  }
  if (!uid) return;
  writeLocal(lsKey(uid));
  try {
    await setDoc(doc(db, 'users', uid), { tourSeenAt: new Date().toISOString() }, { merge: true });
  } catch {
    // localStorage cache above already prevents an immediate re-show on this
    // device; a background retry isn't worth the complexity for a one-time,
    // low-stakes flag.
  }
}

/** Explicit replay (Hub settings → "Replay the welcome tour"): clears the
 * local cache so getTourSeen() re-checks honestly, but FirstRunTour actually
 * force-shows itself via a bump key rather than waiting on this — see its
 * `forceKey` prop. */
export function clearTourSeenCache(uid: string | null, demo: boolean): void {
  try {
    window.localStorage.removeItem(demo ? LS_DEMO_KEY : uid ? lsKey(uid) : '');
  } catch {
    // no-op
  }
}

export function currentUidForTour(): string | null {
  return auth.currentUser?.uid ?? null;
}
