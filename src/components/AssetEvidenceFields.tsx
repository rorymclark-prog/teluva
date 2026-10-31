import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileUp, FolderOpen, Loader2, Receipt, Search, X } from 'lucide-react';
import type { AssetItem, SlipItem, SlipsDoc } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth, db } from '../lib/firebase';
import { doc, getDocFromServer } from 'firebase/firestore';
import { FAMILY_ID } from '../utils/db';
import { isDemoMode } from '../utils/demoData';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { createFileOperationScope } from '../utils/fileOperationScope';
import { localServiceDoc, uploadServiceDocFile } from '../utils/serviceDocUpload';
import { fileContentUrl, filePathFromReference, isFamilyFilePath } from '../utils/fileReferences';
import { assetReceiptSource, linkAssetEvidence, missingAssetPurchaseDetails, receiptCurrencyConflict, unlinkAssetEvidence } from '../utils/assetEvidence';
import { ServiceDocChips, useVaultDocs } from './ServiceDocs';
import DocThumb from './DocThumb';
import ImageLightbox from './ImageLightbox';

interface Props {
  item: AssetItem;
  onChange?: (patch: Partial<AssetItem>) => void;
  onBusyChange?: (busy: boolean) => void;
}

export default function AssetEvidenceFields(props: Props) {
  const { familyId, uid } = useFamilyCtx();
  return <div key={`${uid || 'guest'}:${familyId || 'none'}:${props.item.id}`}><AssetEvidenceFieldsBody {...props} /></div>;
}

