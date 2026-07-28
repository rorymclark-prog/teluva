// Clothing-size staleness: ClothingSizes.lastUpdated is written by
// MemberSizing but (before this) nothing read it back. A 1-year-old outgrows
// clothes far faster than a 40-year-old, so the "go check the sizes" nudge
// threshold scales down with age — see staleSizeThresholdMonths below. Shared
// by NeedsAttention.tsx (the nudge), chatInsights.ts (the chat heads-up gap)
// and MemberSizing.tsx (the prominent in-tab banner) so all three agree on
// exactly the same definition of "stale".
import { ClothingSizes } from '../types';
import { ageYearsAt, parseDateOnly } from './age';

// How fast outgrowing goes with age. Suggested by Rory: under 2y -> 3 months,
// 2-5y -> 6 months, 6-17y -> 12 months, adult -> 36 months.
export function staleSizeThresholdMonths(ageYears: number): number {
  if (ageYears < 2) return 3;
  if (ageYears <= 5) return 6;
  if (ageYears <= 17) return 12;
  return 36;
}

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

const hasAnySize = (cs: ClothingSizes | undefined): boolean =>
  !!cs && !!(cs.tops || cs.bottoms || cs.shoes || cs.outerwear || cs.underwear || cs.hatValue
    || cs.dressSize || cs.jacketSize || cs.ringSize || cs.heightCm || cs.weightKg);

export interface SizeStaleness {
  stale: boolean;
  monthsSince: number | null;     // null when lastUpdated is missing entirely (still may be `stale: true`)
  thresholdMonths: number | null; // null when there's no birthdate/no sizes to derive one from
}

// Only meaningful when the member HAS a birthdate (the threshold scales with
// age) and HAS at least one size recorded (nothing to go stale about
// otherwise) — callers should skip anyone without a birthdate rather than
// guess an age band. An absent lastUpdated on a member who does have sizes on
// file is treated as stale (never measured = definitely worth a check).
export function sizeStaleness(clothingSizes: ClothingSizes | undefined, birthdate: string | undefined, todayISO: string): SizeStaleness {
  if (!birthdate || !hasAnySize(clothingSizes)) return { stale: false, monthsSince: null, thresholdMonths: null };
  const ageYears = ageYearsAt(birthdate, todayISO);
  if (ageYears === null) return { stale: false, monthsSince: null, thresholdMonths: null };
  const thresholdMonths = staleSizeThresholdMonths(ageYears);

  const lastUpdated = clothingSizes?.lastUpdated;
  if (!lastUpdated) return { stale: true, monthsSince: null, thresholdMonths };

  const last = parseDateOnly(lastUpdated);
  const today = parseDateOnly(todayISO);
  if (!last || !today) return { stale: true, monthsSince: null, thresholdMonths };

  const monthsSince = Math.round((today.getTime() - last.getTime()) / MONTH_MS);
  return { stale: monthsSince >= thresholdMonths, monthsSince, thresholdMonths };
}
