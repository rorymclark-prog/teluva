// Pure helpers for the per-member care schedule (recurring dentist / check-up /
// eye test …). No AI, no cost — we store "last visit + interval" and derive the
// next-due date, then colour it. Shared by NeedsAttention, MemberOverview and
// the CareSchedule editor so the "next due" logic lives in exactly one place.
import { CareKind, CareSchedule } from '../types';

const MONTH = 1000 * 60 * 60 * 24 * 30.4375;

// Preset recurring appointment types with sensible default intervals (months).
export const CARE_KINDS: { kind: CareKind; defaultInterval: number }[] = [
  { kind: 'Dental check-up', defaultInterval: 6 },
  { kind: 'Medical check-up', defaultInterval: 12 },
  { kind: 'Eye test', defaultInterval: 24 },
  { kind: 'Vaccination / booster', defaultInterval: 12 },
  { kind: 'Specialist review', defaultInterval: 12 },
  { kind: 'Skin check', defaultInterval: 12 },
  { kind: 'Other', defaultInterval: 12 },
];

export type CareStatus = 'overdue' | 'due-soon' | 'ok' | 'unknown';

export interface CareDue {
  date: Date | null;
  status: CareStatus;
  monthsUntil: number | null;   // negative = overdue
}

// Explicit nextDue wins; otherwise lastVisit + intervalMonths. "due-soon" fires
// within ~6 weeks so there's time to actually book the appointment.
export function careNextDue(item: CareSchedule, now: number = Date.now()): CareDue {
  let date: Date | null = null;

  if (item.nextDue) {
    const d = new Date(item.nextDue);
    if (!isNaN(d.getTime())) date = d;
  }
  if (!date && item.lastVisit && item.intervalMonths > 0) {
    const base = new Date(item.lastVisit);
    if (!isNaN(base.getTime())) {
      const d = new Date(base);
      d.setMonth(d.getMonth() + item.intervalMonths);
      date = d;
    }
  }

  if (!date) return { date: null, status: 'unknown', monthsUntil: null };

  const monthsUntil = (date.getTime() - now) / MONTH;
  const status: CareStatus = monthsUntil < 0 ? 'overdue' : monthsUntil <= 1.5 ? 'due-soon' : 'ok';
  return { date, status, monthsUntil };
}

// A short human label for how soon a care item is due ("overdue", "due in 3 weeks").
export function careDueLabel(due: CareDue): string {
  if (due.status === 'unknown' || due.date == null || due.monthsUntil == null) return 'No date yet';
  if (due.status === 'overdue') {
    const daysOver = Math.round((-due.monthsUntil) * 30.4375);
    if (daysOver <= 31) return 'Overdue';
    const months = Math.round(-due.monthsUntil);
    return `Overdue by ~${months} month${months !== 1 ? 's' : ''}`;
  }
  const days = Math.round(due.monthsUntil * 30.4375);
  if (days <= 0) return 'Due today';
  if (days <= 31) return `Due in ${days} day${days !== 1 ? 's' : ''}`;
  const months = Math.round(due.monthsUntil);
  return `Due in ~${months} month${months !== 1 ? 's' : ''}`;
}

// The soonest-due (or most overdue) schedule for a member — used for the
// Overview "Next up" line. Items without a derivable date sort last.
export function soonestCare(
  items: CareSchedule[] | undefined,
  now: number = Date.now(),
): { item: CareSchedule; due: CareDue } | null {
  if (!items || items.length === 0) return null;
  const dated = items
    .map((item) => ({ item, due: careNextDue(item, now) }))
    .filter((x) => x.due.date != null)
    .sort((a, b) => a.due.date!.getTime() - b.due.date!.getTime());
  return dated[0] || null;
}
