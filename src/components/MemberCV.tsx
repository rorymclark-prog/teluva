import { useEffect, useRef, useState } from 'react';
import { FamilyMember, FamilyDocument, CvRole, CvEducationEntry, CvQualification, MemberCv } from '../types';
import { uploadVaultFile } from '../utils/db';
import { isDemoMode } from '../utils/demoData';
import { todayISO } from '../utils/age';
import { appConfirm } from '../utils/appConfirm';
import { qualificationExpiryStatus } from '../utils/qualificationExpiry';
import {
  Briefcase, Plus, Trash2, Pencil, Check, X, Building2, GraduationCap, Award,
  Languages, Tags, Upload, FileText, Eye, RefreshCcw, AlertCircle, FileImage,
} from 'lucide-react';
import PdfThumbnail from './PdfThumbnail';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import EmptyState from './EmptyState';

const newId = () => 'cv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Family files live in Storage. Business CVs stay inside their access-controlled
// member record: the shared space bucket does not enforce employee ownership.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface Props {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
  onViewDocument: (doc: FamilyDocument, memberName: string) => void;
  canEdit?: boolean;
  onBuildTimeline?: () => void;
  isBusinessSpace?: boolean;
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
  const status = qualificationExpiryStatus(expiryDate);
  if (status === 'expired') return <span className="chip bg-rosa-100 text-rosa-700">Expired</span>;
  if (status === 'soon') return <span className="chip bg-honey-100 text-honey-700">Expires soon</span>;
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
        {values.length === 0 && <EmptyState size="sm" title="None added yet" />}
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

