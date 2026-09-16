// One timeline for a whole life — a person's, the family's, or the business's.
//
// WHY THIS EXISTS
// ----------------
// The app had three timelines that never met. The family timeline was a
// hand-typed list of moments with no idea WHO a moment was about. The health
// timeline (healthTimeline.ts) was one member's medical history, reachable
// only from a modal. The travel timeline was a family-wide list of countries.
// A broken arm, the holiday it happened on, and the hospital letter that came
// home afterwards lived in three places and were never seen together.
//
// This module is the join. Like healthTimeline.ts it is a PURE PROJECTION:
// it reads records that already have an owner and writes nothing. A referral
// is edited in Referrals & Results, a trip on the calendar, a country on the
// travel timeline — the life timeline only shows them. The one store it has
// of its own is the family timeline's `entries`, which is why only those rows
// are `editable`.
//
// RULES THIS MODULE MUST NOT VIOLATE (each enforced below, inline)
// ----------------------------------------------------------------
// 1. A row is positioned by the date the thing HAPPENED — never the date it
//    was filed. A vault document is placed by `docDate` (the date printed on
//    it) and a document without one is not placed at all: `uploadedAt` would
//    put a 2019 discharge letter in 2026. Health rows inherit this from
//    healthTimeline.ts's rule 2.
// 2. One fact, one row. The assistant files a medical letter three times —
//    the vault, the member's profile, Referrals & Results — as the SAME
//    Storage object. The referral row already stands for it, so the vault
//    copy is suppressed rather than shown twice. A document a moment links
//    to (entry.docIds) is shown on that moment, not as a row of its own. An
//    appointment tagged to two people is one row with both of them on it.
// 3. Undated entries are bucketed, never dropped (healthTimeline.ts rule 1).
// 4. Nothing medical in a business space. An employee's health is GDPR
//    special-category data; the business timeline is milestones and work.
// 5. `counts` reconciles: total === upcoming + dated + undated + merged +
//    suppressed. Every record this module considers is accounted for.
import {
  AnniversaryRecord,
  BusinessMilestoneEntry,
  CalendarEvent,
  FamilyMember,
  LifeCategory,
  TimelineEntry,
  TimelinePhoto,
  TravelTimelineEntry,
  VaultCategory,
  VaultDocument,
} from '../types';
import { parseDateLoose } from './timelineImport';
import { educationDocumentLinks, educationDocuments, savedEducationDocuments, sameEducationFile } from './education';
import { buildFamilyTimeline } from './familyTimeline';
import { buildHealthTimeline, HealthTimelineItem, HealthTimelineKind } from './healthTimeline';
import { resolveEventMembers } from './eventMemberMatch';
import { todayIsoLocal } from './memberAppointments';
import { parseDateOnly } from './age';
import { hiddenKey, NO_HIDDEN_PEOPLE, visibleAnniversaries, visibleEvents, type HiddenPeople } from './hiddenPeople';

export type LifeSource =
  | 'profile'      // education, former addresses and growth
  | 'entry'        // a moment typed into the timeline itself — the only editable rows
  | 'health'       // healthTimeline.ts: vaccinations, check-ups, referrals & results, appointments
  | 'travel'       // a country on the travel timeline
  | 'trip'         // a Travel event on the calendar
  | 'event'        // a Milestone event on the calendar
  | 'birth'        // a member's birthdate
  | 'anniversary'  // an anniversary with a year it started
  | 'document'     // a vault document with the date printed on it
  | 'business';    // a business milestone

export type LifePrecision = 'day' | 'month' | 'year';

