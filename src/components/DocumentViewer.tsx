import React, { useState } from 'react';
import { FamilyDocument } from '../types';
import { getDocumentPlaceholderSvg } from '../utils/svgPlaceholders';
import { X, Download, Share2, Shield, Calendar, Layers, Info, Sparkles, Loader2, Bot } from 'lucide-react';
import { canShare, shareFile } from '../utils/share';
import { canOpenElsewhere, openElsewhere } from '../utils/openElsewhere';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import CopyableValue from './CopyableValue';

interface DocumentViewerProps {
  document: FamilyDocument | null;
  memberName: string;
  onClose: () => void;
  /**
   * When set, the viewer offers "Read the key facts" for a document that has
   * none yet. The HOST runs the pipeline (extract → save → refresh its own
   * state) and the refreshed `document` prop re-renders the chips — the viewer
   * itself only knows busy and failed. Hosts leave this unset for documents
   * that can't be extracted (member-record scans, demo mode, view-only).
   */
  onExtractKeyFacts?: () => Promise<{ ok: boolean; message?: string }>;
  /**
   * The facts on `document` were extracted by an older, worse extractor (or
   * from bytes the file no longer holds) — show a quiet "Read again" under
   * the chips. The host computes this (keyFactsCurrent needs the vault
   * document's hashes/version, which FamilyDocument does not carry).
   */
  factsStale?: boolean;
}

