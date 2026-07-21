import { useState, useRef, useEffect } from 'react';
import { Camera, X, RefreshCcw, AlertCircle, Sparkles, IdCard, BookOpen, FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { compressImageToAvatar } from '../utils/imageCompress';
import { compileImagesToPdf } from '../utils/pdfCompile';

export interface ScannedFile {
  data: string;
  name: string;
  type: string;
  size: number;
}

export type ScanType = 'id' | 'passport' | 'document';

interface DocumentScannerModalProps {
  open: boolean;
  onClose: () => void;
  onUse: (file: ScannedFile) => void;
  title?: string;
  subtitle?: string;
  // When given, skips the "what are you scanning?" picker and goes straight to
  // the camera with that type's behavior. Omit to let the user choose.
  scanType?: ScanType;
  filePrefix?: string;
}

const MAX_UPLOAD_BYTES = 700 * 1024;

const SCAN_TYPE_OPTIONS: { type: ScanType; label: string; hint: string; icon: typeof IdCard }[] = [
  { type: 'id', label: 'ID card', hint: "We'll ask for the back too", icon: IdCard },
  { type: 'passport', label: 'Passport', hint: 'Just the photo page', icon: BookOpen },
  { type: 'document', label: 'Document', hint: 'Letters, certificates, forms', icon: FileText },
];

// Auto-capture: sample the live video onto a tiny offscreen canvas a few times
// a second and diff it against the previous sample. Once the view has held
// still for a few consecutive checks, shoot automatically — no edge/rectangle
// detection, just "it fires when you stop moving the phone", which is most of
// what a scan app's "auto capture" actually feels like day to day. The manual
// shutter button always still works too.
const AUTO_CAPTURE_INTERVAL_MS = 280;
const AUTO_CAPTURE_STILL_CHECKS = 3;
const AUTO_CAPTURE_DIFF_THRESHOLD = 8;

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
  scanType,
  filePrefix,
}: DocumentScannerModalProps) {
  const [pickedType, setPickedType] = useState<ScanType | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState('');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);
  const [isHolding, setIsHolding] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevSampleRef = useRef<Uint8ClampedArray | null>(null);
  const stillCountRef = useRef(0);
  const autoCaptureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const effectiveType = scanType ?? pickedType;
  const requireBothSides = effectiveType === 'id';

  const stopAutoCapture = () => {
    if (autoCaptureIntervalRef.current) {
      clearInterval(autoCaptureIntervalRef.current);
      autoCaptureIntervalRef.current = null;
    }
    stillCountRef.current = 0;
    prevSampleRef.current = null;
    setIsHolding(false);
  };

  const stopCamera = () => {
    stopAutoCapture();
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

  const handleCapture = () => {
    if (!videoRef.current) return;
    stopAutoCapture();
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

  // Fires once the video is genuinely playing (initial start, camera switch,
  // or restart-for-back-side) — samples a few times a second and auto-shoots
  // once the frame has been stable for AUTO_CAPTURE_STILL_CHECKS in a row.
  const startAutoCapture = () => {
    stopAutoCapture();
    if (!sampleCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 48;
      sampleCanvasRef.current = c;
    }
    const canvas = sampleCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any);
    if (!ctx) return;
    autoCaptureIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || capturedPhoto) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const prev = prevSampleRef.current;
      if (prev) {
        let diffSum = 0;
        for (let i = 0; i < frame.length; i += 4) {
          diffSum += Math.abs(frame[i] - prev[i]) + Math.abs(frame[i + 1] - prev[i + 1]) + Math.abs(frame[i + 2] - prev[i + 2]);
        }
        const avgDiff = diffSum / ((frame.length / 4) * 3);
        if (avgDiff < AUTO_CAPTURE_DIFF_THRESHOLD) {
          stillCountRef.current += 1;
          setIsHolding(true);
          if (stillCountRef.current >= AUTO_CAPTURE_STILL_CHECKS) {
            handleCapture();
            return;
          }
        } else {
          stillCountRef.current = 0;
          setIsHolding(false);
        }
      }
      prevSampleRef.current = frame;
    }, AUTO_CAPTURE_INTERVAL_MS);
  };

  useEffect(() => {
    if (open) {
      setPickedType(null);
      setSide('front');
      setFrontPhoto(null);
      setCapturedPhoto(null);
      setFileError(null);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Camera only opens once a scan type is known (either passed in, or picked).
  useEffect(() => {
    if (open && effectiveType && !activeStreamRef.current) startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveType]);

  if (!open) return null;

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const typePrefix = effectiveType === 'id' ? 'id_scan' : effectiveType === 'passport' ? 'passport_scan' : 'camera_scan';
  const nameFor = (ext: string) => `${filePrefix || typePrefix}_${Date.now()}.${ext}`;

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
  const effectiveSubtitle = !effectiveType
    ? undefined
    : capturedPhoto
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
                {title}{effectiveType && requireBothSides && !capturedPhoto ? ` — ${showingBack ? 'back' : 'front'}` : ''}
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
          {!effectiveType ? (
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-ink-700 text-center mb-1">What are you scanning?</p>
              {SCAN_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setPickedType(opt.type)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-cream-200 hover:border-clay-300 hover:bg-cream-50 text-left transition-colors cursor-pointer"
                >
                  <div className="p-2 rounded-xl bg-cream-100 text-ink-700 shrink-0">
                    <opt.icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink-900">{opt.label}</p>
                    <p className="text-[12px] text-ink-400">{opt.hint}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : cameraError ? (
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
              <video ref={videoRef} playsInline autoPlay muted onPlaying={startAutoCapture} className="w-full h-full object-cover" />
              {/* Viewfinder bracket overlay — brackets warm up while holding still, ahead of auto-capture */}
              <div className={`absolute inset-4 border pointer-events-none rounded-xl flex flex-col justify-between transition-colors ${isHolding ? 'border-clay-400/40' : 'border-white/20'}`}>
                <div className="flex justify-between p-2">
                  <div className={`w-6 h-6 border-t-2 border-l-2 rounded-tl transition-colors ${isHolding ? 'border-clay-400' : 'border-white/85'}`}></div>
                  <div className={`w-6 h-6 border-t-2 border-r-2 rounded-tr transition-colors ${isHolding ? 'border-clay-400' : 'border-white/85'}`}></div>
                </div>
                <div className="flex justify-between p-2">
                  <div className={`w-6 h-6 border-b-2 border-l-2 rounded-bl transition-colors ${isHolding ? 'border-clay-400' : 'border-white/85'}`}></div>
                  <div className={`w-6 h-6 border-b-2 border-r-2 rounded-br transition-colors ${isHolding ? 'border-clay-400' : 'border-white/85'}`}></div>
                </div>
              </div>
              {!isCameraLoading && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
                  <span className={`chip transition-colors ${isHolding ? 'bg-clay-500/90 text-white' : 'bg-black/50 text-white/90'}`}>
                    {isHolding ? 'Capturing…' : 'Hold steady to auto-capture, or tap to shoot'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Controls */}
        {effectiveType && (
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

                    {/* Shutter button — manual override, auto-capture fires on its own too */}
                    <button
                      type="button"
                      onClick={handleCapture}
                      disabled={isCameraLoading}
                      className="p-3 bg-clay-500 hover:bg-clay-600 disabled:bg-cream-300 text-white rounded-full cursor-pointer border-4 border-white shadow-soft active:scale-95 transition-transform"
                      title="Capture photo now"
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
        )}
      </motion.div>
    </div>
  );
}
