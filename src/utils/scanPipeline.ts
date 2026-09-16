/* ---------------------------------------------------------------------------
 * The scanner's capture pipeline: find the page in a full-resolution frame,
 * decide whether to believe it, and cut it out.
 *
 *   detectPage()   live quad (if the viewfinder already found the page)
 *                  → scanic classical → scanic ML, each one snapped to the
 *                  real paper edges at full resolution by refineQuad() and
 *                  VERIFIED before it is accepted. Nothing verified → the
 *                  caller opens the corner editor, seeded with the best guess.
 *   extractPage()  our own perspective warp, straight to the output size with
 *                  the page's true aspect, as a JPEG — see scanGeometry.ts.
 *
 * Kept out of DocumentScannerModal so the offline scanner bench runs exactly
 * this code over the synthetic scenes, rather than a copy of it.
 * ------------------------------------------------------------------------- */

import { scanDocument, type ScannerResult } from 'scanic';
import {
  refineQuad,
  touchesFrame,
  isConvexQuad,
  quadArea,
  outputSize,
  warpQuad,
  type Quad,
} from './scanGeometry';
import { SCAN_TARGET_LONG_EDGE } from './scanImage';

/* Where the ML corner detector's model and WASM are served from — our own
 * origin, copied there at build time (see copyScanicMlAssets in vite.config.ts)
 * rather than fetched from scanic's default CDN. */
export const SCANIC_ML_ASSETS = '/scanic-ml/';

/* Confidence below which we stop believing a detector.
 *
 * scanic reports success as soon as it finds ANY roughly-four-sided contour and
 * only uses confidence internally (its own retry threshold is 0.68), so a
 * wood-grain table or a patterned worktop reliably produces a technically
 * "successful" but wrong quad. Applying its own bar ourselves is what stops a
 * passport being saved as a tight crop of the printed eagle. */
export const MIN_CLASSICAL_CONFIDENCE = 0.68;

/* Share of each side that must lie on a measured paper edge (see refineQuad).
 *
 * The second half of "do we believe this quad", and the half scanic never had:
 * its confidence scores the SHAPE of a candidate, so a quad with one side on
 * the frame border (page running out of shot) or across the middle of a page
 * scores 0.9+ like a real one. On the scanner bench every correct detection
 * — pale desk, dark desk, wood grain, 1080p to 12 MP, 28-degree tilt — had its
 * weakest side at 0.8 or above; the out-of-frame page sat at 0.0 on its
 * missing side. 0.6 leaves room for a fingertip or a paperclip over one edge.
 * Erring high only costs a trip to the corner editor, which is the safe side. */
export const MIN_EDGE_SUPPORT = 0.6;

/* scanic's own "is this a plausible document" floor is 4% of the frame (an
 * emblem, a logo) — see the note in DocumentScannerModal's history. Require the
 * quad to cover a real share of the frame. */
export const MIN_COVERAGE_RATIO = 0.3;

/* A floor for EVERY accepted quad, whichever detector produced it. Lower than
 * the classical coverage ratio on purpose: the ML detector does not apply that
 * ratio, and an ID card held at a comfortable distance can fill well under
 * 30% of the frame. This only stops a live hint or an ML guess collapsing
 * onto a logo or a photo inside the page. */
export const MIN_QUAD_AREA_RATIO = 0.08;

export type DetectSource = 'live' | 'classical' | 'ml';

export interface PageDetection {
  /** Best corners found, verified or not — seeds the corner editor if not. */
  corners: Quad | null;
  accepted: boolean;
  source: DetectSource | null;
  confidence: number | null;
  minSupport: number;
  /** Why it was or wasn't accepted — shown only in scanner debug mode. */
  reason: string;
  ms: number;
}

export interface Verdict {
  corners: Quad;
  ok: boolean;
  minSupport: number;
  reason: string;
}

/** Full-resolution pixels of a canvas, read once and shared by every check. */
export function canvasPixels(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx) throw new Error('No 2D context for the captured frame');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Snap a candidate to the paper edges and decide whether to believe it.
 * Every gate here fails towards the corner editor, never towards a crop.
 */
export function verifyQuad(img: ImageData, q: Quad, confidence: number | null): Verdict {
  const { width: w, height: h } = img;
  if (!isConvexQuad(q)) return { corners: q, ok: false, minSupport: 0, reason: 'not convex' };
  const r = refineQuad(img.data, w, h, q);
  const corners = r.corners;
  if (confidence != null && confidence < MIN_CLASSICAL_CONFIDENCE) {
    return { corners, ok: false, minSupport: r.minSupport, reason: `confidence ${confidence.toFixed(2)}` };
  }
  if (touchesFrame(corners, w, h) || touchesFrame(q, w, h)) {
    return { corners, ok: false, minSupport: r.minSupport, reason: 'page runs out of the frame' };
  }
  if (quadArea(corners) < MIN_QUAD_AREA_RATIO * w * h) {
    return { corners, ok: false, minSupport: r.minSupport, reason: 'too small' };
  }
  if (r.minSupport < MIN_EDGE_SUPPORT) {
    return { corners, ok: false, minSupport: r.minSupport, reason: `edge support ${r.minSupport.toFixed(2)}` };
  }
  return { corners, ok: true, minSupport: r.minSupport, reason: 'verified' };
}

