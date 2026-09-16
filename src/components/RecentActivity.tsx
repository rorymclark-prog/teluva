import { useEffect, useState } from 'react';
import { History, ChevronDown, ShieldCheck } from 'lucide-react';
import { loadActivity } from '../utils/db';
import { activityLabel, timeAgo, type ActivityEntry } from '../utils/activity';
import { useFamilyCtx } from '../contexts/FamilyContext';

const SHOWN = 6;

/**
 * What changed in this vault, and who changed it.
 *
 * The answer to "is there a family news feed?" — and deliberately not one. A
 * social feed makes a vault into somewhere you check for entertainment, and
 * then a photo of the dog competes with the will. This answers the genuinely
 * useful half of that question, "what happened while I was away", and does a
 * second job a feed never could: an entry nobody recognises is how you find
 * out something is wrong.
 *
 * Which is why the footer says "changes made in the app" rather than anything
 * that sounds like an audit log. Entries are written by the client, so a
 * modified one could omit them; what the rules guarantee is that an entry
 * cannot lie about who made it and cannot be edited afterwards. Claiming more
 * than that on screen would be the same failure as copy promising a
 * notification nothing sends.
 */
export default function RecentActivity() {
  const { role } = useFamilyCtx();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('teluva.activityCollapsed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;
    loadActivity(role)
      .then((e) => { if (!cancelled) setEntries(e); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [role]);

  const toggle = () => {
    const next = !collapsed;
    try { localStorage.setItem('teluva.activityCollapsed', next ? '1' : '0'); } catch { /* private mode */ }
    setCollapsed(next);
  };

  // A vault nobody has touched yet has nothing to say, and an empty card
  // saying so would be the first thing a new family saw.
  if (!entries || entries.length === 0) return null;

  const shown = showAll ? entries : entries.slice(0, SHOWN);
  const extra = entries.length - SHOWN;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show recent changes' : 'Collapse'}
        className={`w-full px-5 py-3.5 flex items-center gap-2 text-left transition-colors hover:bg-cream-50 cursor-pointer ${collapsed ? '' : 'border-b border-cream-200'}`}
      >
        <History className="w-4 h-4 text-clay-500 shrink-0" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">Recently changed</h3>
        <span className="chip bg-cream-200 text-ink-600 ml-auto">{entries.length}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-ink-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      <ul className={`divide-y divide-cream-100 ${collapsed ? 'hidden' : ''}`}>
        {shown.map((e) => (
          <li key={e.id} className="px-5 py-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] text-ink-800 font-medium">{activityLabel(e)}</p>
              <p className="text-[11.5px] text-ink-400 mt-0.5">
                {e.actorName} · {timeAgo(e.at)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {extra > 0 && !collapsed && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full px-5 py-2.5 text-[12.5px] font-semibold text-clay-600 hover:bg-cream-50 transition-colors text-center cursor-pointer"
        >
          {showAll ? 'Show less' : `Show all ${entries.length}`}
        </button>
      )}

      {!collapsed && (
        <div className="px-5 py-2.5 bg-cream-50 border-t border-cream-100 flex items-start gap-1.5">
          <ShieldCheck className="w-3 h-3 text-ink-300 mt-0.5 shrink-0" />
          <p className="text-[11px] text-ink-400 leading-relaxed">
            Changes made in the app. You only see entries for things you can open,
            and nobody &mdash; not even an owner &mdash; can edit this list afterwards.
          </p>
        </div>
      )}
    </div>
  );
}
