import { useState, useEffect, type ElementType } from 'react';
import { Bell, Cake, Ruler, FileText, HeartPulse, ChevronRight, Sparkles, Stethoscope, TrainFront, IdCard, Camera, Package, Car, Award, PartyPopper, ScrollText, RotateCcw, ShieldCheck, Shirt } from 'lucide-react';
import { FamilyMember, AssetItem, Vehicle, ContactEntry, FamilyInfoDoc, EstateRecord, SlipItem, HubSettings, BusinessMilestonesDoc } from '../types';
import { careNextDue } from '../utils/care';
import { loadAssets, loadHousehold, loadSpaceInfo, loadWillsEstate, loadSlips, loadSettings, loadBusinessMilestones } from '../utils/db';
import { vehicleDeadlines, vehicleLabel, daysUntil } from '../utils/vehicle';
import { birthdayPhotoNudge } from '../utils/birthday';
import { nextAnniversary, nextMilestoneAnniversary } from '../utils/businessMilestone';
import { isReviewStale } from '../utils/willsEstate';
import { sizeStaleness } from '../utils/sizeStaleness';
import { todayISO } from '../utils/age';

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
        out.push({ key: `veh-${v.id}-${d.kind}`, memberId: '', icon: Car, tone: 'urgent', text: `${name}: ${d.label} overdue`, tab: 'vehicles', view: 'vehicles', date: d.date, days: d.days });
      } else {
        out.push({ key: `veh-${v.id}-${d.kind}`, memberId: '', icon: Car, tone: 'warn', text: `${name}: ${d.label} ${d.days === 0 ? 'due today' : `in ${d.days} days`}`, tab: 'vehicles', view: 'vehicles', date: d.date, days: d.days });
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
        });
      }
    }
  }
  return out;
}

// Contact birthdays — same "within 21 days" window as a family member's
// birthday nudge below, but a contact has no member profile/tab to jump to,
// so this routes to the Info view (where contacts live) instead.
function computeContactNudges(contacts: ContactEntry[]): Nudge[] {
  const out: Nudge[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const c of contacts) {
    if (!c.birthdate) continue;
    const bd = new Date(c.birthdate);
    if (isNaN(bd.getTime())) continue;
    const nb = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
    if (nb.getTime() < today.getTime()) nb.setFullYear(today.getFullYear() + 1);
    const days = Math.round((nb.getTime() - today.getTime()) / DAY);
    if (days <= 21) {
      out.push({
        key: `contact-bday-${c.id}`,
        memberId: '',
        icon: Cake,
        tone: 'info',
        text: days === 0 ? `It's ${c.name}'s birthday today! 🎂` : `${c.name}'s birthday in ${days} day${days !== 1 ? 's' : ''}`,
        tab: 'info',
        view: 'info',
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
        if (days <= 21) out.push({ key: `bday-${m.id}`, memberId: m.id, icon: Cake, tone: 'info', text: days === 0 ? `It's ${first}'s birthday today! 🎂` : `${first}'s birthday in ${days} day${days !== 1 ? 's' : ''}`, tab: 'favorites', date: toISODate(nb), days });
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
      if (due.status === 'overdue') out.push({ key: `care-${m.id}-${item.id}`, memberId: m.id, icon: Stethoscope, tone: 'urgent', text: `${first}'s ${item.kind} is overdue`, tab: 'care', date: dueDate, days: dueDays });
      else if (due.status === 'due-soon') out.push({ key: `care-${m.id}-${item.id}`, memberId: m.id, icon: Stethoscope, tone: 'warn', text: `${first}'s ${item.kind} is due soon`, tab: 'care', date: dueDate, days: dueDays });
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

  const order: Record<Tone, number> = { urgent: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

const TONE_STYLE: Record<Tone, string> = {
  urgent: 'bg-rosa-100 text-rosa-700',
  warn: 'bg-honey-100 text-honey-700',
  info: 'bg-cream-200 text-ink-500',
};

export default function NeedsAttention(
  { members, contacts, onGo, onGoView }:
  { members: FamilyMember[]; contacts?: ContactEntry[]; onGo: (memberId: string, tab: string) => void; onGoView?: (view: string) => void },
) {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [spaceInfo, setSpaceInfo] = useState<FamilyInfoDoc | null>(null);
  const [estateRecords, setEstateRecords] = useState<EstateRecord[]>([]);
  const [slips, setSlips] = useState<SlipItem[]>([]);
  const [settings, setSettings] = useState<HubSettings | null>(null);
  const [milestones, setMilestones] = useState<BusinessMilestonesDoc | null>(null);
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
    return () => { cancelled = true; };
  }, []);

  const [showAll, setShowAll] = useState(false);

  const order: Record<Tone, number> = { urgent: 0, warn: 1, info: 2 };
  const all = [
    ...computeNudges(members),
    ...computeContactNudges(contacts || []),
    ...computeVehicleNudges(vehicles),
    ...computeAssetNudges(assets),
    ...computeBusinessAnniversaryNudge(spaceInfo, settings),
    ...computeWorkAnniversaryNudges(members, spaceInfo, settings),
    ...computeMilestoneAnniversaryNudge(spaceInfo, settings, milestones),
    ...computeEstateNudges(estateRecords),
    ...computeSlipNudges(slips),
  ].sort((a, b) => order[a.tone] - order[b.tone]);
  if (all.length === 0) return null;
  const COLLAPSED = 6;
  const shown = showAll ? all : all.slice(0, COLLAPSED);
  const extra = all.length - COLLAPSED;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-cream-200 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-clay-500" />
        <h3 className="font-display text-[15px] font-bold text-ink-900">Needs attention</h3>
        <span className="chip bg-cream-200 text-ink-600 ml-auto">{all.length}</span>
      </div>
      <div className="divide-y divide-cream-100">
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
      {extra > 0 && (
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
