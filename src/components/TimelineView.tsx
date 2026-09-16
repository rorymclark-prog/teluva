import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarHeart, Plus, Search, SlidersHorizontal, HeartPulse, GraduationCap, MapPin, TrendingUp, Plane, CalendarDays } from 'lucide-react';
import type { CalendarEvent, FamilyMember, FamilyTimeline, TimelineEntry, TravelTimelineDoc, VaultDocument } from '../types';
import { loadTimeline, saveTimeline, loadTravelTimeline, loadDocuments } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { buildFamilyTimeline, filterFamilyTimeline, TIMELINE_CATEGORIES, TIMELINE_LABELS, type FamilyTimelineItem, type TimelineCategory } from '../utils/familyTimeline';
import VisualTimeline from './VisualTimeline';

const ICONS = { memories: CalendarHeart, medical: HeartPulse, education: GraduationCap, addresses: MapPin, growth: TrendingUp, travel: Plane, calendar: CalendarDays };
const STYLES: Record<TimelineCategory, string> = {
  memories: 'bg-clay-100 text-clay-700', medical: 'bg-rosa-100 text-rosa-700', education: 'bg-sage-100 text-sage-700',
  addresses: 'bg-honey-100 text-honey-900', growth: 'bg-sage-100 text-sage-700', travel: 'bg-dusk-100 text-dusk-700', calendar: 'bg-cream-200 text-ink-700',
};
const TYPES = ['Birth', 'Wedding', 'Graduation', 'Milestone', 'Memory', 'Other'];