export interface LifeTimelineItem {
  /** Unique across every source. */
  id: string;
  source: LifeSource;
  /** The record's id in the store that owns it — what "open" / "edit" act on. */
  sourceId: string;
  category: LifeCategory;
  /** YYYY-MM-DD the row is positioned by. '' only in `undated`. */
  date: string;
  endDate?: string;
  precision: LifePrecision;
  title: string;
  /** Secondary line: the provider, the destination, the kind of paper. */
  detail?: string;
  note?: string;
  place?: string;
  /** Who it is about. Empty = the whole family. */
  memberIds: string[];
  photos?: TimelinePhoto[];
  docIds?: string[];
  countryCode?: string;
  healthKind?: HealthTimelineKind;
  /** The file behind a referral or document row, for "open". */
  fileUrl?: string;
  /** Only `entry` rows are edited here; everything else is edited where it lives. */
  editable: boolean;
  profileTab?: string;
  imageUrl?: string;
}

export interface LifeTimelineYear {
  year: number;
  /** Newest first. */
  items: LifeTimelineItem[];
}

export interface LifeTimelineCounts {
  total: number;
  upcoming: number;
  dated: number;
  undated: number;
  /** Duplicate rows folded into another row (rule 2: one appointment, two people). */
  merged: number;
  /** Records deliberately shown through another row instead (rule 2). */
  suppressed: number;
}

export interface LifeTimelineResult {
  /** Soonest first. */
  upcoming: LifeTimelineItem[];
  /** Newest year first. */
  years: LifeTimelineYear[];
  undated: LifeTimelineItem[];
  counts: LifeTimelineCounts;
}

export const LIFE_CATEGORIES: { id: LifeCategory; label: string }[] = [
  { id: 'milestone', label: 'Milestones' },
  { id: 'medical', label: 'Medical' },
  { id: 'holiday', label: 'Holidays' },
  { id: 'school', label: 'School' },
  { id: 'work', label: 'Work' },
  { id: 'home', label: 'Home' },
  { id: 'papers', label: 'Papers' },
  { id: 'memory', label: 'Memories' },
  { id: 'other', label: 'Other' },
];

const CATEGORY_IDS = new Set<string>(LIFE_CATEGORIES.map((c) => c.id));

export function isLifeCategory(value: unknown): value is LifeCategory {
  return typeof value === 'string' && CATEGORY_IDS.has(value);
}

// The family timeline's original `type` values, for entries saved before
// `category` existed. They are read, never rewritten: an old entry keeps its
// type until someone edits it.
const LEGACY_TYPE_CATEGORY: Record<string, LifeCategory> = {
  Birth: 'milestone',
  Wedding: 'milestone',
  Graduation: 'school',
  Milestone: 'milestone',
  Memory: 'memory',
  Other: 'other',
};

// Words people (and the assistant) reach for that mean one of the kinds.
const CATEGORY_WORDS: Record<string, LifeCategory> = {
  holidays: 'holiday', trip: 'holiday', travel: 'holiday', vacation: 'holiday',
  health: 'medical', hospital: 'medical', injury: 'medical',
  education: 'school', graduation: 'school',
  business: 'work', job: 'work', career: 'work',
  move: 'home', house: 'home',
  document: 'papers', documents: 'papers',
  birth: 'milestone', wedding: 'milestone',
};

/** A kind from a free word — "Holidays", "Graduation", "medical". Unknown words give undefined. */
export function lifeCategoryFromWord(word: string | undefined): LifeCategory | undefined {
  const w = (word || '').trim().toLowerCase();
  if (isLifeCategory(w)) return w;
  return CATEGORY_WORDS[w];
}

/**
 * A date as someone gave it: a day, a month ("2019-06") or a year ("2019").
 * A month or year is stored as the first of that period with its precision,
 * so it sorts in place and still reads as "Jun 2019" or "2019". Anything else
 * is undated — never a guessed day.
 */
export function parseLifeDate(raw: string | undefined): { date: string; datePrecision?: 'month' | 'year' } {
  const s = (raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s };
  if (/^\d{4}-\d{2}$/.test(s)) return { date: `${s}-01`, datePrecision: 'month' };
  if (/^\d{4}$/.test(s)) return { date: `${s}-01-01`, datePrecision: 'year' };
  return { date: '' };
}

