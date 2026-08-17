// Emergency Readiness score — a computed to-do list, not a survey.
//
// The owner's brief was blunt: "perhaps offer a free survey to show readiness
// for emergency or death — morbid but helpful?" The DECISION made on top of
// that brief is that this is deliberately NOT a survey. The vault already
// holds every fact below (member records, roles, wills & estate, finances,
// household) — asking a family to re-type answers the app can already see
// would be busywork, and busywork gets abandoned. So this file COMPUTES a
// score from what is actually on file, and every gap below carries enough
// (memberId/tab or view) to be a one-tap link to the screen that fixes it.
// The score's job is to produce a to-do list, not a grade.
//
// Tone: matter-of-fact and practical, never grim or guilt-tripping — a family
// with a low score is being handed a checklist, not told off. Gap labels
// avoid the word "death" in favour of "if something happens to you" per the
// owner's steer. See ReadinessCard.tsx for how this renders.
//
// Pure and I/O-free by design — no React, no Firestore reads. Callers load
// the data (members, wills & estate, finances, household, and the roles
// collection for the second-admin count) and hand it in as plain objects, so
// this file is trivially unit-testable — see readiness.test.ts.
import { FamilyMember, EstateRecord, InsurancePolicy, HouseholdInfo } from '../types';
import { parseDateOnly } from './age';

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

// Same "expires within ~9 months" window NeedsAttention.tsx uses for a
// passport nudge (see computeNudges' `months <= 9` there) — kept as an
// independent constant rather than an import because NeedsAttention doesn't
// export it, but the threshold itself is intentionally the same number so
// the readiness card and the nudge digest never disagree about what "soon"
// means for the same document.
export const PASSPORT_WARN_MONTHS = 9;

export type ReadinessSeverity = 'critical' | 'important' | 'minor';

export interface ReadinessGap {
  id: string;
  /** Plain-English, one line, matter-of-fact — never alarmist. */
  label: string;
  severity: ReadinessSeverity;
  /** Points this single gap is costing, out of this family's applicable total. Drives sort order. */
  weight: number;
  /** Top-level view (Dashboard's ViewId) that fixes it — a family-wide gap. */
  view?: string;
  /** Member-scoped gap: pair with `tab` (Dashboard's TabId) for that member's profile. */
  memberId?: string;
  tab?: string;
}

export interface ReadinessResult {
  /** 0-100, rounded. */
  score: number;
  /** Raw points earned. */
  earned: number;
  /** Raw points applicable to this family — 0 only for a genuinely empty vault with no admin data. */
  max: number;
  /** Worst first: critical > important > minor, heaviest weight first within a tier. */
  gaps: ReadinessGap[];
}

export interface ReadinessInput {
  members: FamilyMember[];
  estateRecords: EstateRecord[];
  insurancePolicies: InsurancePolicy[];
  household: HouseholdInfo | null;
  /** How many people hold the 'admin' role on this space (families/{id}/roles) — see db.ts's loadFamilyRoles. */
  adminCount: number;
}

// Points per check. Sized by real-world consequence, per the brief: "no
// second admin and no will are worse than a missing blood group."
//
//  - SECOND_ADMIN and WILL_ESTATE are the two heaviest single items in the
//    whole score. A single admin is a single point of failure — if that one
//    person can't sign in (lost phone, hospital, worse), NOBODY else can
//    either, including to read this very card. No will/estate record means
//    the family has nothing on file about who to call or where the signed
//    original lives, which is the whole point of this feature.
//  - EMERGENCY_CONTACT is scored per adult (not a shared pool) because it's
//    the second-heaviest thing on this list: literally "who do we call".
//  - INSURANCE and the two HOUSEHOLD checks matter but are recoverable in a
//    way a missing will or a locked-out family is not — hence "important",
//    one tier down.
//  - Per-member ID/medical/document checks are genuinely useful but rarely
//    the difference between chaos and coping in an actual emergency, so they
//    sit at "minor" and carry the smallest weights.
const WEIGHT = {
  SECOND_ADMIN: 15,
  WILL_ESTATE: 15,
  INSURANCE: 8,
  HOUSEHOLD_ADDRESS: 5,
  HOUSEHOLD_UTILITIES: 4,
  EMERGENCY_CONTACT: 10, // per adult
  ID_ON_FILE: 3,         // per person
  ID_NOT_EXPIRING: 5,    // per person, only when an ID/passport with an expiry IS on file
  MEDICAL_BASICS: 4,     // per person
  DOCUMENT_FILED: 3,     // per person
} as const;

// A family member counts as an adult for the emergency-contact check when
// their role isn't 'Child' — mirrors NeedsAttention's own `m.role === 'Child'`
// gate for growth checks, the only other place this app already draws that
// line.
function isAdult(m: FamilyMember): boolean {
  return m.role !== 'Child';
}

function firstName(m: FamilyMember): string {
  return m.name.split(/\s+/)[0] || m.name;
}