function AssetEvidenceFieldsBody({ item, onChange, onBusyChange }: Props) {
  const { familyId, uid, isAdmin, loading, spaces } = useFamilyCtx();
  const demo = isDemoMode();
  const business = spaces.find(space => space.id === familyId)?.type === 'business';
  const canRead = !demo && !loading && !!familyId && !!uid && familyId === FAMILY_ID && uid === auth.currentUser?.uid;
  const canEdit = !!onChange && (demo || (!loading && isAdmin));
  const latest = useRef(item); latest.current = item;
  const change = useRef(onChange); change.current = onChange;
  const editable = useRef(canEdit); editable.current = canEdit;
  const notifyBusy = useRef(onBusyChange); notifyBusy.current = onBusyChange;
  const epoch = useRef(0);
  const activeUpload = useRef<object | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const [documentQuery, setDocumentQuery] = useState('');
  const [receiptQuery, setReceiptQuery] = useState('');
  const [slips, setSlips] = useState<SlipItem[]>([]);
  const [slipState, setSlipState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [retry, setRetry] = useState(0);
  const [photo, setPhoto] = useState<{ src: string; name: string } | null>(null);
  const vault = useVaultDocs(!canRead);
  const spaceId = familyId || FAMILY_ID;
  const current = () => demo || (auth.currentUser?.uid === uid && FAMILY_ID === familyId);
  const patch = (value: Partial<AssetItem>) => { if (editable.current && current()) change.current?.(value); };

  useEffect(() => {
    setBusy(false); setError(null); setStatus(null); setShowDocuments(false); setShowReceipts(false); setPhoto(null);
    return () => {
      epoch.current++;
      if (activeUpload.current) { activeUpload.current = null; notifyBusy.current?.(false); }
    };
  }, [item.id, familyId, uid]);

  useEffect(() => {
    if (!canRead) { setSlips([]); setSlipState('ready'); return; }
    let active = true;
    const account = auth.currentUser?.uid;
    const space = FAMILY_ID;
    setSlips([]); setSlipState('loading');
    getDocFromServer(doc(db, 'families', familyId!, 'reference', 'slips')).then(snapshot => {
      const value = snapshot.exists() ? snapshot.data() : {};
      if (active && auth.currentUser?.uid === account && FAMILY_ID === space) { setSlips(readableSlips(value.slips)); setSlipState('ready'); }
    }).catch(() => { if (active) setSlipState('unavailable'); });
    return () => { active = false; };
  }, [canRead, familyId, uid, retry]);
  useSharedDoc<SlipsDoc>('slips', value => {
    if (current()) { setSlips(readableSlips(value.slips)); setSlipState('ready'); }
  }, { disabled: !canRead });

  // Only current-space protected URLs, or this tab's unsaved demo originals,
  // reach viewers. Linking an existing file never changes its server ACL.
  const documents = useMemo(() => vault.docs.flatMap(document => {
    if (demo && document.downloadUrl.startsWith('blob:')) return [document];
    const path = isFamilyFilePath(document.storagePath) ? document.storagePath : filePathFromReference(document.downloadUrl);
    return path?.startsWith(`families/${spaceId}/`) ? [{ ...document, downloadUrl: fileContentUrl(path) }] : [];
  }), [vault.docs, spaceId, demo]);
  const documentIds = item.documentIds || [];
  const slipIds = item.slipIds || [];
  const linkedSlips = slipIds.flatMap(id => slips.find(slip => slip.id === id) || []);
  const documentCandidates = documents.filter(document => !documentIds.includes(document.id))
    .filter(document => !documentQuery.trim() || `${document.name} ${document.fileName}`.toLowerCase().includes(documentQuery.trim().toLowerCase()))
    .slice(0, 30);
  const receiptCandidates = slips.filter(slip => !slipIds.includes(slip.id))
    .filter(slip => !receiptQuery.trim() || `${slip.item} ${slip.shop || ''} ${slip.purchaseDate || ''}`.toLowerCase().includes(receiptQuery.trim().toLowerCase()))
    .slice(0, 30);

  const uploadOriginal = async (file: File) => {
    if (!editable.current || !current() || activeUpload.current) return;
    if (file.size >= 20 * 1024 * 1024) { setError('Choose an original file smaller than 20 MB.'); return; }
    const scope = createFileOperationScope(() => [auth.currentUser?.uid, FAMILY_ID, latest.current.id, epoch.current, editable.current]);
    const name = `${latest.current.name.trim() || 'Asset'} — ${file.name.replace(/\.[^.]+$/, '') || 'original'}`;
    const ticket = {};
    activeUpload.current = ticket; setBusy(true); notifyBusy.current?.(true); setError(null); setStatus(null);
    try {
      const result = demo ? { kind: 'ok' as const, doc: localServiceDoc(file, { name }), allDocs: undefined, deduped: false }
        : await scope.step(() => uploadServiceDocFile(file, { name, scope, shared: true, dedupe: false }));
      scope.check();
      if (result.kind === 'error') { setError(result.message); return; }
      vault.adopt(result.doc, result.allDocs);
      patch({ documentIds: linkAssetEvidence(latest.current.documentIds, result.doc.id) });
      setStatus(demo ? 'Original attached in this demo only.' : 'Original saved in the Vault. Save this asset to keep its link.');
    } catch {
      if (scope.isCurrent()) setError('The original could not be attached. Please try again.');
    } finally {
      if (activeUpload.current === ticket) { activeUpload.current = null; setBusy(false); notifyBusy.current?.(false); }
    }
  };

  const legacyReceipt = assetReceiptSource(item.receiptDataUrl, spaceId);
  return <section className="rounded-2xl border border-cream-300 bg-white p-4 space-y-4" aria-label="Asset evidence">
    <div>
      <h3 className="text-[13px] font-semibold text-ink-900">Receipts & original files</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-500">Keep invoices, warranty terms and ownership evidence together. Uploaded originals keep their file bytes.</p>
    </div>
    <ServiceDocChips ids={documentIds} docs={documents} ownerLabel={business ? 'the team' : 'the family'} onRemove={canEdit ? id => patch({ documentIds: unlinkAssetEvidence(latest.current.documentIds, id) }) : undefined} />
    {documents.filter(document => documentIds.includes(document.id) && document.fileType !== 'application/pdf' && !document.fileType?.startsWith('image/')).map(document => <a key={document.id} href={document.downloadUrl} download={document.fileName} className="inline-flex min-h-[44px] items-center gap-2 text-[12px] text-clay-700 underline"><Download className="h-3.5 w-3.5" />Download original: {document.fileName || document.name}</a>)}
    {!documentIds.length && <p className="text-[12px] text-ink-400">No original files linked yet.</p>}
    {!!documentIds.length && !documents.some(document => documentIds.includes(document.id)) && <p className="text-[12px] text-ink-400">Linked originals will appear when the Vault is available. The links have been kept.</p>}
    {canEdit && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}Upload original</button>
        <button type="button" disabled={busy} onClick={() => setShowDocuments(value => !value)} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40"><FolderOpen className="h-4 w-4" />Choose from Vault</button>
        <input ref={fileRef} type="file" className="hidden" aria-label="Choose original asset evidence" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadOriginal(file); }} />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-400">PDFs, photos or other original files, under 20 MB. New uploads are shared with your {business ? 'team' : 'family'} in the protected Vault. Unlinking keeps the original.</p>
      {showDocuments && <div className="rounded-xl border border-cream-200 p-3 space-y-2">
        <p className="text-[11px] text-ink-400">Saved files keep their existing access settings.</p>
        <label className="relative block"><Search className="absolute left-3 top-3 h-4 w-4 text-ink-300" /><input type="search" className="field w-full pl-9" value={documentQuery} onChange={event => setDocumentQuery(event.target.value)} placeholder="Search saved originals" aria-label="Search saved Vault documents" /></label>
        {documentCandidates.length ? <div className="max-h-56 overflow-y-auto space-y-1">{documentCandidates.map(document => <button key={document.id} type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-cream-50" onClick={() => { patch({ documentIds: linkAssetEvidence(latest.current.documentIds, document.id) }); setShowDocuments(false); }}>
          <DocThumb src={document.downloadUrl} fileType={document.fileType} size="w-9 h-9" alt={document.name} /><span className="min-w-0"><span className="block truncate text-[12px] font-medium text-ink-800">{document.name}</span><span className="block text-[11px] text-ink-400">{document.category} · {document.uploadedAt}</span></span>
        </button>)}</div> : <p className="text-[12px] text-ink-400">{documents.length ? 'No matching unlinked documents.' : 'The Vault may be empty or unavailable. Open the Vault to verify saved originals.'}</p>}
      </div>}
    </>}
    {legacyReceipt && <button type="button" className="flex items-center gap-2 rounded-xl border border-cream-200 p-2 text-left hover:bg-cream-50" onClick={() => setPhoto({ src: legacyReceipt, name: `${item.name} receipt` })}><img src={legacyReceipt} alt="Existing receipt" className="h-12 w-12 rounded-lg object-cover" /><span className="text-[12px] text-ink-700">Open existing receipt photo</span></button>}
    <div className="border-t border-cream-200 pt-4 space-y-3">
      <div className="flex items-center justify-between gap-2"><h4 className="text-[12px] font-semibold text-ink-800">Linked Slips</h4>{canEdit && <button type="button" disabled={busy} onClick={() => setShowReceipts(value => !value)} className="btn-quiet min-h-[44px] text-xs"><Receipt className="h-4 w-4" />Link a receipt</button>}</div>
      {!slipIds.length && <p className="text-[12px] text-ink-400">Link an existing receipt without creating a second copy.</p>}
      {linkedSlips.map(slip => {
        const source = assetReceiptSource(slip.photoUrl, spaceId);
        const details = missingAssetPurchaseDetails(item, slip);
        return <div key={slip.id} className="rounded-xl border border-cream-200 p-3 space-y-2">
          <div className="flex items-start gap-3">
            {source && <button type="button" className="shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-clay-500" aria-label={`Open receipt for ${slip.item}`} onClick={() => setPhoto({ src: source, name: `${slip.item} receipt` })}><img src={source} alt="Receipt photo" className="h-14 w-12 rounded-lg object-cover" /></button>}
            <div className="min-w-0 flex-1"><p className="break-words text-[12px] font-semibold text-ink-800">{slip.item}</p><p className="mt-1 text-[11.5px] text-ink-500">{[slip.shop, slip.purchaseDate, slip.amount ? `${slip.currency || 'EUR'} ${slip.amount}` : undefined].filter(Boolean).join(' · ') || 'Purchase details not recorded'}</p>{slip.returned && <p className="text-[11px] text-ink-400">Marked returned in Slips</p>}</div>
            {canEdit && <button type="button" onClick={() => patch({ slipIds: unlinkAssetEvidence(latest.current.slipIds, slip.id) })} className="p-2 text-ink-400 hover:text-rosa-600" aria-label={`Unlink receipt for ${slip.item}`}><X className="h-4 w-4" /></button>}
          </div>
          {canEdit && <><button type="button" disabled={!Object.keys(details).length} onClick={() => patch(missingAssetPurchaseDetails(latest.current, slip))} className="btn-quiet min-h-[44px] text-xs disabled:opacity-40"><Check className="h-3.5 w-3.5" />Use purchase details</button><p className="text-[11px] leading-relaxed text-ink-400">Fills missing purchase date, shop, price and its currency. Existing values stay unchanged.{receiptCurrencyConflict(item, slip) ? ' The price stays blank while the currencies differ.' : ''}</p></>}
        </div>;
      })}
      {slipIds.some(id => !slips.some(slip => slip.id === id)) && slipState === 'ready' && <p className="text-[11.5px] text-ink-400">Some linked receipts are unavailable. Their links have been kept.</p>}
      {slipState === 'unavailable' && <button type="button" onClick={() => setRetry(value => value + 1)} className="text-[12px] text-rosa-600 underline">Receipts could not be loaded. Retry</button>}
      {canEdit && showReceipts && <div className="rounded-xl border border-cream-200 p-3 space-y-2">
        <input type="search" className="field w-full" value={receiptQuery} onChange={event => setReceiptQuery(event.target.value)} placeholder="Search Slips by item or shop" aria-label="Search saved receipts" />
        {slipState === 'loading' ? <p className="text-[12px] text-ink-400">Loading receipts…</p> : receiptCandidates.length ? <div className="max-h-56 overflow-y-auto space-y-1">{receiptCandidates.map(slip => <button key={slip.id} type="button" className="block min-h-[44px] w-full rounded-lg p-2 text-left hover:bg-cream-50" onClick={() => { patch({ slipIds: linkAssetEvidence(latest.current.slipIds, slip.id) }); setShowReceipts(false); }}><span className="block text-[12px] font-medium text-ink-800">{slip.item}</span><span className="block text-[11px] text-ink-400">{[slip.shop, slip.purchaseDate, slip.amount ? `${slip.currency || 'EUR'} ${slip.amount}` : undefined].filter(Boolean).join(' · ')}</span></button>)}</div> : <p className="text-[12px] text-ink-400">No matching unlinked receipts in Slips.</p>}
      </div>}
    </div>
    {error && <p role="alert" className="text-[12px] text-rosa-700">{error}</p>}
    {status && <p role="status" className="text-[12px] text-sage-700">{status}</p>}
    {photo && <ImageLightbox src={photo.src} name={photo.name} onClose={() => setPhoto(null)} />}
  </section>;
}

function readableSlips(value: unknown): SlipItem[] {
  return Array.isArray(value) ? value.filter(slip => slip && typeof slip.id === 'string' && typeof slip.item === 'string') : [];
}
