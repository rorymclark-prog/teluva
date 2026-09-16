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

// AI actions are the only line item here that costs real money — measured at
// roughly $0.06 each (Vertex, gemini-2.5-pro dominating). Seats are free, so
// they are set by what a household plausibly needs, not by cost.
//
// WHY 'trial' EXISTS AS ITS OWN TIER. Every new space is stamped with a
// 180-day grant. That grant used to be 'paid', so every single signup carried
// the 2,000-action paid allowance for six months and the free number was
// irrelevant to the bill: 2,500 households x 2,000 x $0.06 is roughly
// $315,000 a month. A trial is a trial — generous enough to file every
// document and form an opinion, nowhere near a paying customer's ceiling.
export const PLAN_LIMITS: Record<Plan, PlanLimitConfig> = {
  free: { aiActionsPerMonth: 5, seats: 10 },
  trial: { aiActionsPerMonth: 100, seats: 200 },
  paid: { aiActionsPerMonth: 2000, seats: 200 },
};

// The whole-app ceiling, and the only number that actually bounds the bill.
// Per-space limits cannot: the cost scales with how many people sign up, and
// nothing stops 10,000 of them. This is a hard monthly stop across every space
// at once — when it trips, AI is off for everybody until the next UTC month or
// until the ceiling is raised.
//
// The server reads AI_GLOBAL_ACTIONS_PER_MONTH from the environment, so this
// can be changed on Cloud Run WITHOUT a deploy. This constant is the default
// and the client-side display value; server.js holds the enforcing copy.
// 5,000 actions is about $315/month at the measured rate.
export const GLOBAL_AI_ACTIONS_PER_MONTH = 5000;

// Anything that is not a tier name we recognise is 'free' — including an
// absent field, which is how a pre-trial space defaults. Deliberately an
// allowlist of two strings rather than "not free means paid": a typo in the
// Firestore console must never hand somebody the paid ceiling.
export function planFromField(planField: unknown): Plan {
  if (planField === 'paid') return 'paid';
  if (planField === 'trial') return 'trial';
  return 'free';
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
  const granted = planFromField(info?.plan);
  if (granted === 'free') return 'free';
  const expiresAt = info?.planExpiresAt;
  if (typeof expiresAt === 'string' && expiresAt) {
    const t = Date.parse(expiresAt);
    if (!Number.isNaN(t) && t <= now.getTime()) return 'free';
  }
  return granted;
}

// 90 days of TRIAL limits from signup (not paid limits — see PLAN_LIMITS).
//
// WHY 90 AND NOT 180. A family's AI use is front-loaded: they file every
// document in the first weeks and then it goes quiet, so a household that has
// not formed an opinion in 90 days will not form one in 180. It halves the
// per-signup exposure (300 actions rather than 600, roughly $19 against $38 at
// the measured rate) and it reports back on whether people will pay three
// months sooner — which is the thing worth knowing BEFORE a store launch.
//
// It is also the only direction that moves gracefully. scripts/grant-tester-plan.mjs
// extends any individual space by hand, so a tester who earns more gets more.
// Going the other way means taking something away from people who already have
// it, which cannot be done quietly.
//
// server.js keeps its OWN copy of this constant (it ships standalone with no
// TypeScript in the runtime image) and IT is what stamps planExpiresAt onto a
// new space. Changing only this one is a no-op for every real signup —
// planLimits.test.ts pins the two together so that cannot happen quietly.
export const TRIAL_DAYS = 90;

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
