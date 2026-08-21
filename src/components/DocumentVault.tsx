import React, { useState, useEffect, useRef } from 'react';
import { VaultDocument, VaultCategory, FamilyMember, FamilyDocument } from '../types';
import { loadDocuments, saveDocuments, uploadVaultFile, deleteVaultFile, uploadVaultPhoto, deleteDocumentEverywhere } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { auth } from '../lib/firebase';
import DocumentViewer from './DocumentViewer';
import DocumentAskModal from './DocumentAskModal';
import { canAskAboutDocument } from '../utils/docReadEligibility';
import {
  FolderLock, Upload, Search, Eye, Cloud, CloudOff,
  Plus, X, Check, Loader2, File, AlertCircle, AlertTriangle,
  CheckSquare, Share2, Download, ImagePlus, MessageCircleQuestion
} from 'lucide-react';
import { computeFileHash, findLikelyDuplicate, findLikelyDuplicateByType, DupMatch } from '../utils/documentDedup';
import { canShare, shareMultiple, downloadZip } from '../utils/share';
import { compressImageToAvatar } from '../utils/imageCompress';
import PdfThumbnail from './PdfThumbnail';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { SkeletonHeader, SkeletonRows } from './Skeleton';

const CATEGORIES: VaultCategory[] = ['Identity', 'Education', 'Medical', 'Financial', 'Legal', 'Travel', 'Other'];

// Family-oriented categories that don't make sense inside a Business space
// (mirrors the HIDDEN_IN_BUSINESS pattern in Dashboard.tsx).
const HIDDEN_IN_BUSINESS: VaultCategory[] = ['Education', 'Medical'];

const CATEGORY_CHIP: Record<VaultCategory, string> = {
  Identity: 'bg-dusk-100 text-dusk-700',
  Education: 'bg-sage-100 text-sage-700',
  Medical: 'bg-rosa-100 text-rosa-700',
  Financial: 'bg-honey-100 text-honey-700',
  Legal: 'bg-ink-100 text-ink-700',
  Travel: 'bg-clay-100 text-clay-600',
  Other: 'bg-cream-200 text-ink-600',
};

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Same tiny local helper Assets.tsx and MemberBelongings.tsx each already
// duplicate rather than sharing — kept consistent with that convention.
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ */
/* Upload panel (inline — expands in-place below the header card)       */
/* ------------------------------------------------------------------ */

interface UploadPanelProps {
  members: FamilyMember[];
  existingDocs: VaultDocument[];
  categories: VaultCategory[];
  onUpload: (doc: VaultDocument, replaceId?: string) => void;
  onCancel: () => void;
}

