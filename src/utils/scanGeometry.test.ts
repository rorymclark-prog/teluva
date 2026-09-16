// Standalone assertion tests — same convention as scanImage.test.ts:
//   npx tsx src/utils/scanGeometry.test.ts
// Exits non-zero on failure.
//
// Everything here runs on synthetic pixel buffers built in the test: a white
// page photographed by a pinhole camera onto a pale desk, which is the
// low-contrast case the scanner used to get "close but not quite". Each
// behaviour is paired with a CONTROL that shows the failure it prevents is
// real, so a refactor that quietly turns a check into a no-op fails here.
import assert from 'node:assert';
import {
  refineQuad,
  pageAspect,
  outputSize,
  warpQuad,
  unitSquareToQuad,
  isQuadRunStable,
  touchesFrame,
  looksLikeCameraFrame,
  maxCornerShift,
  scaleQuad,
  isConvexQuad,
  type Quad,
} from './scanGeometry';

// ── a pinhole camera looking at an A4 page ──────────────────────────────────

function projectA4(fw: number, fh: number, pitchDeg: number, yawDeg: number, rollDeg: number, distMm: number, f: number): Quad {
  const [p, y, r] = [pitchDeg, yawDeg, rollDeg].map((d) => (d * Math.PI) / 180);
  const Rx = [[1, 0, 0], [0, Math.cos(p), -Math.sin(p)], [0, Math.sin(p), Math.cos(p)]];
  const Ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const Rz = [[Math.cos(r), -Math.sin(r), 0], [Math.sin(r), Math.cos(r), 0], [0, 0, 1]];
  const mul = (A: number[][], B: number[][]) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  const R = mul(Rz, mul(Ry, Rx));
  const pt = (X: number, Y: number) => {
    const c = [0, 1, 2].map((i) => R[i][0] * X + R[i][1] * Y);
    const z = c[2] + distMm;
    return { x: (f * c[0]) / z + fw / 2, y: (f * c[1]) / z + fh / 2 };
  };
  return { topLeft: pt(-105, -148.5), topRight: pt(105, -148.5), bottomRight: pt(105, 148.5), bottomLeft: pt(-105, 148.5) };
}

/** Render the page (luma 232) over a desk (luma 212 + faint grain), RGBA. */
function renderScene(fw: number, fh: number, q: Quad, seed = 1): Uint8ClampedArray {
  const m = unitSquareToQuad(q);
  // Invert the unit-square → quad homography [[a b c][d e f][g h 1]].
  const [a, b, c, d, e, f, g, h] = m;
  const M = [[a, b, c], [d, e, f], [g, h, 1]];
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const inv = [
    [(M[1][1] * M[2][2] - M[1][2] * M[2][1]) / det, (M[0][2] * M[2][1] - M[0][1] * M[2][2]) / det, (M[0][1] * M[1][2] - M[0][2] * M[1][1]) / det],
    [(M[1][2] * M[2][0] - M[1][0] * M[2][2]) / det, (M[0][0] * M[2][2] - M[0][2] * M[2][0]) / det, (M[0][2] * M[1][0] - M[0][0] * M[1][2]) / det],
    [(M[1][0] * M[2][1] - M[1][1] * M[2][0]) / det, (M[0][1] * M[2][0] - M[0][0] * M[2][1]) / det, (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / det],
  ];
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = new Uint8ClampedArray(fw * fh * 4);
  const SS = 3; // supersample so the page edge is anti-aliased like a real photo
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const w = inv[2][0] * px + inv[2][1] * py + inv[2][2];
          const u = (inv[0][0] * px + inv[0][1] * py + inv[0][2]) / w;
          const v = (inv[1][0] * px + inv[1][1] * py + inv[1][2]) / w;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1) cover++;
        }
      }
      const k = cover / (SS * SS);
      const grain = Math.sin(x * 0.35) * 2.5 + (rand() - 0.5) * 6;
      const luma = k * 232 + (1 - k) * (212 + grain);
      const i = (y * fw + x) * 4;
      out[i] = luma;
      out[i + 1] = luma * 0.985;
      out[i + 2] = luma * 0.94;
      out[i + 3] = 255;
    }
  }
  return out;
}

const KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
const meanErr = (a: Quad, b: Quad) => KEYS.reduce((s, k) => s + Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y), 0) / 4;

