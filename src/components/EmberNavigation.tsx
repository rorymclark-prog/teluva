import { CalendarDays, FolderArchive, Home, MessageCircle, Plus, Settings, Sparkles, Users } from 'lucide-react';
import AppearanceControls from './AppearanceControls';

export type EmberDestination = 'pulse' | 'profiles' | 'calendar' | 'household' | 'vault';

const destinations: { id: EmberDestination; label: string; icon: typeof Sparkles }[] = [
  { id: 'pulse', label: 'Pulse', icon: Sparkles },
  { id: 'profiles', label: 'People', icon: Users },
  { id: 'calendar', label: 'Plan', icon: CalendarDays },
  { id: 'household', label: 'House', icon: Home },
  { id: 'vault', label: 'Vault', icon: FolderArchive },
];

interface EmberNavigationProps {
  current: string;
  onSelect: (destination: EmberDestination) => void;
  onAsk: () => void;
  onCapture: () => void;
  onSettings: () => void;
}

export default function EmberNavigation({ current, onSelect, onAsk, onCapture, onSettings }: EmberNavigationProps) {
  return (
    <>
      <aside className="ember-sidebar" aria-label="Primary navigation">
        <div className="ember-wordmark" aria-label="Teluva">tel<span>u</span>va</div>
        <nav>
          {destinations.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => onSelect(id)} className={current === id ? 'is-active' : ''} aria-current={current === id ? 'page' : undefined}>
              <Icon className="h-4 w-4" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button type="button" onClick={onCapture} className="ember-capture">
          <Plus className="h-4 w-4" /><span>Capture</span>
        </button>
        <button type="button" onClick={onSettings} className="ember-utility">
          <Settings className="h-4 w-4" /><span>Settings</span>
        </button>
        <button type="button" onClick={onAsk} className="ember-ask">
          <MessageCircle className="h-4 w-4" /><span>Ask Teluva</span><kbd>⌘ K</kbd>
        </button>
        <AppearanceControls />
      </aside>
      <button type="button" onClick={onCapture} className="ember-capture-mobile" aria-label="Open Capture">
        <Plus className="h-5 w-5" /><span>Capture</span>
      </button>
      <nav className="ember-mobile-nav" aria-label="Primary navigation">
        {destinations.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => onSelect(id)} className={current === id ? 'is-active' : ''} aria-current={current === id ? 'page' : undefined}>
            <Icon className="h-5 w-5" /><span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
