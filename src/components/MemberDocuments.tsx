import React, { useState, useRef, useEffect, Suspense } from 'react';
import { FamilyDocument, FamilyMember } from '../types';
import { getDocumentPlaceholderSvg } from '../utils/svgPlaceholders';
import {
  FileText, Upload, Eye, Download, Plus,
  Sparkles, FileImage, ShieldCheck, AlertCircle,
  Camera, X, RefreshCcw, AlertTriangle, CheckSquare, Share2, Check, Loader2,
  MessageCircleQuestion
} from 'lucide-react';
import DocumentAskModal from './DocumentAskModal';
import { canAskAboutDocument } from '../utils/docReadEligibility';
import { motion } from 'motion/react';
import { hashDataUrl, findLikelyDuplicate, findLikelyDuplicateByType, DupMatch } from '../utils/documentDedup';
import { canShare, shareFile, shareMultiple, downloadZip } from '../utils/share';
import { compileImageToPdf } from '../utils/pdfCompile';
import PdfThumbnail from './PdfThumbnail';
import { ScannedFile } from './DocumentScannerModal';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import EmptyState from './EmptyState';

// Heavy component (camera UI + jsPDF for compiling scanned pages) — lazy-loaded
// so its weight doesn't ship in the main bundle for users who never open the scanner.
const DocumentScannerModal = React.lazy(() => import('./DocumentScannerModal'));

interface MemberDocumentsProps {
  member: FamilyMember;
  onAddDocument: (id: string, document: FamilyDocument) => void;
  // Returns a promise now: deleting also clears the shared vault copy and the
  // stored file, so callers that save straight afterwards must be able to wait.
  onDeleteDocument: (memberId: string, documentId: string) => void | Promise<void>;
  onViewDocument: (doc: FamilyDocument, memberName: string) => void;
  isBusinessSpace?: boolean;
}

const CATEGORIES: ('ID' | 'Health' | 'Education' | 'Travel' | 'Other')[] = [
  'ID', 'Health', 'Education', 'Travel', 'Other'
];

// Family-oriented categories that don't make sense inside a Business space
// (mirrors the HIDDEN_IN_BUSINESS pattern in Dashboard.tsx).
const HIDDEN_IN_BUSINESS: ('ID' | 'Health' | 'Education' | 'Travel' | 'Other')[] = ['Health', 'Education'];

// BUG FIX #1: uploadedAt was using new Date().toISOString().split('T')[0] which
// produces a UTC date that can be one day behind in local timezones after midnight.
// Use en-CA locale (YYYY-MM-DD format) so the date reflects local wall-clock time.
const todayLocal = () => new Date().toLocaleDateString('en-CA');

// BUG FIX #2: 700 KB file-size guard. Files are stored as base64 inside Firestore
// documents (1 MB hard limit). Reject anything over 700 KB before reading to prevent
// silent failures or Firestore write errors.
const MAX_UPLOAD_BYTES = 700 * 1024;

// Category chip styling
const categoryChipClass = (cat: string) => {
  switch (cat) {
    case 'ID':         return 'chip bg-dusk-100 text-dusk-700';
    case 'Health':     return 'chip bg-rosa-100 text-rosa-700';
    case 'Education':  return 'chip bg-sage-100 text-sage-700';
    case 'Travel':     return 'chip bg-honey-100 text-honey-700';
    default:           return 'chip bg-cream-200 text-ink-600';
  }
};

