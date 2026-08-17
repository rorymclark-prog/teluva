import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, HeartPulse, TrendingUp, Stethoscope, CalendarClock, Printer, Ruler, Scale, Users,
  Droplet, AlertTriangle, Pill, Leaf, Building2, ShieldAlert, Syringe, Clock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { FamilyMember, CalendarEvent } from '../types';
import { warmAvatarColor } from '../utils/avatarPalette';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { relativeDayLabel, todayIsoLocal } from '../utils/memberAppointments';
import {
  buildHealthTimeline,
  HealthTimelineItem,
  HealthTimelineKind,
  GrowthSummary,
  HealthStandingFacts,
} from '../utils/healthTimeline';

interface Props {
  members: FamilyMember[];
  events: CalendarEvent[];
  onClose: () => void;
  /** Opened from a specific person's Medical tab — preselect them instead of defaulting to the first member. */
  initialMemberId?: string;
}

// Referrals & Results' own kind/status chip palette (MemberReferrals.tsx) —
// reused here verbatim so a lab result carries the SAME colour on this screen
// as it does on the tab it actually lives on. Duplicated rather than imported
// because MemberReferrals.tsx doesn't export them; if that ever changes,
// import instead of copying.
const REFERRAL_KIND_CHIP: Record<string, string> = {
  Referral: 'bg-dusk-100 text-dusk-700',
  Imaging: 'bg-clay-100 text-clay-600',
  'Lab result': 'bg-sage-100 text-sage-700',
  'Specialist letter': 'bg-honey-100 text-honey-700',
  'Sick note': 'bg-rosa-100 text-rosa-700',
  Other: 'bg-cream-200 text-ink-600',
};
const REFERRAL_STATUS_LABEL: Record<string, string> = { open: 'Open', booked: 'Booked', done: 'Done' };
const REFERRAL_STATUS_CHIP: Record<string, string> = {
  open: 'bg-rosa-100 text-rosa-700',
  booked: 'bg-honey-100 text-honey-700',
  done: 'bg-sage-100 text-sage-700',
};

// Chip label + colour for the non-referral kinds (referrals use their own
// KIND_CHIP above, keyed by ReferralKind rather than this module's
// HealthTimelineKind, since one HealthTimelineKind — 'referral' — covers six
// different ReferralKinds).
const KIND_META: Record<Exclude<HealthTimelineKind, 'referral'>, { label: string; chip: string; dot: string; Icon: LucideIcon }> = {
  vaccination: { label: 'Vaccination', chip: 'bg-clay-100 text-clay-700', dot: 'bg-clay-100 text-clay-700', Icon: Syringe },
  care: { label: 'Check-up', chip: 'bg-dusk-100 text-dusk-700', dot: 'bg-dusk-100 text-dusk-700', Icon: Stethoscope },
  growth: { label: 'Growth', chip: 'bg-sage-100 text-sage-700', dot: 'bg-sage-100 text-sage-700', Icon: TrendingUp },
  appointment: { label: 'Appointment', chip: 'bg-rosa-100 text-rosa-700', dot: 'bg-rosa-100 text-rosa-700', Icon: CalendarClock },
};
const REFERRAL_DOT = 'bg-honey-100 text-honey-700';

type FilterKind = 'all' | 'vaccination' | 'visits' | 'growth' | 'appointment';
const FILTERS: { id: FilterKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'vaccination', label: 'Vaccinations' },
  { id: 'visits', label: 'Visits & results' },
  { id: 'growth', label: 'Growth' },
  { id: 'appointment', label: 'Appointments' },
];

