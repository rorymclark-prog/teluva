import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CalendarPlus, FileUp, Home, ImagePlus, UserPlus, X } from 'lucide-react';

interface CaptureMenuProps {
  open: boolean;
  onClose: () => void;
  onAddPerson: () => void;
  onPlan: () => void;
  onOpenVault: () => void;
  onOpenStory: () => void;
  onOpenHouse: () => void;
  isBusinessSpace?: boolean;
}

const choices = [
  { id: 'document', title: 'Photo, scan or file', note: 'Send evidence into the family vault', icon: FileUp },
  { id: 'moment', title: 'Keep a moment', note: 'Add a photograph, saying or family story', icon: ImagePlus },
  { id: 'plan', title: 'Plan something', note: 'Add the next family date or appointment', icon: CalendarPlus },
  { id: 'person', title: 'Add a person', note: 'Start or extend the family circle', icon: UserPlus },
  { id: 'home', title: 'Home knowledge', note: 'Keep a provider, object or household detail', icon: Home },
] as const;

export default function CaptureMenu({ open, onClose, onAddPerson, onPlan, onOpenVault, onOpenStory, onOpenHouse, isBusinessSpace = false }: CaptureMenuProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('[data-capture-choice]')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const actions = { person: onAddPerson, plan: onPlan, document: onOpenVault, moment: onOpenStory, home: onOpenHouse };
  const visibleChoices = isBusinessSpace ? [
    { id: 'document', title: 'Photo, scan or file', note: 'Send evidence into the business vault', icon: FileUp },
    { id: 'plan', title: 'Plan something', note: 'Add a team date, deadline or appointment', icon: CalendarPlus },
    { id: 'person', title: 'Add a team member', note: 'Create an employee or contractor record', icon: UserPlus },
    { id: 'home', title: 'Operational detail', note: 'Keep a location, provider, asset or workplace detail', icon: Home },
  ] as const : choices;

  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current
      ? [...dialogRef.current.querySelectorAll<HTMLButtonElement>('button')]
      : [];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="capture-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
        onKeyDown={keepFocusInside}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><span className="pulse-eyebrow">Quick capture · Private</span><h2 id="capture-title">What do you want to keep?</h2><p>Choose the shape. Teluva will take you to the right place without making you learn the filing system.</p></div>
          <button type="button" onClick={onClose} aria-label="Close Capture"><X className="h-5 w-5" /></button>
        </header>
        <div className="capture-choices">
          {visibleChoices.map(({ id, title, note, icon: Icon }) => (
            <button
              key={id}
              data-capture-choice
              type="button"
              onClick={() => { onClose(); actions[id](); }}
              className="capture-choice"
            >
              <span><Icon className="h-5 w-5" /></span>
              <b>{title}</b>
              <small>{note}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