// Every passport-shaped record on file for a member — mirrors the exact same
// merge NeedsAttention.tsx does (legacy single `passport` field + the newer
// `passports` array) so this card and the nudge digest never disagree about
// what's on file for someone.
function passportsOf(m: FamilyMember): Array<{ expiryDate?: string }> {
  return [
    ...(m.passports || []),
    ...(m.passport?.passportNumber ? [{ expiryDate: m.passport.expiryDate }] : []),
  ];
}

function hasIdOnFile(m: FamilyMember): boolean {
  return passportsOf(m).length > 0 || !!m.identity?.nationalIdNumber;
}

// null = nothing to compare (no ID with an expiry on file) — caller must
// treat that as "not applicable", not as a pass or a fail.
function idsAreCurrent(m: FamilyMember, now: number): boolean | null {
  const withExpiry = passportsOf(m).filter((p) => p.expiryDate);
  if (withExpiry.length === 0) return null;
  return withExpiry.every((p) => {
    const d = parseDateOnly(p.expiryDate);
    if (!d) return true; // unparseable date isn't this check's job to flag
    const months = (d.getTime() - now) / MONTH_MS;
    return months > PASSPORT_WARN_MONTHS;
  });
}

function hasMedicalBasics(m: FamilyMember): boolean {
  const med = m.medical || {};
  return !!(med.bloodGroup || med.allergies || med.conditions);
}

export function computeReadiness(input: ReadinessInput, now: number = Date.now()): ReadinessResult {
  const { members, estateRecords, insurancePolicies, household, adminCount } = input;
  const gaps: ReadinessGap[] = [];
  let earned = 0;
  let max = 0;

  // Tallies one check's points into earned/max, and records a gap when it
  // fails. `weight` is always added to `max` (whether or not it's met) so
  // the score is always "points earned / points that actually apply to this
  // family" — a family with fewer applicable checks (e.g. no adults yet)
  // never gets unfairly penalised for checks that don't apply to them.
  const check = (weight: number, met: boolean, gap: Omit<ReadinessGap, 'weight'>) => {
    max += weight;
    if (met) { earned += weight; return; }
    gaps.push({ ...gap, weight });
  };

  // --- Family-wide ---

  check(WEIGHT.SECOND_ADMIN, adminCount >= 2, {
    id: 'second-admin',
    label: 'Only one person can sign in to this vault — invite a second admin from Members & roles',
    severity: 'critical',
  });

  check(WEIGHT.WILL_ESTATE, estateRecords.length > 0, {
    id: 'will-estate',
    label: 'No will, power of attorney or similar record on file yet',
    severity: 'critical',
    view: 'willsEstate',
  });

  check(WEIGHT.INSURANCE, insurancePolicies.length > 0, {
    id: 'insurance',
    label: 'No insurance policies recorded yet',
    severity: 'important',
    view: 'insurance',
  });

  const address = (household?.address || '').trim();
  check(WEIGHT.HOUSEHOLD_ADDRESS, !!address, {
    id: 'household-address',
    label: 'No home address on file',
    severity: 'important',
    view: 'household',
  });

  check(WEIGHT.HOUSEHOLD_UTILITIES, (household?.utilities?.length || 0) > 0, {
    id: 'household-utilities',
    label: 'No utility accounts (electricity, water, internet…) on file',
    severity: 'minor',
    view: 'household',
  });

  // --- Per member ---

  for (const m of members) {
    const first = firstName(m);

    if (isAdult(m)) {
      check(WEIGHT.EMERGENCY_CONTACT, !!(m.emergencyContactName && m.emergencyContactPhone), {
        id: `emergency-contact-${m.id}`,
        label: `No emergency contact on file for ${first}`,
        severity: 'critical',
        memberId: m.id,
        tab: 'overview',
      });
    }

    check(WEIGHT.ID_ON_FILE, hasIdOnFile(m), {
      id: `id-on-file-${m.id}`,
      label: `No passport or ID on file for ${first}`,
      severity: 'minor',
      memberId: m.id,
      tab: 'ids',
    });

    const current = idsAreCurrent(m, now);
    if (current !== null) {
      check(WEIGHT.ID_NOT_EXPIRING, current, {
        id: `id-expiring-${m.id}`,
        label: `${first}'s passport or ID is expired or expiring soon`,
        severity: 'important',
        memberId: m.id,
        tab: 'ids',
      });
    }

    check(WEIGHT.MEDICAL_BASICS, hasMedicalBasics(m), {
      id: `medical-${m.id}`,
      label: `No medical basics (blood group, allergies, conditions) for ${first}`,
      severity: 'minor',
      memberId: m.id,
      tab: 'medical',
    });

    check(WEIGHT.DOCUMENT_FILED, (m.documents?.length || 0) > 0, {
      id: `documents-${m.id}`,
      label: `No documents filed for ${first} yet`,
      severity: 'minor',
      memberId: m.id,
      tab: 'documents',
    });
  }

  const severityOrder: Record<ReadinessSeverity, number> = { critical: 0, important: 1, minor: 2 };
  gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.weight - a.weight);

  const score = max > 0 ? Math.round((earned / max) * 100) : 0;
  return { score, earned, max, gaps };
}
