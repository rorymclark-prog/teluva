import { useEffect, useRef, useState, type ElementType } from 'react';
import { Menu, ChevronDown, Check } from 'lucide-react';

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
 * Section navigation as a single burger dropdown — replaces the horizontally
 * scrolling pill rail so all sections are reachable in one tap with no sliding.
 * The trigger shows the CURRENT section so you always know where you are.
 */
export default function SectionMenu({ views, current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentView = views.find((v) => v.id === current);
  const CurrentIcon = currentView?.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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

      {open && (
        <div
          role="menu"
          className="absolute right-0 sm:right-auto sm:left-0 mt-2 w-60 max-h-[min(70vh,32rem)] overflow-y-auto bg-white rounded-2xl border border-cream-300 shadow-lift p-1.5 z-50"
        >
          {views.map((v) => {
            const Icon = v.icon;
            const active = v.id === current;
            return (
              <button
                key={v.id}
                type="button"
                role="menuitem"
                onClick={() => { onSelect(v.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-semibold transition-colors cursor-pointer ${
                  active ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-cream-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{v.label}</span>
                {active && <Check className="w-4 h-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
