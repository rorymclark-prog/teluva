import React, { useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Check, Search, X } from 'lucide-react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface NavView {
  id: string;
  icon: ElementType;
  label: string;
}

interface Props {
  views: NavView[];
  current: string;
  onSelect: (id: string) => void;
}

/**
 * Section navigation.
 *
 * Twenty-one sections in one flat list was a scroll with no map: you had to
 * already know the app to find anything, and on a phone the panel was capped at
 * 32rem, so most of it sat below a fold with nothing on screen saying so.
 *
 * Two changes that only work together. Grouping ALONE makes the scrolling
 * worse — six headers cost more height than demoting a couple of items saves —
 * so the phone layout is now a bottom sheet at 85% of the screen, where the
 * list is visibly cut mid-item and the sheet's own edges say there is more.
 *
 * A filter sits above it. Past about fifteen destinations, typing three letters
 * beats reading, which is how Raycast, Linear and Slack all resolve breadth. It
 * degrades gracefully: the grouped list is still right there underneath.
 *
 * Deliberately NOT a "scroll down!" prompt. A nag that fires once or twice is a
 * patch over a panel that fails to show its own scrollability — fix the panel.
 */

/**
 * Sections in the order a household thinks about them, rather than the order
 * they happened to be built in. Anything not listed here falls into "More", so
 * a newly added ViewId can never silently vanish from the menu.
 */
const GROUPS: { title: string; ids: string[] }[] = [
  { title: '', ids: ['profiles', 'emergency'] }, // pinned, no header — the two you reach for
  { title: 'Everyday', ids: ['calendar', 'shopping', 'chat', 'recipes'] },
  { title: 'Documents & IDs', ids: ['vault', 'info', 'passwords', 'drive'] },
  { title: 'Money & cover', ids: ['finances', 'insurance', 'slips', 'willsEstate'] },
  { title: 'Home & things', ids: ['household', 'vehicles', 'assets'] },
  // Pets sit with the family, not with the boiler and the car. They were
  // reachable only from inside Household until Rory pointed out that nobody
  // looks for the dog under "property details".
  { title: 'Family', ids: ['pets', 'extendedBirthdays', 'familyTree'] },
  { title: 'Memories', ids: ['timeline', 'travelTimeline', 'familyWords', 'anniversaries', 'inMemory'] },
];

/** One destination. Module-level so React sees a stable component type. */
interface RowProps { v: NavView; active: boolean; onPick: () => void }

const Row: React.FC<RowProps> = ({ v, active, onPick }) => {
  const Icon = v.icon;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-semibold transition-colors cursor-pointer ${
        active ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-cream-100'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left">{v.label}</span>
      {active && <Check className="w-4 h-4 shrink-0" />}
    </button>
  );
};

export default function SectionMenu({ views, current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // The phone sheet is PORTALLED to <body>, so it is not a DOM descendant of
  // `ref` even though it is one in the React tree. Without a second ref
  // pointing at the sheet itself, the close-on-outside-click handler below
  // counted every tap inside the sheet as a tap outside it: mousedown fired,
  // setOpen(false) unmounted the sheet, and the `click` that would have run
  // the row's onSelect never landed on anything. The menu closed and the
  // section never changed — on a phone only, because the desktop popover is
  // rendered inline inside `ref` and so was always correctly "inside".
  const sheetRef = useRef<HTMLDivElement>(null);
  const currentView = views.find((v) => v.id === current);

  // The phone bottom sheet below is a `fixed inset-0` overlay portalled to
  // <body>; without this, iOS Safari lets the page behind it pan/rubber-band
  // while the sheet is open, and the scroll position can desync on close.
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inside = ref.current?.contains(t) || sheetRef.current?.contains(t);
      if (!inside) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reopening should never drop you into a stale search.
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return views.filter((v) => v.label.toLowerCase().includes(q));
  }, [views, query]);

  /* Derived from the ALREADY-FILTERED views the caller passes in, with empty
     groups dropped — a business space hides every Memories section, and a lone
     "Memories" header over nothing reads as a bug. */
  const grouped = useMemo(() => {
    const byId = new Map(views.map((v) => [v.id, v]));
    const placed = new Set<string>();
    const out = GROUPS.map((g) => {
      const items = g.ids.map((id) => byId.get(id)).filter(Boolean) as NavView[];
      items.forEach((i) => placed.add(i.id));
      return { title: g.title, items };
    }).filter((g) => g.items.length > 0);

    const leftovers = views.filter((v) => !placed.has(v.id));
    if (leftovers.length) out.push({ title: 'More', items: leftovers });
    return out;
  }, [views]);

  const list = (
    <>
      <div className="relative shrink-0 px-1.5 pt-1.5">
        <Search className="pointer-events-none absolute left-4 top-1/2 w-4 h-4 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sections"
          aria-label="Search sections"
          className="field w-full pl-9"
        />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-1.5">
        {filtered ? (
          filtered.length ? (
            filtered.map((v) => <Row key={v.id} v={v} active={v.id === current} onPick={() => { onSelect(v.id); setOpen(false); }} />)
          ) : (
            <p className="px-3 py-6 text-center text-[13px] text-ink-400">Nothing called &ldquo;{query}&rdquo;.</p>
          )
        ) : (
          grouped.map((g) => (
            <div key={g.title || 'pinned'} className="mb-1">
              {g.title && (
                <p className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">
                  {g.title}
                </p>
              )}
              {g.items.map((v) => <Row key={v.id} v={v} active={v.id === current} onPick={() => { onSelect(v.id); setOpen(false); }} />)}
            </div>
          ))
        )}
      </div>
    </>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={currentView?.label ? `Sections — you're in ${currentView.label}` : 'Sections'}
        aria-label={currentView?.label ? `Sections. Current: ${currentView.label}` : 'Sections'}
        className="flex items-center justify-center min-w-[44px] min-h-[44px] bg-cream-200 hover:bg-cream-300 text-ink-800 rounded-2xl transition-colors cursor-pointer"
      >
        <Menu className="w-5 h-5 shrink-0" />
      </button>

      {/* Desktop: an anchored popover, right-aligned so it cannot run off screen. */}
      {open && (
        <div
          role="menu"
          className="hidden sm:flex sm:flex-col absolute right-0 sm:right-auto sm:left-0 mt-2 w-72 max-h-[min(75vh,44rem)] bg-white rounded-2xl border border-cream-300 shadow-lift z-50"
        >
          {list}
        </div>
      )}

      {/* Phone: a bottom sheet at 85% of the screen.
          Portalled to <body> deliberately. This menu renders inside a header
          carrying `backdrop-blur`, and a filter creates a containing block for
          fixed descendants — a `fixed inset-x-0 bottom-0` child would position
          against the header instead of the viewport and never reach the bottom
          of the screen. */}
      {open && createPortal(
        <div className="sm:hidden">
          <div
            className="fixed inset-0 z-[55] bg-ink-900/25 anim-fade"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            role="menu"
            className="fixed inset-x-0 bottom-0 z-[60] flex h-[85dvh] flex-col rounded-t-3xl border-t border-cream-300 bg-white shadow-lift anim-sheet"
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-1">
              <p className="text-[13px] font-bold uppercase tracking-wider text-ink-400">Sections</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex min-w-[44px] min-h-[44px] items-center justify-center rounded-full text-ink-400 hover:bg-cream-100 hover:text-ink-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {list}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
