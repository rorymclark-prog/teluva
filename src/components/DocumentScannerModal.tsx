import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera, X, RefreshCcw, AlertCircle, Sparkles, IdCard, BookOpen, FileText, Crop, RotateCw, RotateCcw,
  Plus, ChevronLeft, Trash2, Aperture, FileUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import { createCornerEditor, type CornerEditor } from 'scanic';
import { rotateDataUrl, fitToBudget, pageByteBudget, MAX_SCAN_PAGES, SCAN_MAX_UPLOAD_BYTES } from '../utils/scanImage';
import { enhanceDataUrl, type EnhanceMode } from '../utils/docEnhance';
import { compileImagesToPdf } from '../utils/pdfCompile';
import { canvasPixels, detectPage, extractPage } from '../utils/scanPipeline';
import { looksLikeCameraFrame, scaleQuad, type Quad } from '../utils/scanGeometry';
import { takeStill, blobToCanvas, readFileAsDataUrl, rasterisePdf, scanDebugEnabled } from '../utils/scanCapture';
import { isAppleTouch } from '../utils/platform';
import { useLiveQuad, type LiveHint } from '../hooks/useLiveQuad';
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

const MAX_UPLOAD_BYTES = SCAN_MAX_UPLOAD_BYTES;

const SCAN_TYPE_OPTIONS: { type: ScanType; label: string; hint: string; icon: typeof IdCard }[] = [
  { type: 'id', label: 'ID card', hint: "We'll ask for the back too", icon: IdCard },
  { type: 'passport', label: 'Passport', hint: 'Just the photo page', icon: BookOpen },
  { type: 'document', label: 'Document', hint: 'Letters, certificates, forms — several pages is fine', icon: FileText },
];

/** Where the pixels of the current page came from. */
type Origin = 'camera' | 'cameraApp' | 'upload';
type ScanStage = 'capturing' | 'classical' | 'ml' | 'straightening' | 'reading';

/** A page already added to a multi-page scan, rendered as it will be saved. */
interface ScanPage {
  id: number;
  image: string;
}