export default function MemberCV({ member, onUpdate, onViewDocument, canEdit = false, onBuildTimeline, isBusinessSpace = false }: Props) {
  const uploadLimit = isBusinessSpace ? 700*1024 : MAX_UPLOAD_BYTES;
  const uploadLimitLabel = isBusinessSpace ? '700 KB' : '20 MB';
  const cv: MemberCv = member.cv || {};
  const latest = useRef(member);
  latest.current = member;
  const first = member.name.split(/\s+/)[0] || member.name;

  const [summary, setSummary] = useState(cv.summary || '');
  const [addingRole, setAddingRole] = useState(false);
  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [addingEdu, setAddingEdu] = useState(false);
  const [editEduId, setEditEduId] = useState<string | null>(null);
  const [addingQual, setAddingQual] = useState(false);
  const [editQualId, setEditQualId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadingWork, setUploadingWork] = useState(false);
  const workFileInputRef = useRef<HTMLInputElement>(null);
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

  const workDocuments = (member.documents || []).filter(d => cv.workDocumentIds?.includes(d.id));
  const uploadWorkDocument = async (file: File) => {
    if (!canEdit || uploadingWork) return;
    if (file.size >= uploadLimit) {setFileError(`Choose a file smaller than ${uploadLimitLabel}.`);return;}
    if (!/\.(pdf|docx|txt|jpg|jpeg|png|webp)$/i.test(file.name)) {setFileError('Choose a PDF, Word, text or image document.');return;}
    setUploadingWork(true);setFileError(null);
    try {
      const id = 'work-' + newId();
      const stored = (isDemoMode() || isBusinessSpace) ? {storagePath:'',downloadUrl:await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('Could not read file'));r.readAsDataURL(file);})} : await uploadVaultFile(file,id);
      const document:FamilyDocument = {id,name:file.name,category:'Other',fileName:file.name,fileType:file.type || 'application/octet-stream',fileSize:file.size,uploadedAt:todayISO(),fileData:stored.downloadUrl,storagePath:stored.storagePath};
      if (latest.current.id !== member.id) throw new Error('Profile changed during upload. Please reopen the original profile.');
      await onUpdate({documents:[...(latest.current.documents || []),document],cv:{...latest.current.cv,workDocumentIds:[...(latest.current.cv?.workDocumentIds || []),id]}});
    } catch(e) {setFileError(e instanceof Error ? e.message : 'Could not save this document.');}
    finally {setUploadingWork(false);if(workFileInputRef.current) workFileInputRef.current.value='';}
  };

  /* CV file (single slot, pointed to by cv.fileDocumentId, stored in member.documents) */
  const cvFile = (member.documents || []).find(d => d.id === cv.fileDocumentId);

  const triggerUpload = () => { if (!uploadingWork) fileInputRef.current?.click(); };

  const handleFile = async (file: File) => {
    if (!canEdit || uploadingWork) return;
    setFileError(null);
    if (file.size >= uploadLimit) {setFileError(`Choose a CV smaller than ${uploadLimitLabel}.`);return;}
    if (!/\.(pdf|docx|txt|jpg|jpeg|png|webp)$/i.test(file.name)) {setFileError('Choose a PDF, Word, text or image CV.');return;}
    setUploadingWork(true);
    try {
      const id = 'doc-' + newId();
      const stored = (isDemoMode() || isBusinessSpace) ? {storagePath:'',downloadUrl:await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('Could not read file'));r.readAsDataURL(file);})} : await uploadVaultFile(file,id);
      const newDoc:FamilyDocument = {id,name:`${member.name}'s CV`,category:'Other',fileName:file.name,fileType:file.type || 'application/octet-stream',fileSize:file.size,uploadedAt:todayISO(),fileData:stored.downloadUrl,storagePath:stored.storagePath};
      if (latest.current.id !== member.id) throw new Error('Profile changed during upload. Please reopen the original profile.');
      await onUpdate({documents:[...(latest.current.documents || []),newDoc],cv:{...latest.current.cv,fileDocumentId:id}});
    } catch(e) {setFileError(e instanceof Error ? e.message : 'Could not save CV.');}
    finally {setUploadingWork(false);if(fileInputRef.current) fileInputRef.current.value='';}
  };

  const removeFile = async () => {
    if (!cvFile) return;
    if (!(await appConfirm('Remove the filed CV? This deletes the stored file (the roles/education/skills below are kept).', { danger: true, confirmLabel: 'Remove' }))) return;
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
          <h3 className="font-display text-lg font-semibold text-ink-900">Work & CV</h3>
          <p className="text-[13px] text-ink-500 mt-0.5">
            {first}'s roles, projects, CV and work documents.
          </p>
        </div>
      </div>

      {canEdit && onBuildTimeline && <button type="button" className="btn-primary text-sm" onClick={onBuildTimeline}>Build my timeline from a CV or saved documents</button>}
      <section className="card p-5 space-y-3" aria-label="Work documents">
        <h4 className="font-semibold">Work documents</h4>
        <p className="text-xs text-ink-500">Keep contracts, references, project records and supporting files together. They also remain in Documents.</p>
        {workDocuments.map(doc=><div key={doc.id} className="flex gap-2 items-center"><button type="button" className="btn-quiet text-sm" onClick={()=>onViewDocument(doc,member.name)}><FileText className="w-4 h-4"/>{doc.name}</button>{canEdit && <button type="button" className="btn-quiet text-xs" onClick={()=>patchCv({...cv,workDocumentIds:cv.workDocumentIds?.filter(id=>id!==doc.id)})}>Unlink from Work</button>}</div>)}
        {canEdit && <><label className="field-label">Link a saved document<select className="field" value="" disabled={uploadingWork} onChange={e=>{if(e.target.value) patchCv({...cv,workDocumentIds:[...(cv.workDocumentIds || []),e.target.value]});}}><option value="">Choose a document…</option>{(member.documents || []).filter(d=>!cv.workDocumentIds?.includes(d.id)).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <input ref={workFileInputRef} type="file" className="hidden" accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp" onChange={e=>{const f=e.target.files?.[0];if(f) void uploadWorkDocument(f);}}/>
        <button type="button" className="btn-quiet text-sm" disabled={uploadingWork} onClick={()=>workFileInputRef.current?.click()}>{uploadingWork?'Saving document…':'Upload work document'}</button></>}
        {fileError && <p role="alert" className="text-sm text-rosa-700">{fileError}</p>}
      </section>

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
              <p className="text-[12px] text-ink-400 mt-1">PDF, Word, text or image — max {uploadLimitLabel}</p>
            </div>
          </div>
        ) : (
          <EmptyState icon={FileImage} title="No CV filed yet" dashed />
        )}
        <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.jpg,.jpeg,.png,.webp" className="hidden"
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
          <EmptyState size="sm" title="No previous roles added yet." />
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
                    <ConfirmDeleteButton onConfirm={() => deleteRole(r.id)} ariaLabel={`Delete ${r.title || "this role"}`} />
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
          <EmptyState size="sm" title="No education added yet." />
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
                    <ConfirmDeleteButton onConfirm={() => deleteEdu(e.id)} ariaLabel={`Delete ${e.qualification || e.institution || "this entry"}`} />
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
          <EmptyState size="sm" title="No certificates or qualifications added yet." />
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
                    <ConfirmDeleteButton onConfirm={() => deleteQual(q.id)} ariaLabel={`Delete ${q.name || "this certificate"}`} />
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
