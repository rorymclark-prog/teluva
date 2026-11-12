import { useEffect, useState } from 'react';
import { X, Download, Share2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { canShare, srcToFile, shareFile } from '../utils/share';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { DocumentFilePreview } from './DocumentPreview';

interface Props {
  src: string | null;
  videoSrc?: string;
  onClose: () => void;
  /** Optional nicer filename for downloads/shares, e.g. "Mia South African Passport". */
  name?: string;
  /** Optional explicit mime type — more reliable than sniffing the src string. */
  mimeType?: string;
}

// Full-screen viewer for a scan / photo / PDF, with download + native share
// (which is how you email or message a file on mobile). Click the backdrop to close.
export default function ImageLightbox({ src, videoSrc, onClose, name = 'Teluva document', mimeType }: Props) {
  useBodyScrollLock(!!src);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => { setVideoFailed(false); }, [src, videoSrc]);

  // Escape closes it. Without this the ONLY way out is hitting the backdrop or
  // a 40px button in one corner — and a photo sized to the viewport leaves
  // very little backdrop to hit.
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  async function handleDownload() {
    if (!src) return;
    try {
      const file = await srcToFile(src, name);
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(src, '_blank'); // fallback (e.g. cross-origin) — open so they can save manually
    }
  }

  async function handleShare() {
    if (!src) return;
    await shareFile(src, name);
  }

  const btn = 'p-2 rounded-full bg-white/90 text-ink-700 hover:bg-white shadow-soft transition-colors cursor-pointer';

  // Portalled to <body> for the same reason the scanner is: it opens from the
  // chat panel, whose `.glass` backdrop-filter turns it into the containing
  // block for fixed children — in place, this overlay would be trapped inside
  // (and clipped by) the sheet that opened it.
  return createPortal(
    <AnimatePresence>
      {src && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-ink-900/75 backdrop-blur-sm cursor-zoom-out"
        >
          {videoSrc && !videoFailed ? (
            <video
              key={videoSrc}
              src={videoSrc}
              poster={src}
              aria-label="Family profile video"
              controls
              muted
              playsInline
              loop
              autoPlay={window.matchMedia('(prefers-reduced-motion: no-preference)').matches}
              onError={() => setVideoFailed(true)}
              onClick={e => e.stopPropagation()}
              className="max-h-[85dvh] max-w-full rounded-3xl bg-black shadow-2xl"
            />
          ) : (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              onClick={event => event.stopPropagation()}
              className="w-[min(92vw,1000px)] h-[85dvh] rounded-3xl shadow-2xl overflow-hidden cursor-default"
            ><DocumentFilePreview source={src} name={name} mimeType={mimeType} onImageClick={onClose} /></motion.div>
          )}
          <div className="absolute top-5 right-5 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button onClick={handleDownload} className={btn} title="Download">
              <Download className="w-5 h-5" />
            </button>
            {canShare && (
              <button onClick={handleShare} className={btn} title="Share / email">
                <Share2 className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className={btn} title="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
