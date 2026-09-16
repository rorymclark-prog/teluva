import type { IdCountry } from '../types';

/**
 * WHAT A HOUSEHOLD ACTUALLY NEEDS TO KNOW ABOUT ITS ENERGY SUPPLY.
 *
 * Until now a utility was four free-text boxes — type, provider, account
 * number, notes — which is enough to write "Electricity / Wien Energie" and
 * nothing like enough to do anything with it. The three moments that matter
 * are the power going off, moving house, and the fixed price ending, and none
 * of them are answerable from a provider name.
 *
 * The single most useful thing this file encodes is that IN MOST OF EUROPE
 * THERE ARE TWO COMPANIES, NOT ONE:
 *
 *   - the SUPPLIER (Lieferant / furnizor), who you pay and who you can switch
 *   - the GRID OPERATOR (Netzbetreiber / DNO / operator de distribuție), who
 *     owns the wire, the pipe and the meter, comes with the address, and
 *     CANNOT be switched
 *
 * In a power cut you ring the grid operator. Almost everybody rings the
 * supplier, whose number is the one printed on the bill. Splitting them into
 * two labelled fields with that sentence attached is most of the value here.
 *
 * The second is that a connection has TWO identifiers and they behave
 * differently: the metering-point designation is fixed to the ADDRESS and
 * survives every supplier switch, while the meter serial is stamped on the
 * DEVICE and changes when the meter is swapped. People copy the wrong one
 * onto a switching form constantly.
 *   — tarife.at, durchblicker.at and stromliste.at all state this split; the
 *     Austrian Zählpunktnummer is 33 characters, "AT00" + a six-digit grid
 *     operator number + the five-digit postcode + twenty assigned characters.
 *
 * PHONE NUMBERS IN THIS FILE ARE SAFETY-CRITICAL and follow the rule set by
 * emergencyNumbers.ts: a number is only hard-coded here when it is NATIONAL
 * and was verified against a source, and every other case is a labelled field
 * with a hint saying WHOSE number belongs in it. Austria has no national
 * electricity fault line — Wiener Netze, Netz NÖ, Netz OÖ, Salzburg Netz and
 * the rest each publish their own — so pretending otherwise would be worse
 * than asking.
 *   - Austria, gas: 128 (Gasgebrechen), Austria-wide, free, 24 h.
 *   - Great Britain, electricity: 105, free, routes to your own network
 *     operator anywhere in England, Scotland and Wales.
 *   - Great Britain, gas: 0800 111 999, the National Gas emergency line, the
 *     same number whoever supplies you.
 * Re-verify before changing any of them.
 */

export type UtilityKind =
  | 'electricity' | 'gas' | 'water' | 'heating'
  | 'internet' | 'mobile' | 'waste' | 'other';

export const UTILITY_KINDS: Array<{ id: UtilityKind; label: string }> = [
  { id: 'electricity', label: 'Electricity' },
  { id: 'gas', label: 'Gas' },
  { id: 'water', label: 'Water' },
  { id: 'heating', label: 'Heating' },
  { id: 'internet', label: 'Internet / phone' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'waste', label: 'Waste' },
  { id: 'other', label: 'Something else' },
];

export interface FaultLine {
  number: string;
  label: string;
}

export interface UtilityVocabulary {
  /** True where a grid operator and a supplier are different companies. */
  splitSupply: boolean;
  supplierLabel: string;
  supplierHint?: string;
  operatorLabel?: string;
  operatorHint?: string;
  /** The identifier fixed to the address. */
  pointLabel?: string;
  pointHint?: string;
  /** The identifier stamped on the device. */
  meterLabel?: string;
  meterHint?: string;
  /** Hard-coded only where a genuinely national line exists. */
  fault?: FaultLine;
  /** Said next to the fault-number field when there is no national line. */
  faultHint?: string;
  /** Shown on the card and never buried — e.g. a gas-smell drill. */
  safetyNote?: string;
}

const GAS_SMELL =
  'If you smell gas: open the windows, do not touch any switch, get everyone out, then ring from outside.';

/** Grid operators exist for electricity and gas; nothing else here splits. */
const SPLIT_KINDS: UtilityKind[] = ['electricity', 'gas'];

/* The generic shape, used for 'other' and for any country we have not
 * researched. Deliberately plain rather than guessing at local vocabulary —
 * a wrong label is worse than a neutral one. */
