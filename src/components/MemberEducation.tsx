import React, { useEffect, useRef, useState } from 'react';
import { Award, BookOpen, FileText, GraduationCap, Loader2, Pencil, Plus, Upload, X } from 'lucide-react';
import type { EducationDetails, EducationDocumentLink, EducationQualification, EducationReport, FamilyDocument, FamilyMember, SchoolYear, VaultDocument } from '../types';
import { educationDocuments, upsertEducationYear, type EducationDocumentOption } from '../utils/education';
import { loadDocuments, uploadVaultFile } from '../utils/db';
import { isDemoMode } from '../utils/demoData';
import { useSharedDoc } from '../hooks/useSharedDoc';
import ConfirmDeleteButton from './ConfirmDeleteButton';

type Field = { options?: string[]; key: string; label: string; required?: boolean; type?: 'date' | 'textarea'; placeholder?: string };
const YEAR_FIELDS: Field[] = [
  { key: 'label', label: 'Academic year', required: true, placeholder: '2026–27' },
  { key: 'schoolName', label: 'School / institution', required: true },
  { key: 'grade', label: 'Class / grade' }, { key: 'teacherName', label: 'Teacher' },
  { key: 'teacherContact', label: 'Teacher contact' }, { key: 'roomNumber', label: 'Room' },
  { key: 'scheduleNotes', label: 'Schedule notes', type: 'textarea' },
  { key: 'staffNotes', label: 'Other teachers / school staff', type: 'textarea', placeholder: 'Names, subjects and contact details' },
  { key: 'notes', label: 'Year notes', type: 'textarea' },
];
const REPORT_FIELDS: Field[] = [
  { key: 'kind', label: 'Record type', options: ['Report', 'Class photo', 'Achievement', 'Project', 'Activity', 'Memory'] },
  { key: 'title', label: 'Title', required: true, placeholder: 'Annual report or parent–teacher meeting' },
  { key: 'term', label: 'Term / semester', placeholder: 'End of year' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'results', label: 'Results', type: 'textarea', placeholder: 'Optional — keep grades as the school records them' },
  { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Teacher feedback, progress or things to follow up' },
];
const QUALIFICATION_FIELDS: Field[] = [
  { key: 'name', label: 'Qualification / course', required: true, placeholder: 'Degree, language course, first aid…' },
  { key: 'issuer', label: 'Institution / issued by' },
  { key: 'issueDate', label: 'Completed / issued', type: 'date' },
  { key: 'expiryDate', label: 'Expiry date (if any)', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
const readFile = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('The file could not be read. Please select it again.'));
  reader.readAsDataURL(file);
});

