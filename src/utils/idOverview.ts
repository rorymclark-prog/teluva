/**
 * Gathering every identifying number the app holds for ONE member, in one
 * scannable place — the "Mia has ten ID numbers scattered across four
 * tabs" problem MemberIdOverview.tsx exists to solve.
 * ---------------------------------------------------------------------------
 *
 * The field list itself is NOT re-specified here. aiReveal.ts's
 * buildRevealIndex() already enumerates exactly this set of values — identity
 * numbers, passports, visas, and (admin-only) national identifiers — and
 * already carries the "is this a real, decrypted value" test (isRevealable)
 * and the admin gate. Re-typing that list here, even carefully, would be a
 * second copy that could drift from the first: a field added to
 * REDACTED_IDENTITY_KEYS without a matching change here would silently stop
 * appearing on this screen while still working in the AI chat's reveal card,
 * and nobody would notice until someone went looking for the one number that
 * wasn't there. So this file calls buildRevealIndex() and only adds what it
 * does not already carry: which GROUP a handle belongs to (for section
 * headings) and its EXPIRY date (for the "expires soon" badge), neither of
 * which the chat card needs.
 *
 * Grouping and expiry are recovered without re-parsing the field list:
 *   - group comes from the handle id's slot prefix (`identity.`, `passport.`,
 *     `visa.`, `identifiers.`) — the scheme aiReveal.ts's offer() documents
 *     and already uses to keep a handle traceable back to its source.
 *   - expiry comes from matching the revealed VALUE back to the raw record
 *     that produced it (a passport number back to its PassportRecord, a visa
 *     number back to its VisaRecord) rather than by re-deriving the id
 *     format aiReveal.ts uses internally.
 *
 * Because every item on this screen is a handle buildRevealIndex() actually
 * offered, this screen cannot show a number the assistant's catalogue does
 * not also know about — see idOverview.test.ts's parity assertion.
 */

import type { FamilyMember, IdentityRecord } from '../types';
import { buildRevealIndex } from './aiReveal';

export type IdOverviewKind = 'identity' | 'passport' | 'visa' | 'other';

export const ID_OVERVIEW_KIND_ORDER: IdOverviewKind[] = ['identity', 'passport', 'visa', 'other'];

export interface IdOverviewItem {
  /** Same id aiReveal.ts's handle carries — stable across renders, unique per row. */
  id: string;
  /** Display label, capitalised — e.g. "Passport number (South Africa)". */
  label: string;
  value: string;
  expiry?: string;
}

export interface IdOverviewGroup {
  kind: IdOverviewKind;
  items: IdOverviewItem[];
}

// The only two identity fields that carry their own expiry date. Everything
// else in IdentityRecord (SV number, tax number, national ID, birth
// certificate…) is not something the app tracks an expiry for.
const IDENTITY_EXPIRY_FIELD: Partial<Record<keyof IdentityRecord, keyof IdentityRecord>> = {
  residencePermitNumber: 'residencePermitExpiry',
  driversLicenseNumber: 'driversLicenseExpiry',
};

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * The group a handle belongs to, read off its own id — `${memberId}~${slot}`
 * where slot is `identity.<key>`, `passport.<passportId>`, `visa.<visaId>` or
 * `identifiers.<key>` (aiReveal.ts's offer()). Anything else (should never
 * happen — it would mean aiReveal.ts introduced a new slot kind this file
 * has not been taught) is dropped rather than guessed at.
 */
function slotOf(handleId: string): string {
  return handleId.split('~').slice(1).join('~'); // memberId itself may not contain '~'
}

function kindOf(handleId: string): IdOverviewKind | null {
  const prefix = slotOf(handleId).split('.')[0];
  switch (prefix) {
    case 'identity': return 'identity';
    case 'passport': return 'passport';
    case 'visa': return 'visa';
    case 'identifiers': return 'other';
    default: return null;
  }
}

/**
 * Build the grouped, expiry-annotated list for one member's overview screen.
 *
 * `isAdmin` is passed straight through to buildRevealIndex() — the same gate
 * SecureSecrets.tsx applies — so a non-admin caller never even receives a
 * handle for `identifiers.*`; there is no separate filter step to forget.
 */
export function buildIdOverview(member: FamilyMember, isAdmin: boolean): IdOverviewGroup[] {
  const index = buildRevealIndex([member], { isAdmin });
  const handles = index.handlesByMember.get(member.id) || [];

  const buckets: Record<IdOverviewKind, IdOverviewItem[]> = {
    identity: [], passport: [], visa: [], other: [],
  };

  for (const h of handles) {
    const kind = kindOf(h.id);
    if (!kind) continue;
    const rv = index.values.get(h.id);
    if (!rv) continue; // never offered → does not exist (same rule resolveReveals uses)

    let expiry: string | undefined;
    if (kind === 'identity') {
      const key = slotOf(h.id).split('.')[1] as keyof IdentityRecord | undefined;
      const expiryKey = key ? IDENTITY_EXPIRY_FIELD[key] : undefined;
      expiry = expiryKey ? (member.identity?.[expiryKey] as string | undefined) : undefined;
    } else if (kind === 'passport') {
      expiry = member.passports?.find(p => p.number === rv.value)?.expiryDate;
    } else if (kind === 'visa') {
      expiry = member.travel?.visas?.find(v => v.number === rv.value)?.expiryDate;
    }

    buckets[kind].push({ id: h.id, label: capitalise(rv.field), value: rv.value, expiry });
  }

  return ID_OVERVIEW_KIND_ORDER
    .map(kind => ({ kind, items: buckets[kind] }))
    .filter(g => g.items.length > 0);
}

/** Total number of rows across every group — the empty-state test. */
export function countIdOverviewItems(groups: IdOverviewGroup[]): number {
  return groups.reduce((sum, g) => sum + g.items.length, 0);
}
