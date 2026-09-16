/* ---------------------------------------------------------------------------
 * "Attach receipt or invoice" for a service entry, and the chips that show
 * what is attached.
 *
 * Rory, 2026-09-12: "i just had a bicycle service for example where does the
 * receiot and document of the service live? … imagine i had a dishwasher
 * service where do we keep it? the document". The file goes into the Document
 * Vault (so it is searchable, shareable and backed up with everything else)
 * and the entry keeps its id. Shared by the vehicle service log and the
 * house's "Work done" log so the two can never offer different ways in.
 *
 * Three ways in, all labelled, all one tap from the entry:
 *   Scan         — the app's own DocumentScannerModal (existing props only)
 *   Choose a file — a photo or PDF already on the phone
 *   From the vault — a document the family already filed
 *
 * LAYERING. The scanner portals itself to <body>, so it stacks over the
 * vehicle sheet (both are z-50; the later node wins). DocumentViewer is NOT
 * portalled, and the vehicle sheet's overlay has backdrop-filter — which makes
 * it the containing block for any `position: fixed` inside it, so a viewer
 * rendered in place would scroll away with the form. It is portalled here.
 * ------------------------------------------------------------------------- */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, FileUp, FolderOpen, Loader2, Paperclip, Search, X } from 'lucide-react';
import type { VaultDocument } from '../types';
import type { ScannedFile } from './DocumentScannerModal';
import DocThumb from './DocThumb';
import DocumentViewer from './DocumentViewer';
import { loadDocuments } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { toFamilyDoc } from '../utils/vaultDoc';
import { missingDocCount, resolveDocIds } from '../utils/serviceDocs';
import { dataUrlToFile, localServiceDoc, uploadServiceDocFile } from '../utils/serviceDocUpload';

// Lazy for the same reason InMemoryView lazies it: the scanner pulls in the
// PDF compiler and the corner detector, and most visits never open it.
const DocumentScannerModal = React.lazy(() => import('./DocumentScannerModal'));

/**
 * The vault's documents, live. Demo mode has no vault, so there the list is
 * only what was attached in this tab (see localServiceDoc).
 */
export function useVaultDocs(demo: boolean) {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  useEffect(() => {
    if (demo) return;
    let active = true;
    loadDocuments().then((d) => { if (active) setDocs(d || []); }).catch(() => {});
    return () => { active = false; };
  }, [demo]);
  useSharedDoc<{ docs: VaultDocument[] }>('documents', (v) => setDocs(v.docs || []), { disabled: demo });
  /** Adopt a just-filed document (and the post-save list when we have it). */
  const adopt = (doc: VaultDocument, all?: VaultDocument[]) =>
    setDocs((prev) => (all ? all : prev.some((d) => d.id === doc.id) ? prev : [doc, ...prev]));
  return { docs, adopt };
}