const STAGE_MESSAGE: Record<ScanStage, string> = {
  capturing: 'Taking the photo…',
  classical: 'Finding the edges…',
  ml: 'Tricky lighting — using the sharper detector…',
  straightening: 'Straightening the page…',
  reading: 'Reading the PDF…',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/** Let React paint (the spinner) before a burst of synchronous pixel work. */
function paint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function fullFrameQuad(w: number, h: number): Quad {
  return { topLeft: { x: 0, y: 0 }, topRight: { x: w - 1, y: 0 }, bottomRight: { x: w - 1, y: h - 1 }, bottomLeft: { x: 0, y: h - 1 } };
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
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
  /* Pages already added to this scan (multi-page documents, or the front of an
   * ID while the back is being taken). Each is stored as it will be saved —
   * rotated and enhanced — and only squeezed to its share of the byte budget
   * when the PDF is compiled, so adding a page never degrades the ones before
   * it more than the final page count requires. */
  const [pages, setPages] = useState<ScanPage[]>([]);
  // The CURRENT page: pristinePhoto is the perspective-corrected capture and is
  // never written to again; capturedPhoto is what is shown, derived from it.
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [pristinePhoto, setPristinePhoto] = useState<string | null>(null);
  // Bumped on every new page. Adjust -> Apply with unchanged corners yields a
  // byte-identical pristinePhoto, and React would then skip the presentation
  // effect and leave the review spinning forever (caught at 375px in the
  // harness). The counter makes "a new page arrived" an explicit dependency.
  const [pageVersion, setPageVersion] = useState(0);
  const [detectedCorners, setDetectedCorners] = useState<Quad | null>(null);
  const [hasRaw, setHasRaw] = useState(false);
  // An upload that we cropped: offer the whole picture back in one tap, since
  // an already-scanned image can contain a box that looks like a page.
  const [croppedUpload, setCroppedUpload] = useState(false);
  const [adjustMode, setAdjustMode] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraPaused, setCameraPaused] = useState(false);
  const [isShooting, setIsShooting] = useState(false);
  const [isScanning, setIsScanning] = useState(false); // detection/extraction busy state
  // Which step is running, so the spinner can say so. The ML pass can take a
  // few seconds on its first run (it downloads a 3.4MB model), and an
  // unexplained pause reads as a hang — people retake, which throws away the
  // shot the better detector was in the middle of rescuing.
  const [scanStage, setScanStage] = useState<ScanStage>('classical');
  /* Quarter-turns clockwise the user has asked for, applied to the pristine
   * capture rather than compounded onto the last rotation — four taps must
   * cost one re-encode, not four. See rotateDataUrl(). */
  const [turns, setTurns] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  /* How the page is processed for legibility. 'color' by default because that
   * is what makes a photographed certificate look like a scan rather than a
   * snapshot — see docEnhance.ts. 'off' exists and is a genuine no-op: these
   * are irreplaceable documents, and anyone who thinks the processing has eaten
   * a faint stamp needs a way to keep the original pixels. The choice carries
   * over to the next page, as it does in Apple's scanner. */
  const [enhanceMode, setEnhanceMode] = useState<EnhanceMode>('color');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [streamSize, setStreamSize] = useState<{ width: number; height: number } | null>(null);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const debug = useMemo(() => (open ? scanDebugEnabled() : false), [open]);
  // The phone's own camera app takes a full-resolution, fully processed photo
  // — sharper than any browser video frame, and on an iPhone the only way to a
  // real still (Safari has no ImageCapture). Offered on phones and tablets;
  // on a desktop the capture attribute is ignored and it would just be a
  // second "upload" link.
  const offerCameraApp = useMemo(
    () => typeof navigator !== 'undefined' && (isAppleTouch() || /Android/i.test(navigator.userAgent)),
    [],
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const cornerEditorHostRef = useRef<HTMLDivElement>(null);
  // The full-resolution pixels of the current capture, kept so "Adjust" can
  // re-cut the page from them. Dropped as soon as the page is added — twelve
  // megapixels of RGBA is ~48MB, and holding one per page would sink a phone.
  const rawRef = useRef<{ img: ImageData; centred: boolean; origin: Origin } | null>(null);
  const busyRef = useRef(false);
  const openRef = useRef(open);
  const pageIdRef = useRef(0);
  const cameraAppInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const effectiveType = scanType ?? pickedType;
  const requireBothSides = effectiveType === 'id';

  const live = useLiveQuad(videoRef, (hint) => {
    void captureFromCamera(hint);
  });

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const clearCurrent = () => {
    setCapturedPhoto(null);
    setPristinePhoto(null);
    setTurns(0);
    setDetectedCorners(null);
    rawRef.current = null;
    setHasRaw(false);
    setCroppedUpload(false);
    setAdjustMode(false);
    setDebugLines([]);
  };

  const stopCamera = () => {
    live.stop();
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // Deliberately no camera-device picker: phones routinely expose 3-4 separate
  // rear lenses (wide/ultra-wide/telephoto) as distinct devices, which made a
  // "Camera 1 / Camera 2 / ..." dropdown show up on nearly every real phone —
  // facingMode alone reliably picks a sensible rear camera.
  const startCamera = async () => {
    setIsCameraLoading(true);
    setCameraError(null);
    setCameraPaused(false);
    clearCurrent();
    stopCamera();

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          // Ask for 4K and let the browser hand back the best its sensor and
          // this device can actually do. The page is cut out of this frame, so
          // the frame's resolution is not the document's — `ideal` degrades
          // silently when the camera cannot deliver it.
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!openRef.current) {
        // Closed while the permission prompt was up — do not leave the camera on.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      activeStreamRef.current = stream;
      if (debug) {
        const track = stream.getVideoTracks()[0];
        console.info('[scanner] camera settings', track?.getSettings(), track?.getCapabilities?.());
      }

      if (videoRef.current) {
        // Reassigning srcObject on a <video> that already has one can leave a
        // stale/black frame painted (seen on iOS Safari) until something
        // forces a real repaint. Clearing it first makes every camera
        // (re)start behave like a genuinely fresh element.
        videoRef.current.srcObject = null;
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((e) => console.error('Video activation error: ', e));
      }
    } catch (err) {
      console.error('Camera access failure:', err);
      setCameraError('Could not start the camera. Check the browser\'s camera permission, or use one of the options below.');
    } finally {
      setIsCameraLoading(false);
    }
  };

  // The <video> unmounts while a page is being reviewed and remounts for the
  // next one; re-attach the live stream to whichever element is current.
  useEffect(() => {
    const v = videoRef.current;
    const s = activeStreamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = null;
      v.srcObject = s;
      v.play().catch(() => {});
    }
  });

  const showPage = (dataUrl: string, cropped: boolean) => {
    setPristinePhoto(dataUrl);
    setPageVersion((v) => v + 1);
    setCapturedPhoto(null);
    setTurns(0);
    setCroppedUpload(cropped);
  };

  /* One capture, from any source, to a reviewed page.
   *
   *   detectPage  — the live viewfinder's quad if it had one (re-verified at
   *                 full resolution), else scanic classical, else scanic ML;
   *                 every candidate snapped to the real paper edges and
   *                 refused unless all four sides sit on one. See
   *                 scanPipeline.ts for why "close but wrong" is refused.
   *   extractPage — our own perspective warp at the page's true shape.
   *
   * Nothing verified: a camera shot opens the corner editor seeded with the
   * best guess; an uploaded image is kept whole (it may already be a scan). */
  const processCanvas = async (canvas: HTMLCanvasElement, origin: Origin, hint: LiveHint | null, kind: string) => {
    setIsScanning(true);
    setScanStage('classical');
    setFileError(null);
    try {
      await paint();
      const img = canvasPixels(canvas);
      const centred = looksLikeCameraFrame(img.width, img.height);
      rawRef.current = { img, centred, origin };
      setHasRaw(true);
      // The live quad was found on a small copy of the video; it only applies
      // to this picture if the picture has the same shape (a takePhoto still
      // can be 4:3 while the stream is 16:9).
      const sameShape = hint && Math.abs(hint.width / hint.height / (img.width / img.height) - 1) < 0.01;
      const scaledHint = hint && sameShape ? scaleQuad(hint.quad, img.width / hint.width, img.height / hint.height) : null;
      const det = await detectPage(canvas, img, { hint: scaledHint, onStage: setScanStage });
      setDetectedCorners(det.corners);
      const lines = [
        `${origin}/${kind} ${img.width}×${img.height}${centred ? ' (camera frame)' : ''}`,
        `detect: ${det.accepted ? 'accepted' : 'refused'} ${det.source ?? '-'} — ${det.reason} — ${det.ms}ms, min edge ${det.minSupport.toFixed(2)}`,
      ];
      if (det.accepted && det.corners) {
        setScanStage('straightening');
        await paint();
        const t0 = performance.now();
        const page = extractPage(img, det.corners, { centredCamera: centred });
        lines.push(`page ${page.width}×${page.height}, aspect by ${page.aspectMethod}, warp ${Math.round(performance.now() - t0)}ms`);
        showPage(page.dataUrl, origin === 'upload');
      } else if (origin === 'upload') {
        const page = extractPage(img, fullFrameQuad(img.width, img.height), { centredCamera: false });
        lines.push(`no page found — kept the whole picture ${page.width}×${page.height}`);
        showPage(page.dataUrl, false);
      } else {
        setAdjustMode(true);
      }
      setDebugLines(lines);
    } catch (err) {
      console.error('Document edge detection failed:', err);
      // Keep the whole picture rather than losing the photo — Adjust can
      // still crop it by hand.
      try {
        const raw = rawRef.current;
        if (raw) showPage(extractPage(raw.img, fullFrameQuad(raw.img.width, raw.img.height), { centredCamera: false }).dataUrl, false);
        else setFileError('Could not process that picture. Please try again.');
      } catch {
        setFileError('Could not process that picture. Please try again.');
      }
    } finally {
      setIsScanning(false);
    }
  };

  // The shutter — pressed by hand, or by the live detector once the page has
  // held still. `hint` is the verified quad the viewfinder was showing.
  const captureFromCamera = async (hint: LiveHint | null) => {
    const video = videoRef.current;
    if (!video || busyRef.current || !activeStreamRef.current) return;
    busyRef.current = true;
    live.stop();
    setIsShooting(true);
    try {
      const track = activeStreamRef.current.getVideoTracks()[0] ?? null;
      const still = await takeStill(video, track);
      stopCamera();
      setIsShooting(false);
      await processCanvas(still.canvas, 'camera', hint, still.kind);
    } catch (err) {
      console.error('Capture failed:', err);
      setFileError('Could not take the photo. Please try again.');
    } finally {
      busyRef.current = false;
      setIsShooting(false);
    }
  };

  /* A file from the phone's camera app or from the picker.
   *
   * A PDF that already fits is passed through untouched — someone who scanned
   * with Notes, Files or Preview already has the result they wanted. A bigger
   * one is re-rendered page by page into the same budget a scan gets. Images go
   * through the same pipeline as a camera capture. */
  const handleFile = async (file: File, origin: Origin) => {
    setFileError(null);
    // Any failure below leaves the person where they were: the camera comes
    // back on (it was released for the file), with the reason shown under it.
    const fail = (message: string) => {
      setFileError(message);
      void startCamera();
    };
    if (isPdf(file)) {
      let done = false;
      try {
        const data = await readFileAsDataUrl(file);
        if (file.size <= MAX_UPLOAD_BYTES) {
          stopCamera();
          onUse({ data, name: file.name, type: 'application/pdf', size: file.size });
          done = true;
          handleClose();
          return;
        }
        stopCamera();
        setScanStage('reading');
        setIsScanning(true);
        const { pages: rendered, tooMany } = await rasterisePdf(data, MAX_SCAN_PAGES);
        if (tooMany) {
          return fail(`That PDF has more than ${MAX_SCAN_PAGES} pages — too many to fit the 700 KB sync limit. Save just the pages you need as a PDF and upload that.`);
        }
        if (!rendered.length) return fail('That PDF could not be opened.');
        const per = pageByteBudget(rendered.length);
        const fitted: string[] = [];
        for (const p of rendered) {
          const f = await fitToBudget(p, { maxBytes: per });
          if (f.overBudget) return fail(`That PDF (${formatBytes(file.size)}) cannot be made small enough for the 700 KB sync limit.`);
          fitted.push(f.data);
        }
        const compiled = await compileImagesToPdf(fitted, file.name);
        if (compiled.size > MAX_UPLOAD_BYTES) {
          return fail(`That PDF still comes to ${formatBytes(compiled.size)} — over the 700 KB sync limit.`);
        }
        onUse({ data: compiled.data, name: compiled.name, type: 'application/pdf', size: compiled.size });
        done = true;
        handleClose();
      } catch (err) {
        console.error('PDF upload failed:', err);
        if (!done) fail('That PDF could not be read.');
      } finally {
        setIsScanning(false);
      }
      return;
    }
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) {
      setFileError('Choose a PDF or a photo.');
      return;
    }
    stopCamera();
    setCameraPaused(false);
    setScanStage('classical');
    setIsScanning(true);
    try {
      const canvas = await blobToCanvas(file);
      await processCanvas(canvas, origin, null, file.type || 'image');
    } catch (err) {
      console.error('Image upload failed:', err);
      setIsScanning(false);
      fail('That picture could not be opened.');
    }
  };

  // Leaving for the camera app: release our camera first (iOS will not share
  // it), and bring it back if the person cancels out of the camera app.
  const openCameraApp = () => {
    stopCamera();
    setCameraPaused(true);
  };
  useEffect(() => {
    const el = cameraAppInputRef.current;
    if (!el) return;
    const onCancel = () => {
      if (cameraPaused) void startCamera();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  });

  useEffect(() => {
    if (open) {
      setPickedType(null);
      setSide('front');
      setPages([]);
      clearCurrent();
      setFileError(null);
      setCameraError(null);
    } else {
      stopCamera();
      live.dispose();
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

  // Mounts scanic's manual corner-adjustment editor over the full capture
  // whenever adjustMode is entered — either the user tapped "Adjust" on a
  // result they weren't happy with, or no page could be verified and this is
  // the way forward. Apply re-cuts the page with our own warp, from the same
  // full-resolution pixels.
  useEffect(() => {
    const raw = rawRef.current;
    if (!adjustMode || !raw || !cornerEditorHostRef.current) return;
    let editor: CornerEditor | null = null;
    try {
      editor = createCornerEditor({
        container: cornerEditorHostRef.current,
        image: raw.img,
        corners: detectedCorners || undefined,
        onConfirm: async (corners) => {
          // Leave the editor first so the spinner shows while a 12MP page is
          // straightened (most of a second on a phone).
          setDetectedCorners(corners);
          setAdjustMode(false);
          setIsScanning(true);
          setScanStage('straightening');
          try {
            await paint();
            const page = extractPage(raw.img, corners, { centredCamera: raw.centred });
            showPage(page.dataUrl, false);
          } catch (err) {
            console.error('Manual crop extraction failed:', err);
            setFileError('Could not crop to those corners — please try again.');
            setAdjustMode(true);
          } finally {
            setIsScanning(false);
          }
        },
        onCancel: () => {
          setAdjustMode(false);
          // With no page to fall back to (detection failed and this was the
          // mandatory path), cancelling means going back to the camera.
          if (!pristinePhoto) void startCamera();
        },
      });
    } catch (err) {
      console.error(err);
      setFileError('Could not load the photo for adjustment.');
      setAdjustMode(false);
    }
    return () => {
      editor?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustMode]);

  /* THE PRESENTATION PIPELINE — one place, derived, never accumulated.
   *
   * `pristinePhoto` is the perspective-corrected capture and is never written
   * to again. What the user sees is recomputed from it whenever the rotation
   * or the enhancement mode changes: rotate first (geometry), then enhance
   * (tone). Both are re-derived from the pristine image every time rather than
   * applied on top of the last result — a JPEG round-trips through a lossy
   * encoder at each step, so chaining would charge a generation of compression
   * for every tap and leave someone who tried all four modes with a visibly
   * worse scan than someone who tried none.
   *
   * The `cancelled` flag is not defensive padding. Enhancement is ~200ms on a
   * 3.7MP page and slower on a phone, so a second tap lands mid-flight
   * routinely, and without this the earlier (slower) job can resolve last and
   * paint a mode the user already moved off. */
  useEffect(() => {
    if (!pristinePhoto) return;
    let cancelled = false;
    setIsRotating(true);
    (async () => {
      try {
        const rotated = await rotateDataUrl(pristinePhoto, turns);
        // q0.95: this is still an intermediate — the byte budget is spent once,
        // by fitToBudget, when the scan is saved.
        const shown = enhanceMode === 'off' ? rotated : await enhanceDataUrl(rotated, { mode: enhanceMode, quality: 0.95 });
        if (!cancelled) setCapturedPhoto(shown);
      } catch (err) {
        // Show the unprocessed page rather than nothing. A scan that looks
        // flat is recoverable; a review screen with no image is not.
        console.error('Scan processing failed:', err);
        if (!cancelled) setCapturedPhoto(pristinePhoto);
      } finally {
        if (!cancelled) setIsRotating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pristinePhoto, turns, enhanceMode, pageVersion]);

  if (!open) return null;

  const handleClose = () => {
    stopCamera();
    live.dispose();
    onClose();
  };

  const typePrefix = effectiveType === 'id' ? 'id_scan' : effectiveType === 'passport' ? 'passport_scan' : 'camera_scan';
  const nameFor = (ext: string) => `${filePrefix || typePrefix}_${Date.now()}.${ext}`;

  /* Turn the captured page.
   *
   * Rotation always runs from the PRISTINE capture with the cumulative turn
   * count, never from the currently-displayed image. Rotating a JPEG re-encodes
   * it, so chaining would charge a generation of compression loss per tap and
   * leave someone who turned a page full circle with a visibly worse scan than
   * they started with — for a no-op. */
  const rotate = (delta: 1 | -1) => {
    if (!pristinePhoto || isRotating) return;
    setTurns(turns + delta);
  };

  // The current page as it will be saved, once its processing has settled.
  const currentPage = (): string | null => (pristinePhoto && capturedPhoto && !isRotating ? capturedPhoto : null);
  const pageCount = pages.length + (pristinePhoto ? 1 : 0);
  const canAddPage = !requireBothSides && pages.length + 1 < MAX_SCAN_PAGES;

  // Single-page JPG (only offered for a single page when a second side isn't required).
  const handleUseJpg = async () => {
    const page = currentPage();
    if (!page) return;
    setIsCompiling(true);
    setFileError(null);
    try {
      // Encode as large and as cleanly as 700KB allows — see fitToBudget().
      const fitted = await fitToBudget(page);
      if (fitted.overBudget) {
        setFileError(
          `This photo is ${formatBytes(fitted.bytes)} even at the lowest quality we will accept — too large for cloud sync (limit 700 KB). ` +
            'Try "Save as PDF" instead.'
        );
        return;
      }
      onUse({ data: fitted.data, name: nameFor('jpg'), type: 'image/jpeg', size: fitted.bytes });
      handleClose();
    } catch (err) {
      console.error(err);
      setFileError('Failed to process the photo. Please try again.');
    } finally {
      setIsCompiling(false);
    }
  };

  // Keep the current page and go back to the camera for the next one (or, for
  // an ID card, for the back).
  const handleAddPage = async () => {
    const page = currentPage();
    if (!page) return;
    setPages((p) => [...p, { id: ++pageIdRef.current, image: page }]);
    if (requireBothSides) setSide('back');
    await startCamera();
  };

  /* Every page into one PDF under the record ceiling.
   *
   * Each page gets an equal share of the budget (pageByteBudget), spent by
   * fitToBudget from the full-quality page — so a one-page scan is stored at
   * full resolution and a six-page one at what six pages can afford, and
   * nothing is compressed twice. */
  const handleSavePdf = async (includeCurrent: boolean) => {
    const current = includeCurrent ? currentPage() : null;
    if (includeCurrent && !current) return;
    const all = [...pages.map((p) => p.image), ...(current ? [current] : [])];
    if (!all.length) return;
    setIsCompiling(true);
    setFileError(null);
    try {
      const perPage = pageByteBudget(all.length);
      const fitted: string[] = [];
      for (let i = 0; i < all.length; i++) {
        const f = await fitToBudget(all[i], { maxBytes: perPage });
        if (f.overBudget) {
          setFileError(
            `${all.length} pages do not fit the 700 KB sync limit together (page ${i + 1} alone needs ${formatBytes(f.bytes)}). ` +
              'Remove a page, or save the pages as two scans.'
          );
          return;
        }
        fitted.push(f.data);
      }
      const compiled = await compileImagesToPdf(fitted, nameFor('pdf'));
      if (compiled.size > MAX_UPLOAD_BYTES) {
        setFileError(`The PDF came to ${formatBytes(compiled.size)} — over the 700 KB sync limit. Remove a page and save again.`);
        return;
      }
      stopCamera();
      onUse({ data: compiled.data, name: compiled.name, type: 'application/pdf', size: compiled.size });
      handleClose();
    } catch (err) {
      console.error(err);
      setFileError('Failed to compile the scan into a PDF.');
    } finally {
      setIsCompiling(false);
    }
  };

  const removePage = (id: number) => setPages((p) => p.filter((x) => x.id !== id));
  const movePageEarlier = (index: number) =>
    setPages((p) => {
      if (index <= 0 || index >= p.length) return p;
      const next = p.slice();
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });

  const showingBack = requireBothSides && side === 'back';
  const stage: 'pick' | 'error' | 'adjust' | 'working' | 'review' | 'camera' = !effectiveType
    ? 'pick'
    : adjustMode
      ? 'adjust'
      : isScanning
        ? 'working'
        : pristinePhoto
          ? 'review'
          : cameraError
            ? 'error'
            : 'camera';

  const effectiveSubtitle =
    stage !== 'camera'
      ? undefined
      : showingBack
        ? 'Now flip it over — the back of the card'
        : pages.length > 0
          ? `Page ${pages.length + 1} — or tap Done to save ${pages.length === 1 ? 'the page' : `all ${pages.length}`}`
          : subtitle || (requireBothSides ? 'The front of the card' : 'Hold the phone over the page — it shoots by itself');

  // Viewfinder box: the stream's own shape, so nothing the camera sees is
  // cropped away (object-contain) and the outline lands exactly on the page;
  // as large as the screen allows while the footer stays in view.
  const frame = live.state.frame ?? streamSize;
  const frameAspect = frame ? frame.width / frame.height : 3 / 4;
  const viewfinderStyle = {
    aspectRatio: `${frame ? frame.width : 3} / ${frame ? frame.height : 4}`,
    width: `min(100%, max(12rem, calc((100dvh - 21rem) * ${frameAspect.toFixed(4)})))`,
  };

  const liveStatus = live.state.status;
  const chip = isShooting || liveStatus === 'firing'
    ? { text: 'Capturing…', cls: 'bg-clay-500/90 text-white' }
    : liveStatus === 'dark'
      ? { text: 'Too dark — move to better light', cls: 'bg-rosa-600/90 text-white' }
      : liveStatus === 'edge'
        ? { text: 'Move back — fit the whole page in view', cls: 'bg-rosa-600/90 text-white' }
        : liveStatus === 'holding'
          ? { text: live.state.engine === 'stillness' ? 'Capturing…' : 'Hold steady…', cls: 'bg-clay-500/90 text-white' }
          : { text: live.state.engine === 'stillness' ? 'Hold steady to auto-capture, or tap to shoot' : 'Looking for the page… or tap to shoot', cls: 'bg-black/50 text-white/90' };

  const quad = live.state.quad;
  const quadPoints = quad
    ? [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';

  const errorBox = fileError && (
    <div className="p-3 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2 leading-normal">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
      <span>{fileError}</span>
    </div>
  );

  const debugBox = debug && debugLines.length > 0 && (
    <div className="p-2 rounded-lg bg-ink-900 text-cream-100 font-mono text-[10px] leading-snug space-y-0.5">
      {debugLines.map((l) => <p key={l}>{l}</p>)}
    </div>
  );

  // Pages already in this scan. Delete and move-earlier are real buttons with
  // names, not gestures: this list is where someone notices they photographed
  // page 3 twice. An ID's front is shown but not editable — the two sides are
  // a fixed pair.
  const pageStrip = pages.length > 0 && (
    <div className="min-w-0">
      <p className="text-[12px] font-semibold text-ink-500 mb-1.5">
        {requireBothSides ? 'Front saved' : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} added`}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {pages.map((p, i) => (
          <div key={p.id} className="shrink-0 flex flex-col items-center gap-1">
            <div className="relative h-16 w-12 rounded-md overflow-hidden border border-cream-300 bg-white">
              <img src={p.image} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
              <span className="absolute bottom-0 left-0 right-0 text-center text-[10px] font-semibold bg-black/55 text-white">{i + 1}</span>
            </div>
            {!requireBothSides && (
              <div className="flex gap-0.5">
                <button
                  type="button"
                  onClick={() => movePageEarlier(i)}
                  disabled={i === 0}
                  className="p-1 rounded-md text-ink-500 hover:bg-cream-100 disabled:opacity-30"
                  aria-label={`Move page ${i + 1} earlier`}
                  title="Move earlier"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removePage(p.id)}
                  className="p-1 rounded-md text-rosa-600 hover:bg-rosa-50"
                  aria-label={`Remove page ${i + 1}`}
                  title="Remove page"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // Other ways in: the phone's camera app (sharpest), or a PDF/photo that was
  // already scanned elsewhere. Both feed the same pipeline as the live camera.
  const otherWays = (
    <div className="space-y-2">
      {offerCameraApp && (
        <label
          onClick={openCameraApp}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-cream-300 bg-cream-50 hover:bg-cream-100 text-[13px] font-semibold text-ink-700 cursor-pointer"
        >
          <Aperture className="w-4 h-4" />
          <span>Take with the camera app (sharpest)</span>
          <input
            ref={cameraAppInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void handleFile(f, 'cameraApp');
              else void startCamera();
            }}
          />
        </label>
      )}
      {pages.length === 0 && !showingBack && (
        <p className="text-[12px] text-ink-400 text-center leading-snug">
          Already scanned it with your iPhone (Notes, Files) or a Mac (Preview)?{' '}
          <button
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            className="inline-flex items-center gap-1 font-semibold text-clay-600 hover:text-clay-500 underline underline-offset-2 cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5" />
            Upload the PDF
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void handleFile(f, 'upload');
            }}
          />
        </p>
      )}
    </div>
  );

  // PORTALLED TO <body>, deliberately. The scanner is opened from the chat
  // panel too, and that panel is `.glass` — `backdrop-filter` makes an element
  // the containing block for every `position: fixed` descendant. Rendered in
  // place, this overlay's `inset-0` resolved to the CHAT SHEET's box (inset-x-3
  // bottom-24, 72dvh tall) instead of the viewport, and the sheet's
  // `overflow-hidden` then clipped it: the card was taller than the sheet, so
  // Retake/Adjust/Use/Save-as were cut off below the fold with nothing to
  // scroll — the modal's own body had already fit its content. A portal is the
  // only fix; no z-index or height reaches out of a containing block.
  return createPortal(
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
        <div className="px-4 py-3 bg-white border-b border-cream-200 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="p-2 rounded-xl bg-ink-800 text-white shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-ink-900">
                {stage === 'adjust' ? 'Adjust corners' : title}{requireBothSides && (stage === 'camera' || stage === 'review') ? ` — ${showingBack ? 'back' : 'front'}` : ''}
              </h3>
              {effectiveSubtitle && <p className="text-[12px] text-ink-400 mt-0.5">{effectiveSubtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close scanner"
            className="p-1.5 hover:bg-cream-100 text-ink-400 hover:text-ink-700 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        {/* No `justify-center` here, and `min-h-0` rather than a positive
            min-height: both fight overflow-y-auto on a short viewport. A flex
            item's automatic minimum height defaults to its content size
            unless explicitly overridden, so a positive min-h forces this body
            taller than the space left by the header+footer, pushing the footer
            past the outer card's overflow-hidden edge with nothing left to
            scroll TO. And `justify-center` on a container whose content can
            overflow is the classic flexbox trap where the browser can only
            reach part of the overflow by scrolling. Reported live: capture
            review and the crop-adjust corners screen were both unreachable
            below the fold. */}
        <div className="p-4 flex-1 overflow-y-auto flex flex-col min-h-0">
          {stage === 'pick' ? (
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
          ) : stage === 'error' ? (
            <div className="space-y-3">
              <div className="p-4 bg-rosa-50 border border-rosa-100 text-rosa-700 rounded-2xl space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 text-rosa-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <h4 className="text-[13px] font-semibold">Camera not available</h4>
                    <p className="text-[13px] leading-relaxed">{cameraError}</p>
                  </div>
                </div>
                <div className="flex items-center pt-1 justify-end">
                  <button type="button" onClick={() => startCamera()} className="btn-quiet text-[13px] px-3 py-1.5">
                    Retry
                  </button>
                </div>
              </div>
              {otherWays}
              {errorBox}
            </div>
          ) : stage === 'adjust' ? (
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
              </div>
              <p className="text-[12px] text-ink-400 text-center italic">
                {pristinePhoto
                  ? 'Drag the corners to match the document exactly, then tap Apply.'
                  : 'We could not find all four edges of the page for certain. Drag the corners onto the page, then tap Apply.'}
              </p>
              {errorBox}
            </div>
          ) : stage === 'working' ? (
            <div className="space-y-3">
              <div className="relative aspect-4/3 rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-white px-4 text-center">
                  <RefreshCcw className="w-6 h-6 animate-spin" />
                  <span className="text-[12px] font-semibold">{STAGE_MESSAGE[scanStage]}</span>
                </div>
              </div>
              {pageStrip}
            </div>
          ) : stage === 'review' ? (
            <div className="space-y-3">
              {/* No fixed aspect ratio here — the page is cut at its own shape
                  (a card is much wider than tall), and forcing that into a 4:3
                  box would letterbox it with black bars. */}
              <div className="relative rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner flex items-center justify-center min-h-0">
                {capturedPhoto ? (
                  <img src={capturedPhoto} alt="Captured document scan" className="max-w-full max-h-[calc(100dvh-25rem)] w-auto h-auto" />
                ) : (
                  <div className="aspect-3/4 w-1/2" />
                )}
                {(isRotating || !capturedPhoto) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <RefreshCcw className="w-5 h-5 animate-spin text-white" />
                  </div>
                )}
                <div className="absolute top-3 left-3 chip bg-sage-700/80 text-sage-100 border border-sage-600/50">
                  {requireBothSides ? `${showingBack ? 'Back' : 'Front'} captured` : pages.length > 0 ? `Page ${pages.length + 1}` : 'Captured'}
                </div>
              </div>
              {/* Enhancement picker. Visible and labelled in words rather than
                  icons: this decides what the stored copy of a legal document
                  looks like, and "Original" in particular has to be findable by
                  someone who thinks the processing has changed their page. */}
              <div className="flex items-center justify-center gap-1 flex-wrap">
                {([
                  { mode: 'color', label: 'Colour' },
                  { mode: 'grayscale', label: 'Grey' },
                  { mode: 'bw', label: 'B&W' },
                  { mode: 'off', label: 'Original' },
                ] as { mode: EnhanceMode; label: string }[]).map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setEnhanceMode(mode)}
                    disabled={isRotating}
                    aria-pressed={enhanceMode === mode}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                      enhanceMode === mode
                        ? 'bg-sage-700 text-white border-sage-700'
                        : 'bg-cream-50 text-ink-500 border-cream-300 hover:bg-cream-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-ink-400 text-center italic">
                {enhanceMode === 'off'
                  ? 'Unprocessed — exactly what the camera saw.'
                  : 'Check that text and key numbers are clearly legible before saving.'}
              </p>
              {croppedUpload && (
                <p className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      const raw = rawRef.current;
                      if (!raw) return;
                      showPage(extractPage(raw.img, fullFrameQuad(raw.img.width, raw.img.height), { centredCamera: false }).dataUrl, false);
                    }}
                    className="text-[12px] font-semibold text-clay-600 hover:text-clay-500 underline underline-offset-2 cursor-pointer"
                  >
                    Wrong crop? Use the whole picture
                  </button>
                </p>
              )}
              {pageStrip}
              {!canAddPage && !requireBothSides && (
                <p className="text-[12px] text-ink-400 text-center">
                  {MAX_SCAN_PAGES} pages is the most one scan can hold within the 700 KB sync limit.
                </p>
              )}
              {debugBox}
              {errorBox}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative mx-auto rounded-2xl overflow-hidden bg-black border border-cream-200 shadow-inner" style={viewfinderStyle}>
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
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    if (v.videoWidth && v.videoHeight) setStreamSize({ width: v.videoWidth, height: v.videoHeight });
                  }}
                  onPlaying={(e) => {
                    const v = e.currentTarget;
                    if (v.videoWidth && v.videoHeight) setStreamSize({ width: v.videoWidth, height: v.videoHeight });
                    if (!busyRef.current) live.start();
                  }}
                  className="w-full h-full object-contain"
                />
                {/* The live page outline — drawn only for a page the detector
                    has verified (all four sides on a real paper edge), or in
                    red for one that runs out of the frame. The viewBox is the
                    detector's own frame, and the box has the stream's shape,
                    so the outline sits exactly on the page. */}
                {quad && live.state.frame && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${live.state.frame.width} ${live.state.frame.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    aria-hidden="true"
                  >
                    <polygon
                      points={quadPoints}
                      className={live.state.good ? 'fill-clay-500/20 stroke-clay-400' : 'fill-none stroke-rosa-500'}
                      strokeWidth={3}
                      strokeDasharray={live.state.good ? undefined : '8 6'}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                {cameraPaused && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white z-10 px-6 text-center">
                    <span className="text-[12px] font-semibold">Camera paused while the camera app is open.</span>
                    <button type="button" onClick={() => startCamera()} className="btn-quiet text-[13px] px-3 py-1.5">
                      Resume camera
                    </button>
                  </div>
                )}
                {debug && (
                  <div className="absolute top-2 left-2 right-2 font-mono text-[10px] text-white/90 bg-black/50 rounded px-1.5 py-1 pointer-events-none">
                    {streamSize ? `${streamSize.width}×${streamSize.height}` : '—'} · {live.state.engine ?? 'idle'} · {live.state.lastMs ?? '-'}ms · {liveStatus}
                  </div>
                )}
                {!isCameraLoading && !cameraPaused && (
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none px-2">
                    <span className={`chip transition-colors ${chip.cls}`}>{chip.text}</span>
                  </div>
                )}
              </div>
              {pageStrip}
              {otherWays}
              {errorBox}
            </div>
          )}
        </div>

        {/* Modal Controls — hidden during manual corner adjustment, which has
            its own built-in Reset/Cancel/Apply toolbar. */}
        {stage !== 'pick' && stage !== 'adjust' && (
          <div className="px-4 py-3 bg-cream-50 border-t border-cream-200 shrink-0">
            {stage === 'review' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => startCamera()} className="btn-quiet text-[13px] px-3 py-2">
                      Retake
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustMode(true)}
                      disabled={!hasRaw}
                      className="btn-quiet text-[13px] px-3 py-2 disabled:opacity-40"
                      title="Fine-tune the crop corners by hand"
                      aria-label="Adjust corners"
                    >
                      <Crop className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Adjust</span>
                    </button>
                    {/* Rotate. Icon-only on purpose — these sit beside Retake
                        and Adjust in a row that has to survive a 375px phone,
                        and a rotation arrow is one of the few genuinely
                        unambiguous icons. Both carry a title and an aria-label
                        so the control is still named for anyone who cannot
                        see the arrow. */}
                    <button
                      type="button"
                      onClick={() => rotate(-1)}
                      disabled={!pristinePhoto || isRotating}
                      className="btn-quiet text-[13px] px-2 py-2 disabled:opacity-40"
                      title="Rotate left"
                      aria-label="Rotate left"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => rotate(1)}
                      disabled={!pristinePhoto || isRotating}
                      className="btn-quiet text-[13px] px-2 py-2 disabled:opacity-40"
                      title="Rotate right"
                      aria-label="Rotate right"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {canAddPage && (
                    <button
                      type="button"
                      onClick={handleAddPage}
                      disabled={isCompiling || !capturedPhoto || isRotating}
                      className="btn-quiet text-[13px] px-2.5 py-2 whitespace-nowrap shrink-0 disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add page</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2">
                  {pages.length === 0 && !requireBothSides && (
                    <button type="button" onClick={handleUseJpg} disabled={isCompiling || !capturedPhoto || isRotating} className="btn-quiet text-[13px] px-3 py-2">
                      Use JPG
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => (requireBothSides && side === 'front' ? handleAddPage() : handleSavePdf(true))}
                    disabled={isCompiling || !capturedPhoto || isRotating}
                    className="btn-primary text-[13px] px-4 py-2"
                  >
                    {isCompiling ? (
                      <>
                        <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
                        <span>Compiling…</span>
                      </>
                    ) : requireBothSides && side === 'front' ? (
                      <span>Use this side — now the back</span>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{pageCount > 1 ? `Save ${pageCount} pages as PDF` : 'Save as PDF'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="w-24 flex justify-start">
                  {stage === 'camera' && pages.length > 0 && !requireBothSides && (
                    <button
                      type="button"
                      onClick={() => handleSavePdf(false)}
                      disabled={isCompiling}
                      className="btn-quiet text-[13px] px-3 py-2"
                    >
                      {isCompiling ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : null}
                      <span>Done ({pages.length})</span>
                    </button>
                  )}
                </div>

                {/* Shutter button — manual override; auto-capture fires on its own too */}
                {stage === 'camera' && (
                  <button
                    type="button"
                    onClick={() => captureFromCamera(null)}
                    disabled={isCameraLoading || isScanning || isShooting || cameraPaused || !activeStreamRef.current}
                    className="p-3 bg-clay-500 hover:bg-clay-600 disabled:bg-cream-300 text-white rounded-full cursor-pointer border-4 border-white shadow-soft active:scale-95 transition-transform"
                    title="Capture photo now"
                    aria-label="Capture photo now"
                  >
                    <div className="w-5 h-5 bg-transparent border-2 border-white rounded-full"></div>
                  </button>
                )}

                <div className="w-24 flex justify-end">
                  <button type="button" onClick={handleClose} className="text-[13px] font-semibold text-ink-500 hover:text-ink-800 px-2 cursor-pointer">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
