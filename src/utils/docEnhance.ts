/* ---------------------------------------------------------------------------
 * Enhancement for scanned documents — shadow removal, auto-levels, a mode
 * (color / grayscale / black-and-white), and a light sharpen — run AFTER
 * scanic's perspective warp and BEFORE the warped photo is written out as the
 * document the family keeps.
 *
 * WHY THIS EXISTS
 * ----------------
 * The scanner modal used to write the perspective-corrected canvas straight to
 * JPEG with no tone processing at all. A photographed page carries a slow
 * brightness gradient across it — window light on one side, the phone's own
 * shadow on the other — and that gradient is why the result looks grey and
 * washed out even when the photo itself was perfectly in focus. Adobe Scan and
 * Apple's own scanner both run exactly this class of correction; without it,
 * "whites are whiter, darks are darker" never happens no matter how good the
 * camera or the crop is.
 *
 * THIS IS A PRESENTATION LAYER, NOT AN ARCHIVAL ONE — READ THIS BEFORE TUNING
 * ANYTHING BELOW
 * -----------------------------------------------------------------------
 * These are irreplaceable legal documents: a birth certificate, a passport, a
 * will. The photo the camera captured is the only copy of it this app will
 * ever have. Every stage below is a lossy, one-way transform — clipping a
 * black point, thresholding a page to pure black-and-white, sharpening an
 * edge — and any of them can, at the wrong setting, blow out a faint pencil
 * annotation or a light consulate stamp that nobody can get back once the
 * enhanced JPEG is what got saved.
 *
 * That is why `mode: 'off'` exists and is checked before any stage runs — a
 * genuine, byte-identical no-op that lets a caller (or a future "compare to
 * original" toggle in the UI) skip enhancement entirely rather than trust it.
 * It is why every stage aims for "flatten the lighting, restore real
 * contrast" rather than "make it look punchy" — a caller that wants punch can
 * always process further, but nothing here can undo a clipped detail. And it
 * is why every magic constant below carries a comment on which direction its
 * error runs: for an archival document, the safe side of a tuning mistake is
 * "did too little," never "silently deleted a detail."
 *
 * PIPELINE (in order — see the exported enhancePixels)
 * ------------------------------------------------------
 *   1. Illumination correction — flattens the lighting gradient by dividing
 *      out a smoothed, per-region estimate of the paper's own background
 *      brightness. This is the stage that actually makes whites white; a
 *      global contrast stretch alone cannot do it, because it just clips
 *      whichever corner is already closest to white while the shadowed
 *      corner stays grey.
 *   2. Percentile auto-levels — a global black/white point stretch, once the
 *      lighting is flat, applied identically to R/G/B so it cannot shift hue.
 *   2b. Paper white — maps the paper's histogram peak to near-white with a
 *      linear gain below it (faint marks keep, and slightly widen, their gap
 *      to the paper) and a shoulder above it. Not in bw mode.
 *   3. Mode — color (with a modest saturation lift for stamps and
 *      signatures), grayscale, or bw (adaptive local thresholding).
 *   4. Unsharp mask — a small, thresholded sharpen for the crispness a flatbed
 *      scanner gets for free and a phone photo does not. Skipped in bw mode,
 *      where there is nothing left to sharpen.
 *
 * PERFORMANCE
 * -----------
 * Target is a ~2200x1700 phone photo (≈3.7M pixels, 15MB of RGBA) processed
 * on a mid-range phone without a visible freeze. Every stage below is a
 * single pass over the pixel buffer using typed arrays; the two stages that
 * would naively be O(n * window²) — the bw adaptive threshold and the unsharp
 * blur — are done with an integral (summed-area) image instead, which turns
 * an arbitrarily large box-filter window into an O(1) lookup per pixel. There
 * are no per-pixel closures or allocations in any hot loop.
 * ------------------------------------------------------------------------- */

export type EnhanceMode = 'color' | 'grayscale' | 'bw' | 'off';

export interface EnhanceOptions {
  /** Default 'color'. 'off' is a genuine no-op — see the file header. */
  mode?: EnhanceMode;
  /** Default true. Lift the paper to white after levels (stage 2b). Exists so
   *  the test can show the stage is what does the lifting. */
  paperWhite?: boolean;
}

