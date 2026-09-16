import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AnniversaryRecord, BusinessMilestoneEntry, CalendarEvent, FamilyMember, FamilyTimeline,
  LifeCategory, TimelineEntry, TimelinePhoto, TravelTimelineDoc, TravelTimelineEntry, VaultDocument,
} from '../types';
import {
  loadTimeline, saveTimeline, loadTravelTimeline, loadDocuments, loadAnniversaries,
  loadBusinessMilestones, uploadTimelinePhoto, deleteTimelinePhoto,
} from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { compressImageToAvatar } from '../utils/imageCompress';
import { warmAvatarColor } from '../utils/avatarPalette';
import {
  buildLifeTimeline, categoryOfEntry, countByCategory, filterLifeTimeline, holidaySummary,
  LIFE_CATEGORIES, lifeDateLabel, LifeSource, LifeTimelineItem, suggestMemberFromTitle,
} from '../utils/lifeTimeline';
import {
  CalendarHeart, Plus, Pencil, Check, X, Cloud, CloudOff, Star, Bandage, Plane,
  GraduationCap, Briefcase, Home, FileText, Sparkles, MapPin, ImagePlus, Paperclip,
  ExternalLink, HeartPulse, CalendarPlus, Tag, Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { useHiddenPeople } from '../contexts/HiddenPeopleContext';
import EmptyState from './EmptyState';
import VisualTimeline from './VisualTimeline';
import type { FamilyTimelineItem, TimelineCategory } from '../utils/familyTimeline';
import ImageLightbox from './ImageLightbox';
import { timelineDocumentSources } from '../utils/timelineDocuments';
import TimelineImportModal from './TimelineImportModal';

// The life timeline: every moment the family typed in, PLUS what the rest of
// the app already knows happened — health records, trips, the travel
// timeline, births, anniversaries, dated documents, business milestones —
// merged by utils/lifeTimeline.ts. Only the typed-in moments are edited here;
// every other row says where it came from and is edited there.

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

const MAX_PHOTOS = 8;

const CATEGORY_STYLE: Record<LifeCategory, { chip: string; dot: string; Icon: LucideIcon }> = {
  milestone: { chip: 'bg-honey-100 text-honey-800', dot: 'bg-honey-100 text-honey-700', Icon: Star },
  medical: { chip: 'bg-rosa-100 text-rosa-700', dot: 'bg-rosa-100 text-rosa-700', Icon: Bandage },
  holiday: { chip: 'bg-dusk-100 text-dusk-700', dot: 'bg-dusk-100 text-dusk-700', Icon: Plane },
  school: { chip: 'bg-sage-100 text-sage-700', dot: 'bg-sage-100 text-sage-700', Icon: GraduationCap },
  work: { chip: 'bg-clay-100 text-clay-700', dot: 'bg-clay-100 text-clay-700', Icon: Briefcase },
  home: { chip: 'bg-honey-50 text-honey-900', dot: 'bg-honey-50 text-honey-800', Icon: Home },
  papers: { chip: 'bg-ink-100 text-ink-700', dot: 'bg-ink-100 text-ink-600', Icon: FileText },
  memory: { chip: 'bg-cream-200 text-ink-700', dot: 'bg-cream-200 text-ink-600', Icon: Sparkles },
  other: { chip: 'bg-cream-100 text-ink-600', dot: 'bg-cream-100 text-ink-500', Icon: CalendarHeart },
};

const CATEGORY_LABEL = Object.fromEntries(LIFE_CATEGORIES.map((c) => [c.id, c.label])) as Record<LifeCategory, string>;
// Singular, for the chip on one row ("Holiday", not "Holidays").
const CATEGORY_ONE: Record<LifeCategory, string> = {
  milestone: 'Milestone', medical: 'Medical', holiday: 'Holiday', school: 'School', work: 'Work',
  home: 'Home', papers: 'Papers', memory: 'Memory', other: 'Other',
};

const SOURCE_LABEL: Record<LifeSource, string> = {
  profile: 'their profile',
  entry: '',
  health: 'health records',
  travel: 'the travel timeline',
  trip: 'the calendar',
  event: 'the calendar',
  birth: 'their profile',
  anniversary: 'Anniversaries',
  document: 'Documents',
  business: 'Business milestones',
};

// Regional-indicator pair, e.g. 'AT' -> 🇦🇹 — two code points, no library.
function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export type TimelineOpenTarget = 'travelTimeline' | 'calendar' | 'anniversaries';

interface Props {
  openAddSignal?: number;
  openImportInitially?: boolean;
  onInitialImportHandled?: () => void;
  emberMode?: boolean;
  members?: FamilyMember[];
  events?: CalendarEvent[];
  isBusinessSpace?: boolean;
  canEdit?: boolean;
  /** Demo data has no Storage: moments still work, photos don't. */
  demo?: boolean;
  /** Pins the view to one person — the Timeline tab on a member's profile. */
  memberId?: string;
  onOpenMemberTab?: (memberId: string, tab: string) => void;
  onOpenHealth?: (memberId: string) => void;
  onOpenView?: (view: TimelineOpenTarget) => void;
}

export default function TimelineView({
  openAddSignal = 0, openImportInitially = false, onInitialImportHandled, emberMode = false, members = [], events = [], isBusinessSpace = false,
  canEdit = true, demo = false, memberId, onOpenHealth, onOpenView, onOpenMemberTab,
}: Props) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [travel, setTravel] = useState<TravelTimelineEntry[]>([]);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [anniversaries, setAnniversaries] = useState<AnniversaryRecord[]>([]);
  const [milestones, setMilestones] = useState<BusinessMilestoneEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [localAddSignal, setLocalAddSignal] = useState(0);
  const [personId, setPersonId] = useState<string>('');
  const [visual, setVisual] = useState(true);
  const [enabledCategories, setEnabledCategories] = useState<LifeCategory[]>(LIFE_CATEGORIES.map(c => c.id));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<LifeCategory | ''>('');
  const [includeFamily, setIncludeFamily] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [photoView, setPhotoView] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(openImportInitially);
  useEffect(() => { if (openImportInitially) onInitialImportHandled?.(); }, []);
  // The most recent import, for the "Added 12 moments · Undo" banner.
  const [lastImport, setLastImport] = useState<{ batchId: string; count: number } | null>(null);

  // Async saves (photo uploads first) must build on the NEWEST list, including
  // anything a family member added while the upload ran.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (demo) { setLoaded(true); return; }
    let active = true;
    (async () => {
      const [t, tr, docs, ann, ms] = await Promise.all([
        loadTimeline().catch(() => null),
        isBusinessSpace ? Promise.resolve(null) : loadTravelTimeline().catch(() => null),
        loadDocuments().catch(() => [] as VaultDocument[]),
        isBusinessSpace ? Promise.resolve([] as AnniversaryRecord[]) : loadAnniversaries().catch(() => [] as AnniversaryRecord[]),
        isBusinessSpace ? loadBusinessMilestones().catch(() => null) : Promise.resolve(null),
      ]);
      if (!active) return;
      setEntries(t?.entries || []);
      setTravel(tr?.entries || []);
      setDocuments(docs || []);
      setAnniversaries(ann || []);
      setMilestones(ms?.milestones || []);
      setLoaded(true);
    })();
    return () => { active = false; };
  }, [isBusinessSpace, demo]);

  // Live updates from other family members. Applied silently: the add/edit
  // forms keep their own draft state, so a list refresh never disturbs what
  // someone is typing.
  useSharedDoc<FamilyTimeline>('timeline', (v) => setEntries(v.entries || []), { disabled: demo });
  useSharedDoc<TravelTimelineDoc>('travelTimeline', (v) => setTravel(v.entries || []), { disabled: demo || isBusinessSpace });
  useSharedDoc<{ docs: VaultDocument[] }>('documents', (v) => setDocuments(v.docs || []), { disabled: demo });
  useSharedDoc<{ anniversaries: AnniversaryRecord[] }>('anniversaries', (v) => setAnniversaries(v.anniversaries || []), { disabled: demo || isBusinessSpace });

  useEffect(() => {
    if (!openAddSignal) return;
    setAdding(true);
    setEditId(null);
  }, [openAddSignal]);
  useEffect(() => {
    if (!localAddSignal) return;
    setAdding(true);
    setEditId(null);
  }, [localAddSignal]);

  // `base` is the list `next` was derived from. The shared-doc store merges
  // this device's change (next vs base) onto whatever is in the cloud now, so
  // a moment someone else added meanwhile survives, and a delete only lands if
  // nobody touched that moment since this screen last saw it.
  const persist = async (next: TimelineEntry[], base: TimelineEntry[]) => {
    setEntries(next);
    const ok = demo || await saveTimeline({ entries: next }, { entries: base });
    setCloudSynced(ok);
    return ok;
  };

  const saveMoment = async (draft: TimelineEntry, newPhotos: string[], removed: TimelinePhoto[]) => {
    const uploaded: TimelinePhoto[] = [];
    try {
      for (const dataUrl of newPhotos) {
        const photoId = `${draft.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const { storagePath, downloadUrl } = await uploadTimelinePhoto(dataUrl, photoId);
        uploaded.push({ url: downloadUrl, storagePath });
      }
    } catch (e) {
      console.error('Timeline photo upload failed:', e);
      for (const p of uploaded) void deleteTimelinePhoto(p.storagePath);
      throw new Error('A photo could not be uploaded. Check your connection and try again.');
    }
    const photos = [...(draft.photos || []), ...uploaded];
    const current = entriesRef.current;
    const existing = current.find((e) => e.id === draft.id);
    // Spread the stored entry first: the form only sets the fields it shows,
    // and a key missing from a rebuilt entry is a DELETE of that key (source,
    // importBatchId, anything a later version adds). A brand-new moment typed
    // here is 'manual'.
    const entry: TimelineEntry = {
      ...(existing || { source: 'manual' as const }),
      ...draft,
      photos: photos.length ? photos : undefined,
    };
    const next = existing
      ? current.map((e) => (e.id === entry.id ? entry : e))
      : [...current, entry];
    const ok = await persist(next, current);
    // Only once the list no longer points at them — a failed cloud save still
    // has the old photos referenced, and deleting them would break it.
    if (ok) for (const p of removed) void deleteTimelinePhoto(p.storagePath);
    setAdding(false);
    setEditId(null);
  };

  const deleteMoment = async (id: string) => {
    const current = entriesRef.current;
    const gone = current.find((e) => e.id === id);
    const ok = await persist(current.filter((e) => e.id !== id), current);
    if (ok) for (const p of gone?.photos || []) void deleteTimelinePhoto(p.storagePath);
  };

  // "About Mia? Tag" — sets who a whole-family moment is about. Only the
  // people change; the title is never rewritten.
  const tagMoment = async (id: string, who: string) => {
    const current = entriesRef.current;
    if (!current.some((e) => e.id === id)) return;
    // Appended, not replaced: an id left behind by someone no longer in the
    // family stays where it was.
    await persist(current.map((e) => (e.id === id ? { ...e, memberIds: [...(e.memberIds || []).filter((x) => x !== who), who] } : e)), current);
  };

  // Import: the new rows are appended through the same merge-safe save, and
  // one Undo removes exactly the rows carrying that import's batch id. A row
  // someone edited in the meantime is kept by the merge (a delete made on
  // stale information is declined), which is the right way round.
  const importMoments = async (added: TimelineEntry[], batchId: string) => {
    if (!added.length) return;
    const current = entriesRef.current;
    await persist([...current, ...added], current);
    setLastImport({ batchId, count: added.length });
  };

  const undoImport = async () => {
    if (!lastImport) return;
    const current = entriesRef.current;
    setLastImport(null);
    await persist(current.filter((e) => e.importBatchId !== lastImport.batchId), current);
  };

  const now = useMemo(() => new Date(), []);
  const { hidden } = useHiddenPeople();
  const result = useMemo(
    () => buildLifeTimeline({ members, events, entries, travel, documents, anniversaries, milestones, isBusinessSpace, hidden, now }),
    [members, events, entries, travel, documents, anniversaries, milestones, isBusinessSpace, hidden, now],
  );
  const pinned = memberId ? members.find((m) => m.id === memberId) : undefined;
  const person = pinned || members.find((m) => m.id === personId);
  const scoped = useMemo(
    () => filterLifeTimeline(result, { member: person, includeFamily }),
    [result, person, includeFamily],
  );
  const counts = useMemo(() => countByCategory(scoped), [scoped]);
  const shown = useMemo(() => {
    const matches = (item: LifeTimelineItem) => enabledCategories.includes(item.category) && `${item.title} ${item.note || ''} ${item.detail || ''}`.toLowerCase().includes(search.trim().toLowerCase());
    return { ...scoped, years: scoped.years.map(y => ({ ...y, items: y.items.filter(matches) })).filter(y => y.items.length), upcoming: scoped.upcoming.filter(matches), undated: scoped.undated.filter(matches) };
  }, [scoped, enabledCategories, search]);
  const toggleCategory = (id: LifeCategory) => {
    const next = enabledCategories.includes(id) ? enabledCategories.filter(c => c !== id) : [...enabledCategories, id];
    setEnabledCategories(next); setCategory(next.length === 1 ? next[0] : '');
  };
  const holidays = useMemo(() => holidaySummary(scoped), [scoped]);
  const categories = LIFE_CATEGORIES.filter((c) => !(isBusinessSpace && c.id === 'medical'));

  if (!loaded) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  const flat = shown.years.flatMap((y) => y.items.map((item) => ({ item, year: y.year })));
  const total = flat.length + shown.upcoming.length + shown.undated.length;
  const latestYear = flat[0]?.year ?? now.getFullYear();
  const chapterEntries = flat.filter((f) => f.year === latestYear).map((f) => f.item);
  const featured = chapterEntries.find((i) => i.editable) || chapterEntries[0];
  const formDefaults = {
    memberIds: person ? [person.id] : [],
    category: (category || (isBusinessSpace ? 'work' : 'memory')) as LifeCategory,
  };
  const heading = isBusinessSpace
    ? 'Business timeline'
    : person ? `${firstName(person.name)}’s timeline` : 'Life timeline';

  // Importing is a family/person thing: the business timeline has its own
  // milestones list and no people to tag.
  const canImport = canEdit && !isBusinessSpace;

  const rowProps = {
    members, documents, canEdit, isBusinessSpace,
    onEdit: (id: string) => { setEditId(id); setAdding(false); },
    onDelete: deleteMoment,
    onTag: tagMoment,
    onOpenPhoto: setPhotoView,
    onOpenHealth, onOpenView, onOpenMemberTab,
  };

  const renderRow = (item: LifeTimelineItem) => {
    if (item.editable && editId === item.sourceId) {
      const entry = entries.find((e) => e.id === item.sourceId);
      if (entry) {
        return (
          <MomentForm
            initial={entry}
            members={members}
            documents={documents}
            defaults={formDefaults}
            demo={demo}
            isBusinessSpace={isBusinessSpace}
            onSave={saveMoment}
            onCancel={() => setEditId(null)}
          />
        );
      }
    }
    return <LifeRow item={item} {...rowProps} />;
  };

  const visualSource = [...shown.upcoming, ...flat.map(f => f.item), ...shown.undated];
  const categoryMap: Record<LifeCategory, TimelineCategory> = { milestone: 'memories', memory: 'memories', medical: 'medical', holiday: 'travel', school: 'education', home: 'addresses', work: 'calendar', papers: 'calendar', other: 'memories' };
  const toVisualItem = (item: LifeTimelineItem): FamilyTimelineItem => ({
    id: item.id, category: item.profileTab === 'growth' ? 'growth' : categoryMap[item.category],
    date: item.precision === 'year' ? item.date.slice(0, 4) : item.precision === 'month' ? item.date.slice(0, 7) : item.date,
    dateLabel: lifeDateLabel(item), title: item.title, note: item.note, memberIds: item.memberIds,
    sourceLabel: item.detail || CATEGORY_ONE[item.category], imageUrl: item.imageUrl || item.photos?.[0]?.url,
    endDate: item.endDate, rangeLabel: item.title,
  });
  const visualItems = visualSource.map(toVisualItem);
  const domainItems = [...scoped.upcoming, ...scoped.years.flatMap(y => y.items), ...scoped.undated].map(toVisualItem);

  return (
    <div className="space-y-6 font-sans">
      {!emberMode && !memberId && <div className="card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-clay-100 text-clay-700 shrink-0">
            <CalendarHeart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">{heading}</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              {isBusinessSpace
                ? 'Milestones, moments and dated papers — the business’s story in one line.'
                : 'Moments you add, plus health records, trips, travel and dated documents from across the app.'}
            </p>
          </div>
        </div>
      </div>}

      {!visual && emberMode && !memberId && (
        <>
          <section className="ember-story-stage">
            <div className="ember-story-year">
              <span>Our year</span>
              <strong>{latestYear}</strong>
              <p>{chapterEntries.length ? `${chapterEntries.length} ${chapterEntries.length === 1 ? 'moment' : 'moments'} kept by the ${isBusinessSpace ? 'team' : 'family'}` : 'A chapter waiting for its first moment'}</p>
            </div>
            <div className="ember-story-feature">
              <span className="pulse-eyebrow">{featured ? `${CATEGORY_ONE[featured.category]} · latest chapter` : 'Your first chapter'}</span>
              <h2>{featured?.title || 'What should this year remember?'}</h2>
              <p>{featured?.note || 'Keep the small story while the words are still close.'}</p>
              {canEdit && (
                <button type="button" onClick={() => setLocalAddSignal(signal => signal + 1)} className="btn-primary">
                  <Plus className="h-4 w-4" /> Add to this chapter
                </button>
              )}
            </div>
            <div className="ember-story-orbit" aria-hidden="true"><i /><i /><i /></div>
          </section>
          {chapterEntries.length > 0 && (
            <div className="ember-story-strip" aria-label={`${latestYear} chapter highlights`}>
              {chapterEntries.slice(0, 4).map(entry => (
                <article key={entry.id}>
                  <span>{lifeDateLabel(entry).replace(/\s?\d{4}$/, '') || String(latestYear)}</span>
                  <b>{entry.title}</b>
                  <small>{CATEGORY_ONE[entry.category]}</small>
                </article>
              ))}
            </div>
          )}
          {canEdit && (
            <section className="ember-story-prompt">
              <div><span className="pulse-eyebrow">{isBusinessSpace ? 'A small prompt for the team' : 'A small prompt for everyone'}</span><b>{isBusinessSpace ? 'What changed for the business this year?' : 'What did this year feel like?'}</b></div>
              <button type="button" onClick={() => setLocalAddSignal(signal => signal + 1)}>Keep the answer <Plus className="h-4 w-4" /></button>
            </section>
          )}
        </>
      )}

      <div className={memberId ? 'space-y-5' : 'card p-5 sm:p-6 space-y-5'}>
        {/* Filters. People first — "whose story?" — then what kind of moment. */}
        <div className="space-y-2.5">
          {!memberId && !isBusinessSpace && members.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Whose timeline">
              <button
                type="button"
                onClick={() => setPersonId('')}
                className={`tab-pill text-[12.5px] shrink-0 ${!person ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                aria-pressed={!person}
              >
                Everyone
              </button>
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPersonId(m.id)}
                  className={`tab-pill text-[12.5px] shrink-0 inline-flex items-center gap-1.5 ${person?.id === m.id ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                  aria-pressed={person?.id === m.id}
                >
                  <span className={`w-2 h-2 rounded-full ${warmAvatarColor(m.avatarColor)}`} aria-hidden="true" />
                  {firstName(m.name)}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Kind of moment">
            <button
              type="button"
              onClick={() => { setCategory(''); setEnabledCategories(LIFE_CATEGORIES.map(c => c.id)); }}
              className={`tab-pill text-[12.5px] shrink-0 ${enabledCategories.length === LIFE_CATEGORIES.length ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
              aria-pressed={enabledCategories.length === LIFE_CATEGORIES.length}
            >
              All
            </button>
            {categories.filter((c) => counts[c.id] > 0 || c.id === category || (['holiday', 'work', 'school'].includes(c.id) && !isBusinessSpace)).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCategory(c.id)}
                className={`tab-pill text-[12.5px] shrink-0 ${enabledCategories.includes(c.id) ? 'tab-pill-active' : 'bg-cream-100 hover:bg-cream-200'}`}
                aria-pressed={enabledCategories.includes(c.id)}
              >
                {c.label}{counts[c.id] > 0 && <span className="ml-1 opacity-60 tabular-nums">{counts[c.id]}</span>}
              </button>
            ))}
          </div>
          {person && !isBusinessSpace && (
            <label className="inline-flex items-center gap-2 text-[12.5px] font-medium text-ink-600 cursor-pointer select-none">
              <input type="checkbox" className="accent-clay-600" checked={includeFamily} onChange={(e) => setIncludeFamily(e.target.checked)} />
              Include family moments from {person.birthdate ? `${firstName(person.name)}’s lifetime` : 'the family'}
            </label>
          )}
        </div>

        {category === 'holiday' && (
          <div className="rounded-2xl bg-dusk-50 border border-dusk-100 p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-dusk-600">Holidays</p>
              <p className="font-display text-lg font-semibold text-ink-900">
                {holidays.trips} {holidays.trips === 1 ? 'trip' : 'trips'}
                {holidays.countries.length > 0 && ` · ${holidays.countries.length} ${holidays.countries.length === 1 ? 'country' : 'countries'}`}
                {holidays.firstYear && ` since ${holidays.firstYear}`}
              </p>
            </div>
            {holidays.countries.length > 0 && (
              <p className="text-2xl leading-none" aria-label={`Countries: ${holidays.countries.join(', ')}`}>
                {holidays.countries.map((c) => flag(c)).join(' ')}
              </p>
            )}
            {onOpenView && !isBusinessSpace && (
              <button type="button" onClick={() => onOpenView('travelTimeline')} className="btn-quiet text-xs px-3 py-1.5 ml-auto">
                <Plane className="w-3.5 h-3.5" /> Travel timeline
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-cream-200">
          <h3 className="section-label">{category ? CATEGORY_LABEL[category] : memberId ? heading : 'Moments'}</h3>
          {canEdit && (
            <div className="flex items-center gap-2">
              {canImport && (
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="btn-quiet text-xs px-3 py-1.5"
                >
                  <CalendarPlus className="w-3.5 h-3.5" /> Build my timeline
                </button>
              )}
              <button
                onClick={() => { setAdding(true); setEditId(null); }}
                className="btn-primary text-xs px-3 py-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add moment
              </button>
            </div>
          )}
        </div>

        {lastImport && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-sage-200 bg-sage-50 px-4 py-2.5" role="status">
            <p className="text-[13px] font-semibold text-sage-800">
              Added {lastImport.count} {lastImport.count === 1 ? 'moment' : 'moments'}
            </p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={undoImport} className="btn-quiet text-xs px-3 py-1.5">
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
              <button type="button" onClick={() => setLastImport(null)} className="p-1.5 text-sage-700 hover:bg-sage-100 rounded-lg" aria-label="Dismiss">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {adding && (
          <MomentForm
            members={members}
            documents={documents}
            defaults={formDefaults}
            demo={demo}
            isBusinessSpace={isBusinessSpace}
            onSave={saveMoment}
            onCancel={() => setAdding(false)}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="story-scale" role="group" aria-label="Timeline presentation"><button type="button" aria-pressed={visual} onClick={() => setVisual(true)}>Visual timeline</button><button type="button" aria-pressed={!visual} onClick={() => setVisual(false)}>All records</button></div>
          <label><span className="sr-only">Search timeline</span><input className="field text-sm" placeholder="Search timeline…" value={search} onChange={e => setSearch(e.target.value)} /></label>
        </div>
        {visual && <VisualTimeline items={visualItems} domainItems={domainItems} members={members} isBusinessSpace={isBusinessSpace} renderDetails={item => renderRow(visualSource.find(source => source.id === item.id)!)} />}
        {!visual && (total === 0 && !adding ? (
          <EmptyState
            icon={CalendarHeart}
            title={category ? `No ${CATEGORY_LABEL[category].toLowerCase()} yet` : 'No moments yet'}
            description={isBusinessSpace
              ? 'Add the first customer, a new location, a licence — the business’s story starts with one moment.'
              : 'Add a birth, a holiday, a first day at school, a broken arm. Trips, health records and dated documents appear here by themselves.'}
            action={canEdit ? { label: 'Add moment', onClick: () => { setAdding(true); setEditId(null); }, icon: Plus } : undefined}
          />
        ) : (
          <div className="space-y-5">
            {shown.upcoming.length > 0 && (
              <section className="space-y-3" aria-label="Coming up">
                <p className="text-[11px] font-bold uppercase tracking-wide text-clay-600">Coming up</p>
                {shown.upcoming.map((item) => <div key={item.id}>{renderRow(item)}</div>)}
              </section>
            )}

            {flat.length > 0 && (
              <div className="relative space-y-4 pt-1">
                {flat.map(({ item, year }, idx) => (
                  <div key={item.id} className="relative">
                    {emberMode && (idx === 0 || flat[idx - 1].year !== year) && (
                      <div className="ember-story-chapter">
                        <span>{year}</span>
                        <i>{((n) => `${n} moment${n === 1 ? '' : 's'}`)(flat.filter(f => f.year === year).length)}</i>
                      </div>
                    )}
                    {!emberMode && (idx === 0 || flat[idx - 1].year !== year) && (
                      <div className="flex items-baseline gap-2 pt-2 pb-1">
                        <span className="font-display text-xl font-semibold text-ink-900 tabular-nums">{year}</span>
                        <span className="text-[12px] text-ink-400 font-medium">{flat.filter(f => f.year === year).length}</span>
                      </div>
                    )}
                    {renderRow(item)}
                  </div>
                ))}
              </div>
            )}

            {shown.undated.length > 0 && (
              <section className="space-y-3" aria-label="Undated">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Date not known</p>
                {shown.undated.map((item) => <div key={item.id}>{renderRow(item)}</div>)}
              </section>
            )}
          </div>
        ))}
        {visual && total === 0 && <p className="text-sm text-ink-500 py-5">No moments match these filters. Turn a category on, change the search or add a moment.</p>}
      </div>

      {!memberId && (
        <div className="text-center">
          <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
            {cloudSynced === false ? (
              <><CloudOff className="w-3.5 h-3.5 text-honey-700" /><span>Saved on this device — cloud sync unavailable</span></>
            ) : (
              <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your {isBusinessSpace ? 'team' : 'family'}{cloudSynced ? ' · synced' : ''}</span></>
            )}
          </div>
        </div>
      )}

      <ImageLightbox src={photoView} onClose={() => setPhotoView(null)} name="Timeline photo" />
      {canImport && (
        <TimelineImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          members={members}
          documents={timelineDocumentSources(members, documents, person?.id)}
          existing={[...result.upcoming,...result.years.flatMap(y=>y.items),...result.undated].map(i=>({id:i.id,date:i.date,datePrecision:i.precision === 'day' ? undefined : i.precision,title:i.title,memberIds:i.memberIds}))}
          defaultMemberId={person?.id}
          isBusinessSpace={isBusinessSpace}
          demo={demo}
          onImport={importMoments}
        />
      )}
    </div>
  );
}

/* --- One row --- */

function LifeRow({ item, members, documents, canEdit, isBusinessSpace, onEdit, onDelete, onTag, onOpenPhoto, onOpenHealth, onOpenView, onOpenMemberTab }: {
  item: LifeTimelineItem;
  members: FamilyMember[];
  documents: VaultDocument[];
  canEdit: boolean;
  isBusinessSpace: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTag: (id: string, memberId: string) => void;
  onOpenPhoto: (url: string) => void;
  onOpenMemberTab?: (memberId: string, tab: string) => void;
  onOpenHealth?: (memberId: string) => void;
  onOpenView?: (view: TimelineOpenTarget) => void;
}) {
  const style = CATEGORY_STYLE[item.category];
  const who = item.memberIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is FamilyMember => !!m);
  const docs = (item.docIds || [])
    .map((id) => documents.find((d) => d.id === id))
    .filter((d): d is VaultDocument => !!d && d.id !== item.sourceId);
  const where = [item.place, item.detail].filter(Boolean).join(' · ');
  // Only on the family's own moments, and only for someone who can edit them.
  const suggested = item.editable && canEdit && !isBusinessSpace && who.length === 0
    ? suggestMemberFromTitle(item, members)
    : null;
  const openTarget: TimelineOpenTarget | null =
    item.source === 'travel' ? 'travelTimeline'
      : item.source === 'trip' || item.source === 'event' ? 'calendar'
        : item.source === 'anniversary' ? 'anniversaries'
          : null;

  return (
    <div className="flex gap-3.5">
      <div className={`w-9 h-9 rounded-2xl grid place-items-center shrink-0 ${style.dot}`} aria-hidden="true">
        <style.Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="font-mono tabular-nums text-[12px] font-semibold text-ink-500">{lifeDateLabel(item)}</span>
              <span className={`chip ${style.chip}`}>{CATEGORY_ONE[item.category]}</span>
              {item.countryCode && <span className="text-[15px] leading-none" aria-hidden="true">{flag(item.countryCode)}</span>}
            </div>
            <p className="text-[15px] font-display font-semibold text-ink-900 break-words">{item.title}</p>
            {where && (
              <p className="text-[12.5px] text-ink-500 font-medium flex items-center gap-1 mt-0.5">
                {item.place && <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />}
                <span className="truncate">{where}</span>
              </p>
            )}
            {item.note && <p className="text-[13px] text-ink-600 leading-relaxed mt-1 whitespace-pre-line">{item.note}</p>}
          </div>
          {item.editable && canEdit && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onEdit(item.sourceId)}
                className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg"
                title="Edit"
                aria-label={`Edit "${item.title}"`}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <ConfirmDeleteButton
                onConfirm={() => onDelete(item.sourceId)}
                ariaLabel={`Delete "${item.title || 'this'}" from the timeline`}
              />
            </div>
          )}
        </div>

        {item.imageUrl && <img src={item.imageUrl} alt={item.title} className="max-h-56 rounded-xl object-contain mt-3" loading="lazy" />}
        {item.profileTab && item.memberIds[0] && onOpenMemberTab && <button type="button" className="btn-quiet text-xs mt-2" onClick={() => onOpenMemberTab(item.memberIds[0], item.profileTab!)}>Open {item.profileTab}<ExternalLink className="w-3 h-3" /></button>}
        {item.photos && item.photos.length > 0 && (
          <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
            {item.photos.map((p) => (
              <button key={p.url} type="button" onClick={() => onOpenPhoto(p.url)} className="shrink-0 rounded-xl overflow-hidden border border-cream-200" aria-label="Open photo">
                <img src={p.url} alt="" loading="lazy" className="w-20 h-20 object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {!isBusinessSpace && (who.length > 0
            ? who.map((m) => (
              <span key={m.id} className="chip bg-cream-100 text-ink-600 inline-flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${warmAvatarColor(m.avatarColor)}`} aria-hidden="true" />
                {firstName(m.name)}
              </span>
            ))
            : members.length > 1 && <span className="chip bg-cream-100 text-ink-500">Whole family</span>)}
          {suggested && (
            <button
              type="button"
              onClick={() => onTag(item.sourceId, suggested.id)}
              className="inline-flex items-center gap-1 rounded-full border border-clay-200 bg-clay-50 px-2.5 py-1 text-[11px] font-semibold text-clay-700 hover:bg-clay-100"
              aria-label={`Tag "${item.title}" as about ${firstName(suggested.name)}`}
            >
              <Tag className="w-3 h-3" aria-hidden="true" /> About {firstName(suggested.name)}? Tag
            </button>
          )}
          {docs.map((d) => (
            <a key={d.id} href={d.downloadUrl} target="_blank" rel="noopener noreferrer" className="chip bg-ink-50 text-ink-700 hover:bg-ink-100 inline-flex items-center gap-1">
              <Paperclip className="w-3 h-3" aria-hidden="true" /> {d.name}
            </a>
          ))}
          {item.fileUrl && (
            <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="chip bg-ink-50 text-ink-700 hover:bg-ink-100 inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" aria-hidden="true" /> {item.source === 'health' ? 'Open letter' : 'Open document'}
            </a>
          )}
          {item.source === 'health' && onOpenHealth && item.memberIds[0] && (
            <button type="button" onClick={() => onOpenHealth(item.memberIds[0])} className="chip bg-rosa-50 text-rosa-700 hover:bg-rosa-100 inline-flex items-center gap-1">
              <HeartPulse className="w-3 h-3" aria-hidden="true" /> Health timeline
            </button>
          )}
          {openTarget && onOpenView ? (
            <button type="button" onClick={() => onOpenView(openTarget)} className="text-[11.5px] font-semibold text-ink-400 hover:text-ink-700 underline-offset-2 hover:underline">
              from {SOURCE_LABEL[item.source]}
            </button>
          ) : !item.editable && (
            <span className="text-[11.5px] font-semibold text-ink-400">from {SOURCE_LABEL[item.source]}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Add / edit a moment --- */

function MomentForm({ initial, members, documents, defaults, demo, isBusinessSpace, onSave, onCancel }: {
  initial?: TimelineEntry;
  members: FamilyMember[];
  documents: VaultDocument[];
  defaults: { memberIds: string[]; category: LifeCategory };
  demo: boolean;
  isBusinessSpace: boolean;
  onSave: (entry: TimelineEntry, newPhotos: string[], removed: TimelinePhoto[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title || '');
  const [precision, setPrecision] = useState<'day' | 'month' | 'year'>(initial?.datePrecision || 'day');
  const [date, setDate] = useState(initial?.date || '');
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [visual, setVisual] = useState(true);
  const [enabledCategories, setEnabledCategories] = useState<LifeCategory[]>(LIFE_CATEGORIES.map(c => c.id));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<LifeCategory>(initial ? categoryOfEntry(initial) : defaults.category);
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds || defaults.memberIds);
  const [place, setPlace] = useState(initial?.place || '');
  const [note, setNote] = useState(initial?.note || '');
  const [photos, setPhotos] = useState<TimelinePhoto[]>(initial?.photos || []);
  const [removed, setRemoved] = useState<TimelinePhoto[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [docIds, setDocIds] = useState<string[]>(initial?.docIds || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const categories = LIFE_CATEGORIES.filter((c) => !(isBusinessSpace && c.id === 'medical'));
  const photoCount = photos.length + pending.length;

  // Papers belonging to the people this moment is about come first.
  const docOptions = [...documents]
    .filter((d) => !docIds.includes(d.id))
    .sort((a, b) => {
      const rank = (d: VaultDocument) => (d.memberId && memberIds.includes(d.memberId) ? 0 : d.memberId ? 2 : 1);
      return rank(a) - rank(b) || (b.docDate || b.uploadedAt).localeCompare(a.docDate || a.uploadedAt);
    });

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - photoCount;
    const picked = [...files].filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    try {
      const compressed = await Promise.all(picked.map(async (f) => compressImageToAvatar(await readFileAsDataUrl(f), 1600, 0.85)));
      setPending((p) => [...p, ...compressed]);
    } catch (e) {
      console.error('Photo could not be read:', e);
      setError('That photo could not be read. Try a JPEG or PNG.');
    }
  };

  const normalisedDate = (): string => {
    if (precision === 'year') return /^\d{4}/.test(date) ? `${date.slice(0, 4)}-01-01` : '';
    if (precision === 'month') return /^\d{4}-\d{2}/.test(date) ? `${date.slice(0, 7)}-01` : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
  };

  const save = async () => {
    const d = normalisedDate();
    if (!title.trim() || !d) {
      setError('A moment needs a title and a date — even just a year.');
      return;
    }
    const end = precision === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > d ? endDate : undefined;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        id: initial?.id || newId(),
        date: d,
        title: title.trim(),
        // An edited legacy entry is now described by its category; the old
        // type would only disagree with it.
        type: undefined,
        category,
        note: note.trim() || undefined,
        memberIds: memberIds.length ? memberIds : undefined,
        endDate: end,
        datePrecision: precision === 'day' ? undefined : precision,
        place: place.trim() || undefined,
        photos: photos.length ? photos : undefined,
        docIds: docIds.length ? docIds : undefined,
      }, pending, removed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this moment.');
      setBusy(false);
    }
  };

  const toggleMember = (id: string) =>
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-3">
      <div>
        <label className="field-label" htmlFor="moment-title">What happened</label>
        <input
          id="moment-title"
          autoFocus
          className="field"
          placeholder={isBusinessSpace ? 'e.g. First customer' : 'e.g. Broke an arm at the playground'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr] gap-2.5">
        <div>
          <label className="field-label" htmlFor="moment-precision">How exact</label>
          <select id="moment-precision" className="field" value={precision} onChange={(e) => setPrecision(e.target.value as 'day' | 'month' | 'year')}>
            <option value="day">Exact day</option>
            <option value="month">Month only</option>
            <option value="year">Year only</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="moment-date">When</label>
          {precision === 'day' && (
            <input id="moment-date" type="date" className="field" value={date.length === 10 ? date : ''} onChange={(e) => setDate(e.target.value)} />
          )}
          {precision === 'month' && (
            <input id="moment-date" type="month" className="field" value={date.slice(0, 7)} onChange={(e) => setDate(e.target.value)} />
          )}
          {precision === 'year' && (
            <input id="moment-date" type="number" inputMode="numeric" min={1900} max={2100} placeholder="e.g. 2009" className="field" value={date.slice(0, 4)} onChange={(e) => setDate(e.target.value)} />
          )}
        </div>
        {precision === 'day' && (
          <div>
            <label className="field-label" htmlFor="moment-end">Until (optional)</label>
            <input id="moment-end" type="date" className="field" min={date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        )}
      </div>

      <div>
        <span className="field-label">Kind</span>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`chip ${category === c.id ? CATEGORY_STYLE[c.id].chip + ' ring-2 ring-offset-1 ring-clay-300' : 'bg-white text-ink-500 border border-cream-200'}`}
              aria-pressed={enabledCategories.includes(c.id)}
            >
              {CATEGORY_ONE[c.id]}
            </button>
          ))}
        </div>
      </div>

      {members.length > 0 && (
        <div>
          <span className="field-label">{isBusinessSpace ? 'Who (optional)' : 'Who it’s about — none means the whole family'}</span>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMember(m.id)}
                className={`chip inline-flex items-center gap-1 ${memberIds.includes(m.id) ? 'bg-ink-800 text-white' : 'bg-white text-ink-600 border border-cream-200'}`}
                aria-pressed={memberIds.includes(m.id)}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${warmAvatarColor(m.avatarColor)}`} aria-hidden="true" />
                {firstName(m.name)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="field-label" htmlFor="moment-place">Where (optional)</label>
        <input id="moment-place" className="field" placeholder="e.g. the children’s hospital, or the beach house" value={place} onChange={(e) => setPlace(e.target.value)} />
      </div>

      <div>
        <label className="field-label" htmlFor="moment-note">Details (optional)</label>
        <textarea
          id="moment-note"
          className="field resize-none"
          placeholder="What you want to remember — who was there, what was said, how it went…"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div>
        <span className="field-label">Photos</span>
        <div className="flex gap-2 flex-wrap">
          {photos.map((p) => (
            <div key={p.url} className="relative">
              <img src={p.url} alt="" className="w-16 h-16 rounded-xl object-cover border border-cream-200" />
              <button type="button" onClick={() => { setPhotos((ps) => ps.filter((x) => x.url !== p.url)); setRemoved((r) => [...r, p]); }}
                className="absolute -top-1.5 -right-1.5 bg-white rounded-full p-0.5 shadow-soft text-ink-500 hover:text-rosa-700" aria-label="Remove photo">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {pending.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt="" className="w-16 h-16 rounded-xl object-cover border border-cream-200 opacity-90" />
              <button type="button" onClick={() => setPending((ps) => ps.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 bg-white rounded-full p-0.5 shadow-soft text-ink-500 hover:text-rosa-700" aria-label="Remove photo">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {photoCount < MAX_PHOTOS && (
            <button
              type="button"
              disabled={demo}
              onClick={() => fileRef.current?.click()}
              className="w-16 h-16 rounded-xl border-2 border-dashed border-cream-300 text-ink-400 hover:text-ink-700 hover:border-clay-300 grid place-items-center disabled:opacity-40"
              aria-label="Add photos"
              title={demo ? 'Photos are not available in the demo' : 'Add photos'}
            >
              <ImagePlus className="w-5 h-5" />
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
      </div>

      {documents.length > 0 && (
        <div>
          <label className="field-label" htmlFor="moment-doc">Papers (optional)</label>
          {docIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {docIds.map((id) => {
                const d = documents.find((x) => x.id === id);
                return (
                  <span key={id} className="chip bg-ink-50 text-ink-700 inline-flex items-center gap-1">
                    <Paperclip className="w-3 h-3" aria-hidden="true" /> {d?.name || 'Removed document'}
                    <button type="button" onClick={() => setDocIds((ids) => ids.filter((x) => x !== id))} aria-label={`Unlink ${d?.name || 'document'}`} className="text-ink-400 hover:text-ink-800">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <select
            id="moment-doc"
            className="field"
            value=""
            onChange={(e) => { const id = e.target.value; if (id) setDocIds((ids) => [...ids, id]); }}
          >
            <option value="">Link a document from the vault…</option>
            {docOptions.map((d) => {
              const owner = d.memberId ? members.find((m) => m.id === d.memberId) : undefined;
              return <option key={d.id} value={d.id}>{d.name}{owner ? ` — ${firstName(owner.name)}` : ''}</option>;
            })}
          </select>
        </div>
      )}

      {error && <p className="text-[12.5px] font-semibold text-rosa-700" role="alert">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="btn-quiet text-xs px-3 py-1.5">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button onClick={() => void save()} disabled={busy} className="btn-primary text-xs px-3 py-1.5">
          <Check className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