export default function MemberDocuments({
  member,
  onAddDocument,
  onDeleteDocument,
  onViewDocument,
  isBusinessSpace
}: MemberDocumentsProps) {
  const categories = isBusinessSpace ? CATEGORIES.filter(c => !HIDDEN_IN_BUSINESS.includes(c)) : CATEGORIES;
  const [docName, setDocName] = useState('');
  const [category, setCategory] = useState<'ID' | 'Health' | 'Education' | 'Travel' | 'Other'>('ID');
  const [notes, setNotes] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFileData, setPendingFileData] = useState<{
    data: string;
    name: string;
    type: string;
    size: number;
  } | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<DupMatch<FamilyDocument> | null>(null);
  const [pendingHash, setPendingHash] = useState<string>('');
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [askingDoc, setAskingDoc] = useState<FamilyDocument | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<'share' | 'zip' | null>(null);
  const [isPdfCompiling, setIsPdfCompiling] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Mount the (lazy) scanner once, the first time it's actually opened, and
  // never unmount it again — otherwise an always-rendered-with-an-open-prop
  // lazy component downloads its chunk on first paint regardless, same as if
  // it were never lazy at all. See Dashboard.tsx's ExportPackModal for the
  // same pattern, and the same reasoning.
  const [scannerEverOpened, setScannerEverOpened] = useState(false);
  useEffect(() => { if (scannerOpen) setScannerEverOpened(true); }, [scannerOpen]);
  // The archive list's OWN filter. It is deliberately separate state from
  // `category` above: those chips set the category of the document being
  // uploaded, but they read like a filter, so picking "Health" and still
  // seeing a marriage certificate below looked broken. The two controls are
  // now separated, labelled and styled differently so they can't be confused.
  const [archiveFilter, setArchiveFilter] = useState<'All' | FamilyDocument['category']>('All');

  const handleScannerResult = (file: ScannedFile) => {
    setPendingFileData({ data: file.data, name: file.name, type: file.type, size: file.size });
    setSelectedFileName(`${file.type === 'application/pdf' ? 'Scanned PDF' : 'Camera Scan'} (${formatBytes(file.size)})`);
    if (!docName.trim()) {
      const todayString = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      setDocName(`Camera Capture ${todayString}`);
    }
  };

  const handleCompileToPdf = async () => {
    if (!pendingFileData || !pendingFileData.type.startsWith('image/')) return;
    setIsPdfCompiling(true);
    setFileError(null);
    try {
      const compiled = await compileImageToPdf(pendingFileData.data, pendingFileData.name);

      if (compiled.size > MAX_UPLOAD_BYTES) {
        setFileError(
          `Compiled PDF is ${formatBytes(compiled.size)} — still too large for cloud sync (limit 700 KB). ` +
          'Please use a smaller or more compressed image.'
        );
        setIsPdfCompiling(false);
        return;
      }

      setPendingFileData({
        data: compiled.data,
        name: compiled.name,
        type: 'application/pdf',
        size: compiled.size,
      });
      setSelectedFileName(`${compiled.name} (${formatBytes(compiled.size)})`);

      if (!docName.trim()) {
        const titleName = compiled.name.replace(/\.[^/.]+$/, "");
        setDocName(titleName);
      }
    } catch (err: any) {
      console.error(err);
      setFileError('Failed to compile image into a PDF file.');
    } finally {
      setIsPdfCompiling(false);
    }
  };

  // BUG FIX #2 (continued): 700 KB guard in the main file-upload path.
  // Previously the guard was 3.5 MB, which is far too large for Firestore's 1 MB doc limit.
  const processFile = (file: File) => {
    setFileError(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(
        `"${file.name}" is ${formatBytes(file.size)} — too large for cloud sync. ` +
        'Files must be under 700 KB to fit inside the family document. ' +
        'Try a compressed JPEG photo or a reduced-resolution scan.'
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result && typeof e.target.result === 'string') {
        setPendingFileData({
          data: e.target.result,
          name: file.name,
          type: file.type,
          size: file.size,
        });
        setSelectedFileName(file.name);
      }
    };
    reader.onerror = () => {
      setFileError('Failed to read the file. Try a different format.');
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const resetUploadForm = () => {
    setDocName('');
    setCategory('ID');
    setNotes('');
    setPendingFileData(null);
    setSelectedFileName(null);
    setDuplicateMatch(null);
    setPendingHash('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveNewDoc = (contentHash: string) => {
    if (!pendingFileData) return;
    const newDoc: FamilyDocument = {
      id: 'doc-' + Date.now().toString(),
      name: docName.trim(),
      category,
      fileType: pendingFileData.type,
      fileName: pendingFileData.name,
      fileSize: pendingFileData.size,
      // BUG FIX #1: use todayLocal() so the date reflects local wall-clock time,
      // not UTC (which can be a day behind after midnight in positive-offset timezones).
      uploadedAt: todayLocal(),
      notes: notes.trim() || undefined,
      fileData: pendingFileData.data,
      contentHash,
    };
    onAddDocument(member.id, newDoc);
    resetUploadForm();
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim() || !pendingFileData) return;

    setCheckingDuplicate(true);
    try {
      const hash = await hashDataUrl(pendingFileData.data);
      const sameCategory = (member.documents || []).filter((d) => d.category === category);
      const match = findLikelyDuplicate(
        { fileName: pendingFileData.name, fileSize: pendingFileData.size, contentHash: hash },
        member.documents || [],
      ) || findLikelyDuplicateByType(docName.trim(), sameCategory);
      if (match) {
        setDuplicateMatch(match);
        setPendingHash(hash);
        return; // wait for the user to choose Replace or Keep both
      }
      saveNewDoc(hash);
    } finally {
      setCheckingDuplicate(false);
    }
  };

  // MUST await the delete before saving the replacement. The delete is now a
  // multi-store operation (member record + vault + Storage), so firing it and
  // immediately adding the new document would let the delete's member-record
  // write land LAST and take the replacement down with it.
  const resolveDuplicateReplace = async () => {
    if (!duplicateMatch) return;
    setCheckingDuplicate(true);
    try {
      await onDeleteDocument(member.id, duplicateMatch.doc.id);
    } finally {
      setCheckingDuplicate(false);
    }
    saveNewDoc(pendingHash);
  };

  const resolveDuplicateKeepBoth = () => {
    saveNewDoc(pendingHash);
  };

  const getDocSource = (doc: FamilyDocument) => {
    if (doc.fileData && doc.fileData !== 'PLACEHOLDER') {
      return doc.fileData;
    }
    return getDocumentPlaceholderSvg(doc.name, doc.category, member.name, doc.uploadedAt);
  };

  // Only documents whose REAL bytes we hold may be read. getDocSource above
  // falls back to a placeholder SVG that this app drew itself, and pointing the
  // reader at one would search a picture of a filename and truthfully report
  // that it says nothing about repairs — the single most dangerous sentence
  // this feature can produce, manufactured out of our own artwork.
  const askableDoc = (doc: FamilyDocument) =>
    !!doc.fileData
    && doc.fileData !== 'PLACEHOLDER'
    && canAskAboutDocument({ category: doc.category, name: doc.name, fileType: doc.fileType, isBusinessSpace });

  const handleDownload = (doc: FamilyDocument) => {
    const src = getDocSource(doc);
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
    const dm = 1;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const toggleSelectMode = () => {
    setSelectMode(v => !v);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allDocs = member.documents || [];
  const countInCategory = (cat: FamilyDocument['category']) => allDocs.filter(d => d.category === cat).length;
  // Offer every category this space uses, plus any category that legacy
  // documents actually sit in (a Health scan filed before this became a
  // Business space, say) — otherwise those documents would be unreachable
  // from the filter, which is exactly the silent-hiding this fix is about.
  const filterOptions: ('All' | FamilyDocument['category'])[] = [
    'All',
    ...categories,
    ...CATEGORIES.filter(c => !categories.includes(c) && countInCategory(c) > 0),
  ];
  const visibleDocs = archiveFilter === 'All' ? allDocs : allDocs.filter(d => d.category === archiveFilter);
  const hiddenCount = allDocs.length - visibleDocs.length;

  // Selection is scoped to what's on screen — sharing or zipping a document the
  // filter is hiding would be a surprise.
  const selectedDocs = visibleDocs.filter(d => selectedIds.has(d.id));

  const handleShareSelected = async () => {
    if (!selectedDocs.length) return;
    setExporting('share');
    try {
      await shareMultiple(selectedDocs.map(d => ({ src: getDocSource(d), name: d.fileName || d.name })));
    } finally {
      setExporting(null);
    }
  };

  const handleZipSelected = async () => {
    if (!selectedDocs.length) return;
    setExporting('zip');
    try {
      await downloadZip(
        selectedDocs.map(d => ({ src: getDocSource(d), name: d.fileName || d.name })),
        `${member.name.replace(/\s+/g, '-').toLowerCase()}-documents-${new Date().toISOString().slice(0, 10)}.zip`,
      );
    } catch (e) {
      console.error('Zip export failed:', e);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="border-b border-cream-200 pb-4">
        <h3 className="text-xl font-display font-semibold text-ink-900 flex items-center gap-2">
          <span className="w-1.5 h-4 bg-clay-400 rounded-full inline-block"></span>
          Document Archives
        </h3>
        <p className="text-[13px] text-ink-500 mt-1">
          Upload photo cards, birth certificates, dental logs, or medical records. Files sync to your family's cloud document.
        </p>
      </div>

      {/* Upload document panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form onSubmit={handleUploadSubmit} className="lg:col-span-12 xl:col-span-4 space-y-4 card p-4">
          <h4 className="text-[13px] font-semibold text-ink-600 flex items-center gap-1.5 pb-2 border-b border-cream-200">
            <Plus className="w-3.5 h-3.5 text-clay-500" />
            Upload New Document
          </h4>

          <div>
            <label className="field-label">Document Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Birth Certificate"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label className="field-label">Category</label>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1 text-[13px] font-semibold rounded-xl transition-all cursor-pointer ${
                    category === cat
                      ? 'bg-ink-800 text-white shadow-soft'
                      : 'bg-white text-ink-600 border border-cream-300 hover:bg-cream-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Drag & Drop / Click upload zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={triggerFileInput}
            className={`border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer ${
              isDragging
                ? 'border-clay-400 bg-clay-50'
                : 'border-cream-300 bg-white hover:border-cream-400'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              accept="image/*,application/pdf"
              className="hidden"
            />

            <div className="flex flex-col items-center">
              <Upload className={`w-7 h-7 mb-2 ${isDragging ? 'text-clay-500' : 'text-ink-400'}`} />
              <p className="text-[13px] font-semibold text-ink-700">
                {selectedFileName ? 'Document loaded' : 'Drag & drop or click to upload'}
              </p>
              <p className="text-[12px] text-ink-400 mt-1">
                {selectedFileName ? selectedFileName : 'Image or PDF — max 700 KB'}
              </p>
            </div>
          </div>

          {pendingFileData && pendingFileData.type.startsWith('image/') && (
            <div className="p-3 bg-dusk-50 border border-dusk-100 rounded-xl space-y-1.5 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-dusk-700 flex items-center gap-1.5">
                  <FileImage className="w-3.5 h-3.5" />
                  Image loaded
                </span>
                <button
                  type="button"
                  onClick={handleCompileToPdf}
                  disabled={isPdfCompiling}
                  className="px-3 py-1 bg-dusk-500 hover:bg-dusk-700 text-white rounded-xl text-[12px] font-semibold flex items-center gap-1 cursor-pointer select-none active:scale-95 transition-all"
                >
                  {isPdfCompiling ? (
                    <>
                      <RefreshCcw className="w-3 h-3 animate-spin" />
                      <span>Compiling…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      <span>Compile to PDF</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[12px] text-dusk-700 leading-snug">
                Convert the image to a single-page PDF for better compression before storing.
              </p>
            </div>
          )}

          {/* Camera scan button */}
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="btn-quiet w-full"
          >
            <Camera className="w-4 h-4" />
            <span>Scan via Device Camera</span>
          </button>

          {/* BUG FIX #2: Warm-styled inline file-size error */}
          {fileError && (
            <div className="p-3 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2 leading-normal">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
              <span>{fileError}</span>
            </div>
          )}

          <div>
            <label className="field-label">Notes or identifiers</label>
            <textarea
              rows={2}
              placeholder="e.g. Hospital record. Code: BC-994"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="field"
            />
          </div>

          {duplicateMatch && (
            <div className="p-3 rounded-xl bg-honey-50 border border-honey-200 text-[13px] text-honey-800 space-y-2">
              <p className="flex items-start gap-2 leading-normal">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This looks like it might already be saved as “{duplicateMatch.doc.name}”.
                  {duplicateMatch.confidence === 'probable' && ' Same filename and size.'}
                  {duplicateMatch.confidence === 'probable-type' && ' Looks like the same kind of document, just under a different name.'}
                </span>
              </p>
              {/* "Replace" deletes the old copy through the same
                  everywhere-delete path, so say so — it clears the vault copy
                  too, which is precisely what stops the AI from later
                  refusing this new scan as a duplicate of the old one. */}
              <p className="text-[12px] leading-snug">Replacing deletes the old copy everywhere, including the shared Document Vault.</p>
              <div className="flex gap-2">
                <button type="button" onClick={resolveDuplicateReplace} disabled={checkingDuplicate} className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center disabled:opacity-50">
                  {checkingDuplicate ? 'Replacing…' : 'Replace existing'}
                </button>
                <button type="button" onClick={resolveDuplicateKeepBoth} disabled={checkingDuplicate} className="btn-quiet text-xs px-3 py-1.5 flex-1 justify-center disabled:opacity-50">
                  Keep both
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!pendingFileData || !docName.trim() || checkingDuplicate || !!duplicateMatch}
            className={`w-full py-2.5 rounded-2xl text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
              !pendingFileData || !docName.trim() || checkingDuplicate || !!duplicateMatch
                ? 'bg-cream-200 text-ink-400 cursor-not-allowed'
                : 'btn-primary'
            }`}
          >
            {checkingDuplicate ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>{checkingDuplicate ? 'Checking…' : 'Save Document'}</span>
          </button>
        </form>

        {/* Existing documents catalog */}
        <div className="lg:col-span-12 xl:col-span-8 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-ink-600">
              Archives ({archiveFilter === 'All' ? allDocs.length : `${visibleDocs.length} of ${allDocs.length}`})
            </h4>
            <div className="flex items-center gap-2">
              {allDocs.length > 0 && (
                <button
                  type="button"
                  onClick={toggleSelectMode}
                  className="btn-quiet text-xs px-3 py-1.5"
                  title={selectMode ? 'Exit selection' : 'Select documents to export or share'}
                >
                  {selectMode ? <X className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                  {selectMode ? 'Cancel' : 'Select'}
                </button>
              )}
              <span className="chip bg-sage-100 text-sage-700 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                Synced to your family
              </span>
            </div>
          </div>

          {/* Archive filter — underline tabs, deliberately NOT the solid pills
              the upload form uses for its Category picker, so the two controls
              can never be mistaken for each other again. */}
          {allDocs.length > 0 && (
            <div className="border-b border-cream-200">
              <p className="text-[12px] font-semibold text-ink-400 uppercase tracking-wide mb-1">Filter archives</p>
              <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                {filterOptions.map((opt) => {
                  const count = opt === 'All' ? allDocs.length : countInCategory(opt);
                  const active = archiveFilter === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setArchiveFilter(opt)}
                      className={`px-2.5 py-1.5 -mb-px text-[13px] font-semibold border-b-2 transition-colors cursor-pointer ${
                        active
                          ? 'border-clay-500 text-clay-700'
                          : 'border-transparent text-ink-500 hover:text-ink-800'
                      }`}
                    >
                      {opt} <span className="font-normal text-ink-400 tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectMode && (
            <div className="p-3.5 rounded-2xl bg-clay-50 border border-clay-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <p className="text-[13px] font-semibold text-clay-900">
                  {selectedDocs.length === 0 ? 'Tap documents to select them' : `${selectedDocs.length} selected`}
                  {selectedDocs.length > 0 && (
                    <span className="text-clay-600 font-normal"> · {formatBytes(selectedDocs.reduce((sum, d) => sum + (d.fileSize || 0), 0))}</span>
                  )}
                </p>
                {/* "All" here means all VISIBLE documents — the filter is in charge. */}
                <button
                  type="button"
                  onClick={() => setSelectedIds(selectedDocs.length === visibleDocs.length ? new Set() : new Set(visibleDocs.map(d => d.id)))}
                  className="text-[12px] font-semibold text-clay-700 hover:text-clay-900 underline underline-offset-2"
                >
                  {selectedDocs.length === visibleDocs.length ? 'Clear all' : `Select all ${visibleDocs.length}`}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {canShare && (
                  <button
                    type="button"
                    onClick={handleShareSelected}
                    disabled={selectedIds.size === 0 || !!exporting}
                    className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                  >
                    {exporting === 'share' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                    Share
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleZipSelected}
                  disabled={selectedIds.size === 0 || !!exporting}
                  className="btn-quiet text-xs px-3 py-1.5 disabled:opacity-50"
                >
                  {exporting === 'zip' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Download .zip
                </button>
              </div>
            </div>
          )}

          {allDocs.length === 0 ? (
            <EmptyState
              icon={FileImage}
              title="No documents stored yet"
              description={`Upload a scan, photo, or certificate to organise ${member.name}'s records.`}
              dashed
            />
          ) : visibleDocs.length === 0 ? (
            /* Never hide documents silently: say which filter is on and how
               many documents it is holding back. */
            <EmptyState
              icon={FileImage}
              title={`Nothing filed under “${archiveFilter}”`}
              description={`${hiddenCount} other ${hiddenCount === 1 ? 'document is' : 'documents are'} hidden by this filter.`}
              action={{ label: `Show all ${allDocs.length}`, onClick: () => setArchiveFilter('All') }}
              dashed
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleDocs.map((doc) => {
                const isSelected = selectedIds.has(doc.id);
                return (
                <div
                  key={doc.id}
                  onClick={selectMode ? () => toggleSelected(doc.id) : undefined}
                  className={`flex flex-col bg-white border p-4 rounded-2xl transition-all gap-3.5 relative overflow-hidden group ${
                    selectMode
                      ? `cursor-pointer ${isSelected ? 'ring-2 ring-clay-400 bg-clay-50 border-clay-200' : 'border-cream-200 hover:bg-cream-100/60'}`
                      : 'border-cream-200 hover:bg-cream-100/60'
                  }`}
                >
                  {/* Category pill + date (+ checkbox while selecting) */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {selectMode && (
                        <div
                          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isSelected ? 'bg-clay-500 border-clay-500' : 'border-cream-400 bg-white'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                        </div>
                      )}
                      <span className={categoryChipClass(doc.category)}>
                        {doc.category}
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-400 font-mono tabular-nums">
                      {doc.uploadedAt}
                    </p>
                  </div>

                  {/* Icon & Details */}
                  <div className="flex items-start gap-3">
                    {doc.fileType.startsWith('image/') && doc.fileData && doc.fileData !== 'PLACEHOLDER' ? (
                      <img src={doc.fileData} alt="" className="w-20 h-20 rounded-xl object-cover border border-cream-200 shrink-0" />
                    ) : doc.fileType === 'application/pdf' && doc.fileData && doc.fileData !== 'PLACEHOLDER' ? (
                      <PdfThumbnail src={doc.fileData} size="w-20 h-20" />
                    ) : (
                      <div className="w-20 h-20 bg-cream-100 border border-cream-200 rounded-xl text-ink-500 shrink-0 flex items-center justify-center">
                        <FileText className="w-6 h-6 text-ink-700" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h5 className="text-[13px] font-semibold text-ink-900 truncate leading-snug">
                        {doc.name}
                      </h5>
                      <p className="text-[12px] text-ink-400 font-mono truncate mt-0.5 tabular-nums">
                        {doc.fileName} &bull; {formatBytes(doc.fileSize)}
                      </p>
                    </div>
                  </div>

                  {/* Notes snippet */}
                  {doc.notes && (
                    <p className="text-[13px] text-ink-500 bg-cream-50 py-1.5 px-2.5 rounded-xl border border-cream-200 italic leading-snug">
                      &ldquo;{doc.notes}&rdquo;
                    </p>
                  )}

                  {/* Actions Bar — hidden while selecting so a stray tap can't view/delete */}
                  {!selectMode && (
                    <div className="flex flex-wrap items-center justify-end gap-1 border-t border-cream-100 pt-3 mt-auto">
                      <button
                        type="button"
                        onClick={() => onViewDocument(doc, member.name)}
                        className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl transition-colors cursor-pointer"
                        title="View document"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {askableDoc(doc) && (
                        <button
                          type="button"
                          onClick={() => setAskingDoc(doc)}
                          className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl transition-colors cursor-pointer"
                          title="Ask what this document says"
                        >
                          <MessageCircleQuestion className="w-4 h-4" />
                        </button>
                      )}
                      {canShare ? (
                        <button
                          type="button"
                          onClick={() => void shareFile(getDocSource(doc), doc.fileName || doc.name)}
                          className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl transition-colors cursor-pointer"
                          title="Share"
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDownload(doc)}
                          className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl transition-colors cursor-pointer"
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                      <ConfirmDeleteButton
                        // Honest copy: this really does remove it everywhere
                        // now — the profile, the shared Document Vault and
                        // the stored file itself (see deleteDocumentEverywhere).
                        onConfirm={() => onDeleteDocument(member.id, doc.id)}
                        ariaLabel={`Delete "${doc.name}" everywhere`}
                        hint={`Removes it from ${member.name}'s profile and from the shared Document Vault.`}
                        className="rounded-xl"
                      />
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {scannerEverOpened && (
        <Suspense fallback={null}>
          <DocumentScannerModal
            open={scannerOpen}
            onClose={() => setScannerOpen(false)}
            onUse={handleScannerResult}
            title="Document Scanner"
          />
        </Suspense>
      )}

      <DocumentAskModal
        doc={askingDoc ? {
          id: askingDoc.id,
          name: askingDoc.name,
          category: askingDoc.category,
          fileType: askingDoc.fileType,
          // Safe: askableDoc() already established real bytes exist, so this
          // never resolves to the placeholder branch of getDocSource.
          src: getDocSource(askingDoc),
          storagePath: askingDoc.storagePath,
          contentHash: askingDoc.contentHash,
        } : null}
        isBusinessSpace={isBusinessSpace}
        onClose={() => setAskingDoc(null)}
      />
    </div>
  );
}
