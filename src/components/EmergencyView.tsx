import React, { useEffect, useState } from 'react';
import { FamilyMember, IdCountry } from '../types';
import { calculateAge } from './Dashboard';
import { warmAvatarColor } from '../utils/avatarPalette';
import EmergencyNumbersBanner from './EmergencyNumbersBanner';
import EmptyState from './EmptyState';
import CopyableValue from './CopyableValue';
import {
  Phone, Heart, AlertTriangle, Pill, Activity,
  CreditCard, Leaf, Users, Briefcase, WifiOff, ArrowLeft, Download, ExternalLink, Share2, ShieldCheck,
  Plane, ArrowRight
} from 'lucide-react';
import type { Trip } from '../utils/trip';
import {
  activateEmergencyPackScope,
  EmergencyPack,
  EmergencyPackScope,
  isEmergencyPackOfflineReady,
  loadEmergencyPack,
  markEmergencyPackVerified,
  packAgeDays,
  packExpiryTime,
  PACK_EXPIRY_DAYS,
  PACK_STALE_DAYS,
  prepareEmergencyShell,
  refreshEmergencyPack,
  removeEmergencyPack,
  saveEmergencyPack,
} from '../utils/emergencyPack';
import { appConfirm } from '../utils/appConfirm';

interface EmergencyViewProps {
  members: FamilyMember[];
  country?: IdCountry;
  emberMode?: boolean;
  packMode?: boolean;
  packScope?: EmergencyPackScope;
  savedPack?: EmergencyPack;
  onExit?: () => void;
  /** Trips happening now or imminent. Empty for a family not travelling. */
  trips?: Trip[];
  onOpenTrip?: (tripId: string) => void;
}

