// Groups repeated Referrals & Results records ("Lab result", "Imaging") into
// a series so a family sees "Annual bloods — 3 on file" instead of three
// unrelated rows. Pure, presentation-only logic — see the module-level note
// in MemberReferrals.tsx for the safety rule this must never cross: order
// and count only, never a comparison or interpretation of what's IN a result.
//
// The grouping key is deliberately simple (lowercase, trim, strip
// punctuation, collapse whitespace, strip a leading/trailing year) and does
// NOT attempt to unify genuinely different wordings ("Annual bloods" vs
// "annual blood test") — that would require guessing at meaning, which is
// exactly the kind of cleverness this file avoids. A user/AI that reuses the
// same reason text each time (the common case) groups correctly; anything
// else stays as separate one-off records rather than being grouped wrong.
import { ReferralRecord } from '../types';

// Kinds where "the same test/scan repeated over time" is a meaningful,
// everyday concept. Referral letters, specialist letters, sick notes and
// "Other" are one-off documents by nature — grouping those would be forcing
// a shape onto data that doesn't have it.
const GROUPABLE_KINDS = new Set(['Lab result', 'Imaging']);

/**
 * Normalizes a free-text `reason` into a grouping key. Returns '' for
 * empty/whitespace-only/missing input — callers must treat '' as
 * "cannot be grouped", never as a valid shared key.
 */
export function normalizeTestKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();
  if (!s) return '';
  // Strip punctuation (keep letters/numbers/spaces from any language).
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  // Collapse runs of whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  // Strip a leading or trailing 4-digit year — "2024 annual bloods" and
  // "annual bloods 2025" both key on "annual bloods".
  s = s.replace(/^\d{4}\s+/, '').replace(/\s+\d{4}$/, '');
  return s.trim();
}

function recordSortValue(r: ReferralRecord): string {
  return r.date || r.addedAt || '';
}

export interface ReferralSeries {
  type: 'series';
  key: string;
  kind: string;
  /** Display label for the series — the most recent record's reason text. */
  label: string;
  /** Sorted most-recent-first. */
  records: ReferralRecord[];
}

export interface ReferralSingle {
  type: 'single';
  record: ReferralRecord;
}

export type ReferralListItem = ReferralSeries | ReferralSingle;

/**
 * Groups records of the same groupable kind + normalized reason into a
 * series (2+ records). A "series" of exactly one record is deliberately
 * rendered as a plain single — a repeat test only reads as a history once
 * there IS a history. Everything else (ungroupable kinds, empty reasons,
 * singletons) passes through unchanged. The returned list is sorted by each
 * item's most recent date, newest first — matching the flat list's existing
 * sort so grouping never reorders what a user is used to seeing.
 */
export function buildReferralGroups(records: ReferralRecord[]): ReferralListItem[] {
  const buckets = new Map<string, ReferralRecord[]>();
  const singles: ReferralRecord[] = [];

  for (const rec of records) {
    const key = GROUPABLE_KINDS.has(rec.kind) ? normalizeTestKey(rec.reason) : '';
    if (!key) {
      singles.push(rec);
      continue;
    }
    const bucketKey = `${rec.kind}::${key}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(rec);
    else buckets.set(bucketKey, [rec]);
  }

  const items: ReferralListItem[] = [];
  for (const [bucketKey, recs] of buckets) {
    if (recs.length < 2) {
      singles.push(...recs);
      continue;
    }
    const sortedRecs = [...recs].sort((a, b) => recordSortValue(b).localeCompare(recordSortValue(a)));
    items.push({
      type: 'series',
      key: bucketKey,
      kind: sortedRecs[0].kind,
      label: sortedRecs[0].reason || sortedRecs[0].kind,
      records: sortedRecs,
    });
  }
  for (const rec of singles) {
    items.push({ type: 'single', record: rec });
  }

  items.sort((a, b) => {
    const da = a.type === 'single' ? recordSortValue(a.record) : recordSortValue(a.records[0]);
    const db = b.type === 'single' ? recordSortValue(b.record) : recordSortValue(b.records[0]);
    return db.localeCompare(da);
  });

  return items;
}
