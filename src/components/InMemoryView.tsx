import React, { Suspense, useEffect, useRef, useState } from 'react';
import {
  Flower2, Plus, Pencil, Trash2, X, Loader2, Camera, FileText,
  Upload, ChevronRight, ImageOff,
} from 'lucide-react';
import { DepartedRelative, DepartedDocument, DepartedDocCategory, RememberedNote, FamilyDocument } from '../types';
import {
  loadInMemory, saveInMemory, uploadInMemoryPhoto, deleteInMemoryPhoto,
  uploadVaultFile, deleteVaultFile,
} from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { compressImageToAvatar } from '../utils/imageCompress';
import type { ScannedFile } from './DocumentScannerModal';
// Lazy: this camera-UI component pulls in jsPDF (page-compile) — deferring it
// keeps that weight out of every InMemoryView load for the majority of visits
// that never touch the scanner. See scannerEverOpened below for why it's also
// not simply always-mounted-with-an-open-prop, which would defeat the point.
const DocumentScannerModal = React.lazy(() => import('./DocumentScannerModal'));
import DocumentViewer from './DocumentViewer';
import SheetGrabber from './SheetGrabber';
import EmptyState from './EmptyState';

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

async function dataUrlToFile(dataUrl: string, name: string, type: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: type || blob.type || 'application/octet-stream' });
}

const DOC_CATEGORIES: DepartedDocCategory[] = [
  'Death certificate', 'Birth certificate', 'Marriage certificate',
  'Citizenship papers', 'Estate & probate papers', 'Other',
];

// DocumentViewer only knows the FamilyDocument category set (ID/Health/
// Education/Travel/Other) — same adapter technique DocumentVault.tsx already
// uses for its own differently-shaped VaultDocument, reused here unmodified.
const DOC_CATEGORY_TO_FAMILY: Record<DepartedDocCategory, FamilyDocument['category']> = {
  'Death certificate': 'Other',
  'Birth certificate': 'ID',
  'Marriage certificate': 'ID',
  'Citizenship papers': 'ID',
  'Estate & probate papers': 'Other',
  Other: 'Other',
};

function toFamilyDoc(d: DepartedDocument): FamilyDocument {
  return {
    id: d.id,
    name: d.name,
    category: DOC_CATEGORY_TO_FAMILY[d.category],
    fileType: d.fileType,
    fileName: d.fileName,
    fileSize: d.fileSize,
    uploadedAt: d.uploadedAt,
    notes: d.notes,
    fileData: d.downloadUrl,
  };
}

// ── Person form (name/relation/born/died/photo) ──

interface PersonForm {
  id: string;
  name: string;
  relation: string;
  born: string;
  died: string;
  photoUrl: string;         // may be a data: URL (unsaved) or a Storage download URL
  photoStoragePath: string;
}

const BLANK_FORM: PersonForm = { id: '', name: '', relation: '', born: '', died: '', photoUrl: '', photoStoragePath: '' };

function toForm(p: DepartedRelative): PersonForm {
  return {
    id: p.id,
    name: p.name,
    relation: p.relation,
    born: p.born || '',
    died: p.died || '',
    photoUrl: p.photoUrl || '',
    photoStoragePath: p.photoStoragePath || '',
  };
}

