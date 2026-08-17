// One member's whole health picture, merged into a single chronological axis.
//
// WHY THIS EXISTS
// ----------------
// HealthTimeline.tsx used to be pediatric-only: it filtered to role==='Child'
// and merged exactly three sources (growthHistory, careSchedule[].lastVisit,
// Appointment-category calendar events). Vaccinations, referrals/results and
// every adult in the family were invisible to it — not because the data
// wasn't there, but because nothing read it. Rory (a Parent) could not see
// his OWN medical history through this screen at all. This module is the
// fix: a pure projection over data that already exists everywhere else in
// the app (Medical tab, Referrals & Results, Care schedule, the calendar),
// with no new field, no new store, and no new write path. One fact, one
// owner, read here for one more view of it — the same principle
// memberAppointments.ts documents for calendar-sourced appointments.
//
// SIX RULES THIS MODULE MUST NOT VIOLATE (each enforced below, inline)
// ----------------------------------------------------------------------
// 1. An undated vaccination is bucketed as "undated", never dropped and
//    never inferred from its notes text. server.js explicitly instructs the
//    AI to leave a vaccination date "" rather than guess one it can't read
//    — treating a blank date as a reason to hide the jab would punish the
//    app for being honest about what it doesn't know.
// 2. A referral's position on the axis is its OWN `.date` (the date printed
//    on the referral/result) and ONLY that — never `.addedAt` (when it was
//    scanned into the vault). Confusing the two would put a 2019 blood
//    result in "2026" because that's the year someone got around to
//    scanning it in. `.addedAt` may still be shown as secondary "filed on"
//    text; it must never decide which year bucket a row lands in.
// 3. An open, unbooked referral reuses the SAME "not yet booked" rule
//    MemberReferrals.tsx already renders as a chip next to the exact
//    KIND_CHIP/STATUS_CHIP colours this screen reuses — see isReferralStale
//    below for why that file, not a second invented threshold.
// 4. A careSchedule entry with no lastVisit produces NO history row. It
//    shows up under "upcoming" only if careNextDue() can derive a date for
//    it (an explicit nextDue, or a lastVisit it doesn't have); otherwise it
//    is left out of this module's output entirely — the Medical tab's own
//    Care schedule section already shows it, and a dateless "someday" row
//    would just be timeline noise.
// 5. Appointment calendar events are matched with eventBelongsToMember, not
//    a raw memberIds.includes — see eventMemberMatch.ts. A Google-imported
//    appointment arrives tagged to nobody; matching by name in the title is
//    the same fix Phase 0 applied to the old per-child merge.
// 6. `counts` reconciles: every vaccination / careSchedule / referral /
//    growthHistory / matched-appointment record this module considers ends
//    up in exactly one of upcoming / years / undated / omitted (the last
//    being rule 4's intentional, TRACKED drop — see the comment on
//    `omitted` below). Nothing vanishes without being counted somewhere.
import {
  FamilyMember,
  CalendarEvent,
  ReferralRecord,
  ReferralStatus,
} from '../types';
import { eventBelongsToMember } from './eventMemberMatch';
import { careNextDue } from './care';
import { todayIsoLocal } from './memberAppointments';
import { parseDateOnly } from './age';

export type HealthTimelineKind = 'vaccination' | 'care' | 'referral' | 'growth' | 'appointment';

export interface HealthTimelineItem {
  id: string;
  kind: HealthTimelineKind;
  /** YYYY-MM-DD this row is positioned by. Always the CLINICAL date — see rule 2 above. */
  date: string;
  time?: string;                 // appointment only
  title: string;
  provider?: string;
  notes?: string;
  // referral-only extras
  /** ReferralKind ('Referral'/'Imaging'/'Lab result'/…) — kept separate from `title` (the reason) so the UI can chip it via MemberReferrals.tsx's own KIND_CHIP palette. */
  referralKind?: string;
  status?: ReferralStatus;
  /** "Not yet booked" per isReferralStale — reuses MemberReferrals.tsx's own rule (rule 3). */
  stale?: boolean;
  appointmentDate?: string;      // booked appointment date, meaningful when status==='booked'
  /** Bookkeeping only — when this record was FILED, never when the row is positioned. */
  filedAt?: string;
  // growth-only extras
  heightCm?: number;
  weightKg?: number;
  deltaHeightCm?: number | null;
  deltaWeightKg?: number | null;
}

export interface HealthTimelineYear {
  year: number;
  /** Newest first within the year. */
  items: HealthTimelineItem[];
}

// The handover facts every emergency/handover doc needs and no timeline
// entry represents on its own — see EmergencyCard.tsx for the same list
// rendered with alarm styling for allergies. `undefined` = not on file;
// the component decides how to say that, this module just passes it through.
export interface HealthStandingFacts {
  bloodGroup?: string;
  allergies?: string;
  emergencyMedication?: string;
  organDonor?: boolean;          // only ever true here — "not recorded" and "no" are not the same claim
  preferredPharmacy?: string;
  medicalAidScheme?: string;
  medicalAidPlanOption?: string;
  registeredGpPractice?: string;
}

