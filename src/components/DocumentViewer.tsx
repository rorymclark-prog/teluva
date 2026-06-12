import React from 'react';
import { FamilyDocument } from '../types';
import { getDocumentPlaceholderSvg } from '../utils/svgPlaceholders';
import { X, Download, Shield, Calendar, Layers, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DocumentViewerProps {
  document: FamilyDocument | null;
  memberName: string;
  onClose: () => void;
}

export default function DocumentViewer({ document: doc, memberName, onClose }: DocumentViewerProps) {
  // BUG FIX #3: AnimatePresence must always render; the early `if (!doc) return null`
  // was placed before AnimatePresence, so the exit animation never fired. All helper
  // functions that depend on `doc` are now defined unconditionally (safe because they
  // are only called from inside the `doc &&` conditional child).

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

  return (
    <AnimatePresence>
      {doc && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />

          {/* Modal Window */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative w-full max-w-4xl card rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 max-h-[90vh]"
          >
            {/* Left panel: File viewer */}
            <div className="lg:col-span-8 bg-cream-100 flex items-center justify-center p-6 border-b lg:border-b-0 lg:border-r border-cream-300 overflow-y-auto">
              <div className="max-w-md w-full aspect-[4/5.6] bg-white rounded-2xl shadow-soft overflow-hidden border border-cream-300 relative flex items-center justify-center">
                {(doc.fileType?.startsWith('image/') || doc.fileData === 'PLACEHOLDER' || !doc.fileType) ? (
                  <img
                    src={getDocSource()}
                    alt={doc.name}
                    className="w-full h-full object-contain pointer-events-none"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-center p-8 space-y-3">
                    <div className="w-16 h-16 bg-cream-100 border border-cream-300 rounded-2xl flex items-center justify-center mx-auto text-ink-500 font-bold uppercase text-xs font-mono">
                      PDF
                    </div>
                    <h3 className="text-sm font-semibold text-ink-800 truncate max-w-xs">{doc.fileName}</h3>
                    <p className="text-xs text-ink-400">PDF loaded — download to view in full.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel: Metadata detail panel */}
            <div className="lg:col-span-4 p-6 flex flex-col justify-between bg-white text-ink-800">
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
                        <p className="text-ink-800 font-medium">{doc.uploadedAt}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 text-xs text-ink-600">
                      <Layers className="w-4 h-4 text-ink-400 shrink-0" />
                      <div>
                        <p className="section-label mb-0.5">Source Format</p>
                        <p className="text-ink-800 font-mono text-[11px] truncate max-w-[180px]">
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
                </div>
              </div>

              {/* Actions for right pane footer */}
              <div className="pt-6 border-t border-cream-200 flex flex-col gap-2 mt-6 lg:mt-0">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="btn-primary w-full"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Copy</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-quiet w-full"
                >
                  Close View
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
