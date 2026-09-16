import type { EstateRecord, InsurancePolicy, NotifyContact, WillsEstateDoc, FinancesInfo } from '../types';
import { isFuneralPolicy } from './funeralCover';

/* THE FIRST HOURS PACK.
 *
 * What somebody actually needs in the first day or two after a death, pulled
 * into one place. Today these facts are correct but scattered: the funeral
 * policy sits in Finances -> insurance, the wishes and the whereabouts of the
 * signed will sit in Wills & Estate -> records, who-to-tell sits in
 * instructions. Nobody standing in a hospital corridor is going to visit three
 * screens, and the person who most needs this is the one least likely to know
 * the app.
 *
 * SO THIS ASSEMBLES, IT NEVER STORES. Every field below is read live from the
 * documents that already own it. There is no firstHours document, no copy to
 * go stale, and editing anything still happens where it always did — the same
 * decision as the connected-families projection (see server/familyLink.mjs).
 *
 * WHY THIS TIER NEEDS NO GATE AND NO NEW ROLE. Urgency and
 * sensitivity run in OPPOSITE directions here. A funeral policy number is
 * worthless to a thief but its absence is a real loss: SA funeral cover pays
 * out in 24-48 hours once documents are in, and a policy nobody knows about
 * can miss its claim window entirely. So the whole point is that this pack can
 * leave the app on paper, and be kept with the will, where it works for
 * somebody who has no account and never will.
 *
 * Deliberately EXCLUDED, because they are the sensitive half: bank account
 * numbers, ID and passport numbers, medical records, stored documents, and
 * anything about a living family member other than a named contact's own phone
 * number.
 *
 * When this was written there was nowhere for that half to go. There is now —
 * the release ladder in server/willsRelease.mjs, which opens Wills & Estate to
 * a named person who asks and is not refused for seven days. Whether the
 * sensitive half should ride behind that same ladder is an open question and
 * deliberately not answered here: the ladder is built for a document somebody
 * is entitled to read, and an IBAN is not that. It would need its own asking.
 * What must NOT happen is this pack quietly growing into it — the exclusions
 * below are asserted in firstHours.test.ts precisely so the growth cannot be
 * silent.
 */

export interface FuneralPolicyLine {
  id: string;
  provider: string;
  policyNumber?: string;
  claimsPhone?: string;
  beneficiary?: string;
  repatriationDestination?: string;
  burialSocietyContact?: string;
  isBurialSociety: boolean;
}

export interface FirstHoursPack {
  policies: FuneralPolicyLine[];
  wishes: EstateRecord[];
  wills: EstateRecord[];
  notify: NotifyContact[];
  keysAndSafes: string;
  /* Every heading that has nothing under it, so the pack can tell the family
   * what is missing rather than quietly printing a short page. A gap here is
   * the actual failure mode: the pack looks complete because the empty parts
   * simply did not render. */
  gaps: string[];
}

/* The documents an SA funeral claim needs. Static, and stated as a checklist
 * rather than prose because it is read under pressure. Not jurisdiction-aware:
 * the BI-1663 line names itself as South African so an Austrian reader can
 * skip it, which is safer than hiding it behind a country guess we would get
 * wrong for a family split across both. */
export const CLAIM_DOCUMENTS = [
  'The death certificate',
  'DHA/BI-1663 (South Africa — the notice of death form)',
  'The ID or passport of the person who died',
  'The ID of whoever is claiming',
  "The insurer's own claim form",
  'Bank details for the payout',
] as const;

function trimmed(v?: string): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function funeralPolicyLines(finances?: FinancesInfo | null): FuneralPolicyLine[] {
  const list: InsurancePolicy[] = Array.isArray(finances?.insurance) ? finances.insurance : [];
  return list
    .filter((p) => p && isFuneralPolicy(p.type) && p.status !== 'lapsed' && p.status !== 'cancelled')
    .map((p) => ({
      id: p.id,
      provider: trimmed(p.provider) || 'Unnamed policy',
      policyNumber: trimmed(p.policyNumber) || undefined,
      claimsPhone: trimmed(p.claimsPhone) || undefined,
      beneficiary: trimmed(p.beneficiary) || undefined,
      repatriationDestination: p.repatriationIncluded
        ? trimmed(p.repatriationDestination) || 'Yes — destination not recorded'
        : undefined,
      burialSocietyContact: trimmed(p.burialSocietyContact) || undefined,
      isBurialSociety: p.type === 'Burial society',
    }));
}

function recordsOfKind(estate: WillsEstateDoc | null | undefined, kind: string): EstateRecord[] {
  const records = Array.isArray(estate?.records) ? estate.records : [];
  return records.filter((r) => r && r.kind === kind);
}

export function buildFirstHoursPack(
  finances?: FinancesInfo | null,
  estate?: WillsEstateDoc | null,
): FirstHoursPack {
  const policies = funeralPolicyLines(finances);
  const wishes = recordsOfKind(estate, 'Funeral wishes');
  const wills = recordsOfKind(estate, 'Will');
  const notify = Array.isArray(estate?.instructions?.notifyContacts)
    ? estate.instructions.notifyContacts.filter((c) => c && trimmed(c.name))
    : [];
  const keysAndSafes = trimmed(estate?.instructions?.keysAndSafes);

  const gaps: string[] = [];
  if (!policies.length) gaps.push('No funeral cover or burial society recorded');
  if (policies.length && !policies.some((p) => p.claimsPhone || p.burialSocietyContact)) {
    gaps.push('No claims number for any funeral policy — the one thing that is phoned first');
  }
  if (!wishes.length) gaps.push('No funeral wishes recorded — burial or cremation, and where');
  if (!wills.some((w) => trimmed(w.originalLocation) || trimmed(w.heldBy))) {
    gaps.push('Nowhere recorded that says where the signed will physically is');
  }
  if (!notify.length) gaps.push('Nobody listed under who must be told');

  return { policies, wishes, wills, notify, keysAndSafes, gaps };
}

/* True when there is enough here to be worth printing and keeping with the
 * will. An empty pack is worse than none: it reads as "we checked, there is
 * nothing", when the truth is nobody has filled it in yet. */
export function packHasContent(pack: FirstHoursPack): boolean {
  return Boolean(
    pack.policies.length || pack.wishes.length || pack.notify.length
    || pack.keysAndSafes || pack.wills.some((w) => w.originalLocation || w.heldBy),
  );
}
