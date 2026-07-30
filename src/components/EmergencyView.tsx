import React from 'react';
import { FamilyMember, IdCountry } from '../types';
import { calculateAge } from './Dashboard';
import { warmAvatarColor } from '../utils/avatarPalette';
import EmergencyNumbersBanner from './EmergencyNumbersBanner';
import EmptyState from './EmptyState';
import CopyableValue from './CopyableValue';
import {
  Phone, Heart, AlertTriangle, Pill, Activity,
  CreditCard, Leaf, Users, Briefcase
} from 'lucide-react';

interface EmergencyViewProps {
  members: FamilyMember[];
  country?: IdCountry;
}

export default function EmergencyView({ members, country }: EmergencyViewProps) {
  if (members.length === 0) {
    // Still show the dial-now number: it is useful on day one, before anyone
    // has entered a single record.
    return (
      <div className="space-y-6 font-sans max-w-lg mx-auto mt-8">
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
    <div className="space-y-6 font-sans">
      {/* The dial-now number leads the page — everything below it is detail. */}
      <EmergencyNumbersBanner country={country} />

      {/* Header */}
      <div className="card p-5 sm:p-6">
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
      </div>

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
          <p className="text-[14px] font-semibold text-rosa-700 leading-snug">{med.allergies}</p>
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
            <p className="text-[15px] font-semibold text-ink-900">{member.emergencyContactName}</p>
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
            <p className="text-[15px] font-semibold text-ink-900">{member.employer}</p>
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
            <p className="text-[13px] font-medium text-ink-500 mt-1">{member.workAddress}</p>
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
      <p className={`text-[14px] font-medium leading-snug ${accent ? 'text-honey-900 font-semibold' : 'text-ink-800'}`}>
        {value}
      </p>
    </div>
  );
}
