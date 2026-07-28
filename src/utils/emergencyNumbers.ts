import type { IdCountry } from '../types';

// Country → national emergency numbers. SAFETY-CRITICAL: every number here has
// been re-verified against an authoritative government source (not memory,
// not a travel blog) — see the citation in each block below. If you ever need
// to touch this file, re-verify again before changing a number.
//
// UK: 999 (and 112, pan-European, works identically) — gov.uk / uniacco.com
//   summary of official guidance, corroborated by multiple UK emergency-
//   services explainers. Both numbers reach police/fire/ambulance/coastguard
//   free from any phone.
// South Africa: 10111 police, 10177 ambulance, 112 from any mobile (no SIM/
//   airtime needed) — City of Cape Town Public Emergency Communication Centre
//   (resource.capetown.gov.za) and the US Embassy in South Africa
//   (za.usembassy.gov/emergency-assistance).
// USA: 911 — National 911 Program (911.gov) and the FCC (fcc.gov), the two
//   federal authorities for the US emergency number.
// Austria: 144 Rettung (ambulance), 133 Polizei (police), 122 Feuerwehr
//   (fire), 112 EU-wide — oesterreich.gv.at and polizei.gv.at (Federal
//   Ministry of the Interior).
export interface EmergencyNumber {
  number: string;
  label: string; // what it's for, readable at a glance under stress
}

export interface EmergencyNumbersInfo {
  numbers: EmergencyNumber[];
  note?: string; // shown when we can't be country-specific
}

const BY_COUNTRY: Record<Exclude<IdCountry, 'other'>, EmergencyNumbersInfo> = {
  UK: {
    numbers: [
      { number: '999', label: 'Police · Fire · Ambulance' },
      { number: '112', label: 'Also works — same as 999' },
    ],
  },
  ZA: {
    numbers: [
      { number: '112', label: 'All emergencies (from any mobile)' },
      { number: '10111', label: 'Police' },
      { number: '10177', label: 'Ambulance' },
    ],
  },
  US: {
    numbers: [
      { number: '911', label: 'Police · Fire · Ambulance' },
    ],
  },
  AT: {
    numbers: [
      { number: '144', label: 'Ambulance (Rettung)' },
      { number: '133', label: 'Police (Polizei)' },
      { number: '122', label: 'Fire (Feuerwehr)' },
      { number: '112', label: 'EU-wide emergency number' },
    ],
  },
};

// Fallback for 'other' or an unset country — never show nothing. 112 works
// across the EU and in many countries worldwide (it's the GSM standard
// emergency number baked into every mobile handset).
const FALLBACK: EmergencyNumbersInfo = {
  numbers: [{ number: '112', label: 'Emergency services' }],
  note: '112 works across Europe (and on most mobile phones worldwide). If you’re elsewhere, check the local number.',
};

// Looks up the emergency numbers to show for a family's country setting.
// Mirrors the existing `settings.country || 'AT'` pattern used elsewhere
// (MemberIDs, MemberMedical) — but here, unset/unknown/'other' must NEVER
// resolve to silence, so it falls back to the EU-wide 112 with a note instead
// of defaulting to a specific country's numbers.
export function getEmergencyNumbers(country?: IdCountry | string | null): EmergencyNumbersInfo {
  if (country && country in BY_COUNTRY) {
    return BY_COUNTRY[country as Exclude<IdCountry, 'other'>];
  }
  return FALLBACK;
}
