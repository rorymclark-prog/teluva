import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Globe2, Loader2, MapPin, Pencil, Plus, X } from 'lucide-react';
import type { FamilyMember, TravelTimelineDoc, TravelTimelineEntry } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth } from '../lib/firebase';
import { FAMILY_ID, loadTravelTimeline, saveTravelTimeline, uploadTravelPhoto } from '../utils/db';
import { createFileOperationScope, type FileOperationScope } from '../utils/fileOperationScope';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { ATLAS_KINDS, atlasCountry, atlasDate, atlasDateFromInput, atlasDateInput, atlasDateLabel, atlasKind, atlasTitle, changeAtlasPrecision, filterAtlas, hasAtlasPoint, prepareAtlasPhotoDrafts, readAtlasPhotoMetadata, validateAtlasEntry, type AtlasPhotoDraft } from '../utils/lifeAtlas';
import { createAtlasCover } from '../utils/atlasCover';
import { pickGooglePhotos } from '../utils/googlePhotosPicker';
import { authorizePhotos, preparePhotosAuthorization } from '../utils/photosAuthorization';
import LifeAtlasMap from './LifeAtlasMap';
import RemoteChangeHint from './RemoteChangeHint';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import ImageLightbox from './ImageLightbox';

const EMPTY: TravelTimelineDoc = { entries: [] };
const blankEntry = (): TravelTimelineEntry => ({ id: crypto.randomUUID(), country: '', date: '', kind: 'visit', source: 'manual' });
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Your draft is still here.';
const field = 'field min-w-0 min-h-[44px]';

export default function LifeAtlasView({ members = [] }: { members?: FamilyMember[] }) {
  const ctx = useFamilyCtx();
  if (ctx.loading) return <p role="status" className="p-6 text-ink-500">Opening your Life Atlas…</p>;
  if (ctx.spaces.find(space => space.id === ctx.familyId)?.type === 'business') return <p className="card p-6 text-ink-600">Open your family space to explore the Life Atlas.</p>;
  return <div key={`${ctx.uid}:${ctx.familyId}:${ctx.role}`}><LifeAtlasBody members={members} /></div>;
}

