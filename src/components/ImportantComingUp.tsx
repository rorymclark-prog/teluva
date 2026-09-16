import { CalendarDays, ChevronRight, Star } from 'lucide-react';
import type { FamilyMember } from '../types';
import { daysToGoLabel, type ImportantItem } from '../utils/importantEvents';

interface Props {
  /** From importantComingUp(): already windowed, sorted and business-safe. */
  items: readonly ImportantItem[];
  members: readonly FamilyMember[];
  /** Existing navigation only: every row opens the calendar. */
  onOpenCalendar: () => void;
  /** 'ember' sits on Pulse; 'classic' on the classic home, beside Needs attention. */
  variant: 'ember' | 'classic';
}

const SHOWN = 5;

// Midday, not midnight, as MemberAppointments does: a YYYY-MM-DD parsed as
// local midnight can display as the day before near a DST change.
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function whoLabel(item: ImportantItem, members: readonly FamilyMember[]): string {
  return item.memberIds
    .map((id) => members.find((m) => m.id === id)?.name.split(' ')[0])
    .filter(Boolean)
    .join(', ');
}

function detail(item: ImportantItem, members: readonly FamilyMember[]): string {
  return [shortDate(item.date), item.time, whoLabel(item, members)].filter(Boolean).join(' · ');
}

/**
 * "Important — coming up": the important events of the next 30 days, the
 * soonest first. Renders nothing when there are none, so a quiet month adds no
 * empty box to the home screen. What counts as important, and why a business
 * space never lists anything medical here, is in utils/importantEvents.ts.
 */
export default function ImportantComingUp({ items, members, onOpenCalendar, variant }: Props) {
  if (!items.length) return null;
  const shown = items.slice(0, SHOWN);
  const more = items.length - shown.length;

  if (variant === 'ember') {
    return (
      <section className="pulse-decisions pulse-important" aria-label="Important — coming up">
        <header>
          <div><span className="pulse-eyebrow">Next 30 days</span><h2>Important — coming up</h2></div>
          <span className="pulse-count">{items.length}</span>
        </header>
        {shown.map((item) => (
          <button key={item.key} type="button" onClick={onOpenCalendar} className="pulse-decision-row">
            <span className="pulse-decision-number"><Star className="h-3 w-3 fill-current" aria-hidden="true" /></span>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            <span><b>{item.title}</b><small>{detail(item, members)}</small></span>
            <span className="pulse-days">{daysToGoLabel(item.daysUntil)}</span>
          </button>
        ))}
        {more > 0 && (
          <button type="button" onClick={onOpenCalendar} className="pulse-important-more">
            and {more} more — open the calendar
          </button>
        )}
      </section>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 flex items-center gap-2 border-b border-cream-200">
        <Star className="w-4 h-4 text-clay-500 fill-current shrink-0" aria-hidden="true" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">Important — coming up</h3>
        <span className="chip bg-cream-200 text-ink-600 ml-auto">{items.length}</span>
      </div>
      <div className="divide-y divide-cream-100">
        {shown.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={onOpenCalendar}
            className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-cream-50 transition-colors cursor-pointer group"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] text-ink-800 font-medium">{item.title}</span>
              <span className="block text-[12px] text-ink-500 tabular-nums">{detail(item, members)}</span>
            </span>
            <span className="chip shrink-0 bg-dusk-100 text-dusk-700">
              {daysToGoLabel(item.daysUntil)}
            </span>
            <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-500 shrink-0" aria-hidden="true" />
          </button>
        ))}
      </div>
      {more > 0 && (
        <button
          type="button"
          onClick={onOpenCalendar}
          className="w-full px-5 py-2.5 text-[12.5px] font-semibold text-clay-600 hover:bg-cream-50 transition-colors text-center cursor-pointer border-t border-cream-100"
        >
          and {more} more — open the calendar
        </button>
      )}
    </div>
  );
}
