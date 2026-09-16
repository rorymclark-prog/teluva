// Standalone assertion tests — same convention as docReadEligibility.test.ts /
// aiRedact.test.ts:
//   npx tsx src/utils/docEnhance.test.ts
// It exits non-zero on failure.
//
// This tests enhancePixels only — the pure pixel math — not enhanceCanvas or
// enhanceDataUrl, which need a real <canvas>/<img> and have no DOM to run
// against under plain Node. enhancePixels is where the whole algorithm lives
// (both canvas wrappers are thin pass-throughs to it), so that is also where
// the real coverage belongs.
//
// What these tests are actually protecting: the bug this module exists to
// fix was a document that photographed grey and washed out because nothing
// corrected the lighting gradient across the page. The illumination test
// below — measuring the bright side and the dark side of a synthetic shadowed
// page separately and asserting the gap between them collapsed — is the one
// assertion that would have caught it; everything else guards a specific way
// the fix itself could go wrong (inverted polarity, amplified noise, a
// silently-skipped 'off' mode, a crash on a degenerate image).
import assert from 'node:assert';
import { enhancePixels } from './docEnhance';

// ── synthetic test fixture ──────────────────────────────────────────────────
//
// A "page": light background with a strong linear brightness gradient across
// it (the shadow case a real phone photo produces), plus two dark "text"
// blocks — one on the dark/shadowed side, one on the bright side — so ink vs.
// paper contrast can be measured on both sides independently.

const PAGE_W = 192;
const PAGE_H = 128;
const BG_DARK_SIDE = 150; // background luma at x = 0 (the shadowed edge)
const BG_BRIGHT_SIDE = 235; // background luma at x = width - 1 (the lit edge)
const TEXT_LUMA = 40;

// Text rectangles, kept out of the background-measurement regions below.
const TEXT_RECTS = [
  { x0: 20, x1: 50, y0: 105, y1: 120 }, // dark/shadowed side
  { x0: 140, x1: 170, y0: 105, y1: 120 }, // bright side
];

// Background-only measurement windows (no text inside them).
const LEFT_BG = { x0: 10, x1: 40, y0: 10, y1: 90 };
const RIGHT_BG = { x0: 150, x1: 180, y0: 10, y1: 90 };

function inRect(x: number, y: number, r: { x0: number; x1: number; y0: number; y1: number }): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

function buildShadowedPage(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(PAGE_W * PAGE_H * 4);
  for (let y = 0; y < PAGE_H; y++) {
    for (let x = 0; x < PAGE_W; x++) {
      const i = (y * PAGE_W + x) * 4;
      const isText = TEXT_RECTS.some((r) => inRect(x, y, r));
      const luma = isText ? TEXT_LUMA : Math.round(BG_DARK_SIDE + ((BG_BRIGHT_SIDE - BG_DARK_SIDE) * x) / (PAGE_W - 1));
      data[i] = luma;
      data[i + 1] = luma;
      data[i + 2] = luma;
      data[i + 3] = 255;
    }
  }
  return data;
}

// Mean of the R channel over a rectangular region. R is read (rather than a
// recomputed luma) because every fixture here is built with R === G === B, so
// R already IS the luma — and 'color' mode's saturation boost is a no-op on
// an equal-channel pixel (r - luma === 0), so this stays valid after
// processing too.
function regionMeanR(data: Uint8ClampedArray, width: number, r: { x0: number; x1: number; y0: number; y1: number }): number {
  let sum = 0;
  let count = 0;
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      sum += data[(y * width + x) * 4];
      count++;
    }
  }
  return sum / count;
}

function regionMedianR(data: Uint8ClampedArray, width: number, r: { x0: number; x1: number; y0: number; y1: number }): number {
  const vals: number[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) vals.push(data[(y * width + x) * 4]);
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function meanTextR(data: Uint8ClampedArray, width: number): number {
  let sum = 0;
  let count = 0;
  for (const r of TEXT_RECTS) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        sum += data[(y * width + x) * 4];
        count++;
      }
    }
  }
  return sum / count;
}

