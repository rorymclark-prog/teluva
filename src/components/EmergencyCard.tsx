import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Siren, X, AlertTriangle, Droplet, Pill, Activity, Phone, CreditCard, Printer, Leaf, ScanLine,
} from 'lucide-react';
import type { FamilyMember, CalendarEvent, IdCountry } from '../types';
import { warmAvatarColor } from '../utils/avatarPalette';
import EmergencyNumbersBanner from './EmergencyNumbersBanner';
import EmptyState from './EmptyState';

// A compact, self-contained plain-text ICE summary encoded into the QR so a
// first responder can scan it with any phone camera — no app, no network. Kept
// short (only fields on file) so the QR stays low-density and easy to scan.
function buildIceText(m: FamilyMember, age: string | null, fallbacks: FallbackContact[]): string {
  const med = m.medical;
  const lines: string[] = [];
  lines.push(`ICE - ${m.name}${age ? ` (${age})` : ''}`);
  if (m.birthdate) lines.push(`DOB: ${m.birthdate}`);
  lines.push(`Blood: ${med?.bloodGroup || 'unknown'}`);
  lines.push(`Allergies: ${med?.allergies || 'none on file'}`);
  if (med?.medications) lines.push(`Meds: ${med.medications}`);
  if (med?.emergencyMedication) lines.push(`Emergency med: ${med.emergencyMedication}`);
  if (med?.conditions) lines.push(`Conditions: ${med.conditions}`);
  if (med?.organDonor === true) lines.push('Organ donor: yes');
  if (m.identity?.eCardNumber) lines.push(`e-card: ${m.identity.eCardNumber}`);
  if (m.emergencyContactName || m.emergencyContactPhone) {
    lines.push(`Emergency contact: ${[m.emergencyContactName, m.emergencyContactPhone].filter(Boolean).join(' ')}`);
  }
  fallbacks.forEach((c) => lines.push(`Also: ${c.name} ${c.phone}`));
  // Cap length so the QR stays scannable even if free-text fields are verbose.
  return lines.join('\n').slice(0, 600);
}

