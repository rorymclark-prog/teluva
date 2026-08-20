import { useState, useEffect, type ElementType } from 'react';
import { Bell, Cake, Ruler, FileText, HeartPulse, ChevronRight, ChevronDown, Sparkles, Stethoscope, TrainFront, IdCard, Camera, Package, Car, Award, PartyPopper, ScrollText, RotateCcw, ShieldCheck, Shirt, Clock } from 'lucide-react';
import { FamilyMember, AssetItem, Vehicle, ExtendedBirthday, FamilyInfoDoc, EstateRecord, SlipItem, HubSettings, BusinessMilestonesDoc, InsurancePolicy } from '../types';
import { careNextDue } from '../utils/care';
import { loadAssets, loadHousehold, loadSpaceInfo, loadWillsEstate, loadSlips, loadSettings, loadBusinessMilestones, loadFinances } from '../utils/db';
import { vehicleDeadlines, vehicleLabel, daysUntil } from '../utils/vehicle';
import { birthdayPhotoNudge } from '../utils/birthday';
import { nextAnniversary, nextMilestoneAnniversary } from '../utils/businessMilestone';
import { isReviewStale } from '../utils/willsEstate';
import { sizeStaleness } from '../utils/sizeStaleness';
import { todayISO } from '../utils/age';
import { nameDayOccurrenceInYear } from '../utils/nameDay';
import { isFuneralPolicy, inWaitingPeriod, daysUntilWaitingPeriodEnd } from '../utils/funeralCover';

const DAY = 1000 * 60 * 60 * 24;
const MONTH = DAY * 30.4375;

// Local-time YYYY-MM-DD formatter — avoids the off-by-one-day bug you get from
// Date#toISOString() (which converts to UTC) when the user's timezone is ahead
// of UTC, e.g. Vienna. Mirrors utils/vehicle.ts's toISO().
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type Tone = 'urgent' | 'warn' | 'info';
export interface Nudge {
  key: string;
  memberId: string;
  icon: ElementType;
  tone: Tone;
  text: string;
  tab: string;
  view?: string; // if set, the nudge navigates to a top-level view (e.g. 'assets') instead of a member tab
  date?: string; // YYYY-MM-DD, when this nudge is tied to a specific date — used by MemberCalendarDates
  days?: number; // days until `date` (negative = overdue) — used by MemberCalendarDates for sorting
  sortDays?: number; // days until ACTIONABLE, negative = overdue. Digest ranking only — see byUrgency.
}

/**
 * Ranking for the digest: tone first, then how soon it needs you.
 *
 * `sortDays` exists separately from `days` because `days` means different things
 * to different builders — "days until" for an expiry, "days since" for a
 * referral — and MemberCalendarDates sorts on `days` with the first meaning.
 * Sorting the digest on it directly would rank a two-week-old referral above a
 * passport expiring on Friday.
 */
function byUrgency(a: Nudge, b: Nudge): number {
  const order: Record<Tone, number> = { urgent: 0, warn: 1, info: 2 };
  const t = order[a.tone] - order[b.tone];
  if (t !== 0) return t;
  return (a.sortDays ?? Infinity) - (b.sortDays ?? Infinity);
}

// Asset completeness nudges — surfaced from the family's belongings (loaded
// separately from members). Grouped so the digest never floods, and 'info' tone
// so they always sit below real expiries/overdue items.
function computeAssetNudges(assets: AssetItem[]): Nudge[] {
  const out: Nudge[] = [];
  const noPhoto = assets.filter((a) => !a.photoDataUrl && !(a.photos && a.photos.length));
  if (noPhoto.length > 0) {
    const n = noPhoto.length;
    out.push({
      key: 'assets-nophoto',
      memberId: '',
      icon: Camera,
      tone: 'info',
      text: `${n} belonging${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} no photo — add one for insurance claims`,
      tab: 'assets',
      view: 'assets',
    });
  }
  // Missing key claim details (serial/identifier or a value) on items that DO
  // exist — one grouped nudge, so proof-of-ownership gaps are visible too.
  const missingDetails = assets.filter((a) => !a.serialNumber && !a.replacementValue && !a.purchasePrice);
  if (missingDetails.length > 0) {
    const n = missingDetails.length;
    out.push({
      key: 'assets-nodetails',
      memberId: '',
      icon: Package,
      tone: 'info',
      text: `${n} belonging${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} missing a serial number or value`,
      tab: 'assets',
      view: 'assets',
    });
  }
  return out;
}