export default function InMemoryView() {
  const { canWrite } = useFamilyCtx();
  const [people, setPeople] = useState<DepartedRelative[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const [form, setForm] = useState<PersonForm | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  // Document add flow, used from inside the detail view.
  const [addingDoc, setAddingDoc] = useState(false);
  const [docCategory, setDocCategory] = useState<DepartedDocCategory>('Death certificate');
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Mount the (lazy) scanner once, the first time it's actually opened, and
  // never unmount it again — same reasoning as Dashboard.tsx's ExportPackModal.
  const [scannerEverOpened, setScannerEverOpened] = useState(false);
  useEffect(() => { if (scannerOpen) setScannerEverOpened(true); }, [scannerOpen]);
  const [viewingDoc, setViewingDoc] = useState<DepartedDocument | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);

  // A remembered thing being drafted in the detail view.
  const [noteDraft, setNoteDraft] = useState('');

  useEffect(() => {
    loadInMemory().then(data => {
      setPeople(data?.people || []);
      setLoading(false);
    });
  }, []);

  // Live updates from other family members. Held while any editor is open — the
  // person form, a document upload, the scanner, or a note being typed in the
  // detail view — and applied the moment the last of them closes.
  const remoteWaiting = useSharedDoc<{ people: DepartedRelative[] }>(
    'inMemory',
    (v) => setPeople(v.people || []),
    { hold: isFormOpen || addingDoc || scannerOpen || docUploading || photoUploading || noteDraft.trim() !== '' },
  );

  const persist = async (updated: DepartedRelative[]) => {
    setPeople(updated);
    await saveInMemory({ people: updated });
  };

  const viewing = people.find(p => p.id === viewingId) || null;

  // ── Person add/edit ──

  const openNewForm = () => {
    setForm({ ...BLANK_FORM, id: newId() });
    setError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (p: DepartedRelative) => {
    setForm(toForm(p));
    setError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setForm(null);
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !form) return;
    setPhotoUploading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const compressed = await compressImageToAvatar(dataUrl, 1200, 0.85);
      setForm(prev => (prev ? { ...prev, photoUrl: compressed } : prev));
    } catch {
      setError("Couldn't read that photo — please try again.");
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleSavePerson = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setError('Give their name');
      return;
    }
    if (!form.relation.trim()) {
      setError('Add how they were related (e.g. "Oma", "Grandfather")');
      return;
    }
    setError(null);
    setSaving(true);

    const existing = people.find(p => p.id === form.id);
    let photoUrl = form.photoUrl || undefined;
    let photoStoragePath = form.photoStoragePath || undefined;

    try {
      if (form.photoUrl && form.photoUrl.startsWith('data:')) {
        // A new or replaced portrait still sitting as a data: URL — upload now.
        const { storagePath, downloadUrl } = await uploadInMemoryPhoto(form.photoUrl, form.id);
        if (existing?.photoStoragePath && existing.photoStoragePath !== storagePath) {
          await deleteInMemoryPhoto(existing.photoStoragePath);
        }
        photoUrl = downloadUrl;
        photoStoragePath = storagePath;
      } else if (!form.photoUrl && existing?.photoStoragePath) {
        // Photo was removed in the form (not replaced) — clean up the orphaned file.
        await deleteInMemoryPhoto(existing.photoStoragePath);
        photoUrl = undefined;
        photoStoragePath = undefined;
      }
    } catch (err) {
      console.error('In Memory photo upload failed — saving without a photo:', err);
      photoUrl = undefined;
      photoStoragePath = undefined;
    }

    const isNew = !existing;
    const record: DepartedRelative = {
      id: form.id,
      name: form.name.trim(),
      relation: form.relation.trim(),
      born: form.born.trim() || undefined,
      died: form.died.trim() || undefined,
      photoUrl,
      photoStoragePath,
      documents: existing?.documents || [],
      notes: existing?.notes || [],
      createdAt: existing?.createdAt || new Date().toISOString().slice(0, 10),
    };

    const next = isNew ? [...people, record] : people.map(p => (p.id === record.id ? record : p));
    await persist(next);
    setSaving(false);
    closeForm();
  };

  const handleDeletePerson = async (p: DepartedRelative) => {
    if (!window.confirm(`Remove ${p.name} from In Memory? Their documents and photo will also be deleted. This cannot be undone.`)) return;
    if (p.photoStoragePath) await deleteInMemoryPhoto(p.photoStoragePath);
    for (const d of p.documents) {
      await deleteVaultFile(d.storagePath);
    }
    await persist(people.filter(x => x.id !== p.id));
    if (viewingId === p.id) setViewingId(null);
    if (form?.id === p.id) closeForm();
  };

  // ── Documents (within the detail view) ──

  const updatePerson = async (id: string, fn: (p: DepartedRelative) => DepartedRelative) => {
    const next = people.map(p => (p.id === id ? fn(p) : p));
    await persist(next);
  };

  const filePrefixFor = (name: string) =>
    name.trim() || 'file';

  const addDocumentFromFile = async (file: File, category: DepartedDocCategory) => {
    if (!viewing) return;
    setDocUploading(true);
    setDocError(null);
    try {
      const docId = newId();
      const { storagePath, downloadUrl } = await uploadVaultFile(file, docId);
      const newDoc: DepartedDocument = {
        id: docId,
        name: category,
        category,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storagePath,
        downloadUrl,
        uploadedAt: new Date().toISOString().slice(0, 10),
      };
      await updatePerson(viewing.id, p => ({ ...p, documents: [...p.documents, newDoc] }));
      setAddingDoc(false);
    } catch (err) {
      console.error('Document upload failed:', err);
      setDocError("Couldn't upload that document — please try again.");
    } finally {
      setDocUploading(false);
    }
  };

  const handleDocFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await addDocumentFromFile(file, docCategory);
  };

  const handleScannerResult = async (scanned: ScannedFile) => {
    setScannerOpen(false);
    const file = await dataUrlToFile(scanned.data, filePrefixFor(scanned.name), scanned.type);
    await addDocumentFromFile(file, docCategory);
  };

  const handleDeleteDocument = async (d: DepartedDocument) => {
    if (!viewing) return;
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    await deleteVaultFile(d.storagePath);
    await updatePerson(viewing.id, p => ({ ...p, documents: p.documents.filter(x => x.id !== d.id) }));
    if (viewingDoc?.id === d.id) setViewingDoc(null);
  };

  // ── Remembered notes ──

  const handleAddNote = async () => {
    if (!viewing) return;
    const text = noteDraft.trim();
    if (!text) return;
    const note: RememberedNote = { id: newId(), text };
    await updatePerson(viewing.id, p => ({ ...p, notes: [...p.notes, note] }));
    setNoteDraft('');
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!viewing) return;
    await updatePerson(viewing.id, p => ({ ...p, notes: p.notes.filter(n => n.id !== noteId) }));
  };

  const closeDetail = () => {
    setViewingId(null);
    setAddingDoc(false);
    setDocError(null);
    setNoteDraft('');
  };

  const bornDied = (p: DepartedRelative) => {
    if (p.born && p.died) return `${p.born} – ${p.died}`;
    if (p.died) return `Died ${p.died}`;
    if (p.born) return `Born ${p.born}`;
    return null;
  };

  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <input ref={photoFileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} />

      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-ink-100 text-ink-600 shrink-0">
              <Flower2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">In Memory</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                A place to keep parents' and grandparents' documents and a few remembered things
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

        {/* List */}
        <div className="p-4 sm:p-5">
          {people.length === 0 ? (
            <EmptyState
              icon={Flower2}
              title="No one archived here yet"
              description="Keep a parent's or grandparent's certificates, papers and a few things worth remembering, all in one place."
              action={canWrite ? { label: 'Add someone', onClick: openNewForm, icon: Plus } : undefined}
            />
          ) : (
            <div className="space-y-1">
              {sorted.map(p => (
                <div
                  key={p.id}
                  onClick={() => setViewingId(p.id)}
                  className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors cursor-pointer"
                >
                  {p.photoUrl ? (
                    <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-cream-100 ring-1 ring-cream-200">
                      <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                      <Flower2 className="w-4 h-4 text-ink-300" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-800 text-[14px] leading-tight truncate">{p.name}</p>
                    <p className="text-[12px] text-ink-500 truncate">
                      {p.relation}{bornDied(p) ? ` · ${bornDied(p)}` : ''}
                    </p>
                  </div>

                  <ChevronRight className="w-4 h-4 text-ink-300 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail view — photo, dates, remembered things, documents ── */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade"
          onClick={closeDetail}
        >
          <div
            className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <SheetGrabber onClose={closeDetail} />

            <div className="flex items-start justify-between p-6 pb-4 gap-3">
              <div className="flex items-center gap-4 min-w-0">
                {viewing.photoUrl ? (
                  <img src={viewing.photoUrl} alt={viewing.name} className="w-16 h-16 rounded-full object-cover shrink-0 ring-1 ring-cream-200" />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-cream-100 text-ink-300 flex items-center justify-center shrink-0">
                    <Flower2 className="w-7 h-7" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-display text-xl font-semibold text-ink-900 truncate">{viewing.name}</h3>
                  <p className="text-[13px] text-ink-500 truncate">{viewing.relation}</p>
                  {bornDied(viewing) && (
                    <p className="text-[12px] text-ink-400 mt-0.5">{bornDied(viewing)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canWrite && (
                  <button onClick={() => { closeDetail(); openEditForm(viewing); }} className="btn-quiet p-2">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={closeDetail} className="btn-quiet p-2">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 space-y-6">
              {/* Remembered things */}
              <div>
                <p className="section-label mb-2">A few things we remember</p>
                {viewing.notes.length === 0 && (
                  <p className="text-[13px] text-ink-400 mb-2">Nothing recorded yet.</p>
                )}
                {viewing.notes.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {viewing.notes.map(n => (
                      <li key={n.id} className="text-[14px] text-ink-700 flex items-start gap-2 group">
                        <span className="mt-2 w-1 h-1 rounded-full bg-clay-400 shrink-0" />
                        <span className="flex-1">{n.text}</span>
                        {canWrite && (
                          <button
                            onClick={() => handleDeleteNote(n.id)}
                            className="btn-quiet p-1 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            title="Remove"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canWrite && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Always made Sunday lunch for everyone"
                      value={noteDraft}
                      onChange={e => setNoteDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote(); } }}
                      className="field flex-1 text-[13px]"
                    />
                    <button onClick={handleAddNote} className="btn-quiet text-xs px-3 py-2" title="Add">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Documents */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="section-label">Documents</p>
                  {canWrite && !addingDoc && (
                    <button onClick={() => { setAddingDoc(true); setDocError(null); }} className="btn-quiet text-xs px-2.5 py-1.5">
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  )}
                </div>

                {viewing.documents.length === 0 && (
                  <p className="text-[13px] text-ink-400 mb-2">No documents filed yet.</p>
                )}

                {viewing.documents.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {viewing.documents.map(d => (
                      <div
                        key={d.id}
                        onClick={() => setViewingDoc(d)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-cream-50 group transition-colors cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-lg bg-cream-100 text-ink-500 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-ink-800 truncate">{d.name}</p>
                          <p className="text-[11px] text-ink-400 truncate">{d.category}</p>
                        </div>
                        {canWrite && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteDocument(d); }}
                            className="btn-quiet p-1.5 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {addingDoc && (
                  <div className="mt-2 p-3.5 rounded-xl bg-cream-50 border border-cream-200 space-y-3">
                    {docError && (
                      <p className="text-[12px] text-rosa-600">{docError}</p>
                    )}
                    <div>
                      <label className="field-label mb-1 block">What kind of document?</label>
                      <select
                        value={docCategory}
                        onChange={e => setDocCategory(e.target.value as DepartedDocCategory)}
                        className="field w-full"
                      >
                        {DOC_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setScannerOpen(true)}
                        disabled={docUploading}
                        className="btn-primary flex-1 text-xs px-3 py-2 disabled:opacity-60"
                      >
                        {docUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                        Scan
                      </button>
                      <button
                        onClick={() => docFileRef.current?.click()}
                        disabled={docUploading}
                        className="btn-quiet flex-1 text-xs px-3 py-2 disabled:opacity-60"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Upload file
                      </button>
                      <button onClick={() => setAddingDoc(false)} className="btn-quiet text-xs px-3 py-2">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <input ref={docFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleDocFileChange} />
                  </div>
                )}
              </div>

              {canWrite && (
                <div className="pt-2 border-t border-cream-200">
                  <button
                    onClick={() => handleDeletePerson(viewing)}
                    className="btn-quiet text-rosa-600 hover:text-rosa-700 text-xs px-3 py-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove from In Memory
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Document viewer ── */}
      <DocumentViewer
        document={viewingDoc ? toFamilyDoc(viewingDoc) : null}
        memberName={viewing?.name || ''}
        onClose={() => setViewingDoc(null)}
      />

      {/* ── Scanner for a new document ── */}
      {scannerEverOpened && (
        <Suspense fallback={null}>
          <DocumentScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onUse={handleScannerResult}
            title="Scan a document"
            subtitle="Line it up and hold steady"
            scanType="document"
            filePrefix="in-memory-document"
          />
        </Suspense>
      )}

      {/* ── Add/edit person modal ── */}
      {isFormOpen && form && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <SheetGrabber onClose={closeForm} />
            <RemoteChangeHint show={remoteWaiting} className="mx-6 mt-4" />

            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {people.some(p => p.id === form.id) ? 'Edit' : 'Add to In Memory'}
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

              {/* Photo row */}
              <div className="flex items-center gap-4">
                {form.photoUrl ? (
                  <div className="relative shrink-0">
                    <img
                      src={form.photoUrl}
                      alt="Portrait"
                      className="w-24 h-24 object-cover rounded-full border border-cream-200"
                    />
                    <button
                      onClick={() => setForm(prev => (prev ? { ...prev, photoUrl: '', photoStoragePath: '' } : prev))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-full border-2 border-dashed border-cream-300 flex items-center justify-center shrink-0">
                    <ImageOff className="w-6 h-6 text-ink-200" />
                  </div>
                )}
                <button
                  onClick={() => photoFileRef.current?.click()}
                  disabled={photoUploading}
                  className="btn-quiet text-xs px-3 py-2 disabled:opacity-60"
                >
                  {photoUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  {photoUploading ? 'Reading…' : form.photoUrl ? 'Replace photo' : 'Add a photo'}
                </button>
              </div>

              <div>
                <label className="field-label mb-1.5 block">
                  Name <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Grete Klein"
                  value={form.name}
                  onChange={e => setForm(prev => (prev ? { ...prev, name: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              <div>
                <label className="field-label mb-1.5 block">
                  Relation <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Oma, Grandfather, Mother"
                  value={form.relation}
                  onChange={e => setForm(prev => (prev ? { ...prev, relation: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label mb-1.5 block">Born</label>
                  <input
                    type="text"
                    placeholder="e.g. 1938"
                    value={form.born}
                    onChange={e => setForm(prev => (prev ? { ...prev, born: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
                <div>
                  <label className="field-label mb-1.5 block">Died</label>
                  <input
                    type="text"
                    placeholder="e.g. 2019"
                    value={form.died}
                    onChange={e => setForm(prev => (prev ? { ...prev, died: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 p-6 pt-0">
              <div>
                {people.some(p => p.id === form.id) && (
                  <button
                    onClick={() => handleDeletePerson(people.find(p => p.id === form.id)!)}
                    className="btn-quiet text-rosa-600 hover:text-rosa-700 text-xs px-3 py-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={closeForm} className="btn-quiet text-xs px-4 py-2">
                  Cancel
                </button>
                <button onClick={handleSavePerson} disabled={photoUploading || saving} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
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