// Fast integer approximation of ITU-R BT.601 luma (R*0.299 + G*0.587 +
// B*0.114), scaled so the three weights sum to exactly 256 and the whole
// computation is a multiply-add-shift with no floating point. Used every
// place this file needs "how bright is this pixel" — good enough for tone
// decisions; nothing here claims colorimetric accuracy.
const LUMA_R = 77;
const LUMA_G = 151;
const LUMA_B = 28;

// ---------------------------------------------------------------------------
// Stage 1 — illumination / flat-field correction (shadow removal)
// ---------------------------------------------------------------------------

// Each background-estimate grid cell covers roughly 1/16th of the image's
// width and height. Coarse enough that the estimate follows the SLOW lighting
// gradient (a window on one side of the room, the phone's own shadow on the
// other) rather than being dragged around by an individual glyph or a stamp,
// both of which vary over a few pixels, not a sixteenth of the page.
const ILLUM_GRID_DIVISOR = 16;

// Floor on grid cells per axis, even for a small image — the algorithm needs
// "a few cells across" to track a gradient at all; below this the estimate
// degenerates toward a single global value and stage 1 stops correcting
// anything but still runs harmlessly.
const ILLUM_GRID_MIN = 4;

// Ceiling on grid cells per axis. Bounds the per-cell 256-bin histogram
// buffer (grid cells × 256 × 4 bytes) and the smoothing pass cost for a very
// large capture; 48×48×256 is ~590K Uint32 entries, trivial either way, but
// this keeps the bound explicit rather than implicit in the input size.
const ILLUM_GRID_MAX = 48;

// The percentile within each grid cell taken as that cell's "paper white"
// estimate. High, but deliberately not the max and not the mean:
//   - The MEAN is dragged down by whatever fraction of the cell is ink, so a
//     text-heavy cell would read as darker paper than it actually is.
//   - The MAX latches onto a single specular glare pixel (a phone-flash
//     reflection off glossy paper) and would set an artificially bright
//     target that then crushes the real paper around it too dark.
//   - A high percentile (paper dominates almost every cell of a real
//     document) sits above the ink and below any one-pixel glare spike.
// If this drifts too low: shadows under-correct and some grey remains. Too
// high: a heavily inked cell (a stamp, a dense table) can read as darker than
// its real paper and over-brighten under division. Both directions are
// recoverable by stage 2's auto-levels; this only needs to be roughly right.
const ILLUM_PERCENTILE = 0.87;

// Box-blur radius (in GRID cells, not pixels) used to smooth the coarse
// background grid before upsampling. Without this, dividing by the raw
// per-cell estimate produces a visible step exactly at each cell boundary,
// where no real edge exists on the page.
const ILLUM_GRID_SMOOTH_RADIUS = 1;

// Hard floor on the per-pixel background divisor (0-255 luma). Without this,
// a locally very dark region — deep shadow, or a cell dominated by a dark
// photograph or stamp rather than paper — turns into a divide-by-near-zero
// that amplifies whatever noise is there into visible garbage instead of a
// corrected value. Set well below any real "paper, even in bad light"
// reading, so it only engages in the genuinely-dark case it exists to catch.
// Direction of error: too low lets a very dark region blow out; too high
// under-corrects legitimate deep shadow. Erring high is the safe side.
const ILLUM_MIN_BACKGROUND = 60;

// If the AVERAGE background estimate across the whole smoothed grid falls
// below this, the photo is almost certainly not a lit page at all — a photo
// of a dark object, a night shot, a camera error — and illumination
// correction is skipped outright rather than amplifying shadow noise across
// the entire frame. This is the "must degrade to roughly a no-op" guard.
// Direction of error: too high skips correction on some legitimately dim but
// real documents (safe — falls through to auto-levels unmodified); too low
// risks amplifying a genuinely dark photo into visible noise, which is the
// exact failure this guard exists to prevent.
const ILLUM_SKIP_MEAN_BACKGROUND = 45;

