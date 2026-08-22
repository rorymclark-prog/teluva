import { useState } from 'react';
import { CalendarDays, FolderArchive, Home, MessageCircle, Palette, Plus, Settings, Sparkles, Users, X } from 'lucide-react';
import AppearanceControls from './AppearanceControls';

export type EmberDestination = 'pulse' | 'profiles' | 'calendar' | 'household' | 'vault';

const destinations: { id: EmberDestination; label: string; icon: typeof Sparkles }[] = [
  { id: 'pulse', label: 'Pulse', icon: Sparkles },
  { id: 'profiles', label: 'People', icon: Users },
  { id: 'calendar', label: 'Plan', icon: CalendarDays },
  { id: 'household', label: 'House', icon: Home },
  { id: 'vault', label: 'Vault', icon: FolderArchive },
];

const destinationViews: Record<Exclude<EmberDestination, 'pulse'>, string[]> = {
  profiles: ['profiles', 'emergency', 'info', 'timeline', 'familyWords', 'inMemory', 'familyTree', 'chat'],
  calendar: ['calendar', 'travelTimeline', 'recipes', 'shopping', 'gifts', 'anniversaries', 'extendedBirthdays'],
  household: ['household', 'vehicles', 'pets', 'assets'],
  vault: ['vault', 'drive', 'finances', 'insurance', 'slips', 'passwords', 'willsEstate'],
};

export function emberDestinationFor(view: string): EmberDestination {
  if (view === 'pulse') return 'pulse';
  return (Object.entries(destinationViews).find(([, views]) => views.includes(view))?.[0] as EmberDestination | undefined) || 'pulse';
}

interface EmberNavigationProps {
  current: string;
  onSelect: (destination: EmberDestination) => void;
  onAsk: () => void;
  onCapture: () => void;
  onSettings: () => void;
  isBusinessSpace?: boolean;
}

export function emberDestinationLabel(id: EmberDestination, isBusinessSpace: boolean): string {
  if (!isBusinessSpace) return destinations.find(destination => destination.id === id)?.label || id;
  return ({ pulse: 'Pulse', profiles: 'Team', calendar: 'Plan', household: 'Operations', vault: 'Vault' } as const)[id];
}

export default function EmberNavigation({ current, onSelect, onAsk, onCapture, onSettings, isBusinessSpace = false }: EmberNavigationProps) {
  const activeDestination = emberDestinationFor(current);
  const [mobileAppearanceOpen, setMobileAppearanceOpen] = useState(false);
  return (
    <>
      <aside className="ember-sidebar" aria-label="Primary navigation">
        <div className="ember-wordmark" aria-label="Teluva">tel<span>u</span>va</div>
        <nav>
          {destinations.map(({ id, icon: Icon }) => (
            <button key={id} type="button" onClick={() => onSelect(id)} className={activeDestination === id ? 'is-active' : ''} aria-current={activeDestination === id ? 'page' : undefined}>
              <Icon className="h-4 w-4" /><span>{emberDestinationLabel(id, isBusinessSpace)}</span>
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
        <div className="ember-sidebar-appearance">
          <span>Appearance</span>
          <AppearanceControls />
        </div>
      </aside>
      <button type="button" onClick={() => setMobileAppearanceOpen(true)} className="ember-appearance-mobile-trigger" aria-label="Open Appearance settings">
        <Palette className="h-4 w-4" /><span>Appearance</span>
      </button>
      {mobileAppearanceOpen && (
        <div className="ember-appearance-mobile-backdrop" role="presentation" onClick={() => setMobileAppearanceOpen(false)}>
          <section className="ember-appearance-mobile-sheet" role="dialog" aria-modal="true" aria-label="Appearance" onClick={event => event.stopPropagation()}>
            <header><div><span>Appearance</span><b>Choose how Teluva looks.</b></div><button type="button" onClick={() => setMobileAppearanceOpen(false)} aria-label="Close Appearance"><X className="h-4 w-4" /></button></header>
            <AppearanceControls />
          </section>
        </div>
      )}
      <button type="button" onClick={onCapture} className="ember-capture-mobile" aria-label="Open Capture">
        <Plus className="h-5 w-5" /><span>Capture</span>
      </button>
      <nav className="ember-mobile-nav" aria-label="Primary navigation">
        {destinations.map(({ id, icon: Icon }) => (
          <button key={id} type="button" onClick={() => onSelect(id)} className={activeDestination === id ? 'is-active' : ''} aria-current={activeDestination === id ? 'page' : undefined}>
            <Icon className="h-5 w-5" /><span>{emberDestinationLabel(id, isBusinessSpace)}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
