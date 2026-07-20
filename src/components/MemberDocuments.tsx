import React, { useState, useRef } from 'react';
import { FamilyDocument, FamilyMember } from '../types';
import { getDocumentPlaceholderSvg } from '../utils/svgPlaceholders';
import {
  FileText, Upload, Trash2, Eye, Download, Plus,
  Sparkles, FileImage, ShieldCheck, AlertCircle,
  Camera, X, RefreshCcw, AlertTriangle
} from 'lucide-react';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import { hashDataUrl, findLikelyDuplicate, DupMatch } from '../utils/documentDedup';

interface MemberDocumentsProps {
  member: FamilyMember;
  onAddDocument: (id: string, document: FamilyDocument) => void;
  onDeleteDocument: (memberId: string, documentId: string) => void;
  onViewDocument: (doc: FamilyDocument, memberName: string) => void;
}

const CATEGORIES: ('ID' | 'Health' | 'Education' | 'Travel' | 'Other')[] = [
  'ID', 'Health', 'Education', 'Travel', 'Other'
];

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
  onViewDocument
}: MemberDocumentsProps) {
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

  // Device Camera States & Refs
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isPdfCompiling, setIsPdfCompiling] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);

  // Ensure camera streams are completely garbage-collected on unmount
  React.useEffect(() => {
    return () => {
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async (deviceId?: string) => {
    setIsCameraLoading(true);
    setCameraError(null);
    setCapturedPhoto(null);

    // Turn off old stream
    stopCamera();

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { facingMode: { ideal: 'environment' } }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      activeStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error("Video activation error: ", e));
      }

      if (navigator.mediaDevices.enumerateDevices) {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices.filter(d => d.kind === 'videoinput');
        setCameraDevices(videoInputs);
      }

      const activeTrack = stream.getVideoTracks()[0];
      if (activeTrack) {
        const settings = activeTrack.getSettings();
        if (settings.deviceId) {
          setActiveDeviceId(settings.deviceId);
        }
      }
    } catch (err: any) {
      console.error('Camera access failure:', err);
      setCameraError(
        'Could not initialize camera. Please check browser permissions or switch to file upload.'
      );
    } finally {
      setIsCameraLoading(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(track => track.stop());
      activeStreamRef.current = null;
    }
  };

  const handleCapture = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const qualityFactor = 0.85;
      const base64Url = canvas.toDataURL('image/jpeg', qualityFactor);
      setCapturedPhoto(base64Url);
    }
  };

  const handleUsePhoto = () => {
    if (!capturedPhoto) return;

    const bytesCount = Math.round((capturedPhoto.length * 3) / 4);

    if (bytesCount > MAX_UPLOAD_BYTES) {
      setFileError(
        `This photo is ${formatBytes(bytesCount)} — too large for cloud sync (limit 700 KB). ` +
        'Try a lower resolution or use "Compile to PDF" for better compression.'
      );
      handleCloseCamera();
      return;
    }

    setPendingFileData({
      data: capturedPhoto,
      name: `camera_scan_${Date.now()}.jpg`,
      type: 'image/jpeg',
      size: bytesCount,
    });

    setSelectedFileName(`Camera Scan — jpeg (${formatBytes(bytesCount)})`);

    if (!docName.trim()) {
      const todayString = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      setDocName(`Camera Capture ${todayString}`);
    }

    handleCloseCamera();
  };

  const handleCloseCamera = () => {
    stopCamera();
    setIsCameraActive(false);
    setCapturedPhoto(null);
    setCameraError(null);
  };

  const compileImageToPdf = (imageDataUrl: string, fileName: string): Promise<{ data: string; name: string; size: number }> => {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => {
          const pdf = new jsPDF({
            orientation: img.width > img.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [img.width, img.height]
          });

          pdf.addImage(imageDataUrl, 'JPEG', 0, 0, img.width, img.height);
          const pdfDataUrl = pdf.output('datauristring');

          const base64Content = pdfDataUrl.split(',')[1];
          const bytesCount = Math.round((base64Content.length * 3) / 4);

          const cleanName = fileName.replace(/\.[^/.]+$/, "") + ".pdf";

          resolve({
            data: pdfDataUrl,
            name: cleanName,
            size: bytesCount
          });
        };
        img.onerror = () => {
          reject(new Error('Failed to load image. Make sure the file format is valid.'));
        };
        img.src = imageDataUrl;
      } catch (e: any) {
        reject(e);
      }
    });
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

  const handleUsePhotoAsPdf = async () => {
    if (!capturedPhoto) return;
    setIsPdfCompiling(true);
    try {
      const todayString = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const defaultName = `camera_scan_${Date.now()}.jpg`;
      const compiled = await compileImageToPdf(capturedPhoto, defaultName);

      if (compiled.size > MAX_UPLOAD_BYTES) {
        setFileError(
          `Compiled PDF is ${formatBytes(compiled.size)} — too large for cloud sync (limit 700 KB). ` +
          'Try capturing at lower resolution.'
        );
        handleCloseCamera();
        return;
      }

      setPendingFileData({
        data: compiled.data,
        name: compiled.name,
        type: 'application/pdf',
        size: compiled.size,
      });

      setSelectedFileName(`Camera Scan — PDF (${formatBytes(compiled.size)})`);

      if (!docName.trim()) {
        setDocName(`Camera Capture ${todayString}`);
      }

      handleCloseCamera();
    } catch (err: any) {
      console.error(err);
      setFileError('Failed to compile camera capture into a PDF.');
      handleCloseCamera();
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
      const match = findLikelyDuplicate(
        { fileName: pendingFileData.name, fileSize: pendingFileData.size, contentHash: hash },
        member.documents || [],
      );
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

  const resolveDuplicateReplace = () => {
    if (!duplicateMatch) return;
    onDeleteDocument(member.id, duplicateMatch.doc.id);
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
              {CATEGORIES.map((cat) => (
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
            onClick={() => {
              setIsCameraActive(true);
              startCamera();
            }}
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
                </span>
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={resolveDuplicateReplace} className="btn-primary text-xs px-3 py-1.5 flex-1 justify-center">
                  Replace existing
                </button>
                <button type="button" onClick={resolveDuplicateKeepBoth} className="btn-quiet text-xs px-3 py-1.5 flex-1 justify-center">
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
          <div className="flex items-center justify-between">
            <h4 className="text-[13px] font-semibold text-ink-600">
              Archives ({member.documents?.length || 0})
            </h4>
            <span className="chip bg-sage-100 text-sage-700 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Synced to your family
            </span>
          </div>

          {(!member.documents || member.documents.length === 0) ? (
            <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-cream-300 bg-clay-50">
              <div className="w-12 h-12 bg-clay-100 text-clay-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <FileImage className="w-6 h-6" />
              </div>
              <p className="text-[13px] font-semibold text-clay-900">No documents stored yet</p>
              <p className="text-[13px] text-clay-700 mt-1">
                Upload a scan, photo, or certificate to organise {member.name}'s records.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {member.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex flex-col bg-white border border-cream-200 p-4 rounded-2xl hover:bg-cream-100/60 transition-all gap-3.5 relative overflow-hidden group"
                >
                  {/* Category pill + date */}
                  <div className="flex items-start justify-between">
                    <span className={categoryChipClass(doc.category)}>
                      {doc.category}
                    </span>
                    <p className="text-[12px] text-ink-400 font-mono tabular-nums">
                      {doc.uploadedAt}
                    </p>
                  </div>

                  {/* Icon & Details */}
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-cream-100 border border-cream-200 rounded-xl text-ink-500 shrink-0">
                      <FileText className="w-4 h-4 text-ink-700" />
                    </div>
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

                  {/* Actions Bar */}
                  <div className="flex items-center justify-end space-x-1 border-t border-cream-100 pt-3 mt-auto">
                    <button
                      type="button"
                      onClick={() => onViewDocument(doc, member.name)}
                      className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl transition-colors cursor-pointer"
                      title="View document"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      className="p-1.5 text-ink-400 hover:text-ink-800 hover:bg-cream-100 rounded-xl transition-colors cursor-pointer"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete "${doc.name}"? This permanently removes the document. This can't be undone.`)) {
                          onDeleteDocument(member.id, doc.id);
                        }
                      }}
                      className="p-1.5 text-ink-400 hover:text-rosa-700 hover:bg-rosa-50 rounded-xl transition-colors cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Camera scanner modal */}
      {isCameraActive && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm anim-fade flex items-center justify-center p-4 sm:p-0 sm:pb-4">
          <motion.div
            initial={{ opacity: 0, translateY: '100%' }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: '100%' }}
            className="card rounded-3xl sm:rounded-2xl max-w-lg w-full sm:max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col anim-sheet"
          >
            {/* Mobile grabber bar */}
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-cream-400 sm:hidden" />

            {/* Modal Header */}
            <div className="p-4 bg-white border-b border-cream-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-ink-800 text-white shrink-0">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[13px] font-semibold text-ink-900">
                    Document Scanner
                  </h3>
                  <p className="text-[12px] text-ink-400 mt-0.5">
                    Align your page or ID card in the frame
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseCamera}
                className="p-1.5 hover:bg-cream-100 text-ink-400 hover:text-ink-700 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex-1 overflow-y-auto flex flex-col justify-center min-h-[280px]">
              {cameraError ? (
                <div className="p-4 bg-rosa-50 border border-rosa-100 text-rosa-700 rounded-2xl space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-rosa-500 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <h4 className="text-[13px] font-semibold">Camera access blocked</h4>
                      <p className="text-[13px] leading-relaxed">
                        {cameraError}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 pt-1 justify-end">
                    <button
                      type="button"
                      onClick={() => startCamera(activeDeviceId)}
                      className="btn-quiet text-[13px] px-3 py-1.5"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={handleCloseCamera}
                      className="btn-danger text-[13px] px-3 py-1.5"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : capturedPhoto ? (
                <div className="space-y-4">
                  <div className="relative aspect-4/3 rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner">
                    <img
                      src={capturedPhoto}
                      alt="Captured document scan"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-3 left-3 chip bg-sage-700/80 text-sage-100 border border-sage-600/50">
                      Captured
                    </div>
                  </div>
                  <p className="text-[12px] text-ink-400 text-center italic">
                    Check that text and key numbers are clearly legible before saving.
                  </p>
                </div>
              ) : (
                <div className="relative aspect-4/3 rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner">
                  {isCameraLoading && (
                    <div className="absolute inset-0 flex items-center justify-center flex-col space-y-2 bg-black/60 backdrop-blur-sm z-10 text-white">
                      <RefreshCcw className="w-5 h-5 animate-spin" />
                      <span className="text-[12px] font-semibold">Starting camera…</span>
                    </div>
                  )}
                  <video
                    ref={videoRef}
                    playsInline
                    autoPlay
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Viewfinder bracket overlay */}
                  <div className="absolute inset-4 border border-white/20 pointer-events-none rounded-xl flex flex-col justify-between">
                    <div className="flex justify-between p-2">
                      <div className="w-6 h-6 border-t-2 border-l-2 border-white/85 rounded-tl"></div>
                      <div className="w-6 h-6 border-t-2 border-r-2 border-white/85 rounded-tr"></div>
                    </div>
                    <div className="flex justify-between p-2">
                      <div className="w-6 h-6 border-b-2 border-l-2 border-white/85 rounded-bl"></div>
                      <div className="w-6 h-6 border-b-2 border-r-2 border-white/85 rounded-br"></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Controls */}
            <div className="p-4 bg-cream-50 border-t border-cream-200 flex items-center justify-between gap-4">
              {!cameraError && (
                <>
                  {capturedPhoto ? (
                    <div className="flex items-center justify-between w-full">
                      <button
                        type="button"
                        onClick={() => {
                          setCapturedPhoto(null);
                          startCamera(activeDeviceId);
                        }}
                        className="btn-quiet text-[13px] px-4 py-2"
                      >
                        Retake
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleUsePhoto}
                          className="btn-quiet text-[13px] px-3 py-2"
                        >
                          Use JPG
                        </button>
                        <button
                          type="button"
                          onClick={handleUsePhotoAsPdf}
                          disabled={isPdfCompiling}
                          className="btn-primary text-[13px] px-4 py-2"
                        >
                          {isPdfCompiling ? (
                            <>
                              <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                              <span>Compiling…</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Save as PDF</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {cameraDevices.length > 1 ? (
                        <div className="flex items-center space-x-1.5 select-none shrink-0 max-w-[180px]">
                          <select
                            value={activeDeviceId}
                            onChange={(e) => startCamera(e.target.value)}
                            className="text-[13px] font-semibold px-2.5 py-1.5 bg-white border border-cream-300 hover:border-cream-400 rounded-xl cursor-pointer focus:outline-none focus:ring-2 focus:ring-clay-300"
                          >
                            {cameraDevices.map((dev, idx) => (
                              <option key={dev.deviceId} value={dev.deviceId}>
                                Camera {idx + 1}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className="text-[12px] font-semibold text-ink-400">
                          Sensor active
                        </span>
                      )}

                      {/* Shutter button */}
                      <button
                        type="button"
                        onClick={handleCapture}
                        disabled={isCameraLoading}
                        className="p-3 bg-clay-500 hover:bg-clay-600 disabled:bg-cream-300 text-white rounded-full cursor-pointer border-4 border-white shadow-soft active:scale-95 transition-transform"
                        title="Capture photo"
                      >
                        <div className="w-5 h-5 bg-transparent border-2 border-white rounded-full"></div>
                      </button>

                      <button
                        type="button"
                        onClick={handleCloseCamera}
                        className="text-[13px] font-semibold text-ink-500 hover:text-ink-800 px-2 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
