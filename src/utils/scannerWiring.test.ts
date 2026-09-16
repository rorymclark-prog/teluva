// Standalone assertion tests — npx tsx src/utils/scannerWiring.test.ts
//
// SOURCE-TEXT GUARDS, and the reason they are worth having here: the scanner
// is the one feature in this app that cannot be exercised without a camera and
// a hand. Nothing in the Node suite can photograph a birth certificate, so the
// pieces that were just added to fix a genuinely bad scanner — a second corner
// detector, a rotate control, tone enhancement, and a compressor that spends
// its byte budget instead of rationing it — have no runtime test that would
// notice if a refactor quietly dropped one.
//
// A source check is a weak test, so each one below is paired with a CONTROL
// that proves the pattern can actually fail to match. Without the control a
// reflow, a rename, or a stray comment silently disables the guard and it goes
// on reporting green forever — see the house note on this in
// docReadEligibility.test.ts.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MODAL = fs.readFileSync(path.join(ROOT, 'src/components/DocumentScannerModal.tsx'), 'utf8');
const PIPELINE = fs.readFileSync(path.join(ROOT, 'src/utils/scanPipeline.ts'), 'utf8');
const LIVE_HOOK = fs.readFileSync(path.join(ROOT, 'src/hooks/useLiveQuad.ts'), 'utf8');
const VITE = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// ── the second corner detector ──────────────────────────────────────────────
//
// The complaint that started this: corners come out wrong and the page is
// warped to fit them, so a straight document is stored distorted. The classical
// Canny detector cannot see a pale certificate on a pale desk; scanic's
// DocCornerNet can. The fallback is what fixes it, and it is easy to delete by
// accident because the happy path works fine without it.

{
  // The detectors live in scanPipeline.ts now (the modal is UI). Pin both ends:
  // the pipeline still has the ML fallback, and the modal still goes through
  // the pipeline rather than calling scanic directly.
  assert.match(MODAL, /import \{[^}]*\bdetectPage\b[^}]*\} from '\.\.\/utils\/scanPipeline'/,
    'the modal must detect through scanPipeline.detectPage — the verified path with the ML fallback and the edge checks');
  assert.match(MODAL, /await detectPage\(/, 'and actually call it, not merely import it');
  assert.match(PIPELINE, /detector:\s*'ml'/,
    'the ML corner detector must still be reachable — without it a low-contrast page falls straight to manual cropping');
  assert.match(PIPELINE, /ml:\s*\{\s*assetBaseUrl:\s*SCANIC_ML_ASSETS,\s*threaded:\s*false\s*\}/,
    'it must load from our own origin, not scanic\'s default CDN, and single-threaded: threads need '
    + 'SharedArrayBuffer, which needs COOP/COEP headers this app does not send — asking for them fails to '
    + 'initialise rather than running slowly');

  // The classical pass must still come FIRST. If someone "simplifies" this to
  // ML-only, every scan pays a 3.4MB model download before its first result.
  // Matched on the CALL, not the option name, which also appears in comments.
  const CLASSICAL_CALL = /scanDocument\(canvas,\s*\{\s*mode:\s*'detect',\s*minDocumentCoverageRatio/;
  const classicalAt = PIPELINE.search(CLASSICAL_CALL);
  const mlAt = PIPELINE.indexOf("detector: 'ml'");
  assert.ok(classicalAt > 0 && mlAt > classicalAt,
    'the classical detector runs first; the model is only downloaded by shots that were about to come out wrong');

  // THE CONTROLS: prove these patterns are specific enough to fail. If
  // `detector: 'ml'` matched loosely, a file that never mentioned it would
  // also pass and the guard would be decorative.
  assert.doesNotMatch('const x = 1;\n// detector ml\n', /detector:\s*'ml'/,
    'CONTROL: the detector pattern does not match prose that merely says the words');
  assert.doesNotMatch('ml: { assetBaseUrl: SCANIC_ML_ASSETS, threaded: true }',
    /ml:\s*\{\s*assetBaseUrl:\s*SCANIC_ML_ASSETS,\s*threaded:\s*false\s*\}/,
    'CONTROL: a threaded ML config does not satisfy the guard');
  assert.doesNotMatch("import { extractPage } from '../utils/scanPipeline';",
    /import \{[^}]*\bdetectPage\b[^}]*\} from '\.\.\/utils\/scanPipeline'/,
    'CONTROL: importing something else from the pipeline does not count as detecting through it');
  assert.equal('// minDocumentCoverageRatio defaults to 0.04'.search(CLASSICAL_CALL), -1,
    'CONTROL: a comment naming the option is not mistaken for the classical call');
}