function matchesFilter(item: HealthTimelineItem, filter: FilterKind): boolean {
  if (filter === 'all') return true;
  if (filter === 'visits') return item.kind === 'care' || item.kind === 'referral';
  return item.kind === filter;
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function fmtDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  const [y, m, d] = parts;
  const date =
    parts.length === 3 && !parts.some((n) => isNaN(n)) ? new Date(y, m - 1, d) : new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function signed(n: number, unit: string): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}${unit}`;
}

// This exact wording, copied verbatim from utils/exportPack.ts's own
// SummaryDoc.disclaimer — every family-records export the app produces
// carries the same sentence, so a printed timeline must say it too rather
// than silently reading as more authoritative than the export it sits next
// to on the same shelf.
const RECORDS_DISCLAIMER =
  'This is a copy of records as they were entered. It is not a medical, legal or '
  + 'financial opinion, and nothing in it has been checked or interpreted by Teluva.';

// One row's chip + dot styling, looked up once per item rather than inlined
// three times in the render below (upcoming / dated / undated all share it).
function kindMeta(item: HealthTimelineItem): { label: string; chip: string; dot: string; Icon: LucideIcon } {
  if (item.kind === 'referral') {
    return {
      label: item.referralKind || 'Referral',
      chip: `chip ${REFERRAL_KIND_CHIP[item.referralKind || 'Other'] || REFERRAL_KIND_CHIP.Other}`,
      dot: REFERRAL_DOT,
      Icon: Stethoscope,
    };
  }
  const meta = KIND_META[item.kind];
  return { label: meta.label, chip: `chip ${meta.chip}`, dot: meta.dot, Icon: meta.Icon };
}

/**
 * One person's whole health picture — vaccinations, care-schedule visits,
 * referrals & results, growth check-ins and Appointment-category calendar
 * events, merged by utils/healthTimeline.ts into a single chronological
 * axis. Every member is selectable, not just children (the pediatric-only
 * filter this modal used to have was the actual complaint: a Parent could
 * not see their own history through it at all).
 *
 * Deliberately does NOT show file thumbnails, download links or an "Ask this
 * document" affordance anywhere — this is a chronology of WHAT happened and
 * WHEN, not a second way to reach the file bytes those other screens already
 * own. Nothing rendered here is written back anywhere; it's a read-only view.
 */
export default function HealthTimeline({ members, events, onClose, initialMemberId }: Props) {
  // Parent (Dashboard.tsx) conditionally mounts this component
  // (`{showHealthTimeline && <HealthTimeline .../>}`), so the lock is
  // unconditional for this component's whole lifetime.
  useBodyScrollLock(true);

  const [selectedId, setSelectedId] = useState<string | null>(
    (initialMemberId && members.some((m) => m.id === initialMemberId) ? initialMemberId : members[0]?.id) ?? null,
  );
  const [filter, setFilter] = useState<FilterKind>('all');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // If the member list changes under us (someone added/removed elsewhere) keep
  // the selection valid instead of silently pointing at nothing.
  useEffect(() => {
    setSelectedId((prev) => (members.some((m) => m.id === prev) ? prev : members[0]?.id ?? null));
  }, [members]);

  const member = members.find((m) => m.id === selectedId) || null;

  // One "now" for this whole render — computed once, not read from the clock
  // inside buildHealthTimeline — so every source it merges (care due dates,
  // upcoming-vs-past appointments, referral staleness) agrees on what "today"
  // means, per healthTimeline.ts's documented convention.
  const now = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => todayIsoLocal(now), [now]);

  const timeline = useMemo(() => {
    if (!member) return null;
    return buildHealthTimeline({ member, events, members, now });
  }, [member, events, members, now]);

  const filteredUpcoming = useMemo(
    () => (timeline ? timeline.upcoming.filter((i) => matchesFilter(i, filter)) : []),
    [timeline, filter],
  );
  const filteredYears = useMemo(
    () =>
      timeline
        ? timeline.years
            .map((y) => ({ year: y.year, items: y.items.filter((i) => matchesFilter(i, filter)) }))
            .filter((y) => y.items.length > 0)
        : [],
    [timeline, filter],
  );
  const filteredUndated = useMemo(
    () => (timeline ? timeline.undated.filter((i) => matchesFilter(i, filter)) : []),
    [timeline, filter],
  );

  const hasAnyRows = filteredUpcoming.length > 0 || filteredYears.length > 0 || filteredUndated.length > 0;

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
          className="relative card w-full max-w-2xl max-h-[92dvh] rounded-3xl overflow-hidden flex flex-col print:max-h-none print:shadow-none print:rounded-none print:border-0"
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
                  {member ? `${firstName(member.name)}'s medical history` : 'Everyone’s medical history, in one place'}
                </p>
                {/* Print-only — the interactive header above stays visible, but a
                    printed page needs the same "these are unverified copies of
                    what was entered" line every other Teluva export carries. */}
                <p className="hidden print:block text-[11px] text-ink-500 mt-1.5 italic">
                  {RECORDS_DISCLAIMER}
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

          {/* Person selector — every family member, not just children:
              seeing your own record here was the whole complaint. */}
          {members.length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 sm:px-6 py-3.5 border-b border-cream-200 shrink-0 print:hidden">
              {members.map((m) => {
                const active = member?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedId(m.id)}
                    className={`tab-pill pl-1.5 ${active ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                  >
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                    ) : (
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white uppercase shrink-0 ${warmAvatarColor(m.avatarColor)}`}
                      >
                        {m.name.charAt(0)}
                      </span>
                    )}
                    {firstName(m.name)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Filter chips */}
          {member && (
            <div className="flex flex-wrap gap-2 px-5 sm:px-6 py-3 border-b border-cream-200 shrink-0 print:hidden">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`tab-pill text-[12.5px] ${filter === f.id ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 print:overflow-visible">
            {!member || !timeline ? (
              <div className="card">
                <EmptyPeople />
              </div>
            ) : (
              <>
                {/* Growth summary — only when this member actually has growth
                    entries, so an adult with none doesn't see three empty boxes. */}
                {timeline.growthSummary && (
                  <GrowthTiles summary={timeline.growthSummary} />
                )}

                {/* Standing facts — allergies, blood group, emergency medication
                    etc. A handover doc that buries these is worse than one
                    that doesn't try, so they sit above the history, always
                    visible, never mixed in as a "dated" event. */}
                <StandingFacts facts={timeline.standing} />

                {/* Coming up — visually distinct (dusk tint) and NEVER
                    interleaved into the history below: "next dentist visit"
                    and "last dentist visit" answer different questions and
                    reading them as one merged list would blur that. */}
                {filteredUpcoming.length > 0 && (
                  <section className="rounded-2xl border border-dusk-100 bg-dusk-50 p-4 sm:p-5 space-y-3">
                    <h3 className="text-[11px] font-bold text-dusk-700 uppercase tracking-wide flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Coming up
                    </h3>
                    <div className="space-y-2.5">
                      {filteredUpcoming.map((item) => (
                        <UpcomingRow key={item.id} item={item} todayIso={todayIso} />
                      ))}
                    </div>
                  </section>
                )}

                {/* History, grouped by year, newest first */}
                {!hasAnyRows ? (
                  <div className="card">
                    <EmptyHistory name={firstName(member.name)} filtered={filter !== 'all'} />
                  </div>
                ) : (
                  <>
                    {filteredYears.map((y) => (
                      <YearGroup key={y.year} year={y.year} items={y.items} />
                    ))}

                    {/* Undated bucket, always last — never inferred, never dropped. */}
                    {filteredUndated.length > 0 && (
                      <section className="space-y-3">
                        <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">
                          Date not recorded
                        </h3>
                        <div className="space-y-2.5">
                          {filteredUndated.map((item) => (
                            <HistoryRow key={item.id} item={item} showYear={false} />
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}

                {/* Completeness footer — says the gap out loud instead of
                    letting an undated record read as simply absent. */}
                {timeline.counts.undated > 0 && (
                  <p className="text-[11.5px] text-ink-400 text-center pt-1">
                    {timeline.counts.undated} record{timeline.counts.undated === 1 ? '' : 's'} on this timeline
                    {' '}{timeline.counts.undated === 1 ? 'has' : 'have'} no date recorded — {timeline.counts.undated === 1 ? "it's" : "they're"} listed above.
                  </p>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ---------------- Empty states ---------------- */

function EmptyPeople() {
  return (
    <div className="py-10 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-clay-50 text-clay-600 mb-3">
        <Users className="w-6 h-6" />
      </div>
      <p className="text-[14px] font-semibold text-ink-700">No family members added yet</p>
      <p className="text-[13px] text-ink-400 mt-1">Add someone to start building a health timeline.</p>
    </div>
  );
}

function EmptyHistory({ name, filtered }: { name: string; filtered: boolean }) {
  return (
    <div className="py-10 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-rosa-50 text-rosa-500 mb-3">
        <HeartPulse className="w-6 h-6" />
      </div>
      <p className="text-[14px] font-semibold text-ink-700">
        {filtered ? `Nothing in that filter for ${name}` : `No health history for ${name} yet`}
      </p>
      <p className="text-[13px] text-ink-400 mt-1">
        {filtered
          ? 'Try a different filter, or "All".'
          : 'Vaccinations, check-ups, referrals, growth check-ins and booked appointments will appear here as they’re added.'}
      </p>
    </div>
  );
}

/* ---------------- Growth summary tiles ---------------- */

function GrowthTiles({ summary }: { summary: GrowthSummary }) {
  const { currentHeight, currentWeight, heightGrowth, weightGrowth, firstDate } = summary;
  return (
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
          <p
            className={`text-lg font-bold tabular-nums ${heightGrowth != null && heightGrowth < 0 ? 'text-honey-700' : 'text-sage-700'}`}
          >
            {heightGrowth != null ? signed(heightGrowth, ' cm') : 'New'}
          </p>
          <p className="text-[11px] font-bold text-sage-600 uppercase tracking-wide">
            {firstDate ? `Since ${fmtDate(firstDate)}` : 'Growth so far'}
          </p>
          {weightGrowth != null && (
            <p className={`text-[11px] mt-0.5 tabular-nums ${weightGrowth < 0 ? 'text-honey-700' : 'text-sage-600'}`}>
              {signed(weightGrowth, ' kg')} weight
            </p>
          )}
        </div>
        <div className="p-2 bg-sage-100 rounded-xl text-sage-500 shrink-0">
          <TrendingUp className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Standing facts ---------------- */

// Allergies get the same rosa "alarm" treatment EmergencyCard.tsx uses for
// them, and the same calm sage "none on file" fallback when absent — the
// SAME fact should not look more or less urgent depending which screen shows
// it. Everything else here is a quieter fact tile; only allergies get the
// alarm colour, matching EmergencyCard's own hierarchy.
function StandingFacts({ facts }: { facts: HealthStandingFacts }) {
  const hasAny =
    facts.bloodGroup || facts.allergies || facts.emergencyMedication || facts.organDonor ||
    facts.preferredPharmacy || facts.medicalAidScheme || facts.medicalAidPlanOption || facts.registeredGpPractice;
  if (!hasAny) return null;

  return (
    <section className="space-y-3 break-inside-avoid">
      <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">On file</h3>
      <div className="space-y-2.5">
        {facts.allergies ? (
          <div className="rounded-2xl bg-rosa-700 text-white p-4 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/80">Allergies</p>
              <p className="text-[14px] font-semibold mt-0.5">{facts.allergies}</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {facts.bloodGroup && (
            <FactTile icon={Droplet} label="Blood group" value={facts.bloodGroup} />
          )}
          {facts.emergencyMedication && (
            <FactTile icon={Pill} label="Emergency medication" value={facts.emergencyMedication} />
          )}
          {facts.preferredPharmacy && (
            <FactTile icon={Building2} label="Preferred pharmacy" value={facts.preferredPharmacy} />
          )}
          {facts.registeredGpPractice && (
            <FactTile icon={Building2} label="Registered GP practice" value={facts.registeredGpPractice} />
          )}
          {(facts.medicalAidScheme || facts.medicalAidPlanOption) && (
            <FactTile
              icon={ShieldAlert}
              label="Medical aid"
              value={[facts.medicalAidScheme, facts.medicalAidPlanOption].filter(Boolean).join(' — ')}
            />
          )}
        </div>

        {facts.organDonor && (
          <span className="chip bg-sage-100 text-sage-700 text-[12px] px-3 py-1">
            <Leaf className="w-3.5 h-3.5" /> Organ donor
          </span>
        )}
      </div>
    </section>
  );
}

function FactTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-cream-200 bg-white p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink-400 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      <p className="text-[14px] font-semibold text-ink-900 mt-1">{value}</p>
    </div>
  );
}

/* ---------------- Coming up row ---------------- */

// Typed as React.FC (rather than a plain function) purely so it can take a
// `key` prop when rendered from .map() below — matches MemberAppointments.tsx's
// own Row component, which does the same for the same reason.
const UpcomingRow: React.FC<{ item: HealthTimelineItem; todayIso: string }> = ({ item, todayIso }) => {
  const meta = kindMeta(item);
  const Icon = meta.Icon;
  return (
    <div className="p-3.5 rounded-2xl bg-white border border-dusk-100 flex items-start gap-3">
      <div className={`p-2 rounded-xl shrink-0 ${meta.dot}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={meta.chip}>{meta.label}</span>
        </div>
        <p className="text-[14px] font-semibold text-ink-900 mt-1">{item.title}</p>
        <p className="text-[12.5px] text-ink-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
          <span className="tabular-nums">{fmtDate(item.date)}</span>
          {item.time && <span className="tabular-nums">{item.time}</span>}
        </p>
        {item.provider && <p className="text-[12px] text-ink-500 mt-0.5">{item.provider}</p>}
      </div>
      <span className="chip bg-dusk-100 text-dusk-700 shrink-0">{relativeDayLabel(item.date, todayIso)}</span>
    </div>
  );
};

/* ---------------- History (dated, by year) ---------------- */

const YearGroup: React.FC<{ year: number; items: HealthTimelineItem[] }> = ({ year, items }) => {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">{year}</h3>
      <div className="relative">
        <div className="absolute left-4 top-2 bottom-2 w-px bg-cream-200" aria-hidden="true" />
        <div className="space-y-4">
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} showYear />
          ))}
        </div>
      </div>
    </section>
  );
};

