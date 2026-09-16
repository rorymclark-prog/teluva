// Standalone assertion tests — same convention as docReadEligibility.test.ts:
//   npx tsx src/utils/scanImage.test.ts
// Exits non-zero on failure.
//
// Only the pure parts are tested here. rotateDataUrl() and fitToBudget() need a
// canvas and an image decoder, and mocking those would test the mock — what
// CAN be tested without a DOM is the arithmetic they depend on, which is
// exactly where the off-by-one and sign bugs live: which way a turn counter
// wraps, whether an odd turn swaps the axes, and whether the byte estimate the
// budget loop compares against the cap is actually right.
import assert from 'node:assert';
import { normaliseTurns, rotatedSize, dataUrlBytes, pageByteBudget, MAX_SCAN_PAGES, SCAN_TARGET_LONG_EDGE, SCAN_MAX_UPLOAD_BYTES } from './scanImage';
import { captureScale, captureSize, MAX_CAPTURE_PIXELS } from './scanCapture';

// ── turn normalisation ──────────────────────────────────────────────────────
//
// The modal keeps a running counter and lets it go negative (rotate-left is
// -1), so this must wrap in BOTH directions. JavaScript's % keeps the sign of
// the dividend, which is the trap: -1 % 4 is -1, not 3, and an unguarded
// counter would index a rotation table out of bounds the first time anyone
// turned a document anticlockwise.

{
  assert.strictEqual(normaliseTurns(0), 0);
  assert.strictEqual(normaliseTurns(1), 1);
  assert.strictEqual(normaliseTurns(4), 0, 'four turns is back where you started');
  assert.strictEqual(normaliseTurns(7), 3);
  assert.strictEqual(normaliseTurns(-1), 3, 'THE SIGN TRAP: one turn left is three turns right, not minus one');
  assert.strictEqual(normaliseTurns(-4), 0);
  assert.strictEqual(normaliseTurns(-5), 3);
  assert.strictEqual(normaliseTurns(-9), 3, 'and it holds however far the counter has run');
}

// ── axis swapping ───────────────────────────────────────────────────────────

{
  assert.deepStrictEqual(rotatedSize(2200, 1700, 0), { width: 2200, height: 1700 }, 'no turn, no change');
  assert.deepStrictEqual(rotatedSize(2200, 1700, 1), { width: 1700, height: 2200 }, 'a quarter turn swaps the axes');
  assert.deepStrictEqual(rotatedSize(2200, 1700, 2), { width: 2200, height: 1700 }, 'a half turn does not');
  assert.deepStrictEqual(rotatedSize(2200, 1700, 3), { width: 1700, height: 2200 });
  assert.deepStrictEqual(rotatedSize(2200, 1700, -1), { width: 1700, height: 2200 }, 'and it normalises first');
  // THE CONTROL. Both of the above would also pass if rotatedSize swapped on
  // every call, or on none — a square image cannot tell those apart, so the
  // assertions that matter are the rectangular ones above. This one only
  // guards against a crash or a stray transform on the degenerate case.
  assert.deepStrictEqual(rotatedSize(500, 500, 1), { width: 500, height: 500 }, 'a square rotates to itself');
}

// ── the byte estimate the budget loop trusts ────────────────────────────────
//
// fitToBudget() compares this against a hard 700KB Firestore ceiling and
// returns the first encode that fits. If the estimate reads LOW the loop
// accepts a file that then fails to save; the padding characters are the whole
// subtlety, and they are worth four bytes at the wrong moment.

{
  // "QUJD" decodes to "ABC" — 3 bytes, no padding.
  assert.strictEqual(dataUrlBytes('data:image/jpeg;base64,QUJD'), 3);
  // "QUJDRA==" decodes to "ABCD" — 4 bytes, two padding chars.
  assert.strictEqual(dataUrlBytes('data:image/jpeg;base64,QUJDRA=='), 4, 'double padding is subtracted');
  // "QUJDREU=" decodes to "ABCDE" — 5 bytes, one padding char.
  assert.strictEqual(dataUrlBytes('data:image/jpeg;base64,QUJDREU='), 5, 'single padding is subtracted');
  assert.strictEqual(dataUrlBytes('QUJD'), 3, 'a bare base64 string with no data: prefix still measures');
  assert.strictEqual(dataUrlBytes('data:image/jpeg;base64,'), 0, 'an empty payload is zero, not negative');
}

