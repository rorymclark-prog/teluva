/* Getting onto a newly deployed build, and knowing whether you are on one.
 *
 * WHY THIS IS A SHARED UTILITY AND NOT JUST UpdateBanner's PRIVATE BUSINESS
 * -------------------------------------------------------------------------
 * The banner only ever appears in one situation: the app is OPEN when a deploy
 * lands, and stays open at least until the next poll. Anyone who habitually
 * closes the app and reopens it — which is most people on a phone, and was the
 * first real user — gets the new build directly on reopen, so there is nothing
 * to announce and the banner correctly never shows. That is right, and it is
 * also completely useless as an answer to "did the update arrive?", which is
 * the question people actually have. Settings therefore asks on demand, using
 * exactly the same comparison, and the logic lives here so the two can never
 * drift into disagreeing about what "latest" means.
 */

// The build stamp baked into THIS bundle by vite.config.ts. In dev there is no
// deployed version.json to compare against, so every check short-circuits.
export const CURRENT_BUILD =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Marks the navigation applyUpdate performs, so UpdateBanner can tidy it out of
// the address bar once the new build is running.
export const BUST_PARAM = 'u';

export interface DeployedVersion {
  version: string | null;
  label: string;
  changes: string[];
}

/**
 * What build is the server serving right now?
 *
 * `cache: 'no-store'` plus a cache-busting query: the server already sends
 * no-store for this file, but a tab that has been open for hours across a flaky
 * connection is exactly where a stale intermediary bites, and being wrong here
 * means telling someone they are up to date when they are not.
 */
export async function fetchDeployedVersion(): Promise<DeployedVersion | null> {
  try {
    const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DeployedVersion>;
    return {
      version: typeof data?.version === 'string' ? data.version : null,
      label: typeof data?.label === 'string' ? data.label : '',
      changes: Array.isArray(data?.changes) ? data.changes.filter((c): c is string => typeof c === 'string') : [],
    };
  } catch {
    // Offline or transient — indistinguishable from "no answer", and callers
    // must treat that as "don't know" rather than "up to date".
    return null;
  }
}

/**
 * Is there a newer build than the one running?
 *
 * Returns null when we could not find out (offline, or dev). Callers MUST
 * distinguish that from `false` — "I couldn't check" and "you're current" look
 * the same to a user only if we let them.
 */
export async function checkForUpdate(): Promise<{ updateAvailable: boolean; deployed: DeployedVersion } | null> {
  if (CURRENT_BUILD === 'dev') return null;
  const deployed = await fetchDeployedVersion();
  if (!deployed?.version) return null;
  return { updateAvailable: deployed.version !== CURRENT_BUILD, deployed };
}

/* RETIRED ADDRESSES
 * -----------------
 * Teluva was called family-info-organizer, and the rename created a SECOND
 * Cloud Run service rather than moving the first. Every release since then went
 * to the new one; the old service kept running, kept answering, and kept
 * serving the build it was last given — for weeks. An app installed from the
 * old address is a fully working Teluva that is simply frozen in the past, and
 * NOTHING above can detect that: this file compares the running bundle against
 * /version.json from the SAME host, and an old service is perfectly consistent
 * with itself. It reports "you are up to date" and it is telling the truth.
 *
 * The cost of that gap was a week of shipped work that the person who asked for
 * it could not see, and three wrong explanations of why, because every part of
 * the update machinery was working correctly and saying so.
 *
 * So the address itself has to be checked, and it is a DENY-list on purpose.
 * An allow-list of "good" hosts would flag every future custom domain as
 * retired the day it is set up — a false alarm on this banner is worse than a
 * missed one, because it teaches people to ignore it. A retired name is a fact
 * we know; a current one is not.
 */
const RETIRED_HOST_PREFIXES: { prefix: string; replacement: string }[] = [
  { prefix: 'family-info-organizer', replacement: 'teluva' },
];

/**
 * If this page is being served from an address we have moved away from, returns
 * where it should be instead. Returns null in every other case, including
 * localhost and any host we have no specific knowledge about.
 */
export function retiredAddress(host: string = window.location.host): string | null {
  for (const { prefix, replacement } of RETIRED_HOST_PREFIXES) {
    // Anchored at the start and followed by a hyphen or the end of the label:
    // matching loosely could rewrite a host that merely contains the old name.
    if (host === prefix || host.startsWith(`${prefix}-`) || host.startsWith(`${prefix}.`)) {
      return `${replacement}${host.slice(prefix.length)}`;
    }
  }
  return null;
}

/**
 * Actually get onto the new build.
 *
 * `location.reload()` was not enough, and the reason is a trap: the hashed
 * bundles are immutable and fine, but the page that POINTS at them is
 * index.html — and a reload is allowed to satisfy that from cache. An installed
 * app window is the worst case for this. So the banner would appear, the button
 * would visibly reload, the same old index.html would come back, and it would
 * name the same old bundle. Nothing changed, and the banner returned. From the
 * outside the button simply does not work.
 *
 * A navigation to a URL that has never been requested before cannot be served
 * from cache, so a throwaway query parameter forces a genuine fetch. replace()
 * rather than assign() keeps it out of the back history.
 *
 * Caches are cleared first as a belt-and-braces measure. Today the service
 * worker now caches a versioned emergency shell (see public/sw.js), so clearing
 * it here also guarantees the reload cannot revive an older shell. A family
 * can re-verify its saved pack from Emergency after the new build opens.
 */
export async function applyUpdate(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* cache API unavailable or blocked — the query bust still works */ }

  const url = new URL(window.location.href);
  url.searchParams.set(BUST_PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
}