/* What the local background is normalized toward — and it is NOT 255.
 *
 * 255 is the tempting value, on the argument that this stage only flattens the
 * gradient and stage 2 decides the real white point. The problem is what a
 * straight divide-to-255 does on the way: the background estimate is the 87th
 * percentile of each cell, so roughly the top 13% of pixels in every cell sit
 * AT or ABOVE it and land clipped at pure white. Anything within about an
 * eighth of paper brightness is therefore destroyed here, before stage 2 ever
 * sees it.
 *
 * On the documents this app actually holds, that is not an abstract loss. The
 * birth certificate that prompted this work has a pale watermark eagle across
 * the middle of the page and a light-blue consular seal — both only slightly
 * darker than the paper, both gone at 255, and both irreplaceable, because the
 * enhanced JPEG is what gets stored.
 *
 * 245 leaves roughly 4% headroom: enough for near-paper detail to survive as
 * something rather than nothing, and stage 2's 99.5th-percentile white point
 * then lifts the page the rest of the way from the now-flat image, clipping
 * only the extreme sliver it is designed to clip. The gradient is still
 * flattened, which was the whole point of the stage; what changes is that the
 * flattening no longer erases the faintest ink on its way through.
 *
 * If the error is here at all it is on the safe side: too low leaves a page
 * looking very slightly less bright than it could, which is visible and
 * fixable. Too high silently deletes a stamp. */
const ILLUM_TARGET_WHITE = 245;

// ---------------------------------------------------------------------------
// Stage 2 — percentile auto-levels
// ---------------------------------------------------------------------------

// Black and white points, as histogram percentiles rather than the true
// min/max — a single stray black pixel (a torn corner, a hole punch) or a
// single blown highlight (a glare spot) would otherwise set the whole
// stretch from one outlier pixel. 0.5th / 99.5th percentile clips only the
// most extreme sliver of the page while still reaching genuinely near-black
// ink and near-white paper.
const LEVELS_BLACK_PERCENTILE = 0.005;
const LEVELS_WHITE_PERCENTILE = 0.995;

// Minimum (white - black) luma span before the stretch is applied. A blank or
// near-uniform page (or a synthetic all-one-color image) can otherwise
// collapse both points onto nearly the same value, which would either divide
// by (near) zero or blast a page with almost no real contrast into extreme,
// posterized black-and-white. Below this span the page is judged to have
// nothing meaningful left to stretch, and stage 2 is skipped — not "stretch
// anyway, more aggressively," because that is exactly the failure mode this
// guards against.
const LEVELS_MIN_SPAN = 20;

// ---------------------------------------------------------------------------
// Stage 2b — paper white (color and grayscale only)
// ---------------------------------------------------------------------------
//
// After stages 1 and 2 the paper sits at about 240, not white: auto-levels
// pins its white point to the 99.5th percentile, and on a real photo that
// percentile is the top of the paper's own sensor noise, so the paper's
// centre stays a visible grey. Apple's scanner (the benchmark the owner
// compares us to) shows white paper, so this stage finds the paper — the
// dominant bright peak of the luma histogram — and maps it to
// PAPER_WHITE_TARGET with one gain applied below it and a gentle shoulder
// above it.
//
// Why this does not repeat the ILLUM_TARGET_WHITE mistake: below the paper
// peak the curve is a plain linear gain, so it EXPANDS the gap between paper
// and anything slightly darker than paper (a watermark 14 levels below the
// paper ends up about 15 levels below it). Only values ABOVE the paper peak —
// the paper's own noise — are compressed, into the last few levels.
const PAPER_WHITE_TARGET = 252;
// A bright peak below this is not white paper (a coloured card, a dark ID
// photo); leave those alone rather than force them toward white.
const PAPER_MIN_LEVEL = 190;
// The peak window (±PAPER_PEAK_HALF_WIDTH levels) must hold at least this
// share of the page, or there is no dominant paper to find and the stage is
// skipped. Direction of error: too high skips pages that would have benefited
// (visible, harmless); too low lifts a photo-like page that has no paper.
const PAPER_PEAK_HALF_WIDTH = 6;
const PAPER_MIN_PEAK_SHARE = 0.15;
// Never brighten by more than this, whatever the histogram says.
const PAPER_MAX_GAIN = 1.15;

// ---------------------------------------------------------------------------
// Stage 3 — mode
// ---------------------------------------------------------------------------

// Saturation multiplier applied around each pixel's own luma in 'color' mode.
// Deliberately modest — stamps, signatures and letterhead colour are the
// reason color mode exists at all, but this is scan output for a legal
// document, not a social photo; a heavy boost reads as an obvious filter and,
// worse, can push a pale ink colour toward a different-looking one.
const SATURATION_BOOST = 1.18;

