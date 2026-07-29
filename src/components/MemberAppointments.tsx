import React, { useState } from 'react';
import { CalendarEvent } from '../types';
import { memberAppointments, todayIsoLocal, relativeDayLabel } from '../utils/memberAppointments';
import { CalendarClock, ChevronRight, ChevronDown, Clock } from 'lucide-react';
import EmptyState from './EmptyState';

interface Props {
  memberId: string;
  memberName: string;
  events: readonly CalendarEvent[];
  /** Jump to the shared calendar, where these can actually be edited. */
  onOpenCalendar?: () => void;
  /** 'full' for the Check-ups tab; 'compact' for the pointer block on Medical. */
  variant?: 'full' | 'compact';
}

// Midday, not midnight: the date is rendered from a YYYY-MM-DD string with no
// time in it, and parsing that as local midnight lands close enough to a DST
// boundary in some zones to display the day before.
const prettyDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

/** One appointment. Module-level so React sees a stable component type and doesn't remount every row on each render. */
const Row: React.FC<{ ev: CalendarEvent; today: string; dim?: boolean }> = ({ ev, today, dim }) => (
  <div className={`p-3.5 rounded-2xl border bg-white flex flex-wrap items-start justify-between gap-3 ${
    dim ? 'border-cream-200 opacity-70' : 'border-cream-200 hover:border-cream-300 hover:bg-cream-50 transition-colors'
  }`}>
    <div className="min-w-0 space-y-1">
      <p className="text-[14px] font-semibold text-ink-900">{ev.title}</p>
      <p className="text-[12.5px] text-ink-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="tabular-nums">{prettyDate(ev.date)}</span>
        {ev.time && (
          <span className="inline-flex items-center gap-1 text-ink-500">
            <Clock className="w-3 h-3 shrink-0" />
            <span className="tabular-nums">{ev.time}</span>
          </span>
        )}
      </p>
      {ev.description && <p className="text-[12px] text-ink-400">{ev.description}</p>}
    </div>
    <span className={`chip shrink-0 ${dim ? 'bg-cream-200 text-ink-500' : 'bg-dusk-100 text-dusk-700'}`}>
      {relativeDayLabel(ev.date, today)}
    </span>
  </div>
);

/**
 * A person's real, dated appointments — read from the shared calendar rather
 * than stored again here. See utils/memberAppointments.ts for why this is a
 * view and not a second copy.
 *
 * Read-only on purpose. Editing lives in one place, the calendar, and the
 * button below goes there. An edit form here would be a second write path to
 * the same records, which is exactly the shape of bug this is meant to end.
 */
export default function MemberAppointments({
  memberId, memberName, events, onOpenCalendar, variant = 'full',
}: Props) {
  const today = todayIsoLocal();
  const { upcoming, past } = memberAppointments(events, memberId, today);
  const [showPast, setShowPast] = useState(false);

  // The Medical tab's version: enough to answer "is there anything coming
  // up?", and a route to the rest. Silent when there is nothing, so it never
  // adds an empty box to a screen that is already long.
  if (variant === 'compact') {
    if (!upcoming.length) return null;
    return (
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" /> Upcoming appointments
          </h4>
          {onOpenCalendar && (
            <button onClick={onOpenCalendar} className="btn-quiet text-xs px-2.5 py-1">
              Calendar <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="space-y-2.5">
          {upcoming.slice(0, 3).map(ev => <Row key={ev.id} ev={ev} today={today} />)}
        </div>
        {upcoming.length > 3 && (
          <p className="text-[12px] text-ink-400">
            and {upcoming.length - 3} more &mdash; see Check-ups.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h4 className="section-label flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" /> Booked appointments
        </h4>
        {onOpenCalendar && (
          <button onClick={onOpenCalendar} className="btn-quiet text-xs px-2.5 py-1">
            Calendar <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {upcoming.length === 0 ? (
        <EmptyState
          size="sm"
          title={`Nothing booked for ${memberName}. Appointments added on the calendar — or just told to the assistant — show up here.`}
        />
      ) : (
        <div className="space-y-2.5">
          {upcoming.map(ev => <Row key={ev.id} ev={ev} today={today} />)}
        </div>
      )}

      {past.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setShowPast(v => !v)}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-500 hover:text-ink-800 cursor-pointer"
            aria-expanded={showPast}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPast ? 'rotate-180' : ''}`} />
            {showPast ? 'Hide' : 'Show'} {past.length} past appointment{past.length === 1 ? '' : 's'}
          </button>
          {showPast && (
            <div className="space-y-2.5 mt-3">
              {past.slice(0, 20).map(ev => <Row key={ev.id} ev={ev} today={today} dim />)}
              {past.length > 20 && (
                <p className="text-[12px] text-ink-400">
                  Showing the 20 most recent of {past.length}. The rest are on the calendar.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
