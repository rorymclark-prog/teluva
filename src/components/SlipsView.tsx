import React, { useEffect, useRef, useState } from 'react';
import { Receipt, Plus, Pencil, Trash2, Camera, X, Loader2, RotateCcw, ShieldCheck, Check, ChevronDown, Info } from 'lucide-react';
import { SlipItem } from '../types';
import { loadSlips, saveSlips, uploadSlipPhoto, deleteSlipPhoto } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { compressImageToAvatar } from '../utils/imageCompress';
import { slipIsArchived, slipReturnClosed, suggestReturnBy } from '../utils/slip';
import { daysUntil } from '../utils/vehicle';
import SheetGrabber from './SheetGrabber';

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

const CURRENCIES = ['EUR', 'GBP', 'USD', 'ZAR', 'CHF'];
const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', ZAR: 'R', CHF: 'CHF ' };

interface SlipForm {
  id: string;
  shop: string;
  item: string;
  purchaseDate: string;
  amount: string;
  currency: string;
  assignedTo: string;
  returnByDate: string;
  warrantyUntil: string;
  returned: boolean;
  photoUrl: string;
  photoStoragePath: string;
  notes: string;
  createdAt: string;
}

const BLANK_FORM: SlipForm = {
  id: '', shop: '', item: '', purchaseDate: '', amount: '', currency: 'EUR', assignedTo: '',
  returnByDate: '', warrantyUntil: '', returned: false, photoUrl: '', photoStoragePath: '', notes: '', createdAt: '',
};

function toForm(s: SlipItem): SlipForm {
  return {
    id: s.id,
    shop: s.shop || '',
    item: s.item,
    purchaseDate: s.purchaseDate || '',
    amount: s.amount || '',
    currency: s.currency || 'EUR',
    assignedTo: s.assignedTo || '',
    returnByDate: s.returnByDate || '',
    warrantyUntil: s.warrantyUntil || '',
    returned: !!s.returned,
    photoUrl: s.photoUrl || '',
    photoStoragePath: s.photoStoragePath || '',
    notes: s.notes || '',
    createdAt: s.createdAt,
  };
}

// A short, plain-English "time left" label for a single deadline. Never states
// a legal entitlement — just what was recorded and how many days are left.
function deadlineText(dateStr: string | undefined, closed: boolean): { text: string; tone: 'urgent' | 'warn' | 'ok' | 'muted' } | null {
  if (!dateStr) return null;
  if (closed) return { text: `Closed ${dateStr}`, tone: 'muted' };
  const days = daysUntil(dateStr);
  if (days === null) return null;
  if (days < 0) return { text: 'Closed', tone: 'muted' };
  if (days === 0) return { text: 'Today', tone: 'urgent' };
  if (days <= 2) return { text: `${days} day${days === 1 ? '' : 's'} left`, tone: 'urgent' };
  if (days <= 10) return { text: `${days} days left`, tone: 'warn' };
  return { text: `${days} days left`, tone: 'ok' };
}

const TONE_CLASS: Record<'urgent' | 'warn' | 'ok' | 'muted', string> = {
  urgent: 'bg-rosa-100 text-rosa-700',
  warn: 'bg-honey-100 text-honey-700',
  ok: 'bg-sage-100 text-sage-700',
  muted: 'bg-cream-200 text-ink-500',
};