// Adaptive threshold ("bw" mode) local window radius, in pixels, derived from
// image width. After stage 1 the page is already flattened, so — per the
// design note — a modest window suffices; a WIDE window would start behaving
// like a single global threshold again, which is the exact failure this
// stage exists to avoid (a global threshold destroys the light half of any
// unevenly-lit page). A window too NARROW instead turns thick letterforms
// into hollow outlines, because the local mean tracks the stroke itself
// rather than the surrounding paper.
const BW_WINDOW_DIVISOR = 16; // radius ≈ width / 16, i.e. a ≈ width/8 window
const BW_RADIUS_MIN = 8; // floor: at least a ~16px window even on a small image
const BW_RADIUS_MAX = 40; // ceiling: bounds worst-case window size on a huge image

// Bradley/Wellner threshold offset, as a percent below the local mean. A
// pixel darker than mean * (1 - t/100) is classified as ink. Lower t treats
// more of the page as background (risks losing faint ink); higher t treats
// more as ink (risks thickening strokes and dragging in paper texture).
const BW_THRESHOLD_PERCENT = 15;

// ---------------------------------------------------------------------------
// Stage 4 — unsharp mask
// ---------------------------------------------------------------------------

// Blur radius (pixels) for the "unsharp" half of the unsharp mask. Small on
// purpose — this is meant to crisp glyph edges, not restructure the image;
// a larger radius starts to look like a different, heavier-handed filter and
// costs more per pixel for no benefit at this document scale.
const UNSHARP_RADIUS = 2;

// How much of the (luma - blurred-luma) difference is added back at each
// qualifying pixel. Moderate: haloed, over-crisp text is a worse outcome than
// slightly soft text, and a heavy-handed unsharp is also the stage most
// likely to make an OCR pass on the resulting image WORSE, not better, by
// turning fine serifs into ringing artifacts.
const UNSHARP_AMOUNT = 0.6;

// Below this luma difference (0-255 scale), a pixel is treated as paper
// grain or JPEG block noise rather than a real glyph edge, and is left alone.
// Without this floor, unsharp amplifies exactly the noise stage 1 and 2 were
// trying to clean up, turning flat paper into visible speckle.
const UNSHARP_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Grid dimension for stage 1: 1/ILLUM_GRID_DIVISOR of the axis, bounded to
// [ILLUM_GRID_MIN, ILLUM_GRID_MAX], and never more cells than there are
// pixels on that axis — which matters for the tiny (3x3, 1x1) inputs this
// module is required not to crash on.
function gridDimension(sizePx: number): number {
  const raw = Math.round(sizePx / ILLUM_GRID_DIVISOR);
  const bounded = clamp(raw, ILLUM_GRID_MIN, ILLUM_GRID_MAX);
  return Math.max(1, Math.min(sizePx, bounded));
}