/**
 * Find the page in a captured frame.
 *
 * `hint` is the quad the live viewfinder was tracking when it fired, already
 * scaled to this frame. It is not trusted either — it goes through the same
 * full-resolution verification as a fresh detection — but when it passes, the
 * capture skips both detectors and is ready in a fraction of the time.
 */
export async function detectPage(
  canvas: HTMLCanvasElement,
  img: ImageData,
  opts: { hint?: Quad | null; onStage?: (stage: 'classical' | 'ml') => void } = {},
): Promise<PageDetection> {
  const t0 = performance.now();
  const done = (d: Omit<PageDetection, 'ms'>): PageDetection => ({ ...d, ms: Math.round(performance.now() - t0) });
  const tried: { v: Verdict; source: DetectSource; confidence: number | null }[] = [];

  if (opts.hint) {
    const v = verifyQuad(img, opts.hint, null);
    if (v.ok) return done({ corners: v.corners, accepted: true, source: 'live', confidence: null, minSupport: v.minSupport, reason: v.reason });
    tried.push({ v, source: 'live', confidence: null });
  }

  opts.onStage?.('classical');
  let classical: ScannerResult | null = null;
  try {
    // scanic's own defaults for "is this candidate even a plausible
    // document" are very loose — minDocumentCoverageRatio defaults to 0.04,
    // i.e. a 4-sided shape covering as little as 4% of the frame (an emblem,
    // a logo, a corner of texture on a passport's inside cover) still counts
    // as "valid" internally, which is how a real passport photo was once
    // saved as a tight crop of just the printed eagle.
    classical = await scanDocument(canvas, { mode: 'detect', minDocumentCoverageRatio: MIN_COVERAGE_RATIO });
  } catch (err) {
    console.warn('Classical corner detection failed:', err);
  }
  if (classical?.success && classical.corners) {
    const v = verifyQuad(img, classical.corners, classical.confidence ?? null);
    if (v.ok) return done({ corners: v.corners, accepted: true, source: 'classical', confidence: classical.confidence ?? null, minSupport: v.minSupport, reason: v.reason });
    tried.push({ v, source: 'classical', confidence: classical.confidence ?? null });
  }

  /* THE SECOND DETECTOR.
   *
   * scanic's classical path finds edges by contrast, so it wants a dark
   * document on a light table or the other way round; a page on a pale desk or
   * in soft light gives it edges weaker than the noise. scanic also ships
   * DocCornerNet, a small model trained to find document corners, which is far
   * more robust there — but it is a 3.4MB download, so it only runs for the
   * shots the fast path could not verify.
   *
   * threaded:false is not a tuning choice. The threaded WASM runtime needs
   * SharedArrayBuffer, which needs cross-origin isolation (COOP/COEP), and
   * this app does not send those headers — asking for threads would fail to
   * initialise rather than run slowly. */
  opts.onStage?.('ml');
  try {
    const ml = await scanDocument(canvas, {
      mode: 'detect',
      minDocumentCoverageRatio: MIN_COVERAGE_RATIO,
      detector: 'ml',
      ml: { assetBaseUrl: SCANIC_ML_ASSETS, threaded: false },
    });
    if (ml.success && ml.corners) {
      const v = verifyQuad(img, ml.corners, ml.confidence ?? null);
      if (v.ok) return done({ corners: v.corners, accepted: true, source: 'ml', confidence: ml.confidence ?? null, minSupport: v.minSupport, reason: v.reason });
      tried.push({ v, source: 'ml', confidence: ml.confidence ?? null });
    }
  } catch (mlErr) {
    // Model missing, offline, WASM refused — all the same outcome here: no
    // second opinion, so fall through to the corner editor rather than
    // losing the shot.
    console.warn('ML corner detection unavailable:', mlErr);
  }

  // Nothing verified. Seed the editor with the candidate that had the most
  // real edge under it — a rough detection is a better start than an inset box.
  const best = tried.sort((a, b) => b.v.minSupport - a.v.minSupport)[0];
  return done({
    corners: best?.v.corners ?? null,
    accepted: false,
    source: best?.source ?? null,
    confidence: best?.confidence ?? null,
    minSupport: best?.v.minSupport ?? 0,
    reason: best ? `${best.source}: ${best.v.reason}` : 'no page found',
  });
}

export interface ExtractedPage {
  dataUrl: string;
  width: number;
  height: number;
  aspectMethod: 'perspective' | 'sides';
}

/**
 * Cut the page out of the frame at its true shape, straight to at most
 * `maxLongEdge`, as a JPEG.
 *
 * JPEG at 0.95 rather than scanic's PNG: this is the pristine intermediate the
 * rotate/enhance/fit steps all start from, and a PNG of a 12 MP page is a
 * 13 MB string held in React state for no visible gain over q0.95.
 */
export function extractPage(
  img: ImageData,
  q: Quad,
  opts: { maxLongEdge?: number; centredCamera?: boolean; quality?: number } = {},
): ExtractedPage {
  const size = outputSize(q, img.width, img.height, opts.maxLongEdge ?? SCAN_TARGET_LONG_EDGE, {
    centredCamera: opts.centredCamera,
  });
  const px = warpQuad(img.data, img.width, img.height, q, size.width, size.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for the page');
  ctx.putImageData(new ImageData(px, size.width, size.height), 0, 0);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', opts.quality ?? 0.95),
    width: size.width,
    height: size.height,
    aspectMethod: size.aspectMethod,
  };
}