// ── multi-page budget: N pages share ONE record ─────────────────────────────

{
  // The failure this prevents: every page individually fits 700KB, the PDF of
  // all of them does not, and the save is refused after the person has
  // photographed six pages.
  for (let n = 1; n <= MAX_SCAN_PAGES; n++) {
    const per = pageByteBudget(n);
    assert.ok(per > 0, `a ${n}-page scan must leave each page a positive budget`);
    // jsPDF's structure over the raw JPEG bytes, measured on the scanner
    // bench's own pages: ~2.8KB + ~0.5KB per page. Checked here at roughly
    // double that, so a jsPDF upgrade has room before a save fails.
    assert.ok(per * n + 1024 * n + 5 * 1024 <= SCAN_MAX_UPLOAD_BYTES,
      `${n} pages at ${per} bytes each, plus PDF structure, must fit the record ceiling`);
  }
  // CONTROL: the naive split (ceiling / n, no structure reserved) really would
  // overflow once the PDF structure is added — so the check above can fail.
  const naive = Math.floor(SCAN_MAX_UPLOAD_BYTES / 2);
  assert.ok(naive * 2 + 1024 * 2 + 5 * 1024 > SCAN_MAX_UPLOAD_BYTES,
    'CONTROL: splitting the ceiling evenly with nothing reserved does not pass the fit check');
  assert.ok(pageByteBudget(2) < pageByteBudget(1), 'more pages means less per page');
  // Each page still gets enough for a readable text page at the bottom of the ladder.
  assert.ok(pageByteBudget(MAX_SCAN_PAGES) >= 100 * 1024,
    `at the page cap each page must still get ~100KB (got ${pageByteBudget(MAX_SCAN_PAGES)})`);
}

// ── the constants themselves ────────────────────────────────────────────────

{
  // Not a tautology — this is the assertion that fails if someone "optimises"
  // the scan size back down. The number has a reason: it is what docText.ts
  // rasterises a page to before OCR, so storing a scan below it means the
  // reader upscales blur later and misses digits that were in front of the
  // camera. Anything smaller is a silent downgrade to the document reader.
  assert.ok(
    SCAN_TARGET_LONG_EDGE >= 2200,
    'scans must be stored at least at the resolution the OCR path rasterises to (OCR_RENDER_LONG_EDGE, 2200)',
  );
  assert.strictEqual(SCAN_MAX_UPLOAD_BYTES, 700 * 1024, 'the Firestore record ceiling this all has to fit under');
}

// ── capture size: iOS silently blanks canvases over 16.7M px ────────────────
//
// A 24MP photo from a current iPhone's camera app (5712x4284) drawn at full
// size comes back as an EMPTY canvas on iOS Safari — no error, just a white
// page. captureScale is what keeps every capture under the limit.
{
  const IOS_CANVAS_LIMIT = 16_777_216;
  const { width: w, height: h } = captureSize(5712, 4284);
  assert.ok(w * h <= MAX_CAPTURE_PIXELS && w * h < IOS_CANVAS_LIMIT, `a 24MP photo is drawn under the iOS canvas limit (${w}x${h})`);
  assert.ok(Math.max(w, h) >= SCAN_TARGET_LONG_EDGE * 1.5, 'and still far above the resolution the page is stored at');
  assert.ok(Math.abs(w / h - 5712 / 4284) < 0.002, 'without changing its shape');
  assert.deepStrictEqual(captureSize(4032, 3024), { width: 4032, height: 3024 }, 'a 12MP photo is kept at full size');
  assert.strictEqual(captureScale(1920, 1080), 1, 'as is a video frame');
  // Every size a phone might hand us stays under the cap after flooring.
  for (const [a, b] of [[5712, 4284], [8064, 6048], [4284, 5712], [6000, 4000], [4000, 3000], [3264, 4352]]) {
    const s = captureSize(a, b);
    assert.ok(s.width * s.height <= MAX_CAPTURE_PIXELS, `${a}x${b} -> ${s.width}x${s.height} is under the cap`);
  }
  // CONTROL: the limit is real — the unscaled 24MP photo is over it.
  assert.ok(5712 * 4284 > IOS_CANVAS_LIMIT, 'CONTROL: an unscaled 24MP photo would exceed the iOS canvas limit');
}

console.log('scanImage.test.ts: all assertions passed');