function generic(kind: UtilityKind): UtilityVocabulary {
  const split = SPLIT_KINDS.includes(kind);
  return {
    splitSupply: split,
    supplierLabel: 'Supplier',
    supplierHint: 'Who you pay.',
    operatorLabel: split ? 'Network operator' : undefined,
    operatorHint: split
      ? 'The company that owns the wire or the pipe, if it is not the same one. They are who you ring when it goes off.'
      : undefined,
    pointLabel: split ? 'Metering point number' : undefined,
    pointHint: split ? 'The one on the bill that belongs to the address.' : undefined,
    meterLabel: split ? 'Meter number' : undefined,
    meterHint: split ? 'The one stamped on the meter itself.' : undefined,
    faultHint: split ? 'The fault line for this supply — check whose number is on the bill.' : undefined,
    safetyNote: kind === 'gas' ? GAS_SMELL : undefined,
  };
}

type KindMap = Partial<Record<UtilityKind, Partial<UtilityVocabulary>>>;

/* Only the fields that differ from generic() are listed. */
const BY_COUNTRY: Partial<Record<IdCountry, KindMap>> = {
  AT: {
    electricity: {
      supplierLabel: 'Stromanbieter (supplier)',
      supplierHint: 'Who you pay — Wien Energie, Verbund, and so on. You can change this one.',
      operatorLabel: 'Netzbetreiber (grid operator)',
      operatorHint: 'Comes with the address and cannot be changed — Wiener Netze, Netz NÖ, Netz OÖ. This is who you ring when the power goes off, not your supplier.',
      pointLabel: 'Zählpunktnummer',
      pointHint: '33 characters starting AT00. It belongs to the address, so it stays the same when you switch supplier — this is the number every switch and every move asks for.',
      meterLabel: 'Zählernummer',
      meterHint: 'Five to ten digits on the meter itself. It changes when the meter is replaced.',
      faultHint: 'Your Netzbetreiber\'s Störungsdienst. Every operator has its own — there is no single Austrian number for a power cut.',
    },
    gas: {
      supplierLabel: 'Gasanbieter (supplier)',
      operatorLabel: 'Netzbetreiber (grid operator)',
      operatorHint: 'Comes with the address and cannot be changed.',
      pointLabel: 'Zählpunktnummer',
      pointHint: '33 characters starting AT00, fixed to the address.',
      meterLabel: 'Zählernummer',
      fault: { number: '128', label: 'Gasgebrechen — Austria-wide, free, 24 hours' },
    },
  },
  UK: {
    electricity: {
      supplierHint: 'Who you pay and who you can switch.',
      operatorLabel: 'Network operator (DNO)',
      operatorHint: 'Owns the cables into your street. Comes with the address — you cannot switch them.',
      pointLabel: 'MPAN (supply number)',
      pointHint: 'The 21 digits in the S-shaped box on your bill. It belongs to the property, not to you.',
      meterLabel: 'Meter serial number',
      fault: { number: '105', label: 'Power cut — free, connects you to your own network operator' },
    },
    gas: {
      operatorLabel: 'Gas network operator',
      pointLabel: 'MPRN',
      pointHint: 'Six to ten digits, belongs to the property.',
      meterLabel: 'Meter serial number',
      fault: { number: '0800 111 999', label: 'Gas emergency — National Gas, 24 hours, whoever supplies you' },
    },
  },
  ZA: {
    electricity: {
      supplierLabel: 'Eskom or your municipality',
      supplierHint: 'Most towns buy from the municipality and only some households buy from Eskom directly. It decides which loadshedding schedule you are on, so it is worth writing down which one you are.',
      operatorLabel: 'Who to ring for a fault',
      operatorHint: 'Whoever you buy from also fixes the fault here — the municipal call centre or Eskom.',
      pointLabel: 'Account or POD number',
      pointHint: 'Off the bill. On a prepaid supply this may be the same as the meter number.',
      meterLabel: 'Meter number',
      meterHint: 'On the meter or the prepaid slip — the number you type in to buy a token.',
      faultHint: 'The municipal or Eskom fault line off your bill.',
    },
    gas: {
      supplierLabel: 'Gas supplier',
      supplierHint: 'Usually bottled LPG rather than a pipe.',
    },
  },
  RO: {
    electricity: {
      supplierLabel: 'Furnizor (supplier)',
      supplierHint: 'Who you pay. You can change this one.',
      operatorLabel: 'Operator de distribuție',
      operatorHint: 'Owns the network into the building and comes with the address. This is who you ring when it goes off.',
      pointLabel: 'Cod POD',
      pointHint: 'Starts with RO. It belongs to the address and stays the same when you change furnizor.',
      meterLabel: 'Serie contor',
      faultHint: 'Your distribuitor\'s fault line — it is on the bill, and it is not the same as your furnizor\'s.',
    },
    gas: {
      supplierLabel: 'Furnizor (supplier)',
      operatorLabel: 'Operator de distribuție',
      pointLabel: 'Cod POD',
      meterLabel: 'Serie contor',
      faultHint: 'Your gas distribuitor\'s emergency line, off the bill — Romania has no single national number.',
    },
  },
  US: {
    electricity: {
      supplierLabel: 'Utility company',
      supplierHint: 'In most states one company both supplies and delivers; in a deregulated state you may have a separate supplier.',
      operatorLabel: 'Delivery company, if different',
      pointLabel: 'Account number',
      meterLabel: 'Meter number',
      faultHint: 'Your utility\'s outage line — it is on the bill. There is no single national number.',
    },
    gas: {
      supplierLabel: 'Gas utility',
      pointLabel: 'Account number',
      meterLabel: 'Meter number',
      faultHint: 'Your gas utility\'s 24-hour emergency line, off the bill.',
    },
  },
};

