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
