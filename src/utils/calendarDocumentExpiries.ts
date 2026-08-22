// Travel-document dates shown on the Family calendar. This reads the member
// record directly — never a calendar_event that may have been generated from
// an old scan — so replacing a passport or correcting a permit updates the
// watch immediately without leaving a stale reminder behind.
import type { FamilyMember } from '../types';
import { PASSPORT_WARN_MONTHS } from './readiness';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30.4375 * DAY_MS;

export type DocumentExpiryKind = 'Passport' | 'Visa / permit' | 'Residence permit';
export type DocumentExpiryStatus = 'expired' | 'soon' | 'later';

export interface CalendarDocumentExpiry {
  id: string;
  memberId: string;
  memberName: string;
  kind: DocumentExpiryKind;
  label: string;
  expiryDate: string;
  daysRemaining: number;
  monthsRemaining: number;
  status: DocumentExpiryStatus;
  renewalStartDate: string;
  renewalLeadMonths: number;
  renewalDue: boolean;
}

function dateOnlyMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  // Date normalises impossible input (2026-02-31 → March) instead of
  // rejecting it. Round-trip the parts so a corrupt stored date never becomes
  // a confident warning for a different day.
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) return null;
  return parsed.getTime();
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Subtract whole calendar months without allowing 31 March to roll into March. */
export function subtractCalendarMonths(value: string, months: number): string | null {
  const parsed = dateOnlyMs(value);
  if (parsed === null) return null;
  const date = new Date(parsed);
  const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return isoDate(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

/** Conservative planning defaults, clearly presented as guidance in the UI. */
export function renewalLeadMonths(kind: DocumentExpiryKind): number {
  return kind === 'Passport' ? 9 : 6;
}

/**
 * Every passport, visa/work permit and residence-card date on the family
 * records, nearest first. Legacy single-passport records are folded in only
 * when their number is not already represented in passports[], matching the
 * compatibility rule used by MemberIDs without exposing that number here.
 */
export function buildCalendarDocumentExpiries(
  members: readonly FamilyMember[],
  now: Date = new Date(),
): CalendarDocumentExpiry[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const out: CalendarDocumentExpiry[] = [];

  const add = (
    member: FamilyMember,
    id: string,
    kind: DocumentExpiryKind,
    label: string,
    expiryDate?: string,
  ) => {
    if (!expiryDate) return;
    const expiryMs = dateOnlyMs(expiryDate);
    if (expiryMs === null) return;
    const daysRemaining = Math.round((expiryMs - today.getTime()) / DAY_MS);
    const monthsRemaining = (expiryMs - today.getTime()) / MONTH_MS;
    const leadMonths = renewalLeadMonths(kind);
    const renewalStartDate = subtractCalendarMonths(expiryDate, leadMonths)!;
    out.push({
      id,
      memberId: member.id,
      memberName: member.name,
      kind,
      label,
      expiryDate,
      daysRemaining,
      monthsRemaining,
      status: daysRemaining < 0
        ? 'expired'
        : monthsRemaining <= PASSPORT_WARN_MONTHS ? 'soon' : 'later',
      renewalStartDate,
      renewalLeadMonths: leadMonths,
      renewalDue: dateOnlyMs(renewalStartDate)! <= today.getTime(),
    });
  };

  for (const member of members) {
    const pluralPassports = member.passports || [];
    for (const passport of pluralPassports) {
      add(
        member,
        `passport-${member.id}-${passport.id}`,
        'Passport',
        `${passport.country || ''} passport`.trim() || 'Passport',
        passport.expiryDate,
      );
    }

    const legacy = member.passport;
    if (legacy?.passportNumber && !pluralPassports.some((p) => p.number === legacy.passportNumber)) {
      add(
        member,
        `passport-${member.id}-legacy`,
        'Passport',
        `${legacy.issuingCountry || ''} passport`.trim() || 'Passport',
        legacy.expiryDate,
      );
    }

    for (const visa of member.travel?.visas || []) {
      const permit = visa.permitType?.trim();
      add(
        member,
        `visa-${member.id}-${visa.id}`,
        'Visa / permit',
        permit
          ? `${visa.country ? `${visa.country} ` : ''}${permit}`
          : `${visa.country || ''} visa`.trim() || 'Visa / permit',
        visa.expiryDate,
      );
    }

    add(
      member,
      `residence-${member.id}`,
      'Residence permit',
      'Residence permit',
      member.identity?.residencePermitExpiry,
    );
  }

  return out.sort((a, b) =>
    a.expiryDate.localeCompare(b.expiryDate)
    || firstName(a.memberName).localeCompare(firstName(b.memberName))
    || a.label.localeCompare(b.label));
}

export function documentRenewalLabel(expiry: CalendarDocumentExpiry): string {
  if (expiry.status === 'expired') return 'Renew now';
  if (expiry.renewalDue) return 'Start renewal now';
  return `Start renewal by ${expiry.renewalStartDate}`;
}

export function documentExpiryStatusLabel(expiry: CalendarDocumentExpiry): string {
  if (expiry.status === 'expired') return 'Expired';
  if (expiry.daysRemaining === 0) return 'Expires today';
  if (expiry.status === 'soon') {
    const months = Math.max(1, Math.round(expiry.monthsRemaining));
    return `Expires in ~${months} month${months === 1 ? '' : 's'}`;
  }
  return 'Current';
}
