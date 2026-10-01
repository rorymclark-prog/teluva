import { useEffect, useState } from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { CURRENT_BUILD, BUST_PARAM, fetchDeployedVersion, retiredAddress } from '../utils/appUpdate';

/**
 * Two cards, both rare, neither ever a "refresh now" prompt:
 *   - 'retired': this app was installed from an address we no longer deploy to.
 *   - 'updated': opt-in "here is what changed" after a cold start on a new build.
 *
 * The "new version available — Refresh" card that used to live here is GONE. It
 * floated over whatever the person was doing, could not be dismissed, and a tap
 * reloaded the whole page; it was reported as constant, annoying refreshes and
 * showed up in the logs of a phone that ended on Safari's crash-loop page. A
 * pending update is now quiet state (utils/updateStatus.ts) surfaced as a dot
 * and an "Update ready" row in the section menu, and nothing reloads until the
 * person taps that row.
 */

/**
 * WHO ACTUALLY WANTS THE "HERE IS WHAT CHANGED" CARD.
 *
 * Rory: "did we say that we should show updates? i want to see them but i
 * dont want others to necessarily see them."
 *
 * Fair, and the arithmetic settles it: four versions shipped in one day, so a
 * beta user who opens the app each morning gets a changelog card every time.
 * That is a developer's diary presented as news.
 *
 * The retrospective "you just updated, here is what changed" card is opt-in.
 * "Your app is stale" is not a card at all any more: it is a dot and an
 * "Update ready" row in the section menu (utils/updateStatus.ts), which a
 * person opens when they choose to.
 *
 * localStorage rather than a profile setting on purpose: it is per-device,
 * which is exactly the grain of "show it on MY phone". Nothing to sync, and
 * nothing about it belongs in anybody's family vault. Default off — the full
 * log stays one tap away in Settings → What's new for anyone curious, so
 * turning this off hides the interruption, not the information.
 */
const SHOW_CHANGES_KEY = 'teluva:showUpdateNotes';

export function showsUpdateNotes(): boolean {
  try { return localStorage.getItem(SHOW_CHANGES_KEY) === '1'; } catch { return false; }
}
export function setShowsUpdateNotes(on: boolean) {
  try { localStorage.setItem(SHOW_CHANGES_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

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
 * here is what changed". That fires on exactly the sessions the background
 * check cannot catch — a cold start after an update — by remembering the last build this
 * device ran and noticing it differs. No polling, no timers, no visibility
 * dependency; it is decided before the first paint.
 */
type Mode = 'none' | 'updated' | 'retired';

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
  const [mode, setMode] = useState<Mode>(MOVED_TO ? 'retired' : 'none');
  const [label, setLabel] = useState('');
  const [changes, setChanges] = useState<string[]>([]);

  // "You just updated" — decided on mount from what this device last ran.
  //
  // Runs before any network call, so it is unaffected by being offline.
  useEffect(() => {
    if (CURRENT_BUILD === 'dev' || MOVED_TO) return;
    const last = readLastSeen();
    writeLastSeen(CURRENT_BUILD);
    // No stored value = first ever launch on this device. Announcing "updated"
    // to someone who has never run it before would be a lie, so stay silent.
    if (!last || last === CURRENT_BUILD) return;
    /* The build stamp above is still written every launch, so turning the
       card on later does not produce a spurious "you just updated" for a
       version this device has been running for a week. */
    if (!showsUpdateNotes()) return;

    setMode('updated');
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
            : `Updated${label ? ` to ${label}` : ''} — here's what's new.`}
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
            already running. Its button dismisses; 'retired' goes somewhere
            else entirely. Nothing on this card reloads the page in place. */}
        <button
          onClick={
            mode === 'retired'
              ? () => { window.location.href = `https://${MOVED_TO}${window.location.pathname}`; }
              : () => setMode('none')
          }
          className="shrink-0 self-start inline-flex items-center gap-2 rounded-xl bg-white text-ink-900 text-[14px] font-semibold px-5 py-2.5 hover:bg-cream-100 transition-colors cursor-pointer"
        >
          {mode === 'retired' ? <ArrowRight className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          {mode === 'retired' ? 'Go to the new Teluva' : 'Got it'}
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
