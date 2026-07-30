import React, { useState, useRef } from 'react';
import {
  Package, Pencil, Trash2, Camera, Loader2, X, Receipt, ChevronLeft, ChevronRight, Plus, ShieldAlert,
} from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import type { AssetItem } from '../types';
import { saveAsset, deleteAsset, uploadAssetPhoto, deleteAssetPhoto } from '../utils/db';
import { compressImageToAvatar } from '../utils/imageCompress';
import {
  CATEGORIES, IDENTIFIER_TYPES, CONDITIONS, STORAGE_OPTIONS, CURRENCIES, STATUSES,
  suggestIdentifier, itemImages,
} from '../utils/assetConstants';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

const EXTRA_PHOTO_CAP = 12;

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Every AssetItem field, in one place, reached by tapping a Belongings row —
// previously a row only showed name + make/model and there was no way to see
// (or fix) anything else short of finding it again in the Assets screen.
// Opens read-only; canEdit flips it into the same field set Assets.tsx's own
// form uses, kept in sync via ../utils/assetConstants.
export default function AssetDetailModal({
  item, canEdit, onClose, onSaved, onDeleted,
}: {
  item: AssetItem;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (item: AssetItem) => void;
  onDeleted?: (id: string) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [editing, setEditing] = useState<AssetItem>(item);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [gallery, setGallery] = useState<{ src: string; label: string }[] | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);

  const photoFileRef = useRef<HTMLInputElement>(null);
  const photoKindRef = useRef<'primary' | 'extra' | 'receipt'>('primary');

  useBodyScrollLock(true);
  useBodyScrollLock(!!gallery && gallery.length > 0);

  const openGallery = (imgs: { src: string; label: string }[], idx = 0) => {
    if (imgs.length) { setGallery(imgs); setGalleryIdx(idx); }
  };

  const patch = (p: Partial<AssetItem>) => setEditing((prev) => ({ ...prev, ...p }));
  const patchIncident = (p: Partial<NonNullable<AssetItem['incident']>>) =>
    setEditing((prev) => ({ ...prev, incident: { ...prev.incident, ...p } }));

  const startEdit = () => { setEditing(item); setError(null); setMode('edit'); };
  const cancelEdit = () => { setEditing(item); setError(null); setMode('view'); };

  const triggerPhoto = (kind: 'primary' | 'extra' | 'receipt') => {
    photoKindRef.current = kind;
    photoFileRef.current?.click();
  };
  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!files.length) return;
    const kind = photoKindRef.current;
    if (kind === 'primary') { patch({ photoDataUrl: await compressImageToAvatar(await readFile(files[0]), 1500, 0.82) }); return; }
    if (kind === 'receipt') { patch({ receiptDataUrl: await compressImageToAvatar(await readFile(files[0]), 1500, 0.78) }); return; }
    setError(null); setUploadingPhotos(true);
    try {
      const start = (editing.photos || []).length;
      const room = Math.max(0, EXTRA_PHOTO_CAP - start);
      if (files.length > room) setError(`Only ${room} more photo${room === 1 ? '' : 's'} can be added (max ${EXTRA_PHOTO_CAP}).`);
      for (const file of files.slice(0, room)) {
        const compressed = await compressImageToAvatar(await readFile(file), 1600, 0.82);
        const url = await uploadAssetPhoto(compressed);
        setEditing((prev) => ({ ...prev, photos: [...(prev.photos || []), url].slice(0, EXTRA_PHOTO_CAP) }));
      }
    } catch {
      setError('Some photos could not be uploaded — please try again.');
    } finally {
      setUploadingPhotos(false);
    }
  };
  const removeExtraPhoto = (idx: number) =>
    setEditing((prev) => {
      const url = (prev.photos || [])[idx];
      if (url) void deleteAssetPhoto(url);
      return { ...prev, photos: (prev.photos || []).filter((_, i) => i !== idx) };
    });

  const handleSave = async () => {
    if (!editing.name.trim()) { setError('Name is required'); return; }
    setError(null); setSaving(true);
    const inc = editing.incident;
    const incident = inc && (inc.date || inc.policeReference || inc.notes || inc.type) ? inc : undefined;
    const toSave: AssetItem = { ...editing, incident };
    const ok = await saveAsset(toSave);
    setSaving(false);
    if (!ok) { setError('Could not save — the photos may be too large. Try fewer or smaller photos.'); return; }
    // Caller decides whether to close (MemberBelongings does) or keep it open —
    // don't touch local mode state here, the component may already be
    // unmounting by the time this returns.
    onSaved(toSave);
  };

  const handleDelete = async () => {
    await deleteAsset(item.id);
    onDeleted?.(item.id);
    onClose();
  };

  const imgs = itemImages(mode === 'edit' ? editing : item);
  const flagged = item.status === 'stolen' || item.status === 'lost';

  const Row = ({ label, value }: { label: string; value?: string | null }) =>
    value ? (
      <div className="flex items-baseline justify-between gap-4 py-1.5">
        <span className="text-[11.5px] font-semibold text-ink-400 uppercase tracking-wider shrink-0">{label}</span>
        <span className="text-[13.5px] text-ink-800 text-right">{value}</span>
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
      <input ref={photoFileRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoFileChange} />
      <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
        <SheetGrabber onClose={onClose} />
        <div className="flex items-center justify-between p-6 border-b border-cream-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-sage-100 text-sage-700 shrink-0"><Package className="w-4 h-4" /></div>
            <h3 className="font-display text-lg font-semibold text-ink-900 truncate">{mode === 'edit' ? (editing.id ? 'Edit item' : 'New item') : item.name}</h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {mode === 'view' && canEdit && (
              <button onClick={startEdit} className="btn-quiet p-2" title="Edit"><Pencil className="w-4 h-4" /></button>
            )}
            <button onClick={onClose} className="btn-quiet p-2"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {mode === 'view' ? (
          <div className="p-6 space-y-4">
            {flagged && (
              <div className="flex items-center gap-2 bg-rosa-50 rounded-xl px-3 py-2.5">
                <ShieldAlert className="w-4 h-4 text-rosa-600 shrink-0" />
                <p className="text-[12.5px] font-semibold text-rosa-700">Reported {item.status === 'lost' ? 'lost' : 'stolen'}</p>
              </div>
            )}

            {imgs.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {imgs.map((img, i) => (
                  <button key={i} type="button" onClick={() => openGallery(imgs, i)}
                    className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-cream-100 ring-1 ring-cream-200 hover:ring-clay-300 transition-all cursor-zoom-in">
                    <img src={img.src} alt={img.label} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="divide-y divide-cream-100">
              <Row label="Category" value={item.category} />
              <Row label="Assigned to" value={item.assignedMember} />
              <Row label="Make / model" value={[item.make, item.model].filter(Boolean).join(' ') || undefined} />
              <Row label={item.identifierType || 'Serial'} value={item.serialNumber} />
              <Row label="Purchase date" value={item.purchaseDate} />
              <Row label="Condition" value={item.condition} />
              <Row label="Paid" value={item.purchasePrice ? `${item.currency || 'EUR'} ${item.purchasePrice}` : undefined} />
              <Row label="Replace today" value={item.replacementValue ? `${item.currency || 'EUR'} ${item.replacementValue}` : undefined} />
              <Row label="Bought at" value={item.purchaseLocation} />
              <Row label="Warranty until" value={item.warrantyUntil} />
              <Row label="Where it's kept" value={item.storageSecurity} />
              {flagged && <Row label="Date of loss" value={item.incident?.date} />}
              {flagged && <Row label="Police ref." value={item.incident?.policeReference} />}
            </div>

            {item.notes && (
              <div>
                <p className="text-[11.5px] font-semibold text-ink-400 uppercase tracking-wider mb-1">Notes</p>
                <p className="text-[13.5px] text-ink-700 whitespace-pre-wrap">{item.notes}</p>
              </div>
            )}

            {!canEdit && (
              <p className="text-[11.5px] text-ink-300">Only an admin can edit this item.</p>
            )}
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {error && (
              <div className="flex items-center justify-between gap-2 bg-rosa-500/10 rounded-xl px-4 py-3">
                <p className="text-[12px] text-rosa-600">{error}</p>
                <button onClick={() => setError(null)}><X className="w-3.5 h-3.5 text-rosa-600" /></button>
              </div>
            )}

            <div className="flex items-center gap-4">
              {editing.photoDataUrl ? (
                <div className="relative shrink-0">
                  <img src={editing.photoDataUrl} alt="Item photo" className="w-24 h-24 object-cover rounded-xl border border-cream-200" />
                  <button onClick={() => patch({ photoDataUrl: '' })} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500 transition-colors"><X className="w-3 h-3" /></button>
                </div>
              ) : (
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-cream-300 flex items-center justify-center shrink-0"><Package className="w-6 h-6 text-ink-200" /></div>
              )}
              <button onClick={() => triggerPhoto('primary')} className="btn-quiet text-xs px-3 py-2 flex-1"><Camera className="w-3.5 h-3.5" /> {editing.photoDataUrl ? 'Replace photo' : 'Add photo'}</button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">More photos <span className="normal-case text-ink-300 font-normal">· serial plate, angles</span></label>
              <div className="flex flex-wrap gap-2">
                {(editing.photos || []).map((src, i) => (
                  <div key={i} className="relative">
                    <button type="button" onClick={() => openGallery(itemImages(editing), (editing.photoDataUrl ? 1 : 0) + i)} className="w-14 h-14 rounded-lg overflow-hidden bg-cream-100 ring-1 ring-cream-200 cursor-zoom-in"><img src={src} alt="" className="w-full h-full object-cover" /></button>
                    <button onClick={() => removeExtraPhoto(i)} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500"><X className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
                {(editing.photos || []).length < EXTRA_PHOTO_CAP && (
                  <button onClick={() => triggerPhoto('extra')} disabled={uploadingPhotos} className="w-14 h-14 rounded-lg border-2 border-dashed border-cream-300 flex items-center justify-center text-ink-300 hover:border-clay-300 hover:text-clay-500 transition-colors disabled:opacity-60">
                    {uploadingPhotos ? <Loader2 className="w-4 h-4 animate-spin text-clay-500" /> : <Plus className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Receipt / proof of purchase</label>
              {editing.receiptDataUrl ? (
                <div className="relative w-16 h-16">
                  <button type="button" onClick={() => openGallery([{ src: editing.receiptDataUrl!, label: 'Receipt' }])} className="w-16 h-16 rounded-lg overflow-hidden bg-cream-100 ring-1 ring-sage-200 cursor-zoom-in"><img src={editing.receiptDataUrl} alt="Receipt" className="w-full h-full object-cover" /></button>
                  <button onClick={() => patch({ receiptDataUrl: '' })} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500"><X className="w-2.5 h-2.5" /></button>
                </div>
              ) : (
                <button onClick={() => triggerPhoto('receipt')} className="btn-quiet text-xs px-3 py-2"><Receipt className="w-3.5 h-3.5" /> Add receipt</button>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Name <span className="text-rosa-600">*</span></label>
              <input type="text" value={editing.name} onChange={(e) => patch({ name: e.target.value })} className="field w-full" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Category</label>
                <select value={editing.category} onChange={(e) => {
                  const category = e.target.value as AssetItem['category'];
                  patch({ category, identifierType: !editing.serialNumber ? suggestIdentifier(category) : editing.identifierType });
                }} className="field w-full">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Assigned to</label>
                <input type="text" placeholder="e.g. Mia" value={editing.assignedMember || ''} onChange={(e) => patch({ assignedMember: e.target.value })} className="field w-full" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Make</label>
                <input type="text" value={editing.make || ''} onChange={(e) => patch({ make: e.target.value })} className="field w-full" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Model</label>
                <input type="text" value={editing.model || ''} onChange={(e) => patch({ model: e.target.value })} className="field w-full" />
              </div>
            </div>

            <div className="grid grid-cols-[7.5rem_1fr] gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">ID type</label>
                <select value={editing.identifierType || 'Serial'} onChange={(e) => patch({ identifierType: e.target.value })} className="field w-full">
                  {IDENTIFIER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">{editing.identifierType || 'Serial'} number</label>
                <input type="text" value={editing.serialNumber || ''} onChange={(e) => patch({ serialNumber: e.target.value })} className="field w-full font-mono" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Purchase date</label>
                <input type="date" value={editing.purchaseDate || ''} onChange={(e) => patch({ purchaseDate: e.target.value })} className="field w-full" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Condition</label>
                <select value={editing.condition || ''} onChange={(e) => patch({ condition: e.target.value })} className="field w-full">
                  <option value="">—</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-[5rem_1fr_1fr] gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Cur.</label>
                <select value={editing.currency || 'EUR'} onChange={(e) => patch({ currency: e.target.value })} className="field w-full">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Paid</label>
                <input type="text" inputMode="decimal" value={editing.purchasePrice || ''} onChange={(e) => patch({ purchasePrice: e.target.value })} className="field w-full tabular-nums" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Replace now</label>
                <input type="text" inputMode="decimal" value={editing.replacementValue || ''} onChange={(e) => patch({ replacementValue: e.target.value })} className="field w-full tabular-nums" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Bought at</label>
                <input type="text" value={editing.purchaseLocation || ''} onChange={(e) => patch({ purchaseLocation: e.target.value })} className="field w-full" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Warranty until</label>
                <input type="date" value={editing.warrantyUntil || ''} onChange={(e) => patch({ warrantyUntil: e.target.value })} className="field w-full" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Where it's kept</label>
              <select value={editing.storageSecurity || ''} onChange={(e) => patch({ storageSecurity: e.target.value })} className="field w-full">
                <option value="">—</option>
                {STORAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Status</label>
                <select value={editing.status || 'owned'} onChange={(e) => {
                  const status = e.target.value as AssetItem['status'];
                  patch(status === 'stolen' || status === 'lost' ? { status } : { status, incident: undefined });
                }} className="field w-full">
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              {(editing.status === 'stolen' || editing.status === 'lost') && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Date of loss</label>
                    <input type="date" value={editing.incident?.date || ''} onChange={(e) => patchIncident({ date: e.target.value, type: editing.status === 'lost' ? 'lost' : 'stolen' })} className="field w-full" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Police ref.</label>
                    <input type="text" value={editing.incident?.policeReference || ''} onChange={(e) => patchIncident({ policeReference: e.target.value, type: editing.status === 'lost' ? 'lost' : 'stolen' })} className="field w-full font-mono" />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Notes</label>
              <textarea rows={3} value={editing.notes || ''} onChange={(e) => patch({ notes: e.target.value })} className="field w-full resize-none" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <ConfirmDeleteButton
                onConfirm={handleDelete}
                ariaLabel={`Delete ${editing.name || 'this item'}`}
                variant="danger-text"
                className="rounded-xl px-3 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </ConfirmDeleteButton>
              <div className="flex items-center gap-3">
                <button onClick={cancelEdit} className="btn-quiet text-xs px-4 py-2">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {gallery && gallery.length > 0 && (
        <div className="fixed inset-0 z-[60] bg-ink-900/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 anim-fade" onClick={() => setGallery(null)}>
          <button onClick={() => setGallery(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-ink-800 flex items-center justify-center hover:bg-white transition-colors z-10" aria-label="Close"><X className="w-5 h-5" /></button>
          <div className="flex items-center gap-2 sm:gap-4" onClick={(e) => e.stopPropagation()}>
            {gallery.length > 1 && (
              <button onClick={() => setGalleryIdx((i) => (i - 1 + gallery.length) % gallery.length)} className="w-10 h-10 rounded-full bg-white/90 text-ink-800 flex items-center justify-center hover:bg-white shrink-0" aria-label="Previous"><ChevronLeft className="w-5 h-5" /></button>
            )}
            <img src={gallery[galleryIdx].src} alt={gallery[galleryIdx].label} className="max-w-[78vw] max-h-[78dvh] object-contain rounded-2xl shadow-2xl bg-white" />
            {gallery.length > 1 && (
              <button onClick={() => setGalleryIdx((i) => (i + 1) % gallery.length)} className="w-10 h-10 rounded-full bg-white/90 text-ink-800 flex items-center justify-center hover:bg-white shrink-0" aria-label="Next"><ChevronRight className="w-5 h-5" /></button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
            <span className="chip bg-white/90 text-ink-700">{gallery[galleryIdx].label}</span>
            {gallery.length > 1 && <span className="text-white/70 text-[12px] tabular-nums">{galleryIdx + 1} / {gallery.length}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
