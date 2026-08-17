import { useState, useRef, useEffect } from 'react';
import { Camera, X, RefreshCcw, AlertCircle, Sparkles, IdCard, BookOpen, FileText, Crop } from 'lucide-react';
import { motion } from 'motion/react';
import { scanDocument, extractDocument, createCornerEditor, type CornerPoints, type CornerEditor } from 'scanic';
import { compressImageToAvatar } from '../utils/imageCompress';
import { compileImagesToPdf } from '../utils/pdfCompile';
import SheetGrabber from './SheetGrabber';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

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
// detection at this stage, just "it fires when you stop moving the phone".
// The manual shutter button always still works too.
const AUTO_CAPTURE_INTERVAL_MS = 280;
const AUTO_CAPTURE_STILL_CHECKS = 3;
const AUTO_CAPTURE_DIFF_THRESHOLD = 8;
// A brand new camera stream (first open, or right after Retake) can render a
// handful of near-black frames while the sensor's auto-exposure is still
// converging — and a finger briefly covering the lens while positioning the
// phone looks identical to the diff check above: a stable, unchanging frame.
// Either way that satisfies "held still" and would auto-fire a shot nobody
// can read. Treat anything this dark as not-yet-usable rather than still.
const AUTO_CAPTURE_MIN_BRIGHTNESS = 35; // average luma, 0-255 scale

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load the captured photo.'));
    img.src = dataUrl;
  });
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
  // Called unconditionally, ahead of the `if (!open) return null` below —
  // required by the rules of hooks. The hook itself is a no-op while open
  // is false.
  useBodyScrollLock(open);

  const [pickedType, setPickedType] = useState<ScanType | null>(null);
  // capturedPhoto is the (edge-detected + perspective-corrected) result shown
  // for review; rawPhoto is the full uncropped capture kept around so "Adjust
  // corners" has the original pixels to re-crop from.
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [rawPhoto, setRawPhoto] = useState<string | null>(null);
  const [detectedCorners, setDetectedCorners] = useState<CornerPoints | null>(null);
  const [adjustMode, setAdjustMode] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false); // edge-detection/extraction busy state
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null);
  const [isHolding, setIsHolding] = useState(false);
  const [isTooDark, setIsTooDark] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevSampleRef = useRef<Uint8ClampedArray | null>(null);
  const stillCountRef = useRef(0);
  const autoCaptureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cornerEditorHostRef = useRef<HTMLDivElement>(null);

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
    setIsTooDark(false);
  };

  const stopCamera = () => {
    stopAutoCapture();
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
  };

  // Deliberately no camera-device picker: phones routinely expose 3-4 separate
  // rear lenses (wide/ultra-wide/telephoto) as distinct devices, which made a
  // "Camera 1 / Camera 2 / ..." dropdown show up on nearly every real phone —
  // facingMode alone reliably picks a sensible rear camera. Requesting a
  // higher ideal resolution than the browser default (which can be as low as
  // 640x480) is what was actually making captures look soft/blurry once
  // cropped down to just the document.
  const startCamera = async () => {
    setIsCameraLoading(true);
    setCameraError(null);
    setCapturedPhoto(null);
    setRawPhoto(null);
    setDetectedCorners(null);
    stopCamera();

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      activeStreamRef.current = stream;

      if (videoRef.current) {
        // Reassigning srcObject on a <video> that already has one can leave a
        // stale/black frame painted (seen on iOS Safari) until something
        // forces a real repaint. Clearing it first makes every camera
        // (re)start behave like a genuinely fresh element, instead of the
        // dark feed only clearing up once the user manually hits Retake.
        videoRef.current.srcObject = null;
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((e) => console.error('Video activation error: ', e));
      }
    } catch (err) {
      console.error('Camera access failure:', err);
      setCameraError('Could not initialize camera. Please check browser permissions or switch to file upload.');
    } finally {
      setIsCameraLoading(false);
    }
  };

  // Snapshots the full, uncropped video frame, then hands it to scanic for
  // real edge detection + perspective correction — replaces the earlier
  // approach of just cropping to the fixed viewfinder-guide rectangle, which
  // only ever matched the document by coincidence.
  const handleCapture = async () => {
    if (!videoRef.current) return;
    stopAutoCapture();
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const raw = canvas.toDataURL('image/jpeg', 0.92);
    setRawPhoto(raw);
    setIsScanning(true);
    try {
      const result = await scanDocument(canvas, { mode: 'extract', output: 'dataurl' });
      // scanic reports success as soon as it finds ANY roughly-4-sided contour,
      // even a low-confidence one — it only uses confidence internally to
      // decide whether to retry with different edge-detection parameters (its
      // own threshold for that is 0.68). A busy/textured background (wood
      // grain, patterned countertop) reliably produces exactly this: a
      // technically-"successful" but wrong crop. Apply that same 0.68 bar
      // ourselves before trusting the result, since scanic won't do it for us.
      const MIN_CONFIDENCE = 0.68;
      const confident = result.confidence == null || result.confidence >= MIN_CONFIDENCE;
      if (result.success && typeof result.output === 'string' && confident) {
        setCapturedPhoto(result.output);
        setDetectedCorners(result.corners);
      } else {
        // Low-confidence or outright failed — go straight to manual corner
        // adjustment instead of silently keeping a wrong crop. Keep whatever
        // corners scanic DID find (even low-confidence) as the editor's
        // starting point rather than the default inset guess, since a rough
        // detection is still a better starting point than none.
        setDetectedCorners(result.corners ?? null);
        setAdjustMode(true);
      }
    } catch (err) {
      console.error('Document edge detection failed:', err);
      // Fall back to the raw, uncropped capture rather than losing the photo
      // entirely — the user can still use it or adjust corners manually.
      setCapturedPhoto(raw);
    } finally {
      setIsScanning(false);
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

      // Gate on brightness before the stillness diff below: a too-dark frame
      // is trivially "unchanging" against the next too-dark frame (there's
      // nothing in either to differ), which would otherwise satisfy "held
      // still" and auto-fire a shot nobody can read. Reset the baseline too —
      // comparing the next (hopefully lit) frame against a dark one would
      // read as "moved", which is exactly backwards.
      let lumaSum = 0;
      for (let i = 0; i < frame.length; i += 4) {
        lumaSum += frame[i] * 0.299 + frame[i + 1] * 0.587 + frame[i + 2] * 0.114;
      }
      const avgLuma = lumaSum / (frame.length / 4);
      if (avgLuma < AUTO_CAPTURE_MIN_BRIGHTNESS) {
        stillCountRef.current = 0;
        setIsHolding(false);
        setIsTooDark(true);
        prevSampleRef.current = null;
        return;
      }
      setIsTooDark(false);

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
      setRawPhoto(null);
      setDetectedCorners(null);
      setAdjustMode(false);
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

  // Mounts scanic's manual corner-adjustment editor over the raw (uncropped)
  // photo whenever adjustMode is entered — either the user tapped "Adjust
  // corners" on a result they weren't happy with, or automatic detection
  // failed outright and this is the only way forward.
  useEffect(() => {
    if (!adjustMode || !rawPhoto || !cornerEditorHostRef.current) return;
    let cancelled = false;
    let editor: CornerEditor | null = null;
    loadImage(rawPhoto).then((img) => {
      if (cancelled || !cornerEditorHostRef.current) return;
      editor = createCornerEditor({
        container: cornerEditorHostRef.current,
        image: img,
        corners: detectedCorners || undefined,
        onConfirm: async (corners) => {
          setDetectedCorners(corners);
          setIsScanning(true);
          try {
            const result = await extractDocument(img, corners, { output: 'dataurl' });
            if (result.success && typeof result.output === 'string') {
              setCapturedPhoto(result.output);
            } else {
              setFileError('Could not crop to those corners — please try again.');
            }
          } catch (err) {
            console.error('Manual crop extraction failed:', err);
            setFileError('Could not crop to those corners — please try again.');
          } finally {
            setIsScanning(false);
            setAdjustMode(false);
          }
        },
        onCancel: () => {
          setAdjustMode(false);
          // If there was never a successfully detected photo to fall back to
          // (i.e. auto-detection failed and this was the mandatory path),
          // cancelling means going back to the camera, not showing nothing.
          if (!capturedPhoto) startCamera();
        },
      });
    }).catch((err) => {
      console.error(err);
      setFileError('Could not load the photo for adjustment.');
      setAdjustMode(false);
    });
    return () => {
      cancelled = true;
      editor?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustMode]);

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
      // A full-resolution, edge-detected capture of a detail-dense document
      // (an ID card's fine print) can still exceed the 700KB Firestore cap —
      // every other capture path in the app compresses first.
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
        await startCamera();
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
    startCamera();
  };

  const showingBack = requireBothSides && side === 'back';
  const effectiveSubtitle = !effectiveType
    ? undefined
    : adjustMode
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
        className="card rounded-3xl sm:rounded-2xl max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col anim-sheet"
      >
        {/* Mobile grabber bar */}
        <SheetGrabber onClose={handleClose} />

        {/* Modal Header */}
        <div className="p-4 bg-white border-b border-cream-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-ink-800 text-white shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-ink-900">
                {adjustMode ? 'Adjust corners' : title}{effectiveType && requireBothSides && !capturedPhoto && !adjustMode ? ` — ${showingBack ? 'back' : 'front'}` : ''}
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
        {/* No `justify-center` here, and `min-h-0` rather than a positive
            min-height: both fight overflow-y-auto on a short viewport. A flex
            item's automatic minimum height defaults to its content size
            unless explicitly overridden, so a positive min-h (280px) forces
            this body taller than the space left by the header+footer,
            pushing the footer (Retake/Save, or in adjustMode nothing —
            scanic's own Apply/Cancel toolbar) past the outer card's
            overflow-hidden edge with nothing left to scroll TO. And
            `justify-center` on a container whose content can overflow is the
            classic flexbox trap where the browser can only reach part of the
            overflow by scrolling. Reported live: capture review and the
            crop-adjust corners screen were both unreachable below the fold. */}
        <div className="p-5 flex-1 overflow-y-auto flex flex-col min-h-0">
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
                <button type="button" onClick={() => startCamera()} className="btn-quiet text-[13px] px-3 py-1.5">
                  Retry
                </button>
                <button type="button" onClick={handleClose} className="btn-danger text-[13px] px-3 py-1.5">
                  Close
                </button>
              </div>
            </div>
          ) : adjustMode ? (
            <div className="space-y-3">
              {/* No max-h/overflow-hidden here: scanic sizes its own editor
                  container (up to 70% of the viewport height, via a min-height
                  it sets on cornerEditorHostRef directly) to fit the photo's
                  aspect ratio, and positions its Apply/Cancel toolbar relative
                  to THAT box. A tighter cap here than scanic's own would clip
                  the toolbar out of view for a tall/portrait photo — happened
                  live at max-h-[55dvh] vs scanic's 70vh. Let it size itself;
                  the modal body around this is already scrollable. */}
              <div className="relative rounded-2xl overflow-hidden bg-black border border-cream-200">
                <div ref={cornerEditorHostRef} className="w-full" />
                {isScanning && (
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                    <RefreshCcw className="w-6 h-6 animate-spin text-white" />
                  </div>
                )}
              </div>
              <p className="text-[12px] text-ink-400 text-center italic">
                Drag the corners to match the document exactly, then tap Apply.
              </p>
              {fileError && (
                <div className="p-3 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2 leading-normal">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          ) : isScanning ? (
            <div className="relative aspect-4/3 rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-white">
                <RefreshCcw className="w-6 h-6 animate-spin" />
                <span className="text-[12px] font-semibold">Finding the edges…</span>
              </div>
            </div>
          ) : capturedPhoto ? (
            <div className="space-y-4">
              {/* No fixed aspect ratio here — scanic crops tightly to the document's own
                  shape (e.g. a card back is much wider than tall), and forcing that into a
                  4:3 box via object-contain just letterboxed it with black bars. */}
              <div className="relative rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner flex items-center justify-center">
                <img src={capturedPhoto} alt="Captured document scan" className="max-w-full max-h-[55dvh] w-auto h-auto" />
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
              {/* Viewfinder bracket overlay — a framing aid only now; the actual
                  crop comes from scanic's real edge detection after capture,
                  not from this rectangle. Brackets warm up while holding
                  still, ahead of auto-capture. */}
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
                  <span
                    className={`chip transition-colors ${
                      isTooDark ? 'bg-rosa-600/90 text-white' : isHolding ? 'bg-clay-500/90 text-white' : 'bg-black/50 text-white/90'
                    }`}
                  >
                    {isTooDark ? 'Too dark — move to better light' : isHolding ? 'Capturing…' : 'Hold steady to auto-capture, or tap to shoot'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Controls — hidden during manual corner adjustment, which has
            its own built-in Reset/Cancel/Apply toolbar. */}
        {effectiveType && !adjustMode && (
          <div className="p-4 bg-cream-50 border-t border-cream-200 flex items-center justify-between gap-2">
            {!cameraError && (
              <>
                {capturedPhoto ? (
                  <div className="flex items-center justify-between w-full gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={handleRetake} className="btn-quiet text-[13px] px-3 py-2">
                        Retake
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdjustMode(true)}
                        disabled={!rawPhoto}
                        className="btn-quiet text-[13px] px-3 py-2 disabled:opacity-40"
                        title="Fine-tune the crop corners by hand"
                      >
                        <Crop className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Adjust</span>
                      </button>
                    </div>
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
                    <span className="text-[12px] font-semibold text-ink-400">Sensor active</span>

                    {/* Shutter button — manual override, auto-capture fires on its own too */}
                    <button
                      type="button"
                      onClick={handleCapture}
                      disabled={isCameraLoading || isScanning}
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