export function categoryOfEntry(entry: Pick<TimelineEntry, 'category' | 'type'>): LifeCategory {
  if (isLifeCategory(entry.category)) return entry.category;
  return (entry.type && LEGACY_TYPE_CATEGORY[entry.type]) || 'memory';
}

const VAULT_CATEGORY: Record<VaultCategory, LifeCategory> = {
  Identity: 'papers',
  Education: 'school',
  Medical: 'medical',
  Financial: 'papers',
  Legal: 'papers',
  Travel: 'holiday',
  Other: 'other',
};

function isValidIso(date: string | undefined): date is string {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && parseDateOnly(date) != null;
}

function precisionOf(entry: TimelineEntry): LifePrecision {
  return entry.datePrecision === 'month' || entry.datePrecision === 'year' ? entry.datePrecision : 'day';
}

export interface LifeTimelineInput {
  members: readonly FamilyMember[];
  events: readonly CalendarEvent[];
  /** The family timeline's own moments. */
  entries: readonly TimelineEntry[];
  travel?: readonly TravelTimelineEntry[];
  documents?: readonly VaultDocument[];
  anniversaries?: readonly AnniversaryRecord[];
  milestones?: readonly BusinessMilestoneEntry[];
  isBusinessSpace?: boolean;
  /** People whose dates are hidden (utils/hiddenPeople.ts): no birth, anniversary or dated calendar entry of theirs. */
  hidden?: HiddenPeople;
  /** Injected, never read from the clock in here — same convention as healthTimeline.ts. */
  now: Date;
}