export interface HealthTimelineCounts {
  /** Total vaccination + careSchedule + referral + growthHistory + matched-appointment records considered. */
  total: number;
  upcoming: number;
  /** Sum of years[].items.length — every dated history row. */
  dated: number;
  undated: number;
  /**
   * careSchedule records with neither a lastVisit nor a derivable nextDue —
   * rule 4's intentional drop. Counted here (not silently absorbed into
   * `total` going missing) so a test, or a future debugging session, can
   * always account for every input record: total === upcoming + dated +
   * undated + omitted.
   */
  omitted: number;
}

export interface GrowthSummary {
  currentHeight: number | null;
  currentWeight: number | null;
  heightGrowth: number | null;
  weightGrowth: number | null;
  firstDate: string | null;
}

export interface HealthTimelineResult {
  standing: HealthStandingFacts;
  /** Soonest first. */
  upcoming: HealthTimelineItem[];
  /** Newest year first. */
  years: HealthTimelineYear[];
  undated: HealthTimelineItem[];
  /** Present only when the member has at least one validly-dated growth entry. */
  growthSummary: GrowthSummary | null;
  counts: HealthTimelineCounts;
}

// UTC-midnight parse on both sides, exactly like relativeDayLabel in
// memberAppointments.ts — no local DST transition can make a day 23 or 25
// hours long mid-subtraction, and it needs no injected Date, only the two
// YYYY-MM-DD strings already in hand.
function daysBetweenIso(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

// Rule 3: reuse the existing "not yet booked" rule rather than inventing a
// second one. The rule actually lives in MemberReferrals.tsx as a local
// `flagOverdue` (status==='open' && daysSince(date) >= 14) rendered next to
// exactly the KIND_CHIP/STATUS_CHIP colours STEP 1.3 reuses on this screen —
// not in readiness.ts (which has no referral logic at all) and not
// NeedsAttention.tsx's own two-tier 42/14-day version with a kind exclusion,
// which lives in a .tsx component file this pure module has no business
// importing. Matching MemberReferrals.tsx's simpler rule keeps the badge
// this screen shows consistent with the one the family already sees on the
// Referrals & Results tab for the very same record.
function isReferralStale(r: ReferralRecord, todayIso: string): boolean {
  if ((r.status || 'open') !== 'open' || !r.date) return false;
  const days = daysBetweenIso(r.date, todayIso);
  return days != null && days >= 14;
}

function isValidIso(date: string | undefined): date is string {
  return !!date && parseDateOnly(date) != null;
}

function yearOf(iso: string): number {
  return parseDateOnly(iso)!.getFullYear();
}

function buildStandingFacts(member: FamilyMember): HealthStandingFacts {
  const med = member.medical || {};
  const identity = member.identity || {};
  return {
    bloodGroup: med.bloodGroup || undefined,
    allergies: med.allergies || undefined,
    emergencyMedication: med.emergencyMedication || undefined,
    organDonor: med.organDonor === true ? true : undefined,
    preferredPharmacy: med.preferredPharmacy || undefined,
    medicalAidScheme: identity.medicalAidScheme || undefined,
    medicalAidPlanOption: identity.medicalAidPlanOption || undefined,
    registeredGpPractice: identity.registeredGpPractice || undefined,
  };
}

export function buildHealthTimeline({
  member,
  events,
  members,
  now,
}: {
  member: FamilyMember;
  events: readonly CalendarEvent[];
  /** Whole family — needed for eventBelongsToMember's title-matching fallback (rule 5). */
  members: readonly Pick<FamilyMember, 'id' | 'name'>[];
  /**
   * Injected, never read from the clock in here — so this is testable and so
   * one render of HealthTimeline.tsx uses one consistent "today" across
   * every source it merges, matching memberAppointments.ts's documented
   * convention (its `todayIso` parameter).
   */
  now: Date;
}): HealthTimelineResult {
  const todayIso = todayIsoLocal(now);
  const nowMs = now.getTime();

  const upcoming: HealthTimelineItem[] = [];
  const undated: HealthTimelineItem[] = [];
  const yearMap = new Map<number, HealthTimelineItem[]>();
  let omitted = 0;

  const placeDated = (item: HealthTimelineItem) => {
    if (!isValidIso(item.date)) {
      // Defensive only: growth/appointment dates are non-optional fields, so
      // this should be unreachable for them in practice, but a malformed
      // string must still land SOMEWHERE traceable rather than crash the
      // build — undated is the honest bucket for "we can't place this".
      undated.push(item);
      return;
    }
    const y = yearOf(item.date);
    const bucket = yearMap.get(y);
    if (bucket) bucket.push(item);
    else yearMap.set(y, [item]);
  };

  // --- 1. Vaccinations (rule 1) ---------------------------------------
  for (const v of member.medical?.vaccinations || []) {
    const item: HealthTimelineItem = {
      id: `vaccination-${v.id}`,
      kind: 'vaccination',
      date: v.date || '',
      title: v.name || 'Vaccination',
      notes: v.notes,
    };
    if (isValidIso(v.date)) placeDated(item);
    else undated.push(item);
  }

  // --- 2. Care schedule (rule 4) ---------------------------------------
  for (const c of member.careSchedule || []) {
    if (c.lastVisit) {
      placeDated({
        id: `care-${c.id}`,
        kind: 'care',
        date: c.lastVisit,
        title: c.kind,
        provider: c.provider,
        notes: c.notes,
      });
      continue;
    }
    const due = careNextDue(c, nowMs);
    if (due.date) {
      const y = due.date.getFullYear();
      const m = String(due.date.getMonth() + 1).padStart(2, '0');
      const d = String(due.date.getDate()).padStart(2, '0');
      upcoming.push({
        id: `care-${c.id}`,
        kind: 'care',
        date: `${y}-${m}-${d}`,
        title: c.kind,
        provider: c.provider,
        notes: c.notes,
      });
      continue;
    }
    omitted++; // no lastVisit, no derivable nextDue — rule 4's tracked drop
  }

  // --- 3. Referrals & results (rules 2 and 3) ---------------------------
  for (const r of member.referrals || []) {
    const item: HealthTimelineItem = {
      id: `referral-${r.id}`,
      kind: 'referral',
      date: r.date || '', // NEVER r.addedAt — see rule 2
      title: r.reason || r.kind,
      referralKind: r.kind,
      provider: r.providerName,
      notes: r.notes,
      status: r.status || 'open',
      stale: isReferralStale(r, todayIso),
      appointmentDate: r.appointmentDate,
      filedAt: r.addedAt, // display-only "filed on", positions nothing
    };
    if (isValidIso(r.date)) placeDated(item);
    else undated.push(item);
  }

  // --- 4. Growth history (best-populated source; date is required) ------
  const growthAsc = [...(member.growthHistory || [])]
    .filter((g) => isValidIso(g.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  let lastWeighed: (typeof growthAsc)[number] | null = null;
  for (let i = 0; i < growthAsc.length; i++) {
    const g = growthAsc[i];
    const prev = i > 0 ? growthAsc[i - 1] : null;
    placeDated({
      id: `growth-${g.id}`,
      kind: 'growth',
      date: g.date,
      title: 'Growth check-in',
      notes: g.notes,
      heightCm: g.heightCm,
      weightKg: g.weightKg,
      deltaHeightCm: prev ? g.heightCm - prev.heightCm : null,
      deltaWeightKg: g.weightKg && lastWeighed ? g.weightKg - lastWeighed.weightKg : null,
    });
    if (g.weightKg) lastWeighed = g;
  }
  // Any growthHistory entry with an unparseable date (shouldn't happen —
  // GrowthLog.date is required — but real data occasionally violates its
  // own schema) still needs a home: undated, not silently missing.
  for (const g of member.growthHistory || []) {
    if (!isValidIso(g.date)) {
      undated.push({ id: `growth-${g.id}`, kind: 'growth', date: g.date || '', title: 'Growth check-in', notes: g.notes, heightCm: g.heightCm, weightKg: g.weightKg });
    }
  }

  const growthSummary: GrowthSummary | null = growthAsc.length === 0 ? null : (() => {
    const earliest = growthAsc[0];
    const latest = growthAsc[growthAsc.length - 1];
    const heightGrowth = growthAsc.length > 1 ? latest.heightCm - earliest.heightCm : null;
    const weightGrowth =
      growthAsc.length > 1 && latest.weightKg && earliest.weightKg
        ? latest.weightKg - earliest.weightKg
        : null;
    return {
      currentHeight: latest.heightCm ?? null,
      currentWeight: latest.weightKg || null,
      heightGrowth,
      weightGrowth,
      firstDate: earliest.date,
    };
  })();

  // --- 5. Appointment calendar events (rule 5) ---------------------------
  // CalendarEvent.date is a required field, so every matched event places
  // into either upcoming or years — never undated.
  for (const e of events) {
    if (e.category !== 'Appointment') continue;
    if (!eventBelongsToMember(e, member.id, members)) continue;
    const item: HealthTimelineItem = {
      id: `appointment-${e.id}`,
      kind: 'appointment',
      date: e.date,
      time: e.time,
      title: e.title,
    };
    if (e.date >= todayIso) upcoming.push(item);
    else placeDated(item);
  }

  upcoming.sort((a, b) => (a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date.localeCompare(b.date)));

  const years: HealthTimelineYear[] = [...yearMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({
      year,
      items: [...items].sort((a, b) => b.date.localeCompare(a.date)),
    }));

  const dated = years.reduce((n, y) => n + y.items.length, 0);

  return {
    standing: buildStandingFacts(member),
    upcoming,
    years,
    undated,
    growthSummary,
    counts: {
      total:
        (member.medical?.vaccinations?.length || 0) +
        (member.careSchedule?.length || 0) +
        (member.referrals?.length || 0) +
        (member.growthHistory?.length || 0) +
        events.filter((e) => e.category === 'Appointment' && eventBelongsToMember(e, member.id, members)).length,
      upcoming: upcoming.length,
      dated,
      undated: undated.length,
      omitted,
    },
  };
}
