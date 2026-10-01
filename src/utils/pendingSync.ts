// Tracks which of this device's local edits have NOT yet reached Firestore,
// so a later successful LOAD never blindly overwrites localStorage with
// older server data and silently throws the unsynced edit away.
//
// THE BUG THIS CLOSES
// --------------------
// Every save function in db.ts already does the right thing when the cloud
// write fails: it keeps writing the new value into localStorage regardless
// (see saveFamilyMembers/saveCalendarEvents/saveReferenceDoc — "Always keep
// local storage updated"). That part was never the problem.
//
// The problem was on the READ side. The next time this device successfully
// LOADS that same data — reopening the app once back online, a remount, a
// tab regaining focus — the loader fetches the server's copy (which never
// received the failed write) and does an unconditional
// `localStorage.setItem(key, JSON.stringify(serverData))`. That overwrites
// the correct-but-unsynced edit with the older, wrong one, with nothing to
// reconcile it and no error anywhere. The edit is gone, not just from the
// server — from the device too.
//
// THE FIX
// -------
// A save that fails to reach the cloud marks its key "dirty". A loader
// checks that flag BEFORE it would overwrite localStorage: if dirty, it
// doesn't trust the server read — it re-attempts the save with what's
// currently cached locally instead (see resyncIfDirty in db.ts). Only a
// save that actually reaches Firestore clears the flag. This means a loader
// can never regress a still-unsynced edit, no matter how many times it runs
// while the device stays offline.
//
// Deliberately NOT a general offline queue (no batching, no background
// retry timer, no cross-tab coordination) — the existing load-triggers
// (reopen, reconnect, remount) already provide enough retry opportunities
// for a vault that a family checks throughout the day, and a bigger queue
// is real complexity to get right in a place where getting it wrong risks
// making data loss worse, not better.

const dirtyKey = (docKey: string, familyId: string) => `family_pending_v1_${docKey}_${familyId}`;

export function markDirty(docKey: string, familyId: string): void {
  try { localStorage.setItem(dirtyKey(docKey, familyId), '1'); } catch { /* private mode — best effort */ }
}

export function clearDirty(docKey: string, familyId: string): void {
  try { localStorage.removeItem(dirtyKey(docKey, familyId)); } catch { /* ignore */ }
}

export function isDirty(docKey: string, familyId: string): boolean {
  try { return localStorage.getItem(dirtyKey(docKey, familyId)) === '1'; } catch { return false; }
}

const googleRemovalKey = (familyId: string) => `family_calendarRemovedGoogle_v1_${familyId}`;
export function readGoogleRemovals(familyId: string): string[] {
  try { const value = JSON.parse(localStorage.getItem(googleRemovalKey(familyId)) || '[]'); return Array.isArray(value) ? value.filter(id => typeof id === 'string' && id.startsWith('gcal-')) : []; } catch { return []; }
}
export function rememberGoogleRemovals(familyId: string, ids: readonly string[]): string[] {
  const pending = [...new Set([...readGoogleRemovals(familyId), ...ids.filter(id => id.startsWith('gcal-'))])];
  try { localStorage.setItem(googleRemovalKey(familyId), JSON.stringify(pending)); } catch { /* best effort */ }
  return pending;
}
export function acknowledgeGoogleRemovals(familyId: string, applied: readonly string[]): void {
  const done = new Set(applied);
  try { localStorage.setItem(googleRemovalKey(familyId), JSON.stringify(readGoogleRemovals(familyId).filter(id => !done.has(id)))); } catch { /* keep intent */ }
}
