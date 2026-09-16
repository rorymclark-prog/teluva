import React from 'react';
import { UserPlus } from 'lucide-react';
import type { FamilyMember } from '../types';

/**
 * "Whose is this?" — one tap to put an untagged medical appointment on the
 * right person's profile. See utils/untaggedAppointments.ts for why the app
 * asks rather than guesses.
 *
 * Every choice is a visible, labelled button. The suggested person (the
 * signed-in adult, when there is one) is highlighted and marked "suggested",
 * but nothing is tagged until a button is tapped.
 */
interface UntaggedAppointmentPromptProps {
  eventTitle: string;
  /** "Tue 22 Sep · 10:30" — shown with the title when showTitle is on. */
  eventDetail?: string;
  members: readonly FamilyMember[];
  suggestedMemberId?: string;
  onTag: (memberId: string) => void;
  /** "Not now" for this device only. Omit to hide the button. */
  onDismiss?: () => void;
  /** Name the appointment in the prompt — for lists where it isn't already the row's heading. */
  showTitle?: boolean;
}

const UntaggedAppointmentPrompt: React.FC<UntaggedAppointmentPromptProps> = ({
  eventTitle, eventDetail, members, suggestedMemberId, onTag, onDismiss, showTitle = false,
}) => {
  if (members.length === 0) return null;
  // Suggested person first, then everyone else in their usual order.
  const ordered = suggestedMemberId
    ? [...members.filter((m) => m.id === suggestedMemberId), ...members.filter((m) => m.id !== suggestedMemberId)]
    : [...members];
  return (
    <div
      className="rounded-xl border border-dashed border-rosa-500/40 bg-white/70 px-3 py-2.5 space-y-2"
      role="group"
      aria-label={`Whose appointment is ${eventTitle}?`}
    >
      {showTitle && (
        <div className="space-y-0.5">
          <p className="text-[13px] font-semibold text-ink-900">{eventTitle}</p>
          {eventDetail && <p className="text-[12px] text-ink-500 tabular-nums">{eventDetail}</p>}
        </div>
      )}
      <p className="text-[12px] font-semibold text-ink-700 flex items-center gap-1.5">
        <UserPlus className="w-3.5 h-3.5 text-rosa-600 shrink-0" />
        <span>Untagged appointment — whose is this?</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ordered.map((m) => {
          const suggested = m.id === suggestedMemberId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onTag(m.id)}
              className={`text-[12px] font-semibold rounded-lg px-2.5 py-1 border transition-colors ${
                suggested
                  ? 'bg-ink-900 text-white border-ink-900 hover:bg-ink-800'
                  : 'bg-cream-50 text-ink-700 border-cream-300 hover:bg-cream-100'
              }`}
              aria-label={`Tag this appointment to ${m.name}${suggested ? ' (suggested)' : ''}`}
            >
              {m.name.split(/\s+/)[0]}{suggested ? ' · suggested' : ''}
            </button>
          );
        })}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[12px] rounded-lg px-2.5 py-1 text-ink-400 hover:text-ink-700"
            aria-label="Not now — hide this question on this device"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
};

export default UntaggedAppointmentPrompt;