export function buildLifeTimeline(input: LifeTimelineInput): LifeTimelineResult {
  const { members, entries, now } = input;
  const hidden = input.hidden || NO_HIDDEN_PEOPLE;
  const events = visibleEvents([...input.events], hidden);
  const business = !!input.isBusinessSpace;
  const todayIso = todayIsoLocal(now);

  const upcoming: LifeTimelineItem[] = [];
  const undated: LifeTimelineItem[] = [];
  const yearMap = new Map<number, LifeTimelineItem[]>();
  let total = 0;
  let merged = 0;
  let suppressed = 0;

  const placeDated = (item: LifeTimelineItem) => {
    const year = parseDateOnly(item.date)!.getFullYear();
    const bucket = yearMap.get(year);
    if (bucket) bucket.push(item);
    else yearMap.set(year, [item]);
  };

  // Future-dated rows are "coming up"; a trip already under way is history
  // being made, so it is placed by its start like any past row.
  const place = (item: LifeTimelineItem) => {
    total++;
    if (!isValidIso(item.date)) { undated.push({ ...item, date: '' }); return; }
    if (item.date > todayIso) upcoming.push(item);
    else placeDated(item);
  };

  // --- 1. The family timeline's own moments ------------------------------
  const linkedDocIds = new Set<string>();
  for (const e of entries) {
    const category = categoryOfEntry(e);
    // Rule 4 holds for typed moments too: the business form never offers
    // Medical, and one that arrives anyway (the assistant, an old import) is
    // counted and kept off a timeline the whole team reads.
    if (business && category === 'medical') { total++; suppressed++; continue; }
    for (const id of e.docIds || []) linkedDocIds.add(id);
    place({
      id: `entry-${e.id}`,
      source: 'entry',
      sourceId: e.id,
      category,
      date: e.date,
      endDate: isValidIso(e.endDate) && e.endDate >= e.date ? e.endDate : undefined,
      precision: precisionOf(e),
      title: e.title,
      fileUrl: e.sourceDocument ? members.find(m=>m.id===e.sourceDocument?.memberId)?.documents?.find(d=>d.id===e.sourceDocument?.documentId)?.fileData : undefined,
      note: e.note,
      place: e.place,
      memberIds: [...(e.memberIds || [])],
      photos: e.photos && e.photos.length ? [...e.photos] : undefined,
      docIds: e.docIds && e.docIds.length ? [...e.docIds] : undefined,
      editable: true,
    });
  }

  // --- 2. Health (rule 4: never in a business space) ----------------------
  // Growth check-ins are left to the Growth tab and the health timeline: a
  // monthly weigh-in is a measurement, not a moment, and a year of them would
  // bury everything else. They are not "considered" here, so not counted.
  const referralPaths = new Set<string>();
  if (!business) {
    const byAppointment = new Map<string, LifeTimelineItem>();
    for (const member of members) {
      const referralById = new Map((member.referrals || []).map((r) => [r.id, r]));
      for (const r of member.referrals || []) if (r.storagePath) referralPaths.add(r.storagePath);

      const health = buildHealthTimeline({ member, events, members, now });
      const all: HealthTimelineItem[] = [
        ...health.upcoming,
        ...health.years.flatMap((y) => y.items),
        ...health.undated,
      ];
      for (const h of all) {
        if (h.kind === 'growth') continue;
        // One appointment tagged to two people: one row, both people (rule 2).
        if (h.kind === 'appointment') {
          const existing = byAppointment.get(h.id);
          if (existing) {
            if (!existing.memberIds.includes(member.id)) existing.memberIds.push(member.id);
            total++;
            merged++;
            continue;
          }
        }
        const referral = h.kind === 'referral' ? referralById.get(h.id.replace(/^referral-/, '')) : undefined;
        const detail = [h.referralKind && h.referralKind !== h.title ? h.referralKind : '', h.provider || '']
          .filter(Boolean)
          .join(' · ');
        const item: LifeTimelineItem = {
          id: h.kind === 'appointment' ? `health-${h.id}` : `health-${member.id}-${h.id}`,
          source: 'health',
          sourceId: h.id,
          category: 'medical',
          date: h.date,
          precision: 'day',
          title: h.title,
          detail: detail || undefined,
          note: h.notes,
          memberIds: [member.id],
          healthKind: h.kind,
          fileUrl: referral?.downloadUrl,
          editable: false,
        };
        if (h.kind === 'appointment') byAppointment.set(h.id, item);
        // Care due dates come back from healthTimeline.ts already in its
        // `upcoming`, dated today or later, so `place` sorts them the same way.
        place(item);
      }
    }
  }

  // --- 3. Calendar: trips and milestones ----------------------------------
  for (const ev of events) {
    if (ev.category !== 'Travel' && ev.category !== 'Milestone') continue;
    const trip = ev.category === 'Travel';
    // Travel is also where the calendar keeps travel admin — the assistant
    // files every "<Name>'s UK Passport Expires" there. A one-day Travel entry
    // with nowhere to go is a reminder, not a holiday: it stays on the
    // calendar and stays off the timeline.
    const multiDay = isValidIso(ev.endDate) && (ev.endDate as string) > ev.date;
    if (trip && !multiDay && !ev.destination?.trim() && !ev.destinationCountry) continue;
    place({
      id: `${trip ? 'trip' : 'event'}-${ev.id}`,
      source: trip ? 'trip' : 'event',
      sourceId: ev.id,
      category: trip ? 'holiday' : 'milestone',
      date: ev.date,
      endDate: trip && isValidIso(ev.endDate) && ev.endDate > ev.date ? ev.endDate : undefined,
      precision: 'day',
      title: ev.title,
      detail: trip ? ev.destination || undefined : undefined,
      note: ev.description,
      memberIds: resolveEventMembers(ev, members).memberIds,
      countryCode: trip && ev.destinationCountry && /^[a-z]{2}$/i.test(ev.destinationCountry)
        ? ev.destinationCountry.toUpperCase()
        : undefined,
      editable: false,
    });
  }

  if (!business) {
    // --- 4. The travel timeline -------------------------------------------
    for (const t of input.travel || []) {
      place({
        id: `travel-${t.id}`,
        source: 'travel',
        sourceId: t.id,
        category: 'holiday',
        date: t.date,
        precision: 'day',
        title: t.place ? `${t.place}, ${t.country}` : t.country,
        note: t.notes,
        memberIds: [],
        photos: t.photoUrl ? [{ url: t.photoUrl, storagePath: t.photoStoragePath || '' }] : undefined,
        countryCode: t.countryCode,
        editable: false,
      });
    }

    // --- 5. Births --------------------------------------------------------
    for (const m of members) {
      if (!m.birthdate || hidden.keys.has(hiddenKey.member(m.id))) continue;
      place({
        id: `birth-${m.id}`,
        source: 'birth',
        sourceId: m.id,
        category: 'milestone',
        date: m.birthdate,
        precision: 'day',
        title: `${m.name} was born`,
        detail: [m.birthHospital, m.placeOfBirth].filter(Boolean).join(' · ') || undefined,
        memberIds: [m.id],
        editable: false,
      });
    }

    // --- 6. Anniversaries that know the year they started ------------------
    for (const a of visibleAnniversaries([...(input.anniversaries || [])], hidden)) {
      if (!a.originalYear || !/^\d{2}-\d{2}$/.test(a.date)) continue;
      place({
        id: `anniversary-${a.id}`,
        source: 'anniversary',
        sourceId: a.id,
        category: 'milestone',
        date: `${a.originalYear}-${a.date}`,
        precision: 'day',
        title: a.title,
        detail: a.kind !== 'Other' ? a.kind : undefined,
        note: a.notes,
        memberIds: [...(a.memberIds || [])],
        editable: false,
      });
    }
  }

  // Structured work history is already saved: no AI pass is needed to show it.
  for (const member of members) for (const role of member.cv?.roles || []) {
    const start = parseDateLoose(role.startDate || '');
    place({id:`work-${member.id}-${role.id}`,source:'profile',sourceId:role.id,category:'work',date:start?.date || '',precision:start?.datePrecision || 'day',title:role.title,detail:role.employer,note:role.notes,memberIds:[member.id],editable:false,profileTab:'cv'});
    const end = !role.current && parseDateLoose(role.endDate || '');
    if (end) place({id:`work-end-${member.id}-${role.id}`,source:'profile',sourceId:role.id,category:'work',date:end.date,precision:end.datePrecision || 'day',title:`Finished ${role.title}`,detail:role.employer,note:role.notes,memberIds:[member.id],editable:false,profileTab:'cv'});
  }

  // Education links already represented by a qualification/report should not
  // produce another raw-document row, including copies in profile and vault.
  const linkedEducationFiles = business ? [] : members.flatMap(member => {
    const links = educationDocumentLinks(member.education);
    return educationDocuments(member, [...(input.documents || [])]).filter(option => links.some(link => link.source === option.link.source && link.documentId === option.link.documentId));
  });
  if (!business) for (const member of members) {
    for (const option of savedEducationDocuments(member, [])) {
      if (option.link.source !== 'member') continue;
      // Keep explicit profile ownership unless an Education vault copy belongs to this person.
      if ((input.documents || []).some(d => d.category === 'Education' && (!d.memberId || d.memberId === member.id) && sameEducationFile(option.document, { ...d, fileData: d.downloadUrl }))) continue;
      if (educationDocuments(member, [...(input.documents || [])]).some(o => educationDocumentLinks(member.education).some(l => l.source === o.link.source && l.documentId === o.link.documentId) && sameEducationFile(o.document, option.document))) continue;
      place({ id: `education-document-${member.id}-${option.document.id}`, source: 'profile', sourceId: option.document.id,
        category: 'school', date: '', precision: 'day', title: option.document.name, note: option.document.notes,
        detail: 'Education document · date not recorded', memberIds: [member.id], editable: false, profileTab: 'education', fileUrl: option.document.fileData });
    }
  }

  // --- 7. Documents with the date printed on them (rules 1, 2, 4) ---------
  for (const d of input.documents || []) {
    if (!isValidIso(d.docDate) && d.category !== 'Education') continue;                  // rule 1: no printed date, no position
    if (business && d.category === 'Medical') continue;    // rule 4
    if (linkedDocIds.has(d.id) || linkedEducationFiles.some(option => (option.link.source === 'vault' && option.link.documentId === d.id) || sameEducationFile(option.document, { ...d, fileData: d.downloadUrl })) || (d.storagePath && referralPaths.has(d.storagePath))) {
      total++;
      suppressed++;                                        // rule 2: already on the timeline through another row
      continue;
    }
    place({
      id: `document-${d.id}`,
      source: 'document',
      sourceId: d.id,
      category: VAULT_CATEGORY[d.category] || 'other',
      date: isValidIso(d.docDate) ? d.docDate : '',
      precision: 'day',
      title: d.name,
      detail: d.category,
      profileTab: !business && d.category === 'Education' && d.memberId ? 'education' : undefined,
      note: d.notes,
      memberIds: d.memberId ? [d.memberId] : d.category === 'Education' ? members.filter(m => m.documents?.some(doc => doc.category === 'Education' && sameEducationFile(doc, { ...d, fileData: d.downloadUrl }))).map(m => m.id) : [],
      docIds: [d.id],
      fileUrl: d.downloadUrl,
      editable: false,
    });
  }

  // --- 8. Business milestones ---------------------------------------------
  if (business) {
    for (const m of input.milestones || []) {
      place({
        id: `business-${m.id}`,
        source: 'business',
        sourceId: m.id,
        category: 'work',
        date: m.date,
        precision: 'day',
        title: m.title,
        detail: m.kind && m.kind !== 'Other' ? String(m.kind) : undefined,
        note: m.notes,
        memberIds: [],
        editable: false,
      });
    }
  }

  if (!business) {
    for (const item of buildFamilyTimeline({ members: [...members], events, vault: [...(input.documents || [])], now })) {
      if (!['education', 'addresses', 'growth'].includes(item.category)) continue;
      place({ id: item.id, source: item.target?.view === 'calendar' ? 'event' : 'profile', sourceId: item.id,
        category: item.category === 'education' ? 'school' : item.category === 'addresses' ? 'home' : 'medical',
        date: item.date.length === 4 ? `${item.date}-01-01` : item.date, endDate: item.endDate,
        precision: item.date.length === 4 ? 'year' : 'day', title: item.title, detail: item.sourceLabel,
        note: item.note, memberIds: item.memberIds, editable: false, profileTab: item.target?.tab, imageUrl: item.imageUrl });
    }
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const years: LifeTimelineYear[] = [...yearMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({
      year,
      items: [...items].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)),
    }));
  const dated = years.reduce((n, y) => n + y.items.length, 0);

  return {
    upcoming,
    years,
    undated,
    counts: { total, upcoming: upcoming.length, dated, undated: undated.length, merged, suppressed },
  };
}