// Vehicle deadline nudges — inspection (§57a/MOT), insurance renewal, service,
// vignette. Overdue = urgent, due within 42 days = warn. One per due deadline.
export function computeVehicleNudges(vehicles: Vehicle[]): Nudge[] {
  const out: Nudge[] = [];
  for (const v of vehicles) {
    for (const d of vehicleDeadlines(v)) {
      if (d.days > 42) continue;
      const name = vehicleLabel(v);
      if (d.days < 0) {
        out.push({ key: `veh-${v.id}-${d.kind}`, memberId: '', icon: Car, tone: 'urgent', text: `${name}: ${d.label} overdue`, tab: 'vehicles', view: 'vehicles', date: d.date, days: d.days, sortDays: d.days });
      } else {
        out.push({ key: `veh-${v.id}-${d.kind}`, memberId: '', icon: Car, tone: 'warn', text: `${name}: ${d.label} ${d.days === 0 ? 'due today' : `in ${d.days} days`}`, tab: 'vehicles', view: 'vehicles', date: d.date, days: d.days, sortDays: d.days });
      }
    }
  }
  return out;
}

// Estate review nudges — grouped like computeAssetNudges, 'info' tone since
// this is a suggestion to go check, never a deadline. Store-and-recall only:
// this counts staleness by date, it never judges the document itself.
function computeEstateNudges(records: EstateRecord[]): Nudge[] {
  const out: Nudge[] = [];
  const stale = records.filter((r) => isReviewStale(r.lastReviewed));
  if (stale.length > 0) {
    const n = stale.length;
    out.push({
      key: 'estate-stale',
      memberId: '',
      icon: ScrollText,
      tone: 'info',
      text: `${n} estate document${n === 1 ? '' : 's'} ${n === 1 ? "hasn't" : "haven't"} been reviewed in a while`,
      tab: 'willsEstate',
      view: 'willsEstate',
    });
  }
  return out;
}

// Slip deadline nudges ("Keep the slip") — two SEPARATE clocks, never
// conflated. Return window: urgent inside 2 days, warn inside 10 — once it's
// actually lapsed there's nothing left to do, so (unlike vehicles) an overdue
// return produces NO nudge, just quiet archival (see utils/slip.ts). Warranty:
// warn inside 30 days, same "nothing once lapsed" rule (you can't file a claim
// against an expired warranty). A returned slip never nudges about its return.
export function computeSlipNudges(slips: SlipItem[]): Nudge[] {
  const out: Nudge[] = [];
  for (const s of slips) {
    const label = s.item || 'purchase';
    const shopSuffix = s.shop ? ` (${s.shop})` : '';
    if (s.returnByDate && !s.returned) {
      const days = daysUntil(s.returnByDate);
      if (days !== null && days >= 0 && days <= 10) {
        out.push({
          key: `slip-return-${s.id}`,
          memberId: '',
          icon: RotateCcw,
          tone: days <= 2 ? 'urgent' : 'warn',
          text: days === 0
            ? `Return window for “${label}”${shopSuffix} closes today`
            : `Return window for “${label}”${shopSuffix} closes in ${days} day${days === 1 ? '' : 's'}`,
          tab: 'slips',
          view: 'slips',
          date: s.returnByDate,
          days,
          sortDays: days,
        });
      }
    }
    if (s.warrantyUntil) {
      const days = daysUntil(s.warrantyUntil);
      if (days !== null && days >= 0 && days <= 30) {
        out.push({
          key: `slip-warranty-${s.id}`,
          memberId: '',
          icon: ShieldCheck,
          tone: 'warn',
          text: days === 0
            ? `Warranty on “${label}”${shopSuffix} expires today`
            : `Warranty on “${label}”${shopSuffix} expires in ${days} day${days === 1 ? '' : 's'}`,
          tab: 'slips',
          view: 'slips',
          date: s.warrantyUntil,
          days,
          sortDays: days,
        });
      }
    }
  }
  return out;
}

