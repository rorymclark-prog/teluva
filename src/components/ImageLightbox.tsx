import React from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  src: string | null;
  onClose: () => void;
}

// Full-screen viewer for a profile / family photo. Click anywhere to close.
export default function ImageLightbox({ src, onClose }: Props) {
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
          <motion.img
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            src={src}
            alt="Photo"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(92vw, 90vh)' }}
            className="max-w-[92vw] max-h-[90vh] rounded-3xl shadow-2xl object-contain bg-white"
          />
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-full bg-white/90 text-ink-700 hover:bg-white shadow-soft transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
