import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CalendarDays, ChevronRight } from 'lucide-react';
import { FamilyMember, Vehicle } from '../types';
import { loadHousehold } from '../utils/db';
import { computeNudges, computeVehicleNudges, Nudge, Tone } from './NeedsAttention';

interface Props {
  member: FamilyMember;
  isBusinessSpace: boolean;
  onClose: () => void;
  onGoTab: (tab: string) => void;
  onGoView?: (view: string) => void;
}

// Mirrors Dashboard.tsx's HIDDEN_IN_BUSINESS tab list — family-only concepts
// (birthday, growth, care check-ups) that a business-space team member's
// profile already hides in the tab strip. Kept as a local constant rather
// than importing from Dashboard.tsx to avoid a circular import.
const HIDDEN_TABS_IN_BUSINESS = new Set(['care', 'sizes', 'favorites', 'growth', 'sayings', 'timelapse']);

const TONE_STYLE: Record<Tone, string> = {
  urgent: 'bg-rosa-100 text-rosa-700',
  warn: 'bg-honey-100 text-honey-700',
  info: 'bg-cream-200 text-ink-500',
};

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

// Local-time formatter matching NeedsAttention's toISODate — avoids the
// UTC-shift bug that Date#toISOString() has near midnight in Vienna's timezone.
function fmtDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  const [y, m, d] = parts;
  const date = parts.length === 3 && !parts.some((n) => isNaN(n)) ? new Date(y, m - 1, d) : new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// "3 days overdue", "Today", "Tomorrow", "In 12 days", "In ~4 months" — a
// relative label to sit alongside the actual date so the list reads at a glance.
function relativeLabel(days: number): string {
  if (days < 0) {
    const n = Math.abs(days);
    return `${n} day${n === 1 ? '' : 's'} overdue`;
  }
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 30) return `In ${days} days`;
  const months = Math.round(days / 30.4375);
  if (months < 12) return `In ~${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(months / 12);
  return `In ~${years} year${years === 1 ? '' : 's'}`;
}

// Per-member "Relevant dates" view — a read-only, date-sorted re-presentation
// of the same deadline logic NeedsAttention already computes (medical
// check-ups, passport/ID/visa expiry, transit passes, birthday, vehicle
// deadlines), filtered to just this one person. Zero new deadline logic: it
// calls computeNudges/computeVehicleNudges verbatim and only keeps entries
// that carry a real date, sorted overdue-first then soonest-upcoming.
export default function MemberCalendarDates({ member, isBusinessSpace, onClose, onGoTab, onGoView }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadHousehold()
      .then((h) => { if (!cancelled) setVehicles(h?.vehicles || []); })
      .catch(() => { if (!cancelled) setVehicles([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Only this member's own vehicles — Vehicle.assignedMember stores the
  // member's name (no memberId link exists on Vehicle), matching VehiclesView.
  const memberVehicles = vehicles.filter((v) => v.assignedMember === member.name);

  const items = [...computeNudges([member]), ...computeVehicleNudges(memberVehicles)]
    .filter((n): n is Nudge & { date: string; days: number } => n.date != null && n.days != null)
    .filter((n) => !(isBusinessSpace && HIDDEN_TABS_IN_BUSINESS.has(n.tab)))
    .sort((a, b) => a.days - b.days);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={onClose}
          className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
        />

        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="relative card w-full max-w-lg max-h-[85vh] rounded-3xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-5 sm:p-6 border-b border-cream-200 shrink-0">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-600 shrink-0">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-xl sm:text-2xl font-semibold text-ink-900 leading-tight">
                  Relevant dates
                </h2>
                <p className="text-[13px] text-ink-500 font-medium mt-0.5">
                  {firstName(member.name)}&apos;s own deadlines &amp; dates
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer shrink-0"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 sm:p-10 text-center">
                <div className="w-14 h-14 rounded-2xl bg-cream-100 flex items-center justify-center mx-auto mb-4">
                  <CalendarDays className="w-6 h-6 text-ink-300" />
                </div>
                <p className="text-sm font-semibold text-ink-800">Nothing dated for {firstName(member.name)} right now</p>
                <p className="text-[13px] text-ink-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                  Passport &amp; ID expiry, care check-ups, travel passes and vehicle deadlines will show up here as soon as they&apos;re on the horizon.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-cream-100">
                {items.map((n) => {
                  const Icon = n.icon;
                  return (
                    <button
                      key={n.key}
                      type="button"
                      onClick={() => (n.view ? onGoView?.(n.view) : onGoTab(n.tab))}
                      className="w-full flex items-center gap-3 px-5 sm:px-6 py-3.5 text-left hover:bg-cream-50 transition-colors cursor-pointer group"
                    >
                      <div className={`p-1.5 rounded-lg shrink-0 ${TONE_STYLE[n.tone]}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] text-ink-800 font-medium leading-snug">{n.text}</p>
                        <p className={`text-[11.5px] font-semibold mt-0.5 tabular-nums ${n.days < 0 ? 'text-rosa-600' : 'text-ink-400'}`}>
                          {relativeLabel(n.days)} · {fmtDate(n.date)}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-500 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