// Funeral cover nudges — a funeral policy lapsing because a debit order failed
// is a real and awful failure, so a lapsed one is 'urgent' regardless of its
// renewal date. Otherwise reuses the same overdue/42-day-window framing as
// vehicle deadlines. Also flags an active waiting period — not urgent, just
// worth knowing (accidental death is still covered; natural death isn't yet).
export function computeFuneralCoverNudges(policies: InsurancePolicy[]): Nudge[] {
  const out: Nudge[] = [];
  for (const p of policies) {
    if (!isFuneralPolicy(p.type)) continue;
    const label = `${p.provider || 'Funeral cover'}${p.type ? ` (${p.type})` : ''}`;
    if (p.status === 'lapsed') {
      // days: 0 — not a real countdown (a lapse has no future date to count
      // to), but chat's "expiries" heads-up (utils/chatInsights.ts) filters
      // out anything with days == null, and this is the single most urgent
      // nudge this function produces. 0 sorts it first and keeps it inside
      // any horizon, without fabricating a date this record doesn't have.
      out.push({ key: `funeral-lapsed-${p.id}`, memberId: '', icon: ShieldCheck, tone: 'urgent', text: `${label} has lapsed — check the debit order before it's needed`, tab: 'insurance', view: 'insurance', days: 0 });
    } else if (p.status !== 'cancelled' && p.renewalDate) {
      const days = daysUntil(p.renewalDate);
      if (days !== null && days < 0) {
        out.push({ key: `funeral-renewal-${p.id}`, memberId: '', icon: ShieldCheck, tone: 'urgent', text: `${label} renewal is overdue`, tab: 'insurance', view: 'insurance', date: p.renewalDate, days });
      } else if (days !== null && days <= 42) {
        out.push({ key: `funeral-renewal-${p.id}`, memberId: '', icon: ShieldCheck, tone: 'warn', text: `${label} renews in ${days} day${days === 1 ? '' : 's'}`, tab: 'insurance', view: 'insurance', date: p.renewalDate, days });
      }
    }
    if (p.status !== 'cancelled' && p.status !== 'lapsed' && inWaitingPeriod(p)) {
      const days = daysUntilWaitingPeriodEnd(p) ?? 0;
      out.push({ key: `funeral-waiting-${p.id}`, memberId: '', icon: Clock, tone: 'info', text: `${label} is still in its natural-death waiting period (${days} day${days === 1 ? '' : 's'} left) — accidental death is covered now`, tab: 'insurance', view: 'insurance' });
    }
  }
  return out;
}

// Contact birthdays — same "within 21 days" window as a family member's
// birthday nudge below, but a contact has no member profile/tab to jump to,
// so this routes to the Info view (where contacts live) instead.
/* Birthdays for people who aren't family members.
 *
 * Reads ExtendedBirthday records, NOT contacts. It used to read contacts,
 * because a contact's `birthdate` was once the only home for a non-member
 * birthday — but that home was second-class (it reached this card and the
 * "On this day" card and nothing else, never the calendar or the export), and
 * v228 moved these onto their own records. The caller merges any leftover
 * contact birthday into the same list, so nothing typed before that move
 * disappears from this card. */
function computeExtendedBirthdayNudges(extendedBirthdays: ExtendedBirthday[]): Nudge[] {
  const out: Nudge[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const eb of extendedBirthdays) {
    // A stored month-day, so the occurrence is derived rather than parsed —
    // and 29 February collapses to the 28th in an ordinary year, the same
    // convention the calendar, the .ics export and the cron all use.
    const occurrence = nameDayOccurrenceInYear(eb.date, today.getFullYear());
    if (!occurrence) continue;
    const nb = occurrence.getTime() < today.getTime()
      ? (nameDayOccurrenceInYear(eb.date, today.getFullYear() + 1) ?? occurrence)
      : occurrence;
    const days = Math.round((nb.getTime() - today.getTime()) / DAY);
    if (days >= 0 && days <= 21) {
      out.push({
        key: `extended-bday-${eb.id}`,
        memberId: '',
        icon: Cake,
        tone: 'info',
        text: days === 0 ? `It's ${eb.name}'s birthday today! 🎂` : `${eb.name}'s birthday in ${days} day${days !== 1 ? 's' : ''}`,
        tab: 'extendedBirthdays',
        view: 'extendedBirthdays',
      });
    }
  }
  return out;
}

