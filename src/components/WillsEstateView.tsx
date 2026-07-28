import React, { useEffect, useRef, useState } from 'react';
import {
  ScrollText, Plus, Pencil, Trash2, X, Loader2, Info, User, Landmark,
  HandHeart, Paperclip, Upload, Eye, AlertCircle, MapPin, Phone, HandCoins,
} from 'lucide-react';
import { EstateRecord, FamilyMember, VaultDocument, FamilyDocument, InsurancePolicy } from '../types';
import { loadWillsEstate, saveWillsEstate, loadDocuments, saveDocuments, uploadVaultFile, loadFinances } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { auth } from '../lib/firebase';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { ESTATE_DOC_KINDS, isReviewStale, reviewAgeLabel } from '../utils/willsEstate';
import { isFuneralPolicy } from '../utils/funeralCover';
import DocumentViewer from './DocumentViewer';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import SheetGrabber from './SheetGrabber';

const FUNERAL_WISHES_KIND = 'Funeral wishes';

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

interface EstateForm {
  id: string;
  kind: string;
  forMember: string;
  originalLocation: string;
  heldBy: string;
  notaryName: string;
  notaryPhone: string;
  executor: string;
  lastReviewed: string;
  notes: string;
  linkedDocIds: string[];
  linkedPolicyIds: string[];
}

const BLANK_FORM: EstateForm = {
  id: '', kind: ESTATE_DOC_KINDS[0].kind, forMember: '', originalLocation: '', heldBy: '',
  notaryName: '', notaryPhone: '', executor: '', lastReviewed: '', notes: '', linkedDocIds: [],
  linkedPolicyIds: [],
};

function toForm(r: EstateRecord): EstateForm {
  return {
    id: r.id,
    kind: r.kind,
    forMember: r.forMember || '',
    originalLocation: r.originalLocation || '',
    heldBy: r.heldBy || '',
    notaryName: r.notaryName || '',
    notaryPhone: r.notaryPhone || '',
    executor: r.executor || '',
    lastReviewed: r.lastReviewed || '',
    notes: r.notes || '',
    linkedDocIds: r.linkedDocIds ? [...r.linkedDocIds] : [],
    linkedPolicyIds: r.linkedPolicyIds ? [...r.linkedPolicyIds] : [],
  };
}

// A saved scan is a copy, in the general Document Vault (category 'Legal') —
// converted to the viewer's shape the same way DocumentVault does.
function toFamilyDoc(v: VaultDocument): FamilyDocument {
  return {
    id: v.id, name: v.name, category: 'Other',
    fileType: v.fileType, fileName: v.fileName, fileSize: v.fileSize,
    uploadedAt: v.uploadedAt, notes: v.notes, fileData: v.downloadUrl,
  };
}