const FW = 480;
const FH = 640;
const F = 0.756 * FH;
const truth = projectA4(FW, FH, 14, 5, 4, 330, F);
const pixels = renderScene(FW, FH, truth);

// ── refineQuad: snaps a rough quad onto the real paper edges ───────────────
//
// The detector's corners are typically 5-30px out at full resolution (the
// scanner bench measured 19px mean on a 12 MP still). Refinement has to pull a
// quad that far off back onto the edge — on a pale desk, where the step
// between paper and desk is only ~20 luma levels.

{
  // Rough: every corner pushed ~2% of the frame in a different direction.
  const rough: Quad = {
    topLeft: { x: truth.topLeft.x + 7, y: truth.topLeft.y - 6 },
    topRight: { x: truth.topRight.x - 5, y: truth.topRight.y + 8 },
    bottomRight: { x: truth.bottomRight.x + 6, y: truth.bottomRight.y + 5 },
    bottomLeft: { x: truth.bottomLeft.x - 8, y: truth.bottomLeft.y - 4 },
  };
  const before = meanErr(rough, truth);
  const r = refineQuad(pixels, FW, FH, rough);
  const after = meanErr(r.corners, truth);
  assert.ok(before > 6, `CONTROL: the rough quad really is off (${before.toFixed(1)}px)`);
  assert.ok(after < 1.5, `refined corners land on the page corners (mean error ${after.toFixed(2)}px, was ${before.toFixed(1)}px)`);
  assert.ok(r.minSupport >= 0.8, `every side of the real page has real edge under it (min support ${r.minSupport.toFixed(2)})`);
  assert.deepStrictEqual(r.refined, [true, true, true, true]);
}

// The verification half. A quad with one side across the MIDDLE of the page —
// what a detector returns when the page runs out of shot, or when it latches
// onto a table border inside the page — must report no edge under that side.
{
  const lerp = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const cut: Quad = {
    topLeft: truth.topLeft,
    topRight: truth.topRight,
    bottomRight: lerp(truth.topRight, truth.bottomRight, 0.8),
    bottomLeft: lerp(truth.topLeft, truth.bottomLeft, 0.8),
  };
  const r = refineQuad(pixels, FW, FH, cut);
  assert.ok(r.support[2] < 0.3, `the side across the middle of the page has no paper edge under it (support ${r.support[2].toFixed(2)})`);
  assert.ok(r.minSupport < 0.3, 'so the quad as a whole fails verification');
  // CONTROL: its other three sides ARE on real edges — the low number is
  // about that one side, not a detector that finds nothing anywhere.
  assert.ok(Math.min(r.support[0], r.support[1], r.support[3]) >= 0.5, 'CONTROL: the three real sides still verify');
}

// The same, but the side lies along a PRINTED LINE — a table rule, a signature
// line, a row of text. That is a strong, straight, same-polarity step (paper
// above, ink below) along the whole side, and it is what a page running out of
// shot offers the detector near the frame border. Found on the scanner bench:
// the ML detector's quad for such a shot had its bottom side on a text row,
// and refinement reported edge under 46-71% of it depending on sensor noise,
// straddling the 0.6 gate — so the crop that cut the bottom off the page was
// sometimes accepted. A real paper edge persists (desk beyond it); a stroke
// does not (paper again a few pixels on).
{
  const ruled = new Uint8ClampedArray(pixels);
  const m = unitSquareToQuad(truth);
  const [a, b, c, d, e, f, g, h] = m;
  const RULE_V = 0.8;
  for (let v = RULE_V; v <= RULE_V + 0.006; v += 0.0005) {
    for (let u = 0.03; u <= 0.97; u += 0.0005) {
      const w = g * u + h * v + 1;
      const x = Math.round((a * u + b * v + c) / w);
      const y = Math.round((d * u + e * v + f) / w);
      const i = (y * FW + x) * 4;
      ruled[i] = 40; ruled[i + 1] = 40; ruled[i + 2] = 38;
    }
  }
  const on = (t: number) => {
    const w = g * 0 + h * t + 1;
    const w1 = g * 1 + h * t + 1;
    return {
      bl: { x: (a * 0 + b * t + c) / w, y: (d * 0 + e * t + f) / w },
      br: { x: (a * 1 + b * t + c) / w1, y: (d * 1 + e * t + f) / w1 },
    };
  };
  const along = on(RULE_V);
  const cut: Quad = { topLeft: truth.topLeft, topRight: truth.topRight, bottomRight: along.br, bottomLeft: along.bl };
  const r = refineQuad(ruled, FW, FH, cut);
  assert.ok(r.support[2] < 0.3, `a side along a printed rule is not a paper edge (support ${r.support[2].toFixed(2)})`);
  // CONTROL 1: the rule is a strong step — the gradient the old outermost-peak
  // rule accepted. Measured straight across it at the side's midpoint.
  const mid = { x: (along.bl.x + along.br.x) / 2, y: (along.bl.y + along.br.y) / 2 };
  const lumaAtPx = (x: number, y: number) => ruled[(Math.round(y) * FW + Math.round(x)) * 4];
  assert.ok(lumaAtPx(mid.x, mid.y - 3) - lumaAtPx(mid.x, mid.y + 1) > 100, 'CONTROL: the rule is a strong dark step under that side');
  // CONTROL 2: the rule does not stop the REAL bottom edge verifying.
  const real = refineQuad(ruled, FW, FH, truth);
  assert.ok(real.minSupport >= 0.8, `CONTROL: the true quad still verifies with the rule on the page (min ${real.minSupport.toFixed(2)})`);
  assert.ok(meanErr(real.corners, truth) < 1.5, 'CONTROL: and still snaps to the real corners');
}

