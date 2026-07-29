import React, { useState, useEffect, useRef } from 'react';
import { TravelTimelineDoc, TravelTimelineEntry } from '../types';
import { loadTravelTimeline, saveTravelTimeline, uploadTravelPhoto, deleteTravelPhoto } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { compressImageToAvatar } from '../utils/imageCompress';
import { extractTravelMeta } from '../utils/travelGeo';
import { emojiFlag } from '@rapideditor/country-coder';
import ImageLightbox from './ImageLightbox';
import {
  Globe2, Plus, Camera, Pencil, Check, X, Cloud, CloudOff, Loader2, MapPin, Sparkles,
} from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import EmptyState from './EmptyState';

const EMPTY: TravelTimelineDoc = { entries: [] };

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDate(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function flagFor(entry: TravelTimelineEntry): string | null {
  if (!entry.countryCode) return null;
  try {
    return emojiFlag(entry.countryCode);
  } catch {
    return null;
  }
}

export default function TravelTimelineView() {
  const [doc, setDoc] = useState<TravelTimelineDoc>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TravelTimelineEntry | null>(null);
  const [detectedNote, setDetectedNote] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [photoView, setPhotoView] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadTravelTimeline();
      if (active) {
        setDoc(data && data.entries ? { entries: data.entries } : EMPTY);
        setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  // Live updates from other family members, held while an entry is being
  // drafted/edited or a photo is being processed, and applied once that ends.
  const remoteWaiting = useSharedDoc<TravelTimelineDoc>(
    'travelTimeline',
    (v) => setDoc({ entries: v.entries || [] }),
    { hold: !!draft || !!editId || processing },
  );

  const persist = async (next: TravelTimelineDoc) => {
    setDoc(next);
    const ok = await saveTravelTimeline(next);
    setCloudSynced(ok);
  };

  // --- "Add travel photo": parse the raw file's EXIF GPS tag, resolve it to
  // a country fully offline, then open the entry form pre-filled for review
  // — never silently auto-saves, so a wrong offline lookup is always caught
  // before it's written. Falls back to a blank manual entry when the photo
  // has no GPS tag at all. ---
  const handleAddPhotoClick = () => {
    setProcessError(null);
    photoInputRef.current?.click();
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setProcessing(true);
    setProcessError(null);
    try {
      // Parse EXIF from the RAW file FIRST. compressImageToAvatar re-encodes
      // via <canvas>.toDataURL, which strips all EXIF (GPS included) — so the
      // metadata must be read before that ever happens.
      const meta = await extractTravelMeta(file);

      const rawDataUrl = await readFileAsDataUrl(file);
      const compressed = await compressImageToAvatar(rawDataUrl, 1600, 0.85);

      if (meta && meta.countryCode) {
        setDetectedNote(`Detected from the photo's location data: ${meta.countryName || meta.countryCode}`);
        setDraft({
          id: newId(),
          country: meta.countryName || meta.countryCode,
          countryCode: meta.countryCode,
          place: '',
          date: meta.date || new Date().toISOString().slice(0, 10),
          photoUrl: compressed,
          lat: meta.lat,
          lng: meta.lng,
          source: 'exif',
          notes: '',
        });
      } else {
        setDetectedNote("We couldn't find location data in that photo — add the country by hand.");
        setDraft({
          id: newId(),
          country: '',
          place: '',
          date: meta?.date || new Date().toISOString().slice(0, 10),
          photoUrl: compressed,
          lat: meta?.lat,
          lng: meta?.lng,
          source: 'manual',
          notes: '',
        });
      }
      setEditId(null);
    } catch (err) {
      console.error('Travel photo processing failed:', err);
      setProcessError("Couldn't read that photo — try again, or add the trip manually.");
    } finally {
      setProcessing(false);
    }
  };

  const handleAddManual = () => {
    setProcessError(null);
    setDetectedNote(null);
    setDraft({
      id: newId(),
      country: '',
      place: '',
      date: new Date().toISOString().slice(0, 10),
      source: 'manual',
      notes: '',
    });
    setEditId(null);
  };

  // A photo still sitting as a data: URL hasn't been uploaded yet — upload it
  // now and swap in the real Storage download URL before persisting.
  const handleSaveEntry = async (entry: TravelTimelineEntry) => {
    const toSave: TravelTimelineEntry = { ...entry };
    const existing = doc.entries.find((e) => e.id === toSave.id);

    if (toSave.photoUrl && toSave.photoUrl.startsWith('data:')) {
      // A new or replaced photo is still a data: URL pending upload.
      try {
        const { storagePath, downloadUrl } = await uploadTravelPhoto(toSave.photoUrl, toSave.id);
        if (existing?.photoStoragePath && existing.photoStoragePath !== storagePath) {
          await deleteTravelPhoto(existing.photoStoragePath);
        }
        toSave.photoUrl = downloadUrl;
        toSave.photoStoragePath = storagePath;
      } catch (err) {
        console.error('Travel photo upload failed — saving the entry without a photo:', err);
        toSave.photoUrl = undefined;
        toSave.photoStoragePath = undefined;
      }
    } else if (!toSave.photoUrl && existing?.photoStoragePath) {
      // Photo was removed in the form (not replaced) — clean up the now-orphaned file.
      await deleteTravelPhoto(existing.photoStoragePath);
      toSave.photoStoragePath = undefined;
    }

    const exists = doc.entries.some((e) => e.id === toSave.id);
    const nextEntries = exists
      ? doc.entries.map((e) => (e.id === toSave.id ? toSave : e))
      : [...doc.entries, toSave];
    await persist({ entries: nextEntries });
    setDraft(null);
    setEditId(null);
    setDetectedNote(null);
  };

  const handleDelete = async (id: string) => {
    const entry = doc.entries.find((e) => e.id === id);
    if (entry?.photoStoragePath) await deleteTravelPhoto(entry.photoStoragePath);
    await persist({ entries: doc.entries.filter((e) => e.id !== id) });
  };

  if (!loaded) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  const sorted = [...doc.entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const countryCount = new Set(
    doc.entries.map((e) => e.countryCode || e.country.trim().toLowerCase()).filter(Boolean)
  ).size;

  return (
    <div className="space-y-6 font-sans">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoFileChange}
      />

      {/* Header */}
      <div className="card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
              <Globe2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-900">Travel timeline</h2>
              <p className="text-[13px] text-ink-500 font-medium">
                {countryCount === 0
                  ? 'Countries visited, chronologically'
                  : `${countryCount} ${countryCount === 1 ? 'country' : 'countries'} visited`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleAddManual} className="btn-quiet text-xs px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add manually
            </button>
            <button
              onClick={handleAddPhotoClick}
              disabled={processing}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-60"
            >
              {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              Add travel photo
            </button>
          </div>
        </div>

        {processError && (
          <div className="mt-4 px-3.5 py-2.5 rounded-xl bg-rosa-500/10 border border-rosa-500/20 flex items-center justify-between gap-2">
            <p className="text-[12px] text-rosa-600">{processError}</p>
            <button onClick={() => setProcessError(null)} className="text-rosa-600 hover:text-rosa-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* List + form */}
      <div className="card p-5 sm:p-6 space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-cream-200">
          <h3 className="section-label">Trips</h3>
        </div>

        <RemoteChangeHint show={remoteWaiting} className="mt-4" />

        {draft && (
          <TravelEntryForm
            entry={draft}
            detectedNote={detectedNote}
            onSave={handleSaveEntry}
            onCancel={() => { setDraft(null); setEditId(null); setDetectedNote(null); }}
          />
        )}

        {sorted.length === 0 && !draft ? (
          <EmptyState
            icon={Globe2}
            tone="dusk"
            title="No trips yet"
            description="Add a travel photo and we'll detect the country from its location data automatically."
          />
        ) : (
          <div className="relative space-y-4 pt-2">
            {sorted.map((entry, idx) => (
              <div key={entry.id} className="relative">
                {idx < sorted.length - 1 && (
                  <div className="absolute left-[19px] top-14 w-0.5 h-10 bg-cream-300" />
                )}

                {editId === entry.id ? (
                  <TravelEntryForm entry={entry} onSave={handleSaveEntry} onCancel={() => setEditId(null)} />
                ) : (
                  <TravelEntryRow
                    entry={entry}
                    onEdit={() => { setEditId(entry.id); setDraft(null); }}
                    onDelete={() => handleDelete(entry.id)}
                    onViewPhoto={() => entry.photoUrl && setPhotoView(entry.photoUrl)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-center">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {cloudSynced === false ? (
            <><CloudOff className="w-3.5 h-3.5 text-honey-700" /><span>Saved on this device — cloud sync unavailable</span></>
          ) : (
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your family{cloudSynced ? ' · synced' : ''}</span></>
          )}
        </div>
      </div>

      <ImageLightbox src={photoView} onClose={() => setPhotoView(null)} name="Travel photo" />
    </div>
  );
}

/* --- Entry row --- */

function TravelEntryRow({
  entry, onEdit, onDelete, onViewPhoto,
}: {
  entry: TravelTimelineEntry;
  onEdit: () => void;
  onDelete: () => void;
  onViewPhoto: () => void;
}) {
  const flag = flagFor(entry);

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center pt-1 shrink-0">
        {entry.photoUrl ? (
          <button
            type="button"
            onClick={onViewPhoto}
            className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-cream-100 ring-2 ring-white shadow-soft hover:ring-dusk-300 transition-all cursor-zoom-in"
            title="View photo"
          >
            <img src={entry.photoUrl} alt={entry.country} className="w-full h-full object-cover" />
          </button>
        ) : (
          <div className="w-10 h-10 rounded-full bg-dusk-50 text-dusk-500 flex items-center justify-center text-lg border-2 border-white shadow-soft">
            {flag || <MapPin className="w-4 h-4" />}
          </div>
        )}
      </div>

      <div className="flex-1 pb-2 pt-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-mono tabular-nums text-[12px] font-semibold text-ink-500">
                {formatDate(entry.date)}
              </span>
              <span className={`chip ${entry.source === 'exif' ? 'bg-sage-100 text-sage-700' : 'bg-clay-50 text-clay-700'}`}>
                {entry.source === 'exif' ? <Sparkles className="w-3 h-3" /> : null}
                {entry.source === 'exif' ? 'Auto-tagged' : 'Manual'}
              </span>
            </div>
            <p className="text-[15px] font-display font-semibold text-ink-900 mb-1">
              {flag ? `${flag} ` : ''}{entry.country}{entry.place ? ` — ${entry.place}` : ''}
            </p>
            {entry.notes && (
              <p className="text-[13px] text-ink-600 leading-relaxed">{entry.notes}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onEdit} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <ConfirmDeleteButton
              onConfirm={onDelete}
              ariaLabel={`Delete ${entry.country || 'this'} travel entry${entry.photoUrl ? ' and its photo' : ''}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- Entry form (add / edit) --- */

function TravelEntryForm({
  entry, detectedNote, onSave, onCancel,
}: {
  entry: TravelTimelineEntry;
  detectedNote?: string | null;
  onSave: (e: TravelTimelineEntry) => void;
  onCancel: () => void;
}) {
  const [country, setCountry] = useState(entry.country || '');
  const [place, setPlace] = useState(entry.place || '');
  const [date, setDate] = useState(entry.date || '');
  const [notes, setNotes] = useState(entry.notes || '');
  const [photoUrl, setPhotoUrl] = useState(entry.photoUrl || '');
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleAttachPhoto = () => photoInputRef.current?.click();

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttaching(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const compressed = await compressImageToAvatar(dataUrl, 1600, 0.85);
      setPhotoUrl(compressed);
    } finally {
      setAttaching(false);
    }
  };

  const save = () => {
    if (!country.trim()) { setError('Country is required'); return; }
    if (!date.trim()) { setError('Date is required'); return; }
    onSave({
      ...entry,
      country: country.trim(),
      place: place.trim() || undefined,
      date: date.trim(),
      notes: notes.trim() || undefined,
      photoUrl: photoUrl || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-dusk-200 bg-dusk-50/40 space-y-2.5">
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />

      {detectedNote && (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/70 text-[12px] text-dusk-700 font-medium">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>{detectedNote}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {photoUrl ? (
          <div className="relative shrink-0">
            <img src={photoUrl} alt="" className="w-14 h-14 rounded-xl object-cover ring-1 ring-cream-300" />
            <button
              type="button"
              onClick={() => setPhotoUrl('')}
              className="absolute -top-1.5 -right-1.5 bg-white rounded-full p-0.5 shadow-soft text-ink-500 hover:text-rosa-500"
              title="Remove photo"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAttachPhoto}
            disabled={attaching}
            className="w-14 h-14 rounded-xl border-2 border-dashed border-cream-300 text-ink-300 hover:text-dusk-500 hover:border-dusk-300 flex items-center justify-center shrink-0 disabled:opacity-60"
            title="Attach a photo"
          >
            {attaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          </button>
        )}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Country</label>
            <input
              autoFocus
              className="field"
              placeholder="e.g. Austria"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Date</label>
            <input
              type="date"
              className="field"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div>
        <label className="field-label">Place (optional)</label>
        <input
          className="field"
          placeholder="e.g. Vienna"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label">Notes (optional)</label>
        <textarea
          className="field resize-none"
          placeholder="Add any details or memories…"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <p className="text-[12px] text-rosa-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5">
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>
    </div>
  );
}