export default function DocumentViewer({ document: doc, memberName, onClose, onExtractKeyFacts, factsStale }: DocumentViewerProps) {
  useBodyScrollLock(!!doc);
  const [factsBusy, setFactsBusy] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);

  const isPdf = doc?.fileType === 'application/pdf';
  // NO exit animation, by design — this supersedes the old "BUG FIX #3" note.
  //
  // This modal used to unmount through AnimatePresence: close → doc null →
  // exit animation → onExitComplete removes the node. With a PDF open, that
  // exit could stall for SECONDS or hang outright (bisected in the browser:
  // an <img> document closed instantly, the same viewer with the PDF
  // <iframe> did not — Chrome's PDF plugin starves the animation's
  // completion). From the outside that is a dead Close button under a
  // full-screen modal, which is how the bug was first hit from TripPack
  // (v265, commit aa369ba sidestepped it host-side).
  //
  // So the viewer now unmounts the moment doc goes null. The entrance still
  // animates — the `anim-fade` / `anim-pop` CSS classes fire on mount and
  // need no JS to finish — and an instant close is fine: nobody mourns a
  // 150ms fade on a modal they asked to leave. Do not reintroduce
  // AnimatePresence here without solving the iframe stall.

  const getDocSource = () => {
    if (!doc) return '';
    if (doc.fileData && doc.fileData !== 'PLACEHOLDER') {
      return doc.fileData;
    }
    return getDocumentPlaceholderSvg(doc.name, doc.category, memberName, doc.uploadedAt);
  };

  const handleDownload = () => {
    if (!doc) return;
    const src = getDocSource();
    const link = document.createElement('a');
    link.href = src;
    link.download = doc.fileName || `${doc.name.toLowerCase()}_copy.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  };

  const categoryChipClass = (cat: string | undefined) => {
    switch (cat) {
      case 'ID':         return 'chip bg-dusk-100 text-dusk-700';
      case 'Health':     return 'chip bg-rosa-100 text-rosa-700';
      case 'Education':  return 'chip bg-sage-100 text-sage-700';
      case 'Travel':     return 'chip bg-honey-100 text-honey-700';
      default:           return 'chip bg-cream-200 text-ink-600';
    }
  };

  if (!doc) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop overlay — entrance via CSS anim-fade, no JS animation */}
          <div
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm anim-fade"
          />

          {/* Modal Window — entrance via CSS anim-pop.

              Overflow is split by breakpoint ON PURPOSE. The container caps at
              90dvh; a grid row, however, grows to its tallest item, so without
              per-column scrolling the container's clipping silently amputates
              whatever sits below the fold — which, once Key facts grew to a
              dozen chips, was the facts themselves and the Read-again button
              ("I can't scroll on the right"). On lg each column gets its own
              90dvh cap + scroll; stacked (mobile) the whole card scrolls as
              one, since two nested scroll areas on a phone fight the thumb. */}
          <div
            className="relative w-full max-w-4xl card rounded-3xl overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12 max-h-[90dvh] anim-pop"
          >
            {/* Left panel: File viewer */}
            <div className="lg:col-span-8 bg-cream-100 flex items-center justify-center p-6 border-b lg:border-b-0 lg:border-r border-cream-200 lg:max-h-[90dvh] overflow-y-auto">
              <div className={`w-full bg-white rounded-2xl shadow-soft overflow-hidden border border-cream-300 relative flex items-center justify-center ${isPdf ? 'max-w-2xl h-[80dvh]' : 'max-w-md aspect-[4/5.6]'}`}>
                {isPdf ? (
                  // #navpanes=0 keeps Chromium's PDF viewer from opening the
                  // page-thumbnail sidebar (a third of an already-split pane);
                  // view=FitH opens the page fitted to the width instead of
                  // whatever zoom the viewer last remembered. Browsers that
                  // ignore PDF open parameters (Safari) simply see the plain
                  // URL — the fragment can only ever improve the default.
                  <iframe src={`${getDocSource()}#navpanes=0&view=FitH`} title={doc.name} className="w-full h-full border-0" />
                ) : (doc.fileType?.startsWith('image/') || doc.fileData === 'PLACEHOLDER' || !doc.fileType) ? (
                  <img
                    src={getDocSource()}
                    alt={doc.name}
                    className="w-full h-full object-contain pointer-events-none"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-center p-8 space-y-3">
                    <div className="w-16 h-16 bg-cream-100 border border-cream-300 rounded-2xl flex items-center justify-center mx-auto text-ink-500 font-bold uppercase text-xs font-mono">
                      {(doc.fileType?.split('/')[1] || 'FILE').slice(0, 4).toUpperCase()}
                    </div>
                    <h3 className="text-sm font-semibold text-ink-800 truncate max-w-xs">{doc.fileName}</h3>
                    <p className="text-xs text-ink-400">Preview isn't available for this file type — download to view.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel: Metadata detail panel */}
            <div className="lg:col-span-4 p-6 flex flex-col justify-between bg-white text-ink-800 lg:max-h-[90dvh] lg:overflow-y-auto">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-cream-200">
                  <span className={categoryChipClass(doc.category)}>
                    {doc.category} Archive
                  </span>

                  <button
                    onClick={onClose}
                    className="p-1.5 text-ink-400 hover:text-ink-700 rounded-xl hover:bg-cream-100 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Document details list */}
                <div className="mt-5 space-y-4">
                  <div>
                    <h3 className="text-xl font-display font-semibold text-ink-900 leading-snug">{doc.name}</h3>
                    <p className="text-[13px] text-ink-400 mt-0.5">Associated to {memberName}</p>
                  </div>

                  <div className="space-y-3 pt-3">
                    <div className="flex items-center gap-2.5 text-xs text-ink-600">
                      <Calendar className="w-4 h-4 text-ink-400 shrink-0" />
                      <div>
                        <p className="section-label mb-0.5">Archived Date</p>
                        <p className="text-ink-800 font-medium tabular-nums">{doc.uploadedAt}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 text-xs text-ink-600">
                      <Layers className="w-4 h-4 text-ink-400 shrink-0" />
                      <div>
                        <p className="section-label mb-0.5">Source Format</p>
                        <p className="text-ink-800 font-mono text-[11px] truncate max-w-[180px] tabular-nums">
                          {doc.fileName} ({formatBytes(doc.fileSize)})
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 text-xs text-ink-600">
                      <Shield className="w-4 h-4 text-ink-400 shrink-0" />
                      <div>
                        <p className="section-label mb-0.5">Storage State</p>
                        <p className="text-sage-600 font-semibold flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-sage-500 animate-ping inline-block"></span>
                          Device-Safe Local Storage
                        </p>
                      </div>
                    </div>
                  </div>

                  {doc.notes && (
                    <div className="p-3.5 rounded-2xl bg-cream-100 border border-cream-200 mt-4">
                      <h4 className="section-label mb-1.5 flex items-center gap-1">
                        <Info className="w-3.5 h-3.5" />
                        Document Notes
                      </h4>
                      <p className="text-[13px] text-ink-600 font-sans leading-relaxed">
                        {doc.notes}
                      </p>
                    </div>
                  )}

                  {/* Key facts — the strings this document exists to give you,
                      lifted out so nobody re-reads nine pages for a phone
                      number. Values are verbatim extracts (see DocKeyFact);
                      a fact read from pixels rather than a text layer says so. */}
                  {(doc.keyFacts?.length || onExtractKeyFacts) && (
                    <div className="p-3.5 rounded-2xl bg-dusk-50 border border-dusk-100 mt-4">
                      <h4 className="section-label mb-1.5 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        Key facts
                      </h4>
                      {doc.keyFacts && doc.keyFacts.length === 0 ? (
                        // Extraction RAN and found nothing — saying so beats
                        // re-offering a button that charges an AI call to
                        // reproduce the same empty answer.
                        <p className="text-[12px] text-ink-500 leading-snug">
                          Nothing liftable found in this one — no phone numbers, references or dates the document states outright.
                        </p>
                      ) : doc.keyFacts?.length ? (
                        <div className="space-y-2">
                          {doc.keyFacts.map((fact) => (
                            <div key={`${fact.label}-${fact.value}`} className="min-w-0">
                              <p className="text-[11px] text-ink-500 leading-tight">
                                {fact.label}
                                {fact.who && <span className="font-semibold text-ink-700"> — {fact.who}</span>}
                                {!fact.verified && <span className="text-honey-700 font-semibold"> · read from a photo</span>}
                              </p>
                              <CopyableValue value={fact.value} label={fact.label} className="text-[13px] font-semibold text-ink-800 tabular-nums break-words">
                                {fact.value}
                              </CopyableValue>
                            </div>
                          ))}
                          {factsStale && onExtractKeyFacts && (
                            <div className="pt-1">
                              <button
                                type="button"
                                disabled={factsBusy}
                                onClick={() => {
                                  setFactsBusy(true);
                                  setFactsError(null);
                                  void onExtractKeyFacts()
                                    .then((r) => { if (!r.ok) setFactsError(r.message || 'Could not read the document — please try again.'); })
                                    .catch(() => setFactsError('Could not read the document — please try again.'))
                                    .finally(() => setFactsBusy(false));
                                }}
                                className="btn-quiet w-full disabled:opacity-60"
                              >
                                {factsBusy
                                  ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Reading the document…</span></>
                                  : <><Sparkles className="w-4 h-4" /><span>Read again — reading has improved</span></>}
                              </button>
                              {factsError && (
                                <p className="text-[12px] text-rosa-700 leading-snug mt-2">{factsError}</p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="text-[12px] text-ink-500 leading-snug mb-2">
                            Phone numbers, reference numbers, dates — pulled out of the document itself, word for word.
                          </p>
                          <button
                            type="button"
                            disabled={factsBusy}
                            onClick={() => {
                              if (!onExtractKeyFacts) return;
                              setFactsBusy(true);
                              setFactsError(null);
                              void onExtractKeyFacts()
                                .then((r) => { if (!r.ok) setFactsError(r.message || 'Could not read the document — please try again.'); })
                                .catch(() => setFactsError('Could not read the document — please try again.'))
                                .finally(() => setFactsBusy(false));
                            }}
                            className="btn-quiet w-full disabled:opacity-60"
                          >
                            {factsBusy
                              ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Reading the document…</span></>
                              : <><Sparkles className="w-4 h-4" /><span>Read the key facts</span></>}
                          </button>
                          {factsError && (
                            <p className="text-[12px] text-rosa-700 leading-snug mt-2">{factsError}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions for right pane footer */}
              <div className="pt-6 border-t border-cream-200 flex flex-col gap-2 mt-6 lg:mt-0">
                <div className={canShare ? 'grid grid-cols-2 gap-2' : ''}>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="btn-primary w-full"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download</span>
                  </button>
                  {canShare && (
                    <button
                      type="button"
                      onClick={() => shareFile(getDocSource(), doc.name)}
                      className="btn-quiet w-full"
                    >
                      <Share2 className="w-4 h-4" />
                      <span>Share</span>
                    </button>
                  )}
                </div>
                {/* Rory: "if we open a lease or any legal doc we must have
                    the choice to open it in ChatGPT or whatever AI app we have
                    downloaded on that device." This is the OS share sheet —
                    the same one behind Share — but named for what people
                    actually want it for. Teluva will not interpret a lease
                    (see DocumentAskModal); handing the file to the app they
                    already chose is the honest alternative. */}
                {canOpenElsewhere && (
                  <button
                    type="button"
                    onClick={() => { void openElsewhere(getDocSource(), doc.name); }}
                    className="btn-quiet w-full"
                  >
                    <Bot className="w-4 h-4" />
                    <span>Open in ChatGPT, Claude or another app</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-quiet w-full"
                >
                  Close View
                </button>
              </div>
            </div>
      </div>
    </div>
  );
}
