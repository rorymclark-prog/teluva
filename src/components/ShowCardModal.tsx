import { useEffect, useRef } from 'react';
import { X, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { looksLikePdf } from '../utils/fileType';
import { canShare, shareFile } from '../utils/share';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import CopyableValue from './CopyableValue';

export interface ShowCardField {
  label: string;
  value: string;
  mono?: boolean;   // render value in monospace (card / ID numbers)
  big?: boolean;    // emphasise (the primary number a conductor scans)
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;                 // e.g. "Wiener Linien Jahreskarte"
  subtitle?: string;             // e.g. holder name
  fields?: ShowCardField[];
  scanSrc?: string;              // optional scan/photo of the card
}

// A purpose-built, maximum-legibility full-screen card for SHOWING a document to
// someone (ticket inspector, receptionist, border officer). Big high-contrast
// number, optional scan, screen kept awake. This is the teen "show my card" flow.
export default function ShowCardModal({ open, onClose, title, subtitle, fields = [], scanSrc }: Props) {
  useBodyScrollLock(open);

  const wakeRef = useRef<{ release: () => void } | null>(null);
  const scanIsPdf = !!scanSrc && looksLikePdf(scanSrc);

  // Keep the screen awake while the card is shown (best-effort; ignored where unsupported).
  useEffect(() => {
    if (!open) return;
    let released = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => void }> } };
    nav.wakeLock?.request('screen').then((s) => { if (!released) wakeRef.current = s; }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      released = true;
      document.removeEventListener('keydown', onKey);
      try { wakeRef.current?.release(); } catch { /* no-op */ }
      wakeRef.current = null;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[120] flex items-center justify-center p-5 bg-white cursor-zoom-out"
        >
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10" onClick={(e) => e.stopPropagation()}>
            {canShare && scanSrc && (
              <button
                onClick={() => shareFile(scanSrc, title)}
                className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
                title="Share"
              >
                <Share2 className="w-6 h-6" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2.5 rounded-full bg-ink-900/5 text-ink-500 hover:bg-ink-900/10 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md cursor-default flex flex-col items-center text-center gap-6"
          >
            <div className="w-full rounded-[28px] border-2 border-ink-900/10 bg-gradient-to-br from-cream-50 to-white shadow-2xl p-7 space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-ink-900 leading-tight">{title}</h2>
                {subtitle && <p className="text-[15px] font-medium text-ink-500 mt-1">{subtitle}</p>}
              </div>

              {scanSrc && (
                scanIsPdf ? (
                  <iframe
                    src={scanSrc}
                    title={title}
                    className="w-full h-[42dvh] rounded-2xl bg-white border border-cream-200"
                  />
                ) : (
                  <img
                    src={scanSrc}
                    alt={title}
                    className="w-full max-h-[42dvh] rounded-2xl object-contain bg-white border border-cream-200"
                  />
                )
              )}

              {fields.length > 0 && (
                <div className="space-y-3.5 pt-1">
                  {fields.map((f, i) => (
                    <div key={i}>
                      <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wide">{f.label}</p>
                      <CopyableValue value={f.value} label={f.label}>
                        <p
                          className={`${f.big ? 'text-3xl sm:text-4xl' : 'text-lg'} ${f.mono ? 'font-mono' : 'font-semibold'} text-ink-900 break-words leading-tight`}
                        >
                          {f.value}
                        </p>
                      </CopyableValue>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[13px] text-ink-400">Turn your screen brightness up · tap anywhere to close</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