// Separable box blur over the small background grid (at most 48×48 cells),
// with clamped (repeated-edge) borders. Two passes, O(cells * radius) each —
// trivially cheap at this size regardless of the source image's resolution.
function boxBlurGrid(grid: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  if (radius <= 0) return grid;
  const tmp = new Float32Array(grid.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      let count = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = clamp(x + dx, 0, cols - 1);
        sum += grid[y * cols + xx];
        count++;
      }
      tmp[y * cols + x] = sum / count;
    }
  }
  const out = new Float32Array(grid.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = clamp(y + dy, 0, rows - 1);
        sum += tmp[yy * cols + x];
        count++;
      }
      out[y * cols + x] = sum / count;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage implementations — each is a single pass (plus, where noted, one
// O(width*height) prep pass) over the RGBA buffer. All mutate `data` in
// place; alpha is never touched by any stage.
// ---------------------------------------------------------------------------

function correctIllumination(data: Uint8ClampedArray, width: number, height: number): void {
  const gridCols = gridDimension(width);
  const gridRows = gridDimension(height);

  // Per-cell 256-bin luma histogram, built in ONE pass over the image. A
  // histogram (rather than collecting and sorting each cell's pixels) is
  // what keeps this O(width*height) total: reading a percentile back out is
  // a short sweep over 256 bins per cell, however many pixels landed in it.
  const hist = new Uint32Array(gridRows * gridCols * 256);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(gridRows - 1, Math.floor((y * gridRows) / height));
    const rowBase = y * width * 4;
    const cellRowBase = cy * gridCols;
    for (let x = 0; x < width; x++) {
      const cx = Math.min(gridCols - 1, Math.floor((x * gridCols) / width));
      const i = rowBase + x * 4;
      const luma = (data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B) >> 8;
      hist[(cellRowBase + cx) * 256 + luma]++;
    }
  }

  // Per-cell high-percentile "paper white" estimate, read directly off the
  // histogram — no sort required.
  const cellCount = gridRows * gridCols;
  const grid = new Float32Array(cellCount);
  for (let c = 0; c < cellCount; c++) {
    const base = c * 256;
    let total = 0;
    for (let b = 0; b < 256; b++) total += hist[base + b];
    if (total === 0) { grid[c] = 255; continue; } // unreachable in practice — every cell owns ≥1 pixel — kept as a guard
    const target = Math.ceil(total * ILLUM_PERCENTILE);
    let cum = 0;
    let bin = 255;
    for (let b = 0; b < 256; b++) {
      cum += hist[base + b];
      if (cum >= target) { bin = b; break; }
    }
    grid[c] = bin;
  }

  const smoothed = boxBlurGrid(grid, gridCols, gridRows, ILLUM_GRID_SMOOTH_RADIUS);

  // Degenerate-document guard — see ILLUM_SKIP_MEAN_BACKGROUND above.
  let meanBg = 0;
  for (let c = 0; c < cellCount; c++) meanBg += smoothed[c];
  meanBg /= cellCount;
  if (meanBg < ILLUM_SKIP_MEAN_BACKGROUND) return;

  // Bilinearly upsample the grid back to full resolution and divide each
  // pixel by its local background estimate, scaled to the target white. All
  // three channels are divided by the SAME (luma-derived) scale factor at a
  // given pixel, which is what keeps this stage from introducing a colour
  // cast of its own — see the auto-levels comment below for why that matters
  // on a legal document.
  for (let y = 0; y < height; y++) {
    const gy = ((y + 0.5) * gridRows) / height - 0.5;
    const gy0 = clamp(Math.floor(gy), 0, gridRows - 1);
    const gy1 = Math.min(gridRows - 1, gy0 + 1);
    const fy = clamp(gy - gy0, 0, 1);
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      const gx = ((x + 0.5) * gridCols) / width - 0.5;
      const gx0 = clamp(Math.floor(gx), 0, gridCols - 1);
      const gx1 = Math.min(gridCols - 1, gx0 + 1);
      const fx = clamp(gx - gx0, 0, 1);

      const v00 = smoothed[gy0 * gridCols + gx0];
      const v10 = smoothed[gy0 * gridCols + gx1];
      const v01 = smoothed[gy1 * gridCols + gx0];
      const v11 = smoothed[gy1 * gridCols + gx1];
      const top = v00 + (v10 - v00) * fx;
      const bottom = v01 + (v11 - v01) * fx;
      const bg = top + (bottom - top) * fy;

      const divisor = Math.max(bg, ILLUM_MIN_BACKGROUND);
      const scale = ILLUM_TARGET_WHITE / divisor;

      const i = rowBase + x * 4;
      // Direct assignment into a Uint8ClampedArray rounds and clamps to
      // [0, 255] automatically (and folds NaN to 0), which is the "Clamp."
      // step the algorithm spec calls for at every stage.
      data[i] = data[i] * scale;
      data[i + 1] = data[i + 1] * scale;
      data[i + 2] = data[i + 2] * scale;
    }
  }
}

function autoLevels(data: Uint8ClampedArray, width: number, height: number): void {
  const total = width * height;
  const hist = new Uint32Array(256);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const luma = (data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B) >> 8;
    hist[luma]++;
  }

  const blackTarget = Math.ceil(total * LEVELS_BLACK_PERCENTILE);
  const whiteTailTarget = Math.ceil(total * (1 - LEVELS_WHITE_PERCENTILE));

  let cum = 0;
  let black = 0;
  for (let b = 0; b < 256; b++) {
    cum += hist[b];
    if (cum >= blackTarget) { black = b; break; }
  }

  let cumHigh = 0;
  let white = 255;
  for (let b = 255; b >= 0; b--) {
    cumHigh += hist[b];
    if (cumHigh >= whiteTailTarget) { white = b; break; }
  }

  // Guard: see LEVELS_MIN_SPAN above — a near-blank or already-flat page is
  // left untouched by this stage rather than stretched into an extreme.
  if (white - black < LEVELS_MIN_SPAN) return;

  const scale = 255 / (white - black);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    // Identical black/white/scale applied to R, G AND B — a per-channel
    // stretch is what turns an off-white certificate a visible blue or green,
    // and on a legal document a colour cast reads as tampering, not as a
    // photo-quality issue.
    data[i] = (data[i] - black) * scale;
    data[i + 1] = (data[i + 1] - black) * scale;
    data[i + 2] = (data[i + 2] - black) * scale;
  }
}

