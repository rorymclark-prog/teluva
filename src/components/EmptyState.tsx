import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Shared empty state — the app had ~67 bare "No X yet" strings, no two quite
 * alike (icon size, tint, spacing, and whether an action button was offered
 * all drifted per-file). This is the one component for that job.
 *
 * Two sizes:
 *  - 'md' (default): the PRIMARY empty state of a view/panel — a whole list,
 *    tab, or card is empty. Icon container (brand-tinted, per the design
 *    spec's "not gray-circle-gray-icon" rule), title, optional description,
 *    optional action button.
 *  - 'sm': a SUB-SECTION inside an already-labeled area is empty (e.g. one
 *    field group on a profile). No icon container — the parent section
 *    already carries one — just right-sized muted text.
 *
 * `dashed` wraps the block in a dashed-border "drop something here" frame,
 * for upload-style empty states (photos, synced docs).
 */

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

type EmptyStateTone = 'clay' | 'sage' | 'dusk' | 'honey' | 'rosa';

const TONE_CLASSES: Record<EmptyStateTone, string> = {
  clay: 'bg-clay-50 text-clay-600',
  sage: 'bg-sage-100 text-sage-700',
  dusk: 'bg-dusk-50 text-dusk-600',
  honey: 'bg-honey-100 text-honey-700',
  rosa: 'bg-rosa-50 text-rosa-500',
};

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: EmptyStateAction;
  size?: 'md' | 'sm';
  tone?: EmptyStateTone;
  dashed?: boolean;
  className?: string;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'md',
  tone = 'clay',
  dashed = false,
  className = '',
}: EmptyStateProps) {
  if (size === 'sm') {
    return (
      <div className={`anim-fade text-center py-6 px-2 ${className}`}>
        <p className="text-[13px] font-medium text-ink-600">{title}</p>
        {description && <p className="text-[12.5px] text-ink-400 mt-1 max-w-xs mx-auto leading-relaxed">{description}</p>}
        {action && (
          <button onClick={action.onClick} className="btn-quiet mt-3 min-h-11 text-xs px-3 py-1.5 mx-auto">
            {action.icon && <action.icon className="w-3.5 h-3.5" />}
            {action.label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`anim-fade text-center py-10 sm:py-12 px-4 ${
        dashed ? 'border border-dashed border-cream-300 rounded-2xl bg-cream-50' : ''
      } ${className}`}
    >
      {Icon && (
        <div className={`w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center ${TONE_CLASSES[tone]}`}>
          <Icon className="w-6 h-6" />
        </div>
      )}
      <p className="text-[14px] font-semibold text-ink-800">{title}</p>
      {description && (
        <p className="text-[13px] text-ink-400 mt-1.5 max-w-xs mx-auto leading-relaxed">{description}</p>
      )}
      {action && (
        <button onClick={action.onClick} className="btn-primary mt-5 text-xs px-4 py-2 mx-auto">
          {action.icon && <action.icon className="w-3.5 h-3.5" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