// Space-level celebration kill switch (HubSettings.celebrationsEnabled,
// default ON) — shared by every celebratory nudge below (business
// anniversary, work anniversary, milestone anniversary). Deliberately does
// NOT gate the plain informational/deadline nudges elsewhere in this file
// (passport expiry, care schedule, etc.) — those need action, they aren't a
// celebration someone can opt out of.
function celebrationsOff(settings: HubSettings | null): boolean {
  return settings?.celebrationsEnabled === false;
}

// Business anniversary — same "within 21 days" window as a family member's
// birthday nudge below. NeedsAttention has no isBusinessSpace prop today, so
// this gates on the self-loaded spaceInfo's own `type` field instead —
// semantically the same gate as a prop would give, no prop plumbing added.
function computeBusinessAnniversaryNudge(spaceInfo: FamilyInfoDoc | null, settings: HubSettings | null): Nudge[] {
  if (!spaceInfo || spaceInfo.type !== 'business' || !spaceInfo.foundingDate) return [];
  if (celebrationsOff(settings)) return [];
  const next = nextAnniversary(spaceInfo.foundingDate);
  if (!next) return [];
  // Compare midnight-to-midnight. nextAnniversary() returns a date normalised to
  // local midnight, so measuring it against Date.now() (a wall-clock instant)
  // mixed two different reference points and rounded the day count wrong for
  // most of any given day — "anniversary today" could read as 1 day away.
  const midnightToday = new Date();
  midnightToday.setHours(0, 0, 0, 0);
  const days = Math.round((next.date.getTime() - midnightToday.getTime()) / DAY);
  if (days > 21) return [];
  const name = spaceInfo.name || 'The business';
  return [{
    key: `biz-anniversary-${next.years}`,
    memberId: '',
    icon: PartyPopper,
    tone: 'info',
    text: days <= 0 ? `${name}'s anniversary is today! 🎉` : `${name}'s anniversary in ${days} day${days !== 1 ? 's' : ''}`,
    tab: 'info',
    view: 'info',
    date: toISODate(next.date),
    days,
    sortDays: days,
  }];
}

// Work anniversaries — per-EMPLOYEE equivalent of the business-founding
// anniversary above, using the member's own `startDate` (employment start,
// added in v111 — see EditMemberModal's business-only "Start date" field).
// Same "within 21 days", same nextAnniversary() date math (it's fully
// generic — no separate helper needed), same space-level kill switch, PLUS
// the per-person `noCelebrations` opt-out ("no fuss, please" in Employee
// preferences). Never fires for a member's FIRST day (years === 0 means
// "today is their start date", not an anniversary of anything yet).
function computeWorkAnniversaryNudges(members: FamilyMember[], spaceInfo: FamilyInfoDoc | null, settings: HubSettings | null): Nudge[] {
  if (!spaceInfo || spaceInfo.type !== 'business') return [];
  if (celebrationsOff(settings)) return [];
  const out: Nudge[] = [];
  const midnightToday = new Date();
  midnightToday.setHours(0, 0, 0, 0);
  for (const m of members) {
    if (m.noCelebrations || !m.startDate) continue;
    const next = nextAnniversary(m.startDate);
    if (!next || next.years < 1) continue;
    const days = Math.round((next.date.getTime() - midnightToday.getTime()) / DAY);
    if (days > 21) continue;
    const first = m.name.split(/\s+/)[0] || m.name;
    out.push({
      key: `work-anniversary-${m.id}-${next.years}`,
      memberId: m.id,
      icon: PartyPopper,
      tone: 'info',
      text: days <= 0
        ? `${first} hits ${next.years} year${next.years === 1 ? '' : 's'} here today! 🎉`
        : `${first}'s ${ordinalYears(next.years)} work anniversary in ${days} day${days !== 1 ? 's' : ''}`,
      tab: 'overview',
      date: toISODate(next.date),
      days,
      sortDays: days,
    });
  }
  return out;
}