// showYear=false (the undated bucket) skips the spine — a dateless row
// doesn't belong on a chronological line, so it renders as a plain card
// instead of pretending it has a place on one.
const HistoryRow: React.FC<{ item: HealthTimelineItem; showYear: boolean }> = ({ item, showYear }) => {
  const meta = kindMeta(item);
  const Icon = meta.Icon;

  const card = (
    <div className="rounded-2xl border border-cream-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {showYear && (
          <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide tabular-nums mr-1">
            {fmtDate(item.date)}
          </p>
        )}
        <span className={meta.chip}>{meta.label}</span>
        {item.kind === 'referral' && item.status && (
          <span className={`chip ${REFERRAL_STATUS_CHIP[item.status]}`}>{REFERRAL_STATUS_LABEL[item.status]}</span>
        )}
        {item.kind === 'referral' && item.stale && (
          <span className="chip bg-rosa-100 text-rosa-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Not yet booked
          </span>
        )}
      </div>

      {item.kind === 'growth' ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 mt-1">
          {item.heightCm != null && (
            <span className="text-[15px] font-semibold text-ink-900 tabular-nums">
              {item.heightCm} cm
              {item.deltaHeightCm != null && (
                <span className={`ml-1.5 text-[12px] font-semibold ${item.deltaHeightCm >= 0 ? 'text-sage-600' : 'text-honey-700'}`}>
                  ({signed(item.deltaHeightCm, ' cm')})
                </span>
              )}
            </span>
          )}
          {!!item.weightKg && (
            <span className="text-[14px] text-ink-700 tabular-nums">
              {item.weightKg} kg
              {item.deltaWeightKg != null && (
                <span className={`ml-1.5 text-[12px] font-semibold ${item.deltaWeightKg >= 0 ? 'text-sage-600' : 'text-honey-700'}`}>
                  ({signed(item.deltaWeightKg, ' kg')})
                </span>
              )}
            </span>
          )}
        </div>
      ) : (
        <p className="text-[15px] font-semibold text-ink-900 mt-1">{item.title}</p>
      )}

      {item.provider && <p className="text-[13px] text-ink-500 mt-0.5">{item.provider}</p>}
      {item.kind === 'referral' && item.status === 'booked' && item.appointmentDate && (
        <p className="text-[13px] text-ink-500 tabular-nums mt-0.5">Appt {fmtDate(item.appointmentDate)}</p>
      )}
      {item.notes && <p className="text-[13px] text-ink-500 mt-1 italic">{item.notes}</p>}
      {/* Bookkeeping only — never the date this row is sorted by (see rule 2
          in utils/healthTimeline.ts). Shown small and secondary on purpose. */}
      {item.kind === 'referral' && item.filedAt && (
        <p className="text-[11px] text-ink-300 mt-1">Filed {fmtDate(item.filedAt.slice(0, 10))}</p>
      )}
    </div>
  );

  if (!showYear) return card;

  return (
    <div className="relative pl-11">
      <div className={`absolute left-0 top-0 w-8 h-8 rounded-full ring-4 ring-white flex items-center justify-center ${meta.dot}`}>
        <Icon className="w-4 h-4" />
      </div>
      {card}
    </div>
  );
};