// ── the live viewfinder ─────────────────────────────────────────────────────
//
// Live detection runs off the main thread, and never fires in the dark: a
// near-black frame can still produce a confident-looking quad from sensor
// noise, and an auto-capture of it is a blank page.

{
  const WORKER_URL = /new Worker\(new URL\('\.\.\/workers\/liveQuad\.worker\.ts', import\.meta\.url\)/;
  const DARK_RESETS_RUN = /meanLuma\(img\.data\) < MIN_FRAME_BRIGHTNESS\)\s*\{\s*historyRef\.current = \[\];/;
  assert.match(LIVE_HOOK, WORKER_URL,
    'live detection must run in the worker — on the main thread a 640px detect several times a second makes the viewfinder stutter');
  assert.match(LIVE_HOOK, /export const MIN_FRAME_BRIGHTNESS = 35;/, 'the dark-frame threshold stays at 35');
  assert.match(LIVE_HOOK, DARK_RESETS_RUN,
    'a dark frame must skip detection AND reset the stability run, so it can never contribute to an auto-capture');
  assert.match(LIVE_HOOK, /meanLuma\(frame, 1\) < MIN_FRAME_BRIGHTNESS\)\s*\{\s*stillCountRef\.current = 0;/,
    'and the same in the stillness fallback');
  assert.match(MODAL, /useLiveQuad\(videoRef,/, 'the modal must actually use the live detector');
  // CONTROLS
  assert.doesNotMatch('if (meanLuma(img.data) < MIN_FRAME_BRIGHTNESS) {\n  setState(dark);', DARK_RESETS_RUN,
    'CONTROL: a dark check that does not reset the run does not satisfy the guard');
  assert.doesNotMatch("new Worker('/liveQuad.js')", WORKER_URL,
    'CONTROL: a worker from some other URL does not satisfy the guard');
}

// ── several pages share one budget ──────────────────────────────────────────

{
  const PER_PAGE_FIT = /const perPage = pageByteBudget\(all\.length\);[\s\S]{0,400}fitToBudget\(all\[i\], \{ maxBytes: perPage \}\)/;
  assert.match(MODAL, PER_PAGE_FIT,
    'each page must be fitted to its share of the record — fitting every page to the whole 700KB and '
    + 'compiling them produces a PDF the sync layer refuses');
  assert.doesNotMatch('const perPage = pageByteBudget(all.length);\nconst f = await fitToBudget(all[i]);', PER_PAGE_FIT,
    'CONTROL: fitting a page to the default (whole) budget does not satisfy the guard');
}

// ── the other ways in stay on screen ────────────────────────────────────────

{
  const UPLOAD_ACCEPT = /accept="application\/pdf,image\/\*"/;
  assert.match(MODAL, /capture="environment"/,
    'the camera-app route (the only full-resolution still on an iPhone, where Safari has no ImageCapture) must stay');
  assert.match(MODAL, /Already scanned it with your iPhone \(Notes, Files\) or a Mac \(Preview\)\?/,
    'and the upload route for a scan made with Apple\'s own scanner');
  assert.match(MODAL, UPLOAD_ACCEPT, 'which takes PDFs and photos');
  // Never promise what has not been verified: Safari's file picker is not
  // documented to offer "Scan Documents", so the copy must not claim it.
  assert.doesNotMatch(MODAL, /Scan Documents/, 'no claim that the file picker offers Scan Documents');
  assert.doesNotMatch('accept="image/*"', UPLOAD_ACCEPT, 'CONTROL: an image-only picker does not satisfy the upload guard');
}

// ── the model is served from our own origin ─────────────────────────────────

{
  assert.match(VITE, /copyScanicMlAssets/,
    'the build must copy the model into public/ — otherwise the ML detector 404s and silently never helps');
  assert.match(VITE, /plugins:\s*\[[^\]]*copyScanicMlAssets\(\)/,
    'and the plugin must actually be REGISTERED, not merely defined — a defined-but-unused plugin is the '
    + 'exact shape of a fix that looks done and does nothing');
  assert.doesNotMatch(MODAL + PIPELINE + LIVE_HOOK, /cdn\.jsdelivr\.net/,
    'no third-party CDN request at the moment someone is photographing a passport');

  // CONTROL for the registration check, which is the subtle one: prove the
  // pattern distinguishes a registered plugin from a defined one.
  assert.doesNotMatch('function copyScanicMlAssets() {}\nplugins: [react()],', /plugins:\s*\[[^\]]*copyScanicMlAssets\(\)/,
    'CONTROL: a plugin that is defined but left out of the plugins array does NOT satisfy the check');
}

// ── WASM is allowed to compile ──────────────────────────────────────────────
//
// Both detectors are WebAssembly, and WASM compilation is governed by
// script-src. This is report-only today, so a missing directive breaks nothing
// yet — which is precisely why it needs a test: the day the policy is enforced
// is the day the scanner stops working, and nothing would connect the two.

{
  assert.match(SERVER, /'wasm-unsafe-eval'/,
    'script-src must permit WebAssembly compilation or both corner detectors die when CSP stops being report-only');
  assert.doesNotMatch(SERVER, /script-src[^,]*'unsafe-eval'[^-]/,
    'and it must be wasm-unsafe-eval specifically — plain unsafe-eval would re-open eval() for scripts');
}

// ── rotation ────────────────────────────────────────────────────────────────

{
  assert.match(MODAL, /rotateDataUrl\(pristinePhoto,\s*turns\)/,
    'rotation must be derived from the PRISTINE capture and the cumulative turn count — '
    + 'rotating the previous result re-encodes the JPEG on every tap');
  assert.match(MODAL, /aria-label="Rotate left"/, 'the rotate controls are icon-only and must carry names');
  assert.match(MODAL, /aria-label="Rotate right"/);

  // THE CONTROL. The first assertion is the load-bearing one and it would pass
  // just as happily against `rotateDataUrl(capturedPhoto, turns)` if the
  // pattern were loose. Prove it is not.
  assert.doesNotMatch('await rotateDataUrl(capturedPhoto, turns)', /rotateDataUrl\(pristinePhoto,\s*turns\)/,
    'CONTROL: rotating the DISPLAYED image instead of the pristine one does not satisfy the guard');
}

// ── enhancement, and the escape hatch ───────────────────────────────────────

{
  assert.match(MODAL, /enhanceDataUrl\(/, 'captures must go through the enhancement pass');
  assert.match(MODAL, /enhanceMode === 'off'/,
    "'Original' must stay a genuine bypass — these are irreplaceable documents, and someone who thinks the "
    + 'processing ate a faint stamp needs the untouched pixels');
  assert.match(MODAL, /\{\s*mode:\s*'off',\s*label:\s*'Original'\s*\}/,
    'and the bypass must be REACHABLE — a mode with no entry in the picker is not an escape hatch');
  // CONTROL: prove that pattern needs the mode AND a label, so an entry that
  // was reduced to a bare mode string would not satisfy it.
  assert.doesNotMatch("[{ mode: 'off' }]", /\{\s*mode:\s*'off',\s*label:\s*'Original'\s*\}/,
    'CONTROL: a mode with no label does not count as a reachable control');
}

// ── the byte budget is spent, not rationed ──────────────────────────────────
//
// The old path compressed once at a fixed 1600px/0.82 and, if that still did
// not fit, threw the capture away and told the person to go and photograph the
// document again with "less background in the frame". Both halves were wrong.

{
  assert.match(MODAL, /fitToBudget\(/, 'saving must walk the quality/size ladder rather than using one fixed setting');
  assert.doesNotMatch(MODAL, /compressImageToAvatar/,
    'the fixed 1600px/0.82 compressor must be gone from this path — it pinned every scan to what the worst case needed');
  assert.doesNotMatch(MODAL, /retake with less background/,
    'and the error that asked the user to solve a problem the code can solve must be gone with it');
}

console.log('scannerWiring.test.ts: all assertions passed');
