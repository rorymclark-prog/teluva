import React from 'react';
import type { CalendarEvent } from '../types';
import type { VirtualCalendarEvent } from '../utils/virtualEvents';

export default function CalendarTimeViews({ dates, events, occasions, selected, onSelect }: {
  dates: string[]; events: CalendarEvent[]; occasions: VirtualCalendarEvent[];
  selected: string; onSelect: (date: string) => void;
}) {
  const gridStyle = { gridTemplateColumns: `52px repeat(${dates.length}, minmax(120px, 1fr))`, minWidth: dates.length === 7 ? 892 : undefined };
  const entry = (event: CalendarEvent | VirtualCalendarEvent) => (
    <button key={event.id} type="button" onClick={() => onSelect(event.date)} className="block w-full text-left rounded-lg bg-cream-100 border border-cream-300 p-2 text-xs text-ink-800 break-words">
      {'time' in event && event.time ? `${event.time} · ` : ''}{event.title}
      <span className="block text-ink-500">{'category' in event ? event.category : event.kind === 'birthday' ? 'Birthday' : event.kind === 'anniversary' ? 'Anniversary' : event.kind === 'referralAppointment' ? 'Appointment' : 'Name day'}</span>
    </button>
  );
  return <div className="overflow-auto max-h-[620px] rounded-xl border border-cream-200" tabIndex={0} aria-label={dates.length === 7 ? 'Week calendar, scroll for all days and hours' : 'Day calendar, scroll for all hours'}>
    <div className="grid bg-white" style={gridStyle}>
      <div className="sticky top-0 bg-white z-10" />
      {dates.map(date => <button key={date} onClick={() => onSelect(date)} aria-pressed={selected === date} className="sticky top-0 z-10 bg-white border-b border-cream-200 p-2 text-sm font-semibold text-ink-800">{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</button>)}
      <div className="p-2 text-xs text-ink-500 border-b border-cream-200">All day</div>
      {dates.map(date => <div key={date} className="p-1 space-y-1 border-l border-b border-cream-200 min-h-16">{events.filter(e => e.date === date && !e.time).map(entry)}{occasions.filter(e => e.date === date).map(entry)}</div>)}
      {Array.from({ length: 24 }, (_, hour) => <React.Fragment key={hour}>
        <div className="p-1 text-[11px] text-ink-500 border-b border-cream-200 min-h-12">{String(hour).padStart(2, '0')}:00</div>
        {dates.map(date => <div key={date} className="p-1 space-y-1 border-l border-b border-cream-200 min-h-12">{events.filter(e => e.date === date && e.time && Number(e.time.slice(0, 2)) === hour).sort((a, b) => a.time!.localeCompare(b.time!)).map(entry)}</div>)}
      </React.Fragment>)}
    </div>
  </div>;
}
