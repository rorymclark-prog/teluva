import { CalendarPlus, FileUp, UserPlus, X } from 'lucide-react';

interface CaptureMenuProps {
  open: boolean;
  onClose: () => void;
  onAddPerson: () => void;
  onPlan: () => void;
  onOpenVault: () => void;
}

const choices = [
  { id: 'person', title: 'Add a person', note: 'Start or extend the family circle', icon: UserPlus },
  { id: 'plan', title: 'Plan something', note: 'Add the next family date or appointment', icon: CalendarPlus },
  { id: 'document', title: 'Save a document', note: 'Open the family vault', icon: FileUp },
] as const;

export default function CaptureMenu({ open, onClose, onAddPerson, onPlan, onOpenVault }: CaptureMenuProps) {
  if (!open) return null;

  const actions = { person: onAddPerson, plan: onPlan, document: onOpenVault };

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
          <div><span className="pulse-eyebrow">Quick capture</span><h2 id="capture-title">What would you like to keep?</h2></div>
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
