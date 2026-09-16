import { isMedicalCalendarEvent } from './medicalCalendarEvent';
import type { CalendarEvent, FamilyMember, TimelineEntry, TravelTimelineEntry, VaultDocument } from '../types';
import { buildHealthTimeline } from './healthTimeline';
import { parseDateOnly } from './age';
import { educationDocuments } from './education';

export const TIMELINE_CATEGORIES = ['memories', 'medical', 'education', 'addresses', 'growth', 'travel', 'calendar'] as const;
export type TimelineCategory = typeof TIMELINE_CATEGORIES[number];
export const TIMELINE_LABELS: Record<TimelineCategory, string> = {
  memories: 'Memories & milestones', medical: 'Medical', education: 'Education', addresses: 'Addresses',
  growth: 'Growth', travel: 'Travel', calendar: 'Calendar',
};
export interface FamilyTimelineItem {
  id: string;
  category: TimelineCategory;
  date: string; // YYYY for a known academic year; YYYY-MM-DD for exact dates; blank for undated.
  dateLabel?: string;
  imageUrl?: string;
  endDate?: string; // Only a known end date; never infer an ongoing residence.
  rangeLabel?: string;
  title: string;
  note?: string;
  memberIds: string[];
  sourceLabel: string;
  target?: { memberId?: string; tab?: string; view?: string };
  manual?: TimelineEntry;
}
const validDate = (date?: string) => date && parseDateOnly(date) ? date : '';