export default function SlipsView() {
  const { canWrite } = useFamilyCtx();
  const [slips, setSlips] = useState<SlipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<SlipForm | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSlips().then(data => {
      setSlips(data);
      setLoading(false);
    });
  }, []);

  // Live updates from other family members, held while the slip form is open
  // (or a receipt photo is uploading) and applied the moment it closes.
  const remoteWaiting = useSharedDoc<{ slips: SlipItem[] }>(
    'slips',
    (v) => setSlips(v.slips || []),
    { hold: isFormOpen || photoUploading },
  );

  const persist = async (updated: SlipItem[]) => {
    setSlips(updated);
    await saveSlips(updated);
  };

  // ── Open/close ──

  const openNewForm = () => {
    setForm({ ...BLANK_FORM });
    setError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (s: SlipItem) => {
    setForm(toForm(s));
    setError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setForm(null);
  };

  // Purchase date filled first → suggest a return-by date (editable, default
  // 30 days — the commonest shop policy, never presented as guaranteed).
  const handlePurchaseDateChange = (value: string) => {
    setForm(prev => {
      if (!prev) return prev;
      const next = { ...prev, purchaseDate: value };
      if (value && !prev.returnByDate) {
        const suggested = suggestReturnBy(value);
        if (suggested) next.returnByDate = suggested;
      }
      return next;
    });
  };

  // ── Photo (the receipt / till slip itself) ──

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !form) return;
    setPhotoUploading(true);
    setError(null);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = ev => resolve(ev.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const compressed = await compressImageToAvatar(dataUrl, 1600, 0.85);
      const oldPath = form.photoStoragePath;
      const { url, storagePath } = await uploadSlipPhoto(compressed);
      if (oldPath && oldPath !== storagePath) await deleteSlipPhoto(oldPath);
      setForm(prev => (prev ? { ...prev, photoUrl: url, photoStoragePath: storagePath } : prev));
    } catch {
      setError("Couldn't upload that photo — please try again.");
    } finally {
      setPhotoUploading(false);
    }
  };

  const removePhoto = () => {
    setForm(prev => (prev ? { ...prev, photoUrl: '', photoStoragePath: '' } : prev));
  };

  // ── Save / delete ──

  const handleSave = async () => {
    if (!form) return;
    if (!form.item.trim()) {
      setError('What did you buy?');
      return;
    }
    setError(null);

    const isNew = !form.id;
    const id = isNew ? newId() : form.id;
    const createdAt = isNew ? new Date().toISOString().slice(0, 10) : form.createdAt;
    const slip: SlipItem = {
      id,
      shop: form.shop.trim() || undefined,
      item: form.item.trim(),
      purchaseDate: form.purchaseDate || undefined,
      amount: form.amount.trim() || undefined,
      currency: form.currency || 'EUR',
      assignedTo: form.assignedTo.trim() || undefined,
      returnByDate: form.returnByDate || undefined,
      warrantyUntil: form.warrantyUntil || undefined,
      returned: form.returned || undefined,
      photoUrl: form.photoUrl || undefined,
      photoStoragePath: form.photoStoragePath || undefined,
      notes: form.notes.trim() || undefined,
      createdAt,
    };

    const next = isNew ? [...slips, slip] : slips.map(s => (s.id === id ? slip : s));
    await persist(next);
    closeForm();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this slip? This cannot be undone.')) return;
    const existing = slips.find(s => s.id === id);
    if (existing?.photoStoragePath) await deleteSlipPhoto(existing.photoStoragePath);
    await persist(slips.filter(s => s.id !== id));
    if (form?.id === id) closeForm();
    if (viewingId === id) setViewingId(null);
  };

  const toggleReturned = async (s: SlipItem) => {
    await persist(slips.map(x => (x.id === s.id ? { ...x, returned: !x.returned } : x)));
  };

  const open = slips.filter(s => !slipIsArchived(s));
  const archived = slips.filter(s => slipIsArchived(s));
  const sorted = [...open].sort((a, b) => {
    const da = a.returnByDate ? daysUntil(a.returnByDate) : null;
    const db = b.returnByDate ? daysUntil(b.returnByDate) : null;
    if (da !== null && db !== null) return da - db;
    if (da !== null) return -1;
    if (db !== null) return 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  const viewing = slips.find(s => s.id === viewingId) || null;
  const closingSoonCount = open.filter(s => {
    const d = s.returnByDate && !s.returned ? daysUntil(s.returnByDate) : null;
    return d !== null && d >= 0 && d <= 10;
  }).length;

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <input ref={photoFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoFileChange} />

      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-clay-50 text-clay-600 shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Keep the slip</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                {open.length === 0 ? 'No open slips' : `${open.length} open${closingSoonCount > 0 ? ` · ${closingSoonCount} closing soon` : ''}`}
              </p>
            </div>
          </div>
          {canWrite && (
            <button onClick={openNewForm} className="btn-primary text-xs px-3 py-2 shrink-0">
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          )}
        </div>

        <div className="px-5 sm:px-6 pt-4">
          <div className="flex items-start gap-2 rounded-xl bg-cream-100 border border-cream-200 p-2.5">
            <Info className="w-3.5 h-3.5 text-ink-400 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-snug text-ink-500">
              Return windows are shop policy, not a legal right — shops usually allow around 30 days, but check the receipt or the shop's own terms.
              Warranty is separate and usually much longer. This is what you recorded, not advice about your rights.
            </p>
          </div>
        </div>

        {/* List */}
        <div className="p-4 sm:p-5">
          {slips.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
                <Receipt className="w-8 h-8" />
              </div>
              <p className="text-[14px] font-medium text-ink-700">No slips yet</p>
              <p className="text-[12px] text-ink-500 mt-1">
                Photograph a receipt, or tell the assistant about a purchase to file it here
              </p>
              {canWrite && (
                <button onClick={openNewForm} className="btn-primary mt-5 text-xs px-4 py-2">
                  <Plus className="w-3.5 h-3.5" />
                  Add a slip
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {sorted.map(s => {
                const ret = deadlineText(s.returnByDate, slipReturnClosed(s));
                const warr = deadlineText(s.warrantyUntil, false);
                return (
                  <div
                    key={s.id}
                    onClick={() => setViewingId(s.id)}
                    className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors cursor-pointer"
                  >
                    {s.photoUrl ? (
                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 ring-1 ring-cream-200">
                        <img src={s.photoUrl} alt={s.item} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                        <Receipt className="w-4 h-4 text-ink-300" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-800 text-[14px] leading-tight truncate">{s.item}</p>
                      <p className="text-[11.5px] text-ink-400 truncate">
                        {[s.shop, s.assignedTo].filter(Boolean).join(' · ') || (s.purchaseDate || '')}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {s.returned && <span className="chip bg-sage-100 text-sage-700">Returned</span>}
                      {!s.returned && ret && <span className={`chip ${TONE_CLASS[ret.tone]}`}>{ret.tone === 'muted' ? 'Return closed' : ret.text}</span>}
                      {warr && warr.tone !== 'muted' && <span className={`chip ${TONE_CLASS[warr.tone]}`}>Warranty {warr.text}</span>}
                      {canWrite && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditForm(s); }}
                          className="btn-quiet p-1.5 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {archived.length > 0 && (
            <div className="mt-3 pt-3 border-t border-cream-200">
              <button
                onClick={() => setShowArchived(v => !v)}
                className="w-full flex items-center justify-between px-2 py-2 text-[12.5px] font-semibold text-ink-500 hover:text-ink-700 transition-colors cursor-pointer"
              >
                <span>Archived ({archived.length}) — return window and warranty both closed</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showArchived ? 'rotate-180' : ''}`} />
              </button>
              {showArchived && (
                <div className="space-y-1 mt-1">
                  {archived.map(s => (
                    <div
                      key={s.id}
                      onClick={() => setViewingId(s.id)}
                      className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-cream-50 group transition-colors cursor-pointer opacity-70"
                    >
                      {s.photoUrl ? (
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-cream-100 ring-1 ring-cream-200">
                          <img src={s.photoUrl} alt={s.item} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                          <Receipt className="w-3.5 h-3.5 text-ink-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-ink-600 truncate">{s.item}</p>
                        <p className="text-[11px] text-ink-400 truncate">{[s.shop, s.purchaseDate].filter(Boolean).join(' · ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail modal ── */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade"
          onClick={() => setViewingId(null)}
        >
          <div
            className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <SheetGrabber onClose={() => setViewingId(null)} />
            {viewing.photoUrl && (
              <img src={viewing.photoUrl} alt={viewing.item} className="w-full max-h-64 object-cover" />
            )}
            <div className="flex items-start justify-between p-6 pb-3 gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-xl font-semibold text-ink-900">{viewing.item}</h3>
                <p className="text-[13px] text-ink-400 mt-1">
                  {[viewing.shop, viewing.purchaseDate, viewing.amount ? `${CURRENCY_SYMBOL[viewing.currency || 'EUR'] || ''}${viewing.amount}` : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canWrite && (
                  <button onClick={() => { setViewingId(null); openEditForm(viewing); }} className="btn-quiet p-2">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setViewingId(null)} className="btn-quiet p-2">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 space-y-4">
              {viewing.assignedTo && (
                <p className="text-[13px] text-ink-600"><span className="text-ink-400">Whose:</span> {viewing.assignedTo}</p>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-cream-200 p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <RotateCcw className="w-4 h-4 text-ink-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-ink-700">Return window</p>
                      <p className="text-[11.5px] text-ink-400">{viewing.returnByDate || 'Not recorded'}</p>
                    </div>
                  </div>
                  {viewing.returnByDate && (
                    viewing.returned ? (
                      <span className="chip bg-sage-100 text-sage-700 shrink-0">Returned</span>
                    ) : (
                      (() => {
                        const d = deadlineText(viewing.returnByDate, slipReturnClosed(viewing));
                        return d ? <span className={`chip shrink-0 ${TONE_CLASS[d.tone]}`}>{d.text}</span> : null;
                      })()
                    )
                  )}
                </div>
                {canWrite && viewing.returnByDate && !viewing.returned && (
                  <button onClick={() => toggleReturned(viewing)} className="btn-quiet text-xs px-3 py-2 w-full">
                    <Check className="w-3.5 h-3.5" />
                    Mark as returned
                  </button>
                )}
                {canWrite && viewing.returned && (
                  <button onClick={() => toggleReturned(viewing)} className="btn-quiet text-xs px-3 py-2 w-full">
                    Undo — not returned after all
                  </button>
                )}

                <div className="flex items-center justify-between gap-3 rounded-xl border border-cream-200 p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-ink-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold text-ink-700">Warranty</p>
                      <p className="text-[11.5px] text-ink-400">{viewing.warrantyUntil || 'Not recorded'}</p>
                    </div>
                  </div>
                  {viewing.warrantyUntil && (() => {
                    const d = deadlineText(viewing.warrantyUntil, false);
                    return d ? <span className={`chip shrink-0 ${TONE_CLASS[d.tone]}`}>{d.text}</span> : null;
                  })()}
                </div>
              </div>

              {viewing.notes && (
                <div>
                  <p className="section-label mb-1.5">Notes</p>
                  <p className="text-[13px] text-ink-700 whitespace-pre-wrap">{viewing.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add/edit form modal ── */}
      {isFormOpen && form && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <SheetGrabber onClose={closeForm} />
            <RemoteChangeHint show={remoteWaiting} className="mx-6 mt-4" />

            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {form.id ? 'Edit slip' : 'New slip'}
              </h3>
              <button onClick={closeForm} className="btn-quiet p-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="flex items-center justify-between gap-2 bg-rosa-500/10 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-rosa-700">{error}</p>
                  <button onClick={() => setError(null)}>
                    <X className="w-3.5 h-3.5 text-rosa-700" />
                  </button>
                </div>
              )}

              {/* Photo row */}
              <div className="flex items-center gap-4">
                {form.photoUrl ? (
                  <div className="relative shrink-0">
                    <img
                      src={form.photoUrl}
                      alt="Receipt"
                      className="w-24 h-24 object-cover rounded-xl border border-cream-200"
                    />
                    <button
                      onClick={removePhoto}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-xl border-2 border-dashed border-cream-300 flex items-center justify-center shrink-0">
                    <Receipt className="w-6 h-6 text-ink-200" />
                  </div>
                )}
                <button
                  onClick={() => photoFileRef.current?.click()}
                  disabled={photoUploading}
                  className="btn-quiet text-xs px-3 py-2 disabled:opacity-60"
                >
                  {photoUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  {photoUploading ? 'Uploading…' : form.photoUrl ? 'Replace photo' : 'Photograph the slip'}
                </button>
              </div>

              {/* What it was */}
              <div>
                <label className="field-label">
                  What did you buy? <span className="text-rosa-700">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Kitchen blender"
                  value={form.item}
                  onChange={e => setForm(prev => (prev ? { ...prev, item: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Shop</label>
                  <input
                    type="text"
                    placeholder="e.g. MediaMarkt"
                    value={form.shop}
                    onChange={e => setForm(prev => (prev ? { ...prev, shop: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label className="field-label">Whose</label>
                  <input
                    type="text"
                    placeholder="e.g. Household, Mia"
                    value={form.assignedTo}
                    onChange={e => setForm(prev => (prev ? { ...prev, assignedTo: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="field-label">Purchase date</label>
                  <input
                    type="date"
                    value={form.purchaseDate}
                    onChange={e => handlePurchaseDateChange(e.target.value)}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label className="field-label">Currency</label>
                  <select value={form.currency} onChange={e => setForm(prev => (prev ? { ...prev, currency: e.target.value } : prev))} className="field w-full">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">Amount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 89.99"
                  value={form.amount}
                  onChange={e => setForm(prev => (prev ? { ...prev, amount: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              <div className="rounded-xl border border-cream-200 p-3.5 space-y-3">
                <div className="flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-ink-400" />
                  <p className="text-[12px] font-semibold text-ink-500 uppercase tracking-wider">Return window</p>
                </div>
                <div>
                  <label className="field-label">Return by</label>
                  <input
                    type="date"
                    value={form.returnByDate}
                    onChange={e => setForm(prev => (prev ? { ...prev, returnByDate: e.target.value } : prev))}
                    className="field w-full"
                  />
                  <p className="text-[11px] text-ink-400 mt-1">
                    Suggested from shop policy (usually ~30 days) — check the receipt and edit if different.
                  </p>
                </div>
                {form.returnByDate && (
                  <label className="flex items-center gap-2 text-[13px] text-ink-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.returned}
                      onChange={e => setForm(prev => (prev ? { ...prev, returned: e.target.checked } : prev))}
                      className="w-4 h-4 rounded accent-clay-500"
                    />
                    Already returned
                  </label>
                )}
              </div>

              <div className="rounded-xl border border-cream-200 p-3.5 space-y-3">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-ink-400" />
                  <p className="text-[12px] font-semibold text-ink-500 uppercase tracking-wider">Warranty</p>
                </div>
                <div>
                  <label className="field-label">Warranty expires</label>
                  <input
                    type="date"
                    value={form.warrantyUntil}
                    onChange={e => setForm(prev => (prev ? { ...prev, warrantyUntil: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Notes</label>
                <textarea
                  rows={3}
                  placeholder="Anything else worth remembering"
                  value={form.notes}
                  onChange={e => setForm(prev => (prev ? { ...prev, notes: e.target.value } : prev))}
                  className="field w-full resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 p-6 pt-0">
              <div>
                {form.id && (
                  <button
                    onClick={() => handleDelete(form.id)}
                    className="btn-quiet text-rosa-700 hover:text-rosa-700 text-xs px-3 py-2"
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
                <button onClick={handleSave} disabled={photoUploading} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
