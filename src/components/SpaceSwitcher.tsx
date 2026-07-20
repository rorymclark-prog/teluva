import { useEffect, useRef, useState } from 'react';
import { Users, Briefcase, User, ChevronDown, Check, Loader2 } from 'lucide-react';
import { SpaceMembership, SpaceType } from '../types';

const TYPE_ICON: Record<SpaceType, typeof Users> = { family: Users, business: Briefcase, personal: User };
const TYPE_LABEL: Record<SpaceType, string> = { family: 'Family', business: 'Business', personal: 'Personal' };

/**
 * A small dropdown to switch the active space (family / business / personal).
 * Renders NOTHING when there's only one space — invisible for every account
 * until a second space actually exists (Business Hub P4), so this ships inert
 * and harmless ahead of that.
 */
export default function SpaceSwitcher({ spaces, activeId, onSwitch }: {
  spaces: SpaceMembership[];
  activeId: string | null;
  onSwitch: (spaceId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (spaces.length <= 1) return null;

  const active = spaces.find((s) => s.id === activeId) || spaces[0];
  const ActiveIcon = TYPE_ICON[active.type] || Users;

  const pick = async (spaceId: string) => {
    if (spaceId === activeId || switching) return;
    setSwitching(true); setError(null);
    try {
      await onSwitch(spaceId);
      // onSwitch reloads the app on success — nothing more to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch space.');
      setSwitching(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 bg-cream-200 hover:bg-cream-300 text-ink-800 font-semibold text-[12.5px] rounded-xl pl-2.5 pr-2 py-1.5 transition-colors cursor-pointer disabled:opacity-60"
        title="Switch space"
      >
        {switching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ActiveIcon className="w-3.5 h-3.5 shrink-0" />}
        <span className="max-w-[8rem] truncate">{active.name || TYPE_LABEL[active.type]}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {error && <p className="absolute top-full mt-1 left-0 text-[11px] text-rosa-600 bg-white px-2 py-1 rounded-lg shadow-soft whitespace-nowrap z-50">{error}</p>}

      {open && (
        <div role="menu" className="absolute left-0 mt-2 w-52 bg-white rounded-2xl border border-cream-300 shadow-lift p-1.5 z-50">
          {spaces.map((s) => {
            const Icon = TYPE_ICON[s.type] || Users;
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); void pick(s.id); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold transition-colors cursor-pointer ${isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-cream-100'}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">{s.name || TYPE_LABEL[s.type]}</span>
                {isActive && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
