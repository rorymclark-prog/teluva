import React, { useState, useRef } from 'react';
import { FamilyDocument, FamilyMember } from '../types';
import { getDocumentPlaceholderSvg } from '../utils/svgPlaceholders';
import { 
  FileText, Upload, Trash2, Eye, Download, Plus, 
  Sparkles, FileImage, ShieldCheck, AlertCircle,
  Camera, X, RefreshCcw
} from 'lucide-react';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';

interface MemberDocumentsProps {
  member: FamilyMember;
  onAddDocument: (id: string, document: FamilyDocument) => void;
  onDeleteDocument: (memberId: string, documentId: string) => void;
  onViewDocument: (doc: FamilyDocument, memberName: string) => void;
}

const CATEGORIES: ('ID' | 'Health' | 'Education' | 'Travel' | 'Other')[] = [
  'ID', 'Health', 'Education', 'Travel', 'Other'
];

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
          : { facingMode: { ideal: 'environment' } } // Prefer document scanning camera back camera
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      activeStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(e => console.error("Video activation error: ", e));
      }

      // Enumerate other potential sources (e.g., multi camera switches)
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
        'Could not initialize physical camera stream. Please guarantee security authorizations inside your browser or switch back to standard file upload.'
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
    
    // Maintain maximum capture aspect definition
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const qualityFactor = 0.85; // highly compressed while clean
      const base64Url = canvas.toDataURL('image/jpeg', qualityFactor);
      setCapturedPhoto(base64Url);
    }
  };

  const handleUsePhoto = () => {
    if (!capturedPhoto) return;
    
    // Deduce file weight safely
    const bytesCount = Math.round((capturedPhoto.length * 3) / 4);

    if (bytesCount > 3.5 * 1024 * 1024) {
      setFileError('Captured snapshot triggers security weight limitations (exceeds 3.5MB). Try capturing with different resolution.');
      handleCloseCamera();
      return;
    }

    setPendingFileData({
      data: capturedPhoto,
      name: `camera_scan_${Date.now()}.jpg`,
      type: 'image/jpeg',
      size: bytesCount,
    });
    
    setSelectedFileName(`Camera Scan - jpeg (${formatBytes(bytesCount)})`);
    
    // Setup sensible title default if name field is currently empty
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
          // Dynamic orientation and format size based on native source resolution coordinates
          const pdf = new jsPDF({
            orientation: img.width > img.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [img.width, img.height]
          });
          
          pdf.addImage(imageDataUrl, 'JPEG', 0, 0, img.width, img.height);
          const pdfDataUrl = pdf.output('datauristring');
          
          // Compute approx base64 size count
          const base64Content = pdfDataUrl.split(',')[1];
          const bytesCount = Math.round((base64Content.length * 3) / 4);
          
          const cleanName = fileName.replace(/\.[^/.]+$/, "") + ".pdf";
          
          resolve({
            data: pdfDataUrl,
            name: cleanName,
            size: bytesCount
          });
        };
        img.onerror = (e) => {
          reject(new Error('Failed to load image structure. Make sure the file format is valid.'));
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
      
      if (compiled.size > 3.5 * 1024 * 1024) {
        setFileError('Compiled PDF size exceeds security boundaries (must be under 3.5MB).');
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
      setFileError('Failed to compile image scan into a PDF file.');
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

      if (compiled.size > 3.5 * 1024 * 1024) {
        setFileError('Compiled camera scan PDF exceeds size layout limits of 3.5MB.');
        handleCloseCamera();
        return;
      }

      setPendingFileData({
        data: compiled.data,
        name: compiled.name,
        type: 'application/pdf',
        size: compiled.size,
      });

      setSelectedFileName(`Camera Scan - Compiled PDF (${formatBytes(compiled.size)})`);
      
      if (!docName.trim()) {
        setDocName(`Camera Capture ${todayString}`);
      }

      handleCloseCamera();
    } catch (err: any) {
      console.error(err);
      setFileError('Failed to auto-compile camera capture into standard PDF.');
      handleCloseCamera();
    } finally {
      setIsPdfCompiling(false);
    }
  };

  // File processors helper
  const processFile = (file: File) => {
    setFileError(null);
    
    // Warn or restrict if file size > 3.5MB (due to base64 localStorage limits)
    if (file.size > 3.5 * 1024 * 1024) {
      setFileError('File size triggers security limits! To guarantee fast, localized performance, files must be under 3.5MB.');
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
      setFileError('Failed to read document safely. Try a different format.');
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

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim() || !pendingFileData) return;

    const newDoc: FamilyDocument = {
      id: 'doc-' + Date.now().toString(),
      name: docName.trim(),
      category,
      fileType: pendingFileData.type,
      fileName: pendingFileData.name,
      fileSize: pendingFileData.size,
      uploadedAt: new Date().toISOString().split('T')[0],
      notes: notes.trim() || undefined,
      fileData: pendingFileData.data,
    };

    onAddDocument(member.id, newDoc);

    // Reset Fields
    setDocName('');
    setCategory('ID');
    setNotes('');
    setPendingFileData(null);
    setSelectedFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  // Convert File Sizes cleanly
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
      <div className="border-b border-gray-100 pb-4">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 uppercase tracking-wider">
          <span className="w-1.5 h-3.5 bg-gray-900 rounded-full inline-block"></span>
          Secure Digital Archives &amp; Scans
        </h3>
        <p className="text-xs text-gray-500 mt-1">
          Upload photo cards, birth certificates, dental logs, or medical records. Files are encrypt-ready in your secure offline browser state.
        </p>
      </div>

      {/* Upload document panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form onSubmit={handleUploadSubmit} className="lg:col-span-12 xl:col-span-4 space-y-4 bg-gray-50 p-4 border border-gray-150 rounded-2xl shadow-xs">
          <h4 className="text-[10px] font-bold text-gray-750 uppercase tracking-widest flex items-center gap-1.5 pb-2 border-b border-gray-100">
            <Plus className="w-3.5 h-3.5" />
            Upload New Page
          </h4>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Document Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Birth Certificate"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950 font-sans"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Category
            </label>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                    category === cat 
                      ? 'bg-gray-900 text-white shadow-xs' 
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-55'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Secure Interactive File Input zone (Handles both Click and Drag/Drop) */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={triggerFileInput}
            className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
              isDragging 
                ? 'border-gray-950 bg-gray-100/30' 
                : 'border-gray-250 bg-white hover:border-gray-400'
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
              <Upload className={`w-7 h-7 mb-2 ${isDragging ? 'text-gray-900' : 'text-gray-400'}`} />
              <p className="text-xs font-bold text-gray-700">
                {selectedFileName ? 'Document Loaded!' : 'Drag & Drop File'}
              </p>
              <p className="text-[9px] uppercase tracking-wide text-gray-400 mt-1">
                {selectedFileName ? selectedFileName : 'Supports Image or PDF (Max 3.5MB)'}
              </p>
            </div>
          </div>

          {pendingFileData && pendingFileData.type.startsWith('image/') && (
            <div className="p-3 bg-indigo-55/60 border border-indigo-150 rounded-xl space-y-1.5 transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1">
                  <FileImage className="w-3.5 h-3.5 text-indigo-700" />
                  Image Loaded
                </span>
                <button
                  type="button"
                  onClick={handleCompileToPdf}
                  disabled={isPdfCompiling}
                  className="px-2.5 py-1 bg-indigo-950 hover:bg-black text-white rounded-lg text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer select-none active:scale-95 transition-all"
                >
                  {isPdfCompiling ? (
                    <>
                      <RefreshCcw className="w-3 h-3 animate-spin" />
                      <span>Compiling...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 text-white" />
                      <span>Compile to PDF</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[9px] text-indigo-750 font-light leading-snug">
                Save layout format and compress document scans perfectly. Convert this static image scan into a clean single-page PDF template before storing.
              </p>
            </div>
          )}

          {/* Quick Action: Take device camera photo */}
          <button
            type="button"
            onClick={() => {
              setIsCameraActive(true);
              startCamera();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl text-xs font-bold text-gray-800 shadow-2xs transition-all cursor-pointer select-none"
          >
            <Camera className="w-4 h-4 text-gray-800" />
            <span>Scan via Device Camera</span>
          </button>

          {fileError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-250/50 text-[10px] text-red-700 flex items-start gap-1.5 leading-normal">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-500" />
              <span>{fileError}</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Notes or Identifier Keys
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Hospital record. Code: BC-994"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950 font-sans"
            />
          </div>

          <button
            type="submit"
            disabled={!pendingFileData || !docName.trim()}
            className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              !pendingFileData || !docName.trim()
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-gray-950 hover:bg-black text-white shadow-sm'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Store On Device</span>
          </button>
        </form>

        {/* Existing documents catalog */}
        <div className="lg:col-span-12 xl:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-mono">
              Archives Directory ({member.documents?.length || 0})
            </h4>
            <span className="text-[9px] uppercase tracking-wider text-emerald-600 font-bold bg-emerald-55 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Encrypted Local Storage
            </span>
          </div>

          { (!member.documents || member.documents.length === 0) ? (
            <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-gray-250 bg-white">
              <FileImage className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-800">No Document Copies Stored</p>
              <p className="text-xs text-gray-400 mt-1">Upload a photo copy, dental script, size guide, or scan to organize details under {member.name}.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {member.documents.map((doc) => (
                <div 
                  key={doc.id}
                  className="flex flex-col bg-white border border-gray-150 p-4 rounded-2xl hover:border-gray-350 transition-all gap-3.5 relative overflow-hidden group shadow-xs"
                >
                  {/* Category Pill Tag */}
                  <div className="flex items-start justify-between">
                    <span className="text-[9px] font-bold tracking-widest px-2 py-0.5 rounded uppercase font-sans bg-gray-100 text-gray-700">
                      {doc.category}
                    </span>
                    <p className="text-[9px] text-gray-450 font-mono font-medium">
                      {doc.uploadedAt}
                    </p>
                  </div>

                  {/* Icon & Details */}
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 bg-gray-50 border border-gray-150 rounded-xl text-gray-500 shrink-0">
                      <FileText className="w-4 h-4 text-gray-900" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h5 className="text-xs font-bold text-gray-900 truncate leading-snug">
                        {doc.name}
                      </h5>
                      <p className="text-[9px] text-gray-400 font-mono truncate mt-0.5">
                        {doc.fileName} • {formatBytes(doc.fileSize)}
                      </p>
                    </div>
                  </div>

                  {/* Notes snippet */}
                  {doc.notes && (
                    <p className="text-xs text-gray-500 bg-gray-50/70 py-1.5 px-2.5 rounded-xl border border-gray-100 italic leading-snug">
                      &ldquo;{doc.notes}&rdquo;
                    </p>
                  )}

                  {/* Actions Bar */}
                  <div className="flex items-center justify-end space-x-1 border-t border-gray-100 pt-3 mt-auto">
                    <button
                      type="button"
                      onClick={() => onViewDocument(doc, member.name)}
                      className="p-1.5 text-gray-500 hover:text-black hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
                      title="Inspect Document"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      className="p-1.5 text-gray-500 hover:text-black hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
                      title="Download Scan"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDocument(member.id, doc.id)}
                      className="p-1.5 text-gray-400 hover:text-red-650 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
                      title="Delete Copy"
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

      {/* Device Camera Scanner Overlay Modal */}
      {isCameraActive && (
        <div className="fixed inset-0 z-50 bg-gray-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl border border-gray-150 max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="p-4 bg-white border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-lg bg-gray-900 text-white shrink-0">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                    Physical Document Scanner
                  </h3>
                  <p className="text-[10px] text-gray-400 font-light mt-0.5">
                    Align your page or ID card securely inside the capture stream
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseCamera}
                className="p-1 px-1.5 hover:bg-gray-50 text-gray-400 hover:text-black rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body / Stream viewport */}
            <div className="p-5 flex-1 overflow-y-auto flex flex-col justify-center min-h-[280px]">
              {cameraError ? (
                <div className="p-4 bg-red-50 border border-red-150 text-red-750 rounded-xl space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold uppercase tracking-wider">Stream Access Blocked</h4>
                      <p className="text-xs font-light leading-relaxed">
                        {cameraError}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 pt-1 justify-end">
                    <button
                      type="button"
                      onClick={() => startCamera(activeDeviceId)}
                      className="px-3.5 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-800 text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer"
                    >
                      Retry Connection
                    </button>
                    <button
                      type="button"
                      onClick={handleCloseCamera}
                      className="px-3.5 py-1.5 bg-red-750 text-white hover:bg-red-800 text-[10px] font-bold uppercase tracking-wider rounded-lg cursor-pointer"
                    >
                      Close Scanner
                    </button>
                  </div>
                </div>
              ) : capturedPhoto ? (
                /* Snapshot preview state */
                <div className="space-y-4">
                  <div className="relative aspect-4/3 rounded-xl overflow-hidden bg-black border border-gray-150 shadow-inner">
                    <img 
                      src={capturedPhoto} 
                      alt="Captured physical document scan" 
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-3 left-3 px-2 py-0.5 bg-emerald-950/80 text-emerald-400 rounded text-[9px] font-bold uppercase tracking-widest border border-emerald-800/50">
                      Captured Copy
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 text-center font-light italic">
                    Inspect the scan to confirm text and key numbers are clearly legible before device upload.
                  </p>
                </div>
              ) : (
                /* Live streaming frame */
                <div className="relative aspect-4/3 rounded-xl overflow-hidden bg-black border border-gray-150 shadow-inner">
                  {isCameraLoading && (
                    <div className="absolute inset-0 flex items-center justify-center flex-col space-y-2 bg-black/60 backdrop-blur-xs z-10 text-white">
                      <RefreshCcw className="w-5 h-5 animate-spin" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Powering sensor lens...</span>
                    </div>
                  )}
                  <video
                    ref={videoRef}
                    playsInline
                    autoPlay
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* High Quality Scan HUD bracket helper overlays */}
                  <div className="absolute inset-4 border border-white/20 pointer-events-none rounded-lg flex flex-col justify-between">
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

            {/* Modal Controls / Action Triggers */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-4">
              {!cameraError && (
                <>
                  {capturedPhoto ? (
                    /* Captured preview options */
                    <div className="flex items-center justify-between w-full">
                      <button
                        type="button"
                        onClick={() => {
                          setCapturedPhoto(null);
                          startCamera(activeDeviceId);
                        }}
                        className="px-4 py-2 hover:bg-gray-100 border border-gray-250 text-gray-700 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-colors"
                      >
                        Retake Scan
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleUsePhoto}
                          className="px-3 py-2 border border-gray-250 hover:bg-gray-55 text-gray-700 text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all"
                        >
                          Use JPG Scan
                        </button>
                        <button
                          type="button"
                          onClick={handleUsePhotoAsPdf}
                          disabled={isPdfCompiling}
                          className="px-4 py-2 bg-indigo-950 hover:bg-indigo-900 text-white text-xs font-bold uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-sm flex items-center gap-1.5"
                        >
                          {isPdfCompiling ? (
                            <>
                              <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                              <span>Compiling...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                              <span>Compile to PDF</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Live video tracking options */
                    <>
                      {/* Optional Camera Toggle Selection drop-down */}
                      {cameraDevices.length > 1 ? (
                        <div className="flex items-center space-x-1.5 select-none shrink-0 max-w-[180px]">
                          <select
                            value={activeDeviceId}
                            onChange={(e) => startCamera(e.target.value)}
                            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 bg-white border border-gray-200 hover:border-gray-300 rounded-lg cursor-pointer focus:outline-none"
                          >
                            {cameraDevices.map((dev, idx) => (
                              <option key={dev.deviceId} value={dev.deviceId}>
                                Camera {idx + 1}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                          Sensor active
                        </span>
                      )}

                      {/* Giant shutter core button */}
                      <button
                        type="button"
                        onClick={handleCapture}
                        disabled={isCameraLoading}
                        className="p-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-250 text-white rounded-full cursor-pointer border-4 border-white shadow-md active:scale-95 transition-transform"
                        title="Capture Photo Copy"
                      >
                        <div className="w-5 h-5 bg-transparent border-2 border-white rounded-full"></div>
                      </button>

                      <button
                        type="button"
                        onClick={handleCloseCamera}
                        className="text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-gray-950 px-2 cursor-pointer"
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
