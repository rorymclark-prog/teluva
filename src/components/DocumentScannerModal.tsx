import { useState, useRef, useEffect } from 'react';
import { Camera, X, RefreshCcw, AlertCircle, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { compressImageToAvatar } from '../utils/imageCompress';
import { compileImagesToPdf } from '../utils/pdfCompile';

export interface ScannedFile {
  data: string;
  name: string;
  type: string;
  size: number;
}

interface DocumentScannerModalProps {
  open: boolean;
  onClose: () => void;
  onUse: (file: ScannedFile) => void;
  title?: string;
  subtitle?: string;
  // When true, captures front then back and saves both as a single 2-page PDF —
  // used for ID cards, which need both sides on file.
  requireBothSides?: boolean;
  filePrefix?: string;
}

const MAX_UPLOAD_BYTES = 700 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function DocumentScannerModal({
  open,
  onClose,
  onUse,
  title = 'Document Scanner',
  subtitle,
  requireBothSides = false,
  filePrefix = 'camera_scan',
}: DocumentScannerModalProps) {
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
  };

  const startCamera = async (deviceId?: string) => {
    setIsCameraLoading(true);
    setCameraError(null);
    setCapturedPhoto(null);
    stopCamera();

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      activeStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((e) => console.error('Video activation error: ', e));
      }

      if (navigator.mediaDevices.enumerateDevices) {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        setCameraDevices(allDevices.filter((d) => d.kind === 'videoinput'));
      }

      const activeTrack = stream.getVideoTracks()[0];
      if (activeTrack) {
        const settings = activeTrack.getSettings();
        if (settings.deviceId) setActiveDeviceId(settings.deviceId);
      }
    } catch (err) {
      console.error('Camera access failure:', err);
      setCameraError('Could not initialize camera. Please check browser permissions or switch to file upload.');
    } finally {
      setIsCameraLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSide('front');
      setFrontPhoto(null);
      setCapturedPhoto(null);
      setFileError(null);
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleCapture = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.85));
    }
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const nameFor = (ext: string) => `${filePrefix}_${Date.now()}.${ext}`;

  // Single-side JPG (only offered when a second side isn't required).
  const handleUseJpg = async () => {
    if (!capturedPhoto) return;
    setIsCompiling(true);
    setFileError(null);
    try {
      // A full-resolution camera capture of a detail-dense document (an ID
      // card's fine print) can easily exceed the 700KB Firestore cap — every
      // other capture path in the app compresses first; this one previously
      // didn't, which is why real scans were silently failing.
      const compressed = await compressImageToAvatar(capturedPhoto, 1600, 0.82);
      const bytesCount = Math.round((compressed.length * 3) / 4);
      if (bytesCount > MAX_UPLOAD_BYTES) {
        setFileError(
          `This photo is ${formatBytes(bytesCount)} even after compression — too large for cloud sync (limit 700 KB). ` +
            'Try "Save as PDF" instead, or retake with less background in the frame.'
        );
        return;
      }
      onUse({ data: compressed, name: nameFor('jpg'), type: 'image/jpeg', size: bytesCount });
      handleClose();
    } catch (err) {
      console.error(err);
      setFileError('Failed to process the photo. Please try again.');
    } finally {
      setIsCompiling(false);
    }
  };

  // Confirms the side just captured. In two-sided mode the front advances to
  // the back instead of finishing; every other case compiles to a PDF.
  const handleUseSide = async () => {
    if (!capturedPhoto) return;
    setIsCompiling(true);
    setFileError(null);
    try {
      const compressed = await compressImageToAvatar(capturedPhoto, 1600, 0.82);

      if (requireBothSides && side === 'front') {
        setFrontPhoto(compressed);
        setCapturedPhoto(null);
        setSide('back');
        await startCamera(activeDeviceId);
        return;
      }

      const images = requireBothSides && frontPhoto ? [frontPhoto, compressed] : [compressed];
      const compiled = await compileImagesToPdf(images, nameFor('jpg'));
      if (compiled.size > MAX_UPLOAD_BYTES) {
        setFileError(
          `Compiled PDF is ${formatBytes(compiled.size)} — too large for cloud sync (limit 700 KB). ` +
            'Try retaking with less background in the frame.'
        );
        return;
      }
      onUse({ data: compiled.data, name: compiled.name, type: 'application/pdf', size: compiled.size });
      handleClose();
    } catch (err) {
      console.error(err);
      setFileError('Failed to compile the scan into a PDF.');
    } finally {
      setIsCompiling(false);
    }
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    startCamera(activeDeviceId);
  };

  const showingBack = requireBothSides && side === 'back';
  const effectiveSubtitle = capturedPhoto
    ? undefined
    : showingBack
      ? 'Now flip it over — align the back in the frame'
      : subtitle || (requireBothSides ? 'Align the front in the frame' : 'Align your page or ID card in the frame');

  return (
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
                {title}{requireBothSides && !capturedPhoto ? ` — ${showingBack ? 'back' : 'front'}` : ''}
              </h3>
              {effectiveSubtitle && <p className="text-[12px] text-ink-400 mt-0.5">{effectiveSubtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
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
                  <p className="text-[13px] leading-relaxed">{cameraError}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-1 justify-end">
                <button type="button" onClick={() => startCamera(activeDeviceId)} className="btn-quiet text-[13px] px-3 py-1.5">
                  Retry
                </button>
                <button type="button" onClick={handleClose} className="btn-danger text-[13px] px-3 py-1.5">
                  Close
                </button>
              </div>
            </div>
          ) : capturedPhoto ? (
            <div className="space-y-4">
              <div className="relative aspect-4/3 rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner">
                <img src={capturedPhoto} alt="Captured document scan" className="w-full h-full object-contain" />
                <div className="absolute top-3 left-3 chip bg-sage-700/80 text-sage-100 border border-sage-600/50">
                  {requireBothSides ? `${side === 'front' ? 'Front' : 'Back'} captured` : 'Captured'}
                </div>
              </div>
              <p className="text-[12px] text-ink-400 text-center italic">
                Check that text and key numbers are clearly legible before saving.
              </p>
              {fileError && (
                <div className="p-3 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2 leading-normal">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="relative aspect-4/3 rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner">
              {isCameraLoading && (
                <div className="absolute inset-0 flex items-center justify-center flex-col space-y-2 bg-black/60 backdrop-blur-sm z-10 text-white">
                  <RefreshCcw className="w-5 h-5 animate-spin" />
                  <span className="text-[12px] font-semibold">Starting camera…</span>
                </div>
              )}
              <video ref={videoRef} playsInline autoPlay muted className="w-full h-full object-cover" />
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
                  <button type="button" onClick={handleRetake} className="btn-quiet text-[13px] px-4 py-2">
                    Retake
                  </button>
                  <div className="flex items-center gap-2">
                    {!requireBothSides && (
                      <button type="button" onClick={handleUseJpg} disabled={isCompiling} className="btn-quiet text-[13px] px-3 py-2">
                        Use JPG
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleUseSide}
                      disabled={isCompiling}
                      className="btn-primary text-[13px] px-4 py-2"
                    >
                      {isCompiling ? (
                        <>
                          <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                          <span>{requireBothSides && side === 'front' ? 'Continuing…' : 'Compiling…'}</span>
                        </>
                      ) : requireBothSides && side === 'front' ? (
                        <span>Use this side — now the back</span>
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
                    <span className="text-[12px] font-semibold text-ink-400">Sensor active</span>
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

                  <button type="button" onClick={handleClose} className="text-[13px] font-semibold text-ink-500 hover:text-ink-800 px-2 cursor-pointer">
                    Cancel
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
