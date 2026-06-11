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
  if (!doc) return null;

  const getDocSource = () => {
    if (doc.fileData && doc.fileData !== 'PLACEHOLDER') {
      return doc.fileData;
    }
    // Return pristine generated premium SVG vector
    return getDocumentPlaceholderSvg(doc.name, doc.category, memberName, doc.uploadedAt);
  };

  const docSrc = getDocSource();
  const isImage = doc.fileType?.startsWith('image/') || doc.fileData === 'PLACEHOLDER' || !doc.fileType;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = docSrc;
    link.download = doc.fileName || `${doc.name.toLowerCase()}_copy.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Human bytes converter
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop overlay */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/75 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-4xl bg-white rounded-2xl overflow-hidden shadow-2xl border border-slate-100/20 grid grid-cols-1 lg:grid-cols-12 max-h-[90vh]"
        >
          {/* Left panel: File viewer */}
          <div className="lg:col-span-8 bg-slate-100 flex items-center justify-center p-6 border-b lg:border-b-0 lg:border-r border-slate-200 overflow-y-auto">
            <div className="max-w-md w-full aspect-[4/5.6] bg-white rounded-xl shadow-md overflow-hidden border border-slate-200/80 relative flex items-center justify-center">
              {isImage ? (
                <img
                  src={docSrc}
                  alt={doc.name}
                  className="w-full h-full object-contain pointer-events-none"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="text-center p-8 space-y-3">
                  <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center mx-auto text-slate-400 font-bold uppercase text-xs">
                    PDF
                  </div>
                  <h3 className="text-sm font-bold text-slate-800 truncate max-w-xs">{doc.fileName}</h3>
                  <p className="text-xs text-slate-400">PDF Reader representation securely loaded.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right panel: Metadata detail panel */}
          <div className="lg:col-span-4 p-6 flex flex-col justify-between bg-white text-slate-800">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <span className={`text-[10px] font-bold tracking-widest px-2.5 py-0.5 rounded-md uppercase ${
                  doc.category === 'ID' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/30' :
                  doc.category === 'Health' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/30' :
                  doc.category === 'Travel' ? 'bg-sky-50 text-sky-700 border border-sky-100/30' :
                  doc.category === 'Education' ? 'bg-violet-50 text-violet-700 border border-violet-100/30' :
                  'bg-slate-50 text-slate-700 border border-slate-150/30'
                }`}>
                  {doc.category} Archive
                </span>
                
                <button
                  onClick={onClose}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Document details list */}
              <div className="mt-5 space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 leading-snug">{doc.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Associated to {memberName}</p>
                </div>

                <div className="space-y-3 pt-3">
                  <div className="flex items-center gap-2.5 text-xs text-slate-600">
                    <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-500 text-[10px] uppercase tracking-wider">Archived Date</p>
                      <p className="text-slate-800 font-medium">{doc.uploadedAt}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 text-xs text-slate-600">
                    <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-500 text-[10px] uppercase tracking-wider">Source Format</p>
                      <p className="text-slate-800 font-mono text-[11px] truncate max-w-[180px]">
                        {doc.fileName} ({formatBytes(doc.fileSize)})
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 text-xs text-slate-600">
                    <Shield className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-500 text-[10px] uppercase tracking-wider">Storage State</p>
                      <p className="text-emerald-700 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                        Device-Safe Local Storage
                      </p>
                    </div>
                  </div>
                </div>

                {doc.notes && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 mt-4">
                    <h4 className="text-[10px] font-bold text-slate-400 tracking-wider uppercase mb-1 flex items-center gap-1">
                      <Info className="w-3.5 h-3.5" />
                      Document Notes
                    </h4>
                    <p className="text-xs text-slate-600 font-sans leading-relaxed">
                      {doc.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions for right pane footer */}
            <div className="pt-6 border-t border-slate-100 flex flex-col gap-2 mt-6 lg:mt-0">
              <button
                type="button"
                onClick={handleDownload}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Secure Copy</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
