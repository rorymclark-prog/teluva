import React, { useState, useEffect, useRef, useMemo } from 'react';
import { VaultDocument, VaultCategory, FamilyMember, FamilyDocument, HouseholdInfo, AssetItem } from '../types';
import { loadHousehold, loadAssets, loadDocuments, saveDocuments, uploadVaultFile, deleteVaultFile, uploadVaultPhoto, deleteDocumentEverywhere, fetchInboundMailAddress, fetchGmailBridgeStatus, createGmailBridgeToken, revokeGmailBridgeToken } from '../utils/db';
import type { GmailBridgeStatus } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { auth } from '../lib/firebase';
import DocumentViewer from './DocumentViewer';
import DocumentAskModal from './DocumentAskModal';
import { canAskAboutDocument } from '../utils/docReadEligibility';
import { toFamilyDoc } from '../utils/vaultDoc';
import { filedWithIndex, filedWithText } from '../utils/serviceDocs';
import { extractKeyFacts, saveKeyFacts, vaultDocToReaderTarget } from '../utils/docKeyFacts';
import { keyFactsCurrent } from '../utils/trip';
import {
  FolderLock, Upload, Search, Eye, Cloud, CloudOff,
  Plus, X, Check, Loader2, File, AlertCircle, AlertTriangle,
  CheckSquare, Share2, Download, ImagePlus, MessageCircleQuestion, Mail, Wrench, CalendarHeart
} from 'lucide-react';
import { lifeDateLabel } from '../utils/lifeTimeline';
import { computeFileHash, findLikelyDuplicate, findLikelyDuplicateByType, DupMatch } from '../utils/documentDedup';
import { canShare, shareMultiple, downloadZip } from '../utils/share';
import { compressImageToAvatar } from '../utils/imageCompress';
import PdfThumbnail from './PdfThumbnail';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { SkeletonHeader, SkeletonRows } from './Skeleton';

const CATEGORIES: VaultCategory[] = ['Identity', 'Education', 'Medical', 'Financial', 'Legal', 'Travel', 'Other'];

