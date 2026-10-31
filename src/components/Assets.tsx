import React, { useState, useEffect, useRef } from 'react';
import { Package, Plus, Pencil, Trash2, Camera, Loader2, X, FileDown, ShieldAlert, Receipt, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { AssetItem } from '../types';
import { FAMILY_ID, loadAssets, saveAsset, deleteAsset, uploadAssetPhoto } from '../utils/db';
import { createFileOperationScope, type FileOperationScope } from '../utils/fileOperationScope';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth } from '../lib/firebase';
import { compressImageToAvatar } from '../utils/imageCompress';
import { parseAmount } from '../utils/money';
import AssetClaimExport from './AssetClaimExport';
import SheetGrabber from './SheetGrabber';
import AssetServiceHistory from './AssetServiceHistory';
import AssetDetailModal from './AssetDetailModal';
import AssetRegisterDetails from './AssetRegisterDetails';
import AssetEvidenceFields from './AssetEvidenceFields';
import AssetRecordReadiness from './AssetRecordReadiness';
import { assetReminders, isIncidentAsset, validateAssetRegister } from '../utils/assetRegister';
import EmptyState from './EmptyState';
import { SkeletonHeader, SkeletonRows } from './Skeleton';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  CATEGORIES, IDENTIFIER_TYPES, CONDITIONS, STORAGE_OPTIONS, CURRENCIES, STATUSES,
  CURRENCY_SYMBOL, suggestIdentifier, itemImages,
} from '../utils/assetConstants';