// Age at a glance — months for infants/toddlers (<2y), years otherwise. Kept
// local (not imported from Dashboard/MemberOverview) so this file has zero
// cross-component coupling — a break-glass card must render standalone.
function parseDateOnly(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (match) {
    const [, y, mo, d] = match;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  const fallback = new Date(dateStr);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function calcAge(birthdate?: string): string | null {
  if (!birthdate) return null;
  const b = parseDateOnly(birthdate);
  if (!b) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  if (age < 0) return null;
  if (age < 2) {
    const months = Math.max(0, Math.round((now.getTime() - b.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)));
    return `${months} mo`;
  }
  return `${age} yrs`;
}

interface FallbackContact {
  id: string;
  name: string;
  phone: string;
}

// Emergency "break-glass" ICE card — the screen a paramedic or ER intake desk
// actually reads. One person at a time, maximum-legibility blocks, print-ready.
// Deliberately plain and serious: no playful motion, no cute copy.
export default function EmergencyCard({
  members,
  events,
  country,
  onClose,
}: {
  members: FamilyMember[];
  events: CalendarEvent[];
  country?: IdCountry;
  onClose: () => void;
}) {
  void events; // signature parity with other full-screen views in this app; not used by the ICE card

  const [selectedId, setSelectedId] = useState<string | null>(members[0]?.id ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selected = useMemo(
    () => members.find((m) => m.id === selectedId) ?? members[0] ?? null,
    [members, selectedId],
  );

  // A couple of the other adult members as fallback contacts, parents first.
  const fallbackContacts: FallbackContact[] = useMemo(() => {
    if (!selected) return [];
    const rolePriority = (r: FamilyMember['role']) => (r === 'Parent' ? 0 : r === 'Grandparent' ? 1 : 2);
    return members
      .filter((m) => m.id !== selected.id && m.role !== 'Child' && m.phone)
      .sort((a, b) => rolePriority(a.role) - rolePriority(b.role))
      .slice(0, 2)
      .map((m) => ({ id: m.id, name: m.name, phone: m.phone as string }));
  }, [members, selected]);

  const med = selected?.medical;
  const age = calcAge(selected?.birthdate);
  const first = selected ? selected.name.split(/\s+/)[0] || selected.name : '';
  const hasMedicationInfo = !!(med?.medications || med?.emergencyMedication || med?.conditions);
  const hasContactInfo = !!(selected?.emergencyContactName || selected?.emergencyContactPhone || fallbackContacts.length > 0);
  const iceText = useMemo(
    () => (selected ? buildIceText(selected, age, fallbackContacts) : ''),
    [selected, age, fallbackContacts],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-[120] overflow-y-auto bg-ink-900/60 backdrop-blur-sm flex justify-center px-3 py-6 sm:p-8 print:static print:bg-white print:backdrop-blur-none print:p-0 print:overflow-visible"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Emergency card"
        className="w-full max-w-3xl h-fit my-auto bg-white rounded-[28px] border border-cream-300/60 shadow-2xl overflow-hidden print:my-0 print:shadow-none print:border-0 print:rounded-none print:max-w-full print:w-full"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 sm:p-7 border-b border-cream-200 print:border-b print:border-ink-900">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-2xl bg-rosa-700 text-white shrink-0 print:hidden">
              <Siren className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-ink-900 leading-tight tracking-tight">
                Emergency card
              </h2>
              <p className="text-[13px] text-ink-500 font-medium mt-0.5">Show this to emergency services.</p>
            </div>
          </div>

          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => window.print()} className="btn-quiet" title="Print or save this card">
              <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Print / Save</span>
            </button>
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* The national emergency number comes FIRST — above the person picker and
            above the "no members yet" state. Whoever is holding this phone in a
            real emergency may not be family and may never have opened the app. */}
        <div className="px-5 sm:px-7 pt-5 sm:pt-7">
          <EmergencyNumbersBanner country={country} />
        </div>

        {!selected ? (
          <div className="p-6">
            <EmptyState
              size="sm"
              title="No family members yet."
              description="Add a member and their medical info to build an emergency card."
            />
          </div>
        ) : (
          <>
            {/* Person selector */}
            {members.length > 1 && (
              <div className="flex items-center gap-2 px-5 sm:px-7 py-3.5 border-b border-cream-200 overflow-x-auto print:hidden">
                {members.map((m) => {
                  const isSelected = m.id === selected.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                      className={`shrink-0 inline-flex items-center gap-2 rounded-full pl-1.5 pr-3.5 py-1.5 text-[13px] font-semibold transition-colors cursor-pointer ${
                        isSelected ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-600 hover:bg-cream-200'
                      }`}
                    >
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                      ) : (
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white uppercase ${warmAvatarColor(m.avatarColor)}`}
                        >
                          {m.name.charAt(0)}
                        </span>
                      )}
                      {m.name.split(/\s+/)[0] || m.name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Body */}
            <div className="p-5 sm:p-7 space-y-4 sm:space-y-5">
              {/* Identity */}
              <div className="flex items-center gap-4">
                {selected.avatarUrl ? (
                  <img
                    src={selected.avatarUrl}
                    alt=""
                    className="w-16 h-16 rounded-2xl object-cover border border-cream-300 shrink-0"
                  />
                ) : (
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white uppercase shrink-0 ${warmAvatarColor(selected.avatarColor)}`}
                  >
                    {selected.name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-display text-2xl sm:text-3xl font-extrabold text-ink-900 leading-tight truncate">
                    {selected.name}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="chip bg-cream-200 text-ink-600">{selected.role}</span>
                    {age && <span className="chip bg-dusk-100 text-dusk-700 tabular-nums">{age}</span>}
                    {selected.birthdate && (
                      <span className="text-[12px] text-ink-400 font-medium tabular-nums">b. {selected.birthdate}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Scannable ICE QR — any phone camera reads it, offline, no app needed */}
              <div className="rounded-3xl border border-cream-300 bg-white p-4 sm:p-5 flex items-center gap-4 sm:gap-5 break-inside-avoid">
                <div className="shrink-0 rounded-2xl bg-white p-2 border border-cream-200">
                  <QRCodeSVG value={iceText} size={112} level="M" marginSize={0} />
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    <ScanLine className="w-3.5 h-3.5" /> Scan in an emergency
                  </p>
                  <p className="text-[14px] font-semibold text-ink-800 mt-1 leading-snug">
                    Point any phone camera here to read {first}&apos;s critical details — works offline, no app needed.
                  </p>
                </div>
              </div>

              {/* Blood type — huge, the first number a paramedic scans for */}
              <div className="rounded-3xl bg-ink-900 text-white p-6 break-inside-avoid">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/60">
                  <Droplet className="w-3.5 h-3.5" /> Blood type
                </p>
                {med?.bloodGroup ? (
                  <p className="text-6xl sm:text-7xl font-black leading-none mt-1.5 tabular-nums">{med.bloodGroup}</p>
                ) : (
                  <p className="text-lg font-semibold text-honey-200 mt-2 italic">Not on file</p>
                )}
              </div>

              {/* Allergies — life-critical, alarm styling when present */}
              {med?.allergies ? (
                <div className="rounded-3xl bg-rosa-700 text-white p-5 sm:p-6 break-inside-avoid">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/80">
                    <AlertTriangle className="w-4 h-4" /> Allergies
                  </p>
                  <p className="text-2xl sm:text-3xl font-extrabold leading-snug mt-1.5">{med.allergies}</p>
                </div>
              ) : (
                <div className="rounded-2xl bg-sage-100 text-sage-700 p-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <p className="text-[13px] font-semibold">No known allergies on file.</p>
                </div>
              )}

              {/* Medications / emergency medication / chronic conditions */}
              {hasMedicationInfo && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {med?.medications && (
                    <InfoTile icon={<Pill className="w-4 h-4" />} label="Current medications" value={med.medications} />
                  )}
                  {med?.emergencyMedication && (
                    <InfoTile
                      icon={<Pill className="w-4 h-4" />}
                      label="Emergency medication"
                      value={med.emergencyMedication}
                      accent
                    />
                  )}
                  {med?.conditions && (
                    <InfoTile icon={<Activity className="w-4 h-4" />} label="Chronic conditions" value={med.conditions} />
                  )}
                </div>
              )}

              {/* Insurance / e-card */}
              {(selected.identity?.eCardNumber || selected.identity?.svNumber) && (
                <div className="rounded-2xl bg-dusk-50 border border-dusk-100 p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-dusk-700">
                    <CreditCard className="w-3.5 h-3.5" /> Insurance / e-card
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {selected.identity?.eCardNumber && (
                      <p className="font-mono tabular-nums text-[15px] font-semibold text-ink-900">
                        {selected.identity.eCardNumber}
                      </p>
                    )}
                    {selected.identity?.svNumber && (
                      <p className="font-mono tabular-nums text-[13px] text-ink-600">SV {selected.identity.svNumber}</p>
                    )}
                  </div>
                </div>
              )}

              {med?.organDonor === true && (
                <div>
                  <span className="chip bg-sage-100 text-sage-700 text-[12px] px-3 py-1">
                    <Leaf className="w-3.5 h-3.5" /> Organ donor
                  </span>
                </div>
              )}

              {/* Emergency contacts */}
              <div className="rounded-2xl bg-cream-100 border border-cream-200 p-4 sm:p-5 break-inside-avoid">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">
                  <Phone className="w-3.5 h-3.5" /> Emergency contacts
                </p>
                {hasContactInfo ? (
                  <div className="mt-2 space-y-3">
                    {(selected.emergencyContactName || selected.emergencyContactPhone) && (
                      <div>
                        {selected.emergencyContactName && (
                          <p className="text-lg font-bold text-ink-900">{selected.emergencyContactName}</p>
                        )}
                        {selected.emergencyContactPhone && (
                          <a
                            href={`tel:${selected.emergencyContactPhone.replace(/\s+/g, '')}`}
                            className="inline-flex items-center gap-1.5 text-lg font-mono tabular-nums font-bold text-sage-700 hover:underline"
                          >
                            <Phone className="w-4 h-4" /> {selected.emergencyContactPhone}
                          </a>
                        )}
                      </div>
                    )}
                    {fallbackContacts.length > 0 && (
                      <div className="pt-2 border-t border-cream-300/70 space-y-1.5">
                        <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">Also try</p>
                        {fallbackContacts.map((c) => (
                          <div key={c.id} className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold text-ink-800">{c.name}</span>
                            <a
                              href={`tel:${c.phone.replace(/\s+/g, '')}`}
                              className="text-[13px] font-mono tabular-nums font-semibold text-sage-700 hover:underline"
                            >
                              {c.phone}
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] font-semibold text-ink-400 italic mt-2">No emergency contact on file.</p>
                )}
              </div>
            </div>

            <p className="pb-5 sm:pb-7 px-5 sm:px-7 text-center text-[12px] text-ink-400">
              {first}&apos;s ICE card &middot; generated {new Date().toLocaleDateString()}
            </p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function InfoTile({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'bg-honey-50 border-honey-100' : 'bg-white border-cream-200'}`}>
      <p
        className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${accent ? 'text-honey-700' : 'text-ink-500'}`}
      >
        {icon} {label}
      </p>
      <p className={`text-[15px] font-semibold leading-snug mt-1 ${accent ? 'text-honey-900' : 'text-ink-800'}`}>{value}</p>
    </div>
  );
}