function liftPaperWhite(data: Uint8ClampedArray, width: number, height: number): void {
  const total = width * height;
  const hist = new Uint32Array(256);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    hist[(data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B) >> 8]++;
  }
  // Dominant bright peak, found on a window sum so a noisy paper histogram
  // (no single tall bin) still has one clear maximum.
  let peak = -1;
  let peakMass = 0;
  for (let b = PAPER_MIN_LEVEL; b <= 254; b++) {
    let mass = 0;
    for (let k = Math.max(0, b - PAPER_PEAK_HALF_WIDTH); k <= Math.min(255, b + PAPER_PEAK_HALF_WIDTH); k++) mass += hist[k];
    if (mass > peakMass) { peakMass = mass; peak = b; }
  }
  if (peak < 0 || peakMass < total * PAPER_MIN_PEAK_SHARE) return;
  if (peak >= PAPER_WHITE_TARGET) return;
  const gain = Math.min(PAPER_MAX_GAIN, PAPER_WHITE_TARGET / peak);
  const lifted = peak * gain;
  // Per-luma multiplier: linear gain up to the paper, then a straight
  // shoulder from the lifted paper level to 255 — monotonic, so nothing
  // swaps places, and one multiplier for all three channels, so no hue shift.
  const mult = new Float32Array(256);
  for (let l = 0; l < 256; l++) {
    const out = l <= peak ? l * gain : lifted + ((l - peak) * (255 - lifted)) / (255 - peak);
    mult[l] = l === 0 ? gain : out / l;
  }
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const m = mult[(data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B) >> 8];
    data[i] = data[i] * m;
    data[i + 1] = data[i + 1] * m;
    data[i + 2] = data[i + 2] * m;
  }
}

// Integral (summed-area) image of luma, sized (width+1)*(height+1) with a
// zeroed leading row/column so every window lookup below needs no edge
// special-casing. Shared by both the bw threshold and the unsharp blur —
// it is what keeps an arbitrarily large box-filter window an O(1) lookup per
// pixel instead of O(window²).
function buildLumaIntegral(luma: Float32Array | Uint8ClampedArray, width: number, height: number): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const intRow = (y + 1) * (width + 1);
    const intRowPrev = y * (width + 1);
    const srcRow = y * width;
    for (let x = 0; x < width; x++) {
      rowSum += luma[srcRow + x];
      integral[intRow + x + 1] = integral[intRowPrev + x + 1] + rowSum;
    }
  }
  return integral;
}

function windowSum(integral: Float64Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  const stride = width + 1;
  return (
    integral[(y1 + 1) * stride + (x1 + 1)] -
    integral[y0 * stride + (x1 + 1)] -
    integral[(y1 + 1) * stride + x0] +
    integral[y0 * stride + x0]
  );
}

function adaptiveThreshold(data: Uint8ClampedArray, width: number, height: number): void {
  const total = width * height;
  const luma = new Uint8ClampedArray(total);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    luma[p] = (data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B) >> 8;
  }
  const integral = buildLumaIntegral(luma, width, height);

  const radius = clamp(Math.round(width / BW_WINDOW_DIVISOR), BW_RADIUS_MIN, BW_RADIUS_MAX);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = windowSum(integral, width, x0, y0, x1, y1) / count;

      const p = y * width + x;
      const i = rowBase + x * 4;
      // Bradley/Wellner rule: darker than (1 - t/100) of the local mean is
      // ink. Comparing via *100 keeps this in integer-ish territory without
      // an extra division per pixel.
      const isInk = luma[p] * 100 < mean * (100 - BW_THRESHOLD_PERCENT);
      const v = isInk ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }
}

function applyMode(data: Uint8ClampedArray, width: number, height: number, mode: EnhanceMode): void {
  if (mode === 'bw') {
    adaptiveThreshold(data, width, height);
    return;
  }

  const total = width * height;

  if (mode === 'grayscale') {
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      const luma = (data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B) >> 8;
      data[i] = luma;
      data[i + 1] = luma;
      data[i + 2] = luma;
    }
    return;
  }

  // 'color': a modest saturation lift around each pixel's own luma.
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = (r * LUMA_R + g * LUMA_G + b * LUMA_B) >> 8;
    data[i] = luma + (r - luma) * SATURATION_BOOST;
    data[i + 1] = luma + (g - luma) * SATURATION_BOOST;
    data[i + 2] = luma + (b - luma) * SATURATION_BOOST;
  }
}