/** Attached documents as thumbnails that open in the viewer. */
export function ServiceDocChips({ ids, docs, onRemove, ownerLabel = 'the family', className = '' }: {
  ids?: string[];
  docs: VaultDocument[];
  /** The viewer's "Associated to …" line — "the team" in a business space. */
  ownerLabel?: string;
  /** Unlink from THIS entry. Never deletes the file from the vault. */
  onRemove?: (id: string) => void;
  className?: string;
}) {
  const [viewing, setViewing] = useState<VaultDocument | null>(null);
  const attached = resolveDocIds(ids, docs);
  const missing = missingDocCount(ids, docs);
  // Before the vault has loaded every id looks "missing" — say nothing rather
  // than flash "removed from the vault" at someone who removed nothing.
  const vaultLoaded = docs.length > 0;
  if (attached.length === 0 && (!missing || !vaultLoaded)) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {attached.map((d) => (
        <span key={d.id} className="inline-flex items-center gap-1 rounded-lg border border-cream-200 bg-white pr-1 max-w-full">
          <button
            type="button"
            onClick={() => setViewing(d)}
            className="inline-flex items-center gap-1.5 p-1 min-w-0 text-left hover:bg-cream-50 rounded-lg"
            title={`Open ${d.name}`}
          >
            <DocThumb src={d.downloadUrl} fileType={d.fileType} size="w-8 h-8" alt={d.name} />
            <span className="text-[11.5px] font-medium text-ink-700 truncate max-w-[11rem]">{d.name}</span>
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(d.id)}
              className="p-1 text-ink-300 hover:text-rosa-500 shrink-0"
              aria-label={`Remove ${d.name} from this entry (it stays in the Document Vault)`}
              title="Remove from this entry — it stays in the Document Vault"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {missing > 0 && vaultLoaded && (
        <span className="text-[11px] text-ink-400 italic">
          {missing === 1 ? '1 document was' : `${missing} documents were`} removed from the Document Vault
        </span>
      )}
      {viewing && createPortal(
        <DocumentViewer document={toFamilyDoc(viewing)} memberName={ownerLabel} onClose={() => setViewing(null)} />,
        document.body,
      )}
    </div>
  );
}

/** The "Attach receipt or invoice" control. */
export function AttachServiceDoc({ docs, ids, onAttach, onAdopt, autoName, memberId, demo = false, disabled = false }: {
  docs: VaultDocument[];
  ids?: string[];
  onAttach: (docId: string) => void;
  onAdopt: (doc: VaultDocument, all?: VaultDocument[]) => void;
  /** Called at attach time, so the name reflects the date/work typed so far. */
  autoName: () => string;
  memberId?: string;
  demo?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerEverOpened, setScannerEverOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const file = async (f: File) => {
    setBusy(true); setStatus(null);
    const name = autoName();
    try {
      if (demo) {
        const doc = localServiceDoc(f, { name, memberId });
        onAdopt(doc);
        onAttach(doc.id);
        setStatus({ tone: 'ok', text: `Attached “${doc.name}”. (Demo: it isn’t saved anywhere.)` });
        setOpen(false);
        return;
      }
      const res = await uploadServiceDocFile(f, { name, memberId });
      if (res.kind === 'error') { setStatus({ tone: 'error', text: res.message }); return; }
      onAdopt(res.doc, res.allDocs);
      onAttach(res.doc.id);
      setStatus({
        tone: 'ok',
        text: res.deduped
          ? `That file was already in the Document Vault as “${res.doc.name}” — attached it.`
          : `Saved to the Document Vault as “${res.doc.name}”.`,
      });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const onScanned = async (s: ScannedFile) => {
    setScannerOpen(false);
    const f = await dataUrlToFile(s.data, s.name, s.type);
    await file(f);
  };

  const candidates = useMemo(() => {
    const have = new Set(ids || []);
    const q = query.trim().toLowerCase();
    return [...docs]
      .filter((d) => !have.has(d.id))
      .filter((d) => !q || d.name.toLowerCase().includes(q) || (d.fileName || '').toLowerCase().includes(q))
      .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''))
      .slice(0, 30);
  }, [docs, ids, query]);

  return (
    <div className="space-y-2">
      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setStatus(null); }}
          disabled={disabled || busy}
          className="btn-quiet text-[11px] px-3 py-1.5 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />} Attach receipt or invoice
        </button>
      ) : (
        <div className="rounded-xl border border-cream-200 bg-white p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11.5px] font-semibold text-ink-700">Attach receipt or invoice</p>
            <button type="button" onClick={() => { setOpen(false); setPicking(false); }} className="p-1 text-ink-300 hover:text-ink-600" aria-label="Close attach options"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => { setScannerEverOpened(true); setScannerOpen(true); }} className="btn-quiet text-[11px] px-3 py-1.5 disabled:opacity-40">
              <Camera className="w-3 h-3" /> Scan
            </button>
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn-quiet text-[11px] px-3 py-1.5 disabled:opacity-40">
              <FileUp className="w-3 h-3" /> Choose a file
            </button>
            <button type="button" disabled={busy} onClick={() => setPicking((p) => !p)} className={`btn-quiet text-[11px] px-3 py-1.5 disabled:opacity-40 ${picking ? 'bg-cream-100' : ''}`}>
              <FolderOpen className="w-3 h-3" /> From the vault
            </button>
            {busy && <span className="inline-flex items-center gap-1 text-[11px] text-ink-400"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>}
          </div>
          <p className="text-[10.5px] text-ink-400">Scanned and chosen files are saved to your Document Vault under Financial, named after this entry.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void file(f); }}
          />
          {picking && (
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="w-3 h-3 text-ink-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the vault" className="field w-full text-[12px] pl-7" />
              </div>
              {candidates.length === 0 ? (
                <p className="text-[11px] text-ink-400 px-1">{docs.length === 0 ? 'Nothing in the Document Vault yet.' : 'No matching documents.'}</p>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {candidates.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => { onAttach(d.id); setPicking(false); setOpen(false); setStatus({ tone: 'ok', text: `Attached “${d.name}”.` }); }}
                      className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-cream-50 text-left"
                    >
                      <DocThumb src={d.downloadUrl} fileType={d.fileType} size="w-8 h-8" alt={d.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium text-ink-800 truncate">{d.name}</span>
                        <span className="block text-[10.5px] text-ink-400 tabular-nums">{d.category} · {d.uploadedAt}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {status && (
        <p role={status.tone === 'error' ? 'alert' : 'status'} className={`text-[11px] ${status.tone === 'error' ? 'text-rosa-600' : 'text-sage-700'}`}>{status.text}</p>
      )}
      {scannerEverOpened && (
        <React.Suspense fallback={null}>
          <DocumentScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onUse={onScanned}
            title="Scan the receipt"
            subtitle="Line it up and hold steady"
            scanType="document"
            filePrefix="service-receipt"
          />
        </React.Suspense>
      )}
    </div>
  );
}