export interface LifeFilter {
  /** Show one person's timeline. Absent = everyone. */
  member?: Pick<FamilyMember, 'id' | 'birthdate'>;
  /**
   * On one person's timeline, also show whole-family rows (a family holiday
   * nobody was tagged on) — but only from the day they were born: the family
   * trip to Spain three years before a child arrived is not part of hers.
   */
  includeFamily?: boolean;
  category?: LifeCategory;
}

export function matchesLifeFilter(item: LifeTimelineItem, filter: LifeFilter): boolean {
  if (filter.category && item.category !== filter.category) return false;
  const m = filter.member;
  if (!m) return true;
  if (item.memberIds.includes(m.id)) return true;
  if (item.memberIds.length > 0 || !filter.includeFamily) return false;
  if (!item.date) return true;
  return !m.birthdate || !isValidIso(m.birthdate) || item.date >= m.birthdate;
}

/**
 * A whole-family moment written the old way — "Mia: first day at school" or
 * "Mia's first tooth" — is probably about Mia. Returns that one member, or
 * null when the moment is already about someone, no member's first name leads
 * the title followed by ":" or "'s", or more than one member could be meant
 * (two people sharing a first name). This only ever SUGGESTS: the row offers
 * a one-tap tag, and nothing is tagged — or retitled — until somebody taps.
 */
