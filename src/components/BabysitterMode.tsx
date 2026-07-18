import { Fragment, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, ShieldCheck, AlertTriangle, Pill, Stethoscope, Phone, GraduationCap,
  Printer, Baby, Home, CalendarClock, NotebookPen, CheckCircle2,
} from 'lucide-react';
import type { ElementType } from 'react';
import { FamilyMember, CalendarEvent } from '../types';
import { warmAvatarColor } from '../utils/avatarPalette';

// ─────────────────────────────────────────────────────────────────────────
// Babysitter / Carer mode — a safe, READ-ONLY handover screen.
//
// Deliberately shows ONLY what a sitter or grandparent needs in an emergency
// or during a normal visit: each child's allergies, medications, school and
// emergency contact, plus a household contact line for the parents. It must
// NEVER render passports, ID/permit numbers, e-card/SV numbers, bank/financial
// details, or passwords — those stay behind the full app, sign-in required.
// ─────────────────────────────────────────────────────────────────────────

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function calcAge(birthdate?: string): string | null {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  if (age < 2) {
    const months = Math.max(0, Math.round((now.getTime() - b.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)));
    return `${months} mo`;
  }
  return `${age} yrs`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CATEGORY_STYLE: Record<CalendarEvent['category'], string> = {
  School: 'bg-dusk-100 text-dusk-700',
  Travel: 'bg-honey-100 text-honey-900',
  Appointment: 'bg-rosa-100 text-rosa-700',
  Milestone: 'bg-sage-100 text-sage-700',
  Other: 'bg-cream-200 text-ink-600',
};

interface Props {
  members: FamilyMember[];
  events: CalendarEvent[];
  onClose: () => void;
}

export default function BabysitterMode({ members, events, onClose }: Props) {
  const children = useMemo(() => members.filter((m) => m.role === 'Child'), [members]);
  const householdAdults = useMemo(
    () => members.filter((m) => m.role !== 'Child' && m.phone),
    [members],
  );
  const [selectedId, setSelectedId] = useState<'all' | string>('all');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shownChildren = selectedId === 'all' ? children : children.filter((c) => c.id === selectedId);

  const today = todayISO();
  const todaysEvents = useMemo(() => {
    const ids = new Set(shownChildren.map((c) => c.id));
    return events
      .filter((e) => e.date === today)
      .filter((e) => !e.memberIds?.length || e.memberIds.some((id) => ids.has(id)))
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }, [events, today, selectedId, shownChildren]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Babysitter mode — safe handover sheet"
        className="fixed inset-0 z-[120] bg-ink-900/45 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 print:static print:bg-white print:p-0 print:backdrop-blur-none"
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl max-h-[94vh] bg-cream-50 rounded-3xl shadow-lift flex flex-col overflow-hidden print:max-h-none print:max-w-full print:rounded-none print:shadow-none"
        >
          {/* Header */}
          <div className="shrink-0 p-4 sm:p-5 border-b border-cream-200 bg-white flex items-center justify-between gap-3 print:hidden">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-sage-100 text-sage-700 flex items-center justify-center shrink-0">
                <Baby className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold text-ink-900 leading-tight">Babysitter mode</h2>
                <p className="text-[12px] text-ink-500 font-medium truncate">A safe sheet to hand your sitter or grandparent</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-ink-400 hover:text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer shrink-0"
              aria-label="Close"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="overflow-y-auto p-4 sm:p-6 space-y-5 print:overflow-visible print:p-6">
            {/* Print-only heading (header above is hidden when printing) */}
            <div className="hidden print:flex items-center gap-2 mb-1">
              <Baby className="w-5 h-5 text-sage-700" />
              <h1 className="font-display text-xl font-bold text-ink-900">Babysitter / carer handover sheet</h1>
            </div>

            {/* Safety banner */}
            <div className="rounded-2xl bg-sage-100 border border-sage-200 px-4 py-3 flex items-center gap-2.5 print:bg-white print:border-ink-900/20">
              <ShieldCheck className="w-4.5 h-4.5 text-sage-700 shrink-0" />
              <p className="text-[13px] font-semibold text-sage-700">
                Safe to hand over — no sensitive documents shown.
              </p>
            </div>

            {/* People selector */}
            {children.length > 1 && (
              <div className="flex flex-wrap gap-2 print:hidden">
                <button
                  onClick={() => setSelectedId('all')}
                  className={`chip px-3.5 py-1.5 text-[12px] cursor-pointer transition-colors ${
                    selectedId === 'all' ? 'bg-ink-900 text-white' : 'bg-white border border-cream-300 text-ink-600 hover:bg-cream-100'
                  }`}
                >
                  All kids
                </button>
                {children.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`chip px-3.5 py-1.5 text-[12px] cursor-pointer transition-colors ${
                      selectedId === c.id ? 'bg-ink-900 text-white' : 'bg-white border border-cream-300 text-ink-600 hover:bg-cream-100'
                    }`}
                  >
                    {firstName(c.name)}
                  </button>
                ))}
              </div>
            )}

            {/* Children cards */}
            {children.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm font-semibold text-ink-800">No children added yet</p>
                <p className="text-[13px] text-ink-400 mt-1">Add a child profile to build their handover sheet here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {shownChildren.map((child) => (
                  <Fragment key={child.id}>
                    <ChildCard child={child} />
                  </Fragment>
                ))}
              </div>
            )}

            {/* Today's schedule */}
            {todaysEvents.length > 0 && (
              <div className="card p-4 sm:p-5">
                <p className="section-label flex items-center gap-1.5 mb-3">
                  <CalendarClock className="w-3.5 h-3.5" /> Today
                </p>
                <div className="space-y-2">
                  {todaysEvents.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 text-[13px]">
                      <span className="font-mono tabular-nums font-semibold text-ink-700 w-12 shrink-0">{e.time || '—'}</span>
                      <span className="text-ink-800 font-medium truncate">{e.title}</span>
                      <span className={`chip ml-auto shrink-0 ${CATEGORY_STYLE[e.category] || CATEGORY_STYLE.Other}`}>{e.category}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Household / parents contact line */}
            {householdAdults.length > 0 && (
              <div className="card p-4 sm:p-5">
                <p className="section-label flex items-center gap-1.5 mb-3">
                  <Home className="w-3.5 h-3.5" /> Parents &amp; household contacts
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {householdAdults.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-cream-100 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-ink-900 truncate">{a.name}</p>
                        <p className="text-[11px] text-ink-400 font-medium">{a.role}</p>
                      </div>
                      <a
                        href={`tel:${a.phone!.replace(/\s+/g, '')}`}
                        className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-mono tabular-nums font-semibold text-sage-700 hover:underline"
                      >
                        <Phone className="w-3.5 h-3.5" /> {a.phone}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-center text-[11px] text-ink-400 pt-1">
              Generated {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} ·
              Passwords, passports, and ID numbers are never shown here.
            </p>
          </div>

          {/* Footer actions */}
          <div className="shrink-0 p-3.5 sm:p-4 border-t border-cream-200 bg-white flex items-center justify-center gap-2.5 print:hidden">
            <button onClick={() => window.print()} className="btn-primary">
              <Printer className="w-4 h-4" /> Print
            </button>
            <button onClick={onClose} className="btn-quiet">Close</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ChildCard({ child }: { child: FamilyMember }) {
  const med = child.medical || {};
  const first = firstName(child.name);
  const age = calcAge(child.birthdate);
  const hasContact = !!(child.emergencyContactName || child.emergencyContactPhone);
  const hasSchool = !!(child.education?.schoolName || child.education?.teacherName);
  const hasNotes = !!med.notes;
  const hasAnything = !!(med.allergies || med.medications || med.emergencyMedication || med.conditions || hasContact || hasSchool || hasNotes);

  return (
    <div className="card p-4 sm:p-5 space-y-3.5 print:break-inside-avoid">
      {/* Child header */}
      <div className="flex items-center gap-3">
        {child.avatarUrl ? (
          <div className="w-12 h-12 rounded-2xl overflow-hidden border border-cream-300 shrink-0 bg-white">
            <img src={child.avatarUrl} alt={child.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg text-white shrink-0 uppercase ${warmAvatarColor(child.avatarColor)}`}>
            {child.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold text-ink-900 leading-tight truncate">{first}</h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            {age && <span className="chip bg-cream-200 text-ink-600">{age}</span>}
          </div>
        </div>
      </div>

      {/* Allergies — most prominent */}
      {med.allergies ? (
        <div className="p-3.5 rounded-2xl bg-rosa-50 border-2 border-rosa-200">
          <p className="section-label flex items-center gap-1.5 mb-1 text-rosa-700">
            <AlertTriangle className="w-4 h-4" /> Allergies
          </p>
          <p className="text-[15px] font-bold text-rosa-700 leading-snug">{med.allergies}</p>
        </div>
      ) : (
        <div className="p-3 rounded-2xl bg-sage-50 border border-sage-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-sage-700 shrink-0" />
          <p className="text-[13px] font-medium text-sage-700">No allergies on file for {first}.</p>
        </div>
      )}

      {/* Emergency medication — equally safety-critical */}
      {med.emergencyMedication && (
        <InfoBlock icon={Pill} label="Emergency medication" value={med.emergencyMedication} accent="honey" />
      )}

      {/* Regular medications */}
      {med.medications && (
        <InfoBlock icon={Pill} label="Medications" value={med.medications} />
      )}

      {/* Conditions to know about */}
      {med.conditions && (
        <InfoBlock icon={Stethoscope} label="Conditions to know about" value={med.conditions} />
      )}

      {/* School */}
      {hasSchool && (
        <InfoBlock
          icon={GraduationCap}
          label="School"
          value={[child.education?.schoolName, child.education?.grade && `Grade ${child.education.grade}`].filter(Boolean).join(' · ')}
          extra={child.education?.teacherName ? `Teacher: ${child.education.teacherName}${child.education.teacherContact ? ` · ${child.education.teacherContact}` : ''}` : undefined}
        />
      )}

      {/* Doctor / emergency contact */}
      {hasContact && (
        <div className="p-3.5 rounded-2xl bg-dusk-50 border border-dusk-100">
          <p className="section-label flex items-center gap-1.5 mb-1">
            <Phone className="w-3.5 h-3.5" /> Doctor / emergency contact
          </p>
          {child.emergencyContactName && <p className="text-[14px] font-semibold text-ink-900">{child.emergencyContactName}</p>}
          {child.emergencyContactPhone && (
            <a
              href={`tel:${child.emergencyContactPhone.replace(/\s+/g, '')}`}
              className="inline-flex items-center gap-1.5 mt-0.5 text-[14px] font-mono tabular-nums font-semibold text-dusk-700 hover:underline"
            >
              <Phone className="w-3.5 h-3.5 shrink-0" /> {child.emergencyContactPhone}
            </a>
          )}
        </div>
      )}

      {/* Care notes */}
      {hasNotes && (
        <InfoBlock icon={NotebookPen} label="Notes for carers" value={med.notes!} />
      )}

      {!hasAnything && (
        <p className="text-[13px] text-ink-400 text-center py-2">No carer notes on file for {first} yet.</p>
      )}
    </div>
  );
}

function InfoBlock({
  icon: Icon,
  label,
  value,
  extra,
  accent,
}: {
  icon: ElementType;
  label: string;
  value: string;
  extra?: string;
  accent?: 'honey';
}) {
  const isHoney = accent === 'honey';
  return (
    <div className={`p-3.5 rounded-2xl border ${isHoney ? 'bg-honey-50 border-honey-100' : 'bg-cream-100 border-cream-200'}`}>
      <p className={`section-label flex items-center gap-1.5 mb-1 ${isHoney ? 'text-honey-700' : ''}`}>
        <Icon className="w-3.5 h-3.5" /> {label}
      </p>
      {value && (
        <p className={`text-[14px] leading-snug ${isHoney ? 'text-honey-900 font-semibold' : 'text-ink-800 font-medium'}`}>{value}</p>
      )}
      {extra && <p className="text-[12px] text-ink-500 mt-0.5">{extra}</p>}
    </div>
  );
}
