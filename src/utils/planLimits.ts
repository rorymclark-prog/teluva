// Plan limits — groundwork for the future €5/month paid plan (NO billing or
// checkout exists yet). Per SPACE (family or business), not per user.
//
// This file is the pure, unit-tested logic (see planLimits.test.ts). It is
// used CLIENT-SIDE ONLY, for display — the numbers here must always match
// server.js's own duplicate (PLAN_LIMITS / checkAiUsage / seatCapCheck),
// which is what actually enforces the limits. server.js can't import this
// file directly (it ships as a standalone server.js + dist bundle, with no
// TypeScript in the runtime image — see Dockerfile), so the two are kept in
// sync by hand, the same precedent already set by sunSignFromBirthdate /
// yearsSinceFoundingServer duplicating src/utils/astrology.ts and
// src/utils/businessMilestone.ts. If these numbers ever change, change both.
import { Plan } from '../types';

export interface PlanLimitConfig {
  aiActionsPerMonth: number;
  seats: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimitConfig> = {
  free: { aiActionsPerMonth: 30, seats: 10 },
  paid: { aiActionsPerMonth: 2000, seats: 200 },
};

// Whatever isn't literally "paid" is "free" — this is also how an absent
// `plan` field (every space today) defaults, since free is the only tier
// that exists until the owner starts flipping the field by hand.
export function planFromField(planField: unknown): Plan {
  return planField === 'paid' ? 'paid' : 'free';
}

// A "paid" grant is only paid while it hasn't expired — `planExpiresAt` is an
// ISO string stamped at grant time (a new space's trial, or a manual/tester
// grant). No value means an indefinite grant, the original pre-trial
// precedent (an admin hand-flipping "plan" in the Firestore console with no
// end date). This is deliberately lazy, not cron-driven: nothing "runs out" a
// plan on a schedule — reading past its own expiresAt IS the downgrade, the
// same principle monthKeyUtc already uses (a new period is just a new key,
// nothing has to fire an event to start it).
export function resolvePlan(
  info: { plan?: unknown; planExpiresAt?: unknown } | null | undefined,
  now: Date = new Date(),
): Plan {
  if (planFromField(info?.plan) !== 'paid') return 'free';
  const expiresAt = info?.planExpiresAt;
  if (typeof expiresAt === 'string' && expiresAt) {
    const t = Date.parse(expiresAt);
    if (!Number.isNaN(t) && t <= now.getTime()) return 'free';
  }
  return 'paid';
}

// 14 days of full paid limits from signup — enough to scan every document in
// one sitting ("enough for them to set up all their docs"). Stamped onto a
// new space by /api/create-family and /api/create-space.
export const TRIAL_DAYS = 14;

export function trialExpiryIso(from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + TRIAL_DAYS);
  return d.toISOString();
}

// Month key is UTC-based (YYYY-MM), not the space's local time. A space (a
// family or a business) has members who may be in different timezones and
// there is no stored "space timezone" field to key off — UTC is the only
// value that is unambiguous and free for every reader/writer to agree on.
// Same reasoning server.js already uses for its founding-date "tomorrowUtc"
// slack check. A new UTC month is simply a new document — nothing resets it.
export function monthKeyUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7); // "YYYY-MM"
}

// Human label for the 1st of the month AFTER `date`, e.g. "1 August" — used
// in the limit-reached message so it tells the user exactly when they'll get
// more actions, without exposing the raw YYYY-MM key.
export function resetDateLabelUtc(date: Date = new Date()): string {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return next.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function aiLimitFor(plan: Plan): number {
  return PLAN_LIMITS[plan].aiActionsPerMonth;
}

export function seatLimitFor(plan: Plan): number {
  return PLAN_LIMITS[plan].seats;
}

// `used` is the count of successful AI actions so far this month. Reached
// (not "about to be reached") — the limit itself is still allowed to be used.
export function isAiLimitReached(used: number, plan: Plan): boolean {
  return used >= aiLimitFor(plan);
}

export function aiLimitMessage(plan: Plan, date: Date = new Date()): string {
  const limit = aiLimitFor(plan);
  return `You've used all ${limit} AI actions this month. They reset on ${resetDateLabelUtc(date)}. Everything else — documents, warnings, the emergency card — still works as normal.`;
}

// Seat-cap decision for a NEW join. `existingCount` is the number of
// families/{id}/roles/* docs already in the space BEFORE this join — it says
// nothing about the members who make up that count, so a space that is
// already OVER its limit (e.g. it had 12 members on free, or was downgraded
// from paid) simply keeps refusing new joins without this function ever
// re-evaluating — let alone removing — anyone already in. That grandfathering
// happens by construction: this function is only ever consulted at join
// time, never against existing members.
export function canAddMember(existingCount: number, plan: Plan): boolean {
  return existingCount < seatLimitFor(plan);
}

export function seatLimitMessage(existingCount: number, plan: Plan): string {
  const limit = seatLimitFor(plan);
  return `This space already has ${existingCount} members — the maximum allowed on the ${plan} plan is ${limit}. Ask an admin to upgrade before inviting more.`;
}
