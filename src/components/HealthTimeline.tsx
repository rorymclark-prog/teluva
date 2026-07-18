import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, HeartPulse, TrendingUp, Stethoscope, CalendarClock, Printer, Ruler, Scale, Users,
} from 'lucide-react';
import { FamilyMember, CalendarEvent, CareSchedule } from '../types';
import { warmAvatarColor } from '../utils/avatarPalette';

interface Props {
  members: FamilyMember[];
  events: CalendarEvent[];
  onClose: () => void;
}

// One merged, chronologically-sortable row on the timeline. Three source
// shapes (growth log, care visit, calendar event) collapse into one union so
// the render loop can stay a single switch.
type TimelineItem =
  | {
      id: string;
      date: string;
      kind: 'growth';
      heightCm: number;
      weightKg: number;
      notes?: string;
      deltaHeightCm: number | null;
      deltaWeightKg: number | null;
    }
  | { id: string; date: string; kind: 'care'; careKind: string; provider?: string; notes?: string }
  | { id: string; date: string; kind: 'event'; title: string; time?: string };

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function signed(n: number, unit: string): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}${unit}`;
}

// A warm, pediatric per-child history: growth check-ins, care-schedule visits
// and any Appointment-category calendar events (this app's CalendarEvent
// categories have no dedicated "Health" bucket — Appointment is the closest
// fit, and matches the rosa "medical" colouring already used in FamilyCalendar),
// merged and sorted newest-first into one vertical timeline.
export default function HealthTimeline({ members, events, onClose }: Props) {
  const children = useMemo(() => members.filter((m) => m.role === 'Child'), [members]);
  const [selectedId, setSelectedId] = useState<string | null>(children[0]?.id ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // If the member list changes under us (child added/removed elsewhere) keep
  // the selection valid instead of silently pointing at nothing.
  useEffect(() => {
    setSelectedId((prev) => (children.some((c) => c.id === prev) ? prev : children[0]?.id ?? null));
  }, [children]);

  const child = children.find((c) => c.id === selectedId) || null;

  const { items, currentHeight, currentWeight, heightGrowth, weightGrowth, firstDate } = useMemo(() => {
    if (!child) {
      return {
        items: [] as TimelineItem[],
        currentHeight: null as number | null,
        currentWeight: null as number | null,
        heightGrowth: null as number | null,
        weightGrowth: null as number | null,
        firstDate: null as string | null,
      };
    }

    const growthAsc = [...(child.growthHistory || [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const growthItems: TimelineItem[] = growthAsc.map((g, i) => {
      const prev = i > 0 ? growthAsc[i - 1] : null;
      return {
        id: `growth-${g.id}`,
        date: g.date,
        kind: 'growth',
        heightCm: g.heightCm,
        weightKg: g.weightKg,
        notes: g.notes,
        deltaHeightCm: prev ? g.heightCm - prev.heightCm : null,
        deltaWeightKg: prev && g.weightKg && prev.weightKg ? g.weightKg - prev.weightKg : null,
      };
    });

    const careItems: TimelineItem[] = (child.careSchedule || [])
      .filter((c): c is CareSchedule & { lastVisit: string } => !!c.lastVisit)
      .map((c) => ({
        id: `care-${c.id}`,
        date: c.lastVisit,
        kind: 'care',
        careKind: c.kind,
        provider: c.provider,
        notes: c.notes,
      }));

    const eventItems: TimelineItem[] = events
      .filter((e) => e.category === 'Appointment' && e.memberIds?.includes(child.id))
      .map((e) => ({ id: `event-${e.id}`, date: e.date, kind: 'event', title: e.title, time: e.time }));

    const merged = [...growthItems, ...careItems, ...eventItems].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const earliest = growthAsc[0] || null;
    const latest = growthAsc[growthAsc.length - 1] || null;
    const hGrowth = latest && earliest && growthAsc.length > 1 ? latest.heightCm - earliest.heightCm : null;
    const wGrowth =
      latest && earliest && growthAsc.length > 1 && latest.weightKg && earliest.weightKg
        ? latest.weightKg - earliest.weightKg
        : null;

    return {
      items: merged,
      currentHeight: latest?.heightCm ?? null,
      currentWeight: latest?.weightKg || null,
      heightGrowth: hGrowth,
      weightGrowth: wGrowth,
      firstDate: earliest?.date ?? null,
    };
  }, [child, events]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 print:relative print:p-0 print:block"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={onClose}
          className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm print:hidden"
        />

        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="relative card w-full max-w-2xl max-h-[92vh] rounded-3xl overflow-hidden flex flex-col print:max-h-none print:shadow-none print:rounded-none print:border-0"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-5 sm:p-6 border-b border-cream-200 shrink-0">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2.5 rounded-2xl bg-rosa-100 text-rosa-600 shrink-0">
                <HeartPulse className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-xl sm:text-2xl font-semibold text-ink-900 leading-tight">
                  Health timeline
                </h2>
                <p className="text-[13px] text-ink-500 font-medium mt-0.5">
                  {child ? `${firstName(child.name)}'s growth & care history` : 'A per-child growth & care history'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
                title="Print"
              >
                <Printer className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Person selector */}
          {children.length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 sm:px-6 py-3.5 border-b border-cream-200 shrink-0 print:hidden">
              {children.map((c) => {
                const active = child?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`tab-pill pl-1.5 ${active ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                  >
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                    ) : (
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white uppercase shrink-0 ${warmAvatarColor(c.avatarColor)}`}
                      >
                        {c.name.charAt(0)}
                      </span>
                    )}
                    {firstName(c.name)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 print:overflow-visible">
            {!child ? (
              <div className="card p-8 sm:p-10 text-center">
                <div className="w-14 h-14 rounded-2xl bg-clay-50 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-6 h-6 text-clay-600" />
                </div>
                <p className="text-sm font-semibold text-ink-800">No children added yet</p>
                <p className="text-[13px] text-ink-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                  Add a family member with the &ldquo;Child&rdquo; role to start building a health timeline.
                </p>
              </div>
            ) : (
              <>
                {/* Growth summary */}
                {(currentHeight != null || currentWeight != null) && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="rounded-2xl border border-cream-200 bg-white p-3.5 flex items-center justify-between">
                      <div>
                        <p className="text-lg font-bold text-ink-900 tabular-nums">
                          {currentHeight != null ? `${currentHeight} cm` : '—'}
                        </p>
                        <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">Current height</p>
                      </div>
                      <div className="p-2 bg-cream-100 rounded-xl text-ink-400 shrink-0">
                        <Ruler className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-cream-200 bg-white p-3.5 flex items-center justify-between">
                      <div>
                        <p className="text-lg font-bold text-ink-900 tabular-nums">
                          {currentWeight ? `${currentWeight} kg` : '—'}
                        </p>
                        <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">Current weight</p>
                      </div>
                      <div className="p-2 bg-cream-100 rounded-xl text-ink-400 shrink-0">
                        <Scale className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-sage-100 bg-sage-50 p-3.5 flex items-center justify-between col-span-2 sm:col-span-1">
                      <div>
                        <p className="text-lg font-bold text-sage-700 tabular-nums">
                          {heightGrowth != null ? signed(heightGrowth, ' cm') : 'New'}
                        </p>
                        <p className="text-[11px] font-bold text-sage-600 uppercase tracking-wide">
                          {firstDate ? `Since ${fmtDate(firstDate)}` : 'Growth so far'}
                        </p>
                        {weightGrowth != null && (
                          <p className="text-[11px] text-sage-600 mt-0.5 tabular-nums">
                            {signed(weightGrowth, ' kg')} weight
                          </p>
                        )}
                      </div>
                      <div className="p-2 bg-sage-100 rounded-xl text-sage-500 shrink-0">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                {items.length === 0 ? (
                  <div className="card p-8 sm:p-10 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-rosa-50 flex items-center justify-center mx-auto mb-4">
                      <HeartPulse className="w-6 h-6 text-rosa-500" />
                    </div>
                    <p className="text-sm font-semibold text-ink-800">
                      No health history for {firstName(child.name)} yet
                    </p>
                    <p className="text-[13px] text-ink-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
                      Log a growth check-in or a care-schedule visit and it will appear here as a timeline.
                    </p>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="absolute left-4 top-2 bottom-2 w-px bg-cream-200" aria-hidden="true" />
                    <div className="space-y-4">
                      {items.map((item) => {
                        const dot =
                          item.kind === 'growth'
                            ? { Icon: TrendingUp, cls: 'bg-sage-100 text-sage-700' }
                            : item.kind === 'care'
                              ? { Icon: Stethoscope, cls: 'bg-dusk-100 text-dusk-700' }
                              : { Icon: CalendarClock, cls: 'bg-rosa-100 text-rosa-700' };
                        const Icon = dot.Icon;

                        return (
                          <div key={item.id} className="relative pl-11">
                            <div
                              className={`absolute left-0 top-0 w-8 h-8 rounded-full ring-4 ring-white flex items-center justify-center ${dot.cls}`}
                            >
                              <Icon className="w-4 h-4" />
                            </div>

                            <div className="rounded-2xl border border-cream-200 bg-white p-3.5">
                              <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">
                                {fmtDate(item.date)}
                                {item.kind === 'event' && item.time ? ` · ${item.time}` : ''}
                              </p>

                              {item.kind === 'growth' && (
                                <>
                                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 mt-1">
                                    <span className="text-[15px] font-semibold text-ink-900 tabular-nums">
                                      {item.heightCm} cm
                                      {item.deltaHeightCm != null && (
                                        <span className="ml-1.5 text-[12px] font-semibold text-sage-600">
                                          ({signed(item.deltaHeightCm, ' cm')})
                                        </span>
                                      )}
                                    </span>
                                    {item.weightKg > 0 && (
                                      <span className="text-[14px] text-ink-700 tabular-nums">
                                        {item.weightKg} kg
                                        {item.deltaWeightKg != null && (
                                          <span
                                            className={`ml-1.5 text-[12px] font-semibold ${item.deltaWeightKg >= 0 ? 'text-sage-600' : 'text-honey-700'}`}
                                          >
                                            ({signed(item.deltaWeightKg, ' kg')})
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                  {item.notes && (
                                    <p className="text-[13px] text-ink-500 mt-1 italic">{item.notes}</p>
                                  )}
                                </>
                              )}

                              {item.kind === 'care' && (
                                <>
                                  <p className="text-[15px] font-semibold text-ink-900 mt-1">{item.careKind}</p>
                                  {item.provider && (
                                    <p className="text-[13px] text-ink-500 mt-0.5">{item.provider}</p>
                                  )}
                                  {item.notes && (
                                    <p className="text-[13px] text-ink-500 mt-1 italic">{item.notes}</p>
                                  )}
                                </>
                              )}

                              {item.kind === 'event' && (
                                <p className="text-[15px] font-semibold text-ink-900 mt-1">{item.title}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
