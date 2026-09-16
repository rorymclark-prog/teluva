import { useEffect, useState } from 'react';
import { X, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

/**
 * The full "what's new" log — every released version by name, newest first.
 *
 * The update banner shows only the release you just received, once, and then
 * it's gone; nothing in the app let you read back what changed in v273 or
 * check which version introduced a thing. This panel answers that from
 * /changelog.json, a static file the release process prepends to (enforced by
 * changelogFresh.test.ts, which fails the build if the top entry doesn't match
 * CHANGES.json — the same guard that keeps the banner honest).
 *
 * Fetched lazily on open, not bundled: the log grows forever (150+ versions
 * already) and belongs in the HTTP cache, not in every page load's JS.
 */

interface ChangelogEntry {
  label: string;
  date: string; // YYYY-MM-DD (release day)
  changes: string[];
}

// 154 entries render fine, but nobody arrives wanting v100 — show the recent
// past and let one tap open the rest.
const INITIAL_COUNT = 20;

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function WhatsNewLog({ onClose, currentLabel }: { onClose: () => void; currentLabel: string }) {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useBodyScrollLock(true);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetch('/changelog.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data)) throw new Error('bad shape');
        setEntries(
          data.filter(
            (e): e is ChangelogEntry =>
              !!e && typeof e.label === 'string' && Array.isArray(e.changes)
          )
        );
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const visible = entries ? (showAll ? entries : entries.slice(0, INITIAL_COUNT)) : [];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-ink-900/45 p-0 sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="What's new in Teluva"
        className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl sm:rounded-3xl bg-cream-50 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-cream-200 px-5 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="h-4 w-4 shrink-0 text-clay-600" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-ink-800 leading-tight">What&rsquo;s new</h2>
              <p className="text-[12px] text-ink-400 leading-tight">You&rsquo;re on {currentLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close what's new"
            className="shrink-0 rounded-full p-2 text-ink-400 hover:bg-cream-100 hover:text-ink-700 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {failed && (
            <p className="text-[13px] text-ink-500">
              Couldn&rsquo;t load the version log — check your connection and reopen this panel.
            </p>
          )}
          {!failed && !entries && (
            <p className="flex items-center gap-2 text-[13px] text-ink-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
            </p>
          )}
          {entries && (
            <ol className="space-y-5">
              {visible.map((e) => (
                <li key={e.label}>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[13.5px] font-bold text-ink-800 tabular-nums">
                      {e.label}
                      {e.label === currentLabel && (
                        <span className="ml-2 rounded-full bg-sage-100 px-2 py-0.5 text-[10.5px] font-semibold text-sage-700 align-middle">
                          current
                        </span>
                      )}
                    </h3>
                    <span className="text-[11.5px] text-ink-400">{formatDate(e.date)}</span>
                  </div>
                  <ul className="mt-1.5 space-y-1.5">
                    {e.changes.map((c, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink-600">
                        <span className="text-ink-300" aria-hidden="true">·</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {!showAll && entries.length > INITIAL_COUNT && (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-800 cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Show all {entries.length} versions
                  </button>
                </li>
              )}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