/**
 * The labels and hints for one kind of supply in one country.
 * Unknown country, or a kind we have nothing special to say about, falls back
 * to neutral wording rather than to another country's vocabulary.
 */
export function utilityVocabulary(kind: UtilityKind, country?: IdCountry | null): UtilityVocabulary {
  const base = generic(kind);
  const over = country ? BY_COUNTRY[country]?.[kind] : undefined;
  return over ? { ...base, ...over } : base;
}

/** True where "which loadshedding block are we?" is a real household question. */
export function usesSupplySchedule(country?: IdCountry | null): boolean {
  return country === 'ZA';
}

/* ── CONTRACTS ────────────────────────────────────────────────────────────
 * The money half. A fixed price that quietly rolls onto a standard tariff is
 * the most expensive thing on this screen, and the only way to catch it is a
 * date with a reminder in front of it. The notice period is what decides how
 * far in front — a contract you must leave 3 months early needs telling about
 * in month 9, not on the day. */

export const DEFAULT_NOTICE_DAYS = 30;
/** Warn this far before the last day you could still give notice. */
export const NOTICE_LEAD_DAYS = 21;

export interface ContractWatch {
  /** Last day notice can still be given in time. */
  lastNoticeDate: string;
  daysUntilNotice: number;
  daysUntilEnd: number;
  /** Notice is due now (or overdue) and the contract has not ended yet. */
  due: boolean;
  /** The window has closed — it will roll over. */
  missed: boolean;
}

const DAY_MS = 86400000;

function dateOnlyMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  // Date normalises impossible input (2026-02-31 → March) rather than
  // rejecting it, so round-trip the parts before trusting the result.
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) return null;
  return parsed.getTime();
}

const isoOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * When to say something about a contract that ends on `contractEnd`.
 * Returns null for a missing or malformed date — a corrupt value must never
 * become a confident warning about the wrong day.
 */
export function contractWatch(
  contractEnd?: string,
  noticeDays: number = DEFAULT_NOTICE_DAYS,
  today: Date = new Date(),
): ContractWatch | null {
  if (!contractEnd) return null;
  const endMs = dateOnlyMs(contractEnd);
  if (endMs === null) return null;
  const notice = Number.isFinite(noticeDays) && noticeDays >= 0 ? Math.floor(noticeDays) : DEFAULT_NOTICE_DAYS;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const lastNoticeMs = endMs - notice * DAY_MS;
  const daysUntilNotice = Math.round((lastNoticeMs - base) / DAY_MS);
  const daysUntilEnd = Math.round((endMs - base) / DAY_MS);
  return {
    lastNoticeDate: isoOf(lastNoticeMs),
    daysUntilNotice,
    daysUntilEnd,
    due: daysUntilNotice <= NOTICE_LEAD_DAYS && daysUntilEnd >= 0,
    missed: daysUntilNotice < 0 && daysUntilEnd >= 0,
  };
}
