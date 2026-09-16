/**
 * The two bits of bookkeeping MemberIdOverview.tsx's rebuild needs that don't
 * belong in idOverview.ts — see that file's header for why its field list is
 * off-limits to re-specification. Pulled out here, deliberately pure (no
 * React, no component imports), so both can be asserted on directly instead
 * of only through a rendered sheet:
 *
 *  1. resolveIdOverviewScans — which SCANNED DOCUMENT backs each ID-number
 *     row in Section A, using the exact same finders (findIdentityScan,
 *     findPassportScan, findVisaScan — utils/passportScan.ts) the ID & Passports
 *     tab already uses, so a passport that autopulls its photo there autopulls
 *     the identical photo on this screen. It also builds the REVERSE map:
 *     which Section-B document is already "spoken for" by a Section-A row, so
 *     that document can say "attached to: <label>" instead of appearing twice
 *     with no relationship shown.
 *
 *  2. idOverviewEmptiness — which of Section A (numbers) and Section B
 *     (documents) has nothing to show, so the sheet can render one full-page
 *     EmptyState (both empty), a brief inline line for just the empty side
 *     (one empty), or neither — never an empty bordered card.
 */
import type { FamilyDocument, FamilyMember, IdentityRecord } from '../types';
import type { IdOverviewGroup, IdOverviewItem } from './idOverview';
import { findIdentityScan, findPassportScan, findVisaScan, foldPassports } from './passportScan';

/**
 * The part of a handle id after `${memberId}~` — the same split idOverview.ts's
 * own (private) slotOf() does. Duplicated here in miniature rather than
 * exported from idOverview.ts, because this file's job is scan-linking, not
 * grouping, and idOverview.ts's header is explicit that it must not grow a
 * second reason to change.
 */
function slotOf(handleId: string): string {
  return handleId.split('~').slice(1).join('~');
}

export interface IdOverviewScanLinks {
  /** item.id -> the document that backs it, where the same finder the IDs tab uses found one. */
  scanByItemId: Map<string, FamilyDocument>;
  /** doc.id -> every item label it backs. Usually 0 or 1 entries; can be 2+ for
   *  one combined scan (e.g. "ID and Driver's Licence" backs both fields). */
  itemLabelsByDocId: Map<string, string[]>;
}

/**
 * Resolve a scan for every item across every group in `groups` (the output of
 * idOverview.ts's buildIdOverview), and build the reverse attachment map.
 *
 * 'other' (admin-only identifiers — SSN, tax id, etc.) is deliberately never
 * given a scan: nothing in passportScan.ts offers a finder for it, because
 * those numbers are not things people photograph. Skipping them here is not
 * an oversight to "complete" — see the loop below.
 */
export function resolveIdOverviewScans(member: FamilyMember, groups: IdOverviewGroup[]): IdOverviewScanLinks {
  const scanByItemId = new Map<string, FamilyDocument>();
  const itemLabelsByDocId = new Map<string, string[]>();
  const docs = member.documents || [];
  const passports = foldPassports(member);

  const record = (item: IdOverviewItem, doc: FamilyDocument | undefined) => {
    if (!doc) return;
    scanByItemId.set(item.id, doc);
    const labels = itemLabelsByDocId.get(doc.id) || [];
    labels.push(item.label);
    itemLabelsByDocId.set(doc.id, labels);
  };

  for (const g of groups) {
    for (const item of g.items) {
      if (g.kind === 'identity') {
        const key = slotOf(item.id).split('.')[1] as keyof IdentityRecord | undefined;
        if (key) record(item, findIdentityScan(key, docs));
      } else if (g.kind === 'passport') {
        const p = passports.find(p => p.number === item.value);
        if (p) record(item, findPassportScan(p, docs));
      } else if (g.kind === 'visa') {
        const v = member.travel?.visas?.find(v => v.number === item.value);
        if (v) record(item, findVisaScan(v, docs));
      }
      // 'other': no finder exists for admin identifiers — see header.
    }
  }

  return { scanByItemId, itemLabelsByDocId };
}

export type IdOverviewEmptiness = 'all' | 'numbers' | 'documents' | 'none';

/**
 * Which section(s) have nothing to show. See this file's header for how
 * MemberIdOverview.tsx uses each of the four outcomes.
 */
export function idOverviewEmptiness(numberCount: number, documentCount: number): IdOverviewEmptiness {
  if (numberCount === 0 && documentCount === 0) return 'all';
  if (numberCount === 0) return 'numbers';
  if (documentCount === 0) return 'documents';
  return 'none';
}
