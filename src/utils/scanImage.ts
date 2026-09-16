/* ---------------------------------------------------------------------------
 * Geometry and size handling for camera scans.
 *
 * Two jobs that used to be missing or done badly in DocumentScannerModal:
 *
 *  1. ROTATION. There was none. A certificate photographed side-on — which is
 *     what you do when the document is on a desk and you are standing at the
 *     wrong end of it — was saved side-on, and nothing in the app could turn
 *     it. Every scanner people compare us to has this, and the absence is the
 *     kind of gap that makes an otherwise-working feature feel unfinished.
 *
 *  2. FITTING THE UPLOAD BUDGET. The old path compressed once, at a fixed
 *     1600px / q0.82, and if the result was still over the 700KB cap it gave
 *     up with an error telling the user to "retake with less background". That
 *     is backwards twice over: it asks the person to fix a problem the code
 *     can solve, and it pins EVERY scan — including the ones with room to
 *     spare — to whatever quality the worst case needed. A detail-dense ID card
 *     and a sparse letter got the same treatment.
 *
 * The rule this file follows for both: spend the budget, do not ration it.
 * Start at the resolution OCR actually wants and step down only as far as the
 * cap forces, so a document that fits at full quality keeps full quality.
 * ------------------------------------------------------------------------- */

/** The Firestore-record ceiling every scan has to land under. */
export const SCAN_MAX_UPLOAD_BYTES = 700 * 1024;

/* Long edge to aim for, in pixels.
 *
 * 2200 is not a guess — it is the same number as OCR_RENDER_LONG_EDGE in
 * docText.ts, which is what the reader rasterises a PDF page to before sending
 * it to Vision. Saving a scan smaller than that guarantees the OCR path
 * upscales blur back to 2200 later, so every pixel below this line is one the
 * document reader will miss a digit for. The old 1600 was chosen to make the
 * 700KB cap easy, which is exactly the wrong way round. */
export const SCAN_TARGET_LONG_EDGE = 2200;

/* The ladder we walk down when 2200 at good quality will not fit.
 *
 * Quality first, then size. That order matters: JPEG quality between 0.9 and
 * 0.7 costs mostly ringing around high-contrast edges, which on a page of
 * black text on white paper is visually mild, whereas dropping the long edge
 * costs glyph strokes outright, and a stroke you did not capture cannot be
 * recovered by any later step. Only once quality is at 0.7 — below which text
 * genuinely starts to mush — do we begin giving up pixels. */
const QUALITY_LADDER = [0.92, 0.86, 0.8, 0.74, 0.7];
const DIMENSION_LADDER = [2200, 1900, 1600, 1400, 1200, 1000];

/* Pages per multi-page scan.
 *
 * Every page of a scan shares ONE 700KB record, so each extra page is paid for
 * in resolution on all the others. At six, each page still gets ~115KB — a
 * full text page at about 1400px, which OCR reads — and the bottom of the
 * ladder above (1000px at q0.7, roughly 60-100KB for a dense page) still
 * fits. Beyond that the cap starts refusing pages outright, so the scanner
 * stops offering "Add page" instead. */
export const MAX_SCAN_PAGES = 6;

/* What jsPDF adds on top of the JPEG bytes: document structure plus a page
 * object and image XObject per page — measured at ~2.8KB + ~0.5KB per page on
 * the scanner bench's pages. Reserved at roughly double: over-reserving costs a
 * few KB of JPEG quality, under-reserving costs a failed save. */
const PDF_BASE_OVERHEAD_BYTES = 6 * 1024;
const PDF_PAGE_OVERHEAD_BYTES = 2 * 1024;

/** Byte budget for EACH page when `pageCount` pages must share one PDF under `totalBytes`. */
export function pageByteBudget(pageCount: number, totalBytes: number = SCAN_MAX_UPLOAD_BYTES): number {
  const n = Math.max(1, Math.floor(pageCount));
  return Math.max(0, Math.floor((totalBytes - PDF_BASE_OVERHEAD_BYTES) / n) - PDF_PAGE_OVERHEAD_BYTES);
}

