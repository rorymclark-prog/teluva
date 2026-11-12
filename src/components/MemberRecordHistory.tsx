import React, { useEffect, useRef, useState } from 'react';
import { History, Plus, Pencil, Upload } from 'lucide-react';
import type { FamilyMember, PersonalRecordHistoryEntry } from '../types';
import { RECORD_KINDS, RECORD_STATUSES, appendHistoryRecords, maskedHistoryValue, parseHistoryImport, safeHistorySource, validateHistoryRecord } from '../utils/recordHistory';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { useFamilyCtx } from '../contexts/FamilyContext';

export default function MemberRecordHistory({ member, canEdit, onUpdate }: { member: FamilyMember; canEdit: boolean; onUpdate: (patch: Partial<FamilyMember>) => Promise<void> }) {
  const { uid, familyId, role } = useFamilyCtx();
  return <RecordHistoryBody key={`${uid}:${familyId}:${role}:${member.id}`} member={member} canEdit={canEdit} onUpdate={onUpdate} />;
}

function RecordHistoryBody({ member, canEdit, onUpdate }: { key?: string; member: FamilyMember; canEdit: boolean; onUpdate: (patch: Partial<FamilyMember>) => Promise<void> }) {
  const [draft, setDraft] = useState<PersonalRecordHistoryEntry | null>(null), [review, setReview] = useState<PersonalRecordHistoryEntry[]>([]), [revealed, setRevealed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null), latest = useRef({ member, canEdit }), alive = useRef(true), sequence = useRef(0);
  latest.current = { member, canEdit };
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
  const rows = member.recordHistory || [];
  const current = (version: number) => alive.current && version === sequence.current && latest.current.member.id === member.id && latest.current.canEdit;
  const save = async (records: PersonalRecordHistoryEntry[], editing = false) => {
    if (!canEdit || busy) return;
    const version = sequence.current; setBusy(true); setError(''); setStatus('');
    try {
      const checked = records.map(row => validateHistoryRecord(row));
      const existing = latest.current.member.recordHistory || [];
      const next = editing ? existing.map(row => row.id === checked[0].id ? checked[0] : row) : appendHistoryRecords(existing, checked);
      if (editing && !existing.some(row => row.id === checked[0].id)) throw Error('This record changed. Reopen it before editing.');
      if (!current(version)) return;
      await onUpdate({ recordHistory: next });
      if (current(version)) { setDraft(null); setReview([]); setStatus(next.length === existing.length && !editing ? 'These records are already in the history.' : 'Saved to this person’s record history.'); }
    } catch (err) { if (current(version)) setError(err instanceof Error ? err.message : 'Could not save these records. Your review is still here.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const load = async (file: File) => {
    if (!canEdit || busy) return;
    const version = ++sequence.current; setError(''); setStatus(''); setBusy(true);
    try {
      if (file.size > 128_000) throw Error('Choose a history file smaller than 128 KB.');
      const parsed = parseHistoryImport(await file.text(), member.name);
      if (current(version)) { setDraft(null); setReview(parsed); setStatus('Review these source-backed entries. Nothing has been saved yet.'); }
    } catch (err) { if (current(version)) setError(err instanceof Error ? err.message : 'Could not read the file.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const displayDate = (value?: string) => value || 'Unknown';
  const evidence = (row: PersonalRecordHistoryEntry) => <details className="text-xs text-ink-500"><summary className="min-h-[44px] cursor-pointer py-3">Source & dates</summary><p>Used from: {displayDate(row.startDate)} · Used until: {displayDate(row.endDate)}</p><p>Recorded in source: {displayDate(row.observedDate)}. This is not automatically a start or end date.</p>{row.sourceName && <p className="mt-2 break-words">{row.sourceName}</p>}{safeHistorySource(row.sourceUrl) && <a className="underline" href={safeHistorySource(row.sourceUrl)} target="_blank" rel="noopener noreferrer">Open source</a>}{row.evidenceQuote && <blockquote className="mt-2 whitespace-pre-wrap break-words">{row.evidenceQuote.startsWith('enc:') ? 'Protected evidence unavailable' : row.evidenceQuote}</blockquote>}{row.notes && <p className="mt-2 whitespace-pre-wrap break-words">{row.notes.startsWith('enc:') ? 'Protected notes unavailable' : row.notes}</p>}</details>;
  return <section className="space-y-5" aria-label="Past numbers and memberships">
    <div className="card p-5"><h3 className="flex items-center gap-2 text-lg font-semibold text-ink-900"><History size={20} /> Past numbers & memberships</h3><p className="mt-2 text-sm text-ink-600">Keep {member.name.split(' ')[0]}’s previous phone numbers, email addresses, medical-aid and insurance memberships with their sources and dates.</p><p className="mt-2 text-xs text-ink-500">History entries are separate from current contact and ID details. An old letter proves a recorded number; it does not prove when cover started or ended.</p></div>
    {canEdit && !draft && !review.length && <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-[44px]" onClick={() => { setError(''); setStatus(''); setDraft({ id: crypto.randomUUID(), kind: 'phone', value: '', status: 'unknown' }); }}><Plus size={16} />Add previous record</button><button className="btn-quiet min-h-[44px]" onClick={() => input.current?.click()}><Upload size={16} />Review connector records</button></div>}
    <input ref={input} className="hidden" type="file" accept="application/json,.json" aria-label="Choose record-history JSON" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void load(file); }} />
    {error && <p role="alert" className="text-sm text-rosa-700">{error}</p>}{status && <p role="status" className="text-sm text-ink-600">{status}</p>}
    {draft && canEdit && <form className="card space-y-4 p-5" onSubmit={event => { event.preventDefault(); void save([draft], rows.some(row => row.id === draft.id)); }}><h4 className="font-semibold text-ink-900">Record details</h4><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="field-label">Type<select className="field" value={draft.kind} onChange={event => setDraft(old => old ? { ...old, kind: event.target.value as PersonalRecordHistoryEntry['kind'] } : old)}>{Object.entries(RECORD_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field-label">Status<select className="field" value={draft.status} onChange={event => setDraft(old => old ? { ...old, status: event.target.value as PersonalRecordHistoryEntry['status'] } : old)}>{Object.entries(RECORD_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {([['value', 'Number or reference', 200], ['provider', 'Provider or scheme', 180], ['label', 'Label', 180], ['sourceName', 'Source name', 500], ['sourceUrl', 'Source link', 2000]] as const).map(([key, label, max]) => <label className="field-label" key={key}>{label}<input className="field" required={key === 'value'} maxLength={max} value={draft[key] || ''} onChange={event => setDraft(old => old ? { ...old, [key]: event.target.value } : old)} /></label>)}
      {([['startDate', 'Used from'], ['endDate', 'Used until'], ['observedDate', 'Date recorded in source']] as const).map(([key, label]) => <label key={key} className="field-label">{label}<input type="date" className="field" value={draft[key] || ''} onChange={event => setDraft(old => old ? { ...old, [key]: event.target.value } : old)} /></label>)}
      {([['notes', 'Notes', 4000], ['evidenceQuote', 'Exact source excerpt', 2000]] as const).map(([key, label, max]) => <label key={key} className="field-label sm:col-span-2">{label}<textarea className="field" rows={3} maxLength={max} value={draft[key] || ''} onChange={event => setDraft(old => old ? { ...old, [key]: event.target.value } : old)} /></label>)}
      <div className="flex flex-wrap gap-2 sm:col-span-2"><button className="btn-primary min-h-[44px]" type="submit">{busy ? 'Saving…' : 'Save history record'}</button><button type="button" className="btn-quiet min-h-[44px]" onClick={() => setDraft(null)}>Cancel</button></div>
    </fieldset></form>}
    {!!review.length && canEdit && <section className="card space-y-4 p-5" aria-label="Review connector history"><h4 className="font-semibold text-ink-900">Review {review.length} suggested records for {member.name}</h4><p className="text-xs text-ink-500">Check the exact source excerpts below. Existing records are preserved and matching duplicates are skipped.</p>{review.map(row => <article key={row.id} className="rounded-xl border border-cream-200 p-3"><p className="font-medium text-ink-800">{RECORD_KINDS[row.kind]} · {row.provider || row.label || 'Provider unknown'}</p><p className="break-all font-mono text-sm text-ink-700">{row.value}</p><p className="text-xs text-ink-500">{RECORD_STATUSES[row.status]}</p>{evidence(row)}</article>)}<div className="flex flex-wrap gap-2"><button className="btn-primary min-h-[44px]" disabled={busy} onClick={() => void save(review)}>Save reviewed history</button><button className="btn-quiet min-h-[44px]" disabled={busy} onClick={() => setReview([])}>Cancel review</button></div></section>}
    {!rows.length && !draft && !review.length && <p className="card p-6 text-sm text-ink-500">No previous numbers or memberships recorded yet.{canEdit && ' A connected assistant can prepare a source-backed JSON file for this person; choose Review connector records to check and save it.'}</p>}
    {rows.map(row => <article key={row.id} className="card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="font-semibold text-ink-900">{row.label || RECORD_KINDS[row.kind]}</h4><p className="text-xs text-ink-500">{row.provider || RECORD_KINDS[row.kind]} · {RECORD_STATUSES[row.status]}</p><div className="mt-2 flex flex-wrap items-center gap-2"><span className="break-all font-mono text-sm text-ink-700">{revealed.includes(row.id) && !row.value.startsWith('enc:') ? row.value : maskedHistoryValue(row.value)}</span><button className="btn-quiet min-h-[44px] text-xs" disabled={!row.value || row.value.startsWith('enc:')} onClick={() => setRevealed(old => old.includes(row.id) ? old.filter(id => id !== row.id) : [...old, row.id])}>{revealed.includes(row.id) ? 'Hide number' : 'Show number'}</button></div></div>{canEdit && !draft && !review.length && <div className="flex"><button className="btn-quiet min-h-[44px]" aria-label={`Edit ${row.label || RECORD_KINDS[row.kind]}`} disabled={busy || row.value.startsWith('enc:')} onClick={() => { setError(''); setDraft(row); }}><Pencil size={16} /></button><ConfirmDeleteButton disabled={busy} ariaLabel={`Remove ${row.label || RECORD_KINDS[row.kind]} from history`} onConfirm={async () => { await onUpdate({ recordHistory: (latest.current.member.recordHistory || []).filter(value => value.id !== row.id) }); }} /></div>}</div>{evidence(row)}</article>)}
  </section>;
}
