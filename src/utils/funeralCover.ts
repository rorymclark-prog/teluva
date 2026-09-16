// Pure helpers for funeral cover — mirrors utils/vehicle.ts and utils/willsEstate.ts.
// Store-and-recall only: this file never judges whether a policy is good value
// or sufficient, only computes dates from what the family typed in.
import { parseDateOnly } from './age';
import type { InsurancePolicy } from '../types';

const DAY = 1000 * 60 * 60 * 24;

// The policy types this app treats as "funeral-shaped" — the ones where a
// waiting period, a beneficiary, and repatriation are meaningful concepts.
// A home/car/travel policy never touches this code path.
export const FUNERAL_POLICY_TYPES = ['Funeral cover', 'Burial society', 'Repatriation cover'] as const;

export function isFuneralPolicy(type?: string): boolean {
  return !!type && (FUNERAL_POLICY_TYPES as readonly string[]).includes(type);
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The date a NATURAL-death claim first becomes payable. An explicit override
// (waitingPeriodEndDate) wins; else derived from startDate + waitingPeriodMonths
// — same "explicit override, else derive" pattern as Vehicle.nextServiceDue.
// Accidental death is typically covered from day one regardless (see South
// African funeral-policy research in the handoff notes) — this function is
// deliberately only about the NATURAL-death clock.
export function waitingPeriodEndDate(
  p: Pick<InsurancePolicy, 'waitingPeriodEndDate' | 'startDate' | 'waitingPeriodMonths'>,
): Date | null {
  if (p.waitingPeriodEndDate) return parseDateOnly(p.waitingPeriodEndDate);
  if (!p.startDate || !p.waitingPeriodMonths || p.waitingPeriodMonths <= 0) return null;
  const start = parseDateOnly(p.startDate);
  if (!start) return null;
  const end = new Date(start);
  end.setMonth(end.getMonth() + p.waitingPeriodMonths);
  return end;
}

// Same as waitingPeriodEndDate but as a YYYY-MM-DD string, for display.
export function waitingPeriodEndISO(
  p: Pick<InsurancePolicy, 'waitingPeriodEndDate' | 'startDate' | 'waitingPeriodMonths'>,
): string | null {
  const d = waitingPeriodEndDate(p);
  return d ? toISO(d) : null;
}

// Days remaining until natural-death cover starts (negative once it has
// started — callers should treat that as "not in the waiting period").
export function daysUntilWaitingPeriodEnd(
  p: Pick<InsurancePolicy, 'waitingPeriodEndDate' | 'startDate' | 'waitingPeriodMonths'>,
  now: number = Date.now(),
): number | null {
  const end = waitingPeriodEndDate(p);
  if (!end) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / DAY);
}

// True while a natural-death claim would NOT yet pay out.
export function inWaitingPeriod(
  p: Pick<InsurancePolicy, 'waitingPeriodEndDate' | 'startDate' | 'waitingPeriodMonths'>,
  now: number = Date.now(),
): boolean {
  const days = daysUntilWaitingPeriodEnd(p, now);
  return days !== null && days > 0;
}

// Given an actual date of death (a real ISO date — never DepartedRelative.died,
// which is deliberately free text, see types.ts) and the policy's stated claim
// window, the date the claim must be lodged by. Not wired to any UI in v1 (the
// app has no field for a living member's date of death), but kept as tested,
// pure logic ready for a future claim-tracking feature.
export function claimDeadlineFromDeath(deathDateISO: string, claimDeadlineMonths?: number): Date | null {
  if (!claimDeadlineMonths || claimDeadlineMonths <= 0) return null;
  const death = parseDateOnly(deathDateISO);
  if (!death) return null;
  const deadline = new Date(death);
  deadline.setMonth(deadline.getMonth() + claimDeadlineMonths);
  return deadline;
}

// A short, matter-of-fact label for the claim-deadline field — no date maths,
// just what the policy says. e.g. "Claim must be lodged within 6 months of death".
export function claimDeadlineLabel(claimDeadlineMonths?: number): string | null {
  if (!claimDeadlineMonths || claimDeadlineMonths <= 0) return null;
  return `Claim must be lodged within ${claimDeadlineMonths} month${claimDeadlineMonths === 1 ? '' : 's'} of death`;
}