// ── the point of the whole module: shadow removal ───────────────────────────

{
  const original = buildShadowedPage();
  const leftBefore = regionMeanR(original, PAGE_W, LEFT_BG);
  const rightBefore = regionMeanR(original, PAGE_W, RIGHT_BG);
  const gapBefore = Math.abs(rightBefore - leftBefore);
  assert.ok(gapBefore > 40, `fixture sanity check: the synthetic shadow gradient must actually be strong (got a ${gapBefore.toFixed(1)}-luma gap)`);

  const processed = enhancePixels(new Uint8ClampedArray(original), PAGE_W, PAGE_H, { mode: 'color' });
  const leftAfter = regionMeanR(processed, PAGE_W, LEFT_BG);
  const rightAfter = regionMeanR(processed, PAGE_W, RIGHT_BG);
  const gapAfter = Math.abs(rightAfter - leftAfter);

  assert.ok(
    leftAfter >= 230 && rightAfter >= 230,
    `both sides of the page must read near-white after correction (dark side ${leftAfter.toFixed(1)}, bright side ${rightAfter.toFixed(1)})`,
  );
  assert.ok(
    gapAfter < gapBefore * 0.3,
    `the bright/dark gap must shrink substantially — this is THE assertion that would have caught the original bug (before ${gapBefore.toFixed(1)}, after ${gapAfter.toFixed(1)})`,
  );

  // Contrast: the spread between background and ink must be LARGER after
  // processing than before, not merely shifted.
  const bgBefore = (leftBefore + rightBefore) / 2;
  const bgAfter = (leftAfter + rightAfter) / 2;
  const textBefore = meanTextR(original, PAGE_W);
  const textAfter = meanTextR(processed, PAGE_W);
  assert.ok(
    bgAfter - textAfter > bgBefore - textBefore,
    `background-vs-ink contrast must increase (before ${(bgBefore - textBefore).toFixed(1)}, after ${(bgAfter - textAfter).toFixed(1)})`,
  );

  // Polarity: ink must stay darker than paper on both sides of the pipeline —
  // a bug in the divide step can invert an image and it still "looks
  // processed" (high contrast, clipped extremes) without this check.
  assert.ok(textBefore < bgBefore, 'fixture sanity check: text starts darker than background');
  assert.ok(textAfter < bgAfter, 'ink must still be darker than paper after processing — polarity must not invert');
}

// ── the control: mode 'off' is a genuine, byte-identical no-op ─────────────
//
// Without this, a bug where the whole pipeline silently did nothing would
// pass every "output looks reasonable" assertion above by accident.

{
  const original = buildShadowedPage();
  const untouched = enhancePixels(new Uint8ClampedArray(original), PAGE_W, PAGE_H, { mode: 'off' });
  assert.deepStrictEqual(
    Array.from(untouched),
    Array.from(original),
    "mode:'off' must return pixels byte-identical to the input — this is the archival escape hatch",
  );
}

// ── a uniform mid-grey image must not get amplified into noise ────────────
//
// A perfectly flat input (no gradient, no text — nothing for the shadow
// correction to legitimately act on) must come out perfectly flat too. If a
// divide-by-near-zero guard were missing or a stage introduced per-pixel
// rounding drift, this is where it would show up as injected variance.

