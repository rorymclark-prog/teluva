import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { FileDown, FolderArchive, Loader2, Printer, RefreshCw, X, ShieldAlert } from 'lucide-react';
import { doc, getDocFromServer } from 'firebase/firestore';
import type { AssetItem, HomeServiceRecord, InsurancePolicy, SlipItem, VaultDocument } from '../types';
import { auth, db } from '../lib/firebase';
import { FAMILY_ID } from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { normalizeFileReferences } from '../utils/fileReferences';
import {
  assetClaimCsv, assetClaimSummary, buildAssetClaimArchive, CLAIM_COVERAGE_NOTE,
  formatClaimMoney, isIncidentAsset, scopedClaimAssets,
  type AssetClaimManifest, type AssetClaimReferences, type AssetClaimScope,
} from '../utils/assetClaimExport';
import EmptyState from './EmptyState';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function recordRows(values: Record<string, string>) {
  return Object.entries(values).map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(7rem,1fr)_3fr] gap-x-3 gap-y-1 text-[12px] py-0.5">
    <dt className="font-semibold text-ink-500">{label}</dt><dd className="text-ink-800 whitespace-pre-wrap break-words">{value}</dd>
  </div>);
}

export default function AssetClaimExport({ items, onClose, isBusinessSpace }: {
  items: AssetItem[]; onClose: () => void; isBusinessSpace?: boolean;
}) {
  const context = useFamilyCtx();
  const business = isBusinessSpace ?? context.spaces.find(space => space.id === context.familyId)?.type === 'business';
  const [scope, setScope] = useState<AssetClaimScope>('all');
  const [references, setReferences] = useState<AssetClaimReferences | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<AssetClaimManifest | null>(null);
  const [generatedAt] = useState(() => new Date().toISOString());
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef(items);
  const scopeRef = useRef(scope);
  const epoch = useRef(0);
  itemsRef.current = items;
  scopeRef.current = scope;
  useBodyScrollLock(true);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialogRef.current?.parentElement);
    const inert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    closeRef.current?.focus();
    return () => {
      epoch.current++;
      background.forEach((element, index) => { element.inert = inert[index]; });
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const space = context.familyId;
    const uid = auth.currentUser?.uid;
    const current = () => !cancelled && FAMILY_ID === space && auth.currentUser?.uid === uid;
    setReferences(null); setReferenceError(''); setCompleted(null); setError('');
    if (!space || !uid) { setReferenceError('Sign in to check linked documents, purchase slips and insurance records.'); return () => { cancelled = true; }; }
    const mayReadPolicies = context.role !== 'child' && (!business || context.isAdmin);
    // Export needs a verified reference set. The general loaders intentionally
    // fall back to cached/empty records, which cannot establish completeness.
    void Promise.all([
      getDocFromServer(doc(db, 'families', space, 'reference', 'documents')),
      getDocFromServer(doc(db, 'families', space, 'reference', 'slips')),
      mayReadPolicies ? getDocFromServer(doc(db, 'families', space, 'reference', 'finances')) : Promise.resolve(null),
      getDocFromServer(doc(db, 'families', space, 'reference', 'household')),
    ]).then(([documents, slips, finances, household]) => {
      if (!current()) return;
      const docs = documents.exists() ? documents.data().docs ?? [] : [];
      const receipts = slips.exists() ? slips.data().slips ?? [] : [];
      const policies = finances?.exists() ? finances.data().insurance ?? [] : [];
      const services = household.exists() ? household.data().homeServiceLog ?? [] : [];
      if (!Array.isArray(docs) || !Array.isArray(receipts) || !Array.isArray(policies) || !Array.isArray(services)) throw new Error('invalid-reference-data');
      setReferences(normalizeFileReferences({ documents: docs as VaultDocument[], slips: receipts as SlipItem[], policies: policies as InsurancePolicy[],
        household: { homeServiceLog: services as HomeServiceRecord[] }, policyDetailsUnavailable: !mayReadPolicies }));
    }).catch(() => {
      if (current()) setReferenceError('Could not verify the linked evidence records. Check your connection and retry before downloading an evidence pack.');
    });
    return () => { cancelled = true; };
  }, [context.familyId, context.uid, context.role, context.isAdmin, business, retry]);

  useEffect(() => { setCompleted(null); setError(''); }, [scope, items]);
  const scoped = useMemo(() => scopedClaimAssets(items, scope), [items, scope]);
  const summary = useMemo(() => assetClaimSummary({ items, scope, references: references || undefined, isBusinessSpace: business, generatedAt }), [items, scope, references, business, generatedAt]);
  const claimCount = items.filter(isIncidentAsset).length;
  const evidence = summary.assets.flatMap(asset => asset.evidence);
  const completedEvidence = completed?.assets.flatMap(asset => asset.evidence) || [];
  const unavailable = completedEvidence.filter(file => file.status === 'unavailable');

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || [])];
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const downloadEvidence = async () => {
    if (busy || !references || !scoped.length) return;
    const uid = auth.currentUser?.uid, space = FAMILY_ID, version = epoch.current;
    const sourceItems = items, selectedScope = scope;
    const current = () => epoch.current === version && auth.currentUser?.uid === uid && FAMILY_ID === space && itemsRef.current === sourceItems && scopeRef.current === selectedScope;
    setBusy(true); setError(''); setCompleted(null); setProgress('Preparing evidence…');
    try {
      const pack = await buildAssetClaimArchive({ items: sourceItems, scope: selectedScope, references, isBusinessSpace: business, generatedAt,
        isCurrent: current, onProgress: (finished, total) => { if (current()) setProgress(`Checked ${finished} of ${total} linked files…`); },
      });
      if (!current()) return;
      download(pack.blob, pack.fileName);
      setCompleted(pack.manifest);
    } catch (failure) {
      if (epoch.current === version) setError(failure instanceof Error ? failure.message : 'Could not build the evidence pack. Try again.');
    } finally { if (epoch.current === version) { setBusy(false); setProgress(''); } }
  };

  return createPortal(<div className="asset-claim-export-layer fixed inset-0 z-[120] overflow-y-auto bg-ink-900/60 backdrop-blur-sm flex justify-center px-3 py-6 sm:p-8"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <style>{`@media print {
      @page { margin:12mm; }
      html, body { position:static!important;inset:auto!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;background:white!important; }
      body > *:not(.asset-claim-export-layer) { display:none!important; }
      .asset-claim-export-layer { position:static!important;inset:auto!important;display:block!important;height:auto!important;min-height:0!important;max-height:none!important;padding:0!important;background:white!important;overflow:visible!important;backdrop-filter:none!important; }
      .asset-claim-export-dialog { display:block!important;height:auto!important;max-height:none!important;overflow:visible!important;border:0!important;box-shadow:none!important;border-radius:0!important;max-width:none!important;margin:0!important;font-size:11px!important; }
      .asset-claim-export-dialog section { break-inside:auto; }
      .asset-claim-export-dialog h3, .asset-claim-export-dialog h4 { break-after:avoid; }
      .asset-claim-export-dialog dl.border-t { break-inside:avoid; }
      .asset-claim-controls { display:none!important; }
    }`}</style>
    <div ref={dialogRef} onKeyDown={keys} role="dialog" aria-modal="true" aria-labelledby="asset-claim-title"
      className="asset-claim-export-dialog w-full max-w-5xl h-fit my-auto bg-white rounded-[28px] border border-cream-300/60 shadow-2xl overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-5 sm:p-7 border-b border-cream-200">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 shrink-0 text-rosa-700" /><h2 id="asset-claim-title" className="font-display text-2xl font-bold text-ink-900">{business ? 'Business' : 'Household'} asset evidence pack</h2></div>
          <p className="text-[13px] text-ink-600 mt-2">One selected record for your own files, your insurer or an incident report.</p>
          <p className="text-[12px] text-ink-400 mt-1">Generated {new Date(generatedAt).toLocaleString()} · {scope === 'incident' ? 'Stolen, lost or damaged items' : 'All items'}</p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} className="asset-claim-controls p-2 rounded-full text-ink-500 hover:bg-cream-100" aria-label="Close asset export"><X className="w-5 h-5" /></button>
      </div>
      <div className="asset-claim-controls flex flex-wrap items-center gap-2 px-5 sm:px-7 py-3 border-b border-cream-200">
        <button type="button" disabled={busy} onClick={() => setScope('all')} aria-pressed={scope === 'all'} className={`tab-pill ${scope === 'all' ? 'tab-pill-active' : 'bg-cream-100'} disabled:opacity-50`}>All items · {items.length}</button>
        <button type="button" disabled={busy} onClick={() => setScope('incident')} aria-pressed={scope === 'incident'} className={`tab-pill ${scope === 'incident' ? 'tab-pill-active' : 'bg-cream-100'} disabled:opacity-50`}>Stolen / lost / damaged · {claimCount}</button>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <button type="button" onClick={() => window.print()} disabled={!scoped.length || busy} className="btn-quiet disabled:opacity-50"><Printer className="w-4 h-4" /> Print / Save PDF</button>
          <button type="button" disabled={!scoped.length || busy} onClick={() => download(new Blob([assetClaimCsv(completed || summary)], { type: 'text/csv;charset=utf-8;' }), `${business ? 'business' : 'household'}-assets-${scope}.csv`)} className="btn-quiet disabled:opacity-50"><FileDown className="w-4 h-4" /> CSV</button>
          <button type="button" disabled={!scoped.length || !references || busy} onClick={downloadEvidence} className="btn-primary disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderArchive className="w-4 h-4" />} Evidence ZIP</button>
        </div>
      </div>
      <div className="p-5 sm:p-7 space-y-4">
        <p className="rounded-xl bg-cream-100 border border-cream-200 p-3 text-[13px] text-ink-700">{CLAIM_COVERAGE_NOTE}</p>
        <div className="asset-claim-controls text-[13px]" aria-live="polite">
          {referenceError ? <div role="alert" className="text-rosa-700 flex flex-wrap items-center gap-2"><span>{referenceError}</span><button type="button" onClick={() => setRetry(value => value + 1)} className="btn-quiet text-xs"><RefreshCw className="w-3.5 h-3.5" /> Retry evidence check</button></div>
            : !references ? <p className="text-ink-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking linked documents, receipts, service history and policies…</p>
            : <p className="text-ink-500">{evidence.length} linked files to check. The ZIP includes original files and HTML, CSV and JSON summaries; missing files are listed explicitly. {references.policyDetailsUnavailable ? 'Insurance policy details are restricted for this account.' : ''}</p>}
          {busy && <p role="status" className="mt-2 text-ink-600">{progress}</p>}
          <p className="mt-2 text-[11px] text-ink-400">Up to 100 MiB of originals per ZIP, 20 MiB per file. Larger files are listed as unavailable and can be downloaded separately from the Vault.</p>
          {error && <p role="alert" className="mt-2 text-rosa-700">{error}</p>}
          {completed && <div role="status" className={`mt-3 rounded-xl border p-3 ${unavailable.length || completed.warnings.length ? 'border-honey-200 bg-honey-50 text-ink-800' : 'border-sage-200 bg-sage-50 text-sage-700'}`}>
            <p className="font-semibold">{unavailable.length || completed.warnings.length ? 'Partial evidence pack downloaded — check the unavailable records.' : 'Evidence pack downloaded.'}</p>
            <p>{completedEvidence.filter(file => file.status === 'included').length} file references included · {unavailable.length} unavailable.</p>
            {(unavailable.length > 0 || completed.warnings.length > 0) && <ul className="list-disc pl-5 mt-1">{completed.assets.flatMap(asset => asset.evidence.filter(file => file.status === 'unavailable').map((file, index) => <li key={`${asset.id}-${index}`}>{asset.name}: {file.label} — {file.reason}</li>))}{completed.warnings.map((warning, index) => <li key={`warning-${index}`}>{warning}</li>)}</ul>}
          </div>}
        </div>
        {!scoped.length ? <EmptyState title={scope === 'incident' ? 'No stolen, lost or damaged items on file.' : 'No assets on file yet.'} description="Add or update an asset, then generate the selected record here." /> : <>
          <div className="rounded-xl border border-cream-200 p-3 space-y-1">
            <p className="font-semibold text-[13px]">Recorded estimates by currency</p>
            {summary.totals.map(total => <p key={total.currency} className="text-[13px] text-ink-700"><strong className="tabular-nums">{formatClaimMoney(total.recordedValue, total.currency)}</strong> · {total.items} item{total.items === 1 ? '' : 's'}{total.unpriced ? ` · ${total.unpriced} unpriced` : ''}</p>)}
            <p className="text-[11px] text-ink-500">{summary.valueNote}</p>
          </div>
          <p className="text-[12px] text-ink-500">Evidence below is verified when you generate the ZIP. Printed and CSV-only exports contain the recorded details.</p>
          {(completed || summary).assets.map(asset => <section key={asset.id} className="border border-cream-200 rounded-2xl p-4 space-y-3">
            <div><h3 className="font-display text-lg font-semibold text-ink-900">{asset.name}</h3><p className="text-[11px] text-ink-400">Asset ID: {asset.id}</p></div>
            <dl>{recordRows(asset.details)}</dl>
            {([['Warranties as recorded', asset.warranties], ['Linked insurance — coverage unconfirmed', asset.policies], ['Purchase slips', asset.receipts], ['Service and repair history', asset.serviceHistory]] as const).map(([title, values]) => values.length > 0 && <Fragment key={title}><h4 className="text-[12px] font-bold text-ink-700">{title}</h4>{values.map((value, index) => <dl key={index} className="border-t border-cream-100 pt-2">{recordRows(value)}</dl>)}</Fragment>)}
            <div><h4 className="text-[12px] font-bold text-ink-700">Evidence</h4>{asset.evidence.length ? <ul className="text-[12px] list-disc pl-4 mt-1 space-y-1">{asset.evidence.map((file, index) => <li key={index} className={file.status === 'unavailable' ? 'text-rosa-700' : 'text-ink-600'}>{file.label} · {file.status}{file.archivePath ? ` · ${file.archivePath}` : ''}{file.reason ? ` — ${file.reason}` : ''}</li>)}</ul> : <p className="text-[12px] text-ink-400">No evidence linked.</p>}</div>
          </section>)}
        </>}
      </div>
    </div>
  </div>, document.body);
}