function unsharpMask(data: Uint8ClampedArray, width: number, height: number): void {
  const total = width * height;
  const luma = new Float32Array(total);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    luma[p] = (data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B) >> 8;
  }
  const integral = buildLumaIntegral(luma, width, height);

  const radius = UNSHARP_RADIUS;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const blurred = windowSum(integral, width, x0, y0, x1, y1) / count;

      const p = y * width + x;
      const diff = luma[p] - blurred;
      // Noise/grain floor — see UNSHARP_THRESHOLD above.
      if (diff > -UNSHARP_THRESHOLD && diff < UNSHARP_THRESHOLD) continue;

      const i = rowBase + x * 4;
      const add = diff * UNSHARP_AMOUNT;
      data[i] = data[i] + add;
      data[i + 1] = data[i + 1] + add;
      data[i + 2] = data[i + 2] + add;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The whole enhancement pipeline as pure data — no DOM, no canvas. Mutates
 * `data` in place (an RGBA buffer, length width*height*4) and returns it, so
 * it can be exercised directly in a Node test rather than through a mocked
 * canvas.
 *
 * `mode: 'off'` (or a degenerate width/height/buffer) returns `data`
 * completely untouched — see the file header for why that guarantee exists
 * and must never be weakened.
 */
export function enhancePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EnhanceOptions = {},
): Uint8ClampedArray {
  const mode = opts.mode ?? 'color';

  if (mode === 'off') return data;

  // Degenerate input guard: every stage below assumes at least a 1x1 image
  // with a full RGBA buffer behind it. Bail to a no-op rather than divide by
  // zero building the illumination grid or indexing past the buffer.
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) return data;
  if (data.length < width * height * 4) return data;

  correctIllumination(data, width, height);
  autoLevels(data, width, height);
  // bw thresholds against the local mean, so a global lift changes nothing
  // there; it is skipped rather than run for no effect.
  if (mode !== 'bw' && opts.paperWhite !== false) liftPaperWhite(data, width, height);
  applyMode(data, width, height, mode);
  // bw output is pure 0/255 — nothing left to sharpen, and sharpening it
  // would just re-introduce grey edge pixels the threshold just removed.
  if (mode !== 'bw') unsharpMask(data, width, height);

  return data;
}

/**
 * Enhance an already-perspective-corrected document image, on a new canvas.
 * Never mutates the source canvas or the ImageData the caller passed in.
 */
export function enhanceCanvas(src: HTMLCanvasElement | ImageData, opts: EnhanceOptions = {}): HTMLCanvasElement {
  let width: number;
  let height: number;
  let sourceData: Uint8ClampedArray;

  if (src instanceof HTMLCanvasElement) {
    width = src.width;
    height = src.height;
    const ctx = src.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) throw new Error('enhanceCanvas: source canvas has no 2D context');
    sourceData = ctx.getImageData(0, 0, width, height).data;
  } else {
    width = src.width;
    height = src.height;
    sourceData = src.data;
  }

  // Copy before mutating — enhancePixels mutates in place, and the caller may
  // still hold a reference to the ImageData/canvas we read it from and expect
  // it to be untouched (this is also what makes mode:'off' a genuine no-op
  // from the caller's point of view, not just internally).
  const data = new Uint8ClampedArray(sourceData);
  enhancePixels(data, width, height, opts);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('enhanceCanvas: could not create an output 2D context');
  outCtx.putImageData(new ImageData(data, width, height), 0, 0);
  return out;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('enhanceDataUrl: failed to load the source image'));
    img.src = src;
  });
}

/** Convenience for the modal: data URL in, enhanced data URL out. */
export async function enhanceDataUrl(
  dataUrl: string,
  opts: EnhanceOptions & { quality?: number } = {},
): Promise<string> {
  const { quality = 0.9, ...enhanceOpts } = opts;
  const img = await loadImageElement(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('enhanceDataUrl: could not create a 2D context');
  ctx.drawImage(img, 0, 0, width, height);
  const enhanced = enhanceCanvas(canvas, enhanceOpts);
  return enhanced.toDataURL('image/jpeg', quality);
}