export default function EmergencyView({ members, country = 'AT', emberMode = false, packMode = false, packScope, savedPack, onExit, trips = [], onOpenTrip }: EmergencyViewProps) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [pack, setPack] = useState<EmergencyPack | null>(() => savedPack || (packScope ? loadEmergencyPack(packScope) : null));
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const [preparingPack, setPreparingPack] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!packScope || packMode) return;
    activateEmergencyPackScope(packScope);
    setPack(loadEmergencyPack(packScope));
  }, [packMode, packScope?.ownerUid, packScope?.spaceId, packScope?.spaceName]);

  const packReady = isEmergencyPackOfflineReady(pack);

  const offlineNotice = !online && (emberMode || packMode) && (
    <div className="ember-offline-emergency" role="status">
      <WifiOff className="h-4 w-4" />
      <span><b>Offline copy</b><small>Showing details already available on this device. Phone actions still work.</small></span>
    </div>
  );

  /* Keep an existing pack's CONTENT fresh without a tap. The person consented
     once to keeping a device copy; letting that copy silently rot into
     out-of-date allergies and dead phone numbers honours the letter of the
     consent and betrays its purpose. So any online visit to Emergency
     re-stamps the already-consented pack with current data (also pushing its
     60-day expiry out — an actively used device never expires; an abandoned
     one does). Only for packs older than a day, so ordinary navigation
     doesn't rewrite storage on every render. First saves still go through
     the explicit consent below — this never CREATES a pack. */
  useEffect(() => {
    if (!packScope || packMode || !online || !pack || members.length === 0) return;
    if (packAgeDays(pack) < 1) return;
    try {
      const refreshed = refreshEmergencyPack(members, country, packScope);
      if (refreshed) setPack(refreshed);
    } catch { /* storage unavailable — the stale-pack banner still shows */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, packMode, packScope?.ownerUid, packScope?.spaceId]);

  const savePack = async () => {
    if (!packScope) return;
    // Explicit device consent (design-audit P0), once, at the FIRST save.
    // Updates skip it — consent was already given for this device+space.
    if (!pack) {
      const ok = await appConfirm(
        'The pack is stored readable on this device so it opens instantly with no internet and no sign-in — that also means anyone who can unlock this device can read it.\n\n'
        + `It refreshes itself whenever you open Emergency online, and self-deletes after ${PACK_EXPIRY_DAYS} days without a refresh. You can remove it here any time.`,
        { title: 'Keep an offline emergency copy on this device?', confirmLabel: 'Keep on this device' },
      );
      if (!ok) return;
    }
    setPreparingPack(true);
    try {
      const saved = saveEmergencyPack(members, country, packScope);
      setPack(saved);
      setPackNotice('Emergency facts saved. Verifying cold-offline opening…');
      try {
        await prepareEmergencyShell();
        const verified = markEmergencyPackVerified(packScope);
        setPack(verified);
        setPackNotice('Offline pack verified. Test it before relying on it.');
      } catch {
        setPackNotice('Emergency facts are saved, but cold-offline opening could not be verified. Reconnect and try again.');
      }
    } catch {
      setPackNotice('This browser would not allow the offline pack to be saved.');
    } finally {
      setPreparingPack(false);
    }
  };

  const deletePack = () => {
    if (!packScope) return;
    try { removeEmergencyPack(packScope); } catch { /* storage unavailable */ }
    setPack(null);
    setPackNotice('Offline pack removed from this device.');
  };

  const shareCard = async () => {
    const text = members.map(member => {
      const facts = [member.medical?.allergies && `Allergies: ${member.medical.allergies}`, member.medical?.bloodGroup && `Blood group: ${member.medical.bloodGroup}`, member.emergencyContactPhone && `Emergency contact: ${member.emergencyContactPhone}`].filter(Boolean);
      return `${member.name}${facts.length ? ` — ${facts.join(' · ')}` : ''}`;
    }).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Teluva emergency card', text });
      else {
        await navigator.clipboard.writeText(text);
        setPackNotice('Emergency summary copied.');
      }
    } catch { /* sharing was cancelled */ }
  };

  const emergencyTop = (emberMode || packMode) && (
    <header className="ember-emergency-topbar">
      {onExit
        ? <button type="button" onClick={onExit}><ArrowLeft className="h-4 w-4" /> Back to People</button>
        : <a href="/"><ArrowLeft className="h-4 w-4" /> Back to Teluva</a>}
      <b>Teluva emergency</b>
      <span><ShieldCheck className="h-4 w-4" />{packMode ? `Saved for ${savedPack?.spaceName || 'this family'}` : packReady ? `Ready offline · ${pack?.spaceName}` : pack ? 'Facts saved · verification needed' : 'Live view'}</span>
    </header>
  );

  const actions = (emberMode || packMode) && members.length > 0 && (
    <section className="ember-emergency-actions" aria-label="Emergency actions">
      <button type="button" onClick={shareCard}><Share2 className="h-5 w-5" /><span><b>Share card</b><small>Send the visible facts</small></span></button>
      <a href="https://www.google.com/maps/search/hospital" target="_blank" rel="noreferrer"><ExternalLink className="h-5 w-5" /><span><b>Nearest hospital</b><small>Opens your map service</small></span></a>
    </section>
  );

  if (members.length === 0) {
    // Still show the dial-now number: it is useful on day one, before anyone
    // has entered a single record.
    return (
      <div className="space-y-6 font-sans max-w-lg mx-auto mt-8">
        {emergencyTop}
        {offlineNotice}
        <EmergencyNumbersBanner country={country} />
        <div className="card">
          <EmptyState
            icon={Users}
            title="No members yet"
            description="Add family members and fill in their medical info first — the emergency sheet will populate automatically from that data."
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 font-sans ${emberMode || packMode ? 'ember-emergency-screen' : ''}`}>
      {emergencyTop}
      {offlineNotice}
      {/* The dial-now number leads the page — everything below it is detail. */}
      <EmergencyNumbersBanner country={country} />

      {/* Anyone away from home sits directly under the emergency numbers. This
          screen is opened when something has gone wrong, and "who is not here"
          is the first thing that changes the answer — the numbers on this page
          are the numbers for HERE, and they are the wrong ones for someone
          abroad. Rendered only while a trip is current, so it costs nothing the
          rest of the year. Ungated by role, like the rest of this view. */}
      {trips.length > 0 && onOpenTrip && (
        <section className="rounded-2xl border border-honey-200 bg-honey-50 overflow-hidden print:border-ink-900/20">
          <div className="px-4 sm:px-5 py-3 border-b border-honey-200 flex items-center gap-2">
            <Plane className="w-4 h-4 text-honey-700" />
            <h3 className="text-[13px] font-bold text-honey-900">Away from home right now</h3>
          </div>
          <div className="divide-y divide-honey-200/70">
            {trips.map((trip) => {
              const names = trip.memberIds
                .map((id) => members.find((member) => member.id === id)?.name.split(' ')[0])
                .filter(Boolean);
              return (
                <button
                  key={trip.id}
                  type="button"
                  onClick={() => onOpenTrip(trip.id)}
                  className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 text-left hover:bg-honey-100/60 transition-colors cursor-pointer"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold text-honey-900 truncate">
                      {names.length ? names.join(', ') : 'The family'}
                      {trip.destination ? ` — ${trip.destination}` : ''}
                    </span>
                    <span className="block text-[12px] text-honey-800/90 font-medium">
                      {trip.status === 'active'
                        ? `Home in ${trip.daysUntilEnd} day${trip.daysUntilEnd === 1 ? '' : 's'}`
                        : `Leaves in ${trip.daysUntilStart} day${trip.daysUntilStart === 1 ? '' : 's'}`}
                      {' · '}Insurance, passport and what to do if documents are lost
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-honey-700 shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {actions}

      {emberMode && !packMode && (
        <section className="ember-emergency-pack-controls">
          <div>
            <span className="pulse-eyebrow">Emergency pack · This device only</span>
            <h2>{packReady ? 'Cold-offline opening is verified.' : pack ? 'Emergency facts saved; offline opening still needs verification.' : 'Make this screen available offline.'}</h2>
            <p>For {packScope?.spaceName || 'this family'}, this stores only the emergency facts shown here—no documents, remote photos or hidden profile fields. Anyone who can unlock this device can open the pack.</p>
            {pack && (
              <p>
                Saved {new Date(pack.savedAt).toLocaleDateString()} · refreshes itself when you open this screen online · self-deletes {new Date(packExpiryTime(pack)).toLocaleDateString()} if it can&rsquo;t refresh.
              </p>
            )}
            {packNotice && <small role="status">{packNotice}</small>}
          </div>
          <div>
            <button type="button" onClick={savePack} disabled={preparingPack} className="btn-primary"><Download className="h-4 w-4" />{preparingPack ? 'Verifying…' : pack ? 'Update & verify' : 'Save & verify offline pack'}</button>
            {pack && <a href="/emergency-pack?test=1" target="_blank" rel="noreferrer" className="btn-quiet"><ExternalLink className="h-4 w-4" />Open saved pack</a>}
            {pack && <button type="button" onClick={deletePack} className="btn-quiet">Remove</button>}
          </div>
        </section>
      )}

      {/* Freshness must be answerable AT THE MOMENT OF USE: someone reading
          allergies off this screen in a hospital corridor needs to know if
          they're looking at last month's facts. Age in days, not a raw
          timestamp — and past PACK_STALE_DAYS it stops being a caption and
          becomes a warning. */}
      {packMode && savedPack && (() => {
        const age = packAgeDays(savedPack);
        const stale = age >= PACK_STALE_DAYS;
        return (
          <p className="ember-emergency-pack-stamp" role={stale ? 'alert' : undefined}>
            {stale
              ? <>⚠ These details were saved {age} days ago and may be out of date — open Teluva online to refresh them. This copy deletes itself {new Date(packExpiryTime(savedPack)).toLocaleDateString()}.</>
              : <>Saved for {savedPack.spaceName || 'this family'} · {age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`} · check the live app when a connection returns</>}
          </p>
        );
      })()}

      {/* Classic keeps its compact page title; Ember has the dedicated top bar. */}
      {!emberMode && !packMode && <div className="card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-rosa-100 text-rosa-500 shrink-0">
            <Heart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Emergency sheet</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              Quick-access emergency details for every family member. Keep this page bookmarked.
            </p>
          </div>
        </div>
      </div>}

      {/* Member cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {members.map((member) => (
          <React.Fragment key={member.id}>
            <MemberEmergencyCard member={member} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function MemberEmergencyCard({ member }: { member: FamilyMember }) {
  const age = calculateAge(member.birthdate);
  const med = member.medical;
  const identity = member.identity;

  const hasPhone = !!member.emergencyContactPhone;
  const hasContact = !!(member.emergencyContactName || member.emergencyContactPhone);
  const hasSv = !!(identity?.svNumber);
  const hasEcard = !!(identity?.eCardNumber);
  const hasIdentity = hasSv || hasEcard;
  const hasEmployer = !!(member.employer || member.jobTitle || member.workPhone || member.workAddress);

  return (
    <div className="card p-5 sm:p-6 space-y-5">
      {/* ── Member header ── */}
      <div className="flex items-start gap-4">
        {member.avatarUrl ? (
          <div className="w-14 h-14 rounded-2xl overflow-hidden border border-cream-300 shadow-soft shrink-0 bg-white">
            <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl text-white shrink-0 uppercase ${warmAvatarColor(member.avatarColor)}`}
          >
            {member.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl font-semibold text-ink-900 leading-tight">
            {member.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="chip bg-cream-200 text-ink-600">{member.role}</span>
            {age && (
              <span className="chip bg-dusk-100 text-dusk-700">{age}</span>
            )}
            {member.birthdate && (
              <span className="text-[12px] text-ink-400 font-medium">
                b. {member.birthdate}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Blood group ── */}
      {med?.bloodGroup && (
        <div>
          <p className="section-label flex items-center gap-1 mb-2">
            <Activity className="w-3.5 h-3.5" /> Blood group
          </p>
          <span className="chip bg-honey-100 text-honey-900 text-base px-4 py-1.5 font-bold text-[15px]">
            {med.bloodGroup}
          </span>
        </div>
      )}

      {/* ── Allergies ── */}
      {med?.allergies && (
        <div className="p-4 rounded-2xl bg-rosa-50 border border-rosa-100">
          <p className="section-label flex items-center gap-1 mb-1.5 text-rosa-700">
            <AlertTriangle className="w-3.5 h-3.5" /> Allergies
          </p>
          <CopyableValue value={med.allergies} label="Allergies">
            <p className="text-[14px] font-semibold text-rosa-700 leading-snug">{med.allergies}</p>
          </CopyableValue>
        </div>
      )}

      {/* ── Medications, Conditions, Emergency medication ── */}
      {(med?.medications || med?.conditions || med?.emergencyMedication) && (
        <div className="space-y-3">
          {med?.medications && (
            <InfoRow
              icon={<Pill className="w-3.5 h-3.5" />}
              label="Current medications"
              value={med.medications}
            />
          )}
          {med?.conditions && (
            <InfoRow
              icon={<Activity className="w-3.5 h-3.5" />}
              label="Chronic conditions"
              value={med.conditions}
            />
          )}
          {med?.emergencyMedication && (
            <InfoRow
              icon={<Pill className="w-3.5 h-3.5" />}
              label="Emergency medication"
              value={med.emergencyMedication}
              accent
            />
          )}
        </div>
      )}

      {/* ── Organ donor ── */}
      {med?.organDonor === true && (
        <div>
          <span className="chip bg-sage-100 text-sage-700 text-[13px] px-3 py-1">
            <Leaf className="w-3.5 h-3.5" /> Organ donor
          </span>
        </div>
      )}

      {/* ── Emergency contact ── */}
      {hasContact && (
        <div className="p-4 rounded-2xl bg-cream-100 border border-cream-200">
          <p className="section-label flex items-center gap-1 mb-2">
            <Phone className="w-3.5 h-3.5" /> Emergency contact
          </p>
          {member.emergencyContactName && (
            <CopyableValue value={member.emergencyContactName} label="Emergency contact name">
              <p className="text-[15px] font-semibold text-ink-900">{member.emergencyContactName}</p>
            </CopyableValue>
          )}
          {hasPhone && (
            <a
              href={`tel:${member.emergencyContactPhone!.replace(/\s+/g, '')}`}
              className="inline-flex items-center gap-2 mt-1 text-[15px] font-mono tabular-nums font-semibold text-sage-700 hover:underline"
            >
              <Phone className="w-4 h-4 shrink-0" />
              {member.emergencyContactPhone}
            </a>
          )}
        </div>
      )}

      {/* ── Employer / workplace ── */}
      {hasEmployer && (
        <div className="p-4 rounded-2xl bg-cream-100 border border-cream-200">
          <p className="section-label flex items-center gap-1 mb-2">
            <Briefcase className="w-3.5 h-3.5" /> Employer / workplace
          </p>
          {member.employer && (
            <CopyableValue value={member.employer} label="Employer">
              <p className="text-[15px] font-semibold text-ink-900">{member.employer}</p>
            </CopyableValue>
          )}
          {member.jobTitle && (
            <p className="text-[13px] font-medium text-ink-500">{member.jobTitle}</p>
          )}
          {member.workPhone && (
            <a
              href={`tel:${member.workPhone.replace(/\s+/g, '')}`}
              className="inline-flex items-center gap-2 mt-1 text-[15px] font-mono tabular-nums font-semibold text-sage-700 hover:underline"
            >
              <Phone className="w-4 h-4 shrink-0" />
              {member.workPhone}
            </a>
          )}
          {member.workAddress && (
            <CopyableValue value={member.workAddress} label="Work address">
              <p className="text-[13px] font-medium text-ink-500 mt-1">{member.workAddress}</p>
            </CopyableValue>
          )}
        </div>
      )}

      {/* ── Insurance / SV numbers ── */}
      {hasIdentity && (
        <div className="p-4 rounded-2xl bg-dusk-50 border border-dusk-100/60">
          <p className="section-label flex items-center gap-1 mb-2">
            <CreditCard className="w-3.5 h-3.5" /> Insurance &amp; ID
          </p>
          <div className="space-y-1.5">
            {hasSv && (
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-bold text-ink-400 uppercase tracking-wide w-24 shrink-0">
                  SV number
                </span>
                <CopyableValue value={identity!.svNumber || ''} label="SV number">
                  <span className="font-mono tabular-nums text-[14px] font-semibold text-ink-900">{identity!.svNumber}</span>
                </CopyableValue>
              </div>
            )}
            {hasEcard && (
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-bold text-ink-400 uppercase tracking-wide w-24 shrink-0">
                  e-card
                </span>
                <CopyableValue value={identity!.eCardNumber || ''} label="e-card number">
                  <span className="font-mono tabular-nums text-[14px] font-semibold text-ink-900">{identity!.eCardNumber}</span>
                </CopyableValue>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty-medical fallback ── */}
      {!med?.bloodGroup &&
        !med?.allergies &&
        !med?.medications &&
        !med?.conditions &&
        !med?.emergencyMedication &&
        med?.organDonor !== true &&
        !hasContact &&
        !hasEmployer &&
        !hasIdentity && (
          <EmptyState size="sm" title="No medical or emergency data on file yet — edit this profile to add it." />
        )}
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`p-3.5 rounded-2xl border ${accent ? 'bg-honey-50 border-honey-100' : 'bg-white border-cream-200'}`}>
      <p className={`section-label flex items-center gap-1 mb-1 ${accent ? 'text-honey-700' : ''}`}>
        {icon} {label}
      </p>
      <CopyableValue value={value} label={label}>
        <p className={`text-[14px] font-medium leading-snug ${accent ? 'text-honey-900 font-semibold' : 'text-ink-800'}`}>
          {value}
        </p>
      </CopyableValue>
    </div>
  );
}