function EducationForm({ title, fields, initial, initialLinks = [], options, attachments = false, onSave, onCancel }: {
  key?: string; title: string; fields: Field[]; initial: Record<string, string>; initialLinks?: EducationDocumentLink[];
  options: EducationDocumentOption[]; attachments?: boolean;
  onSave: (values: Record<string, string>, links: EducationDocumentLink[], document?: FamilyDocument) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [links, setLinks] = useState(initialLinks);
  const [file, setFile] = useState<File | null>(null);
  const uploaded = useRef<FamilyDocument | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const available = options.filter(o => o.document.name.toLowerCase().includes(search.toLowerCase()));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const clean = Object.fromEntries(fields.map(f => [f.key, (values[f.key] || f.options?.[0] || '').trim()]));
    if (fields.some(f => f.required && !clean[f.key])) { setError('Please fill in the required fields.'); return; }
    if (clean.issueDate && clean.expiryDate && clean.expiryDate < clean.issueDate) {
      setError('Expiry must be on or after the issue date.'); return;
    }
    setError(''); setBusy(true);
    try {
      let doc = uploaded.current;
      if (file && !doc) {
        if (file.size >= 20 * 1024 * 1024) throw new Error('Choose a PDF or image smaller than 20 MB.');
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          throw new Error('Choose a PDF, JPG, PNG or WebP image.');
        }
        const id = crypto.randomUUID();
        const stored = isDemoMode() ? { downloadUrl: await readFile(file), storagePath: '' } : await uploadVaultFile(file, id);
        const fileData = stored.downloadUrl;
        doc = { id, name: clean.title || clean.name || file.name, category: 'Education', fileName: file.name,
          fileType: file.type, fileSize: file.size, storagePath: stored.storagePath, uploadedAt: new Date().toLocaleDateString('en-CA'), fileData };
        uploaded.current = doc;
      }
      const nextLinks = doc ? [...links, { id: `member:${doc.id}`, source: 'member' as const, documentId: doc.id }] : links;
      await onSave(clean, nextLinks, doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this record. Please try again.');
    } finally { setBusy(false); }
  };

  return <form onSubmit={submit} className="rounded-2xl border border-clay-200 bg-clay-50/60 p-4 sm:p-5 space-y-4">
    <h4 className="font-semibold text-ink-900">{title}</h4>
    <fieldset disabled={busy} className="space-y-4 min-w-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(f => <label key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
          <span className="field-label">{f.label}{f.required ? ' *' : ''}</span>
          {f.options ? <select className="field" value={values[f.key] || f.options[0]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}>{f.options.map(option => <option key={option}>{option}</option>)}</select> : f.type === 'textarea' ? <textarea className="field resize-y" rows={3} maxLength={10000} value={values[f.key] || ''}
            onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} />
            : <input className="field" type={f.type || 'text'} required={f.required} maxLength={300}
              value={values[f.key] || ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} />}
        </label>)}
      </div>
      {attachments && <div className="space-y-3">
        <p className="field-label">Documents</p>
        <p className="text-xs text-ink-500">Attach a saved document or upload a report or certificate. Uploads also appear in this person’s Documents.</p>
        <label className="block"><span className="sr-only">Search saved documents</span>
          <input className="field" placeholder="Search saved documents" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {available.map(o => <label key={o.link.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-cream-100 text-sm cursor-pointer">
            <input type="checkbox" checked={links.some(l => l.id === o.link.id)} onChange={e => setLinks(old => e.target.checked
              ? [...old, o.link] : old.filter(l => l.id !== o.link.id))} />
            <span className="min-w-0 break-words">{o.document.name} <span className="text-xs text-ink-400">{o.link.source === 'vault' ? '· Vault' : '· Documents'}</span></span>
          </label>)}
          {!available.length && <p className="text-xs text-ink-500 p-2">No matching saved documents.</p>}
          {links.filter(l => !options.some(o => o.link.id === l.id)).map(l => <label key={l.id} className="flex items-center gap-3 p-2 text-xs text-ink-500">
            <input type="checkbox" checked onChange={() => setLinks(old => old.filter(x => x.id !== l.id))} />
            Unavailable document — uncheck to remove this link
          </label>)}
        </div>
        <label className="block text-sm text-ink-600"><span className="flex items-center gap-2 mb-2"><Upload className="w-4 h-4" /> Upload PDF or image (up to 20 MB)</span>
          <input className="block w-full text-xs" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={e => { setFile(e.target.files?.[0] || null); uploaded.current = undefined; }} />
        </label>
      </div>}
      {error && <p role="alert" className="text-sm text-rosa-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-quiet text-sm"><X className="w-4 h-4" /> Cancel</button>
        <button type="submit" className="btn-primary text-sm">{busy && <Loader2 className="w-4 h-4 animate-spin" />} {busy ? 'Saving…' : 'Save'}</button>
      </div>
    </fieldset>
  </form>;
}

type Editor = { kind: 'year'; year?: SchoolYear } | { kind: 'report'; yearId: string; report?: EducationReport }
  | { kind: 'qualification'; qualification?: EducationQualification };
const valuesFor = (record: object | undefined, fields: Field[]) => Object.fromEntries(fields.map(f => [f.key, String((record as Record<string, unknown> | undefined)?.[f.key] || '')]));
const dateLabel = (date?: string) => date ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

export default function MemberEducation({ member, canEdit, onUpdate, onViewDocument }: {
  key?: string; member: FamilyMember; canEdit: boolean; onUpdate: (patch: Partial<FamilyMember>) => Promise<void>;
  onViewDocument: (document: FamilyDocument, memberName: string) => void;
}) {
  const [section, setSection] = useState<'years' | 'qualifications'>(member.role === 'Child' ? 'years' : 'qualifications');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [vault, setVault] = useState<VaultDocument[]>([]);
  const [vaultError, setVaultError] = useState(false);
  const [selectedYearId, setSelectedYearId] = useState(member.education?.currentYearId || '');
  const latest = useRef(member); latest.current = member;
  const demo = isDemoMode();
  useEffect(() => {
    if (demo) return;
    let active = true;
    loadDocuments().then(d => { if (active) setVault(d); }).catch(() => { if (active) setVaultError(true); });
    return () => { active = false; };
  }, [demo]);
  useSharedDoc<{ docs: VaultDocument[] }>('documents', value => { setVault(value.docs || []); setVaultError(false); }, { disabled: demo });
  const education = member.education || {};
  const years = [...(education.schoolYears || [])].sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }));
  const qualifications = [...(education.qualifications || [])].sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || a.name.localeCompare(b.name));
  const year = years.find(y => y.id === selectedYearId) || years[0];
  const options = educationDocuments(member, vault);

  const save = async (next: EducationDetails, document?: FamilyDocument) => {
    if (!canEdit) return;
    await onUpdate({ education: next, ...(document ? { documents: [...latest.current.documents, document] } : {}) });
  };
  const saveForm = async (values: Record<string, string>, documents: EducationDocumentLink[], document?: FamilyDocument) => {
    if (!editor || !canEdit) return;
    const current = latest.current.education || {};
    if (editor.kind === 'year') {
      const old = current.schoolYears?.find(y => y.id === editor.year?.id);
      const next = { ...old, ...values, id: old?.id || crypto.randomUUID() } as SchoolYear;
      await save(upsertEducationYear(current, next), document);
      setSelectedYearId(next.id);
    } else if (editor.kind === 'report') {
      const target = current.schoolYears?.find(y => y.id === editor.yearId);
      if (!target) throw new Error('This school year is no longer available. Close this form and choose another year.');
      const report = { ...editor.report, ...values, documents, id: editor.report?.id || crypto.randomUUID() } as EducationReport;
      const reports = target.reports || [];
      await save(upsertEducationYear(current, { ...target, reports: reports.some(r => r.id === report.id)
        ? reports.map(r => r.id === report.id ? report : r) : [...reports, report] }), document);
    } else {
      const q = { ...editor.qualification, ...values, documents, id: editor.qualification?.id || crypto.randomUUID() } as EducationQualification;
      const existing = current.qualifications || [];
      await save({ ...current, qualifications: existing.some(x => x.id === q.id) ? existing.map(x => x.id === q.id ? q : x) : [...existing, q] }, document);
    }
    setEditor(null);
  };
  const attached = (links: EducationDocumentLink[] = []) => links.length > 0 && <div className="flex flex-wrap gap-2 mt-3">
    {links.map(link => {
      const option = options.find(o => o.link.id === link.id);
      return option ? <button key={link.id} type="button" disabled={!option.document.fileData} onClick={() => onViewDocument(option.document, member.name)}
        className="btn-quiet text-xs max-w-full"><FileText className="w-4 h-4 shrink-0" /><span className="truncate">{option.document.name}</span></button>
        : <span key={link.id} className="text-xs text-ink-500">Linked document unavailable</span>;
    })}
  </div>;
  const fields = editor?.kind === 'year' ? YEAR_FIELDS : editor?.kind === 'report' ? REPORT_FIELDS : QUALIFICATION_FIELDS;
  const record = editor?.kind === 'year' ? editor.year : editor?.kind === 'report' ? editor.report : editor?.qualification;

  return <div className="space-y-5">
    <div className="rounded-2xl bg-sage-50 border border-sage-100 p-5 sm:p-6">
      <div className="flex items-start gap-3"><GraduationCap className="w-6 h-6 text-sage-700 shrink-0" />
        <div><h3 className="text-lg font-semibold text-ink-900">Education</h3>
          <p className="text-sm text-ink-600 mt-1">School years, reports and qualifications — a learning history for {member.name.split(' ')[0]}.</p>
        </div>
      </div>
      {education.schoolName && <p className="mt-4 text-sm text-ink-700">Current school: <strong>{education.schoolName}</strong>{education.grade && ` · ${education.grade}`}{education.teacherName && ` · ${education.teacherName}`}</p>}
      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" aria-pressed={section === 'years'} disabled={!!editor} onClick={() => setSection('years')}
          className={`tab-pill ${section === 'years' ? 'tab-pill-active' : ''}`}><BookOpen className="w-4 h-4" /> School years · {years.length}</button>
        <button type="button" aria-pressed={section === 'qualifications'} disabled={!!editor} onClick={() => setSection('qualifications')}
          className={`tab-pill ${section === 'qualifications' ? 'tab-pill-active' : ''}`}><Award className="w-4 h-4" /> Qualifications · {qualifications.length}</button>
      </div>
    </div>
    {vaultError && <p role="status" className="text-sm text-ink-500">The shared vault could not be loaded. Profile documents are still available; reopen Education to retry.</p>}
    {editor && canEdit && <EducationForm key={`${editor.kind}-${record?.id || 'new'}`} title={`${record ? 'Edit' : 'Add'} ${editor.kind === 'year' ? 'school year' : editor.kind === 'report' ? 'school record' : editor.kind}`}
      fields={fields} initial={valuesFor(record || (editor.kind === 'year' ? education : undefined), fields)}
      initialLinks={editor.kind === 'year' ? [] : (record as EducationReport | EducationQualification | undefined)?.documents}
      options={options} attachments={editor.kind !== 'year'} onSave={saveForm} onCancel={() => setEditor(null)} />}

    {section === 'years' && <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="section-label">School years</h4>
        {canEdit && !editor && <button type="button" className="btn-primary text-sm" onClick={() => setEditor({ kind: 'year' })}><Plus className="w-4 h-4" /> Add school year</button>}
      </div>
      {!years.length && <div className="card p-6 text-center"><BookOpen className="w-7 h-7 text-sage-600 mx-auto mb-3" />
        <p className="font-medium text-ink-800">Keep each school year together</p><p className="text-sm text-ink-500 mt-2">Add a year to collect reports, teacher details and progress notes. Earlier years stay here as they grow.</p></div>}
      {year && <>
        <label className="block"><span className="field-label">Choose a school year</span>
          <select className="field" value={year.id} disabled={!!editor} onChange={e => setSelectedYearId(e.target.value)}>
            {years.map(y => <option key={y.id} value={y.id}>{y.label} · {y.schoolName}{education.currentYearId === y.id ? ' · Current' : ''}</option>)}
          </select>
        </label>
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-semibold text-sage-700 mb-1">{year.label}{education.currentYearId === year.id ? ' · Current year' : ''}</p>
              <h4 className="text-lg font-semibold text-ink-900 break-words">{year.schoolName}</h4></div>
            {canEdit && !editor && <div className="flex flex-wrap gap-1">
              {education.currentYearId !== year.id && <button type="button" className="btn-quiet text-xs" onClick={() => save(upsertEducationYear(latest.current.education || {}, year, true))}>Set as current</button>}
              <button type="button" className="btn-quiet text-xs" onClick={() => setEditor({ kind: 'year', year })}><Pencil className="w-3.5 h-3.5" /> Edit year</button>
              <ConfirmDeleteButton ariaLabel={`Delete school year ${year.label}`} hint="Removes this year and its report entries. Uploaded documents stay in Documents."
                onConfirm={async () => { const current = latest.current.education || {}; await save({ ...current, schoolYears: (current.schoolYears || []).filter(y => y.id !== year.id), currentYearId: current.currentYearId === year.id ? '' : current.currentYearId }); }} />
            </div>}
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {YEAR_FIELDS.filter(f => !['label', 'schoolName'].includes(f.key)).map(f => {
              const value = (year as unknown as Record<string, string>)[f.key];
              return value ? <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><dt className="text-xs text-ink-500">{f.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-ink-800">{value}</dd></div> : null;
            })}
          </dl>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="section-label">Reports, photos & achievements</h4>
          {canEdit && !editor && <button type="button" className="btn-quiet text-sm" onClick={() => setEditor({ kind: 'report', yearId: year.id })}><Plus className="w-4 h-4" /> Add record</button>}
        </div>
        {!(year.reports || []).length && <p className="text-sm text-ink-500 p-4">No records yet for {year.label}. Keep reports, class photos, achievements, projects and activities here.</p>}
        {[...(year.reports || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(report => <article key={report.id} className="card p-5">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h5 className="font-semibold text-ink-900 break-words">{report.title}</h5>
            <p className="text-xs text-ink-500 mt-1">{[report.kind || 'Report', report.term, dateLabel(report.date)].filter(Boolean).join(' · ')}</p></div>
            {canEdit && !editor && <div className="flex shrink-0"><button type="button" aria-label={`Edit ${report.title}`} className="btn-quiet p-2" onClick={() => setEditor({ kind: 'report', yearId: year.id, report })}><Pencil className="w-4 h-4" /></button>
              <ConfirmDeleteButton ariaLabel={`Delete ${report.title}`} hint="Removes the report entry. Attached documents are kept."
                onConfirm={async () => { const current = latest.current.education || {}; const target = current.schoolYears?.find(y => y.id === year.id); if (target) await save(upsertEducationYear(current, { ...target, reports: (target.reports || []).filter(r => r.id !== report.id) })); }} />
            </div>}
          </div>
          {report.results && <p className="text-sm whitespace-pre-wrap break-words text-ink-800 mt-3"><strong>Results: </strong>{report.results}</p>}
          {report.notes && <p className="text-sm whitespace-pre-wrap break-words text-ink-600 mt-2">{report.notes}</p>}
          {report.kind === 'Class photo' && <div className="flex flex-wrap gap-3 mt-3">{(report.documents || []).map(link => {
            const doc = options.find(o => o.link.id === link.id)?.document;
            return doc?.fileType.startsWith('image/') && doc.fileData ? <button key={link.id} type="button" onClick={() => onViewDocument(doc, member.name)} className="rounded-xl overflow-hidden border border-cream-200 max-w-full" aria-label={`View ${doc.name}`}>
              <img src={doc.fileData} alt={report.title} className="max-h-64 w-auto object-contain" loading="lazy" />
            </button> : null;
          })}</div>}
          {attached(report.documents)}
        </article>)}
      </>}
    </div>}

    {section === 'qualifications' && <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="section-label">Qualifications & courses</h4>
        {canEdit && !editor && <button type="button" className="btn-primary text-sm" onClick={() => setEditor({ kind: 'qualification' })}><Plus className="w-4 h-4" /> Add qualification</button>}
      </div>
      {!qualifications.length && <div className="card p-6 text-center"><Award className="w-7 h-7 text-sage-600 mx-auto mb-3" />
        <p className="font-medium text-ink-800">Keep what you’ve achieved</p><p className="text-sm text-ink-500 mt-2">Add degrees, certificates and completed courses. Link a certificate you’ve already saved or upload it here.</p></div>}
      {qualifications.map(q => <article key={q.id} className="card p-5">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h5 className="font-semibold text-ink-900 break-words">{q.name}</h5>{q.issuer && <p className="text-sm text-ink-500 mt-1 break-words">{q.issuer}</p>}</div>
          {canEdit && !editor && <div className="flex shrink-0"><button type="button" aria-label={`Edit ${q.name}`} className="btn-quiet p-2" onClick={() => setEditor({ kind: 'qualification', qualification: q })}><Pencil className="w-4 h-4" /></button>
            <ConfirmDeleteButton ariaLabel={`Delete ${q.name}`} hint="Removes this qualification. Attached certificates are kept."
              onConfirm={async () => { const current = latest.current.education || {}; await save({ ...current, qualifications: (current.qualifications || []).filter(x => x.id !== q.id) }); }} />
          </div>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500 mt-3">
          {q.issueDate && <span>Completed {dateLabel(q.issueDate)}</span>}
          {q.expiryDate && <span className={q.expiryDate < new Date().toLocaleDateString('en-CA') ? 'text-rosa-700' : ''}>Expires {dateLabel(q.expiryDate)}</span>}
        </div>
        {q.notes && <p className="text-sm whitespace-pre-wrap break-words text-ink-600 mt-3">{q.notes}</p>}
        {attached(q.documents)}
      </article>)}
    </div>}
  </div>;
}
