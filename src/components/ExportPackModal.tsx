import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FolderDown, X, Check, Share2, Download, Loader2, AlertTriangle, FileText,
} from 'lucide-react';
import { CalendarEvent, FamilyMember, HealthcareProvider, VaultDocument } from '../types';
import {
  ALL_TOPICS, EMAIL_ATTACHMENT_LIMIT_BYTES, PackRequest, PackTopic, TOPIC_LABELS,
  buildPack, formatBytes,
} from '../utils/exportPack';
import { canShare, downloadZip, shareMultiple } from '../utils/share';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

interface Props {
  open: boolean;
  /** What the assistant asked for — or what a screen's own export button asked for. */
  request: PackRequest | null;
  members: readonly FamilyMember[];
  events?: readonly CalendarEvent[];
  vaultDocuments?: readonly VaultDocument[];
  providers?: readonly HealthcareProvider[];
  spaceName?: string;
  onClose: () => void;
}

// The screen between "prepare a folder of Sophie's medical records" and that
// folder leaving the device.
//
// It exists because the assistant chose what goes in. The model can only pick
// topics and people — it never touches the contents (see utils/exportPack.ts)
// — but a wrong pick still matters: too little and a specialist is missing the
// result they needed, too much and financial account numbers travel to a
// school. So the selection is shown as editable checkboxes with real counts
// beside them, and nothing is fetched, zipped or shared until the user acts.
//
// The counts are the honest part. A topic with nothing in it shows "0" rather
// than being hidden, because "her vaccinations are in here" and "we have no
// vaccinations on file" look identical in a folder that simply omits the
// section.
export default function ExportPackModal({
  open, request, members, events, vaultDocuments, providers, spaceName, onClose,
}: Props) {
  useBodyScrollLock(open);

  const [topics, setTopics] = useState<PackTopic[]>([]);
  const [busy, setBusy] = useState<'share' | 'zip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the request every time it's opened, so a second ask in the
  // same session doesn't inherit the first one's edits.
  useEffect(() => {
    if (open && request) {
      setTopics(request.topics);
      setBusy(null);
      setError(null);
    }
  }, [open, request]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  // Rebuilt on every toggle — it is pure string work over data already in
  // memory, so the counts update as the user ticks boxes.
  const pack = useMemo(() => {
    if (!request) return null;
    return buildPack(
      { ...request, topics },
      { members, events, vaultDocuments, providers, spaceName },
    );
  }, [request, topics, members, events, vaultDocuments, providers, spaceName]);

  const people = useMemo(() => {
    if (!request) return [];
    return request.memberIds.length
      ? members.filter((m) => request.memberIds.includes(m.id))
      : [...members];
  }, [request, members]);

  if (!request) return null;

  const toggle = (t: PackTopic) =>
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const summaryFile = pack
    ? { name: 'Summary.md', content: pack.summaryMarkdown }
    : { name: 'Summary.md', content: '' };

  async function handleZip() {
    if (!pack || busy) return;
    setBusy('zip'); setError(null);
    try {
      await downloadZip(pack.files, `${pack.folderName}.zip`, [summaryFile]);
      onClose();
    } catch {
      setError('Could not build the folder. Try again, or use Download instead of Share.');
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!pack || busy) return;
    setBusy('share'); setError(null);
    try {
      // The summary rides along as a real file so whatever receives this —
      // Mail, WhatsApp, an AI app — gets the readable part too, not just a
      // pile of unlabelled scans.
      // A blob URL rather than a base64 data URL: the summary is UTF-8 and can
      // hold any name in the vault, and btoa() throws on the first character
      // above U+00FF. shareMultiple fetches whatever src it is given, so a blob
      // URL works identically and cannot mangle the text.
      const summarySrc = URL.createObjectURL(
        new Blob([pack.summaryMarkdown], { type: 'text/markdown' }),
      );
      try {
        await shareMultiple([
          { src: summarySrc, name: `${pack.folderName} — summary` },
          ...pack.files.map((f) => ({ src: f.src, name: f.name.split('/').pop() || 'file' })),
        ]);
      } finally {
        URL.revokeObjectURL(summarySrc);
      }
      onClose();
    } catch {
      setError('Sharing did not work on this device. Download the folder instead.');
    } finally {
      setBusy(null);
    }
  }

  const tooBigToEmail = (pack?.approxBytes || 0) > EMAIL_ATTACHMENT_LIMIT_BYTES;
  const nothingSelected = topics.length === 0;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={busy ? undefined : onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="dialog" aria-modal="true" aria-labelledby="export-pack-title"
            className="card relative w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-6 z-10"
          >
            <SheetGrabber onClose={onClose} className="mb-3" />

            <div className="flex items-start justify-between gap-3 pb-4 border-b border-cream-200">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl bg-dusk-50 flex items-center justify-center shrink-0">
                  <FolderDown className="w-5 h-5 text-dusk-600" />
                </div>
                <div>
                  <h2 id="export-pack-title" className="font-display text-xl font-bold text-ink-900 leading-tight">
                    {request.title?.trim() || 'Prepare a folder'}
                  </h2>
                  <p className="text-[13px] text-ink-500 mt-0.5">
                    {people.length === 0
                      ? 'Nobody matched — close this and say the name again.'
                      : `For ${people.map((m) => m.name).join(', ')}.`}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose} disabled={!!busy}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer shrink-0 disabled:opacity-40"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="pt-4 space-y-4">
              <p className="text-[13.5px] text-ink-600">
                Tick what should go in. Nothing leaves your phone until you tap Share or Download.
              </p>

              <div className="space-y-1.5">
                {ALL_TOPICS.map((t) => {
                  const on = topics.includes(t);
                  const count = pack?.sections.find((s) => s.topic === t)?.count;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggle(t)}
                      disabled={!!busy}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-colors cursor-pointer disabled:opacity-50 ${
                        on ? 'border-dusk-300 bg-dusk-50/60' : 'border-cream-200 bg-white hover:bg-cream-50'
                      }`}
                      aria-pressed={on}
                    >
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border ${
                        on ? 'bg-dusk-600 border-dusk-600 text-white' : 'border-cream-300 bg-white'
                      }`}>
                        {on && <Check className="w-3 h-3" strokeWidth={3} />}
                      </span>
                      <span className="flex-1 text-[14px] text-ink-800">{TOPIC_LABELS[t]}</span>
                      {on && (
                        <span className={`chip shrink-0 ${
                          count ? 'bg-cream-200 text-ink-600' : 'bg-cream-100 text-ink-400'
                        }`}>
                          {count === 0 ? 'nothing on file' : `${count}`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* What they are actually about to send */}
              <div className="p-4 rounded-2xl bg-cream-50 border border-cream-200 space-y-2">
                <p className="text-[13.5px] text-ink-800 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-ink-500 shrink-0" />
                  <span>
                    <strong>{pack?.files.length ?? 0}</strong> file{pack?.files.length === 1 ? '' : 's'}
                    {' '}plus a written summary
                    {pack && pack.approxBytes > 0 && <> — about <strong>{formatBytes(pack.approxBytes)}</strong></>}
                  </span>
                </p>
                {!!pack?.recordsWithoutFiles && (
                  <p className="text-[12.5px] text-ink-500">
                    {pack.recordsWithoutFiles} record{pack.recordsWithoutFiles === 1 ? '' : 's'} in the summary
                    {pack.recordsWithoutFiles === 1 ? ' has' : ' have'} no scan attached — the details were typed in,
                    not photographed.
                  </p>
                )}
                {tooBigToEmail && (
                  <p className="text-[12.5px] text-honey-700 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Too big to email — most mail providers stop at 25 MB. Download it and send a link,
                    or untick some topics.
                  </p>
                )}
              </div>

              {error && (
                <p className="text-[13px] text-rosa-700 bg-rosa-50 border border-rosa-200 rounded-xl p-3">{error}</p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {canShare && (
                  <button
                    onClick={handleShare}
                    disabled={!!busy || nothingSelected}
                    className="btn-primary flex-1 min-w-[9rem] justify-center disabled:opacity-50"
                  >
                    {busy === 'share'
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>
                      : <><Share2 className="w-4 h-4" /> Share</>}
                  </button>
                )}
                <button
                  onClick={handleZip}
                  disabled={!!busy || nothingSelected}
                  className={`${canShare ? 'btn-quiet' : 'btn-primary'} flex-1 min-w-[9rem] justify-center disabled:opacity-50`}
                >
                  {busy === 'zip'
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Building…</>
                    : <><Download className="w-4 h-4" /> Download</>}
                </button>
              </div>
              <p className="text-[12px] text-ink-400">
                Share hands the files straight to another app — Mail, WhatsApp, an AI assistant.
                Download gives you one .zip to keep or attach yourself.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
