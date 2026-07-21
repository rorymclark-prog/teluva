// Pure helpers for Wills & Estate — mirrors utils/vehicle.ts and utils/care.ts.
// Store-and-recall only: this file computes how long it's been since a record
// was last reviewed. It never judges whether a document is valid or current —
// only the family knows that; the app just nudges them to go check.
import { parseDateOnly } from './age';

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
