import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FilePlus2, FileText, Inbox, Loader2, Plus, RefreshCw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { AssetItem, AssetWarranty, VaultCategory } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth } from '../lib/firebase';
import { FAMILY_ID } from '../utils/db';
import { createFileOperationScope, type FileOperationScope } from '../utils/fileOperationScope';
import { uploadServiceDocFile } from '../utils/serviceDocUpload';
import { createImportInboxClient, importErrorMessage, importStatusLabel, InboxRequestError, processImportBatch, type ImportBatchEntry, type ImportInboxItem, type ImportProposal } from '../utils/importInboxClient';
import { ServiceDocChips, useVaultDocs } from './ServiceDocs';

const assetCategories: AssetItem['category'][] = ['Electronics', 'Appliance', 'Bike', 'Sporting', 'Vehicle', 'Jewellery', 'Furniture', 'Other'];
const documentCategories: VaultCategory[] = ['Identity', 'Education', 'Medical', 'Financial', 'Legal', 'Travel', 'Other'];
const newRequestId = () => crypto.randomUUID();
export default function ImportInbox() {
  const { uid, familyId, role } = useFamilyCtx();
  return <div key={`${uid}:${familyId}:${role}`}><ImportInboxBody /></div>;
}
function ImportInboxBody() {
  const ctx = useFamilyCtx();
  const latest = useRef(ctx); latest.current = ctx;
  const mounted = useRef(true), epoch = useRef(0), intakeBusy = useRef(false);
  const allowed = !ctx.loading && !!ctx.uid && !!ctx.familyId && (ctx.role === 'admin' || ctx.role === 'member');
  const current = () => mounted.current && latest.current.uid === auth.currentUser?.uid && latest.current.familyId === FAMILY_ID;
  const api = useMemo(() => createImportInboxClient({ getUser: () => auth.currentUser, getSpace: () => current() ? latest.current.familyId : null, getGeneration: () => `${mounted.current}:${latest.current.role}` }), []);
  const vault = useVaultDocs(!allowed);
  const [items, setItems] = useState<ImportInboxItem[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [filter, setFilter] = useState<'pending' | 'applied' | 'dismissed' | 'all'>('pending');
  const [sourceMode, setSourceMode] = useState<'file' | 'vault' | 'text'>('file');
  const [documentIds, setDocumentIds] = useState<string[]>([]), [sourceText, setSourceText] = useState(''), [sourceName, setSourceName] = useState('');
  const [busy, setBusy] = useState(false), [intakeError, setIntakeError] = useState(''), [intakeStatus, setIntakeStatus] = useState('');
  const [batch, setBatch] = useState<ImportBatchEntry[]>([]);
  const batchRef = useRef(batch); batchRef.current = batch;
  const fileInput = useRef<HTMLInputElement>(null), pendingFile = useRef<FileOperationScope | null>(null), requestId = useRef(newRequestId());
  const business = ctx.spaces.find(space => space.id === ctx.familyId)?.type === 'business';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const reload = async () => {
    if (!allowed || !current()) return;
    setLoading(true); setError('');
    try { const result = await api.list(); if (current()) setItems(result.items); }
    catch (err) { if (current()) setError(importErrorMessage(err)); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => { if (allowed) void reload(); else setLoading(false); }, [allowed]);
  const adopt = (item: ImportInboxItem) => { if (current()) setItems(old => [item, ...old.filter(value => value.id !== item.id)]); };
  const changeSourceMode = (mode: typeof sourceMode) => { if (intakeBusy.current) return; epoch.current++; pendingFile.current = null; setSourceMode(mode); setDocumentIds([]); setBatch([]); setSourceText(''); setSourceName(''); setIntakeError(''); setIntakeStatus(''); requestId.current = newRequestId(); };
  const captureIntake = () => createFileOperationScope(() => [auth.currentUser?.uid, FAMILY_ID, latest.current.familyId, latest.current.role, mounted.current, epoch.current]);
  const runBatch = async (entries: ImportBatchEntry[], scope: FileOperationScope) => {
    if (!allowed || intakeBusy.current || !scope.isCurrent()) return;
    intakeBusy.current = true; setBusy(true); setIntakeError(''); setIntakeStatus('');
    try {
      await processImportBatch(entries, { scope,
        upload: async file => {
          if (file.size >= 20 * 1024 * 1024) throw new Error('Choose an original smaller than 20 MB.');
          if (file.type !== 'application/pdf' && !file.type.startsWith('image/') && !file.type.startsWith('text/') && !/\.(pdf|png|jpe?g|webp|heic|heif|gif|tiff?|txt|csv|md)$/i.test(file.name)) throw new Error('Choose a PDF, image or text file.');
          const result = await scope.step(() => uploadServiceDocFile(file, { name: file.name.replace(/\.[^.]+$/, '') || 'Import original', scope, shared: true, dedupe: false }));
          if (result.kind === 'error') throw new Error(result.message);
          vault.adopt(result.doc, result.allDocs); return result.doc.id;
        },
        create: async input => (await api.create(input)).item,
        onItem: adopt,
        onEntry: entry => { batchRef.current = batchRef.current.map(value => value.id === entry.id ? entry : value); setBatch(batchRef.current); },
      });
      if (scope.isCurrent()) setIntakeStatus('Batch finished. Review the results below; originals were kept.');
    } catch (err) { if (scope.isCurrent()) setIntakeError(importErrorMessage(err)); }
    finally { if (scope.isCurrent()) { intakeBusy.current = false; setBusy(false); } }
  };
  const chooseFiles = (files: File[], scope: FileOperationScope) => {
    if (!scope.isCurrent() || intakeBusy.current) return;
    if (files.length > 20) { setIntakeError('Choose up to 20 originals per batch. No files were uploaded.'); return; }
    const entries: ImportBatchEntry[] = files.map(file => ({ id: newRequestId(), name: file.name, file, requestId: newRequestId(), status: 'queued' }));
    batchRef.current = entries; setBatch(entries); void runBatch(entries, scope);
  };
  const create = async () => {
    if (!allowed || !current() || intakeBusy.current) return;
    if (sourceMode === 'vault') {
      const entries: ImportBatchEntry[] = documentIds.map(documentId => ({ id: documentId, name: vault.docs.find(document => document.id === documentId)?.name || 'Vault original', documentId, requestId: newRequestId(), status: 'queued' }));
      batchRef.current = entries; setBatch(entries); setDocumentIds([]); await runBatch(entries, captureIntake()); return;
    }
    if (!sourceText.trim() || !sourceName.trim()) { setIntakeError('Give this text a source name and paste its contents.'); return; }
    intakeBusy.current = true; setBusy(true); setIntakeError('');
    try {
      const result = await api.create({ sourceText: sourceText.trim(), sourceName: sourceName.trim(), requestId: requestId.current });
      adopt(result.item); setSourceText(''); setSourceName(''); requestId.current = newRequestId(); setIntakeStatus('Added to your review inbox. No record has been created yet.');
    } catch (err) { if (current()) setIntakeError(importErrorMessage(err)); }
    finally { if (current()) { intakeBusy.current = false; setBusy(false); } }
  };
  if (!allowed) return <section className="rounded-2xl border border-cream-300 bg-white p-5"><h2 className="font-semibold text-ink-900">Import inbox</h2><p className="mt-2 text-sm text-ink-500">Sign in with an adult {business ? 'team' : 'family'} account to prepare and review imports.</p></section>;
  const visible = items.filter(item => filter === 'all' || item.status === filter);
  return <section className="mx-auto max-w-4xl space-y-5 pb-8" aria-label="Import inbox">
    <header className="flex items-start gap-3"><span className="rounded-2xl bg-clay-50 p-3 text-clay-700"><Inbox className="h-6 w-6" /></span><div className="min-w-0 flex-1"><h1 className="font-display text-2xl text-ink-900">Import inbox</h1><p className="mt-1 text-[13px] leading-relaxed text-ink-500">Keep the original, review the details, then add a record to your {business ? 'business' : 'family'} space.</p></div></header>
    <details className="rounded-2xl border border-cream-300 bg-white" open>
      <summary className="flex min-h-[52px] cursor-pointer items-center gap-2 p-4 text-sm font-semibold text-ink-900"><FilePlus2 className="h-4 w-4 text-clay-600" />Add something to review<ChevronDown className="ml-auto h-4 w-4" /></summary>
      <div className="space-y-4 border-t border-cream-200 p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Import source">{(['file', 'vault', 'text'] as const).map(mode => <button key={mode} type="button" aria-pressed={sourceMode === mode} disabled={busy} onClick={() => changeSourceMode(mode)} className={`min-h-[44px] rounded-xl border px-3 text-xs font-medium disabled:opacity-40 ${sourceMode === mode ? 'border-clay-300 bg-clay-50 text-clay-800' : 'border-cream-300 text-ink-600'}`}>{mode === 'file' ? 'Upload original' : mode === 'vault' ? 'From Vault' : 'Paste text'}</button>)}</div>
        {sourceMode === 'file' && <div className="space-y-2"><button type="button" disabled={busy} onClick={() => { pendingFile.current = captureIntake(); fileInput.current?.click(); }} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Choose originals & queue imports</button><input ref={fileInput} type="file" multiple accept="application/pdf,image/*,text/*,.heic,.heif,.txt,.csv,.md" className="hidden" aria-label="Upload originals for import" onChange={event => { const files = Array.from(event.target.files || []) as File[], scope = pendingFile.current; event.target.value = ''; pendingFile.current = null; if (files.length && scope) chooseFiles(files, scope); }} /><p className="text-[11.5px] leading-relaxed text-ink-400">Up to 20 files per batch, each under 20 MB. Original bytes stay in the protected Vault, shared with your {business ? 'team' : 'family'}. Analysis is a separate step.</p></div>}
        {sourceMode === 'vault' && <div className="space-y-2"><p className="text-xs font-medium text-ink-700">Choose saved originals ({documentIds.length}/20)</p><div className="max-h-56 overflow-y-auto rounded-xl border border-cream-200">{vault.docs.length ? vault.docs.map(document => <label key={document.id} className="flex min-h-[44px] items-center gap-3 border-b border-cream-100 p-3 text-xs last:border-b-0"><input type="checkbox" checked={documentIds.includes(document.id)} disabled={busy || (documentIds.length >= 20 && !documentIds.includes(document.id))} onChange={event => setDocumentIds(old => event.target.checked ? [...old, document.id] : old.filter(id => id !== document.id))} /><span className="min-w-0 break-words text-ink-700">{document.name}</span></label>) : <p className="p-3 text-xs text-ink-400">The Vault is empty or unavailable. Open the Vault to verify saved originals.</p>}</div><p className="text-[11px] text-ink-400">Only originals you can access can be queued.</p></div>}
        {sourceMode === 'text' && <><label className="block text-xs font-medium text-ink-700">Source name<input className="field mt-1 w-full" value={sourceName} maxLength={200} disabled={busy} placeholder="E.g. order confirmation email" onChange={event => { setSourceName(event.target.value); requestId.current = newRequestId(); }} /></label><label className="block text-xs font-medium text-ink-700">Receipt or email text<textarea className="field mt-1 min-h-32 w-full" value={sourceText} maxLength={40000} disabled={busy} onChange={event => { setSourceText(event.target.value); requestId.current = newRequestId(); }} /></label><p className="text-[11.5px] text-ink-400">Pasted text is a reference, not an original invoice. Attach the original separately when available.</p></>}
        {intakeError && <p role="alert" className="text-xs text-rosa-700">{intakeError}</p>}{intakeStatus && <p role="status" className="text-xs text-sage-700">{intakeStatus}</p>}
        {sourceMode !== 'file' && <button type="button" disabled={busy || (sourceMode === 'text' ? !sourceText.trim() || !sourceName.trim() : !documentIds.length)} onClick={() => void create()} className="btn-primary min-h-[44px] text-xs disabled:opacity-40"><Plus className="h-4 w-4" />{sourceMode === 'vault' ? `Queue ${documentIds.length || ''} selected originals` : 'Add to inbox'}</button>}
        {!!batch.length && <div className="space-y-2" aria-label="Batch import progress"><ul className="space-y-1">{batch.map(entry => <li key={entry.id} className="rounded-xl bg-cream-50 p-3 text-xs"><div className="flex items-start gap-2"><span className="min-w-0 flex-1 break-words text-ink-700">{entry.name}</span><span className={entry.status === 'error' ? 'text-rosa-700' : 'text-ink-400'}>{entry.status === 'uploading' ? 'Saving original…' : entry.status === 'saving' ? 'Queuing…' : entry.status === 'done' ? 'In inbox' : entry.status === 'error' ? 'Retry needed' : 'Waiting'}</span></div>{entry.error && <p className="mt-1 break-words text-rosa-700">{entry.error}{entry.documentId ? ' Original saved; retry will only queue it.' : ''}</p>}</li>)}</ul>{!busy && batch.some(entry => entry.status === 'error') && <button type="button" className="btn-quiet min-h-[44px] text-xs" onClick={() => void runBatch(batchRef.current, captureIntake())}><RefreshCw className="h-3.5 w-3.5" />Retry failed imports</button>}</div>}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-clay-700"><a href="/?open=drive" className="inline-flex min-h-[44px] items-center underline">Choose from Google Drive</a><a href="/?open=vault" className="inline-flex min-h-[44px] items-center underline">Open Document Vault</a></div>
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-2"><label className="mr-auto text-xs text-ink-500">Show<select className="field ml-2 text-xs" aria-label="Filter import inbox" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="pending">To review ({items.filter(item => item.status === 'pending').length})</option><option value="applied">Added</option><option value="dismissed">Dismissed</option><option value="all">All imports</option></select></label><button type="button" onClick={() => void reload()} disabled={loading} className="btn-quiet min-h-[44px] text-xs"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
    {error && <p role="alert" className="rounded-xl bg-rosa-50 p-3 text-xs text-rosa-700">{error}</p>}
    {loading && !items.length ? <p role="status" className="py-6 text-center text-sm text-ink-400">Loading your inbox…</p> : !visible.length ? <div className="rounded-2xl border border-dashed border-cream-300 p-8 text-center"><FileText className="mx-auto mb-3 h-7 w-7 text-ink-300" /><p className="text-sm text-ink-600">{filter === 'pending' ? 'Nothing waiting for review.' : 'No imports in this view.'}</p><p className="mt-1 text-xs text-ink-400">Upload evidence, choose a saved file or send a draft from a connected chatbot.</p></div> : <div className="space-y-3">{visible.map(item => <div key={item.id}><ImportRow item={item} api={api} docs={vault.docs} admin={ctx.isAdmin} aiConsent={ctx.aiConsent} business={business} onItem={adopt} /></div>)}</div>}
    {!ctx.isAdmin && <p className="text-xs leading-relaxed text-ink-400">You can prepare your imports here. An administrator reviews and adds the final records.</p>}
  </section>;
}

type Api = ReturnType<typeof createImportInboxClient>;
export function ImportRow({ item, api, docs, admin, aiConsent, business, onItem }: { item: ImportInboxItem; api: Api; docs: ReturnType<typeof useVaultDocs>['docs']; admin: boolean; aiConsent: boolean; business: boolean; onItem: (item: ImportInboxItem) => void }) {
  const [proposal, setProposal] = useState<ImportProposal | undefined>(item.proposal), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<{ id: string; name?: string; serialNumber?: string; model?: string }[]>([]);
  const revision = useRef(item.revision), working = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!dirty) { setProposal(item.proposal); revision.current = item.revision; } }, [item.revision, dirty]);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { if (item.analysis.status !== 'running') return; const timer = window.setInterval(() => setClock(Date.now()), 15000); return () => window.clearInterval(timer); }, [item.analysis.status]);
  const leaseUntil = Date.parse(item.analysis.leaseUntil || '') || (Date.parse(item.analysis.startedAt || '') + 5 * 60_000);
  const pending = item.status === 'pending', running = item.analysis.status === 'running' && (!Number.isFinite(leaseUntil) || leaseUntil > clock);
  const change = (next: ImportProposal) => { if (!pending || busy) return; setProposal(next); setDirty(true); setError(''); };
  const action = async (kind: 'save' | 'analyze' | 'apply' | 'dismiss') => {
    if (working.current || !pending || (kind === 'apply' && !admin) || (kind === 'analyze' && (!aiConsent || dirty))) return;
    working.current = true; setBusy(true); setError(''); setDuplicates([]);
    try {
      let result = item;
      if ((kind === 'save' || kind === 'apply') && proposal) {
        result = (await api.patch(item.id, proposal, revision.current)).item;
        if (!mounted.current) return;
        revision.current = result.revision; setDirty(false); setProposal(result.proposal); onItem(result);
      }
      if (kind !== 'save') result = (await api.act(item.id, kind, kind === 'apply' ? result.revision : revision.current)).item;
      if (!mounted.current) return;
      setProposal(result.proposal); revision.current = result.revision; setDirty(false); onItem(result);
    } catch (err) { if (mounted.current) { setError(importErrorMessage(err)); if (err instanceof InboxRequestError) setDuplicates(err.details?.candidates || []); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const sourceName = item.source.sourceName || docs.find(document => document.id === item.source.documentId)?.name || 'Imported source';
  return <details className="group overflow-hidden rounded-2xl border border-cream-300 bg-white">
    <summary className="flex min-h-[64px] cursor-pointer items-center gap-3 p-4"><FileText className="h-5 w-5 shrink-0 text-clay-500" /><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-ink-900">{item.proposal?.kind === 'asset' ? item.proposal.asset.name || sourceName : item.proposal?.kind === 'document' ? item.proposal.document.name || sourceName : sourceName}</span><span className="mt-1 block text-[11px] text-ink-400">{importStatusLabel(item)} · {sourceName}</span></span><ChevronDown className="h-4 w-4 shrink-0 text-ink-400 group-open:rotate-180" /></summary>
    <div className="space-y-4 border-t border-cream-200 p-4">
      {item.source.documentId ? <><ServiceDocChips ids={[item.source.documentId]} docs={docs} ownerLabel={business ? 'the team' : 'the family'} />{!docs.some(document => document.id === item.source.documentId) && <p className="text-xs text-ink-400">The original is linked but unavailable here. Verify access in the Vault before applying.</p>}</> : <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">Text reference only. No original receipt is linked to this import.</p>}
      {item.source.sourceText && <details><summary className="cursor-pointer text-xs text-clay-700">Read source text</summary><p className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-cream-50 p-3 text-xs text-ink-600">{item.source.sourceText}</p></details>}
      {item.analysis.error && <p role="alert" className="text-xs text-rosa-700">{item.analysis.error}</p>}
      {!!item.analysis.evidenceQuotes?.length && <details><summary className="cursor-pointer text-xs text-clay-700">Evidence from the source</summary><ul className="mt-2 space-y-2 text-xs leading-relaxed text-ink-600">{item.analysis.evidenceQuotes.flatMap((quote, index) => { const text = typeof quote === 'string' ? quote : quote && typeof quote === 'object' && 'quote' in quote && typeof quote.quote === 'string' ? quote.quote : ''; return text ? <li key={index} className="break-words border-l-2 border-clay-200 pl-3">{text}</li> : []; })}</ul></details>}
      {pending && !proposal && <div className="space-y-3"><p className="text-xs leading-relaxed text-ink-500">Analyze the source to suggest a record, or enter the details yourself. Dates and warranty cover need your review.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || running} className="btn-quiet min-h-[44px] text-xs" onClick={() => change({ kind: 'asset', asset: { name: '', category: 'Other' } })}>Enter an asset</button>{item.source.documentId && <button type="button" disabled={busy || running} className="btn-quiet min-h-[44px] text-xs" onClick={() => change({ kind: 'document', document: { name: sourceName, category: 'Other' } })}>File document details</button>}</div></div>}
      {proposal && <fieldset disabled={!pending || busy || running} className="min-w-0 space-y-4 disabled:opacity-70"><legend className="mb-3 text-xs font-semibold text-ink-800">{proposal.kind === 'asset' ? 'Review asset details' : 'Review document details'}</legend><ProposalFields proposal={proposal} onChange={change} /></fieldset>}
      {dirty && <p className="text-[11px] text-ink-400">Save your review before analyzing again.</p>}
      {dirty && item.revision !== revision.current && <p role="alert" className="text-xs text-amber-800">This import changed elsewhere. Your edits have not been applied. <button type="button" className="min-h-[44px] underline" disabled={busy} onClick={() => { setProposal(item.proposal); revision.current = item.revision; setDirty(false); setError(''); }}>Use latest review</button></p>}
      {error && <p role="alert" className="text-xs text-rosa-700">{error}</p>}
      {!!duplicates.length && <ul className="space-y-1 rounded-xl bg-cream-50 p-3 text-xs text-ink-600" aria-label="Matching existing assets">{duplicates.map(candidate => <li key={candidate.id} className="break-words">{[candidate.name || 'Existing asset', candidate.model, candidate.serialNumber].filter(Boolean).join(' · ')}</li>)}</ul>}
      {pending ? <><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || running || !aiConsent || dirty} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40" onClick={() => void action('analyze')}>{busy || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{item.analysis.status === 'failed' || (item.analysis.status === 'running' && !running) ? 'Retry analysis' : proposal ? 'Analyze again' : 'Analyze source'}</button>{proposal && <button type="button" disabled={busy || running || !dirty} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40" onClick={() => void action('save')}>Save review</button>}{admin && proposal && <button type="button" disabled={busy || running || !(proposal.kind === 'asset' ? proposal.asset.name?.trim() : proposal.document.name?.trim())} className="btn-primary min-h-[44px] text-xs disabled:opacity-40" onClick={() => void action('apply')}><Check className="h-4 w-4" />{proposal.kind === 'asset' ? 'Add reviewed asset' : 'Save reviewed document'}</button>}<button type="button" disabled={busy || running} className="btn-quiet min-h-[44px] text-xs text-ink-400 disabled:opacity-40" onClick={() => void action('dismiss')}><Trash2 className="h-3.5 w-3.5" />Dismiss draft</button></div>{!aiConsent && <p className="text-[11px] leading-relaxed text-ink-400">Enable AI features in Settings to analyze a source. You can still enter and review details manually.</p>}<p className="text-[11px] leading-relaxed text-ink-400">{admin ? 'Adding a reviewed record is an explicit approval. Check the source first; no warranty duration or insurance cover is inferred.' : 'Save your review for an administrator to approve.'} Dismissing removes only the draft from the review queue.</p></> : <p className="text-xs text-sage-700">{item.status === 'applied' ? 'This reviewed import was added. Open Assets or the Vault to view the record.' : 'This draft was dismissed. The original file was kept.'}</p>}
    </div>
  </details>;
}

export function ProposalFields({ proposal, onChange }: { proposal: ImportProposal; onChange: (proposal: ImportProposal) => void }) {
  const asset = proposal.kind === 'asset' ? proposal.asset : null;
  const patchAsset = (patch: Partial<AssetItem>) => { if (asset) onChange({ kind: 'asset', asset: { ...asset, ...patch } }); };
  const patchWarranty = (index: number, patch: Partial<AssetWarranty>) => patchAsset({ warranties: (asset?.warranties || []).map((warranty, current) => current === index ? { ...warranty, ...patch } : warranty) });
  if (proposal.kind === 'document') return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Document name" value={proposal.document.name} onChange={name => onChange({ kind: 'document', document: { ...proposal.document, name } })} /><label className="text-xs text-ink-600">Category<select className="field mt-1 w-full" value={proposal.document.category} onChange={event => onChange({ kind: 'document', document: { ...proposal.document, category: event.target.value as VaultCategory } })}>{documentCategories.map(category => <option key={category}>{category}</option>)}</select></label><Field label="Date on document" type="date" value={proposal.document.docDate} onChange={docDate => onChange({ kind: 'document', document: { ...proposal.document, docDate } })} /><Field label="Notes" value={proposal.document.notes} onChange={notes => onChange({ kind: 'document', document: { ...proposal.document, notes } })} /></div>;
  return <div className="space-y-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Asset name" value={asset!.name} onChange={name => patchAsset({ name })} /><label className="text-xs text-ink-600">Category<select className="field mt-1 w-full" value={asset!.category || 'Other'} onChange={event => patchAsset({ category: event.target.value as AssetItem['category'] })}>{assetCategories.map(category => <option key={category}>{category}</option>)}</select></label><Field label="Manufacturer" value={asset!.make} onChange={make => patchAsset({ make })} /><Field label="Model" value={asset!.model} onChange={model => patchAsset({ model })} /><Field label="Serial / identifier" value={asset!.serialNumber} onChange={serialNumber => patchAsset({ serialNumber })} /><Field label="Seller" value={asset!.purchaseLocation} onChange={purchaseLocation => patchAsset({ purchaseLocation })} /><Field label="Purchase date" type="date" value={asset!.purchaseDate} onChange={purchaseDate => patchAsset({ purchaseDate })} /><div className="grid min-w-0 grid-cols-2 gap-2"><Field label="Purchase price" value={asset!.purchasePrice} onChange={purchasePrice => patchAsset({ purchasePrice })} /><Field label="Currency" value={asset!.currency} placeholder="Unknown" onChange={currency => patchAsset({ currency: currency.toUpperCase() })} /></div><Field label="Order / invoice reference" value={asset!.purchaseReference} onChange={purchaseReference => patchAsset({ purchaseReference })} /><Field label="Return by" type="date" value={asset!.returnByDate} onChange={returnByDate => patchAsset({ returnByDate })} /></div>
    <div className="space-y-3"><h4 className="text-xs font-semibold text-ink-800">Recorded warranties</h4>{!(asset!.warranties || []).length && <p className="text-xs text-ink-400">No commercial warranty recorded. Unknown cover stays unknown.</p>}{(asset!.warranties || []).map((warranty, index) => <div key={warranty.id || index} className="space-y-3 rounded-xl border border-cream-200 p-3"><div className="flex items-center gap-2"><span className="text-xs font-medium text-ink-700">Warranty {index + 1}</span><button type="button" className="ml-auto min-h-[44px] px-2 text-ink-400" aria-label={`Remove warranty ${index + 1}`} onClick={() => patchAsset({ warranties: asset!.warranties!.filter((_, current) => current !== index) })}><X className="h-4 w-4" /></button></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-xs text-ink-600">Warranty type<select className="field mt-1 w-full" value={warranty.kind} onChange={event => patchWarranty(index, { kind: event.target.value as AssetWarranty['kind'] })}><option value="manufacturer">Manufacturer</option><option value="retailer">Retailer / in-store</option><option value="extended">Extended cover</option></select></label><Field label="Provider" value={warranty.provider} onChange={provider => patchWarranty(index, { provider })} /><Field label="Starts" type="date" value={warranty.startDate} onChange={startDate => patchWarranty(index, { startDate })} /><Field label="Ends" type="date" value={warranty.endDate} onChange={endDate => patchWarranty(index, { endDate })} /><Field label="Warranty reference" value={warranty.reference} onChange={reference => patchWarranty(index, { reference })} /><Field label="Provider contact" value={warranty.contact} onChange={contact => patchWarranty(index, { contact })} /></div><Field label="Recorded terms" value={warranty.terms} onChange={terms => patchWarranty(index, { terms })} /></div>)}<button type="button" className="btn-quiet min-h-[44px] text-xs" onClick={() => patchAsset({ warranties: [...(asset!.warranties || []), { id: newRequestId(), kind: 'manufacturer' }] })}><Plus className="h-3.5 w-3.5" />Add warranty</button></div><Field label="Notes" value={asset!.notes} onChange={notes => patchAsset({ notes })} /></div>;
}
function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value?: string; onChange: (value: string) => void; type?: string; placeholder?: string }) { return <label className="block min-w-0 text-xs text-ink-600">{label}<input type={type} className="field mt-1 w-full min-w-0" value={value || ''} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>; }
