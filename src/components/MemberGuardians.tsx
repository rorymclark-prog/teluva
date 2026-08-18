import React, { useEffect, useState } from 'react';
import { FamilyMember, NonResidentGuardian, GuardianRelationship, FamilyDocument } from '../types';
import { hashDataUrl, findLikelyDuplicate, DupMatch } from '../utils/documentDedup';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import PdfThumbnail from './PdfThumbnail';
import {
  Plus, Trash2, Pencil, Check, X, UserRoundCheck, Phone, Mail, MapPin,
  FileText, Upload, AlertCircle, AlertTriangle, ExternalLink,
} from 'lucide-react';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

const RELATIONSHIPS: GuardianRelationship[] = ['Parent', 'Guardian', 'Grandparent', 'Other'];

const RELATIONSHIP_CHIP: Record<GuardianRelationship, string> = {
  Parent: 'bg-dusk-100 text-dusk-700',
  Guardian: 'bg-clay-100 text-clay-600',
  Grandparent: 'bg-honey-100 text-honey-700',
  Other: 'bg-cream-200 text-ink-600',
};

// Documents here are stored inline as base64 on the member record, exactly
// like MemberDocuments.tsx (NOT a Storage upload like MemberReferrals.tsx) —
// NonResidentGuardian.documents is typed FamilyDocument[], the same shape
// MemberDocuments.tsx already owns, so this mirrors that file's upload
// pattern rather than inventing a second one. Same 700KB cap for the same
// reason: base64 inside a Firestore document, which has a 1MB hard limit.
const MAX_UPLOAD_BYTES = 700 * 1024;

// Only the two categories that make sense for a guardian's paperwork —
// FamilyDocument.category has no "Legal" option (that's VaultCategory, a
// different type for the shared Document Vault), so custody/guardianship
// papers file under 'Other' here rather than a category that doesn't exist.
const DOC_KINDS: { value: FamilyDocument['category']; label: string }[] = [
  { value: 'ID', label: 'ID copy' },
  { value: 'Other', label: 'Custody / guardianship paper' },
];

const todayLocal = () => new Date().toLocaleDateString('en-CA');

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface MemberGuardiansProps {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
}