export function suggestMemberFromTitle<M extends Pick<FamilyMember, 'id' | 'name'>>(
  entry: { title?: string; memberIds?: readonly string[] },
  members: readonly M[],
): M | null {
  const tagged = (entry.memberIds || []).some((id) => members.some((m) => m.id === id));
  if (tagged) return null;
  const title = (entry.title || '').trim().toLowerCase();
  if (!title) return null;
  const hits = members.filter((m) => {
    const first = (m.name || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (!first || !title.startsWith(first)) return false;
    // "Mia:" / "Mia :" / "Mia's" / "Mia’s" — not "Miami", not "Mia and Ben".
    return /^(\s*:|['’]s(?![\p{L}\p{N}]))/u.test(title.slice(first.length));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** The same result, narrowed — years left empty by the filter are dropped. */
export function filterLifeTimeline(result: LifeTimelineResult, filter: LifeFilter): LifeTimelineResult {
  const keep = (item: LifeTimelineItem) => matchesLifeFilter(item, filter);
  const upcoming = result.upcoming.filter(keep);
  const years = result.years
    .map((y) => ({ year: y.year, items: y.items.filter(keep) }))
    .filter((y) => y.items.length > 0);
  const undated = result.undated.filter(keep);
  const dated = years.reduce((n, y) => n + y.items.length, 0);
  return {
    upcoming,
    years,
    undated,
    counts: { ...result.counts, upcoming: upcoming.length, dated, undated: undated.length },
  };
}

/** How many rows of each category a result holds — the numbers on the filter chips. */
export function countByCategory(result: LifeTimelineResult): Record<LifeCategory, number> {
  const out = Object.fromEntries(LIFE_CATEGORIES.map((c) => [c.id, 0])) as Record<LifeCategory, number>;
  for (const item of [...result.upcoming, ...result.years.flatMap((y) => y.items), ...result.undated]) {
    out[item.category]++;
  }
  return out;
}

export interface HolidaySummary {
  /** Holiday rows, past and planned. */
  trips: number;
  /** ISO codes, first visit first. */
  countries: string[];
  firstYear: number | null;
}

export function holidaySummary(result: LifeTimelineResult): HolidaySummary {
  const holidays = [...result.years.flatMap((y) => y.items), ...result.upcoming]
    .filter((i) => i.category === 'holiday' && i.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const countries: string[] = [];
  for (const h of holidays) {
    if (h.countryCode && !countries.includes(h.countryCode)) countries.push(h.countryCode);
  }
  return {
    trips: holidays.length,
    countries,
    firstYear: holidays.length ? parseDateOnly(holidays[0].date)!.getFullYear() : null,
  };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "12 Aug 2026", "Jul 2024", "2009", "28 Jul – 3 Aug 2026". Built by hand
 * rather than with toLocaleDateString so a month-precision date can never be
 * shown as the 1st of that month — the day it was stored under, not a day
 * anyone said.
 */
export function lifeDateLabel(item: Pick<LifeTimelineItem, 'date' | 'endDate' | 'precision'>): string {
  const d = parseDateOnly(item.date);
  if (!d) return 'Undated';
  const y = d.getFullYear();
  if (item.precision === 'year') return String(y);
  if (item.precision === 'month') return `${MONTH_SHORT[d.getMonth()]} ${y}`;
  const start = `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  const end = parseDateOnly(item.endDate);
  if (!end || item.endDate === item.date) return `${start} ${y}`;
  if (end.getFullYear() !== y) return `${start} ${y} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  if (end.getMonth() === d.getMonth()) return `${d.getDate()}–${end.getDate()} ${MONTH_SHORT[d.getMonth()]} ${y}`;
  return `${start} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]} ${y}`;
}