export default function WillsEstateView({ members, refreshKey = 0 }: { members: FamilyMember[]; refreshKey?: number }) {
  const { canWrite } = useFamilyCtx();
  const [records, setRecords] = useState<EstateRecord[]>([]);
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  // Funeral-type policies from Finances — loaded here (not just in Insurance)
  // so a 'Funeral wishes' record can link to its policy and surface the
  // policy number and who-to-call right where a bereaved family looks.
  const [funeralPolicies, setFuneralPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<EstateForm | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<VaultDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [estate, docs, finances] = await Promise.all([loadWillsEstate(), loadDocuments(), loadFinances()]);
      if (active) {
        setRecords(estate?.records || []);
        setDocuments(docs || []);
        setFuneralPolicies((finances?.insurance || []).filter(p => isFuneralPolicy(p.type)));
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  // Live updates for BOTH shared documents this view writes: the estate records
  // and the shared Document Vault it attaches legal files into. Held while the
  // record form is open or a file is being attached.
  const busy = isFormOpen || attaching;
  const remoteWaiting = useSharedDoc<{ records: EstateRecord[] }>(
    'willsEstate', (v) => setRecords(v.records || []), { hold: busy },
  );
  useSharedDoc<{ docs: VaultDocument[] }>(
    'documents', (v) => setDocuments(v.docs || []), { hold: busy },
  );

  const persist = async (updated: EstateRecord[]) => {
    setRecords(updated);
    await saveWillsEstate({ records: updated });
  };

  // ── Open/close ──

  const openNewForm = () => {
    setForm({ ...BLANK_FORM });
    setError(null);
    setAttachError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (r: EstateRecord) => {
    setForm(toForm(r));
    setError(null);
    setAttachError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setForm(null);
  };

  // ── Attach / view a scan (real Document Vault entries, category 'Legal') ──

  const handleAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !form) return;
    if (file.size > 20 * 1024 * 1024) {
      setAttachError('File is larger than 20 MB. Please compress it first.');
      return;
    }
    setAttaching(true);
    setAttachError(null);
    try {
      const docId = newId();
      const { storagePath, downloadUrl } = await uploadVaultFile(file, docId);
      const resolvedMember = members.find(m => m.name.trim().toLowerCase() === form.forMember.trim().toLowerCase());
      const newDoc: VaultDocument = {
        id: docId,
        name: `${form.kind}${form.forMember ? ` — ${form.forMember}` : ''}`,
        category: 'Legal',
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storagePath,
        downloadUrl,
        uploadedAt: new Date().toISOString().slice(0, 10),
        uploadedBy: auth.currentUser?.displayName || auth.currentUser?.email || undefined,
        memberId: resolvedMember?.id,
        notes: 'Wills & Estate scan',
      };
      const nextDocs = [newDoc, ...documents];
      setDocuments(nextDocs);
      await saveDocuments(nextDocs);
      setForm(prev => (prev ? { ...prev, linkedDocIds: [...prev.linkedDocIds, newDoc.id] } : prev));
    } catch {
      setAttachError("Couldn't upload that file — please try again.");
    } finally {
      setAttaching(false);
    }
  };

  const unlinkDoc = (docId: string) => {
    setForm(prev => (prev ? { ...prev, linkedDocIds: prev.linkedDocIds.filter(id => id !== docId) } : prev));
  };

  const linkedDocsFor = (ids?: string[]) => (ids || []).map(id => documents.find(d => d.id === id)).filter((d): d is VaultDocument => !!d);

  const linkedPoliciesFor = (ids?: string[]) =>
    (ids || []).map(id => funeralPolicies.find(p => p.id === id)).filter((p): p is InsurancePolicy => !!p);

  const togglePolicyLink = (policyId: string) => setForm(prev => {
    if (!prev) return prev;
    const current = prev.linkedPolicyIds;
    const next = current.includes(policyId) ? current.filter(id => id !== policyId) : [...current, policyId];
    return { ...prev, linkedPolicyIds: next };
  });

  // ── Save / delete ──

  const handleSave = async () => {
    if (!form) return;
    if (!form.kind.trim()) {
      setError('Choose which kind of document this is');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const isNew = !form.id;
      const id = isNew ? newId() : form.id;
      const record: EstateRecord = {
        id,
        kind: form.kind.trim(),
        forMember: form.forMember.trim() || undefined,
        originalLocation: form.originalLocation.trim() || undefined,
        heldBy: form.heldBy.trim() || undefined,
        notaryName: form.notaryName.trim() || undefined,
        notaryPhone: form.notaryPhone.trim() || undefined,
        executor: form.executor.trim() || undefined,
        lastReviewed: form.lastReviewed || undefined,
        linkedDocIds: form.linkedDocIds.length ? form.linkedDocIds : undefined,
        linkedPolicyIds: form.linkedPolicyIds.length ? form.linkedPolicyIds : undefined,
        notes: form.notes.trim() || undefined,
      };
      const next = isNew ? [...records, record] : records.map(r => (r.id === id ? record : r));
      await persist(next);
      closeForm();
    } finally {
      setSaving(false);
    }
  };

  // Confirmation now lives in ConfirmDeleteButton (in-place two-step) at the
  // call site — a bare window.confirm() looks and behaves like a broken
  // webpage inside the iOS home-screen PWA.
  const handleDelete = async (id: string) => {
    await persist(records.filter(r => r.id !== id));
    if (form?.id === id) closeForm();
    if (viewingId === id) setViewingId(null);
  };

  const sorted = [...records].sort((a, b) => {
    const aStale = isReviewStale(a.lastReviewed) ? 0 : 1;
    const bStale = isReviewStale(b.lastReviewed) ? 0 : 1;
    if (aStale !== bStale) return aStale - bStale;
    return String(a.kind).localeCompare(String(b.kind));
  });
  const viewing = records.find(r => r.id === viewingId) || null;

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttachChange} accept="*/*" />
      <datalist id="estate-formember-options">
        <option value="Whole family" />
        {members.map(m => <option key={m.id} value={m.name} />)}
      </datalist>

      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-ink-100 text-ink-700 shrink-0">
              <ScrollText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Wills &amp; Estate</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                Where the important documents are, and who to call.
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

        {/* Plain-language, persistent disclaimer — store-and-recall only */}
        <div className="px-5 sm:px-6 py-3.5 bg-cream-50 border-b border-cream-200 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
          <p className="text-[12px] text-ink-500 leading-relaxed">
            This is a record of what your family has told the app — which documents exist, whose they are, and where
            the signed original is kept. It isn't legal advice, and a saved scan is a copy, not the legal original.
          </p>
        </div>

        {/* List */}
        <div className="p-4 sm:p-5">
          {records.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-ink-50 text-ink-500 flex items-center justify-center">
                <ScrollText className="w-8 h-8" />
              </div>
              <p className="text-[14px] font-medium text-ink-700">No wills or estate documents recorded yet</p>
              <p className="text-[12px] text-ink-500 mt-1 max-w-xs mx-auto">
                Add the first one — which document, whose it is, and where the signed original is kept.
              </p>
              {canWrite && (
                <button onClick={openNewForm} className="btn-primary mt-5 text-xs px-4 py-2">
                  <Plus className="w-3.5 h-3.5" />
                  Add a record
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map(r => {
                const stale = isReviewStale(r.lastReviewed);
                const linked = linkedDocsFor(r.linkedDocIds);
                const linkedPolicies = linkedPoliciesFor(r.linkedPolicyIds);
                return (
                  <button
                    key={r.id}
                    onClick={() => setViewingId(r.id)}
                    className="w-full flex items-start justify-between gap-3 px-3 py-3 rounded-xl hover:bg-cream-50 group transition-colors text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="chip bg-ink-100 text-ink-700">{r.kind}</span>
                        {r.forMember && <span className="chip bg-cream-200 text-ink-600">{r.forMember}</span>}
                        <span className={`chip ${stale ? 'bg-honey-100 text-honey-700' : 'bg-sage-100 text-sage-700'}`}>
                          {reviewAgeLabel(r.lastReviewed)}
                        </span>
                      </div>
                      {r.originalLocation && (
                        <p className="text-[14px] font-semibold text-ink-900 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                          {r.originalLocation}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[12px] text-ink-500">
                        {r.heldBy && <span className="flex items-center gap-1"><User className="w-3 h-3" />{r.heldBy}</span>}
                        {r.notaryName && <span className="flex items-center gap-1"><Landmark className="w-3 h-3" />{r.notaryName}</span>}
                        {r.executor && <span className="flex items-center gap-1"><HandHeart className="w-3 h-3" />Executor: {r.executor}</span>}
                      </div>
                      {linked.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-400 mt-1.5">
                          <Paperclip className="w-3 h-3" />
                          {linked.length} scan{linked.length === 1 ? '' : 's'} attached
                        </span>
                      )}
                      {linkedPolicies.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-400 mt-1.5 ml-3">
                          <Phone className="w-3 h-3" />
                          {linkedPolicies.length} funeral polic{linkedPolicies.length === 1 ? 'y' : 'ies'} linked
                        </span>
                      )}
                    </div>
                    {canWrite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(r); }}
                        className="btn-quiet p-1.5 shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail modal — read view, open to everyone ── */}
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
            <div className="flex items-start justify-between p-6 pb-3 gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="font-display text-xl font-semibold text-ink-900">{viewing.kind}</h3>
                  {viewing.forMember && <span className="chip bg-cream-200 text-ink-600">{viewing.forMember}</span>}
                </div>
                <span className={`chip mt-2 inline-block ${isReviewStale(viewing.lastReviewed) ? 'bg-honey-100 text-honey-700' : 'bg-sage-100 text-sage-700'}`}>
                  {reviewAgeLabel(viewing.lastReviewed)}
                </span>
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
              {/* Who to call, and the policy number — the single most important
                  thing on this record, shown big and plain for someone who is
                  grieving and probably didn't enter this data themselves. */}
              {viewing.kind === FUNERAL_WISHES_KIND && linkedPoliciesFor(viewing.linkedPolicyIds).length > 0 && (
                <div className="rounded-3xl bg-ink-900 text-white p-5 space-y-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Who to call, and the policy number</p>
                  {linkedPoliciesFor(viewing.linkedPolicyIds).map((p, i) => (
                    <div key={p.id} className={i > 0 ? 'pt-4 border-t border-white/10' : ''}>
                      <p className="text-lg font-bold leading-tight">{p.provider}{p.type ? ` · ${p.type}` : ''}</p>
                      {p.claimsPhone && (
                        <a href={`tel:${p.claimsPhone.replace(/\s+/g, '')}`} className="block text-2xl sm:text-3xl font-mono font-extrabold tabular-nums text-honey-200 mt-1 hover:underline">
                          {p.claimsPhone}
                        </a>
                      )}
                      {p.burialSocietyContact && (
                        <p className="text-[14px] font-semibold text-white/90 mt-1">{p.burialSocietyContact}</p>
                      )}
                      {!p.claimsPhone && !p.burialSocietyContact && (
                        <p className="text-[13px] text-white/60 italic mt-1">No phone number on file for this policy.</p>
                      )}
                      {p.policyNumber && (
                        <p className="text-[13px] font-mono tabular-nums text-white/70 mt-1.5">Policy {p.policyNumber}</p>
                      )}
                      {p.beneficiary && (
                        <p className="text-[12px] text-white/60 mt-0.5 flex items-center gap-1"><HandCoins className="w-3 h-3" /> Payable to: {p.beneficiary}</p>
                      )}
                      {p.repatriationIncluded && (
                        <p className="text-[12px] text-white/60 mt-0.5">Includes repatriation{p.repatriationDestination ? ` to ${p.repatriationDestination}` : ''}.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {viewing.originalLocation && (
                <div>
                  <p className="section-label mb-1">Where the signed original is kept</p>
                  <p className="text-[14px] text-ink-800 font-medium flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
                    {viewing.originalLocation}
                  </p>
                </div>
              )}
              {viewing.heldBy && (
                <div>
                  <p className="section-label mb-1">Held by</p>
                  <p className="text-[14px] text-ink-700">{viewing.heldBy}</p>
                </div>
              )}
              {(viewing.notaryName || viewing.notaryPhone) && (
                <div>
                  <p className="section-label mb-1">Notary / solicitor</p>
                  <p className="text-[14px] text-ink-700">
                    {viewing.notaryName}
                    {viewing.notaryPhone && (
                      <>
                        {viewing.notaryName ? ' · ' : ''}
                        <a href={`tel:${viewing.notaryPhone}`} className="text-clay-600 hover:underline">{viewing.notaryPhone}</a>
                      </>
                    )}
                  </p>
                </div>
              )}
              {viewing.executor && (
                <div>
                  <p className="section-label mb-1">Executor</p>
                  <p className="text-[14px] text-ink-700">{viewing.executor}</p>
                </div>
              )}
              {viewing.notes && (
                <div>
                  <p className="section-label mb-1">Notes</p>
                  <p className="text-[14px] text-ink-700 whitespace-pre-wrap">{viewing.notes}</p>
                </div>
              )}
              {linkedDocsFor(viewing.linkedDocIds).length > 0 && (
                <div>
                  <p className="section-label mb-2">Attached scans</p>
                  <div className="space-y-1.5">
                    {linkedDocsFor(viewing.linkedDocIds).map(d => (
                      <button
                        key={d.id}
                        onClick={() => setViewingDoc(d)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-cream-50 hover:bg-cream-100 transition-colors text-left"
                      >
                        <Eye className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                        <span className="text-[13px] text-ink-700 truncate flex-1">{d.name}</span>
                      </button>
                    ))}
                  </div>
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
                {form.id ? 'Edit record' : 'New record'}
              </h3>
              <button onClick={closeForm} className="btn-quiet p-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="flex items-center justify-between gap-2 bg-rosa-500/10 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-rosa-600">{error}</p>
                  <button onClick={() => setError(null)}>
                    <X className="w-3.5 h-3.5 text-rosa-600" />
                  </button>
                </div>
              )}

              {/* Which document */}
              <div>
                <label className="field-label">Which document</label>
                <select
                  value={form.kind}
                  onChange={e => setForm(prev => (prev ? { ...prev, kind: e.target.value } : prev))}
                  className="field w-full"
                >
                  {ESTATE_DOC_KINDS.map(k => (
                    <option key={k.kind} value={k.kind}>
                      {k.kind}{k.atHint ? ` (${k.atHint})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Whose */}
              <div>
                <label className="field-label">Whose</label>
                <input
                  type="text"
                  list="estate-formember-options"
                  placeholder="e.g. Barbara, or Whole family"
                  value={form.forMember}
                  onChange={e => setForm(prev => (prev ? { ...prev, forMember: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Where the original is */}
              <div>
                <label className="field-label">Where the signed original is kept</label>
                <input
                  type="text"
                  placeholder="e.g. Notar Huber's office, or the home safe"
                  value={form.originalLocation}
                  onChange={e => setForm(prev => (prev ? { ...prev, originalLocation: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Held by */}
              <div>
                <label className="field-label">Held by <span className="text-ink-400 font-normal">(a named person or institution, optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. Rory, the bank, Notar Huber"
                  value={form.heldBy}
                  onChange={e => setForm(prev => (prev ? { ...prev, heldBy: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Notary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Notary / solicitor name</label>
                  <input
                    type="text"
                    value={form.notaryName}
                    onChange={e => setForm(prev => (prev ? { ...prev, notaryName: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label className="field-label">Notary / solicitor phone</label>
                  <input
                    type="tel"
                    value={form.notaryPhone}
                    onChange={e => setForm(prev => (prev ? { ...prev, notaryPhone: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Executor */}
              <div>
                <label className="field-label">Executor</label>
                <input
                  type="text"
                  placeholder="Who is named to carry it out"
                  value={form.executor}
                  onChange={e => setForm(prev => (prev ? { ...prev, executor: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Last reviewed */}
              <div>
                <label className="field-label">Last reviewed</label>
                <input
                  type="date"
                  value={form.lastReviewed}
                  onChange={e => setForm(prev => (prev ? { ...prev, lastReviewed: e.target.value } : prev))}
                  className="field w-full"
                />
                <p className="text-[11px] text-ink-400 mt-1">
                  Marriages, births and property moves are common reasons to check a will is still current.
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="field-label">Notes</label>
                <textarea
                  rows={3}
                  placeholder="Anything else worth remembering — never the document's legal content"
                  value={form.notes}
                  onChange={e => setForm(prev => (prev ? { ...prev, notes: e.target.value } : prev))}
                  className="field w-full resize-none"
                />
              </div>

              {/* Link to funeral cover policies (only relevant for Funeral wishes) —
                  so the policy number and who-to-call live right alongside the
                  wishes themselves, not stranded in a different corner of the app. */}
              {form.kind === FUNERAL_WISHES_KIND && (
                <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-2.5">
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" /> Linked funeral cover
                  </label>
                  {funeralPolicies.length === 0 ? (
                    <p className="text-[12px] text-ink-400">
                      No funeral cover, burial society, or repatriation policy recorded yet — add one in Insurance.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {funeralPolicies.map(p => {
                        const active = form.linkedPolicyIds.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePolicyLink(p.id)}
                            className={`chip cursor-pointer transition-colors ${active ? 'bg-clay-500 text-white' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}
                          >
                            {p.provider || 'Unnamed'}{p.type ? ` · ${p.type}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Attached scans */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-2.5">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" /> Attached scans
                </label>
                {attachError && (
                  <div className="p-2.5 bg-rosa-50 border border-rosa-100 rounded-xl text-[12px] text-rosa-700 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rosa-500" />
                    <span>{attachError}</span>
                  </div>
                )}
                {linkedDocsFor(form.linkedDocIds).length > 0 && (
                  <div className="space-y-1.5">
                    {linkedDocsFor(form.linkedDocIds).map(d => (
                      <div key={d.id} className="flex items-center gap-2 rounded-xl bg-white border border-cream-200 p-2.5">
                        <span className="text-[13px] text-ink-700 truncate flex-1">{d.name}</span>
                        <button type="button" onClick={() => setViewingDoc(d)} className="p-1 text-ink-400 hover:text-ink-700" title="View">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" onClick={() => unlinkDoc(d.id)} className="p-1 text-ink-300 hover:text-rosa-500" title="Remove from this record">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attaching}
                  className="btn-quiet text-xs px-3 py-2 disabled:opacity-60"
                >
                  {attaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {attaching ? 'Uploading…' : 'Attach a scan'}
                </button>
                <p className="text-[11px] text-ink-400">
                  A scan is a copy, kept in the Document Vault (Legal) — the signed original is what matters.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-6 pt-0">
              <div>
                {form.id && (
                  <ConfirmDeleteButton
                    onConfirm={() => handleDelete(form.id)}
                    ariaLabel={`Delete record for ${form.originalLocation || form.kind || 'this estate item'}`}
                    hint="Only removes this note — any attached scan stays in the Document Vault."
                    variant="danger-text"
                    className="rounded-xl px-3 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </ConfirmDeleteButton>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={closeForm} className="btn-quiet text-xs px-4 py-2">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving || attaching} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DocumentViewer
        document={viewingDoc ? toFamilyDoc(viewingDoc) : null}
        memberName={viewingDoc ? (members.find(m => m.id === viewingDoc.memberId)?.name ?? 'the family') : ''}
        onClose={() => setViewingDoc(null)}
      />
    </div>
  );
}
