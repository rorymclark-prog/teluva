// Persistence for FamilyInterview.tsx — the guided first-time setup interview.
//
// Modeled directly on utils/tour.ts (read that file's header first): same
// users/{uid} source of truth (multi-device — Google sign-in, PWA on phone +
// desktop, so a per-device flag would re-show this on every new device),
// same localStorage cache for an instant same-device skip, same demo-mode
// localStorage-only fallback (nothing cross-device to worry about there).
//
// The one thing this needs that the tour doesn't: a RESUME POINT. The tour is
// six steps and either seen or not; the interview is 10-20+ questions and
// people WILL be interrupted mid-way (it's a household task) — see the
// handoff brief. So alongside `interviewSeenAt` (done or explicitly skipped —
// mirrors tourSeenAt exactly) this also persists `interviewStep`: a small
// string token (e.g. "member:172837:health") identifying exactly which
// question to reopen on. FamilyInterview.tsx rebuilds its full question
// sequence live from the CURRENT members/settings every time it activates —
// see buildSequence() there — so this token only ever needs to name a
// position in that sequence, not carry any data of its own. Every answer is
// already durable the moment it's given (each step writes straight through
// the same save paths the rest of the app uses — see FamilyInterview.tsx);
// this pointer is purely "which screen to show next", not a data cache.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

const LS_PREFIX = 'tresa_interview_';
const DEMO_SEEN_KEY = `${LS_PREFIX}demo_seen`;
const DEMO_STEP_KEY = `${LS_PREFIX}demo_step`;

function seenKey(uid: string): string {
  return `${LS_PREFIX}${uid}_seen`;
}
function stepKey(uid: string): string {
  return `${LS_PREFIX}${uid}_step`;
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private-browsing / storage-disabled — treat as "unknown".
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort only — Firestore (for real accounts) remains the source of truth.
  }
}

function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // no-op
  }
}

export interface InterviewState {
  seen: boolean;
  /** Resume token, or null if the interview has never been started. Meaningless once `seen` is true. */
  step: string | null;
}

/** Has this person already finished (or explicitly skipped) the setup interview — and if not, where did they leave off? */
export async function getInterviewState(uid: string | null, demo: boolean): Promise<InterviewState> {
  if (demo) {
    return { seen: readLocal(DEMO_SEEN_KEY) === '1', step: readLocal(DEMO_STEP_KEY) };
  }
  if (!uid) return { seen: true, step: null }; // not signed in yet — nothing to show

  if (readLocal(seenKey(uid)) === '1') return { seen: true, step: null };

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const data = snap.data();
    const seen = !!data?.interviewSeenAt;
    const step = (data?.interviewStep as string | undefined) || null;
    if (seen) writeLocal(seenKey(uid), '1');
    return { seen, step };
  } catch {
    // Offline / read failed — same call tour.ts makes: treat as seen rather
    // than risk re-showing a long interview on every load of a flaky connection.
    // It stays reachable any time from Hub settings.
    return { seen: true, step: null };
  }
}

/** Record which question to reopen on next time — called after every answer. */
export async function saveInterviewStep(uid: string | null, demo: boolean, step: string): Promise<void> {
  if (demo) {
    writeLocal(DEMO_STEP_KEY, step);
    return;
  }
  if (!uid) return;
  writeLocal(stepKey(uid), step);
  try {
    await setDoc(doc(db, 'users', uid), { interviewStep: step }, { merge: true });
  } catch {
    // Best-effort — the local cache above still lets THIS device resume correctly.
  }
}

/** Mark the interview as done (finished OR explicitly skipped — both count as "seen"). */
export async function markInterviewSeen(uid: string | null, demo: boolean): Promise<void> {
  if (demo) {
    writeLocal(DEMO_SEEN_KEY, '1');
    return;
  }
  if (!uid) return;
  writeLocal(seenKey(uid), '1');
  try {
    await setDoc(doc(db, 'users', uid), { interviewSeenAt: new Date().toISOString() }, { merge: true });
  } catch {
    // Local cache above already prevents an immediate re-show on this device.
  }
}

/** Explicit replay ("Redo the guided setup" in Hub settings): clears the local
 * cache so getInterviewState() re-checks honestly, but FamilyInterview actually
 * force-restarts via a bump key rather than waiting on this — see its
 * `forceKey` prop (mirrors clearTourSeenCache/forceKey in tour.ts/FirstRunTour.tsx). */
export function clearInterviewSeenCache(uid: string | null, demo: boolean): void {
  if (demo) {
    removeLocal(DEMO_SEEN_KEY);
    removeLocal(DEMO_STEP_KEY);
    return;
  }
  if (!uid) return;
  removeLocal(seenKey(uid));
  removeLocal(stepKey(uid));
}