// A side laid across a SIGNATURE and a STAMP (the bench's cut-off invoice, as
// the ML detector reported it). Every sample finds some ink step within the
// search window, but at a different offset each time. The fit's tolerance used
// to grow with the median residual, so the scattered hits all counted: 58%
// support, a hair under the 0.6 gate. A paper edge is a LINE of hits.
{
  const inked = new Uint8ClampedArray(pixels);
  const [a, b, c, d, e, f, g, h] = unitSquareToQuad(truth);
  const toPx = (u: number, v: number) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
  const dot = (u: number, v: number, r: number, rgb: [number, number, number]) => {
    const p = toPx(u, v);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
      if (x < 0 || y < 0 || x >= FW || y >= FH) continue;
      const i = (y * FW + x) * 4;
      inked[i] = rgb[0]; inked[i + 1] = rgb[1]; inked[i + 2] = rgb[2];
    }
  };
  const CUT_V = 0.62;
  // Signature: a wavy stroke either side of the cut.
  for (let u = 0.08; u <= 0.45; u += 0.0008) dot(u, CUT_V + 0.03 * Math.sin(u * 55), 1, [40, 45, 90]);
  // Stamp: a ring and a second, inner ring, centred on the cut.
  for (let t = 0; t < 2 * Math.PI; t += 0.004) {
    for (const rad of [0.07, 0.055]) dot(0.72 + rad * Math.cos(t) * 1.414, CUT_V + rad * Math.sin(t), 1, [60, 80, 170]);
  }
  const l = toPx(0, CUT_V), r = toPx(1, CUT_V);
  const cut: Quad = { topLeft: truth.topLeft, topRight: truth.topRight, bottomRight: r, bottomLeft: l };
  const res = refineQuad(inked, FW, FH, cut);
  assert.ok(res.support[2] < 0.35, `a side across a signature and a stamp is not a paper edge (support ${res.support[2].toFixed(2)})`);
  // CONTROL 1: the ink is really under that side — sample the luma along it and
  // count dark pixels within a few pixels of the line.
  let darkNear = 0;
  for (let u = 0.1; u <= 0.9; u += 0.01) {
    const p = toPx(u, CUT_V);
    let seen = false;
    for (let dy = -12; dy <= 12 && !seen; dy++) {
      const y = Math.round(p.y) + dy;
      if (y >= 0 && y < FH && inked[(y * FW + Math.round(p.x)) * 4 + 1] < 120) seen = true;
    }
    if (seen) darkNear++;
  }
  assert.ok(darkNear >= 40, `CONTROL: ink lies within the search window along much of that side (${darkNear}/81)`);
  // CONTROL 2: the ink does not stop the REAL edges verifying.
  const real = refineQuad(inked, FW, FH, truth);
  assert.ok(real.minSupport >= 0.8, `CONTROL: the true quad still verifies with the ink on the page (min ${real.minSupport.toFixed(2)})`);
}