function LifeAtlasBody({ members }: { members: FamilyMember[] }) {
  const ctx = useFamilyCtx(), latest = useRef(ctx); latest.current = ctx;
  const mounted = useRef(true), epoch = useRef(0), working = useRef(false);
  const [doc, setDoc] = useState<TravelTimelineDoc>(EMPTY), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<TravelTimelineEntry | null>(null), [review, setReview] = useState<AtlasPhotoDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string>(), [placing, setPlacing] = useState(false), [lightbox, setLightbox] = useState<string | null>(null);
  const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [year, setYear] = useState(''), [unmapped, setUnmapped] = useState(false);
  const [peopleMode, setPeopleMode] = useState<'family' | 'individuals'>('family'), [people, setPeople] = useState<string[]>([]);
  const [pickerUri, setPickerUri] = useState('');
  const [coverMeta, setCoverMeta] = useState<Partial<TravelTimelineEntry> | null>(null);
  const coverInput = useRef<HTMLInputElement>(null), coverScope = useRef<FileOperationScope | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const docRef = useRef(doc); docRef.current = doc;
  const base = useRef<TravelTimelineDoc>(EMPTY), input = useRef<HTMLInputElement>(null), pendingFile = useRef<FileOperationScope | null>(null);
  const abort = useRef<AbortController | null>(null);
  const current = () => mounted.current && !!latest.current.uid && latest.current.uid === auth.currentUser?.uid && latest.current.familyId === FAMILY_ID;
  const canEdit = ctx.canWrite && !ctx.loading;
  const capture = () => createFileOperationScope(() => [auth.currentUser?.uid, FAMILY_ID, latest.current.uid, latest.current.familyId, latest.current.role, latest.current.loading, latest.current.canWrite, mounted.current, epoch.current]);
  useEffect(() => {
    mounted.current = true;
    const scope = capture();
    void scope.step(loadTravelTimeline).then(value => { if (current()) { setDoc(value?.entries ? value : EMPTY); setLoaded(true); } }).catch(error => { if (scope.isCurrent()) { setError(message(error)); setLoaded(true); } });
    void preparePhotosAuthorization().then(ready => { if (mounted.current) setGoogleReady(ready); });
    return () => { mounted.current = false; epoch.current++; abort.current?.abort(); };
  }, []);
  const remoteWaiting = useSharedDoc<TravelTimelineDoc>('travelTimeline', value => { if (current()) setDoc({ entries: value.entries || [] }); }, { hold: !!draft || review.length > 0 || busy, disabled: !ctx.uid || !ctx.familyId });
  const visible = useMemo(() => filterAtlas(doc.entries, { query, kind, year, memberIds: people, peopleOnly: peopleMode === 'individuals', unmapped }), [doc, query, kind, year, people, peopleMode, unmapped]);
  const years = [...new Set(doc.entries.map(entry => entry.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const selected = visible.find(entry => entry.id === selectedId);
  const resetEditor = () => { epoch.current++; pendingFile.current = null; coverScope.current = null; setCoverMeta(null); setDraft(null); setReview([]); setPlacing(false); setPickerUri(''); setError(''); };
  const openEntry = (entry?: TravelTimelineEntry) => {
    if (!canEdit || !current() || working.current) return;
    resetEditor(); base.current = structuredClone(docRef.current); setDraft(entry ? structuredClone(entry) : blankEntry());
  };
  const prepareFiles = async (files: File[], scope: FileOperationScope, googleDates?: Map<File, string | undefined>) => {
    if (!scope.isCurrent() || !current() || !latest.current.canWrite) return;
    const drafts = await prepareAtlasPhotoDrafts(files, { scope, thumbnail: createAtlasCover,
      metadata: googleDates ? async file => {
        const data = await readAtlasPhotoMetadata(file);
        // Google's downloaded EXIF date is more useful than its UTC-normalized
        // creation timestamp. Neither supplies a location through this API.
        return { date: data.date || atlasDate(googleDates.get(file)) || '', source: 'manual', country: '' };
      } : undefined,
      onProgress: (done, total) => { if (scope.isCurrent()) setStatus(`Preparing photo ${done} of ${total}…`); },
    });
    scope.check();
    setReview(drafts.map(value => ({ ...value, entry: { ...value.entry, title: value.entry.sourceFileName?.replace(/\.[^.]+$/, '') || 'A family memory' } })));
    setStatus('Review the covers, dates and places below. Nothing has been added to the Atlas yet.');
  };
  const importFiles = async (files: File[], scope: FileOperationScope) => {
    if (working.current || !canEdit || !scope.isCurrent() || !current()) return;
    working.current = true; setBusy(true); setError('');
    try { await prepareFiles(files, scope); }
    catch (error) { if (scope.isCurrent()) setError(message(error)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const attachCover = async (file: File, scope: FileOperationScope) => {
    if (working.current || !current() || !canEdit || !scope.isCurrent()) return;
    working.current = true; setBusy(true); setError(''); setStatus('Preparing your chosen cover…');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
      const metadata = await scope.step(() => readAtlasPhotoMetadata(file));
      const photoUrl = await scope.step(() => createAtlasCover(file));
      setDraft(old => old ? { ...old, photoUrl, photoStoragePath: undefined, sourceFileName: file.name } : old);
      setCoverMeta(metadata); setStatus('Cover prepared. Its capture date is not automatically the event date. Review the story, then save.');
    } catch (error) { if (scope.isCurrent()) setError(message(error)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const connectGoogle = async () => {
    if (working.current || !canEdit || !current()) return;
    resetEditor(); base.current = structuredClone(docRef.current);
    const scope = capture(), controller = new AbortController(); abort.current = controller;
    working.current = true; setBusy(true); setStatus('Connecting to Google Photos…');
    try {
      // authorizePhotos starts synchronously from this user gesture.
      const token = await scope.step(() => authorizePhotos(controller.signal));
      const photos = await pickGooglePhotos({ token, scope, signal: controller.signal, onPicker: setPickerUri, onStatus: setStatus });
      scope.check(); setPickerUri('');
      await prepareFiles(photos.map(photo => photo.file), scope, new Map(photos.map(photo => [photo.file, photo.captureTime])));
    } catch (error) { if (scope.isCurrent()) { setError(controller.signal.aborted ? 'Photo selection stopped. Nothing was added to the Atlas.' : message(error)); setStatus(''); } }
    finally { working.current = false; if (mounted.current) { setBusy(false); setPickerUri(''); } abort.current = null; }
  };
  const persist = async (rows: TravelTimelineEntry[], removeId?: string) => {
    if (!current() || !latest.current.canWrite || working.current) return;
    const invalid = rows.map(validateAtlasEntry).find(Boolean);
    if (invalid) { setError(invalid); return; }
    const scope = capture(); working.current = true; setBusy(true); setError(''); setStatus('Saving your memory…');
    try {
      const saved: TravelTimelineEntry[] = [];
      for (const row of rows) {
        let entry = { ...row };
        if (entry.photoUrl?.startsWith('data:')) {
          const photo = await scope.step(() => uploadTravelPhoto(entry.photoUrl!, `${entry.id}-${crypto.randomUUID()}`, { scope }));
          entry = { ...entry, photoUrl: photo.downloadUrl, photoStoragePath: photo.storagePath };
          // Keep a successful upload in the draft if the metadata save fails.
          setDraft(old => old?.id === entry.id ? entry : old);
          setReview(old => old.map(value => value.entry.id === entry.id ? { ...value, entry } : value));
        }
        saved.push(entry);
      }
      const changed = new Set(saved.map(entry => entry.id));
      const next: TravelTimelineDoc = { entries: [...base.current.entries.filter(entry => entry.id !== removeId && !changed.has(entry.id)), ...saved] };
      const ok = await scope.step(() => saveTravelTimeline(next, base.current));
      if (!ok) throw new Error('Cloud saving was not confirmed. Keep this draft open and retry when connected.');
      const merged = await scope.step(loadTravelTimeline);
      setDoc(merged?.entries ? merged : next); setSelectedId(saved[0]?.id);
      resetEditor(); setStatus(removeId ? 'Removed from the Atlas. The protected photo was kept.' : 'Saved to your family’s Life Atlas.');
    } catch (error) { if (scope.isCurrent()) setError(message(error)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const pin = (lat: number, lng: number) => { if (!draft || !canEdit || busy) return; const country = atlasCountry(lat, lng); setDraft({ ...draft, lat, lng, ...country, source: 'manual' }); setPlacing(false); };
  if (!loaded) return <p role="status" className="p-6 text-ink-500">Loading the places in your story…</p>;
  const mapEntries = draft ? [...visible.filter(entry => entry.id !== draft.id), draft] : visible;
  return <div className="space-y-5" data-life-atlas>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-rosa-600">Your family, around the world</p><h2 className="font-display text-3xl text-ink-900">Life Atlas</h2><p className="mt-2 max-w-xl text-sm text-ink-500">The places you lived, adventures you shared and stories worth passing on. One chosen photo can hold a whole memory.</p></div>
      {canEdit && !draft && !review.length && <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-[44px]" disabled={busy} onClick={() => openEntry()}><Plus size={16} />Add a place</button>
        <button type="button" className="btn-quiet min-h-[44px]" disabled={busy} onClick={() => { if (!current()) return; resetEditor(); base.current = structuredClone(docRef.current); pendingFile.current = capture(); input.current?.click(); }}><Camera size={16} />Import photos</button>
        <button type="button" className="btn-quiet min-h-[44px]" disabled={busy || !googleReady} onClick={() => void connectGoogle()}>Connect Google Photos</button>
        {!busy && <a className="btn-quiet inline-flex min-h-[44px] items-center text-xs" href="/?open=inbox">Find memory highlights</a>}
      </div>}
    </header>
    <input ref={input} className="hidden" type="file" accept="image/*,.heic,.heif" multiple onChange={(event: React.ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files || []) as File[]; event.target.value = ''; const scope = pendingFile.current; pendingFile.current = null; if (files.length && scope) void importFiles(files, scope); }} />
    <input ref={coverInput} className="hidden" type="file" accept="image/*,.heic,.heif" onChange={(event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0], scope = coverScope.current; event.target.value = ''; coverScope.current = null; if (file && scope) void attachCover(file, scope); }} />
    <details className="text-xs leading-relaxed text-ink-500"><summary className="min-h-[44px] cursor-pointer py-3">How photo imports, dates and locations work</summary><p>Choose photos from your device, Apple Photos exports or Google Photos. Original files can supply capture dates and GPS. Google Photos removes GPS, so add its map pins yourself. Unknown dates and places stay unknown. Teluva saves a display cover; keep your original in Photos or your archive. Saved covers and precise locations are shared with your family space.</p></details>
    {!googleReady && canEdit && <p className="text-xs text-ink-500">Google Photos sign-in is loading or blocked. Device photo imports are available.</p>}
    {busy && <div className="card flex flex-wrap items-center gap-3 p-4" role="status"><Loader2 size={18} className="animate-spin" /><span>{status || 'Saving your memory…'}</span>{abort.current && <button type="button" className="btn-quiet min-h-[44px]" onClick={() => abort.current?.abort()}>Stop selection</button>}</div>}
    {pickerUri && <div className="card space-y-2 p-4"><a className="btn-primary inline-flex min-h-[44px]" href={pickerUri} target="_blank" rel="noopener noreferrer">Open Google Photos to choose</a><p className="text-xs text-ink-500">Choose up to 20 photos, then press Done and return here. Only your selection is read.</p></div>}
    {error && <p role="alert" className="rounded-xl bg-rosa-50 p-3 text-sm text-rosa-700">{error}</p>}
    {!busy && status && <p role="status" className="text-sm text-ink-600">{status}</p>}
    <RemoteChangeHint show={remoteWaiting} />
      <div className="space-y-3"><div className="flex flex-wrap gap-2" role="group" aria-label="Whose memories to show"><button type="button" className={peopleMode === 'family' ? 'btn-primary min-h-[44px] text-xs' : 'btn-quiet min-h-[44px] text-xs'} aria-pressed={peopleMode === 'family'} onClick={() => setPeopleMode('family')}>Whole family</button><button type="button" className={peopleMode === 'individuals' ? 'btn-primary min-h-[44px] text-xs' : 'btn-quiet min-h-[44px] text-xs'} aria-pressed={peopleMode === 'individuals'} onClick={() => setPeopleMode('individuals')}>Individuals</button></div>{peopleMode === 'individuals' && <div className="flex flex-wrap gap-2" role="group" aria-label="Choose people for the Atlas">{members.map(member => <label key={member.id} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-cream-200 px-3 text-xs text-ink-700"><input type="checkbox" checked={people.includes(member.id)} onChange={event => setPeople(old => event.target.checked ? [...old, member.id] : old.filter(id => id !== member.id))} />{member.name}</label>)}</div>}<p className="text-xs text-ink-500">{peopleMode === 'family' ? 'All family stories, including memories that still need people tagged.' : people.length ? 'Showing memories tagged with any selected person. Untagged memories remain in Whole family.' : 'Choose one or more people to see their tagged memories.'}</p></div>
    <LifeAtlasMap entries={mapEntries} selectedId={draft?.id || selectedId} onSelect={id => { if (!placing) setSelectedId(id); }} onPlacePin={placing && draft && !busy ? pin : undefined} />
    {draft && <section className="card space-y-4 p-4 sm:p-6" aria-label="Edit Atlas memory"><div className="flex items-center justify-between gap-2"><h3 className="font-display text-xl text-ink-900">Tell this place’s story</h3><button type="button" aria-label="Cancel memory edit" className="btn-quiet min-h-[44px]" disabled={busy} onClick={resetEditor}><X size={18} /></button></div>
      {draft.photoUrl && <img src={draft.photoUrl} alt="Chosen memory cover" className="max-h-64 w-full rounded-xl object-contain" />}
      <button type="button" className="btn-quiet min-h-[44px] text-xs" disabled={busy} onClick={() => { if (!current()) return; coverScope.current = capture(); coverInput.current?.click(); }}><Camera size={16} />{draft.photoUrl ? 'Choose a different cover photo' : 'Choose a cover photo'}</button>
      {coverMeta && (coverMeta.date || hasAtlasPoint(coverMeta as TravelTimelineEntry)) && <div className="rounded-xl bg-cream-50 p-3 text-xs text-ink-600"><p>Available photo details: {coverMeta.date || 'capture date unknown'}{hasAtlasPoint(coverMeta as TravelTimelineEntry) ? ` · GPS: ${coverMeta.country || 'country unknown'}` : ' · no GPS'}. Use these only if they describe this memory.</p><button type="button" className="btn-quiet min-h-[44px] text-xs" disabled={busy} onClick={() => { setDraft(old => old ? { ...old, ...(!old.date && coverMeta.date ? { date: coverMeta.date, datePrecision: 'day' } : {}), ...(!old.country && !hasAtlasPoint(old) && hasAtlasPoint(coverMeta as TravelTimelineEntry) ? { lat: coverMeta.lat, lng: coverMeta.lng, country: coverMeta.country || '', countryCode: coverMeta.countryCode, source: 'exif' } : {}) } : old); setCoverMeta(null); }}>Use photo details for blank fields</button></div>}
      <AtlasFields entry={draft} onChange={setDraft} members={members} disabled={busy} />
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-quiet min-h-[44px]" disabled={busy} aria-pressed={placing} onClick={() => setPlacing(!placing)}><MapPin size={16} />{placing ? 'Cancel pin placement' : 'Choose a pin on the map above'}</button><button type="button" className="btn-primary min-h-[44px]" disabled={busy || !canEdit} onClick={() => void persist([draft])}>Save memory</button></div>
    </section>}
    {review.length > 0 && <section className="card space-y-4 p-4 sm:p-6" aria-label="Review imported photos"><h3 className="font-display text-xl text-ink-900">Choose the memories to keep</h3><p className="text-sm text-ink-500">Nearby photos on the same known day start as alternatives. Keep one cover per memory, or select more to make separate records. Add a place here; map pins can be added after saving.</p>
      {review.map((value, index) => <article key={value.entry.id} className="space-y-3 rounded-2xl border border-cream-200 p-3"><label className="flex min-h-[44px] items-center gap-3 text-sm font-semibold text-ink-800"><input type="checkbox" checked={value.selected} disabled={busy || !!value.error} onChange={event => setReview(old => old.map((row, i) => i === index ? { ...row, selected: event.target.checked } : row))} />{value.entry.sourceFileName}</label>
        {value.error ? <p className="text-sm text-rosa-700">{value.error}</p> : <div className="grid gap-4 sm:grid-cols-[180px_1fr]"><img src={value.entry.photoUrl} alt="Selected cover" className="w-full rounded-xl object-contain" /><AtlasFields entry={value.entry} members={members} disabled={busy} onChange={entry => setReview(old => old.map((row, i) => i === index ? { ...row, entry } : row))} /></div>}
      </article>)}
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary min-h-[44px]" disabled={busy || !canEdit || !review.some(row => row.selected && !row.error)} onClick={() => void persist(review.filter(row => row.selected && !row.error).map(row => row.entry))}>Save {review.filter(row => row.selected && !row.error).length} selected {review.filter(row => row.selected && !row.error).length === 1 ? 'memory' : 'memories'}</button><button type="button" className="btn-quiet min-h-[44px]" disabled={busy} onClick={resetEditor}>Discard drafts</button></div>
    </section>}
    {!draft && selected && <section className="card space-y-3 p-4 sm:p-6" aria-label="Selected Atlas memory"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-rosa-600">{ATLAS_KINDS[atlasKind(selected)]} · {atlasDateLabel(selected)}</p><h3 className="font-display text-2xl text-ink-900">{atlasTitle(selected)}</h3><p className="text-sm text-ink-500">{[selected.place, selected.country].filter(Boolean).join(', ')}{!hasAtlasPoint(selected) && ' · Map pin needed'}</p></div><button type="button" aria-label="Close memory details" className="btn-quiet min-h-[44px]" onClick={() => setSelectedId(undefined)}><X size={18} /></button></div>
      {selected.photoUrl && <button type="button" className="block w-full" aria-label={`View photo for ${atlasTitle(selected)}`} onClick={() => setLightbox(selected.photoUrl!)}><img src={selected.photoUrl} alt={atlasTitle(selected)} className="max-h-96 w-full rounded-xl object-contain" /></button>}
      {selected.notes && <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{selected.notes}</p>}
      {!!selected.memberIds?.length && <p className="text-xs text-ink-500">With {selected.memberIds.map(id => members.find(member => member.id === id)?.name || 'Family member').join(', ')}</p>}
      {canEdit && !review.length && <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn-quiet min-h-[44px]" onClick={() => openEntry(selected)}><Pencil size={16} />Edit story or map pin</button><ConfirmDeleteButton ariaLabel={`Remove ${atlasTitle(selected)} from Atlas`} disabled={busy} hint="Removes this Atlas record. Its protected photo is kept." onConfirm={() => { base.current = structuredClone(docRef.current); return persist([], selected.id); }} /></div>}
    </section>}
    <section className="space-y-4" aria-label="Atlas memories">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-xl text-ink-900">Your places & stories <span className="text-sm text-ink-400">{visible.length}</span></h3><p className="text-xs text-ink-500">{new Set(doc.entries.map(entry => entry.country).filter(Boolean)).size} countries recorded · {doc.entries.filter(entry => !hasAtlasPoint(entry)).length} need a pin</p></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><input type="search" aria-label="Search Atlas memories" placeholder="Find a place or story…" className={field} value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Filter memory kind" className={field} value={kind} onChange={event => setKind(event.target.value)}><option value="">All kinds</option>{Object.entries(ATLAS_KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="Filter year" className={field} value={year} onChange={event => setYear(event.target.value)}><option value="">All years</option>{years.map(value => <option key={value}>{value}</option>)}</select><label className="flex min-h-[44px] items-center gap-2 text-sm text-ink-600"><input type="checkbox" checked={unmapped} onChange={event => setUnmapped(event.target.checked)} />Needs a map pin</label></div>
      {visible.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(entry => <button type="button" key={entry.id} className={`card overflow-hidden text-left ${selectedId === entry.id ? 'ring-2 ring-rosa-400' : ''}`} aria-pressed={selectedId === entry.id} onClick={() => setSelectedId(entry.id)}>{entry.photoUrl ? <img src={entry.photoUrl} alt="" loading="lazy" className="atlas-memory-cover" /> : <div className="atlas-memory-cover atlas-empty-cover"><Globe2 size={40} className="text-dusk-500" /></div>}<div className="space-y-1 p-4"><p className="text-xs text-rosa-600">{ATLAS_KINDS[atlasKind(entry)]} · {atlasDateLabel(entry)}</p><h4 className="font-display text-lg text-ink-900">{atlasTitle(entry)}</h4><p className="text-xs text-ink-500">{entry.country || 'Country unknown'}{!hasAtlasPoint(entry) ? ' · Pin needed' : ''}</p></div></button>)}</div> : <div className="card p-8 text-center"><Globe2 className="mx-auto mb-3 text-dusk-400" size={36} /><p className="font-display text-xl text-ink-800">{doc.entries.length ? 'No memories match these filters.' : 'Every family has a world of stories.'}</p><p className="mt-2 text-sm text-ink-500">{doc.entries.length ? 'Try another year, person or place.' : 'Start with a first home, a favourite holiday or a day you never want to forget.'}</p></div>}
    </section>
    {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
  </div>;
}

function AtlasFields({ entry, onChange, members, disabled }: { entry: TravelTimelineEntry; onChange: (entry: TravelTimelineEntry) => void; members: FamilyMember[]; disabled: boolean }) {
  const update = (patch: Partial<TravelTimelineEntry>) => onChange({ ...entry, ...patch });
  const dateType = entry.datePrecision === 'year' ? 'text' : entry.datePrecision === 'month' ? 'month' : 'date';
  return <fieldset disabled={disabled} className="min-w-0 space-y-3"><legend className="sr-only">Memory details</legend><div className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1 text-xs text-ink-600">Memory title<input className={field} value={entry.title || ''} maxLength={180} onChange={event => update({ title: event.target.value })} placeholder="Our first summer in Vienna" /></label>
    <label className="space-y-1 text-xs text-ink-600">Kind<select className={field} value={atlasKind(entry)} onChange={event => update({ kind: event.target.value as TravelTimelineEntry['kind'] })}>{Object.entries(ATLAS_KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label className="space-y-1 text-xs text-ink-600">Place<input className={field} value={entry.place || ''} maxLength={180} onChange={event => update({ place: event.target.value })} placeholder="Town, landmark or neighbourhood" /></label>
    <label className="space-y-1 text-xs text-ink-600">Country<input className={field} value={entry.country} maxLength={100} onChange={event => update({ country: event.target.value, countryCode: undefined, lat: undefined, lng: undefined, source: 'manual' })} placeholder="Unknown until you add it" /></label>
    <label className="space-y-1 text-xs text-ink-600">Start / capture date<input type={dateType} inputMode={dateType === 'text' ? 'numeric' : undefined} maxLength={dateType === 'text' ? 4 : undefined} placeholder={dateType === 'text' ? 'YYYY' : undefined} className={field} value={atlasDateInput(entry.date, entry.datePrecision)} onChange={event => update({ date: atlasDateFromInput(event.target.value, entry.datePrecision) })} /></label>
    <label className="space-y-1 text-xs text-ink-600">End date (optional)<input type={dateType} inputMode={dateType === 'text' ? 'numeric' : undefined} maxLength={dateType === 'text' ? 4 : undefined} placeholder={dateType === 'text' ? 'YYYY' : undefined} className={field} value={atlasDateInput(entry.endDate, entry.datePrecision)} min={atlasDateInput(entry.date, entry.datePrecision) || undefined} onChange={event => update({ endDate: atlasDateFromInput(event.target.value, entry.datePrecision) || undefined })} /></label>
    <label className="space-y-1 text-xs text-ink-600">Date accuracy<select className={field} value={entry.datePrecision || 'day'} onChange={event => onChange(changeAtlasPrecision(entry, event.target.value as NonNullable<TravelTimelineEntry['datePrecision']>))}><option value="day">Exact day</option><option value="month">Only month is known</option><option value="year">Only year is known</option></select></label>
    <p className="self-center text-xs text-ink-400">Leave dates blank if unknown. Choose month or year accuracy when the exact day is uncertain.</p>
  </div><label className="block space-y-1 text-xs text-ink-600">The story<textarea className={field} rows={3} value={entry.notes || ''} maxLength={8000} placeholder="Who was there? What made it special? What would you tell the grandchildren?" onChange={event => update({ notes: event.target.value })} /></label>
    <div className="flex flex-wrap gap-2" role="group" aria-label="People in this memory">{members.map(member => <label key={member.id} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-cream-200 px-3 text-xs text-ink-600"><input type="checkbox" checked={entry.memberIds?.includes(member.id) || false} onChange={event => update({ memberIds: event.target.checked ? [...(entry.memberIds || []), member.id] : entry.memberIds?.filter(id => id !== member.id) })} />{member.name}</label>)}</div>
    {hasAtlasPoint(entry) ? <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500"><MapPin size={14} />{entry.lat!.toFixed(4)}, {entry.lng!.toFixed(4)} · {entry.source === 'exif' ? 'Photo GPS' : 'Manually placed'}<button type="button" className="btn-quiet min-h-[44px]" onClick={() => update({ lat: undefined, lng: undefined, source: 'manual' })}>Remove precise location</button></div> : <p className="text-xs text-ink-400">No map pin yet. The memory can be saved without one.</p>}
  </fieldset>;
}