/* ── The funeral-cover summary shown on the Wills & Estate page ──────────────
 *
 * WHY THIS LIVES HERE AND NOT IN Insurance.
 *
 * The fields are all on InsurancePolicy and Insurance stays their ONE writer —
 * nothing below writes anything. But the moment these are needed is not a
 * moment anyone goes looking under Finances. Somebody has died, and the first
 * useful act of the day is phoning a claims line. Putting a read-only copy on
 * the estate page is the difference between "the number is in the app" and
 * "the number is where they are already standing".
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never says a policy WILL pay. A waiting
 * period is reported as a fact about the policy's own dates, never as a verdict
 * on a claim, because this app is not told when anybody died and must not imply
 * it has decided anything. See claimDeadlineFromDeath — same rule.
 */

export interface FuneralCoverLine {
  id: string;
  provider: string;
  type: string;
  policyNumber?: string;
  /** The number to ring. A burial society has no claims line, only a person. */
  callLabel?: string;
  callValue?: string;
  /** True when that value is a phone number we can offer as a tel: link. */
  callIsPhone: boolean;
  /** The digits to dial — NOT callValue, which may carry a name around them. */
  callTel?: string;
  beneficiary?: string;
  repatriation?: string;
  /** Present only while the policy is still inside its waiting period. */
  waitingNote?: string;
  /** True when nothing useful is on file beyond the provider's name. */
  bare: boolean;
}

/**
 * The number to actually dial out of a free-text contact, or null.
 *
 * EXTRACT, DO NOT JUDGE. A burial society contact is typically written as a
 * person and a number together — "MaDlamini 082 555 1234" — and an earlier
 * version of this rejected anything containing letters, which threw that away.
 * Counting digits across the whole string is the opposite failure: "Paid up
 * since 2019, office 9-5" has plenty of digits and dials 201995.
 *
 * So we look for one CONTIGUOUS phone-shaped run and dial that. A number the
 * family can see but not tap is a small annoyance; a tappable button that
 * dials nonsense on the worst morning of their life is not.
 */
export function dialableNumber(v?: string): string | null {
  const s = (v || '').trim();
  if (!s) return null;
  // +? then 7+ digits, allowing the spaces, dashes, dots and parens people type.
  const m = /\+?\d[\d\s().-]{5,}\d/.exec(s);
  if (!m) return null;
  const digits = m[0].replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  return (m[0].trim().startsWith('+') ? '+' : '') + digits;
}

/** True when there is something in here we can offer as a tel: link. */
export function looksDialable(v?: string): boolean {
  return dialableNumber(v) !== null;
}

/**
 * One display line per funeral policy, ordered so the one you can actually
 * claim on comes first.
 *
 * ORDER MATTERS MORE THAN IT LOOKS. A family reads the top line and rings it.
 * A policy still inside its waiting period sorts BELOW a policy that is
 * through — not hidden, because it may still pay on an accidental death and
 * hiding it would be its own kind of lie, but not offered first either.
 */
export function funeralCoverLines(
  policies: InsurancePolicy[],
  today: Date = new Date(),
): FuneralCoverLine[] {
  const lines = (policies || []).filter(p => p && isFuneralPolicy(p.type)).map((p) => {
    // A burial society is an informal arrangement: there is no claims line, so
    // the named contact IS the number. Prefer the formal one when both exist.
    const society = (p.burialSocietyContact || '').trim();
    const claims = (p.claimsPhone || '').trim();
    const callValue = claims || society || undefined;
    const callLabel = claims ? 'Claims' : society ? 'Burial society' : undefined;
    const waiting = inWaitingPeriod(p, today.getTime());
    const days = waiting ? daysUntilWaitingPeriodEnd(p, today.getTime()) : null;
    return {
      id: p.id,
      provider: (p.provider || '').trim() || 'Unnamed policy',
      type: (p.type || 'Funeral cover').trim(),
      policyNumber: (p.policyNumber || '').trim() || undefined,
      callLabel,
      callValue,
      callIsPhone: dialableNumber(callValue) !== null,
      callTel: dialableNumber(callValue) || undefined,
      beneficiary: (p.beneficiary || '').trim() || undefined,
      repatriation: p.repatriationIncluded
        ? `Repatriation included${p.repatriationDestination ? ` — ${p.repatriationDestination.trim()}` : ''}`
        : undefined,
      waitingNote: waiting
        ? (days !== null && days > 0
            ? `Waiting period ends in ${days} ${days === 1 ? 'day' : 'days'} — a natural-cause claim may not pay before then`
            : 'Still inside its waiting period — a natural-cause claim may not pay yet')
        : undefined,
      bare: !claims && !society && !(p.policyNumber || '').trim(),
    };
  });
  // Stable: through-waiting first, otherwise the order Insurance holds them in.
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.waitingNote ? 1 : 0) - (b.l.waitingNote ? 1 : 0) || a.i - b.i)
    .map(x => x.l);
}