// A blank desk with no page at all: nothing to snap to, nothing verified.
{
  const blank = renderScene(FW, FH, { topLeft: { x: -9e3, y: -9e3 }, topRight: { x: -8e3, y: -9e3 }, bottomRight: { x: -8e3, y: -8e3 }, bottomLeft: { x: -9e3, y: -8e3 } });
  const r = refineQuad(blank, FW, FH, truth);
  assert.ok(r.minSupport < 0.3, `no page, no support (${r.minSupport.toFixed(2)})`);
}

// ── pageAspect: the page's real shape, not its foreshortened one ───────────
//
// The old output was sized from side lengths, which under a 14-degree tilt at
// arm's length makes an A4 page come out ~10% too wide. CONTROL first, so the
// test proves the error exists before proving it is fixed.

{
  const A4 = 210 / 297;
  const sides = pageAspect(truth, FW, FH, { centredCamera: false });
  assert.ok(Math.abs(sides.aspect / A4 - 1) > 0.05, `CONTROL: side lengths get the shape wrong by >5% (${((sides.aspect / A4 - 1) * 100).toFixed(1)}%)`);
  const persp = pageAspect(truth, FW, FH);
  assert.strictEqual(persp.method, 'perspective');
  assert.ok(Math.abs(persp.aspect / A4 - 1) < 0.01, `perspective recovery gets A4 to within 1% (${((persp.aspect / A4 - 1) * 100).toFixed(2)}%)`);
  assert.ok(Math.abs((persp.focalPx ?? 0) / F - 1) < 0.03, 'and recovers the focal length it was shot with');

  // A strong tilt (28 degrees) — the bench's hardest still.
  const steep = projectA4(3024, 4032, 28, 10, 8, 420, 0.756 * 4032);
  const s2 = pageAspect(steep, 3024, 4032);
  assert.ok(Math.abs(s2.aspect / A4 - 1) < 0.01, `28-degree tilt: within 1% (${((s2.aspect / A4 - 1) * 100).toFixed(2)}%)`);
  // ...and the same tilt with the page filling the frame, where the side
  // lengths are off by more than a quarter. An earlier ±20% sanity guard
  // silently threw this correct answer away on the bench.
  const close = projectA4(3024, 4032, 28, 10, 8, 300, 0.756 * 4032);
  const sidesClose = pageAspect(close, 3024, 4032, { centredCamera: false }).aspect;
  assert.ok(sidesClose / A4 - 1 > 0.2, `CONTROL: side lengths are >20% off here (${((sidesClose / A4 - 1) * 100).toFixed(1)}%)`);
  const s4 = pageAspect(close, 3024, 4032);
  assert.strictEqual(s4.method, 'perspective');
  assert.ok(Math.abs(s4.aspect / A4 - 1) < 0.01, `close and steep: within 1% (${((s4.aspect / A4 - 1) * 100).toFixed(2)}%)`);

  // Square-on: the focal length is unobservable, and the sides are right anyway.
  const flat: Quad = { topLeft: { x: 100, y: 100 }, topRight: { x: 310, y: 100 }, bottomRight: { x: 310, y: 397 }, bottomLeft: { x: 100, y: 397 } };
  const s3 = pageAspect(flat, FW, FH);
  assert.strictEqual(s3.method, 'sides', 'a parallelogram falls back to side lengths');
  assert.ok(Math.abs(s3.aspect - 210 / 297) < 1e-6);

  // An ID card (85.6 x 54 mm, landscape) keeps its landscape shape.
  const card = projectA4(FW, FH, 0, 0, 0, 300, F); // square-on page, scaled below
  const cardQ = scaleQuad(card, 1, 1);
  assert.ok(pageAspect(cardQ, FW, FH).aspect < 1, 'portrait stays portrait');
}

// ── outputSize: capped, never upscaled ─────────────────────────────────────

{
  const small = outputSize(truth, FW, FH, 2200);
  assert.ok(Math.max(small.width, small.height) <= small.nativeLongEdge + 1, 'never larger than the page was photographed');
  const big = projectA4(3024, 4032, 14, 5, 4, 330, 0.756 * 4032);
  const o = outputSize(big, 3024, 4032, 2200);
  assert.strictEqual(Math.max(o.width, o.height), 2200, 'a 12 MP page is capped at the 2200px OCR target');
  assert.ok(Math.abs(o.width / o.height / (210 / 297) - 1) < 0.01, 'at the true A4 shape');
}

