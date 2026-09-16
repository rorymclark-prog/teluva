/* ---------------------------------------------------------------------------
 * Page geometry for the camera scanner — pure functions over pixel buffers,
 * no DOM, so every one of them runs under a plain Node test.
 *
 * Why this exists (measured, not guessed — see the scanner bench in the
 * v-next handoff): scanic finds the page on an 800px copy of the frame and
 * reads the corners off a coarse polygon approximation, so on a clean,
 * well-lit synthetic page its corners were still 10-15px out on average and
 * up to 30px out at the worst corner. A 30px corner error on a 2000px page is
 * a 1.5% shear — visible as a margin that runs downhill — and it is the same
 * "close but not quite" failure that made scans look distorted. Its warp then
 * sized the output from raw side lengths, which under a tilted phone is the
 * FORESHORTENED shape, not the page's: an A4 page came out up to ~5% too
 * wide.
 *
 * Three jobs live here:
 *   1. refineQuad()        — snap each edge to the real paper edge at full
 *                            resolution, and MEASURE how much real edge there
 *                            is under each side (the verification signal).
 *   2. pageAspect()        — recover the page's true width:height from the
 *                            perspective of its four corners.
 *   3. warpQuad()          — a supersampled perspective warp straight to the
 *                            output size, so a 12 MP still is filtered down
 *                            properly rather than point-sampled.
 * Plus the small helpers the live viewfinder needs (stability, mapping the
 * quad onto an object-contain video).
 * ------------------------------------------------------------------------- */

export interface Pt { x: number; y: number }
/** Same shape as scanic's CornerPoints, so the two are interchangeable. */
export interface Quad { topLeft: Pt; topRight: Pt; bottomRight: Pt; bottomLeft: Pt }

export const QUAD_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

export function scaleQuad(q: Quad, sx: number, sy: number = sx): Quad {
  return {
    topLeft: { x: q.topLeft.x * sx, y: q.topLeft.y * sy },
    topRight: { x: q.topRight.x * sx, y: q.topRight.y * sy },
    bottomRight: { x: q.bottomRight.x * sx, y: q.bottomRight.y * sy },
    bottomLeft: { x: q.bottomLeft.x * sx, y: q.bottomLeft.y * sy },
  };
}

/** Largest distance any one corner moved between two quads. */
export function maxCornerShift(a: Quad, b: Quad): number {
  let m = 0;
  for (const k of QUAD_KEYS) m = Math.max(m, Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y));
  return m;
}

