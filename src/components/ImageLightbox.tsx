import { X, Download, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { looksLikePdf } from '../utils/fileType';
import { canShare, srcToFile, shareFile } from '../utils/share';

interface Props {
  src: string | null;
  onClose: () => void;
  /** Optional nicer filename for downloads/shares, e.g. "Sophie South African Passport". */
  name?: string;
  /** Optional explicit mime type — more reliable than sniffing the src string. */
  mimeType?: string;
}

// Full-screen viewer for a scan / photo / PDF, with download + native share
// (which is how you email or message a file on mobile). Click the backdrop to close.
export default function ImageLightbox({ src, onClose, name = 'Teluva document', mimeType }: Props) {
  const isPdf = !!src && looksLikePdf(src, mimeType);
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

  return (
    <AnimatePresence>
      {src && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-ink-900/75 backdrop-blur-sm cursor-zoom-out"
        >
          {isPdf ? (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(92vw, 850px)', height: '90vh' }}
              className="rounded-3xl shadow-2xl bg-white overflow-hidden"
            >
              <iframe src={src} title={name} className="w-full h-full border-0" />
            </motion.div>
          ) : (
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              src={src}
              alt={name}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 'min(92vw, 90vh)' }}
              className="max-w-[92vw] max-h-[90vh] rounded-3xl shadow-2xl object-contain bg-white"
            />
          )}
          <div className="absolute top-5 right-5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
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
    </AnimatePresence>
  );
}
