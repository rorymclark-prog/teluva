// Pure helpers for Wills & Estate — mirrors utils/vehicle.ts and utils/care.ts.
// Store-and-recall only: this file computes how long it's been since a record
// was last reviewed. It never judges whether a document is valid or current —
// only the family knows that; the app just nudges them to go check.
import { parseDateOnly } from './age';
import type { EstateDocStatus, EstateRegistryStatus } from '../types';

const MONTH = 1000 * 60 * 60 * 24 * 30.4375;

// A document kind, with an optional Austrian-terminology hint shown in the UI.
// Jurisdiction-neutral by design (Rory is Austrian-resident AND South African) —
// the app doesn't assume one country's terms are universal.
export interface EstateDocKindOption {
  kind: string;
  atHint?: string; // e.g. "Vorsorgevollmacht in Austria"
}

export const ESTATE_DOC_KINDS: EstateDocKindOption[] = [
  { kind: 'Will' },
  { kind: 'Codicil' },
  { kind: 'Power of attorney', atHint: 'Vorsorgevollmacht in Austria' },
  { kind: 'Advance healthcare directive', atHint: 'Patientenverfügung in Austria' },
  { kind: 'Funeral wishes' },
  { kind: 'Other' },
];

// Wills go stale after marriages, births, deaths, and property moves — a
// product judgment call, not a legal one. Easy to retune if it proves too
// naggy or too lax in practice.
export const STALE_REVIEW_MONTHS = 36;

export function monthsSinceReview(lastReviewed?: string, now: number = Date.now()): number | null {
  const d = parseDateOnly(lastReviewed);
  if (!d) return null;
  return (now - d.getTime()) / MONTH;
}

export function isReviewStale(lastReviewed?: string, now: number = Date.now()): boolean {
  const months = monthsSinceReview(lastReviewed, now);
  return months !== null && months >= STALE_REVIEW_MONTHS;
}

// A short, matter-of-fact label — no urgency language, this is end-of-life
// material. "Not reviewed yet" when no date has ever been set.
export function reviewAgeLabel(lastReviewed?: string, now: number = Date.now()): string {
  const months = monthsSinceReview(lastReviewed, now);
  if (months === null) return 'Not reviewed yet';
  if (months < 1) return 'Reviewed this month';
  if (months < 24) {
    const m = Math.max(1, Math.round(months));
    return `Reviewed ${m} month${m === 1 ? '' : 's'} ago`;
  }
  const years = Math.round(months / 12);
  return `Reviewed ~${years} year${years === 1 ? '' : 's'} ago`;
}

// ── WHAT STATE IS IT IN, AND WOULD ANYONE FIND IT ────────────────────────
// Store-and-recall still: everything below reports what the family typed and
// how Austrian probate demonstrably works. It never tells anyone what to do
// with their will.

export const ESTATE_DOC_STATUSES: Array<{ id: EstateDocStatus; label: string; detail: string }> = [
  { id: 'unknown', label: 'Not sure', detail: 'Nobody has recorded what state this is in.' },
  { id: 'draft', label: 'Unsigned draft', detail: 'Written but not signed. Not yet a will.' },
  { id: 'signed-copy', label: 'Signed copy', detail: 'A copy of a signed document. The original is somewhere else.' },
  { id: 'signed-original', label: 'The signed original', detail: 'The document itself, the one that counts.' },
];

export const REGISTRY_STATUSES: Array<{ id: EstateRegistryStatus; label: string }> = [
  { id: 'unknown', label: 'Not checked' },
  { id: 'registered', label: 'Registered' },
  { id: 'not-registered', label: 'Not registered' },
];

export const statusLabel = (s?: EstateDocStatus) =>
  ESTATE_DOC_STATUSES.find((x) => x.id === (s || 'unknown'))?.label || 'Not sure';

/**
 * WOULD ANYBODY ACTUALLY FIND THIS?
 *
 * In Austria the Gerichtskommissär — the notary running the probate — queries
 * both central registers automatically once a death is recorded. But ONLY a
 * document drawn up or held by a notary or lawyer can be in those registers
 * at all, and heirs have no right to search them themselves. So for a will
 * written at the kitchen table the registers are empty and the court will not
 * find it: whoever holds the paper has to produce it, and if nobody knows
 * where the paper is, the estate is distributed as if there were no will.
 *
 * That is a statement about how the procedure works, not advice about what
 * anyone should do — the same line every other helper in this file keeps.
 * It returns null unless the gap is real, because a warning that shows on
 * every record is one nobody reads.
 */
export function findabilityGap(record: {
  kind?: string;
  status?: EstateDocStatus;
  registered?: EstateRegistryStatus;
  heldBy?: string;
  originalLocation?: string;
}): string | null {
  // Only meaningful for something that has to be produced to a court.
  if (!/will|codicil|testament/i.test(record.kind || '')) return null;
  // A draft has nothing to find yet; saying so here would just be noise.
  if ((record.status || 'unknown') === 'draft') return null;
  const held = (record.heldBy || '').trim();
  const where = (record.originalLocation || '').trim();
  if (record.registered === 'registered') return null;
  if (held) return null;
  if (where) return null;
  return 'Nobody has recorded where the signed original is kept, who holds it, '
    + 'or whether it is in a will register. A will that is not with a notary or '
    + 'lawyer is not in the Austrian registers, and the court will not go looking '
    + 'for it — someone has to produce the paper.';
}