export default function MemberGuardians({ member, onUpdate }: MemberGuardiansProps) {
  const [records, setRecords] = useState<NonResidentGuardian[]>(() => member.nonResidentGuardians || []);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ doc: FamilyDocument; guardianName: string } | null>(null);

  // Reset local state when the selected member changes.
  useEffect(() => {
    setRecords(member.nonResidentGuardians || []);
    setAdding(false);
    setEditId(null);
  }, [member.id]);

  const persist = (next: NonResidentGuardian[]) => {
    setRecords(next);
    onUpdate({ nonResidentGuardians: next });
  };

  const handleSave = (rec: NonResidentGuardian) => {
    const exists = records.find((r) => r.id === rec.id);
    persist(exists ? records.map((r) => (r.id === rec.id ? rec : r)) : [...records, rec]);
    setAdding(false);
    setEditId(null);
  };

  const handleDelete = (rec: NonResidentGuardian) => {
    persist(records.filter((r) => r.id !== rec.id));
  };

  const handleAddDocument = (guardianId: string, doc: FamilyDocument) => {
    persist(records.map((r) => (r.id === guardianId ? { ...r, documents: [...r.documents, doc] } : r)));
  };

  const handleDeleteDocument = (guardianId: string, docId: string) => {
    persist(records.map((r) => (r.id === guardianId ? { ...r, documents: r.documents.filter((d) => d.id !== docId) } : r)));
  };

  const firstName = member.name.split(/\s+/)[0] || member.name;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
          <span className="w-1.5 h-3.5 bg-ink-800 rounded-full inline-block"></span>
          Guardians
        </h3>
        {!adding && (
          <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>
      <p className="text-[12.5px] text-ink-400 -mt-2">
        A parent or guardian who doesn&apos;t live with {firstName} — contact details, plus any custody or guardianship papers.
      </p>

      <div className="card p-5 space-y-4">
        {adding && (
          <GuardianForm onSave={handleSave} onCancel={() => setAdding(false)} />
        )}

        {records.length === 0 && !adding ? (
          <div className="py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-clay-50 text-clay-600 mb-3">
              <UserRoundCheck className="w-5 h-5" />
            </div>
            <p className="text-[13px] text-ink-400">No non-resident guardians on file — add contact details and any custody papers.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {records.map((rec) => (
              editId === rec.id ? (
                <div key={rec.id}>
                  <GuardianForm initial={rec} onSave={handleSave} onCancel={() => setEditId(null)} />
                </div>
              ) : (
                <div key={rec.id}>
                  <GuardianRow
                    rec={rec}
                    onEdit={() => { setEditId(rec.id); setAdding(false); }}
                    onDelete={() => handleDelete(rec)}
                    onAddDocument={(doc) => handleAddDocument(rec.id, doc)}
                    onDeleteDocument={(docId) => handleDeleteDocument(rec.id, docId)}
                    onViewDocument={(doc) => setPreviewDoc({ doc, guardianName: rec.name })}
                  />
                </div>
              )
            ))}
          </div>
        )}
      </div>

      {previewDoc && (
        <DocumentPreview
          doc={previewDoc.doc}
          guardianName={previewDoc.guardianName}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </section>
  );
}

/* ---------------- Row ---------------- */

function GuardianRow({
  rec, onEdit, onDelete, onAddDocument, onDeleteDocument, onViewDocument,
}: {
  rec: NonResidentGuardian;
  onEdit: () => void;
  onDelete: () => void;
  onAddDocument: (doc: FamilyDocument) => void;
  onDeleteDocument: (docId: string) => void;
  onViewDocument: (doc: FamilyDocument) => void;
}) {
  const relationshipLabel = rec.relationship === 'Other' && rec.relationshipOther ? rec.relationshipOther : rec.relationship;

  return (
    <div className="p-3.5 rounded-2xl border border-cream-200 bg-white space-y-3 hover:bg-cream-50 hover:border-cream-300 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`chip ${RELATIONSHIP_CHIP[rec.relationship]}`}>{relationshipLabel}</span>
          </div>
          <p className="text-[14px] font-semibold text-ink-900 truncate">{rec.name}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-500">
            {rec.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{rec.phone}</span>}
            {rec.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{rec.email}</span>}
            {rec.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{rec.address}</span>}
          </div>
          {rec.notes && <p className="text-[12px] text-ink-400 italic">{rec.notes}</p>}
        </div>

        <div className="flex items-center gap-1 shrink-0 self-start">
          <button onClick={onEdit} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <ConfirmDeleteButton
            onConfirm={onDelete}
            ariaLabel={`Delete ${rec.name}`}
            hint={`Removes ${rec.name} and any attached documents from this profile. This can't be undone.`}
          />
        </div>
      </div>

      <GuardianDocuments
        guardian={rec}
        onAddDocument={onAddDocument}
        onDeleteDocument={onDeleteDocument}
        onViewDocument={onViewDocument}
      />
    </div>
  );
}

/* ---------------- Documents (per guardian) ----------------
 * Same inline-base64 + duplicate-check pattern MemberDocuments.tsx uses for
 * the main documents list, scoped to just this one guardian's own files. */

function GuardianDocuments({
  guardian, onAddDocument, onDeleteDocument, onViewDocument,
}: {
  guardian: NonResidentGuardian;
  onAddDocument: (doc: FamilyDocument) => void;
  onDeleteDocument: (docId: string) => void;
  onViewDocument: (doc: FamilyDocument) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [docKind, setDocKind] = useState<FamilyDocument['category']>('ID');
  const [pending, setPending] = useState<{ data: string; name: string; type: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<DupMatch<FamilyDocument> | null>(null);
  const [pendingHash, setPendingHash] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setDuplicateMatch(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is ${formatBytes(file.size)} — files must be under 700 KB.`);
      return;
    }
    fileToDataUrl(file).then((data) => {
      setPending({ data, name: file.name, type: file.type, size: file.size });
    }).catch(() => setError('Failed to read the file. Try a different format.'));
    e.target.value = '';
  };

  const doSave = (hash: string) => {
    if (!pending) return;
    const doc: FamilyDocument = {
      id: 'doc-' + Date.now().toString(),
      name: pending.name,
      category: docKind,
      fileType: pending.type,
      fileName: pending.name,
      fileSize: pending.size,
      uploadedAt: todayLocal(),
      fileData: pending.data,
      contentHash: hash,
    };
    onAddDocument(doc);
    setPending(null);
    setDuplicateMatch(null);
    setPendingHash('');
  };

  const handleUpload = async () => {
    if (!pending) return;
    setUploading(true);
    setError(null);
    try {
      const hash = await hashDataUrl(pending.data);
      if (!duplicateMatch) {
        const match = findLikelyDuplicate({ fileName: pending.name, fileSize: pending.size, contentHash: hash }, guardian.documents);
        if (match) {
          setDuplicateMatch(match);
          setPendingHash(hash);
          return; // wait for the user to confirm or cancel
        }
      }
      doSave(hash);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="pt-3 border-t border-cream-100 space-y-2.5">
      <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-wide">Documents</p>

      {guardian.documents.length > 0 && (
        <div className="space-y-1.5">
          {guardian.documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2.5 p-2 rounded-xl bg-cream-50 border border-cream-200">
              <button type="button" onClick={() => onViewDocument(doc)} className="shrink-0">
                {doc.fileType === 'application/pdf' ? (
                  <PdfThumbnail src={doc.fileData || ''} size="w-9 h-9" />
                ) : doc.fileType.startsWith('image/') && doc.fileData ? (
                  <img src={doc.fileData} alt="" className="w-9 h-9 rounded-lg object-cover border border-cream-200" />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-cream-200 text-ink-500 flex items-center justify-center">
                    <FileText className="w-4 h-4" />
                  </div>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-ink-800 truncate">{doc.name}</p>
                <p className="text-[11px] text-ink-400">{doc.category === 'ID' ? 'ID copy' : 'Custody / guardianship paper'} · {formatBytes(doc.fileSize)}</p>
              </div>
              <ConfirmDeleteButton
                onConfirm={() => onDeleteDocument(doc.id)}
                ariaLabel={`Delete "${doc.name}"`}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      )}

      {pending ? (
        <div className="p-2.5 rounded-xl bg-clay-50/60 border border-clay-200 space-y-2">
          <p className="text-[12px] text-ink-600 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-ink-400 shrink-0" /> {pending.name} ({formatBytes(pending.size)})
          </p>
          <div className="flex gap-1.5">
            {DOC_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setDocKind(k.value)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                  docKind === k.value ? 'bg-ink-800 text-white' : 'bg-white text-ink-600 border border-cream-300 hover:bg-cream-100'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          {duplicateMatch && (
            <div className="p-2 rounded-lg bg-honey-50 border border-honey-200 text-[11.5px] text-honey-800 space-y-1.5">
              <p className="flex items-start gap-1.5 leading-normal">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>This looks like it&apos;s already saved as &ldquo;{duplicateMatch.doc.name}&rdquo;.</span>
              </p>
              <div className="flex gap-1.5">
                <button type="button" onClick={handleUpload} disabled={uploading} className="btn-primary text-[11px] px-2.5 py-1 flex-1 justify-center disabled:opacity-50">
                  {uploading ? 'Saving…' : 'Save anyway'}
                </button>
                <button type="button" onClick={() => { setDuplicateMatch(null); setPending(null); }} disabled={uploading} className="btn-quiet text-[11px] px-2.5 py-1 flex-1 justify-center disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!duplicateMatch && (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setPending(null); setError(null); }} className="btn-quiet text-[11px] px-2.5 py-1">Cancel</button>
              <button type="button" onClick={handleUpload} disabled={uploading} className="btn-primary text-[11px] px-2.5 py-1 disabled:opacity-50">
                {uploading ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <label className="btn-quiet text-[11.5px] px-2.5 py-1.5 cursor-pointer inline-flex">
          <Upload className="w-3.5 h-3.5" />
          <span>Add ID copy or legal document</span>
          <input type="file" accept="image/*,application/pdf" onChange={handleFileChange} className="hidden" />
        </label>
      )}

      {error && (
        <div className="p-2 rounded-lg bg-rosa-50 border border-rosa-100 text-[11.5px] text-rosa-700 flex items-start gap-1.5 leading-normal">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rosa-500" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Add / edit form ---------------- */

function GuardianForm({
  initial, onSave, onCancel,
}: {
  initial?: NonResidentGuardian;
  onSave: (rec: NonResidentGuardian) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [relationship, setRelationship] = useState<GuardianRelationship>(initial?.relationship || 'Parent');
  const [relationshipOther, setRelationshipOther] = useState(initial?.relationshipOther || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter a name.'); return; }
    if (relationship === 'Other' && !relationshipOther.trim()) { setError('Please describe the relationship.'); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      relationship,
      relationshipOther: relationship === 'Other' ? relationshipOther.trim() : undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      notes: notes.trim() || undefined,
      documents: initial?.documents || [],
      createdAt: initial?.createdAt || new Date().toISOString(),
    });
  };

  return (
    <div className="p-4 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-3">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Name</label>
            <input className="field" placeholder="e.g. Alex Müller" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Relationship</label>
            <select className="field" value={relationship} onChange={(e) => setRelationship(e.target.value as GuardianRelationship)}>
              {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {relationship === 'Other' && (
              <input
                className="field mt-2"
                placeholder="Describe the relationship"
                value={relationshipOther}
                onChange={(e) => setRelationshipOther(e.target.value)}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Phone</label>
            <input className="field" placeholder="+43 …" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Email</label>
            <input type="email" className="field" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="field-label">Address</label>
          <input className="field" placeholder="Where they live" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div>
          <label className="field-label">Notes</label>
          <textarea
            rows={2}
            className="field font-sans"
            placeholder="e.g. Alternate weekends, collects from school on Fridays, court order ref. 2024/1123"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2 leading-normal">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1 border-t border-cream-200">
          <button type="button" onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button type="submit" className="btn-primary text-xs px-3 py-1.5">
            <Check className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Document preview ---------------- */

function DocumentPreview({ doc, guardianName, onClose }: { doc: FamilyDocument; guardianName: string; onClose: () => void }) {
  // Parent (MemberGuardians, above) conditionally mounts this, so the lock is
  // unconditional for this component's whole lifetime — same pattern as
  // MemberReferrals.tsx's ReferralPreview.
  useBodyScrollLock(true);

  const isPdf = doc.fileType === 'application/pdf';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div onClick={onClose} className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-2xl card rounded-3xl overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="p-4 border-b border-cream-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-900 truncate">{doc.name}</p>
            <p className="text-[12px] text-ink-400">{guardianName}&apos;s guardian record</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-xl" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-cream-100 flex items-center justify-center p-4">
          {isPdf ? (
            <iframe src={doc.fileData} title={doc.fileName} className="w-full h-[70dvh] border-0 rounded-xl bg-white" />
          ) : (
            <img src={doc.fileData} alt={doc.fileName} className="max-w-full max-h-[70dvh] object-contain rounded-xl" />
          )}
        </div>
        <div className="p-4 border-t border-cream-200 flex items-center justify-end gap-3">
          {doc.fileData && (
            <a href={doc.fileData} download={doc.fileName} className="btn-quiet shrink-0">
              <ExternalLink className="w-3.5 h-3.5" /> Open full size
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