/** Rough decoded byte count of a base64 data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Normalise any integer (including negatives, from a counter-clockwise tap) to 0-3. */
export function normaliseTurns(turns: number): 0 | 1 | 2 | 3 {
  return (((Math.round(turns) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

/** Output size after N quarter-turns — swapped on the odd ones. */
export function rotatedSize(
  width: number,
  height: number,
  turns: number,
): { width: number; height: number } {
  return normaliseTurns(turns) % 2 === 1 ? { width: height, height: width } : { width, height };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = src;
  });
}

/**
 * Rotate a data URL by quarter-turns clockwise.
 *
 * ALWAYS CALLED FROM THE ORIGINAL, never from the previous rotation's output.
 * Rotating a JPEG re-encodes it, so a user who taps rotate four times to get
 * back where they started would otherwise have paid four generations of
 * compression loss for a no-op. The modal keeps the pristine capture and a
 * turn counter, and calls this once with the total — so any orientation costs
 * exactly one re-encode, and 0 turns costs none at all.
 *
 * Quality is deliberately 0.95 here rather than the final save quality: this is
 * an intermediate, and the budget-fitting pass below is what actually decides
 * how the file is stored. Compressing twice at the target quality would apply
 * the loss twice.
 */
export async function rotateDataUrl(src: string, turns: number): Promise<string> {
  const t = normaliseTurns(turns);
  if (t === 0) return src;
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const out = rotatedSize(w, h, t);
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((t * Math.PI) / 2);
  ctx.drawImage(img, -w / 2, -h / 2);
  return canvas.toDataURL('image/jpeg', 0.95);
}

export interface FittedImage {
  data: string;
  bytes: number;
  /** The long edge actually used, so the caller can tell the user it downscaled. */
  longEdge: number;
  quality: number;
  /** True when even the bottom of both ladders did not fit under the cap. */
  overBudget: boolean;
}

/**
 * Encode an image as large and as cleanly as the byte budget allows.
 *
 * Walks quality down first and only then resolution (see QUALITY_LADDER), and
 * returns the FIRST combination that fits — so a sparse letter is stored at
 * 2200px/0.92 while a dense ID card lands wherever it has to, instead of both
 * being flattened to the old fixed 1600/0.82.
 *
 * Never throws and never refuses. If nothing fits it returns the smallest
 * attempt with overBudget:true and lets the caller decide what to say —
 * because the one behaviour that is definitely wrong is the old one, which
 * discarded the capture and asked the person to go and photograph the document
 * again with "less background in the frame".
 */
export async function fitToBudget(
  src: string,
  opts: { maxBytes?: number; maxLongEdge?: number } = {},
): Promise<FittedImage> {
  const maxBytes = opts.maxBytes ?? SCAN_MAX_UPLOAD_BYTES;
  const maxLongEdge = opts.maxLongEdge ?? SCAN_TARGET_LONG_EDGE;
  const img = await loadImage(src);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: src, bytes: dataUrlBytes(src), longEdge: Math.max(naturalW, naturalH), quality: 1, overBudget: false };

  // Never upscale: a 900px capture encoded at 2200 is 900px of detail in a
  // 2200px file, which costs bytes we then have to claw back by lowering
  // quality on the detail that IS there.
  const dims = DIMENSION_LADDER.filter((d) => d <= maxLongEdge);
  const ladder = dims.length ? dims : [maxLongEdge];

  let last: FittedImage | null = null;
  for (const longEdge of ladder) {
    const scale = Math.min(1, longEdge / Math.max(naturalW, naturalH));
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));
    canvas.width = w;
    canvas.height = h;
    // White, not transparent-black. A JPEG has no alpha, so any untouched
    // pixel encodes as black — and a stray black border on a scan of a white
    // page looks like a fault in the document itself.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    for (const quality of QUALITY_LADDER) {
      let data: string;
      try { data = canvas.toDataURL('image/jpeg', quality); }
      catch { return { data: src, bytes: dataUrlBytes(src), longEdge: Math.max(naturalW, naturalH), quality: 1, overBudget: false }; }
      const bytes = dataUrlBytes(data);
      last = { data, bytes, longEdge: Math.max(w, h), quality, overBudget: false };
      if (bytes <= maxBytes) return last;
    }
  }
  return last ? { ...last, overBudget: true } : { data: src, bytes: dataUrlBytes(src), longEdge: Math.max(naturalW, naturalH), quality: 1, overBudget: true };
}
