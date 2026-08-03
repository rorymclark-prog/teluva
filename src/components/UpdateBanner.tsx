import { useEffect, useState } from 'react';
import { RefreshCw, Check, ArrowRight } from 'lucide-react';
import { useT } from '../i18n/LangContext';
import { CURRENT_BUILD, BUST_PARAM, applyUpdate, fetchDeployedVersion, retiredAddress } from '../utils/appUpdate';

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
const POLL_MS = 3 * 60 * 1000; // every 3 min while the tab is visible
// One second, not fifteen. The old delay blinded roughly the first 20 seconds of
// every session once bundle download and parse are counted, and a phone session
// is often shorter than that. The check is a ~3KB same-origin GET that touches
// no app state, so there is nothing to "settle" before running it.
const FIRST_CHECK_MS = 1000;

// The build this device last actually RAN. Written on every launch; compared on
// the next one.
const LAST_SEEN_KEY = 'teluva:lastSeenBuild';

/**
 * WHY THERE ARE TWO REASONS THIS CARD APPEARS
 *
 * The original card answers "your open app is stale, tap to update". That is a
 * real situation, but it can only ever occur if a deploy lands WHILE the app is
 * open and it stays open for another poll. For anyone whose habit is to close
 * the app and reopen it — which is most people on a phone, and was the first
 * real user — every launch fetches the current build, the comparison always
 * matches, and the card correctly never shows. The mechanism works perfectly
 * and is invisible, which is indistinguishable from broken. It was reported as
 * broken three times.
 *
 * So the card also answers the opposite question: "you just got a new version,
 * here is what changed". That fires on exactly the sessions the poll cannot
 * catch — a cold start after an update — by remembering the last build this
 * device ran and noticing it differs. No polling, no timers, no visibility
 * dependency; it is decided before the first paint.
 */
type Mode = 'none' | 'available' | 'updated' | 'retired';

// The version check compares this bundle against /version.json from the SAME
// host, so an app opened at an address we no longer deploy to will report
// itself up to date forever — see retiredAddress() in utils/appUpdate.ts for
// the incident. This outranks every other mode: on a retired address, "you're
// on the latest" is the false statement, and moving is the only fix.
const MOVED_TO = retiredAddress();

function readLastSeen(): string | null {
  try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
}
function writeLastSeen(v: string) {
  try { localStorage.setItem(LAST_SEEN_KEY, v); } catch { /* private mode — the toast just won't fire */ }
}