{
  const flat = new Uint8ClampedArray(PAGE_W * PAGE_H * 4);
  for (let p = 0; p < PAGE_W * PAGE_H; p++) {
    const i = p * 4;
    flat[i] = 128;
    flat[i + 1] = 128;
    flat[i + 2] = 128;
    flat[i + 3] = 255;
  }
  const processed = enhancePixels(flat, PAGE_W, PAGE_H, { mode: 'color' });
  let min = 255;
  let max = 0;
  for (let p = 0; p < PAGE_W * PAGE_H; p++) {
    const v = processed[p * 4];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  assert.ok(
    max - min <= 2,
    `a uniform mid-grey input must stay uniform — no noise may be injected (got a spread of ${max - min} across the output)`,
  );
}

// ── bw mode: only 0/255 in RGB, alpha preserved ─────────────────────────────

{
  const original = buildShadowedPage();
  // Vary alpha across the image so preservation is actually exercised, not
  // just coincidentally true because every pixel started at 255.
  for (let p = 0; p < PAGE_W * PAGE_H; p++) {
    original[p * 4 + 3] = p % 2 === 0 ? 255 : 200;
  }
  const processed = enhancePixels(new Uint8ClampedArray(original), PAGE_W, PAGE_H, { mode: 'bw' });

  let sawBlack = false;
  let sawWhite = false;
  for (let p = 0; p < PAGE_W * PAGE_H; p++) {
    const i = p * 4;
    const r = processed[i];
    const g = processed[i + 1];
    const b = processed[i + 2];
    assert.ok(
      (r === 0 || r === 255) && (g === 0 || g === 255) && (b === 0 || b === 255),
      `bw mode must produce only 0 or 255 in every RGB channel (got r=${r} g=${g} b=${b} at pixel ${p})`,
    );
    assert.strictEqual(r, g, 'bw output must be neutral (R === G)');
    assert.strictEqual(g, b, 'bw output must be neutral (G === B)');
    assert.strictEqual(processed[i + 3], original[i + 3], 'bw mode must leave alpha untouched');
    if (r === 0) sawBlack = true;
    if (r === 255) sawWhite = true;
  }
  assert.ok(sawBlack && sawWhite, 'the fixture has both ink and paper, so a real threshold must produce both 0 and 255 somewhere');
}

// ── degenerate images: no NaN, no wraparound ────────────────────────────────

{
  const allBlack = new Uint8ClampedArray(PAGE_W * PAGE_H * 4);
  for (let p = 0; p < PAGE_W * PAGE_H; p++) allBlack[p * 4 + 3] = 255; // r/g/b already 0
  const blackOut = enhancePixels(allBlack, PAGE_W, PAGE_H, { mode: 'color' });
  let blackSum = 0;
  for (let p = 0; p < PAGE_W * PAGE_H; p++) {
    const v = blackOut[p * 4];
    assert.ok(Number.isFinite(v), 'an all-black image must not produce NaN');
    blackSum += v;
  }
  assert.ok(
    blackSum / (PAGE_W * PAGE_H) <= 10,
    'an all-black image must stay dark, not divide-by-near-zero its way up toward white',
  );
}

{
  const allWhite = new Uint8ClampedArray(PAGE_W * PAGE_H * 4);
  allWhite.fill(255);
  const whiteOut = enhancePixels(allWhite, PAGE_W, PAGE_H, { mode: 'color' });
  let whiteSum = 0;
  for (let p = 0; p < PAGE_W * PAGE_H; p++) {
    const v = whiteOut[p * 4];
    assert.ok(Number.isFinite(v), 'an all-white image must not produce NaN');
    whiteSum += v;
  }
  assert.ok(
    whiteSum / (PAGE_W * PAGE_H) >= 245,
    'an all-white image must stay white, not clamp-wrap its way down toward black',
  );
}

// ── paper white: a noisy real-photo page ends up white, faint marks survive ──
//
// A flat page whose paper carries sensor noise (±12) sits at about 240 after
// auto-levels, because the 99.5th percentile it stretches to is the top of the
// noise, not the paper. Stage 2b must lift the paper itself while keeping a
// faint watermark visibly darker than it and the ink dark.

{
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const W = 160;
  const H = 120;
  const PAPER = 200;
  const MARK = { x0: 20, x1: 70, y0: 20, y1: 60 }; // faint watermark, 14 below paper
  const INK = { x0: 100, x1: 140, y0: 80, y1: 100 };
  const PAPER_WIN = { x0: 90, x1: 150, y0: 10, y1: 60 };
  const build = () => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const base = inRect(x, y, INK) ? 45 : inRect(x, y, MARK) ? PAPER - 14 : PAPER;
        const v = base + Math.round((rand() - 0.5) * 24);
        const i = (y * W + x) * 4;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    return d;
  };
  const lifted = enhancePixels(build(), W, H, { mode: 'color' });
  const unlifted = enhancePixels(build(), W, H, { mode: 'color', paperWhite: false });
  const paperOn = regionMeanR(lifted, W, PAPER_WIN);
  const paperOff = regionMeanR(unlifted, W, PAPER_WIN);
  // CONTROL: without the stage the paper is visibly grey — the fixture really
  // reproduces the problem the stage exists for.
  assert.ok(paperOff < 244, `control: without paper white the noisy paper must stay grey (got ${paperOff.toFixed(1)})`);
  assert.ok(paperOn >= 248, `paper white must lift the paper to near-white (got ${paperOn.toFixed(1)}, was ${paperOff.toFixed(1)} without it)`);
  // Medians, not means: the stage deliberately squeezes the paper's own noise
  // ABOVE its peak into the last few levels (cleaner paper), which pulls the
  // paper's MEAN toward its lower half. What decides whether a watermark is
  // visible is its level against the typical paper pixel, i.e. the median.
  const markGapOn = regionMedianR(lifted, W, PAPER_WIN) - regionMedianR(lifted, W, MARK);
  const markGapOff = regionMedianR(unlifted, W, PAPER_WIN) - regionMedianR(unlifted, W, MARK);
  assert.ok(markGapOn >= markGapOff, `a faint watermark must keep its gap to the paper (with ${markGapOn}, without ${markGapOff})`);
  assert.ok(markGapOn >= 12, `a faint watermark must stay visibly darker than the paper (gap ${markGapOn})`);
  assert.ok(regionMeanR(lifted, W, INK) < 60, 'ink must stay dark after the paper lift');

  // A page with no dominant bright paper (a dark card) is left alone by the stage.
  const card = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    const v = 90 + ((p * 37) % 90); // spread 90..179, nothing near paper white
    card[p * 4] = v; card[p * 4 + 1] = v; card[p * 4 + 2] = v; card[p * 4 + 3] = 255;
  }
  const cardOn = enhancePixels(new Uint8ClampedArray(card), W, H, { mode: 'color' });
  const cardOff = enhancePixels(new Uint8ClampedArray(card), W, H, { mode: 'color', paperWhite: false });
  assert.deepStrictEqual(Array.from(cardOn), Array.from(cardOff), 'with no dominant paper peak the paper-white stage must be a no-op');
}