export function quadArea(q: Quad): number {
  const p = QUAD_KEYS.map((k) => q[k]);
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function isConvexQuad(q: Quad): boolean {
  const p = QUAD_KEYS.map((k) => q[k]);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const c = p[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!Number.isFinite(cross) || Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function sideLengths(q: Quad) {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  return {
    top: d(q.topLeft, q.topRight),
    right: d(q.topRight, q.bottomRight),
    bottom: d(q.bottomRight, q.bottomLeft),
    left: d(q.bottomLeft, q.topLeft),
  };
}

// ---------------------------------------------------------------------------
// 1. Live-viewfinder helpers
// ---------------------------------------------------------------------------

/**
 * Has the page held still? True when the last `count` quads are all present
 * and no corner moved more than `tolPx` between consecutive ones. This is what
 * auto-capture waits for now — "the page is found and not moving" — instead of
 * "the picture stopped changing", which fired just as happily on a blank desk.
 */
export function isQuadRunStable(history: (Quad | null)[], count: number, tolPx: number): boolean {
  if (count < 1 || history.length < count) return false;
  const run = history.slice(-count);
  if (run.some((q) => !q)) return false;
  for (let i = 1; i < run.length; i++) {
    if (maxCornerShift(run[i - 1] as Quad, run[i] as Quad) > tolPx) return false;
  }
  return true;
}

/**
 * Does any corner sit on (or past) the edge of the frame?
 *
 * A page that runs out of shot still produces a perfectly rectangular-looking
 * quad — its missing side is simply the frame border — and scanic scores that
 * quad as confidently as a real one (0.92 on the bench). Cropping to it
 * silently throws away the bottom of the page, which is the worst possible
 * outcome for a document someone will later need in full. So a quad that
 * touches the frame is never auto-accepted: the live view asks the person to
 * move back, and a still capture opens the corner editor instead.
 */
export function touchesFrame(q: Quad, w: number, h: number, marginFrac = 0.006): boolean {
  const m = marginFrac * Math.max(w, h);
  return QUAD_KEYS.some((k) => q[k].x <= m || q[k].y <= m || q[k].x >= w - 1 - m || q[k].y >= h - 1 - m);
}

/**
 * Is this picture shaped like an uncropped camera frame (4:3, 16:9, 3:2 in
 * either orientation)? Only then can we assume the lens centre is the picture
 * centre, which the perspective aspect recovery below relies on. A cropped or
 * edited upload falls back to side lengths.
 */
export function looksLikeCameraFrame(w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false;
  const r = Math.max(w, h) / Math.min(w, h);
  return [4 / 3, 16 / 9, 3 / 2].some((t) => Math.abs(r / t - 1) < 0.012);
}

// ---------------------------------------------------------------------------
// 2. True page aspect from perspective
// ---------------------------------------------------------------------------

/**
 * The page's real width:height, recovered from how its corners converge.
 *
 * A rectangle photographed at an angle projects to a quad whose side lengths
 * are foreshortened — the far edge is shorter than the near one — so "the
 * longer of each pair of opposite sides", which is what scanic sizes its output
 * from, is not the page's shape. Under a 15-degree tilt that alone is several
 * percent, and it is the kind of error people describe as "stretched".
 *
 * The method is Zhang & He's (whiteboard scanning, 2004): with the camera's
 * principal point at the frame centre and square pixels — true of every phone
 * camera frame we are handed — the four corners determine the focal length,
 * and with it the rectangle's aspect. When the quad is nearly a parallelogram
 * (camera square-on) the focal length is unobservable; that is exactly when
 * the side lengths are already right, so we use them.
 *
 * `centredCamera: false` (an uploaded picture, which may be a crop of
 * anything) skips the perspective model entirely, because its principal point
 * is not known to be the centre.
 */
export function pageAspect(
  q: Quad,
  frameW: number,
  frameH: number,
  opts: { centredCamera?: boolean } = {},
): { aspect: number; method: 'perspective' | 'sides'; focalPx?: number } {
  const s = sideLengths(q);
  const sidesAspect = Math.max(s.top, s.bottom) / Math.max(1e-6, Math.max(s.left, s.right));
  if (opts.centredCamera === false) return { aspect: sidesAspect, method: 'sides' };

  const cx = frameW / 2;
  const cy = frameH / 2;
  // m1 TL, m2 TR, m3 BL, m4 BR, relative to the principal point.
  const m1 = [q.topLeft.x - cx, q.topLeft.y - cy, 1];
  const m2 = [q.topRight.x - cx, q.topRight.y - cy, 1];
  const m3 = [q.bottomLeft.x - cx, q.bottomLeft.y - cy, 1];
  const m4 = [q.bottomRight.x - cx, q.bottomRight.y - cy, 1];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c14 = cross(m1, m4);
  const den2 = dot(cross(m2, m4), m3);
  const den3 = dot(cross(m3, m4), m2);
  if (Math.abs(den2) < 1e-9 || Math.abs(den3) < 1e-9) return { aspect: sidesAspect, method: 'sides' };
  const k2 = dot(c14, m3) / den2;
  const k3 = dot(c14, m2) / den3;
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];

  const longEdge = Math.max(frameW, frameH);
  const nn = n2[2] * n3[2];
  // Relative size of the perspective terms: below this the quad is an affine
  // parallelogram to within noise and the focal length cannot be measured.
  const persp = Math.max(Math.abs(n2[2]), Math.abs(n3[2])) * longEdge
    / Math.max(1e-9, Math.hypot(n2[0], n2[1]), Math.hypot(n3[0], n3[1]));
  if (Math.abs(nn) < 1e-12 || persp < 0.02) return { aspect: sidesAspect, method: 'sides' };

  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / nn;
  const f = f2 > 0 ? Math.sqrt(f2) : NaN;
  // Phone cameras sit around 0.6-1.2x the long edge (ultra-wide to 2x); a
  // focal length far outside that means the corners are noisy enough to have
  // produced nonsense, and the side lengths are the safer answer.
  if (!Number.isFinite(f) || f < 0.35 * longEdge || f > 3 * longEdge) return { aspect: sidesAspect, method: 'sides' };

  const a2 = (n2[0] * n2[0] + n2[1] * n2[1] + f2 * n2[2] * n2[2]) / (n3[0] * n3[0] + n3[1] * n3[1] + f2 * n3[2] * n3[2]);
  const aspect = Math.sqrt(a2);
  // Guard: the correction is 5-12% for a page held at a normal slant and
  // reaches ~28% for a page filling the frame at a 28-degree tilt (the bench's
  // hardest still). Past 40% something about the input broke the model's
  // assumptions — trust the sides instead.
  if (!Number.isFinite(aspect) || aspect <= 0 || Math.abs(aspect / sidesAspect - 1) > 0.4) {
    return { aspect: sidesAspect, method: 'sides' };
  }
  return { aspect, method: 'perspective', focalPx: f };
}

/**
 * Output size for a page: the true aspect (above), at the page's own native
 * pixel density, capped to `maxLongEdge`. Never upscales past native — a
 * 900px page stored at 2200px is 900px of detail in a bigger file.
 */
export function outputSize(
  q: Quad,
  frameW: number,
  frameH: number,
  maxLongEdge: number,
  opts: { centredCamera?: boolean } = {},
): { width: number; height: number; nativeLongEdge: number; aspect: number; aspectMethod: 'perspective' | 'sides' } {
  const s = sideLengths(q);
  const { aspect, method } = pageAspect(q, frameW, frameH, opts);
  const nativeW = Math.max(s.top, s.bottom);
  const nativeH = Math.max(s.left, s.right);
  // Scale so neither dimension exceeds what was actually photographed.
  const base = Math.max(nativeW, nativeH * aspect);
  let w = base;
  let h = base / aspect;
  const nativeLongEdge = Math.max(w, h);
  const k = Math.min(1, maxLongEdge / nativeLongEdge);
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  return { width: w, height: h, nativeLongEdge: Math.round(nativeLongEdge), aspect, aspectMethod: method };
}

// ---------------------------------------------------------------------------
// 3. Warp
// ---------------------------------------------------------------------------

/** Unit square (s,t) → quad. Heckbert's closed form. Returns [a,b,c,d,e,f,g,h]. */
export function unitSquareToQuad(q: Quad): number[] {
  const x0 = q.topLeft.x, y0 = q.topLeft.y;
  const x1 = q.topRight.x, y1 = q.topRight.y;
  const x2 = q.bottomRight.x, y2 = q.bottomRight.y;
  const x3 = q.bottomLeft.x, y3 = q.bottomLeft.y;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0];
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / det;
  const h = (dx1 * sy - sx * dy1) / det;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

export function mapUnit(m: number[], s: number, t: number): Pt {
  const w = m[6] * s + m[7] * t + 1;
  return { x: (m[0] * s + m[1] * t + m[2]) / w, y: (m[3] * s + m[4] * t + m[5]) / w };
}

/**
 * Perspective-warp the quad in `src` (RGBA, sw×sh) to an ow×oh RGBA buffer.
 *
 * Each output pixel averages an n×n grid of bilinear samples across its own
 * footprint, with n chosen from how much the page is being shrunk. scanic's
 * warp takes ONE bilinear sample per output pixel at the page's native size,
 * which is fine at 1:1 — but then a 12 MP still has to be warped at ~3400px
 * and shrunk afterwards, and going straight to 2200px with a single sample
 * per pixel would alias fine print into jagged strokes. Supersampling gets
 * the same result as warp-big-then-filter-down without ever holding the
 * 3400px page in memory.
 */
export function warpQuad(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  q: Quad,
  ow: number,
  oh: number,
  samples?: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ow * oh * 4);
  const m = unitSquareToQuad(q);
  let n = samples ?? 1;
  if (samples == null) {
    const s = sideLengths(q);
    const ratio = Math.max(Math.max(s.top, s.bottom) / ow, Math.max(s.left, s.right) / oh);
    n = ratio <= 1.15 ? 1 : ratio <= 2.2 ? 2 : 3;
  }
  const inv = 1 / (n * n);
  const maxX = sw - 1;
  const maxY = sh - 1;
  const [ma, mb, mc, md, me, mf, mg, mh] = m;
  for (let j = 0; j < oh; j++) {
    for (let i = 0; i < ow; i++) {
      let r = 0, g = 0, b = 0;
      for (let sj = 0; sj < n; sj++) {
        const t = (j + (sj + 0.5) / n) / oh;
        for (let si = 0; si < n; si++) {
          const s = (i + (si + 0.5) / n) / ow;
          const wden = mg * s + mh * t + 1;
          // Corners sit ON the page boundary, pixel centres at +0.5 — shift
          // so the mapping lands in pixel-centre coordinates for sampling.
          let x = (ma * s + mb * t + mc) / wden - 0.5;
          let y = (md * s + me * t + mf) / wden - 0.5;
          x = x < 0 ? 0 : x > maxX ? maxX : x;
          y = y < 0 ? 0 : y > maxY ? maxY : y;
          const x0 = x | 0;
          const y0 = y | 0;
          const x1 = x0 < maxX ? x0 + 1 : x0;
          const y1 = y0 < maxY ? y0 + 1 : y0;
          const fx = x - x0;
          const fy = y - y0;
          const w00 = (1 - fx) * (1 - fy);
          const w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy;
          const w11 = fx * fy;
          const i00 = (y0 * sw + x0) << 2;
          const i10 = (y0 * sw + x1) << 2;
          const i01 = (y1 * sw + x0) << 2;
          const i11 = (y1 * sw + x1) << 2;
          r += src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
          g += src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
          b += src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
        }
      }
      const o = (j * ow + i) << 2;
      out[o] = r * inv + 0.5;
      out[o + 1] = g * inv + 0.5;
      out[o + 2] = b * inv + 0.5;
      out[o + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Edge refinement and verification
// ---------------------------------------------------------------------------

export interface RefineResult {
  corners: Quad;
  /** Per edge (top, right, bottom, left): share of samples that found a real
   *  paper edge lying on the fitted line. 0-1. */
  support: [number, number, number, number];
  /** The weakest edge's support — the number the capture gate looks at. */
  minSupport: number;
  /** Whether each edge was moved onto the measured edge (false = kept as given). */
  refined: [boolean, boolean, boolean, boolean];
}

// Samples per edge. Enough that a line fit through them is robust to a
// handful of text-stroke or glare outliers; cheap either way (it is a few
// thousand luma reads for the whole page, not a pass over the image).
const REFINE_SAMPLES = 48;
// Keep away from the corners, where the neighbouring edge's gradient bleeds in.
const REFINE_END_MARGIN = 0.08;
// Minimum luma step (0-255, central difference across ~2px) to count as an
// edge at all. A white page on a pale desk is a ~15-25 level step once lit
// unevenly; sensor noise after the tangential averaging below is ~3.
const REFINE_MIN_GRADIENT = 5;
// An edge is only moved when at least this share of its samples agree on a
// line — otherwise the detector's own line is kept.
const REFINE_MIN_SUPPORT_TO_MOVE = 0.45;
// Where the "does this step persist?" check looks, in frame units (long edge /
// 1000) either side of a candidate edge: past any printed stroke (a 12 MP A4
// page has 3-8px strokes; these are 16-32px there, 8-15px at 1080p). And how
// much of the step must still be there: a fifth, so an edge with a narrow
// cast shadow just outside it (a big step to the shadow, a smaller one to the
// desk beyond) still counts.
const REFINE_PERSIST_OFFSETS = [4, 6, 8];
const REFINE_PERSIST_SHARE = 0.2;
// Widest band (frame units either side of the fitted line) a hit may sit in
// and still count as "on the edge". The robust fit's tolerance otherwise
// scales with the median residual, so hits SCATTERED across the search window
// — a side laid across a signature and a stamp — widened the band until they
// all counted, and read as 58% support. A real paper edge puts its hits within
// a unit or two of the line; 3 still holds a page edge bowed by 1% of its length.
const REFINE_MAX_INLIER_TOL = 3;

function lumaAt(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): number {
  const maxX = sw - 1;
  const maxY = sh - 1;
  if (x < 0) x = 0; else if (x > maxX) x = maxX;
  if (y < 0) y = 0; else if (y > maxY) y = maxY;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 < maxX ? x0 + 1 : x0;
  const y1 = y0 < maxY ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const l = (i: number) => src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114;
  const a = l((y0 * sw + x0) << 2);
  const b = l((y0 * sw + x1) << 2);
  const c = l((y1 * sw + x0) << 2);
  const d = l((y1 * sw + x1) << 2);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

interface Line { px: number; py: number; dx: number; dy: number } // point + unit direction

function fitLine(points: Pt[]): Line | null {
  if (points.length < 2) return null;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= points.length; my /= points.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  // Principal direction of the 2x2 scatter matrix (total least squares).
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
}

function distToLine(l: Line, p: Pt): number {
  return Math.abs((p.x - l.px) * l.dy - (p.y - l.py) * l.dx);
}

function intersect(a: Line, b: Line): Pt | null {
  const den = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/**
 * Snap a detected quad onto the real paper edges, and report how much real
 * edge each side has under it.
 *
 * For each side, ~48 points along it search outward/inward along the normal
 * (±~1.2% of the frame diagonal) for the paper edge: the OUTERMOST strong
 * step with the side's dominant polarity. Outermost matters — a table border
 * or a line of text running parallel to the edge is also a strong step of the
 * same polarity, but it is always INSIDE the page. The hits are fitted with a
 * robust line; adjacent lines intersect to the new corners.
 *
 * The support numbers are the other half of the job. A side that sits where
 * there is no paper edge — across the middle of the page, along the frame
 * border of a page that runs out of shot — finds scattered or no hits, and its
 * support collapses. That is the "close but wrong" quad the capture gate has
 * to refuse, and until now nothing measured it: scanic scores the SHAPE of a
 * candidate, not whether its sides are on an edge.
 */
export function refineQuad(src: Uint8ClampedArray, sw: number, sh: number, q: Quad): RefineResult {
  const diag = Math.hypot(sw, sh);
  const unit = Math.max(1, Math.max(sw, sh) / 1000);
  const R = Math.max(6, Math.round(0.012 * diag));
  const step = Math.max(0.75, unit * 0.6);
  const delta = Math.max(1, unit);
  const tapSpread = 1.5 * unit;

  const cxq = (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4;
  const cyq = (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4;
  const edges: [Pt, Pt][] = [
    [q.topLeft, q.topRight],
    [q.topRight, q.bottomRight],
    [q.bottomRight, q.bottomLeft],
    [q.bottomLeft, q.topLeft],
  ];

  const lines: Line[] = [];
  const support: number[] = [];
  const refined: boolean[] = [];

  for (const [A, B] of edges) {
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const tx = (B.x - A.x) / len;
    const ty = (B.y - A.y) / len;
    // Outward normal: pointing away from the quad's centre.
    let nx = -ty, ny = tx;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    if ((mx - cxq) * nx + (my - cyq) * ny < 0) { nx = -nx; ny = -ny; }
    const original: Line = { px: A.x, py: A.y, dx: tx, dy: ty };

    const steps = Math.floor((2 * R) / step) + 1;
    const profiles: Float32Array[] = [];
    const bases: Pt[] = [];
    let posSum = 0, negSum = 0;
    for (let k = 0; k < REFINE_SAMPLES; k++) {
      const u = REFINE_END_MARGIN + ((1 - 2 * REFINE_END_MARGIN) * (k + 0.5)) / REFINE_SAMPLES;
      const bx = A.x + (B.x - A.x) * u;
      const by = A.y + (B.y - A.y) * u;
      const prof = new Float32Array(steps);
      let pMax = 0, nMax = 0;
      for (let si = 0; si < steps; si++) {
        const d = -R + si * step;
        const x = bx + nx * d;
        const y = by + ny * d;
        // inside minus outside, each averaged over 5 taps along the edge so
        // sensor noise does not read as an edge.
        let inside = 0, outside = 0;
        for (let tap = -2; tap <= 2; tap++) {
          const ox = tx * tap * tapSpread;
          const oy = ty * tap * tapSpread;
          inside += lumaAt(src, sw, sh, x - nx * delta + ox, y - ny * delta + oy);
          outside += lumaAt(src, sw, sh, x + nx * delta + ox, y + ny * delta + oy);
        }
        const gval = (inside - outside) / 5;
        prof[si] = gval;
        if (gval > pMax) pMax = gval;
        if (-gval > nMax) nMax = -gval;
      }
      posSum += pMax;
      negSum += nMax;
      profiles.push(prof);
      bases.push({ x: bx, y: by });
    }
    // Which way the step goes on this side: paper is usually brighter than
    // the desk, but not always (a white desk, a grey form) — decide per side.
    const pol = posSum >= negSum ? 1 : -1;

    const hits: Pt[] = [];
    for (let k = 0; k < profiles.length; k++) {
      const prof = profiles[k];
      let best = 0;
      for (let si = 0; si < prof.length; si++) best = Math.max(best, pol * prof[si]);
      if (best < REFINE_MIN_GRADIENT) continue;
      const floor = Math.max(REFINE_MIN_GRADIENT, 0.3 * best);
      // Outermost local maximum above the floor that is a real STEP.
      let pick = -1;
      for (let si = prof.length - 1; si >= 0; si--) {
        const v = pol * prof[si];
        if (v < floor) continue;
        const prev = si > 0 ? pol * prof[si - 1] : -Infinity;
        const next = si < prof.length - 1 ? pol * prof[si + 1] : -Infinity;
        if (!(v >= prev && v >= next)) continue;
        /* A paper edge is a step that PERSISTS: the desk stays desk well
         * beyond it. A text row, a signature line or a table rule is a thin
         * dark stroke with paper on both sides — a strong step at the stroke's
         * edge that is gone a few pixels further out. Without this, a side laid
         * across a line of text near the bottom of the frame (a page running
         * out of shot, as the ML detector reports it) found "edge" under 46-71%
         * of its length depending on sensor noise — either side of the gate. */
        const d0 = -R + si * step;
        const hx = bases[k].x + nx * d0;
        const hy = bases[k].y + ny * d0;
        let farIn = 0, farOut = 0;
        for (const f of REFINE_PERSIST_OFFSETS) {
          const dd = f * unit;
          for (let tap = -1; tap <= 1; tap++) {
            const ox = tx * tap * tapSpread;
            const oy = ty * tap * tapSpread;
            farIn += lumaAt(src, sw, sh, hx - nx * dd + ox, hy - ny * dd + oy);
            farOut += lumaAt(src, sw, sh, hx + nx * dd + ox, hy + ny * dd + oy);
          }
        }
        const farStep = (pol * (farIn - farOut)) / (REFINE_PERSIST_OFFSETS.length * 3);
        if (farStep < Math.max(REFINE_MIN_GRADIENT, REFINE_PERSIST_SHARE * v)) continue;
        pick = si;
        break;
      }
      if (pick < 0) continue;
      // Sub-step peak position from a parabola through the neighbours.
      let off = 0;
      if (pick > 0 && pick < prof.length - 1) {
        const a = pol * prof[pick - 1], b = pol * prof[pick], c = pol * prof[pick + 1];
        const den = a - 2 * b + c;
        if (den < 0) off = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
      }
      const d = -R + (pick + off) * step;
      hits.push({ x: bases[k].x + nx * d, y: bases[k].y + ny * d });
    }

    // Robust fit: refit twice, dropping hits far off the line.
    let line = fitLine(hits);
    let inliers = hits;
    for (let iter = 0; iter < 3 && line; iter++) {
      const res = inliers.map((p) => distToLine(line as Line, p));
      const sorted = [...res].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const tol = Math.max(1.2 * unit, Math.min(2.5 * med, REFINE_MAX_INLIER_TOL * unit));
      const next = inliers.filter((_, idx) => res[idx] <= tol);
      if (next.length < 2) { line = null; break; }
      inliers = next;
      line = fitLine(inliers);
    }
    const sup = line ? inliers.length / REFINE_SAMPLES : 0;
    support.push(sup);
    if (line && sup >= REFINE_MIN_SUPPORT_TO_MOVE) {
      lines.push(line);
      refined.push(true);
    } else {
      lines.push(original);
      refined.push(false);
    }
  }

  const tl = intersect(lines[3], lines[0]);
  const tr = intersect(lines[0], lines[1]);
  const br = intersect(lines[1], lines[2]);
  const bl = intersect(lines[2], lines[3]);
  const minSupport = Math.min(...support);
  const asTuple = <T,>(a: T[]) => a as [T, T, T, T];
  if (!tl || !tr || !br || !bl) {
    return { corners: q, support: asTuple(support), minSupport, refined: [false, false, false, false] };
  }
  const next: Quad = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
  // Sanity: refinement is a nudge. If it produced a non-convex shape, moved a
  // corner further than the search could justify, or changed the area by more
  // than 15%, it latched onto something that is not the page — keep the input.
  const areaRatio = quadArea(next) / Math.max(1, quadArea(q));
  if (!isConvexQuad(next) || maxCornerShift(q, next) > 2.5 * R || areaRatio < 0.85 || areaRatio > 1.15) {
    return { corners: q, support: asTuple(support), minSupport, refined: [false, false, false, false] };
  }
  return { corners: next, support: asTuple(support), minSupport, refined: asTuple(refined) };
}