const BLANK: AssetItem = {
  id: '', name: '', category: 'Electronics', assignedMember: '',
  make: '', model: '', serialNumber: '', identifierType: 'Serial',
  purchaseDate: '', purchasePrice: '', currency: 'EUR', replacementValue: '',
  purchaseLocation: '', warrantyUntil: '', condition: '', storageSecurity: '',
  notes: '', photoDataUrl: '', photos: [], receiptDataUrl: '',
  status: 'owned', createdAt: '',
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Prefer replacement value, fall back to purchase price (handles EU/EN formats).
function itemValue(item: AssetItem): number {
  return parseAmount(item.replacementValue || item.purchasePrice);
}

// Extra photos live in Firebase Storage (not inline), so the cap is generous.
const EXTRA_PHOTO_CAP = 12;

export default function Assets() {
  const { isAdmin, aiEligible, aiConsent } = useFamilyCtx();
  const aiOn = aiEligible && aiConsent;  // AI scan is off until the user opts in
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<AssetItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [gallery, setGallery] = useState<{ src: string; label: string }[] | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const openGallery = (imgs: { src: string; label: string }[], idx = 0) => { if (imgs.length) { setGallery(imgs); setGalleryIdx(idx); } };
  const [showExport, setShowExport] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [viewingItem, setViewingItem] = useState<AssetItem | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoKindRef = useRef<'primary' | 'extra' | 'receipt'>('primary');
  const photoEpoch = useRef(0);
  const photoMounted = useRef(true);
  const photoBusy = useRef(false);
  const photoEditing = useRef(editingItem);
  const photoWritable = useRef(isAdmin);
  const photoFormOpen = useRef(isFormOpen);
  const pendingPhoto = useRef<FileOperationScope | null>(null);
  const pendingScan = useRef<FileOperationScope | null>(null);
  const scanBusy = useRef(false);
  const scanAllowed = useRef(aiOn);
  photoEditing.current = editingItem;
  photoWritable.current = isAdmin;
  photoFormOpen.current = isFormOpen;
  scanAllowed.current = aiOn;
  useEffect(() => {
    photoMounted.current = true;
    return () => { photoMounted.current = false; photoEpoch.current++; };
  }, []);
  const invalidatePhotos = () => {
    photoEpoch.current++;
    pendingPhoto.current = null;
    pendingScan.current = null;
    photoBusy.current = false;
    scanBusy.current = false;
    setUploadingPhotos(false);
    setScanLoading(false);
    setPhotoError(null);
  };

  const scanFileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  // Two independent full-screen overlays live in this component (the edit
  // form and the photo/receipt gallery) — each manages its own visibility
  // internally, so each gets its own lock call. Reference-counted, so both
  // can be open at once (gallery launched from inside the form) safely.
  useBodyScrollLock(isFormOpen);
  useBodyScrollLock(!!gallery && gallery.length > 0);

  useEffect(() => {
    loadAssets().then(data => { setItems(data); setLoading(false); });
  }, []);

  const reload = async () => setItems(await loadAssets());

  const openNewForm = () => {
    invalidatePhotos();
    photoEditing.current = { ...BLANK };
    photoFormOpen.current = true;
    setEditingItem(photoEditing.current);
    setScanError(null); setFormError(null); setIsFormOpen(true);
  };
  const openEditForm = (item: AssetItem) => {
    invalidatePhotos();
    photoEditing.current = { ...BLANK, ...item };
    photoFormOpen.current = true;
    setEditingItem(photoEditing.current);
    setScanError(null); setFormError(null); setIsFormOpen(true);
  };
  const closeForm = () => {
    invalidatePhotos();
    photoFormOpen.current = false;
    photoEditing.current = null;
    setIsFormOpen(false); setEditingItem(null);
  };

  const patch = (p: Partial<AssetItem>) => setEditingItem(prev => (prev ? { ...prev, ...p } : prev));
  const patchIncident = (p: Partial<NonNullable<AssetItem['incident']>>) =>
    setEditingItem(prev => (prev ? { ...prev, incident: { ...prev.incident, ...p } } : prev));

  // ── Scan asset via /api/scan-asset ──
  const processImageForScan = async (file: File, operation: FileOperationScope) => {
    if (!operation.isCurrent() || !photoWritable.current || scanBusy.current || photoBusy.current) return;
    if (!aiOn) { setScanError('Turn on the AI assistant in Settings first.'); return; }
    const epoch = photoEpoch.current;
    scanBusy.current = true;
    setScanLoading(true); setScanError(null);
    try {
      const dataUrl = await operation.step(() => readFile(file));
      const compressed = await operation.step(() => compressImageToAvatar(dataUrl, 1600, 0.85));
      const base64Data = compressed.split(',')[1];
      const mimeType = file.type || 'image/jpeg';
      const token = await operation.step(() => auth.currentUser?.getIdToken());
      const resp = await operation.step(() => fetch('/api/scan-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ image: { mimeType, data: base64Data } }),
      }));
      if (!resp.ok) {
        // Parse as JSON first — the server always responds with { error }
        // (e.g. the AI-usage-limit message, "You've used all 30 AI actions
        // this month…"). Falling back to raw response text previously meant
        // a limit/error response's raw JSON body was shown to the user
        // verbatim instead of that human message.
        let msg = `Scan failed (${resp.status})`;
        try { const j = await operation.step(() => resp.json()); if (j?.error) msg = j.error; } catch { operation.check(); /* keep default */ }
        throw new Error(msg);
      }
      const scanned = await operation.step(() => resp.json());
      operation.check();
      setEditingItem(prev => {
        if (!operation.isCurrent()) return prev;
        const base = prev ?? { ...BLANK };
        // Validate against our enum — the model may return e.g. "Jewelry"/"Sports"
        // which would save fine but never render (grouping is enum-keyed).
        const category = (CATEGORIES as string[]).includes(scanned.category)
          ? (scanned.category as AssetItem['category'])
          : (base.category || 'Electronics');
        return {
          ...base,
          name: scanned.name || base.name || '',
          make: scanned.make || base.make || '',
          model: scanned.model || base.model || '',
          serialNumber: scanned.serialNumber || base.serialNumber || '',
          identifierType: base.identifierType || suggestIdentifier(category),
          category,
          // AssetItem has no dedicated size/color fields — /api/scan-asset reads
          // them off the label but they were dropped on the floor here, never
          // making it into the saved item at all (pre-publish audit). Fold them
          // into notes, the same free-text field everything else without its own
          // column already lands in.
          notes: [scanned.notes, scanned.size ? `Size: ${scanned.size}` : '', scanned.color ? `Color: ${scanned.color}` : '']
            .filter(Boolean).join(' · ') || base.notes || '',
          photoDataUrl: compressed,
        };
      });
      if (operation.isCurrent()) setIsFormOpen(true);
    } catch (err: unknown) {
      if (operation.isCurrent()) setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      if (photoMounted.current && photoEpoch.current === epoch) { scanBusy.current = false; setScanLoading(false); }
    }
  };

  const handleScanAsset = () => {
    if (!photoMounted.current || !photoWritable.current || photoBusy.current || scanBusy.current) return;
    photoEpoch.current++;
    pendingScan.current = createFileOperationScope(() => [auth.currentUser?.uid, FAMILY_ID, photoEditing.current?.id, photoEpoch.current, photoMounted.current, photoWritable.current, photoFormOpen.current, scanAllowed.current]);
    scanFileRef.current?.click();
  };
  const handleScanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    const operation = pendingScan.current;
    pendingScan.current = null;
    if (!file || !operation?.isCurrent()) return;
    await processImageForScan(file, operation);
  };

  // ── Photos (primary / extra / receipt) ──
  const triggerPhoto = (kind: 'primary' | 'extra' | 'receipt') => {
    if (!photoMounted.current || !photoWritable.current || !photoFormOpen.current || !photoEditing.current || photoBusy.current || scanBusy.current) return;
    photoEpoch.current++;
    photoKindRef.current = kind;
    pendingPhoto.current = createFileOperationScope(() => [auth.currentUser?.uid, FAMILY_ID, photoEditing.current?.id, photoEpoch.current, photoMounted.current, photoWritable.current, photoFormOpen.current, photoKindRef.current]);
    photoFileRef.current?.click();
  };
  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : []; e.target.value = '';
    const operation = pendingPhoto.current;
    pendingPhoto.current = null;
    if (!files.length || !operation?.isCurrent() || photoBusy.current || !photoWritable.current || !photoFormOpen.current || !photoEditing.current) return;
    const epoch = photoEpoch.current;
    const kind = photoKindRef.current;
    photoBusy.current = true;
    setPhotoError(null); setUploadingPhotos(true);
    try {
      if (kind !== 'extra') {
        const data = await operation.step(() => readFile(files[0]));
        const compressed = await operation.step(() => compressImageToAvatar(data, 1500, kind === 'receipt' ? 0.78 : 0.82));
        operation.check();
        setEditingItem(prev => operation.isCurrent() && prev ? { ...prev, [kind === 'receipt' ? 'receiptDataUrl' : 'photoDataUrl']: compressed } : prev);
        return;
      }
      const start = (photoEditing.current.photos || []).length;
      const room = Math.max(0, EXTRA_PHOTO_CAP - start);
      if (files.length > room) setPhotoError(`Only ${room} more photo${room === 1 ? '' : 's'} can be added (max ${EXTRA_PHOTO_CAP}).`);
      for (const file of files.slice(0, room)) {
        const data = await operation.step(() => readFile(file));
        const compressed = await operation.step(() => compressImageToAvatar(data, 1600, 0.82));
        const url = await operation.step(() => uploadAssetPhoto(compressed));
        operation.check();
        setEditingItem(prev => operation.isCurrent() && prev ? { ...prev, photos: [...(prev.photos || []), url].slice(0, EXTRA_PHOTO_CAP) } : prev);
      }
    } catch {
      if (operation.isCurrent()) setPhotoError(kind === 'extra' ? 'Some photos could not be uploaded — please try again.' : 'This image could not be prepared. Please try another image.');
    } finally {
      if (photoMounted.current && photoEpoch.current === epoch) { photoBusy.current = false; setUploadingPhotos(false); }
    }
  };
  const removeExtraPhoto = (idx: number) =>
    setEditingItem(prev => {
      if (!prev || !photoWritable.current || !photoFormOpen.current) return prev;
      // Editing unlinks only. Cancelling must leave the saved evidence intact.
      return { ...prev, photos: (prev.photos || []).filter((_, i) => i !== idx) };
    });

  // ── Save ──
  const handleSave = async () => {
    if (photoBusy.current || scanBusy.current) return;
    if (!editingItem) return;
    if (!editingItem.name.trim()) { setFormError('Name is required'); return; }
    const invalid = validateAssetRegister(editingItem);
    if (invalid) { setFormError(invalid); return; }
    setFormError(null); setSaving(true);
    const isNew = !editingItem.id;
    const id = isNew ? Date.now().toString() + Math.random().toString(36).slice(2, 8) : editingItem.id;
    const createdAt = isNew ? new Date().toISOString().slice(0, 10) : editingItem.createdAt;
    // Drop an empty incident so we don't persist a hollow object.
    const inc = editingItem.incident;
    const incident = inc && (inc.date || inc.policeReference || inc.notes || inc.type) ? inc : undefined;
    const toSave: AssetItem = { ...editingItem, id, createdAt, incident };
    const ok = await saveAsset(toSave);
    setSaving(false);
    if (!ok) { setFormError('Could not save — the photos may be too large. Try fewer or smaller photos.'); return; }
    await reload();
    closeForm();
  };

  // Confirmation now lives in ConfirmDeleteButton (in-place two-step) at the
  // call site — a bare window.confirm() looks and behaves like a broken
  // webpage inside the iOS home-screen PWA.
  const handleDelete = async (id: string) => {
    await deleteAsset(id);
    setItems(prev => prev.filter(i => i.id !== id));
    if (editingItem?.id === id) closeForm();
  };

  // ── Grouping + totals ──
  const grouped = new Map<AssetItem['category'], AssetItem[]>();
  for (const item of items) {
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category)!.push(item);
  }
  const totalValue = items.reduce((acc, item) => acc + itemValue(item), 0);
  // Only show a single total when every valued item shares one currency —
  // summing across currencies would be meaningless.
  const valueCurrencies: string[] = Array.from(new Set(items.filter(i => i.replacementValue || i.purchasePrice).map(i => i.currency || 'EUR')));
  const totalCurrency: string | null = valueCurrencies.length === 1 ? valueCurrencies[0] : null;
  const flaggedCount = items.filter(isIncidentAsset).length;
  const reminders = assetReminders(items);
  // Render every category present, unknown ones (e.g. from old data) last, so no item is orphaned.
  const orderedCats = [
    ...CATEGORIES.filter(c => grouped.has(c)),
    ...[...grouped.keys()].filter(c => !(CATEGORIES as string[]).includes(c)),
  ];

  if (loading) {
    return (
      <div className="max-w-lg">
        <div className="card overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-cream-200">
            <SkeletonHeader />
          </div>
          <div className="p-4 sm:p-5">
            <SkeletonRows rows={4} />
          </div>
        </div>
      </div>
    );
  }

  const editing = editingItem; // narrow for the form block

  return (
    <div className="max-w-lg">
      <input ref={scanFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScanFileChange} />
      <input ref={photoFileRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoFileChange} />

      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sage-100 text-sage-700 shrink-0"><Package className="w-5 h-5" /></div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Assets</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                {items.length === 0
                  ? 'No assets yet'
                  : `${items.length} item${items.length !== 1 ? 's' : ''}${totalValue > 0 && totalCurrency ? ` · ${CURRENCY_SYMBOL[totalCurrency] || `${totalCurrency} `}${totalValue.toLocaleString('de-AT', { maximumFractionDigits: 0 })} total` : ''}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {items.length > 0 && (
              <button onClick={() => setShowExport(true)} className="btn-quiet text-xs px-3 py-2" title="Export asset records and evidence">
                <FileDown className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Export</span>
              </button>
            )}
            {isAdmin && (
              <>
                <button onClick={openNewForm} className="btn-quiet text-xs px-3 py-2"><Plus className="w-3.5 h-3.5" /> Add</button>
                <button onClick={handleScanAsset} disabled={scanLoading || !aiOn} className="btn-primary text-xs px-3 py-2 disabled:opacity-60">
                  {scanLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} Scan
                </button>
              </>
            )}
          </div>
        </div>

        {flaggedCount > 0 && (
          <button onClick={() => setShowExport(true)} className="w-full px-5 py-2.5 bg-rosa-50 border-b border-rosa-100 flex items-center gap-2 text-left hover:bg-rosa-100/60 transition-colors">
            <ShieldAlert className="w-4 h-4 text-rosa-600 shrink-0" />
            <p className="text-[12.5px] font-semibold text-rosa-700">{flaggedCount} item{flaggedCount !== 1 ? 's' : ''} reported damaged, stolen or lost — prepare a claim pack</p>
          </button>
        )}

        {reminders.length > 0 && <details className="px-5 py-3 bg-clay-50 border-b border-cream-200">
          <summary className="cursor-pointer text-xs font-semibold text-clay-700">{reminders.length} warranty or return deadline{reminders.length === 1 ? '' : 's'} approaching</summary>
          <div className="mt-2 space-y-2">{reminders.map(r => <button key={r.id} onClick={() => setViewingItem(items.find(i => i.id === r.assetId) || null)} className="block text-left text-xs text-ink-600 hover:underline">{r.label} {r.days === 0 ? 'today' : `in ${r.days} days`} · {r.date}</button>)}</div>
        </details>}

        {scanError && !isFormOpen && (
          <div className="px-5 py-3 bg-rosa-500/10 border-b border-rosa-500/20 flex items-center justify-between gap-2">
            <p className="text-[12px] text-rosa-600">{scanError}</p>
            <button onClick={() => setScanError(null)} className="text-rosa-600 hover:text-rosa-700"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <div className="p-4 sm:p-5">
          {items.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No assets yet"
              description="Add bikes, laptops, phones and more — with photos & receipts for insurance"
              action={isAdmin ? { label: 'Add asset', onClick: openNewForm, icon: Plus } : undefined}
            />
          ) : (
            <div className="space-y-5">
              {orderedCats.map(cat => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">{cat}</p>
                    <span className="text-[11px] text-ink-300">{grouped.get(cat)!.length}</span>
                  </div>
                  <div className="space-y-1">
                    {grouped.get(cat)!.map(item => {
                      const flagged = isIncidentAsset(item);
                      return (
                        <div key={item.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors">
                          {item.photoDataUrl ? (
                            <button type="button" onClick={() => openGallery(itemImages(item))}
                              className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center ring-1 ring-cream-200 hover:ring-clay-300 transition-all cursor-zoom-in" title="View photos">
                              <img src={item.photoDataUrl} alt={item.name} className="w-full h-full object-cover" />
                            </button>
                          ) : isAdmin ? (
                            <button type="button" onClick={() => openEditForm(item)}
                              className="group/ph w-10 h-10 rounded-lg shrink-0 bg-clay-50/60 border border-dashed border-clay-300 flex items-center justify-center hover:border-clay-400 hover:bg-clay-50 transition-all cursor-pointer" title="Add a photo">
                              <Camera className="w-4 h-4 text-clay-400 group-hover/ph:text-clay-600 transition-colors" />
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center"><Package className="w-4 h-4 text-ink-300" /></div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-ink-800 text-[14px] leading-tight truncate flex items-center gap-1.5">
                              <button type="button" onClick={() => setViewingItem(item)} className="truncate text-left hover:underline" title={`View ${item.name}`}>{item.name}</button>
                              {flagged && <span className="chip bg-rosa-100 text-rosa-700 text-[10px] px-1.5 py-0">{item.status === 'damaged' ? 'Damaged' : item.status === 'lost' ? 'Lost' : 'Stolen'}</span>}
                            </p>
                            {(item.make || item.model) && <p className="text-[12px] text-ink-400 truncate">{[item.make, item.model].filter(Boolean).join(' ')}</p>}
                            {item.serialNumber && <p className="text-[11px] text-ink-500 font-mono truncate">{item.identifierType && item.identifierType !== 'Serial' ? `${item.identifierType} ` : ''}{item.serialNumber}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {item.receiptDataUrl && <Receipt className="w-3.5 h-3.5 text-sage-600" aria-label="Receipt on file" />}
                            {item.assignedMember && <span className="bg-sage-100 text-sage-700 text-[11px] px-2 py-0.5 rounded-full font-medium">{item.assignedMember}</span>}
                            {(item.replacementValue || item.purchasePrice) && <span className="text-[12px] text-ink-500 tabular-nums">{item.replacementValue || item.purchasePrice}</span>}
                            {itemImages(item).length > 0 && (
                              <button onClick={() => openGallery(itemImages(item))} className="btn-quiet p-1.5" title="View photos & receipt"><Eye className="w-3.5 h-3.5" /></button>
                            )}
                            {isAdmin && (
                              <button onClick={() => openEditForm(item)} className="btn-quiet p-1.5 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal form ── */}
      {isFormOpen && editing && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <SheetGrabber onClose={closeForm} />
            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">{editing.id ? 'Edit asset' : 'New asset'}</h3>
              <button onClick={closeForm} className="btn-quiet p-2"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-6 space-y-4">
              {scanError && (
                <div className="flex items-center justify-between gap-2 bg-rosa-500/10 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-rosa-600">{scanError}</p>
                  <button onClick={() => setScanError(null)}><X className="w-3.5 h-3.5 text-rosa-600" /></button>
                </div>
              )}

              {/* Primary photo + scan/add */}
              <div className="flex items-center gap-4">
                {editing.photoDataUrl ? (
                  <div className="relative shrink-0">
                    <img src={editing.photoDataUrl} alt="Asset photo" className="w-24 h-24 object-cover rounded-xl border border-cream-200" />
                    <button onClick={() => patch({ photoDataUrl: '' })} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500 transition-colors"><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-xl border-2 border-dashed border-cream-300 flex items-center justify-center shrink-0"><Package className="w-6 h-6 text-ink-200" /></div>
                )}
                <div className="space-y-2 flex-1">
                  <button onClick={handleScanAsset} disabled={scanLoading || !aiOn} className="btn-quiet text-xs px-3 py-2 w-full disabled:opacity-60">
                    {scanLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />} {scanLoading ? 'Scanning…' : 'Scan label'}
                  </button>
                  <button onClick={() => triggerPhoto('primary')} className="btn-quiet text-xs px-3 py-2 w-full"><Plus className="w-3.5 h-3.5" /> Item photo</button>
                </div>
              </div>

              {/* Extra photos (serial plate, angles) + receipt */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">More photos <span className="normal-case text-ink-300 font-normal">· serial plate, angles — pick several at once</span></label>
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
                {photoError && <p className="text-[11px] text-rosa-600 mt-1.5">{photoError}</p>}
              </div>

              {/* Receipt / proof of purchase */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Receipt photo</label>
                <div className="flex items-center gap-3">
                  {editing.receiptDataUrl ? (
                    <div className="relative shrink-0">
                      <button type="button" onClick={() => openGallery([{ src: editing.receiptDataUrl!, label: 'Receipt' }])} className="w-16 h-16 rounded-lg overflow-hidden bg-cream-100 ring-1 ring-sage-200 cursor-zoom-in"><img src={editing.receiptDataUrl} alt="Receipt" className="w-full h-full object-cover" /></button>
                      <button onClick={() => patch({ receiptDataUrl: '' })} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500"><X className="w-2.5 h-2.5" /></button>
                    </div>
                  ) : (
                    <button onClick={() => triggerPhoto('receipt')} className="btn-quiet text-xs px-3 py-2"><Receipt className="w-3.5 h-3.5" /> Add receipt photo</button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-ink-400">For original PDFs and invoices, use Receipts &amp; original files below.</p>
              </div>

              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Name <span className="text-rosa-600">*</span></label>
                <input type="text" placeholder="e.g. MacBook Air" value={editing.name} onChange={e => patch({ name: e.target.value })} className="field w-full" />
                {formError && <p className="text-[11px] text-rosa-600 mt-1">{formError}</p>}
              </div>

              {/* Category + Assigned */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Category</label>
                  <select value={editing.category} onChange={e => {
                    const category = e.target.value as AssetItem['category'];
                    patch({ category, identifierType: !editing.serialNumber ? suggestIdentifier(category) : editing.identifierType });
                  }} className="field w-full">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Assigned to</label>
                  <input type="text" placeholder="e.g. Mia" value={editing.assignedMember || ''} onChange={e => patch({ assignedMember: e.target.value })} className="field w-full" />
                </div>
              </div>

              {/* Make + Model */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Make</label>
                  <input type="text" placeholder="e.g. Apple" value={editing.make || ''} onChange={e => patch({ make: e.target.value })} className="field w-full" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Model</label>
                  <input type="text" placeholder="e.g. M2 13-inch" value={editing.model || ''} onChange={e => patch({ model: e.target.value })} className="field w-full" />
                </div>
              </div>

              {/* Identifier type + number */}
              <div className="grid grid-cols-[7.5rem_1fr] gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">ID type</label>
                  <select value={editing.identifierType || 'Serial'} onChange={e => patch({ identifierType: e.target.value })} className="field w-full">
                    {IDENTIFIER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">{editing.identifierType || 'Serial'} number</label>
                  <input type="text" placeholder="SN / IMEI / frame no." value={editing.serialNumber || ''} onChange={e => patch({ serialNumber: e.target.value })} className="field w-full font-mono" />
                </div>
              </div>

              {/* Purchase date + condition */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Purchase date</label>
                  <input type="date" value={editing.purchaseDate || ''} onChange={e => patch({ purchaseDate: e.target.value })} className="field w-full" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Condition</label>
                  <select value={editing.condition || ''} onChange={e => patch({ condition: e.target.value })} className="field w-full">
                    <option value="">—</option>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Currency + purchase price + replacement value */}
              <div className="grid grid-cols-[5rem_1fr_1fr] gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Cur.</label>
                  <select value={editing.currency || 'EUR'} onChange={e => patch({ currency: e.target.value })} className="field w-full">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Paid</label>
                  <input type="text" inputMode="decimal" placeholder="450" value={editing.purchasePrice || ''} onChange={e => patch({ purchasePrice: e.target.value })} className="field w-full tabular-nums" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Replace now</label>
                  <input type="text" inputMode="decimal" placeholder="today's cost" value={editing.replacementValue || ''} onChange={e => patch({ replacementValue: e.target.value })} className="field w-full tabular-nums" />
                </div>
              </div>

              {/* Purchase location + warranty */}
              <div className={items.find(i => i.id === editing.id)?.warrantyUntil ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'grid grid-cols-1 gap-4'}>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Bought at</label>
                  <input type="text" placeholder="retailer" value={editing.purchaseLocation || ''} onChange={e => patch({ purchaseLocation: e.target.value })} className="field w-full" />
                </div>
                {items.find(i => i.id === editing.id)?.warrantyUntil && <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Earlier warranty expiry</label>
                  <input type="date" value={editing.warrantyUntil || ''} onChange={e => patch({ warrantyUntil: e.target.value })} className="field w-full" />
                  <p className="mt-1 text-[11px] text-ink-400">Type unspecified. Add separate cover details below.</p>
                </div>}
              </div>

              {/* Storage security */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Where it's kept <span className="normal-case text-ink-300 font-normal">· affects valuables cover</span></label>
                <select value={editing.storageSecurity || ''} onChange={e => patch({ storageSecurity: e.target.value })} className="field w-full">
                  <option value="">—</option>
                  {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Status + incident (theft/loss) */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Status</label>
                  <select value={editing.status || 'owned'} onChange={e => {
                    const status = e.target.value as AssetItem['status'];
                    // Recovered/resolved → clear the incident so it leaves the claim list.
                    patch(isIncidentAsset({ ...editing, status }) ? { status, incident: { ...editing.incident, type: status as 'stolen' | 'lost' | 'damaged' } } : { status, incident: undefined });
                  }} className="field w-full">
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                {isIncidentAsset(editing) && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Incident date</label>
                        <input type="date" value={editing.incident?.date || ''} onChange={e => patchIncident({ date: e.target.value })} className="field w-full" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Police ref.</label>
                        <input type="text" placeholder="if applicable" value={editing.incident?.policeReference || ''} onChange={e => patchIncident({ policeReference: e.target.value })} className="field w-full font-mono" />
                      </div>
                    </div>
                    <label className="block text-xs font-semibold text-ink-500">What happened<textarea rows={3} value={editing.incident?.notes || ''} onChange={e => patchIncident({ notes: e.target.value })} className="field w-full mt-1" /></label>
                  </div>
                )}
              </div>

              <AssetRecordReadiness item={editing} />
              <AssetRegisterDetails item={editing} onChange={patch} />
              <AssetEvidenceFields item={editing} onChange={patch} onBusyChange={setEvidenceBusy} />

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Notes</label>
                <textarea rows={3} placeholder="Anything else worth recording…" value={editing.notes || ''} onChange={e => patch({ notes: e.target.value })} className="field w-full resize-none" />
              </div>

              {/* The item's own service history, derived from the house's work
                  log. Here as well as in AssetDetailModal because an
                  unassigned appliance (the dishwasher) never appears on a
                  member's Belongings card — this form is its only detail view. */}
              {editing.id && <AssetServiceHistory assetId={editing.id} category={editing.category} />}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-6 pt-0">
              <div>
                {editing.id && (
                  <ConfirmDeleteButton
                    onConfirm={() => handleDelete(editing.id)}
                    ariaLabel={`Delete ${editing.name || 'this asset'}`}
                    variant="danger-text"
                    className="rounded-xl px-3 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </ConfirmDeleteButton>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={closeForm} className="btn-quiet text-xs px-4 py-2">Cancel</button>
                <button onClick={handleSave} disabled={saving || uploadingPhotos || scanLoading || evidenceBusy} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingItem && <AssetDetailModal item={viewingItem} canEdit={isAdmin} onClose={() => setViewingItem(null)} onSaved={next => { setViewingItem(null); void reload(); }} onDeleted={() => { setViewingItem(null); void reload(); }} />}

      {/* Full-size photo & receipt gallery */}
      {gallery && gallery.length > 0 && (
        <div className="fixed inset-0 z-[60] bg-ink-900/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 anim-fade" onClick={() => setGallery(null)}>
          <button onClick={() => setGallery(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-ink-800 flex items-center justify-center hover:bg-white transition-colors z-10" aria-label="Close"><X className="w-5 h-5" /></button>
          <div className="flex items-center gap-2 sm:gap-4" onClick={e => e.stopPropagation()}>
            {gallery.length > 1 && (
              <button onClick={() => setGalleryIdx(i => (i - 1 + gallery.length) % gallery.length)} className="w-10 h-10 rounded-full bg-white/90 text-ink-800 flex items-center justify-center hover:bg-white shrink-0" aria-label="Previous"><ChevronLeft className="w-5 h-5" /></button>
            )}
            <img src={gallery[galleryIdx].src} alt={gallery[galleryIdx].label} className="max-w-[78vw] max-h-[78dvh] object-contain rounded-2xl shadow-2xl bg-white" />
            {gallery.length > 1 && (
              <button onClick={() => setGalleryIdx(i => (i + 1) % gallery.length)} className="w-10 h-10 rounded-full bg-white/90 text-ink-800 flex items-center justify-center hover:bg-white shrink-0" aria-label="Next"><ChevronRight className="w-5 h-5" /></button>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2.5" onClick={e => e.stopPropagation()}>
            <span className="chip bg-white/90 text-ink-700">{gallery[galleryIdx].label}</span>
            {gallery.length > 1 && <span className="text-white/70 text-[12px] tabular-nums">{galleryIdx + 1} / {gallery.length}</span>}
          </div>
        </div>
      )}

      {showExport && <AssetClaimExport items={items} onClose={() => setShowExport(false)} />}
    </div>
  );
}
