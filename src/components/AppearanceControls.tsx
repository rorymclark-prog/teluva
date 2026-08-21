import { Check, Monitor, Moon, RotateCcw, Sparkles, Sun } from 'lucide-react';
import { ThemePreference, useAppearance } from '../contexts/AppearanceContext';

const themes: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

export default function AppearanceControls({ compact = false }: { compact?: boolean }) {
  const { theme, interfacePreference, setTheme, setInterfacePreference } = useAppearance();
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="appearance-segment" aria-label="Choose display theme">
        {themes.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTheme(id)} aria-pressed={theme === id} title={label} className={theme === id ? 'is-active' : ''}>
            <Icon className="h-3.5 w-3.5" />
            {!compact && <span>{label}</span>}
            {compact && theme === id && <Check className="h-3 w-3" />}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setInterfacePreference(interfacePreference === 'ember' ? 'classic' : 'ember')} className="appearance-interface-toggle">
        {interfacePreference === 'ember' ? <RotateCcw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        <span>{interfacePreference === 'ember' ? 'Use classic Teluva' : 'Try Ember Thread'}</span>
      </button>
    </div>
  );
}
