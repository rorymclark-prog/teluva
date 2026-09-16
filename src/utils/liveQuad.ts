/* ---------------------------------------------------------------------------
 * Live page detection for the viewfinder — the "yellow outline" Apple's
 * scanner draws while you line the phone up, and the signal auto-capture
 * waits for.
 *
 * Runs on a small copy of the video frame (LIVE_LONG_EDGE px on the long
 * side), inside a Web Worker (see workers/liveQuad.worker.ts), a few times a
 * second. Uses only scanic's classical detector: it is ~10-40ms at this size,
 * whereas the ML model is a 3.4MB download and far too slow per frame. The
 * same verification as a still capture applies — a found quad only counts as
 * "good" when every side sits on a measured paper edge and it does not touch
 * the frame — so auto-capture cannot fire on a quad that would be refused
 * after the shot.
 *
 * No DOM here (ImageData in, plain objects out), so the worker can import it.
 * ------------------------------------------------------------------------- */

import { scanDocument } from 'scanic';
import { refineQuad, touchesFrame, isConvexQuad, quadArea, type Quad } from './scanGeometry';
import { MIN_CLASSICAL_CONFIDENCE, MIN_COVERAGE_RATIO, MIN_EDGE_SUPPORT, MIN_QUAD_AREA_RATIO } from './scanPipeline';

/** Long edge of the frame copy the live detector sees. */
export const LIVE_LONG_EDGE = 640;

export interface LiveResult {
  corners: Quad | null;
  confidence: number | null;
  minSupport: number;
  /** Found, verified, fully in frame — the only state auto-capture counts. */
  good: boolean;
  ms: number;
}

export async function detectLive(img: ImageData): Promise<LiveResult> {
  const t0 = performance.now();
  const r = await scanDocument(img, {
    mode: 'detect',
    maxProcessingDimension: LIVE_LONG_EDGE,
    minDocumentCoverageRatio: MIN_COVERAGE_RATIO,
  });
  if (!r.success || !r.corners || !isConvexQuad(r.corners)) {
    return { corners: null, confidence: r.confidence ?? null, minSupport: 0, good: false, ms: performance.now() - t0 };
  }
  const refined = refineQuad(img.data, img.width, img.height, r.corners);
  const q = refined.corners;
  const conf = r.confidence ?? null;
  const good =
    (conf == null || conf >= MIN_CLASSICAL_CONFIDENCE) &&
    refined.minSupport >= MIN_EDGE_SUPPORT &&
    !touchesFrame(q, img.width, img.height) &&
    quadArea(q) >= MIN_QUAD_AREA_RATIO * img.width * img.height;
  return { corners: q, confidence: conf, minSupport: refined.minSupport, good, ms: performance.now() - t0 };
}