function UploadPanel({ members, existingDocs, categories, onUpload, onCancel }: UploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<VaultCategory>('Other');
  const [memberId, setMemberId] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<DupMatch<VaultDocument> | null>(null);
  const [pendingHash, setPendingHash] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''));
    setError(null);
    setDuplicateMatch(null);
  };

  const doUpload = async (contentHash: string, replaceId?: string) => {
    if (!file) return;
    const docName = name.trim() || file.name;
    setUploading(true);
    setError(null);
    try {
      const docId = newId();
      const { storagePath, downloadUrl } = await uploadVaultFile(file, docId);
      const newDoc: VaultDocument = {
        id: docId,
        name: docName,
        category,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storagePath,
        downloadUrl,
        uploadedAt: new Date().toISOString().slice(0, 10),
        uploadedBy: auth.currentUser?.displayName || auth.currentUser?.email || undefined,
        memberId: memberId || undefined,
        notes: notes.trim() || undefined,
        contentHash,
      };
      onUpload(newDoc, replaceId);
    } catch (err: unknown) {
      console.error('Upload failed:', err);
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!file) { setError('Please choose a file to upload.'); return; }
    if (file.size > 20 * 1024 * 1024) {
      setError('File is larger than 20 MB. Please compress it first.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const hash = await computeFileHash(file);
      const sameSlot = existingDocs.filter((d) => d.category === category && (d.memberId || '') === (memberId || ''));
      const match = findLikelyDuplicate({ fileName: file.name, fileSize: file.size, contentHash: hash }, existingDocs)
        || findLikelyDuplicateByType(name.trim() || file.name, sameSlot);
      if (match) {
        setDuplicateMatch(match);
        setPendingHash(hash);
        setUploading(false);
        return; // wait for the user to choose Replace or Keep both
      }
      await doUpload(hash);
    } catch (err: unknown) {
      console.error('Duplicate check failed:', err);
      setError('Something went wrong. Please try again.');
      setUploading(false);
    }
  };

  const resolveDuplicateReplace = () => {
    if (!duplicateMatch) return;
    doUpload(pendingHash, duplicateMatch.doc.id);
  };

  const resolveDuplicateKeepBoth = () => {
    doUpload(pendingHash);
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-label flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5" /> Upload document
        </h3>
        <button onClick={onCancel} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rosa-50 border border-rosa-100 rounded-2xl text-[13px] text-rosa-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rosa-500" />
          <span>{error}</span>
        </div>
      )}

      {/* File picker */}
      <div>
        <label className="field-label">File</label>
        <div
          className="border-2 border-dashed border-cream-300 rounded-2xl p-5 text-center cursor-pointer hover:border-clay-300 hover:bg-cream-50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? (
            <p className="text-[13px] font-semibold text-ink-800 truncate">{file.name}</p>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Upload className="w-5 h-5 text-ink-400" />
              <p className="text-[13px] text-ink-500">Click to choose a file <span className="text-ink-400">(max 20 MB)</span></p>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          accept="*/*"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Name */}
        <div>
          <label className="field-label">Document name</label>
          <input
            className="field"
            placeholder="e.g. Mia's passport"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        {/* Category */}
        <div>
          <label className="field-label">Category</label>
          <select
            className="field"
            value={category}
            onChange={e => setCategory(e.target.value as VaultCategory)}
          >
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Member */}
        <div>
          <label className="field-label">Belongs to</label>
          <select
            className="field"
            value={memberId}
            onChange={e => setMemberId(e.target.value)}
          >
            <option value="">Whole family</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="field-label">Notes <span className="text-ink-400 font-normal">(optional)</span></label>
          <input
            className="field"
            placeholder="e.g. Expires March 2028"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      {duplicateMatch && (
        <div className="p-3 bg-honey-50 border border-honey-200 rounded-2xl text-[13px] text-honey-800 space-y-2">
          <p className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              This looks like it might already be saved as “{duplicateMatch.doc.name}”.
              {duplicateMatch.confidence === 'probable' && ' Same filename and size.'}
              {duplicateMatch.confidence === 'probable-type' && ' Looks like the same kind of document, just under a different name.'}
            </span>
          </p>
          <div className="flex gap-2">
            <button onClick={resolveDuplicateReplace} className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center">
              Replace existing
            </button>
            <button onClick={resolveDuplicateKeepBoth} className="btn-quiet text-xs px-3 py-1.5 flex-1 justify-center">
              Keep both
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-quiet text-sm px-4 py-2">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!file || uploading || !!duplicateMatch}
          className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
        >
          {uploading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
          ) : (
            <><Check className="w-3.5 h-3.5" /> Upload</>
          )}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk photo import panel — multi-select from Photos, one row per      */
/* photo. Mirrors UploadPanel above but drives an <input multiple> and   */
/* uploads every selected image before handing the whole batch back to  */
/* the parent in ONE call (one Firestore write, not N).                 */
/* ------------------------------------------------------------------ */

const BULK_IMPORT_CAP = 40;

type ImportStatus = 'queued' | 'compressing' | 'uploading' | 'done' | 'failed';
interface ImportItem {
  file: File;
  status: ImportStatus;
}

interface BulkPhotoImportPanelProps {
  members: FamilyMember[];
  categories: VaultCategory[];
  onImport: (docs: VaultDocument[]) => void;
  onCancel: () => void;
}

function BulkPhotoImportPanel({ members, categories, onImport, onCancel }: BulkPhotoImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [category, setCategory] = useState<VaultCategory>('Other');
  const [memberId, setMemberId] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    setDone(false);
    const capped = files.slice(0, BULK_IMPORT_CAP);
    if (files.length > BULK_IMPORT_CAP) {
      setError(`Only the first ${BULK_IMPORT_CAP} photos will be imported — that's the most in one batch.`);
    }
    setItems(capped.map(file => ({ file, status: 'queued' as ImportStatus })));
  };

  const setStatus = (idx: number, status: ImportStatus) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, status } : it)));
  };

  const handleImport = async () => {
    if (!items.length || importing) return;
    setImporting(true);
    setError(null);
    const uploaded: VaultDocument[] = [];
    let failCount = 0;
    // Sequential, not parallel — predictable progress and it keeps a single
    // slow/large photo from starving the rest of the batch of bandwidth.
    for (let i = 0; i < items.length; i++) {
      const { file } = items[i];
      try {
        setStatus(i, 'compressing');
        const raw = await readFile(file);
        // Hash the RAW original bytes (matches UploadPanel's semantic) even
        // though the STORED copy is compressed — so a photo imported both via
        // bulk and via the single-file path can still be matched later.
        const [hash, compressed] = await Promise.all([
          computeFileHash(file),
          compressImageToAvatar(raw, 1600, 0.82),
        ]);
        setStatus(i, 'uploading');
        const docId = `${Date.now().toString()}${Math.floor(Math.random() * 1000)}_${i}`;
        const { storagePath, downloadUrl } = await uploadVaultPhoto(compressed, docId);
        uploaded.push({
          id: docId,
          name: file.name.replace(/\.[^.]+$/, '') || 'Photo',
          category,
          fileName: file.name,
          fileType: 'image/jpeg',
          fileSize: file.size,
          storagePath,
          downloadUrl,
          uploadedAt: new Date().toISOString().slice(0, 10),
          uploadedBy: auth.currentUser?.displayName || auth.currentUser?.email || undefined,
          memberId: memberId || undefined,
          contentHash: hash,
        });
        setStatus(i, 'done');
      } catch (err: unknown) {
        console.error('Bulk import: a photo failed', err);
        setStatus(i, 'failed');
        failCount++;
      }
    }
    setImporting(false);
    setDone(true);
    // One Firestore write for the whole batch, not one per photo.
    if (uploaded.length) onImport(uploaded);
    if (failCount) {
      setError(`${failCount} photo${failCount === 1 ? '' : 's'} couldn't be imported. The rest were saved.`);
    }
  };

  const doneCount = items.filter(it => it.status === 'done').length;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="section-label flex items-center gap-1.5">
          <ImagePlus className="w-3.5 h-3.5" /> Import photos
        </h3>
        <button onClick={onCancel} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[13px] text-ink-500">
        Choose several photos at once from your camera roll — each is saved as its own document in the vault.
      </p>

      {error && (
        <div className="p-3 bg-honey-50 border border-honey-200 rounded-2xl text-[13px] text-honey-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-honey-700" />
          <span>{error}</span>
        </div>
      )}

      {done && (
        <div className="p-3 bg-sage-50 border border-sage-200 rounded-2xl text-[13px] text-sage-700 flex items-start gap-2">
          <Check className="w-4 h-4 mt-0.5 shrink-0 text-sage-600" />
          <span>{doneCount} photo{doneCount === 1 ? '' : 's'} added to the vault.</span>
        </div>
      )}

      {!items.length ? (
        <div
          className="border-2 border-dashed border-cream-300 rounded-2xl p-5 text-center cursor-pointer hover:border-clay-300 hover:bg-cream-50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-1.5">
            <ImagePlus className="w-5 h-5 text-ink-400" />
            <p className="text-[13px] text-ink-500">Tap to choose photos <span className="text-ink-400">(up to {BULK_IMPORT_CAP} at once)</span></p>
          </div>
        </div>
      ) : (
        <div className="max-h-56 overflow-y-auto space-y-1.5 border border-cream-200 rounded-2xl p-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-cream-50">
              <span className="text-[12px] text-ink-700 truncate flex-1">{it.file.name}</span>
              {it.status === 'queued' && <span className="text-[11px] text-ink-400">Waiting…</span>}
              {(it.status === 'compressing' || it.status === 'uploading') && <Loader2 className="w-3.5 h-3.5 animate-spin text-clay-500" />}
              {it.status === 'done' && <Check className="w-3.5 h-3.5 text-sage-600" />}
              {it.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-rosa-500" />}
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
        accept="image/*"
        multiple
      />

      {items.length > 0 && !done && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Category</label>
            <select className="field" value={category} disabled={importing} onChange={e => setCategory(e.target.value as VaultCategory)}>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Belongs to</label>
            <select className="field" value={memberId} disabled={importing} onChange={e => setMemberId(e.target.value)}>
              <option value="">Whole family</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {/* Disabled mid-import, matching the Import button. Without this, closing
            the panel during a batch unmounted it while uploads were still in
            flight — the remaining photos kept uploading with nothing left to
            record them, so they'd land in Storage but never in the vault. */}
        <button
          onClick={onCancel}
          disabled={importing}
          className="btn-quiet text-sm px-4 py-2 disabled:opacity-50"
          title={importing ? 'Please wait until the import finishes' : undefined}
        >
          <X className="w-3.5 h-3.5" /> {done ? 'Close' : 'Cancel'}
        </button>
        {items.length > 0 && !done && (
          <button
            onClick={handleImport}
            disabled={importing}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
          >
            {importing ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing {doneCount}/{items.length}…</>
            ) : (
              <><Check className="w-3.5 h-3.5" /> Import {items.length} photo{items.length === 1 ? '' : 's'}</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category filter pill row                                             */
/* ------------------------------------------------------------------ */

interface FilterBarProps {
  active: VaultCategory | 'All';
  counts: Record<string, number>;
  categories: VaultCategory[];
  onChange: (c: VaultCategory | 'All') => void;
}

function FilterBar({ active, counts, categories, onChange }: FilterBarProps) {
  const all = ['All', ...categories] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {all.map(cat => {
        const isActive = active === cat;
        const chipColor = cat === 'All' ? 'bg-ink-800 text-white' : CATEGORY_CHIP[cat as VaultCategory];
        return (
          <button
            key={cat}
            onClick={() => onChange(cat as VaultCategory | 'All')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-all cursor-pointer ${
              isActive
                ? 'border-transparent shadow-soft ' + (cat === 'All' ? 'bg-ink-800 text-white' : chipColor)
                : 'bg-white border-cream-300 text-ink-500 hover:border-cream-400 hover:text-ink-700'
            }`}
          >
            {cat}
            <span className={`chip text-[10px] px-1.5 py-0 ${isActive ? 'bg-white/20 text-white' : 'bg-cream-100 text-ink-500'}`}>
              {counts[cat] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                       */
/* ------------------------------------------------------------------ */

export default function DocumentVault({ members, isBusinessSpace, onMembersChange, emberMode = false }: { members: FamilyMember[]; isBusinessSpace?: boolean; onMembersChange?: (members: FamilyMember[]) => Promise<void> | void; emberMode?: boolean }) {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [filterCat, setFilterCat] = useState<VaultCategory | 'All'>('All');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<'share' | 'zip' | null>(null);

  // Business spaces don't need family-oriented categories like Education/Medical.
  const categories = isBusinessSpace ? CATEGORIES.filter(c => !HIDDEN_IN_BUSINESS.includes(c)) : CATEGORIES;

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadDocuments();
      if (active) {
        setDocs(data || []);
        setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  // Live updates for the shared vault. Held while an upload/import dialog is
  // open, a delete is being confirmed, an export is running, or the user is
  // part-way through a multi-select — in every one of those the list changing
  // underneath would act on the wrong rows. Applied the moment they finish.
  useSharedDoc<{ docs: VaultDocument[] }>(
    'documents',
    (v) => setDocs(v.docs || []),
    { hold: showUpload || showBulkImport || !!deletingId || selectMode || exporting !== null },
  );

  const persist = async (next: VaultDocument[]) => {
    setDocs(next);
    const ok = await saveDocuments(next);
    setCloudSynced(ok);
  };

  // Bulk import hands back the whole successful batch at once — one Firestore
  // write for N photos, not N writes. Prepended newest-first, same as a
  // single upload.
  const handleBulkImport = async (newDocs: VaultDocument[]) => {
    const next = [...newDocs, ...docs];
    await persist(next);
  };

  const handleUpload = async (doc: VaultDocument, replaceId?: string) => {
    let base = docs;
    if (replaceId) {
      const old = docs.find(d => d.id === replaceId);
      if (old) {
        try { await deleteVaultFile(old.storagePath); } catch (e) { console.error('Replace: old file delete failed (removing metadata anyway):', e); }
        base = docs.filter(d => d.id !== replaceId);
      }
    }
    const next = [doc, ...base];
    await persist(next);
    setShowUpload(false);
  };

  // Deletes the vault row, the Storage file AND any copy of the same document
  // filed on a family member's profile — the two stores used to be cleaned up
  // independently, which left the other one holding a ghost of a document the
  // user was sure they had deleted. deleteDocumentEverywhere() is the single
  // shared implementation (MemberDocuments' delete goes through it too).
  // Confirmation now lives in ConfirmDeleteButton (in-place two-step) at the
  // call site — a bare window.confirm() looks and behaves like a broken
  // webpage inside the iOS home-screen PWA.
  const handleDelete = async (doc: VaultDocument) => {
    setDeletingId(doc.id);
    const result = await deleteDocumentEverywhere({ vaultDoc: doc, members });
    if (result.membersChanged) await onMembersChange?.(result.members);
    if (result.notes.length) console.warn('Document delete:', result.notes.join(' '));
    // deleteDocumentEverywhere has already written the trimmed vault list to
    // Firestore; this only brings THIS view's local copy in line with it.
    setDocs(docs.filter(d => d.id !== doc.id));
    setCloudSynced(!result.vaultSaveFailed);
    setDeletingId(null);
  };

  const toggleSelectMode = () => {
    setSelectMode(v => !v);
    setSelectedIds(new Set());
    setShowUpload(false);
    setShowBulkImport(false);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedDocs = docs.filter(d => selectedIds.has(d.id));

  const handleShareSelected = async () => {
    if (!selectedDocs.length) return;
    setExporting('share');
    try {
      await shareMultiple(selectedDocs.map(d => ({ src: d.downloadUrl, name: d.fileName || d.name })));
    } finally {
      setExporting(null);
    }
  };

  const handleZipSelected = async () => {
    if (!selectedDocs.length) return;
    setExporting('zip');
    try {
      await downloadZip(
        selectedDocs.map(d => ({ src: d.downloadUrl, name: d.fileName || d.name })),
        `documents-${new Date().toISOString().slice(0, 10)}.zip`,
      );
    } catch (e) {
      console.error('Zip export failed:', e);
    } finally {
      setExporting(null);
    }
  };

  // Filtering
  const q = search.trim().toLowerCase();
  const filtered = docs.filter(d => {
    const matchesCat = filterCat === 'All' || d.category === filterCat;
    const matchesSearch = !q || `${d.name} ${d.fileName}`.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  // Count per category
  const counts: Record<string, number> = { All: docs.length };
  for (const cat of CATEGORIES) {
    counts[cat] = docs.filter(d => d.category === cat).length;
  }

  // Member name lookup
  const memberName = (id?: string) => {
    if (!id) return null;
    return members.find(m => m.id === id)?.name ?? null;
  };

  // Reuse the same in-app viewer the per-member Documents tab uses, instead of
  // a bare new-tab download link — same PDF/image rendering, same layout.
  const [viewingDoc, setViewingDoc] = useState<VaultDocument | null>(null);
  const [askingDoc, setAskingDoc] = useState<VaultDocument | null>(null);
  const VAULT_CATEGORY_TO_FAMILY: Record<VaultCategory, FamilyDocument['category']> = {
    Identity: 'ID', Education: 'Education', Medical: 'Health',
    Financial: 'Other', Legal: 'Other', Travel: 'Travel', Other: 'Other',
  };
  const toFamilyDoc = (v: VaultDocument): FamilyDocument => ({
    id: v.id, name: v.name, category: VAULT_CATEGORY_TO_FAMILY[v.category],
    fileType: v.fileType, fileName: v.fileName, fileSize: v.fileSize,
    uploadedAt: v.uploadedAt, notes: v.notes, fileData: v.downloadUrl,
  });

  if (!loaded) {
    return (
      <div className="space-y-6 font-sans">
        <div className="card p-5 sm:p-6">
          <SkeletonHeader />
        </div>
        <div className="card p-4 sm:p-5">
          <SkeletonRows rows={5} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">

      {/* Search is the Ember front door; Classic keeps the compact header. */}
      {emberMode ? (
        <section className="ember-vault-search">
          <div className="ember-vault-search-copy">
            <span className="pulse-eyebrow">Ask · Find · Prove</span>
            <h2>What are you looking for?</h2>
            <p>Search names, filenames and document types. Every answer stays connected to the original evidence.</p>
          </div>
          <label className="ember-vault-search-field">
            <Search className="h-5 w-5" />
            <input type="search" placeholder="Try “Ben passport” or “school report”…" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <div className="ember-vault-actions">
            <button onClick={() => { setShowBulkImport(v => !v); setShowUpload(false); setSelectMode(false); }} className="btn-quiet"><ImagePlus className="h-4 w-4" />Import photos</button>
            <button onClick={() => { setShowUpload(v => !v); setShowBulkImport(false); setSelectMode(false); }} className="btn-primary"><Plus className="h-4 w-4" />Upload document</button>
          </div>
        </section>
      ) : (
      <div className="card p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
              <FolderLock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-900">Document vault</h2>
              <p className="text-[13px] text-ink-500 font-medium">
                Passports, certificates, school reports — scanned and kept safe.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {docs.length > 0 && (
              <button
                onClick={toggleSelectMode}
                className={selectMode ? 'btn-quiet' : 'btn-quiet'}
                title={selectMode ? 'Exit selection' : 'Select documents to export or share'}
              >
                {selectMode ? <X className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
                {selectMode ? 'Cancel' : 'Select'}
              </button>
            )}
            <button
              onClick={() => { setShowBulkImport(v => !v); setShowUpload(false); setSelectMode(false); }}
              className="btn-quiet shrink-0"
            >
              {showBulkImport ? <X className="w-4 h-4" /> : <ImagePlus className="w-4 h-4" />}
              {showBulkImport ? 'Cancel' : 'Import photos'}
            </button>
            <button
              onClick={() => { setShowUpload(v => !v); setShowBulkImport(false); setSelectMode(false); }}
              className="btn-primary shrink-0"
            >
              {showUpload ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showUpload ? 'Cancel' : 'Upload document'}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Selection bar — appears once "Select" is toggled on */}
      {selectMode && (
        <div className="card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-clay-50 border-clay-200">
          <div className="flex items-center gap-3">
            <p className="text-[13px] font-semibold text-clay-900">
              {selectedIds.size === 0 ? 'Tap documents to select them' : `${selectedIds.size} selected`}
              {selectedIds.size > 0 && (
                <span className="text-clay-600 font-normal"> · {formatBytes(selectedDocs.reduce((sum, d) => sum + (d.fileSize || 0), 0))}</span>
              )}
            </p>
            {docs.length > 0 && (
              <button
                onClick={() => setSelectedIds(selectedIds.size === filtered.length ? new Set() : new Set(filtered.map(d => d.id)))}
                className="text-[12px] font-semibold text-clay-700 hover:text-clay-900 underline underline-offset-2"
              >
                {selectedIds.size === filtered.length ? 'Clear all' : `Select all ${filtered.length}`}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canShare && (
              <button
                onClick={handleShareSelected}
                disabled={selectedIds.size === 0 || !!exporting}
                className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
              >
                {exporting === 'share' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                Share
              </button>
            )}
            <button
              onClick={handleZipSelected}
              disabled={selectedIds.size === 0 || !!exporting}
              className="btn-quiet text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {exporting === 'zip' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download .zip
            </button>
          </div>
        </div>
      )}

      {/* Upload panel (inline, collapsible) */}
      {showUpload && (
        <UploadPanel
          members={members}
          existingDocs={docs}
          categories={categories}
          onUpload={handleUpload}
          onCancel={() => setShowUpload(false)}
        />
      )}

      {/* Bulk photo import panel (inline, collapsible) */}
      {showBulkImport && (
        <BulkPhotoImportPanel
          members={members}
          categories={categories}
          onImport={handleBulkImport}
          onCancel={() => setShowBulkImport(false)}
        />
      )}

      {/* Filter + search bar */}
      <div className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <FilterBar active={filterCat} counts={counts} categories={categories} onChange={setFilterCat} />
          {!emberMode && <div className="relative w-full sm:w-60">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search documents…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field pl-10"
            />
          </div>}
        </div>
      </div>

      {/* Document list */}
      {filtered.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-3 bg-clay-50">
          <div className="w-12 h-12 rounded-2xl bg-clay-100 text-clay-600 flex items-center justify-center">
            <FolderLock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-[14px] font-semibold text-clay-900">
              {docs.length === 0 ? 'No documents yet' : 'Nothing matches your search'}
            </h4>
            <p className="text-[13px] text-clay-700 mt-1 max-w-xs leading-relaxed">
              {docs.length === 0
                ? 'Upload your first document — passports, birth certificates, school reports…'
                : 'Try a different search term or category filter.'}
            </p>
          </div>
          {docs.length === 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              <button className="btn-primary text-sm" onClick={() => setShowUpload(true)}>
                <Plus className="w-3.5 h-3.5" /> Upload document
              </button>
              <button className="btn-quiet text-sm" onClick={() => setShowBulkImport(true)}>
                <ImagePlus className="w-3.5 h-3.5" /> Import photos
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(doc => {
            const isImage = doc.fileType.startsWith('image/');
            const mName = memberName(doc.memberId);
            const isDeleting = deletingId === doc.id;
            const isSelected = selectedIds.has(doc.id);

            return (
              <div
                key={doc.id}
                onClick={selectMode ? () => toggleSelected(doc.id) : undefined}
                className={`card p-4 sm:p-5 flex flex-wrap items-start justify-between gap-4 transition-all ${
                  selectMode
                    ? `cursor-pointer ${isSelected ? 'ring-2 ring-clay-400 bg-clay-50' : 'hover:bg-cream-100/60'}`
                    : 'hover:bg-cream-100/60'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {selectMode && (
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        isSelected ? 'bg-clay-500 border-clay-500' : 'border-cream-400 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                  )}
                  {/* Thumbnail or icon */}
                  {isImage ? (
                    <img
                      src={doc.downloadUrl}
                      alt={doc.name}
                      className="w-12 h-12 rounded-xl object-cover border border-cream-200 shrink-0"
                      loading="lazy"
                    />
                  ) : doc.fileType === 'application/pdf' ? (
                    <PdfThumbnail src={doc.downloadUrl} />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-cream-100 border border-cream-200 flex items-center justify-center shrink-0">
                      <File className="w-5 h-5 text-ink-400" />
                    </div>
                  )}

                  {/* Meta */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <p className="font-semibold text-[14px] text-ink-900 truncate">{doc.name}</p>
                      <span className={`chip ${CATEGORY_CHIP[doc.category]}`}>{doc.category}</span>
                      {mName && (
                        <span className="chip bg-cream-100 text-ink-600">{mName}</span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-400 truncate" title={doc.fileName}>{doc.fileName}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 tabular-nums">
                      <span className="text-[12px] text-ink-400">{formatBytes(doc.fileSize)}</span>
                      <span className="text-[12px] text-ink-400">{doc.uploadedAt}</span>
                      {doc.uploadedBy && (
                        <span className="text-[12px] text-ink-400">by {doc.uploadedBy.split(' ')[0]}</span>
                      )}
                    </div>
                    {doc.notes && (
                      <p className="text-[12px] text-ink-500 mt-1 italic">{doc.notes}</p>
                    )}
                  </div>
                </div>

                {/* Actions — hidden while selecting so a stray tap can't view/delete */}
                {!selectMode && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewingDoc(doc)}
                      className="btn-quiet text-xs px-3 py-1.5"
                      title="View document"
                    >
                      <Eye className="w-3 h-3" />
                      View
                    </button>
                    {/* Recall-only reader. Hidden rather than disabled where it
                        cannot apply (medical, insurance-pending-legal-review,
                        business spaces, images with no text to extract) —
                        canAskAboutDocument mirrors the server's own gate, which
                        stays authoritative. See utils/docReadEligibility.ts. */}
                    {canAskAboutDocument({
                      category: doc.category,
                      name: doc.name,
                      fileType: doc.fileType,
                      isBusinessSpace,
                    }) && (
                      <button
                        type="button"
                        onClick={() => setAskingDoc(doc)}
                        className="btn-quiet text-xs px-3 py-1.5"
                        title="Ask what this document says"
                      >
                        <MessageCircleQuestion className="w-3 h-3" />
                        Ask
                      </button>
                    )}
                    <ConfirmDeleteButton
                      onConfirm={() => handleDelete(doc)}
                      ariaLabel={`Delete "${doc.name}" everywhere`}
                      hint="Removes the file from the vault and from any family member's profile it was filed on."
                      busy={isDeleting}
                      className="rounded-xl"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer sync pill — mirrors ImportantInfo exactly */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {cloudSynced === false ? (
            <><CloudOff className="w-3.5 h-3.5 text-honey-700" /><span>Saved on this device — cloud sync unavailable</span></>
          ) : (
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your {isBusinessSpace ? 'team' : 'family'}{cloudSynced ? ' · synced' : ''}</span></>
          )}
        </div>
      </div>

      <DocumentViewer
        document={viewingDoc ? toFamilyDoc(viewingDoc) : null}
        memberName={viewingDoc ? (memberName(viewingDoc.memberId) ?? (isBusinessSpace ? 'the team' : 'the family')) : ''}
        onClose={() => setViewingDoc(null)}
      />

      <DocumentAskModal
        doc={askingDoc ? {
          id: askingDoc.id,
          name: askingDoc.name,
          category: askingDoc.category,
          fileType: askingDoc.fileType,
          src: askingDoc.downloadUrl,
          storagePath: askingDoc.storagePath,
          contentHash: askingDoc.contentHash,
        } : null}
        isBusinessSpace={isBusinessSpace}
        onClose={() => setAskingDoc(null)}
      />
    </div>
  );
}
