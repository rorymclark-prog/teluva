import type { FamilyAction, FamilyActionsDoc, FamilyMember } from '../types';

const DAY_MS = 86_400_000;
export const ACTION_SUGGESTION_DAYS = 90;
export const ACTION_DUE_SOON_DAYS = 7;

/** Display/assignment data only. This is never a profile access grant. */
export interface ActionPerson { id: string; name: string }
export type ActionDirectoryStatus = 'loading' | 'ready' | 'unavailable';

export function actionPeople(profiles: readonly ActionPerson[], directory: readonly ActionPerson[] = []): ActionPerson[] {
  const people = new Map<string, ActionPerson>();
  for (const person of [...directory, ...profiles]) {
    if (typeof person?.id === 'string' && person.id && typeof person.name === 'string' && person.name.trim()) {
      // Pick just the public fields even when a caller hands in a full profile.
      people.set(person.id, { id: person.id, name: person.name.trim() });
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function actionOwnerName(action: FamilyAction, people: readonly ActionPerson[], business = false, directoryAvailable = true): string {
  if (!action.ownerMemberId) return 'Unassigned';
  return people.find(person => person.id === action.ownerMemberId)?.name
    || (business ? directoryAvailable ? 'Previous team member' : 'Assigned teammate' : 'Previous member');
}

export function actionOwnerFilterPeople(people: readonly ActionPerson[], actions: readonly FamilyAction[], business = false, directoryAvailable = true): ActionPerson[] {
  const missing = actions.filter(action => action.ownerMemberId && !people.some(person => person.id === action.ownerMemberId))
    .map(action => ({ id: action.ownerMemberId!, name: actionOwnerName(action, people, business, directoryAvailable) }));
  return actionPeople(people, missing);
}

/** Directory presence permits assigning work, not opening somebody's HR file. */
export function actionSourceAvailable(action: FamilyAction, loadedProfiles: readonly Pick<FamilyMember, 'id'>[]): boolean {
  return !!action.source && (!action.source.memberId || loadedProfiles.some(person => person.id === action.source!.memberId));
}

export interface ActionSuggestion {
  key: string;
  title: string;
  notes?: string;
  dueDate?: string;
  source: NonNullable<FamilyAction['source']>;
  daysUntilDue: number | null;
}

export interface ActionFilters {
  status?: 'all' | 'open' | 'done';
  /** Empty means everyone; "unassigned" selects actions without an owner. */
  ownerMemberId?: string;
  search?: string;
  due?: 'all' | 'overdue' | 'soon' | 'undated';
}

export function actionDateISO(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** UTC ordinals of local calendar dates avoid DST and time-of-day rounding. */
function dateOrdinal(value?: string): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime() / DAY_MS;
}

/** Backups are external JSON, so validate before restoring them into the live
 * worklist. Unknown optional fields are tolerated for forward compatibility. */
export function isFamilyActionsDoc(value: unknown): value is FamilyActionsDoc {
  if (!value || typeof value !== 'object' || !Array.isArray((value as FamilyActionsDoc).items)) return false;
  const items = (value as FamilyActionsDoc).items;
  const ids = new Set<string>();
  const optionalString = (item: Record<string, unknown>, key: string) => item[key] === undefined || typeof item[key] === 'string';
  const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  return items.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) return false;
    ids.add(item.id);
    if (typeof item.title !== 'string' || !item.title.trim() || !['open', 'done'].includes(item.status)) return false;
    if (!timestamp(item.createdAt) || !timestamp(item.updatedAt)) return false;
    if (!['notes', 'ownerMemberId', 'dueDate', 'completedAt'].every(key => optionalString(item as unknown as Record<string, unknown>, key))) return false;
    if (item.dueDate && dateOrdinal(item.dueDate) === null) return false;
    if (item.completedAt && !timestamp(item.completedAt)) return false;
    if (item.source !== undefined) {
      const source = item.source;
      if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
      if (typeof source.key !== 'string' || !source.key || typeof source.label !== 'string' || !source.label.trim()) return false;
      if (!['memberId', 'tab', 'view'].every(key => optionalString(source, key))) return false;
    }
    return true;
  });
}

export function actionDaysUntil(dueDate?: string, now = new Date()): number | null {
  const due = dateOrdinal(dueDate);
  const today = dateOrdinal(actionDateISO(now));
  return due === null || today === null ? null : due - today;
}

/** Open work first; dated work before undated. Never mutates a live snapshot. */
export function sortActions(items: readonly FamilyAction[]): FamilyAction[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'done') {
      const completed = (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt);
      if (completed) return completed;
    }
    const dateDifference = (dateOrdinal(a.dueDate) ?? Infinity) - (dateOrdinal(b.dueDate) ?? Infinity);
    return (Number.isNaN(dateDifference) ? 0 : dateDifference)
      || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

export function filterActions(items: readonly FamilyAction[], filters: ActionFilters = {}, now = new Date()): FamilyAction[] {
  const query = filters.search?.trim().toLocaleLowerCase();
  return sortActions(items.filter(item => {
    if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false;
    if (filters.ownerMemberId === 'unassigned' ? !!item.ownerMemberId
      : filters.ownerMemberId && item.ownerMemberId !== filters.ownerMemberId) return false;
    if (query && !`${item.title} ${item.notes || ''} ${item.source?.label || ''}`.toLocaleLowerCase().includes(query)) return false;
    const days = actionDaysUntil(item.dueDate, now);
    if (filters.due === 'overdue' && (item.status !== 'open' || days === null || days >= 0)) return false;
    if (filters.due === 'soon' && (item.status !== 'open' || days === null || days < 0 || days > ACTION_DUE_SOON_DAYS)) return false;
    if (filters.due === 'undated' && days !== null) return false;
    return true;
  }));
}