// ── tiny images: the downsample grid math is where off-by-one crashes live ──

{
  const tiny3x3 = new Uint8ClampedArray(3 * 3 * 4).fill(180);
  assert.doesNotThrow(() => {
    const out = enhancePixels(tiny3x3, 3, 3, { mode: 'color' });
    assert.strictEqual(out.length, 3 * 3 * 4);
  }, '3x3 must not crash the grid downsample math');

  const oneByOne = new Uint8ClampedArray(1 * 1 * 4).fill(180);
  assert.doesNotThrow(() => {
    const out = enhancePixels(oneByOne, 1, 1, { mode: 'color' });
    assert.strictEqual(out.length, 4);
  }, '1x1 must not crash the grid downsample math');

  // Also exercise bw and grayscale on a tiny image — different code paths
  // (adaptive threshold, integral image) with the same off-by-one risk.
  assert.doesNotThrow(() => enhancePixels(new Uint8ClampedArray(3 * 3 * 4).fill(180), 3, 3, { mode: 'bw' }));
  assert.doesNotThrow(() => enhancePixels(new Uint8ClampedArray(1 * 1 * 4).fill(180), 1, 1, { mode: 'bw' }));
  assert.doesNotThrow(() => enhancePixels(new Uint8ClampedArray(3 * 3 * 4).fill(180), 3, 3, { mode: 'grayscale' }));
}

console.log('docEnhance.test.ts: all assertions passed');
