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

export default function UpdateBanner() {
  const { t } = useT();
  const [updateReady, setUpdateReady] = useState(false);

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
        const data = (await res.json()) as { version?: string | null };
        if (
          !cancelled &&
          data?.version &&
          data.version !== CURRENT_VERSION
        ) {
          setUpdateReady(true);
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
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-ink-900 text-white pl-4 pr-2 py-2 shadow-lift">
        <span className="text-[13px] font-medium">{t.update_available}</span>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white text-ink-900 text-[13px] font-semibold px-3 py-1.5 hover:bg-cream-100 transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.update_refresh}
        </button>
      </div>
    </div>
  );
}