export function actionCounts(items: readonly FamilyAction[], now = new Date()) {
  const open = items.filter(item => item.status === 'open');
  return {
    open: open.length,
    done: items.filter(item => item.status === 'done').length,
    overdue: open.filter(item => { const days = actionDaysUntil(item.dueDate, now); return days !== null && days < 0; }).length,
    dueSoon: open.filter(item => { const days = actionDaysUntil(item.dueDate, now); return days !== null && days >= 0 && days <= ACTION_DUE_SOON_DAYS; }).length,
    undated: open.filter(item => actionDaysUntil(item.dueDate, now) === null).length,
  };
}

export function setActionStatus(action: FamilyAction, status: FamilyAction['status'], now = new Date()): FamilyAction {
  if (action.status === status) return { ...action };
  const updated = { ...action, status, updatedAt: now.toISOString() };
  if (status === 'done') updated.completedAt = updated.updatedAt;
  else delete updated.completedAt;
  return updated;
}

export function createActionFromSuggestion(suggestion: ActionSuggestion, options: {
  id: string; ownerMemberId?: string; now?: Date;
}): FamilyAction {
  const timestamp = (options.now || new Date()).toISOString();
  return {
    id: options.id, title: suggestion.title, status: 'open',
    createdAt: timestamp, updatedAt: timestamp,
    ...(suggestion.notes ? { notes: suggestion.notes } : {}),
    ...(suggestion.dueDate ? { dueDate: suggestion.dueDate } : {}),
    ...(options.ownerMemberId ? { ownerMemberId: options.ownerMemberId } : {}),
    source: { ...suggestion.source },
  };
}

/**
 * Suggestions are a read-only projection, never automatic writes. Stable
 * source keys include the recorded expiry so completion suppresses this cycle,
 * while a renewed document can produce a fresh action next time it is due.
 * Titles/keys never copy identity numbers, provider names or medical reasons.
 */
export function buildActionSuggestions(members: readonly FamilyMember[], existingActions: readonly FamilyAction[] = [], now = new Date()): ActionSuggestion[] {
  const tracked = new Set(existingActions.flatMap(action => action.source ? [action.source.key] : []));
  const suggestions = new Map<string, ActionSuggestion>();
  const addExpiry = (member: FamilyMember, recordKey: string, label: string, tab: string, expiryDate?: string) => {
    const days = actionDaysUntil(expiryDate, now);
    if (days === null || days > ACTION_SUGGESTION_DAYS) return;
    const key = `${member.id}:${recordKey}:${expiryDate}`;
    if (tracked.has(key)) return;
    suggestions.set(key, {
      key, title: `Renew ${member.name}'s ${label}`, dueDate: expiryDate,
      notes: 'Check the source record and arrange the next step. Completing this action does not update the record.',
      source: { key, label, memberId: member.id, tab }, daysUntilDue: days,
    });
  };

  for (const member of members) {
    const passports = member.passports || [];
    for (const passport of passports) addExpiry(member, `passport:${passport.id}`, `${passport.country ? `${passport.country} ` : ''}passport`, 'ids', passport.expiryDate);
    const legacy = member.passport;
    if (legacy?.passportNumber && !passports.some(passport => passport.number === legacy.passportNumber)) {
      addExpiry(member, 'passport:legacy', `${legacy.issuingCountry ? `${legacy.issuingCountry} ` : ''}passport`, 'ids', legacy.expiryDate);
    }
    addExpiry(member, 'residence-permit', 'residence permit', 'ids', member.identity?.residencePermitExpiry);
    addExpiry(member, 'drivers-license', "driver's licence", 'ids', member.identity?.driversLicenseExpiry);
    for (const visa of member.travel?.visas || []) {
      if (visa.status !== 'pending') addExpiry(member, `visa:${visa.id}`, `${visa.country ? `${visa.country} ` : ''}visa / permit`, 'travel', visa.expiryDate);
    }
    for (const pass of member.travel?.transitPasses || []) addExpiry(member, `transit:${pass.id}`, pass.name || 'transit pass', 'travel', pass.validUntil);
    for (const qualification of member.education?.qualifications || []) addExpiry(member, `education:${qualification.id}`, qualification.name || 'qualification', 'education', qualification.expiryDate);
    for (const qualification of member.cv?.qualifications || []) addExpiry(member, `cv:${qualification.id}`, qualification.name || 'qualification', 'cv', qualification.expiryDate);

    for (const referral of member.referrals || []) {
      // A result, letter or sick note does not itself establish a booking need.
      // An absent status means "open" in the existing referral data model.
      if ((referral.status || 'open') !== 'open' || !['Referral', 'Imaging'].includes(referral.kind) || referral.appointmentDate) continue;
      // A dated future referral is not actionable yet; do not invent a deadline
      // from the date the referral was written.
      const sinceIssue = actionDaysUntil(referral.date, now);
      if (sinceIssue !== null && sinceIssue > 0) continue;
      const key = `${member.id}:referral:${referral.id}:${dateOrdinal(referral.date) === null ? 'undated' : referral.date}`;
      if (tracked.has(key)) continue;
      suggestions.set(key, {
        key, title: `Book ${member.name}'s follow-up`,
        notes: 'Review the source record and arrange the next step. Completing this action does not mark the source as booked.',
        source: { key, label: 'Follow-up record', memberId: member.id, tab: 'medical' }, daysUntilDue: null,
      });
    }
  }
  return [...suggestions.values()].sort((a, b) => ((a.daysUntilDue ?? Infinity) - (b.daysUntilDue ?? Infinity))
    || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}
