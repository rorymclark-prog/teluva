import { useState } from 'react';
import { Maximize2, HeartPulse } from 'lucide-react';
import { FamilyMember, IdentityRecord, IdCountry } from '../types';
import ShowCardModal from './ShowCardModal';
import CopyableValue from './CopyableValue';
import { findIdentityScan } from './MemberIDs';

// Which health-insurance identifier actually exists in this country, and what it
// is called there. Exactly ONE entry is ever rendered — a South African space
// must never be shown an empty Austrian e-card box, and vice versa, which is the
// whole point of driving this off the space's country setting rather than
// listing every field and hoping the irrelevant ones stay blank.
//
// Note `medicalAidNumber` is deliberately REUSED by ZA / UK / US / other: the
// stored field is the same, only the label and the companion fields differ.
// Austria is the one country with its own fields (svNumber / eCardNumber).
interface InsuranceShape {
  /** Field shown big. */
  primary: keyof IdentityRecord;
  /** Used when `primary` is blank — Austria only (some families fill in one, some the other). */
  fallback?: keyof IdentityRecord;
  label: string;
  /** Title of the full-screen show-card. */
  cardTitle: string;
  /** Which identity field the saved scan is filed under (AT: the scan is the e-card). */
  scanField: keyof IdentityRecord;
  /** Small supporting numbers a clinic also asks for. */
  companions: { field: keyof IdentityRecord; label: string }[];
}

const INSURANCE_BY_COUNTRY: Record<IdCountry, InsuranceShape> = {
  AT: {
    primary: 'svNumber',
    fallback: 'eCardNumber',
    label: 'e-card · SV number',
    cardTitle: 'e-card',
    scanField: 'eCardNumber',
    companions: [{ field: 'eCardNumber', label: 'e-Card number' }],
  },
  ZA: {
    primary: 'medicalAidNumber',
    label: 'Medical aid number',
    cardTitle: 'Medical aid card',
    scanField: 'medicalAidNumber',
    companions: [
      { field: 'medicalAidScheme', label: 'Scheme' },
      { field: 'medicalAidDependantCode', label: 'Dependant code' },
    ],
  },
  UK: {
    primary: 'medicalAidNumber',
    label: 'NHS number',
    cardTitle: 'NHS number',
    scanField: 'medicalAidNumber',
    companions: [],
  },
  US: {
    primary: 'medicalAidNumber',
    label: 'Health insurance member ID',
    cardTitle: 'Health insurance card',
    scanField: 'medicalAidNumber',
    companions: [
      { field: 'medicalAidScheme', label: 'Plan' },
      { field: 'insuranceGroupNumber', label: 'Group number' },
    ],
  },
  other: {
    primary: 'medicalAidNumber',
    label: 'Health insurance number',
    cardTitle: 'Health insurance card',
    scanField: 'medicalAidNumber',
    companions: [{ field: 'medicalAidScheme', label: 'Insurer' }],
  },
};

interface Props {
  member: FamilyMember;
  country: IdCountry;
}

// The first thing on the Emergency essentials card: the health-insurance number a
// paramedic or admissions desk asks for before anything else, plus one tap to the
// scan of the card itself. Read-only on purpose — the number is OWNED by the
// ID & Passports tab, so it is never editable in two places.
export default function HealthInsuranceRow({ member, country }: Props) {
  const [showCard, setShowCard] = useState(false);

  const shape = INSURANCE_BY_COUNTRY[country];
  const identity = member.identity || {};

  // Which field the displayed number actually came from — needed so the companion
  // list can drop it and we never print the same number twice on one card.
  const usedField = (identity[shape.primary] as string | undefined)
    ? shape.primary
    : (shape.fallback && (identity[shape.fallback] as string | undefined) ? shape.fallback : shape.primary);
  const number = (identity[usedField] as string | undefined) || '';

  const scan = findIdentityScan(shape.scanField, member.documents);
  const companions = shape.companions
    .filter(c => c.field !== usedField)
    .map(c => ({ label: c.label, value: (identity[c.field] as string | undefined) || '' }))
    .filter(c => !!c.value);

  if (!number) {
    return (
      <p className="text-[13px] text-ink-500">
        {/* Label kept verbatim, NOT lowercased — these are acronyms and product
            names ("NHS number", "e-card · SV number"), and lowercasing them
            produced "No nhs number on file". Tab name must match the real tab. */}
        No {shape.label} on file — add it under <span className="font-semibold text-ink-600">ID &amp; Passports</span>.
      </p>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-cream-200">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-ink-500 uppercase tracking-wide flex items-center gap-1.5">
            <HeartPulse className="w-3.5 h-3.5 text-honey-700" />
            {shape.label}
          </p>
          <CopyableValue value={number} label={shape.label}>
            <p className="text-[26px] sm:text-[30px] font-mono tabular-nums font-bold text-ink-900 leading-tight break-words mt-1">
              {number}
            </p>
          </CopyableValue>
          {companions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {companions.map(c => (
                <span key={c.label} className="chip bg-honey-100 text-honey-700 text-[11px]">
                  {c.label}: {c.value}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* One button, one full-screen surface. ShowCardModal already renders the
            scan AND the number at maximum legibility (and holds the screen awake),
            so a second plain-image lightbox next to it would only slow down the
            person holding the phone. */}
        <button
          type="button"
          onClick={() => setShowCard(true)}
          className="btn-primary text-xs px-3 py-2.5 min-h-[44px] shrink-0"
          title={scan ? 'Show the card scan full screen' : 'Show this number full screen'}
        >
          <Maximize2 className="w-3.5 h-3.5" />
          {scan ? 'View card' : 'Show'}
        </button>
      </div>

      <ShowCardModal
        open={showCard}
        onClose={() => setShowCard(false)}
        title={shape.cardTitle}
        subtitle={member.name}
        fields={[
          { label: shape.label, value: number, mono: true, big: true },
          ...companions.map(c => ({ label: c.label, value: c.value })),
        ]}
        scanSrc={scan?.fileData}
      />
    </>
  );
}