export default function UpdateBanner() {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>(MOVED_TO ? 'retired' : 'none');
  const [label, setLabel] = useState('');
  const [changes, setChanges] = useState<string[]>([]);

  // "You just updated" — decided on mount from what this device last ran.
  //
  // Runs before any network call, so it is unaffected by being offline, and it
  // cannot fight the poll below: an 'available' state always wins, because a
  // pending update is more urgent than a past one (see the setMode guard there).
  useEffect(() => {
    if (CURRENT_BUILD === 'dev' || MOVED_TO) return;
    const last = readLastSeen();
    writeLastSeen(CURRENT_BUILD);
    // No stored value = first ever launch on this device. Announcing "updated"
    // to someone who has never run it before would be a lie, so stay silent.
    if (!last || last === CURRENT_BUILD) return;

    setMode((m) => (m === 'available' ? m : 'updated'));
    void fetchDeployedVersion().then((d) => {
      if (!d) return;
      setLabel(d.label || '');
      setChanges(d.changes.slice(0, 6));
    });
  }, []);

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
    //
    // And on a retired address the poll is worse than useless: this host's
    // version.json describes this host's frozen build, so the comparison
    // passes and the app quietly congratulates itself on being current.
    // Refreshing would not move anyone either — the fix is a different host.
    if (CURRENT_BUILD === 'dev' || MOVED_TO) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function check() {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const data = await fetchDeployedVersion();
        // STRICTLY NEWER, not merely different. During a Cloud Run rollout two
        // revisions serve the same URL for a while, so a tab already on the new
        // build can poll a draining old instance and be offered a DOWNGRADE —
        // which, tapped, reloads onto the older build and then offers the newer
        // one again, forever. Both stamps are millisecond timestamps, so a
        // numeric comparison is the whole fix.
        if (
          !cancelled &&
          data?.version &&
          Number(data.version) > Number(CURRENT_BUILD)
        ) {
          // A newer build is out. Keep polling rather than stopping here —
          // this tab can sit open for hours, and more builds can land in that
          // time (this happened in practice: the banner fired for v166, then
          // v167 and v168 shipped while the tab stayed open and focused, so
          // it never re-checked and kept showing v166's stale changelog).
          // Refreshing label/changes on every tick keeps the banner honest
          // about what "latest" actually means right up until the user taps
          // Refresh.
          setMode('available');   // outranks 'updated' — a pending update matters more than a past one
          setLabel(typeof data.label === 'string' ? data.label : '');
          setChanges(Array.isArray(data.changes) ? data.changes.slice(0, 6) : []);
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

  if (mode === 'none') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-[9999] flex justify-center px-4 pointer-events-none"
    >
      {/* Capped, with only the changelog scrolling.
        *
        * This card is anchored to the BOTTOM and grows upward, and it had no
        * height limit and nothing scrollable in it. Six changelog entries come
        * to roughly 730px; a phone shows about 650px. The heading and the
        * Refresh button sit at the TOP of the card, so they were pushed clean
        * off the top of the screen — and no amount of scrolling brought them
        * back, because there was no scroll container to scroll. The update was
        * unacceptable in the literal sense.
        *
        * Capping the card and letting only the list scroll pins the heading and
        * the button on screen at any content length, any text size. */}
      <div className="pointer-events-auto flex max-h-[min(75dvh,34rem)] w-full max-w-md flex-col gap-4 rounded-2xl bg-ink-900 p-6 text-white shadow-lift">
        <p className="shrink-0 text-[17px] font-semibold leading-snug">
          {mode === 'retired'
            ? 'Teluva has moved to a new address.'
            : mode === 'updated'
              ? `Updated${label ? ` to ${label}` : ''} — here's what's new.`
              : `${t.update_available}${label ? ` (${label})` : ''}.`}
        </p>
        {/* Not dismissible, and no changelog: on a retired address there is
            nothing new to list, and every update from here on lands somewhere
            this app cannot see. Saying it plainly is the whole point — this
            card exists because the app looked perfectly healthy for a week
            while none of the work reached the person who asked for it. */}
        {mode === 'retired' && (
          <p className="shrink-0 text-[13.5px] text-white/70 leading-snug">
            You're on the old web address. Everything here still works, but new
            versions are no longer sent to it — this app has been showing you an
            old Teluva. Open the new address and install it from there.
          </p>
        )}
        {/* The 'updated' card has nothing to refresh TO — the new build is
            already running. Its button dismisses; 'available' reloads;
            'retired' goes somewhere else entirely. */}
        <button
          onClick={
            mode === 'retired'
              ? () => { window.location.href = `https://${MOVED_TO}${window.location.pathname}`; }
              : mode === 'updated'
                ? () => setMode('none')
                : applyUpdate
          }
          className="shrink-0 self-start inline-flex items-center gap-2 rounded-xl bg-white text-ink-900 text-[14px] font-semibold px-5 py-2.5 hover:bg-cream-100 transition-colors cursor-pointer"
        >
          {mode === 'retired'
            ? <ArrowRight className="w-4 h-4" />
            : mode === 'updated'
              ? <Check className="w-4 h-4" />
              : <RefreshCw className="w-4 h-4" />}
          {mode === 'retired' ? 'Go to the new Teluva' : mode === 'updated' ? 'Got it' : t.update_refresh}
        </button>
        {changes.length > 0 && (
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
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