// Derived records are never copied into the saved memories list. Source IDs stay
// stable when dates change, and shared appointments are combined across people.
export function buildFamilyTimeline({ members, events = [], memories = [], travel = [], vault = [], now = new Date() }: {
  members: FamilyMember[]; events?: CalendarEvent[]; memories?: TimelineEntry[]; travel?: TravelTimelineEntry[]; vault?: VaultDocument[]; now?: Date;
}): FamilyTimelineItem[] {
  const items: FamilyTimelineItem[] = memories.map(m => ({ id: `memory:${m.id}`, category: 'memories',
    date: validDate(m.date), title: m.title, note: m.note, memberIds: m.memberIds || [], sourceLabel: m.type || 'Memory', manual: m }));
  const healthEvents = new Map<string, FamilyTimelineItem>();
  for (const member of members) {
    const docOptions = educationDocuments(member, vault);
    const linkedDate = (links: import('../types').EducationDocumentLink[] = []) => links.map(link => docOptions.find(option => option.link.source === link.source && option.link.documentId === link.documentId)?.date).find(Boolean);
    const memberIds = [member.id];
    const target = (tab: string) => ({ memberId: member.id, tab });
    if (member.birthdate) items.push({ id: `birth:${member.id}`, category: 'memories', date: validDate(member.birthdate),
      title: `${member.name} was born`, memberIds, sourceLabel: 'Profile', target: target('overview') });
    for (const address of member.addressHistory || []) {
      const label = address.label || address.address.split('\n')[0];
      const base = { category: 'addresses' as const, memberIds, sourceLabel: 'Address history', target: target('addresses'), note: [address.address, address.notes].filter(Boolean).join('\n') };
      if (address.startDate || !address.endDate) items.push({ ...base, id: `address:${member.id}:${address.id}:in`, date: validDate(address.startDate), endDate: validDate(address.endDate), rangeLabel: label, title: address.startDate ? `Moved to ${label}` : label });
      if (address.endDate) items.push({ ...base, id: `address:${member.id}:${address.id}:out`, date: validDate(address.endDate), title: `Moved from ${label}` });
    }
    for (const year of member.education?.schoolYears || []) {
      const yearNumber = year.label.match(/^(\d{4})(?:\D|$)/)?.[1] || '';
      items.push({ id: `school:${member.id}:${year.id}`, category: 'education', date: yearNumber, dateLabel: year.label,
        title: year.schoolName, note: [year.grade, year.teacherName, year.notes].filter(Boolean).join(' · '), memberIds, sourceLabel: 'School year', target: target('education') });
      for (const report of year.reports || []) {
        const photo = (report.documents || []).map(link => educationDocuments(member, vault).find(option => option.link.source === link.source && option.link.documentId === link.documentId)?.document).find(doc => doc?.fileType.startsWith('image/') && doc.fileData);
        items.push({ id: `report:${member.id}:${report.id}`, category: 'education', date: validDate(report.date || linkedDate(report.documents)),
        title: report.title, imageUrl: photo?.fileData, note: [year.label, year.schoolName, report.term, report.results, report.notes].filter(Boolean).join('\n'), memberIds, sourceLabel: report.kind || 'School report', target: target('education') });
      }
    }
    for (const q of member.education?.qualifications || []) items.push({ id: `qualification:${member.id}:${q.id}`, category: 'education',
      date: validDate(q.issueDate || linkedDate(q.documents)), title: q.name, note: [q.issuer, q.notes].filter(Boolean).join('\n'), memberIds, sourceLabel: 'Qualification', target: target('education') });
    const health = buildHealthTimeline({ member, members, events, now });
    for (const h of [...health.years.flatMap(y => y.items), ...health.undated, ...health.upcoming]) {
      const item: FamilyTimelineItem = { id: `health:${member.id}:${h.id}`, category: h.kind === 'growth' ? 'growth' : 'medical', date: validDate(h.date),
        title: h.title, note: [h.provider, h.notes].filter(Boolean).join('\n'), memberIds, sourceLabel: h.referralKind || (h.kind === 'growth' ? 'Growth measurement' : h.kind === 'appointment' ? 'Appointment' : h.kind === 'vaccination' ? 'Vaccination' : 'Check-up'),
        target: h.kind === 'appointment' ? { view: 'calendar' } : target(h.kind === 'growth' && member.role === 'Child' ? 'growth' : 'medical') };
      if (h.kind === 'appointment') {
        const prior = healthEvents.get(h.id);
        if (prior) prior.memberIds.push(member.id);
        else healthEvents.set(h.id, { ...item, id: `health:${h.id}` });
      } else items.push(item);
    }
  }
  items.push(...healthEvents.values());
  // Appointment IDs use the existing health timeline's appointment- prefix.
  for (const event of events) {
    if (event.category === 'Appointment' && healthEvents.has(`appointment-${event.id}`)) continue;
    items.push({ id: `event:${event.id}`, category: isMedicalCalendarEvent(event) ? 'medical' : event.category === 'School' ? 'education' : event.category === 'Travel' ? 'travel' : 'calendar',
      date: validDate(event.date), title: event.title, note: event.description, memberIds: event.memberIds || [], sourceLabel: 'Calendar', target: { view: 'calendar' } });
  }
  for (const trip of travel) items.push({ id: `trip:${trip.id}`, category: 'travel', date: validDate(trip.date),
    imageUrl: trip.photoUrl, title: [trip.place, trip.country].filter(Boolean).join(', '), note: trip.notes, memberIds: [], sourceLabel: 'Travel history', target: { view: 'travelTimeline' } });
  return items;
}

export function filterFamilyTimeline(items: FamilyTimelineItem[], options: {
  categories: TimelineCategory[]; memberId?: string; year?: string; search?: string; oldestFirst?: boolean;
}): FamilyTimelineItem[] {
  const query = options.search?.trim().toLocaleLowerCase() || '';
  return items.filter(item => options.categories.includes(item.category)
    && (!options.memberId || item.memberIds.includes(options.memberId))
    && (!options.year || (options.year === 'undated' ? !item.date : item.date.slice(0, 4) === options.year))
    && (!query || `${item.title} ${item.note || ''} ${item.sourceLabel} ${item.dateLabel || ''}`.toLocaleLowerCase().includes(query)))
    .sort((a, b) => {
      if (!a.date || !b.date) return !a.date && !b.date ? a.id.localeCompare(b.id) : !a.date ? 1 : -1;
      return (options.oldestFirst ? 1 : -1) * a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    });
}