export default function TimelineView({ members = [], events = [], openAddSignal = 0, emberMode = false, canEdit = false, demo = false, spaceId = '', onOpenRecord }: {
  key?: number; members?: FamilyMember[]; events?: CalendarEvent[]; openAddSignal?: number; emberMode?: boolean;
  canEdit?: boolean; demo?: boolean; spaceId?: string; onOpenRecord?: (target: NonNullable<FamilyTimelineItem['target']>) => void;
}) {
  const [timeline, setTimeline] = useState<FamilyTimeline>({ entries: [] });
  const [travel, setTravel] = useState<TravelTimelineDoc>({ entries: [] });
  const [vault, setVault] = useState<VaultDocument[]>([]);
  const [loaded, setLoaded] = useState(demo);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [editor, setEditor] = useState<TimelineEntry | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const preferencesKey = `teluva-timeline-categories:${demo ? 'demo' : spaceId}`;
  const [categories, setCategories] = useState<TimelineCategory[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(preferencesKey) || 'null');
      if (Array.isArray(saved)) return saved.filter(c => TIMELINE_CATEGORIES.includes(c));
    } catch { /* Use all categories if saved preferences are unavailable. */ }
    return [...TIMELINE_CATEGORIES];
  });
  const current = useRef(timeline); current.current = timeline;
  useEffect(() => {
    if (demo) return;
    let active = true;
    Promise.allSettled([loadTimeline(), loadTravelTimeline(), loadDocuments()]).then(([story, trips, documents]) => {
      if (!active) return;
      if (story.status === 'fulfilled') { setTimeline(story.value || { entries: [] }); setLoaded(true); }
      else setLoadError('Saved memories could not be loaded. Reload to try again.');
      if (documents.status === 'fulfilled') setVault(documents.value || []);
      else setLoadError(old => `${old} Linked vault previews could not be loaded.`.trim());
      if (trips.status === 'fulfilled') setTravel(trips.value || { entries: [] });
      else setLoadError(old => `${old} Travel history could not be loaded.`.trim());
    });
    return () => { active = false; };
  }, [demo]);
  useSharedDoc<FamilyTimeline>('timeline', value => { setTimeline(value); setLoaded(true); }, { disabled: demo, hold: !!editor || busy });
  useSharedDoc<{ docs: VaultDocument[] }>('documents', value => setVault(value.docs || []), { disabled: demo });
  useSharedDoc<TravelTimelineDoc>('travelTimeline', setTravel, { disabled: demo });
  useEffect(() => { if (openAddSignal && canEdit) setEditor('new'); }, [openAddSignal, canEdit]);
  useEffect(() => { try { localStorage.setItem(preferencesKey, JSON.stringify(categories)); } catch { /* Device preference only. */ } }, [categories, preferencesKey]);

  const all = useMemo(() => buildFamilyTimeline({ members, events, memories: timeline.entries, travel: travel.entries, vault }), [members, events, timeline, travel, vault]);
  const visible = filterFamilyTimeline(all, { categories, memberId, search, oldestFirst: true });
  const matching = filterFamilyTimeline(all, { categories: [...TIMELINE_CATEGORIES], memberId, search });
  const personName = (id: string) => members.find(m => m.id === id)?.name || 'Family member';
  const persist = async (entries: TimelineEntry[]) => {
    if (!canEdit || !loaded) return;
    const next = { ...current.current, entries };
    setSaveError(''); setBusy(true);
    try {
      const ok = demo || await saveTimeline(next);
      setTimeline(next); setCloudSynced(ok); setEditor(null);
    } catch { setSaveError('Could not save this moment. Please try again.'); }
    finally { setBusy(false); }
  };
  const reset = () => { setCategories([...TIMELINE_CATEGORIES]); setMemberId(''); setSearch(''); };

  const filterControls = <>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Timeline categories">
        {TIMELINE_CATEGORIES.map(category => {
          const Icon = ICONS[category]; const enabled = categories.includes(category);
          return <button key={category} type="button" aria-pressed={enabled} onClick={() => setCategories(old => enabled ? old.filter(c => c !== category) : [...old, category])}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${enabled ? `${STYLES[category]} border-transparent` : 'border-cream-300 text-ink-400 bg-cream-50'}`}>
            <Icon className="w-4 h-4" />{TIMELINE_LABELS[category]}<span className="tabular-nums">{matching.filter(i => i.category === category).length}</span>
          </button>;
        })}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <label><span className="field-label">Person</span><select className="field" value={memberId} onChange={e => setMemberId(e.target.value)}><option value="">Whole family</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label><span className="field-label">Search timeline</span><div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-ink-400" /><input className="field pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="School, home, appointment…" /></div></label>

      </div>
      <div className="flex justify-between items-center gap-2 mt-4"><p className="text-xs text-ink-500" aria-live="polite">{visible.length} {visible.length === 1 ? 'record' : 'records'} across your history{memberId ? ` for ${personName(memberId)}` : ''}</p><button type="button" className="btn-quiet text-xs" onClick={reset}>Reset filters</button></div>
  </>;

  return <div className="space-y-5 font-sans">
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="font-display text-xl font-semibold text-ink-900">{emberMode ? 'Choose your chapters' : 'Family timeline'}</h2>
          <p className="text-xs text-ink-500 mt-1">{visible.length} moments across your history · {categories.length} categories shown</p></div>
        <div className="flex items-center gap-2"><button type="button" className="btn-quiet text-sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal className="w-4 h-4" />Filters</button>{canEdit && loaded && !editor && <button type="button" onClick={() => setEditor('new')} className="btn-primary text-sm"><Plus className="w-4 h-4" /> Add moment</button>}</div>
      </div>
      {filtersOpen && filterControls}
    </section>
    {loadError && <p role="alert" className="text-sm text-rosa-700">{loadError}</p>}
    {!loaded && !loadError && <p role="status" className="text-sm text-ink-500">Loading saved memories…</p>}
    {cloudSynced === false && <p role="status" className="text-sm text-honey-900">Saved on this device — cloud sync unavailable.</p>}
    {saveError && <p role="alert" className="text-sm text-rosa-700">{saveError}</p>}
    {editor && canEdit && loaded && <MomentForm key={editor === 'new' ? 'new' : editor.id} initial={editor === 'new' ? undefined : editor} members={members} busy={busy}
      onCancel={() => setEditor(null)} onSave={entry => persist(current.current.entries.some(e => e.id === entry.id)
        ? current.current.entries.map(e => e.id === entry.id ? entry : e) : [...current.current.entries, entry])} />}
    {!visible.length && <div className="card p-8 text-center"><CalendarHeart className="w-8 h-8 text-clay-500 mx-auto mb-3" /><h3 className="font-semibold text-ink-900">{all.length ? 'No records match these filters' : 'Your story starts here'}</h3><p className="text-sm text-ink-500 mt-2">{all.length ? 'Turn a category back on, choose another person or reset your filters.' : 'Add a memory or save education, address and health records on a profile.'}</p></div>}
    {!!all.length && <VisualTimeline filters={filterControls} items={visible} members={members} onOpenRecord={onOpenRecord} busy={busy}
      onEdit={canEdit && loaded && !editor ? setEditor : undefined}
      onDelete={canEdit && loaded && !editor ? entry => persist(current.current.entries.filter(e => e.id !== entry.id)) : undefined} />}
  </div>;
}

function MomentForm({ initial, members, onSave, onCancel, busy }: {
  key?: string; initial?: TimelineEntry; members: FamilyMember[]; onSave: (entry: TimelineEntry) => Promise<void>; onCancel: () => void; busy: boolean;
}) {
  const [draft, setDraft] = useState<TimelineEntry>(initial || { id: crypto.randomUUID(), date: '', title: '', type: 'Memory', memberIds: [] });
  const [error, setError] = useState('');
  return <form className="card p-5 space-y-4" onSubmit={e => { e.preventDefault(); if (!draft.title.trim()) { setError('Please add a title.'); return; } void onSave({ ...draft, title: draft.title.trim() }); }}>
    <h3 className="font-semibold text-ink-900">{initial ? 'Edit moment' : 'Add a family moment'}</h3>
    <fieldset disabled={busy} className="space-y-3 min-w-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label><span className="field-label">Date *</span><input type="date" required className="field" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label>
        <label><span className="field-label">Type</span><select className="field" value={draft.type || 'Memory'} onChange={e => setDraft({ ...draft, type: e.target.value })}>{[...new Set([...TYPES, draft.type || 'Memory'])].map(t => <option key={t}>{t}</option>)}</select></label></div>
      <label className="block"><span className="field-label">Title *</span><input required className="field" maxLength={300} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label className="block"><span className="field-label">Notes</span><textarea className="field" rows={3} maxLength={10000} value={draft.note || ''} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
      <fieldset><legend className="field-label">People (optional)</legend><div className="flex flex-wrap gap-3">{members.map(m => <label key={m.id} className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={(draft.memberIds || []).includes(m.id)} onChange={e => setDraft({ ...draft, memberIds: e.target.checked ? [...(draft.memberIds || []), m.id] : draft.memberIds?.filter(id => id !== m.id) })} />{m.name}</label>)}</div></fieldset>
      {error && <p role="alert" className="text-sm text-rosa-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-quiet text-sm" onClick={onCancel}>Cancel</button><button className="btn-primary text-sm" type="submit">{busy ? 'Saving…' : 'Save moment'}</button></div>
    </fieldset>
  </form>;
}
