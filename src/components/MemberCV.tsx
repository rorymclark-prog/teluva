import { useEffect, useRef, useState } from 'react';
import { FamilyMember, FamilyDocument, CvRole, CvEducationEntry, CvQualification, MemberCv } from '../types';
import { todayISO } from '../utils/age';
import {
  Briefcase, Plus, Trash2, Pencil, Check, X, Building2, GraduationCap, Award,
  Languages, Tags, Upload, FileText, Eye, RefreshCcw, AlertCircle, FileImage,
} from 'lucide-react';
import PdfThumbnail from './PdfThumbnail';

const newId = () => 'cv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Files are stored inline as base64 inside the member's own Firestore document
// (same convention MemberDocuments.tsx already established — 700 KB keeps
// comfortably under the 1 MB per-document cap).
const MAX_UPLOAD_BYTES = 700 * 1024;

interface Props {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
  onViewDocument: (doc: FamilyDocument, memberName: string) => void;
  canEdit?: boolean;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const fmtDate = (d?: string) => {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

function ExpiryChip({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return null;
  const diffDays = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return <span className="chip bg-rosa-100 text-rosa-700">Expired</span>;
  if (diffDays / 30.4375 <= 2) return <span className="chip bg-honey-100 text-honey-700">Expires soon</span>;
  return <span className="chip bg-sage-100 text-sage-700">Valid</span>;
}

/* ---- Role form (add / edit) ---- */
function RoleForm({ initial, onSave, onCancel }: { initial?: CvRole; onSave: (r: CvRole) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [employer, setEmployer] = useState(initial?.employer || '');
  const [startDate, setStartDate] = useState(initial?.startDate || '');
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [current, setCurrent] = useState(!!initial?.current);
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!title.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      title: title.trim(),
      employer: employer.trim() || undefined,
      startDate: startDate || undefined,
      endDate: current ? undefined : (endDate || undefined),
      current: current || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="Job title (e.g. Site Supervisor)" value={title} onChange={e => setTitle(e.target.value)} />
      <input className="field" placeholder="Employer — optional" value={employer} onChange={e => setEmployer(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Start date</label>
          <input type="date" className="field" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">End date</label>
          <input type="date" className="field" value={endDate} disabled={current} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={current} onChange={e => setCurrent(e.target.checked)} className="rounded border-cream-300 text-clay-500 focus:ring-clay-400 w-4 h-4 cursor-pointer" />
        <span className="text-[13px] font-medium text-ink-700">Current role</span>
      </label>
      <input className="field" placeholder="Notes — optional" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

/* ---- Education form (add / edit) ---- */
function EducationForm({ initial, onSave, onCancel }: { initial?: CvEducationEntry; onSave: (e: CvEducationEntry) => void; onCancel: () => void }) {
  const [institution, setInstitution] = useState(initial?.institution || '');
  const [qualification, setQualification] = useState(initial?.qualification || '');
  const [fieldOfStudy, setFieldOfStudy] = useState(initial?.fieldOfStudy || '');
  const [startDate, setStartDate] = useState(initial?.startDate || '');
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!institution.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      institution: institution.trim(),
      qualification: qualification.trim() || undefined,
      fieldOfStudy: fieldOfStudy.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="Institution / school" value={institution} onChange={e => setInstitution(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input className="field" placeholder="Qualification (e.g. BSc, Matric)" value={qualification} onChange={e => setQualification(e.target.value)} />
        <input className="field" placeholder="Field of study — optional" value={fieldOfStudy} onChange={e => setFieldOfStudy(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Start date</label>
          <input type="date" className="field" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">End date</label>
          <input type="date" className="field" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>
      <input className="field" placeholder="Notes — optional" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

/* ---- Qualification form (add / edit) — the one with an expiry that nudges ---- */
function QualificationForm({ initial, onSave, onCancel }: { initial?: CvQualification; onSave: (q: CvQualification) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [issuer, setIssuer] = useState(initial?.issuer || '');
  const [issueDate, setIssueDate] = useState(initial?.issueDate || '');
  const [expiryDate, setExpiryDate] = useState(initial?.expiryDate || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!name.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      issuer: issuer.trim() || undefined,
      issueDate: issueDate || undefined,
      expiryDate: expiryDate || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="Qualification / certificate (e.g. First Aid Certificate)" value={name} onChange={e => setName(e.target.value)} />
      <input className="field" placeholder="Issued by — optional" value={issuer} onChange={e => setIssuer(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Issue date</label>
          <input type="date" className="field" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Expiry date — optional</label>
          <input type="date" className="field" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
        </div>
      </div>
      <input className="field" placeholder="Notes — optional" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

/* ---- Simple tag editor for Skills / Languages ---- */
function TagEditor({ values, onChange, placeholder, canEdit }: { values: string[]; onChange: (next: string[]) => void; placeholder: string; canEdit: boolean }) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const parts = draft.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) {
      if (!next.some(v => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft('');
  };

  const remove = (v: string) => onChange(values.filter(x => x !== v));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && <span className="text-[13px] text-ink-400">None added yet</span>}
        {values.map(v => (
          <span key={v} className="chip bg-cream-200 text-ink-700 flex items-center gap-1">
            {v}
            {canEdit && (
              <button type="button" onClick={() => remove(v)} className="hover:text-rosa-600 cursor-pointer" title={`Remove ${v}`}>
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <input
            className="field flex-1"
            placeholder={placeholder}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          />
          <button type="button" onClick={commit} disabled={!draft.trim()} className="btn-quiet text-xs px-3 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      )}
    </div>
  );
}

export default function MemberCV({ member, onUpdate, onViewDocument, canEdit = false }: Props) {
  const cv: MemberCv = member.cv || {};
  const first = member.name.split(/\s+/)[0] || member.name;

  const [summary, setSummary] = useState(cv.summary || '');
  const [addingRole, setAddingRole] = useState(false);
  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [addingEdu, setAddingEdu] = useState(false);
  const [editEduId, setEditEduId] = useState<string | null>(null);
  const [addingQual, setAddingQual] = useState(false);
  const [editQualId, setEditQualId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSummary(member.cv?.summary || '');
    setAddingRole(false); setEditRoleId(null);
    setAddingEdu(false); setEditEduId(null);
    setAddingQual(false); setEditQualId(null);
    setFileError(null);
  }, [member.id]);

  const patchCv = (next: MemberCv) => onUpdate({ cv: next });

  /* Roles */
  const roles = cv.roles || [];
  const saveRole = (r: CvRole) => {
    const exists = roles.find(x => x.id === r.id);
    const next = exists ? roles.map(x => x.id === r.id ? r : x) : [...roles, r];
    patchCv({ ...cv, roles: next });
    setAddingRole(false); setEditRoleId(null);
  };
  const deleteRole = (id: string) => patchCv({ ...cv, roles: roles.filter(r => r.id !== id) });

  /* Education */
  const education = cv.education || [];
  const saveEdu = (e: CvEducationEntry) => {
    const exists = education.find(x => x.id === e.id);
    const next = exists ? education.map(x => x.id === e.id ? e : x) : [...education, e];
    patchCv({ ...cv, education: next });
    setAddingEdu(false); setEditEduId(null);
  };
  const deleteEdu = (id: string) => patchCv({ ...cv, education: education.filter(e => e.id !== id) });

  /* Qualifications */
  const qualifications = cv.qualifications || [];
  const saveQual = (q: CvQualification) => {
    const exists = qualifications.find(x => x.id === q.id);
    const next = exists ? qualifications.map(x => x.id === q.id ? q : x) : [...qualifications, q];
    patchCv({ ...cv, qualifications: next });
    setAddingQual(false); setEditQualId(null);
  };
  const deleteQual = (id: string) => patchCv({ ...cv, qualifications: qualifications.filter(q => q.id !== id) });

  /* Skills / languages */
  const skills = cv.skills || [];
  const languages = cv.languages || [];

  /* CV file (single slot, pointed to by cv.fileDocumentId, stored in member.documents) */
  const cvFile = (member.documents || []).find(d => d.id === cv.fileDocumentId);

  const triggerUpload = () => fileInputRef.current?.click();

  const handleFile = (file: File) => {
    setFileError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(`"${file.name}" is ${formatBytes(file.size)} — too large for cloud sync. Files must be under 700 KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result !== 'string') return;
      const newDoc: FamilyDocument = {
        id: 'doc-' + newId(),
        name: `${member.name}'s CV`,
        category: 'Other',
        fileType: file.type,
        fileName: file.name,
        fileSize: file.size,
        uploadedAt: todayISO(),
        fileData: ev.target.result,
      };
      // One combined patch — swap the old CV document out and the new one in,
      // and repoint cv.fileDocumentId, all in a single write (avoids a
      // separate add+delete+patch race across three calls).
      const nextDocs = (member.documents || []).filter(d => d.id !== cv.fileDocumentId);
      nextDocs.push(newDoc);
      onUpdate({ documents: nextDocs, cv: { ...cv, fileDocumentId: newDoc.id } });
    };
    reader.onerror = () => setFileError('Failed to read the file. Try a different format.');
    reader.readAsDataURL(file);
  };

  const removeFile = () => {
    if (!cvFile) return;
    if (!window.confirm('Remove the filed CV? This deletes the stored file (the roles/education/skills below are kept).')) return;
    const nextDocs = (member.documents || []).filter(d => d.id !== cv.fileDocumentId);
    onUpdate({ documents: nextDocs, cv: { ...cv, fileDocumentId: undefined } });
  };

  const hasCurrentRole = member.employer || member.jobTitle || member.workPhone || member.workAddress;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-cream-200">
        <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
          <Briefcase className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold text-ink-900">CV / résumé</h3>
          <p className="text-[13px] text-ink-500 mt-0.5">
            {first}'s career history, qualifications and filed CV — searchable by the team assistant.
          </p>
        </div>
      </div>

      {/* Current role — read-only, sourced from the profile (v111 fields). Editing lives in the member's Edit form, not duplicated here. */}
      {hasCurrentRole && (
        <div className="p-3.5 rounded-2xl bg-cream-100 border border-cream-300 flex items-start gap-3">
          <Building2 className="w-4 h-4 text-ink-400 shrink-0 mt-0.5" />
          <div className="min-w-0 text-[13px] text-ink-700 space-y-0.5">
            <p className="font-semibold text-ink-900">
              {member.jobTitle || 'Current role'}{member.employer ? ` at ${member.employer}` : ''}
            </p>
            {member.workPhone && <p className="text-ink-500">{member.workPhone}</p>}
            {member.workAddress && <p className="text-ink-500">{member.workAddress}</p>}
            <p className="text-[11px] text-ink-400 mt-1">From {first}'s profile — edit there to change it.</p>
          </div>
        </div>
      )}

      {/* CV file */}
      <section className="card p-5 space-y-3">
        <h4 className="section-label flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Filed CV
        </h4>
        {cvFile ? (
          <div className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-center gap-3">
            {cvFile.fileType.startsWith('image/') && cvFile.fileData ? (
              <img src={cvFile.fileData} alt="" className="w-14 h-14 rounded-xl object-cover border border-cream-200 shrink-0" />
            ) : cvFile.fileType === 'application/pdf' && cvFile.fileData ? (
              <PdfThumbnail src={cvFile.fileData} size="w-14 h-14" />
            ) : (
              <div className="w-14 h-14 bg-cream-100 border border-cream-200 rounded-xl text-ink-500 shrink-0 flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-900 truncate">{cvFile.fileName}</p>
              <p className="text-[12px] text-ink-400 tabular-nums">{formatBytes(cvFile.fileSize)} &bull; uploaded {cvFile.uploadedAt}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => onViewDocument(cvFile, member.name)} className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl" title="View">
                <Eye className="w-4 h-4" />
              </button>
              {canEdit && (
                <>
                  <button type="button" onClick={triggerUpload} className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl" title="Replace">
                    <RefreshCcw className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={removeFile} className="p-1.5 text-ink-400 hover:text-rosa-700 hover:bg-rosa-50 rounded-xl" title="Remove">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ) : canEdit ? (
          <div onClick={triggerUpload} className="border-2 border-dashed border-cream-300 bg-white hover:border-cream-400 rounded-2xl p-5 text-center cursor-pointer transition-all">
            <div className="flex flex-col items-center">
              <Upload className="w-6 h-6 mb-2 text-ink-400" />
              <p className="text-[13px] font-semibold text-ink-700">Upload {first}'s CV</p>
              <p className="text-[12px] text-ink-400 mt-1">Image or PDF — max 700 KB</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 px-4 rounded-2xl border border-dashed border-cream-300 bg-clay-50">
            <FileImage className="w-6 h-6 mx-auto mb-2 text-clay-500" />
            <p className="text-[13px] text-clay-700">No CV filed yet</p>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ''; }} />
        {fileError && (
          <div className="p-3 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
            <span>{fileError}</span>
          </div>
        )}
      </section>

      {/* Summary */}
      <div>
        <label className="field-label">Summary — optional</label>
        <textarea
          rows={3}
          className="field font-sans"
          placeholder={`A short professional summary for ${first}`}
          value={summary}
          onChange={e => setSummary(e.target.value)}
          onBlur={e => patchCv({ ...cv, summary: e.target.value.trim() || undefined })}
          disabled={!canEdit}
        />
      </div>

      {/* Roles */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Career history</h4>
          {canEdit && (
            <button onClick={() => { setAddingRole(true); setEditRoleId(null); }} className="btn-primary text-xs px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
        {addingRole && <RoleForm onSave={saveRole} onCancel={() => setAddingRole(false)} />}
        {roles.length === 0 && !addingRole ? (
          <p className="text-[13px] text-ink-400 text-center py-6">No previous roles added yet.</p>
        ) : (
          <div className="space-y-2.5">
            {roles.map(r => editRoleId === r.id ? (
              <div key={r.id}><RoleForm initial={r} onSave={saveRole} onCancel={() => setEditRoleId(null)} /></div>
            ) : (
              <div key={r.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[14px] font-semibold text-ink-900">
                    {r.title}{r.employer ? ` · ${r.employer}` : ''}
                    {r.current && <span className="chip bg-sage-100 text-sage-700 ml-2">Current</span>}
                  </p>
                  {(r.startDate || r.endDate || r.current) && (
                    <p className="text-[12px] text-ink-500 tabular-nums">
                      {fmtDate(r.startDate) || '—'} – {r.current ? 'Present' : (fmtDate(r.endDate) || '—')}
                    </p>
                  )}
                  {r.notes && <p className="text-[12px] text-ink-400">{r.notes}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setEditRoleId(r.id); setAddingRole(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteRole(r.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Education */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> Education</h4>
          {canEdit && (
            <button onClick={() => { setAddingEdu(true); setEditEduId(null); }} className="btn-primary text-xs px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
        {addingEdu && <EducationForm onSave={saveEdu} onCancel={() => setAddingEdu(false)} />}
        {education.length === 0 && !addingEdu ? (
          <p className="text-[13px] text-ink-400 text-center py-6">No education added yet.</p>
        ) : (
          <div className="space-y-2.5">
            {education.map(e => editEduId === e.id ? (
              <div key={e.id}><EducationForm initial={e} onSave={saveEdu} onCancel={() => setEditEduId(null)} /></div>
            ) : (
              <div key={e.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[14px] font-semibold text-ink-900">{e.qualification || e.institution}</p>
                  {e.qualification && <p className="text-[13px] text-ink-600">{e.institution}{e.fieldOfStudy ? ` · ${e.fieldOfStudy}` : ''}</p>}
                  {(e.startDate || e.endDate) && (
                    <p className="text-[12px] text-ink-500 tabular-nums">{fmtDate(e.startDate) || '—'} – {fmtDate(e.endDate) || '—'}</p>
                  )}
                  {e.notes && <p className="text-[12px] text-ink-400">{e.notes}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setEditEduId(e.id); setAddingEdu(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteEdu(e.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Qualifications — the ones with an expiry (first aid, driving licence categories, professional registrations) */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Certificates &amp; qualifications</h4>
          {canEdit && (
            <button onClick={() => { setAddingQual(true); setEditQualId(null); }} className="btn-primary text-xs px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>
        <p className="text-[12px] text-ink-400 -mt-1">
          Add an expiry date on things like a first-aid certificate or a driving-licence category, and it'll show up in Needs Attention before it lapses.
        </p>
        {addingQual && <QualificationForm onSave={saveQual} onCancel={() => setAddingQual(false)} />}
        {qualifications.length === 0 && !addingQual ? (
          <p className="text-[13px] text-ink-400 text-center py-6">No certificates or qualifications added yet.</p>
        ) : (
          <div className="space-y-2.5">
            {qualifications.map(q => editQualId === q.id ? (
              <div key={q.id}><QualificationForm initial={q} onSave={saveQual} onCancel={() => setEditQualId(null)} /></div>
            ) : (
              <div key={q.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold text-ink-900">{q.name}</p>
                    <ExpiryChip expiryDate={q.expiryDate} />
                  </div>
                  {q.issuer && <p className="text-[13px] text-ink-600">{q.issuer}</p>}
                  {q.expiryDate && <p className="text-[12px] text-ink-500 tabular-nums">Expires {fmtDate(q.expiryDate)}</p>}
                  {q.notes && <p className="text-[12px] text-ink-400">{q.notes}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setEditQualId(q.id); setAddingQual(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteQual(q.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Skills & languages */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <section className="card p-5 space-y-3">
          <h4 className="section-label flex items-center gap-1.5"><Tags className="w-3.5 h-3.5" /> Skills</h4>
          <TagEditor values={skills} onChange={next => patchCv({ ...cv, skills: next })} placeholder="e.g. Forklift certified" canEdit={canEdit} />
        </section>
        <section className="card p-5 space-y-3">
          <h4 className="section-label flex items-center gap-1.5"><Languages className="w-3.5 h-3.5" /> Languages</h4>
          <TagEditor values={languages} onChange={next => patchCv({ ...cv, languages: next })} placeholder="e.g. German" canEdit={canEdit} />
        </section>
      </div>
    </div>
  );
}