// Owner-defined business milestones (first customer, new location,
// certification, revenue target …) resurface on their ANNUAL anniversary,
// the same "within 21 days" convention as everything else here. Space-level
// only (no per-person opt-out — a milestone belongs to the business, not one
// person).
function computeMilestoneAnniversaryNudge(spaceInfo: FamilyInfoDoc | null, settings: HubSettings | null, milestones: BusinessMilestonesDoc | null): Nudge[] {
  if (!spaceInfo || spaceInfo.type !== 'business' || !milestones?.milestones?.length) return [];
  if (celebrationsOff(settings)) return [];
  const next = nextMilestoneAnniversary(milestones.milestones);
  if (!next) return [];
  const midnightToday = new Date();
  midnightToday.setHours(0, 0, 0, 0);
  const days = Math.round((next.date.getTime() - midnightToday.getTime()) / DAY);
  if (days > 21) return [];
  return [{
    key: `milestone-anniversary-${next.milestone.id}-${next.years}`,
    memberId: '',
    icon: Award,
    tone: 'info',
    text: days <= 0
      ? `${next.years} year${next.years === 1 ? '' : 's'} since "${next.milestone.title}" — today! 🎉`
      : `${next.years}-year anniversary of "${next.milestone.title}" in ${days} day${days !== 1 ? 's' : ''}`,
    tab: 'info',
    view: 'info',
    date: toISODate(next.date),
    days,
    sortDays: days,
  }];
}