// ── warpQuad: right way up, right pixels ───────────────────────────────────

{
  // 4x4 image, one bright pixel top-left. An axis-aligned quad covering the
  // whole image warps 1:1 and must keep it top-left (catches a flipped or
  // transposed homography, which would still "look like a page").
  const w = 4;
  const src = new Uint8ClampedArray(w * w * 4).fill(0);
  for (let i = 3; i < src.length; i += 4) src[i] = 255;
  src[0] = src[1] = src[2] = 255;
  const q: Quad = { topLeft: { x: 0, y: 0 }, topRight: { x: w, y: 0 }, bottomRight: { x: w, y: w }, bottomLeft: { x: 0, y: w } };
  const out = warpQuad(src, w, w, q, w, w, 1);
  assert.strictEqual(out[0], 255, 'top-left stays top-left');
  assert.strictEqual(out[(w * w - 1) * 4], 0, 'CONTROL: bottom-right is still dark');
  assert.strictEqual(out[3], 255, 'opaque output');

  // Supersampling averages a 1px checkerboard to mid-grey when shrinking 3:1
  // — a single sample per pixel lands on whole pixels and aliases it into a
  // coarser black-and-white checkerboard, i.e. jagged fine print.
  const n = 18;
  const cb = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = (x + y) % 2 ? 255 : 0;
    const i = (y * n + x) * 4;
    cb[i] = cb[i + 1] = cb[i + 2] = v;
    cb[i + 3] = 255;
  }
  const cq: Quad = { topLeft: { x: 0, y: 0 }, topRight: { x: n, y: 0 }, bottomRight: { x: n, y: n }, bottomLeft: { x: 0, y: n } };
  const ss = warpQuad(cb, n, n, cq, n / 3, n / 3);
  const single = warpQuad(cb, n, n, cq, n / 3, n / 3, 1);
  const spread = (a: Uint8ClampedArray) => { let lo = 255, hi = 0; for (let i = 0; i < a.length; i += 4) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return hi - lo; };
  assert.ok(spread(ss) < 40, `supersampled shrink is smooth grey (spread ${spread(ss)})`);
  const mean = (a: Uint8ClampedArray) => { let t = 0; for (let i = 0; i < a.length; i += 4) t += a[i]; return t / (a.length / 4); };
  assert.ok(Math.abs(mean(ss) - 127.5) < 20, 'and keeps the average brightness');
  assert.ok(spread(single) > 200, `CONTROL: one sample per pixel aliases it (spread ${spread(single)})`);
}

// ── live helpers ───────────────────────────────────────────────────────────

{
  const shifted = (d: number): Quad => scaleQuad({ ...truth, topLeft: { x: truth.topLeft.x + d, y: truth.topLeft.y } }, 1);
  assert.ok(isQuadRunStable([truth, shifted(1), shifted(2)], 3, 3), 'three quads within tolerance are stable');
  assert.ok(!isQuadRunStable([truth, shifted(9), shifted(9)], 3, 3), 'a jump breaks the run');
  assert.ok(!isQuadRunStable([truth, null, truth], 3, 3), 'a frame with no page breaks the run');
  assert.ok(!isQuadRunStable([truth, truth], 3, 3), 'CONTROL: too few samples is not stable yet');
  assert.ok(isQuadRunStable([null, truth, truth, truth], 3, 3), 'only the latest run counts');
  assert.strictEqual(maxCornerShift(truth, shifted(4)), 4);

  assert.ok(touchesFrame({ ...truth, bottomRight: { x: 300, y: FH - 1 } }, FW, FH), 'a corner on the bottom edge touches the frame');
  assert.ok(!touchesFrame(truth, FW, FH), 'CONTROL: a page wholly inside the frame does not');

  assert.ok(looksLikeCameraFrame(3024, 4032) && looksLikeCameraFrame(1920, 1080) && looksLikeCameraFrame(4000, 6000));
  assert.ok(!looksLikeCameraFrame(1000, 1413), 'CONTROL: a cropped A4-shaped picture is not a camera frame');

  assert.ok(isConvexQuad(truth));
  assert.ok(!isConvexQuad({ ...truth, topRight: truth.bottomRight, bottomRight: truth.topRight }), 'a bow-tie is not convex');
}

console.log('scanGeometry.test.ts: all assertions passed');
