// The "expires soon" window for a CV qualification (first-aid certificate,
// driving-licence category, professional registration) — shared between
// MemberCV's own ExpiryChip (Certificates & qualifications tab) and
// MemberOverview's business work-summary card. Both need to agree on when a
// certificate counts as soon-to-expire; keeping the threshold here, in one
// place, is what stops that agreement from drifting apart under a future edit.
export type QualificationExpiryStatus = 'expired' | 'soon' | 'ok';

const SOON_MONTHS = 2;

export function qualificationExpiryStatus(expiryDate: string, now: number = Date.now()): QualificationExpiryStatus {
  const diffDays = Math.ceil((new Date(expiryDate).getTime() - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays / 30.4375 <= SOON_MONTHS) return 'soon';
  return 'ok';
}