function ordinalYears(n: number): string {
  const rem100 = n % 100;
  const suffix = (rem100 >= 11 && rem100 <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  return `${n}${suffix}`;
}

// Deterministic, data-derived nudges — no AI, no cost, no new fields.
export function computeNudges(members: FamilyMember[]): Nudge[] {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: Nudge[] = [];

  for (const m of members) {
    const first = m.name.split(/\s+/)[0] || m.name;
    const passports = [
      ...(m.passports || []),
      ...(m.passport?.passportNumber
        ? [{ country: m.passport.issuingCountry || '', number: m.passport.passportNumber, expiryDate: m.passport.expiryDate }]
        : []),
    ];

    // Passport expiry
    for (const p of passports) {
      if (!p.expiryDate) continue;
      const t = new Date(p.expiryDate).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      const days = Math.round((t - now) / DAY);
      const label = `${p.country || ''} passport`.trim();
      if (months < 0) out.push({ key: `exp-${m.id}-${p.number}`, memberId: m.id, icon: Bell, tone: 'urgent', text: `${first}'s ${label} has expired`, tab: 'ids', date: p.expiryDate, days });
      else if (months <= 9) out.push({ key: `exp-${m.id}-${p.number}`, memberId: m.id, icon: Bell, tone: 'warn', text: `${first}'s ${label} expires in ~${Math.max(1, Math.round(months))} months`, tab: 'ids', date: p.expiryDate, days });
    }

    // Has a passport number but no scan filed
    const hasPassport = passports.some((p) => p.number);
    const hasScan = (m.documents || []).some((d) => d.category === 'ID' && /passport/i.test(d.name));
    if (hasPassport && !hasScan) out.push({ key: `scan-${m.id}`, memberId: m.id, icon: FileText, tone: 'info', text: `${first} has a passport but no scan saved`, tab: 'ids' });

    // Upcoming birthday (within 21 days) → wishlist
    if (m.birthdate) {
      const bd = new Date(m.birthdate);
      if (!isNaN(bd.getTime())) {
        const nb = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
        if (nb.getTime() < today.getTime()) nb.setFullYear(today.getFullYear() + 1);
        const days = Math.round((nb.getTime() - today.getTime()) / DAY);
        // `days > 0`: this nudge opens the WISHLIST, so it is a buy-a-gift
        // prompt. On the day itself it is redundant with OnThisDay and the
        // celebration overlay, which is how one birthday got announced three
        // times on one screen.
        if (days > 0 && days <= 21) out.push({ key: `bday-${m.id}`, memberId: m.id, icon: Cake, tone: 'info', text: days === 0 ? `It's ${first}'s birthday today! 🎂` : `${first}'s birthday in ${days} day${days !== 1 ? 's' : ''}`, tab: 'favorites', date: toISODate(nb), days });
      }
    }

    // Birthday photo for the growing-up timelapse — prompt around the birthday
    // (±30 days) when this year's photo hasn't been added yet.
    const photoNudge = birthdayPhotoNudge(m, now);
    if (photoNudge) out.push({ key: `bphoto-${m.id}-${photoNudge.year}`, memberId: m.id, icon: Camera, tone: 'info', text: `Add ${first}'s ${photoNudge.year} birthday photo`, tab: 'timelapse' });

    // Growth check for children (>6 months since last, or never)
    if (m.role === 'Child') {
      const times = (m.growthHistory || []).map((l) => new Date(l.date).getTime()).filter((t) => !isNaN(t));
      const last = times.length ? Math.max(...times) : 0;
      const monthsSince = last ? (now - last) / MONTH : Infinity;
      if (monthsSince > 6) {
        // "Due" date for the calendar-dates view = 6 months after the last check —
        // the same threshold that triggers this nudge, just expressed as a date.
        // No `last` (never measured) → no natural date, left undefined.
        const dueDate = last ? new Date(last + 6 * MONTH) : null;
        out.push({
          key: `grow-${m.id}`,
          memberId: m.id,
          icon: Ruler,
          tone: 'info',
          text: last ? `${first} was last measured ${Math.round(monthsSince)} months ago — measure again?` : `No growth checks for ${first} yet`,
          tab: 'growth',
          date: dueDate ? toISODate(dueDate) : undefined,
          days: dueDate ? Math.round((dueDate.getTime() - now) / DAY) : undefined,
        });
      }
    }

    // Clothing sizes not updated in a while, scaled by age — see
    // utils/sizeStaleness.ts (1-year-old outgrows clothes far faster than a
    // 40-year-old). Only meaningful for a member who HAS a birthdate; skips
    // anyone without one rather than guessing an age band.
    if (m.birthdate) {
      const staleness = sizeStaleness(m.clothingSizes, m.birthdate, todayISO());
      if (staleness.stale) {
        out.push({
          key: `sizes-stale-${m.id}`,
          memberId: m.id,
          icon: Shirt,
          tone: 'info',
          text: staleness.monthsSince != null
            ? `${first}'s sizes were last updated ${staleness.monthsSince} month${staleness.monthsSince === 1 ? '' : 's'} ago — worth checking`
            : `${first}'s sizes have never been updated — worth checking`,
          tab: 'sizes',
        });
      }
    }

    // Missing medical basics
    const med = m.medical || {};
    if (!med.bloodGroup && !med.allergies && !med.conditions) out.push({ key: `med-${m.id}`, memberId: m.id, icon: HeartPulse, tone: 'info', text: `No medical info for ${first} yet`, tab: 'medical' });

    // Care schedule (dentist, check-ups, vaccinations …) due or overdue
    for (const item of m.careSchedule || []) {
      const due = careNextDue(item, now);
      const dueDate = due.date ? toISODate(due.date) : undefined;
      const dueDays = due.date ? Math.round((due.date.getTime() - now) / DAY) : undefined;
      if (due.status === 'overdue') out.push({ key: `care-${m.id}-${item.id}`, memberId: m.id, icon: Stethoscope, tone: 'urgent', text: `${first}'s ${item.kind} is overdue`, tab: 'care', date: dueDate, days: dueDays, sortDays: dueDays });
      else if (due.status === 'due-soon') out.push({ key: `care-${m.id}-${item.id}`, memberId: m.id, icon: Stethoscope, tone: 'warn', text: `${first}'s ${item.kind} is due soon`, tab: 'care', date: dueDate, days: dueDays, sortDays: dueDays });
    }

    // Referrals still sitting on "open" — a referral you never booked is the
    // exact thing the open/booked/done marker exists to catch, and the one most
    // likely to be quietly forgotten (it arrives as a piece of paper on a day
    // you're already busy). Only referrals that ASK for an appointment count;
    // a lab result or a sick note has nothing to book, so it never nags.
    for (const r of m.referrals || []) {
      if (r.status !== 'open' || !r.date) continue;
      if (r.kind === 'Lab result' || r.kind === 'Sick note') continue;
      const d = daysUntil(r.date);
      if (d === null) continue;
      const age = -d; // days SINCE the referral was written
      const what = r.reason ? `${r.kind.toLowerCase()} for ${r.reason}` : r.kind.toLowerCase();
      if (age >= 42) {
        out.push({ key: `ref-${m.id}-${r.id}`, memberId: m.id, icon: Stethoscope, tone: 'urgent', text: `${first}'s ${what} still isn't booked — ${Math.round(age / 7)} weeks now`, tab: 'medical', date: r.date, days: d });
      } else if (age >= 14) {
        out.push({ key: `ref-${m.id}-${r.id}`, memberId: m.id, icon: Stethoscope, tone: 'warn', text: `${first}'s ${what} isn't booked yet`, tab: 'medical', date: r.date, days: d });
      }
    }

    // Transit pass expiry (Jahreskarte, Klimaticket, rail passes …)
    for (const pass of m.travel?.transitPasses || []) {
      if (!pass.validUntil) continue;
      const t = new Date(pass.validUntil).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      const days = Math.round((t - now) / DAY);
      if (months < 0) out.push({ key: `pass-${m.id}-${pass.id}`, memberId: m.id, icon: TrainFront, tone: 'urgent', text: `${first}'s ${pass.name} has expired`, tab: 'travel', date: pass.validUntil, days });
      else if (months <= 1.5) out.push({ key: `pass-${m.id}-${pass.id}`, memberId: m.id, icon: TrainFront, tone: 'warn', text: `${first}'s ${pass.name} expires soon`, tab: 'travel', date: pass.validUntil, days });
    }

    // Residence permit & driver's licence expiry
    const idExpiries: Array<{ key: string; expiry?: string; label: string }> = [
      { key: 'permit', expiry: m.identity?.residencePermitExpiry, label: 'residence permit' },
      { key: 'license', expiry: m.identity?.driversLicenseExpiry, label: "driver's licence" },
    ];
    for (const { key, expiry, label } of idExpiries) {
      if (!expiry) continue;
      const t = new Date(expiry).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      const days = Math.round((t - now) / DAY);
      if (months < 0) out.push({ key: `id-${m.id}-${key}`, memberId: m.id, icon: IdCard, tone: 'urgent', text: `${first}'s ${label} has expired`, tab: 'ids', date: expiry, days });
      else if (months <= 2) out.push({ key: `id-${m.id}-${key}`, memberId: m.id, icon: IdCard, tone: 'warn', text: `${first}'s ${label} expires soon`, tab: 'ids', date: expiry, days });
    }

    // Visa expiry
    for (const visa of m.travel?.visas || []) {
      if (!visa.expiryDate) continue;
      const t = new Date(visa.expiryDate).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      const days = Math.round((t - now) / DAY);
      if (months < 0) out.push({ key: `visa-${m.id}-${visa.id}`, memberId: m.id, icon: Bell, tone: 'urgent', text: `${first}'s ${visa.country} visa has expired`, tab: 'travel', date: visa.expiryDate, days });
      else if (months <= 2) out.push({ key: `visa-${m.id}-${visa.id}`, memberId: m.id, icon: Bell, tone: 'warn', text: `${first}'s ${visa.country} visa expires soon`, tab: 'travel', date: visa.expiryDate, days });
    }

    // CV qualification/certificate expiry (first-aid certs, driving-licence
    // categories, professional registrations …) — business spaces only in
    // practice, since the 'cv' tab is hidden in family spaces, but this loop
    // is harmless either way as it only fires when data is actually present.
    for (const q of m.cv?.qualifications || []) {
      if (!q.expiryDate) continue;
      const t = new Date(q.expiryDate).getTime();
      if (isNaN(t)) continue;
      const months = (t - now) / MONTH;
      const days = Math.round((t - now) / DAY);
      if (months < 0) out.push({ key: `cvqual-${m.id}-${q.id}`, memberId: m.id, icon: Award, tone: 'urgent', text: `${first}'s ${q.name} has expired`, tab: 'cv', date: q.expiryDate, days });
      else if (months <= 2) out.push({ key: `cvqual-${m.id}-${q.id}`, memberId: m.id, icon: Award, tone: 'warn', text: `${first}'s ${q.name} expires soon`, tab: 'cv', date: q.expiryDate, days });
    }
  }

  return out.sort(byUrgency);
}

const TONE_STYLE: Record<Tone, string> = {
  urgent: 'bg-rosa-100 text-rosa-700',
  warn: 'bg-honey-100 text-honey-700',
  info: 'bg-cream-200 text-ink-500',
};

export default function NeedsAttention(
  { members, extendedBirthdays, onGo, onGoView }:
  { members: FamilyMember[]; extendedBirthdays?: ExtendedBirthday[]; onGo: (memberId: string, tab: string) => void; onGoView?: (view: string) => void },
) {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [spaceInfo, setSpaceInfo] = useState<FamilyInfoDoc | null>(null);
  const [estateRecords, setEstateRecords] = useState<EstateRecord[]>([]);
  const [slips, setSlips] = useState<SlipItem[]>([]);
  const [settings, setSettings] = useState<HubSettings | null>(null);
  const [milestones, setMilestones] = useState<BusinessMilestonesDoc | null>(null);
  const [insurancePolicies, setInsurancePolicies] = useState<InsurancePolicy[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadAssets()
      .then((a) => { if (!cancelled) setAssets(a || []); })
      .catch(() => { if (!cancelled) setAssets([]); });
    loadHousehold()
      .then((h) => { if (!cancelled) setVehicles(h?.vehicles || []); })
      .catch(() => { if (!cancelled) setVehicles([]); });
    loadSpaceInfo()
      .then((s) => { if (!cancelled) setSpaceInfo(s); })
      .catch(() => { if (!cancelled) setSpaceInfo(null); });
    loadWillsEstate()
      .then((d) => { if (!cancelled) setEstateRecords(d?.records || []); })
      .catch(() => { if (!cancelled) setEstateRecords([]); });
    loadSlips()
      .then((s) => { if (!cancelled) setSlips(s || []); })
      .catch(() => { if (!cancelled) setSlips([]); });
    loadSettings()
      .then((s) => { if (!cancelled) setSettings(s); })
      .catch(() => { if (!cancelled) setSettings(null); });
    loadBusinessMilestones()
      .then((m) => { if (!cancelled) setMilestones(m); })
      .catch(() => { if (!cancelled) setMilestones(null); });
    loadFinances()
      .then((f) => { if (!cancelled) setInsurancePolicies(f?.insurance || []); })
      .catch(() => { if (!cancelled) setInsurancePolicies([]); });
    return () => { cancelled = true; };
  }, []);

  const [showAll, setShowAll] = useState(false);

  /* Fully collapsed — header only. This card sits at the top of the home
     screen and can be a dozen rows deep, so on a phone it pushes everything
     else below the fold. Folding it leaves the count visible, which is the
     part you actually scan for. Remembered per device. */
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('teluva.needsAttentionCollapsed') === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    try { localStorage.setItem('teluva.needsAttentionCollapsed', next ? '1' : '0'); } catch { /* private mode */ }
    setCollapsed(next);
  };


  const all = [
    ...computeNudges(members),
    ...computeExtendedBirthdayNudges(extendedBirthdays || []),
    ...computeVehicleNudges(vehicles),
    ...computeAssetNudges(assets),
    ...computeBusinessAnniversaryNudge(spaceInfo, settings),
    ...computeWorkAnniversaryNudges(members, spaceInfo, settings),
    ...computeMilestoneAnniversaryNudge(spaceInfo, settings, milestones),
    ...computeEstateNudges(estateRecords),
    ...computeSlipNudges(slips),
    ...computeFuneralCoverNudges(insurancePolicies),
  ].sort(byUrgency);
  if (all.length === 0) return null;
  const COLLAPSED = 6;
  const shown = showAll ? all : all.slice(0, COLLAPSED);
  const extra = all.length - COLLAPSED;

  return (
    <div className="card overflow-hidden">
      {/* The whole header is the toggle — a title bar that folds the card is a
          bigger, more obvious target than a chevron parked in the corner. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        title={collapsed ? 'Show what needs attention' : 'Collapse'}
        className={`w-full px-5 py-3.5 flex items-center gap-2 text-left transition-colors hover:bg-cream-50 cursor-pointer ${collapsed ? '' : 'border-b border-cream-200'}`}
      >
        <Sparkles className="w-4 h-4 text-clay-500 shrink-0" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">Needs attention</h3>
        <span className="chip bg-cream-200 text-ink-600 ml-auto">{all.length}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-ink-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>

      <div className={`divide-y divide-cream-100 ${collapsed ? 'hidden' : ''}`}>
        {shown.map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.key}
              onClick={() => (n.view ? onGoView?.(n.view) : onGo(n.memberId, n.tab))}
              className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-cream-50 transition-colors cursor-pointer group"
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${TONE_STYLE[n.tone]}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="flex-1 text-[13.5px] text-ink-800 font-medium">{n.text}</span>
              <ChevronRight className="w-4 h-4 text-ink-300 group-hover:text-ink-500 shrink-0" />
            </button>
          );
        })}
      </div>
      {extra > 0 && !collapsed && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="w-full px-5 py-2.5 text-[12.5px] font-semibold text-clay-600 hover:bg-cream-50 transition-colors text-center cursor-pointer"
        >
          {showAll ? 'Show less' : `Show all ${all.length}`}
        </button>
      )}
    </div>
  );
}
