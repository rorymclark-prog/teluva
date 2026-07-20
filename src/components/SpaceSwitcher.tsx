import { useEffect, useRef, useState } from 'react';
import { Users, Briefcase, User, ChevronDown, Check, Loader2, Plus, X } from 'lucide-react';
import { SpaceMembership, SpaceType } from '../types';

const TYPE_ICON: Record<SpaceType, typeof Users> = { family: Users, business: Briefcase, personal: User };
const TYPE_LABEL: Record<SpaceType, string> = { family: 'Family', business: 'Business', personal: 'Personal' };

/**
 * Switch the active space (Family / Business / Personal), and create a new
 * Business space. Always renders — even with one space — so "create a
 * business" is discoverable; it's just a plain button until a second space
 * actually exists, at which point it becomes a real switcher too.
 */
export default function SpaceSwitcher({ spaces, activeId, canCreate, onSwitch, onCreate }: {
  spaces: SpaceMembership[];
  activeId: string | null;
  canCreate: boolean;
  onSwitch: (spaceId: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = async (spaceId: string) => {
    if (spaceId === activeId || busy) return;
    setBusy(true); setError(null);
    try {
      await onSwitch(spaceId);
      // onSwitch reloads the app on success — nothing more to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch space.');
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true); setError(null);
    try {
      await onCreate(name);
      // onCreate reloads the app on success — nothing more to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the business.');
      setBusy(false);
    }
  };

  const active = spaces.find((s) => s.id === activeId) || spaces[0];
  const ActiveIcon = active ? (TYPE_ICON[active.type] || Users) : Briefcase;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 bg-cream-200 hover:bg-cream-300 text-ink-800 font-semibold text-[12.5px] rounded-xl pl-2.5 pr-2 py-1.5 transition-colors cursor-pointer disabled:opacity-60"
        title="Switch space"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ActiveIcon className="w-3.5 h-3.5 shrink-0" />}
        <span className="max-w-[8rem] truncate">{active?.name || TYPE_LABEL[active?.type || 'family']}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute left-0 mt-2 w-64 bg-white rounded-2xl border border-cream-300 shadow-lift p-1.5 z-50">
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

          {canCreate && (
            <>
              <div className="my-1.5 border-t border-cream-200" />
              {creating ? (
                <div className="p-2 space-y-2">
                  <input
                    type="text"
                    autoFocus
                    placeholder="e.g. Bhanu Pty"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
                    className="field w-full text-[13px]"
                    disabled={busy}
                  />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => { setCreating(false); setNewName(''); }} disabled={busy} className="btn-quiet text-[12px] px-2.5 py-1.5 flex-1">Cancel</button>
                    <button type="button" onClick={() => void create()} disabled={busy || !newName.trim()} className="btn-primary text-[12px] px-2.5 py-1.5 flex-1 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold text-clay-600 hover:bg-clay-50 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>Create a business</span>
                </button>
              )}
            </>
          )}

          {error && (
            <div className="flex items-start gap-1.5 mt-1 px-2.5 py-1.5 text-[11px] text-rosa-600">
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)}><X className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
