import React, { useState, useEffect, useRef } from 'react';
import { Package, Plus, Pencil, Trash2, Camera, Loader2, X } from 'lucide-react';
import { AssetItem } from '../types';
import { loadAssets, saveAsset, deleteAsset } from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth } from '../lib/firebase';
import { compressImageToAvatar } from '../utils/imageCompress';

const CATEGORIES: AssetItem['category'][] = [
  'Electronics', 'Bike', 'Sporting', 'Vehicle', 'Jewellery', 'Furniture', 'Other',
];

const BLANK: AssetItem = {
  id: '',
  name: '',
  category: 'Electronics',
  assignedMember: '',
  make: '',
  model: '',
  serialNumber: '',
  purchaseDate: '',
  purchasePrice: '',
  notes: '',
  photoDataUrl: '',
  createdAt: '',
};

export default function Assets() {
  const { isAdmin } = useFamilyCtx();
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<AssetItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [photoView, setPhotoView] = useState<string | null>(null); // full-size image record

  const scanFileRef = useRef<HTMLInputElement>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAssets().then(data => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  const reload = async () => {
    const data = await loadAssets();
    setItems(data);
  };

  // ── Open/close form ──

  const openNewForm = () => {
    setEditingItem({ ...BLANK });
    setScanError(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (item: AssetItem) => {
    setEditingItem({ ...item });
    setScanError(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingItem(null);
  };

  // ── Scan asset via /api/scan-asset ──

  const processImageForScan = async (file: File) => {
    setScanLoading(true);
    setScanError(null);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = e => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const compressed = await compressImageToAvatar(dataUrl, 1600, 0.85);
      const base64Data = compressed.split(',')[1];
      const mimeType = file.type || 'image/jpeg';

      const token = await auth.currentUser?.getIdToken();
      const resp = await fetch('/api/scan-asset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ image: { mimeType, data: base64Data } }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Scan failed (${resp.status})`);
      }

      const scanned = await resp.json();

      // Open / update the form with scanned data
      setEditingItem(prev => {
        const base = prev ?? { ...BLANK };
        return {
          ...base,
          name: scanned.name || base.name || '',
          make: scanned.make || base.make || '',
          model: scanned.model || base.model || '',
          serialNumber: scanned.serialNumber || base.serialNumber || '',
          category: (scanned.category as AssetItem['category']) || base.category || 'Electronics',
          notes: scanned.notes || base.notes || '',
          photoDataUrl: compressed,
        };
      });
      setIsFormOpen(true);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanLoading(false);
    }
  };

  const handleScanAsset = () => {
    scanFileRef.current?.click();
  };

  const handleScanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await processImageForScan(file);
  };

  // ── Photo attachment (manual, no OCR) ──

  const handleAddPhoto = () => {
    photoFileRef.current?.click();
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    const dataUrl: string = await new Promise((resolve, reject) => {
      reader.onload = ev => resolve(ev.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const compressed = await compressImageToAvatar(dataUrl, 1600, 0.85);
    setEditingItem(prev => prev ? { ...prev, photoDataUrl: compressed } : prev);
  };

  // ── Save ──

  const handleSave = async () => {
    if (!editingItem) return;
    if (!editingItem.name.trim()) {
      setFormError('Name is required');
      return;
    }
    setFormError(null);

    const isNew = !editingItem.id;
    const id = isNew
      ? Date.now().toString() + Math.random().toString(36).slice(2, 8)
      : editingItem.id;
    const createdAt = isNew
      ? new Date().toISOString().slice(0, 10)
      : editingItem.createdAt;

    const toSave: AssetItem = { ...editingItem, id, createdAt };
    await saveAsset(toSave);
    await reload();
    closeForm();
  };

  // ── Delete ──

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this asset? This cannot be undone.')) return;
    await deleteAsset(id);
    setItems(prev => prev.filter(i => i.id !== id));
    if (editingItem?.id === id) closeForm();
  };

  // ── Group by category ──

  const grouped = new Map<AssetItem['category'], AssetItem[]>();
  for (const item of items) {
    if (!grouped.has(item.category)) grouped.set(item.category, []);
    grouped.get(item.category)!.push(item);
  }

  // ── Total value ──

  const totalValue = items.reduce((acc, item) => {
    const n = parseFloat((item.purchasePrice || '').replace(/[^0-9.]/g, ''));
    return acc + (isNaN(n) ? 0 : n);
  }, 0);

  // ── Loading ──

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      {/* Hidden file inputs */}
      <input
        ref={scanFileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleScanFileChange}
      />
      <input
        ref={photoFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoFileChange}
      />

      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sage-100 text-sage-700 shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Assets</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                {items.length === 0
                  ? 'No assets yet'
                  : `${items.length} item${items.length !== 1 ? 's' : ''}${totalValue > 0 ? ` · €${totalValue.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} total` : ''}`}
              </p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={openNewForm}
                className="btn-quiet text-xs px-3 py-2"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
              <button
                onClick={handleScanAsset}
                disabled={scanLoading}
                className="btn-primary text-xs px-3 py-2 disabled:opacity-60"
              >
                {scanLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Camera className="w-3.5 h-3.5" />}
                Scan
              </button>
            </div>
          )}
        </div>

        {/* Scan error banner */}
        {scanError && !isFormOpen && (
          <div className="px-5 py-3 bg-rosa-500/10 border-b border-rosa-500/20 flex items-center justify-between gap-2">
            <p className="text-[12px] text-rosa-600">{scanError}</p>
            <button onClick={() => setScanError(null)} className="text-rosa-600 hover:text-rosa-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* List */}
        <div className="p-4 sm:p-5">
          {items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-10 h-10 text-ink-200 mx-auto mb-3" />
              <p className="text-[14px] font-medium text-ink-400">No assets yet</p>
              <p className="text-[12px] text-ink-300 mt-1">Add bikes, laptops, phones and more</p>
              {isAdmin && (
                <button onClick={openNewForm} className="btn-primary mt-5 text-xs px-4 py-2">
                  <Plus className="w-3.5 h-3.5" />
                  Add asset
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {CATEGORIES.filter(cat => grouped.has(cat)).map(cat => {
                const catItems = grouped.get(cat)!;
                return (
                  <div key={cat}>
                    {/* Category header */}
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">{cat}</p>
                      <span className="text-[11px] text-ink-300">{catItems.length}</span>
                    </div>
                    <div className="space-y-1">
                      {catItems.map(item => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors"
                        >
                          {/* Photo or icon — tap photo to view full-size */}
                          {item.photoDataUrl ? (
                            <button
                              type="button"
                              onClick={() => setPhotoView(item.photoDataUrl!)}
                              className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center ring-1 ring-cream-200 hover:ring-clay-300 transition-all cursor-zoom-in"
                              title="View photo"
                            >
                              <img src={item.photoDataUrl} alt={item.name} className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                              <Package className="w-4 h-4 text-ink-300" />
                            </div>
                          )}

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-ink-800 text-[14px] leading-tight truncate">{item.name}</p>
                            {(item.make || item.model) && (
                              <p className="text-[12px] text-ink-400 truncate">
                                {[item.make, item.model].filter(Boolean).join(' ')}
                              </p>
                            )}
                            {item.serialNumber && (
                              <p className="text-[11px] text-ink-500 font-mono truncate">{item.serialNumber}</p>
                            )}
                          </div>

                          {/* Right side meta */}
                          <div className="flex items-center gap-2 shrink-0">
                            {item.assignedMember && (
                              <span className="bg-sage-100 text-sage-700 text-[11px] px-2 py-0.5 rounded-full font-medium">
                                {item.assignedMember}
                              </span>
                            )}
                            {item.purchasePrice && (
                              <span className="text-[12px] text-ink-500">{item.purchasePrice}</span>
                            )}
                            {isAdmin && (
                              <button
                                onClick={() => openEditForm(item)}
                                className="btn-quiet p-1.5 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal form ── */}
      {isFormOpen && editingItem && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl">
            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {editingItem.id ? 'Edit asset' : 'New asset'}
              </h3>
              <button onClick={closeForm} className="btn-quiet p-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Scan error inside modal */}
              {scanError && (
                <div className="flex items-center justify-between gap-2 bg-rosa-500/10 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-rosa-600">{scanError}</p>
                  <button onClick={() => setScanError(null)}>
                    <X className="w-3.5 h-3.5 text-rosa-600" />
                  </button>
                </div>
              )}

              {/* Photo row */}
              <div className="flex items-center gap-4">
                {editingItem.photoDataUrl ? (
                  <div className="relative shrink-0">
                    <img
                      src={editingItem.photoDataUrl}
                      alt="Asset photo"
                      className="w-24 h-24 object-cover rounded-xl border border-cream-200"
                    />
                    <button
                      onClick={() => setEditingItem(prev => prev ? { ...prev, photoDataUrl: '' } : prev)}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-xl border-2 border-dashed border-cream-300 flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-ink-200" />
                  </div>
                )}
                <div className="space-y-2">
                  <button
                    onClick={handleScanAsset}
                    disabled={scanLoading}
                    className="btn-quiet text-xs px-3 py-2 w-full disabled:opacity-60"
                  >
                    {scanLoading
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Camera className="w-3.5 h-3.5" />}
                    {scanLoading ? 'Scanning…' : 'Scan label'}
                  </button>
                  <button
                    onClick={handleAddPhoto}
                    className="btn-quiet text-xs px-3 py-2 w-full"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add photo
                  </button>
                </div>
              </div>

              {/* Name (full width) */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Name <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. MacBook Air"
                  value={editingItem.name}
                  onChange={e => setEditingItem(prev => prev ? { ...prev, name: e.target.value } : prev)}
                  className="field w-full"
                />
                {formError && (
                  <p className="text-[11px] text-rosa-600 mt-1">{formError}</p>
                )}
              </div>

              {/* Category + Assigned member (2-col) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Category</label>
                  <select
                    value={editingItem.category}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, category: e.target.value as AssetItem['category'] } : prev)}
                    className="field w-full"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Assigned to</label>
                  <input
                    type="text"
                    placeholder="e.g. Mia"
                    value={editingItem.assignedMember || ''}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, assignedMember: e.target.value } : prev)}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Make + Model (2-col) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Make</label>
                  <input
                    type="text"
                    placeholder="e.g. Apple"
                    value={editingItem.make || ''}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, make: e.target.value } : prev)}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Model</label>
                  <input
                    type="text"
                    placeholder="e.g. M2 13-inch"
                    value={editingItem.model || ''}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, model: e.target.value } : prev)}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Serial + Purchase date (2-col) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Serial number</label>
                  <input
                    type="text"
                    placeholder="SN / IMEI"
                    value={editingItem.serialNumber || ''}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, serialNumber: e.target.value } : prev)}
                    className="field w-full font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Purchase date</label>
                  <input
                    type="date"
                    value={editingItem.purchaseDate || ''}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, purchaseDate: e.target.value } : prev)}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Purchase price (half-width) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Purchase price</label>
                  <input
                    type="text"
                    placeholder="e.g. €450"
                    value={editingItem.purchasePrice || ''}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, purchasePrice: e.target.value } : prev)}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Notes (full width) */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Notes</label>
                <textarea
                  rows={3}
                  placeholder="Warranty info, condition, storage location…"
                  value={editingItem.notes || ''}
                  onChange={e => setEditingItem(prev => prev ? { ...prev, notes: e.target.value } : prev)}
                  className="field w-full resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 p-6 pt-0">
              <div>
                {editingItem.id && (
                  <button
                    onClick={() => handleDelete(editingItem.id)}
                    className="btn-quiet text-rosa-600 hover:text-rosa-700 text-xs px-3 py-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={closeForm} className="btn-quiet text-xs px-4 py-2">
                  Cancel
                </button>
                <button onClick={handleSave} className="btn-primary text-xs px-5 py-2">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Full-size photo viewer (image record) ── */}
      {photoView && (
        <div
          className="fixed inset-0 z-[60] bg-ink-900/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPhotoView(null)}
        >
          <button
            onClick={() => setPhotoView(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-ink-800 flex items-center justify-center hover:bg-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={photoView}
            alt="Asset photo"
            className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