// The date printed on a document — what places it on the timeline. Shown as a
// quiet link until someone sets it, then as the date; either way one tap edits.
function DocDate({ value, onChange }: { value?: string; onChange: (next: string | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        type="date"
        className="field text-[12px] py-1 px-2 w-auto"
        autoFocus
        defaultValue={value || ''}
        aria-label="Date on the document"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
        onBlur={(e) => {
          setEditing(false);
          const next = e.target.value;
          if (next !== (value || '')) onChange(next || undefined);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={`text-[12px] inline-flex items-center gap-1 hover:text-clay-700 ${value ? 'text-sage-700 font-medium' : 'text-ink-400'}`}
      title="The date printed on the document. It puts the document on the timeline."
    >
      <CalendarHeart className="w-3 h-3" />
      {value ? `On the timeline · ${lifeDateLabel({ date: value, precision: 'day' })}` : 'Add the date on it'}
    </button>
  );
}

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
  isBusinessSpace?: boolean;
  members: FamilyMember[];
  existingDocs: VaultDocument[];
  categories: VaultCategory[];
  onUpload: (doc: VaultDocument, replaceId?: string) => void;
  onCancel: () => void;
  /* A file that arrived without anyone opening the file picker — shared in
   * from another app's share sheet, dropped onto the window, or pasted. The
   * rest of the form is deliberately NOT pre-filled beyond the name: which
   * person and which category a document belongs to is the judgement the vault
   * exists to capture, and guessing it produces a vault full of things filed
   * under Other against nobody. */
  initialFile?: File | null;
}

function UploadPanel({ members, existingDocs, categories, onUpload, onCancel, isBusinessSpace = false, initialFile = null }: UploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(initialFile);
  const [name, setName] = useState(initialFile ? initialFile.name.replace(/\.[^.]+$/, '') : '');
  const [category, setCategory] = useState<VaultCategory>('Other');
  const [memberId, setMemberId] = useState('');
  const [notes, setNotes] = useState('');
  const [docDate, setDocDate] = useState('');
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

  /* A share or a drop while the panel is ALREADY open replaces what is in it.
   * The alternative — ignoring the new file because the panel is mounted — is
   * the worse failure: the person watches their document arrive, sees the
   * previous one still named in the form, and has no way to tell which set of
   * bytes the Upload button is about to send. The name follows the file unless
   * it has been typed over. */
  useEffect(() => {
    if (!initialFile) return;
    setFile(initialFile);
    setName((prev) => (prev.trim() ? prev : initialFile.name.replace(/\.[^.]+$/, '')));
    setError(null);
    setDuplicateMatch(null);
  }, [initialFile]);

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
        docDate: docDate || undefined,
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
            <option value="">{isBusinessSpace ? 'Whole team' : 'Whole family'}</option>
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

        {/* The date printed on it — never the upload date */}
        <div>
          <label className="field-label">Date on the document <span className="text-ink-400 font-normal">(optional)</span></label>
          <input
            type="date"
            className="field"
            value={docDate}
            onChange={e => setDocDate(e.target.value)}
          />
          <p className="text-[12px] text-ink-400 mt-1">Puts it on the timeline on that day.</p>
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
  isBusinessSpace?: boolean;
  members: FamilyMember[];
  categories: VaultCategory[];
  onImport: (docs: VaultDocument[]) => void;
  onCancel: () => void;
}

function BulkPhotoImportPanel({ members, categories, onImport, onCancel, isBusinessSpace = false }: BulkPhotoImportPanelProps) {
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
              <option value="">{isBusinessSpace ? 'Whole team' : 'Whole family'}</option>
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

export default function DocumentVault({ members, isBusinessSpace, onMembersChange, emberMode = false, openUploadSignal = 0, incomingFile = null, onIncomingConsumed }: { members: FamilyMember[]; isBusinessSpace?: boolean; onMembersChange?: (members: FamilyMember[]) => Promise<void> | void; emberMode?: boolean; openUploadSignal?: number; incomingFile?: File | null; onIncomingConsumed?: () => void }) {
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
  /* A file that arrived without the file picker. THREE doors lead here and
   * they are all the same door once the file exists:
   *
   *  - shared in from another app's share sheet (Dashboard hands it down as
   *    `incomingFile`; see utils/sharedInbox.ts for how it survives the POST),
   *  - dragged onto the window from a desktop or a mail client,
   *  - pasted.
   *
   * Before this, the only way in was the picker — which on a phone means
   * leaving Teluva, finding the app the document is in, saving it to Files,
   * coming back, and going looking for it. Every one of those steps is a
   * chance to give up, and the document that never gets filed is the one that
   * is needed at a border. */
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  /* The family's forward-to-file address, or null when inbound mail is not
   * switched on for this deployment — which is the case in production today,
   * because it needs a domain with an MX record and the app runs on
   * *.run.app. Rendered only when it exists: an address people cannot use is
   * worse than no row, because someone WILL forward a document to it. */
  const [inboundAddress, setInboundAddress] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);
  /* The Gmail bridge. Teluva cannot read Gmail — every scope that can is a
   * Google RESTRICTED scope needing an annual CASA assessment — so the reading
   * happens in an Apps Script in the person's own account, which pushes
   * attachments in with a bridge token.
   *
   * `gmailToken` is the raw token and exists in this component for exactly as
   * long as the person needs to copy it. The server never returns it again:
   * only its hash is stored. That is deliberate, and it is why the panel says
   * so out loud rather than letting someone close it and come back. */
  const [gmailStatus, setGmailStatus] = useState<GmailBridgeStatus | null>(null);
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailError, setGmailError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  /* Nested dragenter/dragleave pairs fire for every child element the pointer
   * crosses, so a boolean toggled on each one flickers the overlay off the
   * moment the file passes over a card. Counting them is the standard cure. */
  const dragDepth = useRef(0);

  const pendingFile = incomingFile || droppedFile;

  // Business spaces don't need family-oriented categories like Education/Medical.
  const categories = isBusinessSpace ? CATEGORIES.filter(c => !HIDDEN_IN_BUSINESS.includes(c)) : CATEGORIES;

  useEffect(() => {
    if (!openUploadSignal) return;
    setShowUpload(true);
    setShowBulkImport(false);
    setSelectMode(false);
  }, [openUploadSignal]);

  /* A file arriving IS the intent to upload it — opening the panel is not a
   * guess. Bulk import and select mode close, because all three fight for the
   * same region of the screen and the arriving file is the most recent thing
   * the person did. */
  useEffect(() => {
    if (!pendingFile) return;
    setShowUpload(true);
    setShowBulkImport(false);
    setSelectMode(false);
  }, [pendingFile]);

  /* Paste. Bound to the document rather than a field because there is nothing
   * sensible to focus first — the gesture is "I copied a PDF, put it here".
   * Skipped while typing, or pasting a filename into the search box would
   * open the upload form instead of searching.
   *
   * clipboardData.files, not .items: a file copied in Finder or Explorer
   * reports an EMPTY types list, so anything keyed on types misses exactly the
   * case this is for. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const f = e.clipboardData?.files?.[0];
      if (!f || !f.size) return;
      e.preventDefault();
      setDroppedFile(f);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    let active = true;
    fetchInboundMailAddress().then((a) => { if (active) setInboundAddress(a); });
    fetchGmailBridgeStatus().then((st) => { if (active) setGmailStatus(st); });
    return () => { active = false; };
  }, []);

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

  /* "Filed with Trek FX · service 10 Sep" — Rory asked where a service
   * receipt LIVES; this is the vault answering "and what is it for?". DERIVED
   * from the household doc's service logs (utils/serviceDocs.filedWithIndex),
   * never stored on the document, so there is no back-pointer to go stale.
   * Read-only: this screen never writes the household doc. */
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [assetNames, setAssetNames] = useState<Pick<AssetItem, 'id' | 'name'>[]>([]);
  useEffect(() => {
    let active = true;
    loadHousehold().then((h) => { if (active) setHousehold(h || {}); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useSharedDoc<HouseholdInfo>('household', (h) => setHousehold(h || {}));
  // Item names only matter for a work-log receipt linked to an appliance;
  // skip the whole Belongings read when nothing is.
  const needsAssetNames = !!household?.homeServiceLog?.some((r) => r?.assetId && r.docIds?.length);
  useEffect(() => {
    if (!needsAssetNames) return;
    let active = true;
    loadAssets().then((a) => { if (active) setAssetNames((a || []).map(({ id, name }) => ({ id, name }))); }).catch(() => {});
    return () => { active = false; };
  }, [needsAssetNames]);
  const filedWith = useMemo(() => filedWithIndex(household, assetNames), [household, assetNames]);

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
    closeUpload();
  };

  const closeUpload = () => setShowUpload(false);

  /* The panel closing is what SPENDS an arriving file — however it closed.
   * Written as an effect on `showUpload` rather than inside the cancel
   * handler because there are FOUR ways it closes: cancel, a completed
   * upload, the toggle button pressed a second time, and switching to Import
   * photos. Clearing in only the first two leaves the file set, so the next
   * press of "Upload document" silently reopens holding the document the
   * person just decided not to file — a form that looks like a fresh upload
   * and is not one. */
  useEffect(() => {
    if (showUpload) return;
    setDroppedFile(null);
    if (incomingFile) onIncomingConsumed?.();
    // onIncomingConsumed is the parent's setState; incomingFile is what it clears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUpload]);

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
    const owner = d.memberId ? members.find(member => member.id === d.memberId)?.name || '' : '';
    const searchText = `${d.name} ${d.fileName || ''} ${d.category} ${owner} ${d.notes || ''} ${d.fileType || ''}`.toLowerCase();
    const matchesSearch = !q || q.split(/\s+/).every(token => searchText.includes(token));
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

  /* Drop handlers on the vault root. dragover MUST preventDefault or the
   * browser navigates away to display the file, which loses the whole page —
   * the single most common way a drop target silently does not work. */
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragDepth.current += 1;
    setDragActive(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: React.DragEvent) => {
    const f = e.dataTransfer?.files?.[0];
    dragDepth.current = 0;
    setDragActive(false);
    if (!f || !f.size) return;
    e.preventDefault();
    setDroppedFile(f);
  };

  return (
    <div
      className="space-y-6 font-sans relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Only while a file is actually over the window. A permanent "drop
        * files here" zone would be a lie on a phone, where there is no drag. */}
      {dragActive && (
        <div className="fixed inset-0 z-[90] pointer-events-none flex items-center justify-center bg-ink-900/30 backdrop-blur-sm">
          <div className="card px-6 py-5 flex items-center gap-3 border-2 border-dashed border-terra-400">
            <Upload className="w-5 h-5 text-terra-500" />
            <p className="text-[15px] font-semibold text-ink-800">Drop it here to file it</p>
          </div>
        </div>
      )}

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
      {inboundAddress && (
        <div className="card p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 flex items-center justify-center shrink-0">
            <Upload className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink-800">Email documents in</p>
            <p className="text-[12px] text-ink-500 mt-0.5">
              Forward an email to this address and its attachments are filed here. Only messages from
              a member of {isBusinessSpace ? 'this business' : 'your family'} are accepted.
            </p>
            <p className="text-[12.5px] font-mono break-all text-ink-800 mt-1.5">{inboundAddress}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              /* A tick only after the clipboard write RESOLVES — a denied
               * clipboard permission must not claim a copy that did not
               * happen, or someone forwards a document to nothing. */
              navigator.clipboard?.writeText(inboundAddress).then(() => {
                setCopiedAddress(true);
                setTimeout(() => setCopiedAddress(false), 1600);
              }).catch(() => { /* silent — no false tick */ });
            }}
            className="btn-quiet text-xs px-3 py-1.5 shrink-0"
          >
            {copiedAddress ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {gmailStatus && (
        <div className="card p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-sage-100 text-sage-700 flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-800">File documents from your email</p>
              {gmailStatus.connected ? (
                <p className="text-[12px] text-ink-500 mt-0.5">
                  Connected. {gmailStatus.filedCount || 0} document{(gmailStatus.filedCount || 0) === 1 ? '' : 's'} filed so far
                  {gmailStatus.lastUsedAt ? `, last checked ${new Date(gmailStatus.lastUsedAt).toLocaleDateString()}` : ' — waiting for its first run'}.
                </p>
              ) : (
                <p className="text-[12px] text-ink-500 mt-0.5">
                  A small script runs in your own Gmail, finds photos and PDFs attached to your mail,
                  and files them here. It never reads the text of your messages.
                </p>
              )}

              {/* The raw token, for as long as it takes to copy it. Saying the
                * words "shown once" beside it is not decoration: the server
                * keeps only a hash, so someone who closes this without copying
                * has to create a new one, and a person who does not know that
                * will assume they can come back for it. */}
              {gmailToken && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-[12px] font-semibold text-amber-900">Copy this now — it is shown once.</p>
                  <p className="text-[12.5px] font-mono break-all text-ink-800 mt-1">{gmailToken}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(gmailToken).then(() => {
                          setCopiedToken(true);
                          setTimeout(() => setCopiedToken(false), 1600);
                        }).catch(() => { /* silent — never a tick for a copy that did not happen */ });
                      }}
                      className="btn-quiet text-xs px-3 py-1.5"
                    >
                      {copiedToken ? 'Copied' : 'Copy token'}
                    </button>
                    <button type="button" onClick={() => setGmailToken(null)} className="text-xs text-ink-500 underline">
                      I have copied it
                    </button>
                  </div>
                  <p className="text-[11.5px] text-ink-500 mt-2">
                    Paste it into the bridge script's <span className="font-mono">TELUVA_TOKEN</span> property —
                    setup steps are in <span className="font-mono">apps-script/teluva-gmail-bridge/README.md</span>.
                  </p>
                </div>
              )}

              {gmailError && <p className="text-[12px] text-rose-600 mt-1.5">{gmailError}</p>}

              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  disabled={gmailBusy}
                  onClick={async () => {
                    setGmailBusy(true); setGmailError(null);
                    try {
                      const t = await createGmailBridgeToken();
                      setGmailToken(t);
                      setGmailStatus(await fetchGmailBridgeStatus());
                    } catch (e) {
                      setGmailError(e instanceof Error ? e.message : 'Could not create the token.');
                    } finally { setGmailBusy(false); }
                  }}
                  className="btn-quiet text-xs px-3 py-1.5 disabled:opacity-50"
                >
                  {gmailStatus.connected ? 'Create a new token' : 'Connect Gmail'}
                </button>
                {gmailStatus.connected && (
                  <button
                    type="button"
                    disabled={gmailBusy}
                    onClick={async () => {
                      setGmailBusy(true); setGmailError(null);
                      try {
                        await revokeGmailBridgeToken();
                        setGmailToken(null);
                        setGmailStatus(await fetchGmailBridgeStatus());
                      } catch (e) {
                        setGmailError(e instanceof Error ? e.message : 'Could not disconnect.');
                      } finally { setGmailBusy(false); }
                    }}
                    className="text-xs text-rose-600 underline disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                )}
              </div>
              {gmailStatus.connected && (
                <p className="text-[11.5px] text-ink-500 mt-1.5">
                  Creating a new token immediately stops the old one working.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        <UploadPanel isBusinessSpace={isBusinessSpace}
          initialFile={pendingFile}
          members={members}
          existingDocs={docs}
          categories={categories}
          onUpload={handleUpload}
          onCancel={closeUpload}
        />
      )}

      {/* Bulk photo import panel (inline, collapsible) */}
      {showBulkImport && (
        <BulkPhotoImportPanel isBusinessSpace={isBusinessSpace}
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
            const filedText = (filedWith.get(doc.id) || []).map((f) => filedWithText(f)).join('; ');

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
                    {filedText && (
                      <p className="text-[12px] text-sage-700 font-medium mt-0.5 flex items-center gap-1 min-w-0">
                        <Wrench className="w-3 h-3 shrink-0" /><span className="truncate">Filed with {filedText}</span>
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 tabular-nums">
                      <span className="text-[12px] text-ink-400">{formatBytes(doc.fileSize)}</span>
                      <span className="text-[12px] text-ink-400">{doc.uploadedAt}</span>
                      {doc.uploadedBy && (
                        <span className="text-[12px] text-ink-400">by {doc.uploadedBy.split(' ')[0]}</span>
                      )}
                      {!selectMode && (
                        <DocDate
                          value={doc.docDate}
                          onChange={(docDate) => persist(docs.map((d) => (d.id === doc.id ? { ...d, docDate } : d)))}
                        />
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
                      hint={`Removes the file from the vault and from any ${isBusinessSpace ? 'team' : 'family'} member's profile it was filed on.${filedText ? ` It is also filed with ${filedText} — that entry keeps its details, just not this file.` : ''}`}
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
        onExtractKeyFacts={viewingDoc ? async () => {
          // Same pipeline as the trip pack's button (utils/docKeyFacts.ts).
          // saveKeyFacts returns the post-merge doc list; adopting it keeps
          // this screen honest about what was actually stored, and updating
          // viewingDoc re-renders the open viewer with its new chips.
          const res = await extractKeyFacts(vaultDocToReaderTarget(viewingDoc));
          if (res.kind !== 'result') return { ok: false, message: res.message };
          const next = await saveKeyFacts(viewingDoc.id, res.facts);
          if (!next) return { ok: false, message: 'Could not save the facts — please try again.' };
          setDocs(next);
          const fresh = next.find((d) => d.id === viewingDoc.id);
          if (fresh) setViewingDoc(fresh);
          return { ok: true };
        } : undefined}
        factsStale={viewingDoc ? !keyFactsCurrent(viewingDoc) : false}
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
