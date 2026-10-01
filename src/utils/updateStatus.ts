import { useSyncExternalStore } from 'react';
import { CURRENT_BUILD, fetchDeployedVersion } from './appUpdate';

/**
 * "Is a newer build out?" as quiet state, not an interruption.
 *
 * This used to live inside UpdateBanner, which turned every positive answer into
 * a card floating over whatever the person was doing, with a Refresh button and
 * no way to dismiss it. On a phone that card re-appeared after each deploy,
 * sat on top of the screen being worked in (Maria was adding a password), and
 * tapping it reloads the whole page — three times in six minutes in the request
 * logs on 2026-09-30, ending in Safari's "A problem repeatedly occurred". Her
 * words: annoyed by the constant update refreshes.
 *
 * So the check keeps running exactly as before, and its answer goes somewhere
 * the person chooses to look: a dot on the menu button and an "Update ready"
 * row inside the menu (SectionMenu). Nothing here reloads anything, ever — only
 * a tap on that row calls applyUpdate().
 *
 * One shared store rather than per-component state, so the menu button's dot
 * and the row inside it can never disagree, and there is exactly one poll
 * however many components read it. The poll runs only while something is
 * subscribed.
 */
export interface UpdateStatus {
  available: boolean;
  label: string;
  changes: string[];
}

const NONE: UpdateStatus = { available: false, label: '', changes: [] };

const POLL_MS = 3 * 60 * 1000; // every 3 min while the tab is visible
// One second, not fifteen: the check is a ~3KB same-origin GET that touches no
// app state, and a phone session is often shorter than the old delay.
const FIRST_CHECK_MS = 1000;

let status: UpdateStatus = NONE;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function publish(next: UpdateStatus) {
  status = next;
  listeners.forEach((l) => l());
}

async function check() {
  if (document.visibilityState !== 'visible') return;
  try {
    const data = await fetchDeployedVersion();
    // STRICTLY NEWER, not merely different. During a Cloud Run rollout two
    // revisions serve the same URL for a while, so a tab already on the new
    // build can poll a draining old instance and be told it is behind. Both
    // stamps are millisecond timestamps, so a numeric comparison is the fix.
    if (data?.version && Number(data.version) > Number(CURRENT_BUILD)) {
      publish({ available: true, label: data.label || '', changes: data.changes.slice(0, 6) });
    }
    // Deliberately no branch that clears `available`: once a newer build has
    // been seen this tab is behind for good, and a later poll that lands on a
    // draining older instance must not make the row flicker away.
  } catch {
    // Offline or transient — the next tick retries.
  }
}

function start() {
  // No deployed version.json to compare against during local dev.
  if (CURRENT_BUILD === 'dev') return () => {};
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(check, POLL_MS);
  const first = setTimeout(check, FIRST_CHECK_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    clearTimeout(first);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) stop = start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stop?.(); stop = null; }
  };
}

const getSnapshot = () => status;

export function useUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(subscribe, getSnapshot, () => NONE);
}
