import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '../i18n/LangContext';

/**
 * Surfaces a small non-blocking "New version available · Refresh" toast when the
 * deployed build differs from the one this tab is running. Deliberately never
 * auto-reloads — only a user tap calls location.reload(), so there is no
 * reload-loop risk (nothing here can retrigger itself).
 *
 * How it knows: vite.config.ts bakes a build stamp into the bundle
 * (__APP_VERSION__) and emits the same stamp to dist/version.json. This polls
 * version.json (uncached) and compares. In local dev there is no deployed
 * version.json, so the check simply never fires.
 */
const CURRENT_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const POLL_MS = 3 * 60 * 1000; // every 3 min while the tab is visible
const FIRST_CHECK_MS = 15 * 1000; // let the app settle before the first check

// Marks the navigation the Refresh button performs, so it can be tidied out of
// the address bar once the new build is running.
const BUST_PARAM = 'u';

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
 * worker deliberately caches nothing, but this button is where someone will
 * come when a future one does.
 */
async function applyUpdate() {
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

export default function UpdateBanner() {
  const { t } = useT();
  const [updateReady, setUpdateReady] = useState(false);
  const [label, setLabel] = useState('');
  const [changes, setChanges] = useState<string[]>([]);

  // Tidy the cache-busting parameter out of the address bar. It has already
  // done its job by the time this runs — the fresh index.html was fetched — and
  // leaving it behind would follow the user into anything they bookmark or
  // share. replaceState, so it doesn't add a history entry to go "back" to.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(BUST_PARAM)) return;
    url.searchParams.delete(BUST_PARAM);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    // No deployed version.json to compare against during local dev.
    if (CURRENT_VERSION === 'dev') return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function check() {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string | null; label?: string; changes?: string[] };
        if (
          !cancelled &&
          data?.version &&
          data.version !== CURRENT_VERSION
        ) {
          setUpdateReady(true);
          setLabel(typeof data.label === 'string' ? data.label : '');
          setChanges(Array.isArray(data.changes) ? data.changes.slice(0, 6) : []);
          // A newer build is out — stop polling; the banner now stays until the
          // user chooses to refresh.
          if (interval) clearInterval(interval);
        }
      } catch {
        // Offline or transient failure — ignore; the next tick retries.
      }
    }

    // A new build most often lands while the tab sits in the background, so
    // check on focus/visibility as well as on the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    interval = setInterval(check, POLL_MS);
    const firstCheck = setTimeout(check, FIRST_CHECK_MS);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (interval) clearInterval(interval);
      clearTimeout(firstCheck);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-[9999] flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex flex-col gap-4 rounded-2xl bg-ink-900 text-white p-6 shadow-lift w-full max-w-md">
        <p className="text-[17px] font-semibold leading-snug">
          {t.update_available}{label ? ` (${label})` : ''}.
        </p>
        <button
          onClick={applyUpdate}
          className="self-start inline-flex items-center gap-2 rounded-xl bg-white text-ink-900 text-[14px] font-semibold px-5 py-2.5 hover:bg-cream-100 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          {t.update_refresh}
        </button>
        {changes.length > 0 && (
          <ul className="space-y-2">
            {changes.map((c, i) => (
              <li key={i} className="text-[13.5px] text-white/70 leading-snug flex gap-2">
                <span className="text-white/40" aria-hidden="true">·</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
