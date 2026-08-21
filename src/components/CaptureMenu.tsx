import { CalendarPlus, FileUp, Home, ImagePlus, UserPlus, X } from 'lucide-react';

interface CaptureMenuProps {
  open: boolean;
  onClose: () => void;
  onAddPerson: () => void;
  onPlan: () => void;
  onOpenVault: () => void;
  onOpenStory: () => void;
  onOpenHouse: () => void;
}

const choices = [
  { id: 'document', title: 'Photo, scan or file', note: 'Send evidence into the family vault', icon: FileUp },
  { id: 'moment', title: 'Keep a moment', note: 'Add a photograph, saying or family story', icon: ImagePlus },
  { id: 'plan', title: 'Plan something', note: 'Add the next family date or appointment', icon: CalendarPlus },
  { id: 'person', title: 'Add a person', note: 'Start or extend the family circle', icon: UserPlus },
  { id: 'home', title: 'Home knowledge', note: 'Keep a provider, object or household detail', icon: Home },
] as const;

export default function CaptureMenu({ open, onClose, onAddPerson, onPlan, onOpenVault, onOpenStory, onOpenHouse }: CaptureMenuProps) {
  if (!open) return null;

  const actions = { person: onAddPerson, plan: onPlan, document: onOpenVault, moment: onOpenStory, home: onOpenHouse };

  return (
    <div className="capture-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><span className="pulse-eyebrow">Quick capture · Private</span><h2 id="capture-title">What do you want to keep?</h2><p>Choose the shape. Teluva will take you to the right place without making you learn the filing system.</p></div>
          <button type="button" onClick={onClose} aria-label="Close Capture"><X className="h-5 w-5" /></button>
        </header>
        <div className="capture-choices">
          {choices.map(({ id, title, note, icon: Icon }) => (
            <button
              key={id}
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
