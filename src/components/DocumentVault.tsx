import React, { useState, useEffect, useRef } from 'react';
import { VaultDocument, VaultCategory, FamilyMember } from '../types';
import { loadDocuments, saveDocuments, uploadVaultFile, deleteVaultFile } from '../utils/db';
import { auth } from '../lib/firebase';
import {
  FolderLock, Upload, Search, Trash2, ExternalLink, Cloud, CloudOff,
  Plus, X, Check, Loader2, FileText, File, Image, AlertCircle
} from 'lucide-react';

const CATEGORIES: VaultCategory[] = ['Identity', 'Education', 'Medical', 'Financial', 'Legal', 'Travel', 'Other'];

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

/* ------------------------------------------------------------------ */
/* Upload panel (inline — expands in-place below the header card)       */
/* ------------------------------------------------------------------ */

interface UploadPanelProps {
  members: FamilyMember[];
  onUpload: (doc: VaultDocument) => void;
  onCancel: () => void;
}

function UploadPanel({ members, onUpload, onCancel }: UploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<VaultCategory>('Other');
  const [memberId, setMemberId] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file) { setError('Please choose a file to upload.'); return; }
    if (file.size > 20 * 1024 * 1024) {
      setError('File is larger than 20 MB. Please compress it first.');
      return;
    }
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
      };
      onUpload(newDoc);
    } catch (err: unknown) {
      console.error('Upload failed:', err);
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
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
            {CATEGORIES.map(c => (
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

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-quiet text-sm px-4 py-2">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!file || uploading}
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
/* Category filter pill row                                             */
/* ------------------------------------------------------------------ */

interface FilterBarProps {
  active: VaultCategory | 'All';
  counts: Record<string, number>;
  onChange: (c: VaultCategory | 'All') => void;
}

function FilterBar({ active, counts, onChange }: FilterBarProps) {
  const all = ['All', ...CATEGORIES] as const;
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

export default function DocumentVault({ members }: { members: FamilyMember[] }) {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [filterCat, setFilterCat] = useState<VaultCategory | 'All'>('All');
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const persist = async (next: VaultDocument[]) => {
    setDocs(next);
    const ok = await saveDocuments(next);
    setCloudSynced(ok);
  };

  const handleUpload = async (doc: VaultDocument) => {
    const next = [doc, ...docs];
    await persist(next);
    setShowUpload(false);
  };

  const handleDelete = async (doc: VaultDocument) => {
    const confirmed = window.confirm(
      `Remove "${doc.name}" from the vault? The file will be permanently deleted.`
    );
    if (!confirmed) return;
    setDeletingId(doc.id);
    try {
      await deleteVaultFile(doc.storagePath);
    } catch (e) {
      console.error('File delete failed (removing metadata anyway):', e);
    }
    const next = docs.filter(d => d.id !== doc.id);
    await persist(next);
    setDeletingId(null);
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

  if (!loaded) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">

      {/* Header card */}
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
          <button
            onClick={() => setShowUpload(v => !v)}
            className="btn-primary shrink-0"
          >
            {showUpload ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showUpload ? 'Cancel' : 'Upload document'}
          </button>
        </div>
      </div>

      {/* Upload panel (inline, collapsible) */}
      {showUpload && (
        <UploadPanel
          members={members}
          onUpload={handleUpload}
          onCancel={() => setShowUpload(false)}
        />
      )}

      {/* Filter + search bar */}
      <div className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <FilterBar active={filterCat} counts={counts} onChange={setFilterCat} />
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search documents…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field pl-10"
            />
          </div>
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
            <button className="btn-primary text-sm mt-1" onClick={() => setShowUpload(true)}>
              <Plus className="w-3.5 h-3.5" /> Upload document
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(doc => {
            const isImage = doc.fileType.startsWith('image/');
            const mName = memberName(doc.memberId);
            const isDeleting = deletingId === doc.id;

            return (
              <div
                key={doc.id}
                className="card p-4 sm:p-5 flex items-start justify-between gap-4 hover:bg-cream-100/60 transition-all"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {/* Thumbnail or icon */}
                  {isImage ? (
                    <img
                      src={doc.downloadUrl}
                      alt={doc.name}
                      className="w-12 h-12 rounded-xl object-cover border border-cream-200 shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-cream-100 border border-cream-200 flex items-center justify-center shrink-0">
                      {doc.fileType === 'application/pdf' ? (
                        <FileText className="w-5 h-5 text-rosa-500" />
                      ) : doc.fileType.startsWith('image/') ? (
                        <Image className="w-5 h-5 text-dusk-500" />
                      ) : (
                        <File className="w-5 h-5 text-ink-400" />
                      )}
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

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={doc.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-quiet text-xs px-3 py-1.5"
                    title="Open / download file"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View
                  </a>
                  <button
                    onClick={() => handleDelete(doc)}
                    disabled={isDeleting}
                    className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-rosa-50 rounded-xl transition-colors disabled:opacity-40"
                    title="Delete document"
                  >
                    {isDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
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
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your family{cloudSynced ? ' · synced' : ''}</span></>
          )}
        </div>
      </div>
    </div>
  );
}
