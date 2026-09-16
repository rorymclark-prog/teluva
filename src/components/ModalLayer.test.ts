/* Modal layer vs. the Ember shell.
 *
 * Two phone bugs, one root each:
 *
 *  1. The scanner opened from the chat had its buttons cut off with nothing to
 *     scroll. The chat panel is `.glass` (backdrop-filter), which makes it the
 *     containing block for `position: fixed` descendants — the overlay's
 *     `inset-0` resolved to the SHEET, not the viewport, and the sheet's
 *     overflow-hidden clipped the footer. Only a portal escapes that.
 *  2. Ember's phone furniture (nav z-60, Capture/Appearance pills z-61, the
 *     assistant launcher z-61) all outrank the z-50 modal layer, so the
 *     launcher's close X sat on top of the scanner's "Save as". The lock hook
 *     now flags an open modal and the chrome stands down — except for the
 *     first-run tour, which spotlights that very furniture.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');
const lock = read('src/hooks/useBodyScrollLock.ts');
const css = read('src/index.css');
const scanner = read('src/components/DocumentScannerModal.tsx');
const ask = read('src/components/DocumentAskModal.tsx');
const lightbox = read('src/components/ImageLightbox.tsx');
const bubble = read('src/components/AssistantBubble.tsx');
const tour = read('src/components/FirstRunTour.tsx');

// --- the flag itself -------------------------------------------------------
assert.match(lock, /dataset\.modalOpen = '1'/, 'the lock must flag an open modal layer');
assert.match(lock, /delete document\.documentElement\.dataset\.modalOpen/, 'the flag must be cleared again');
assert.match(lock, /let modalCount = 0/, 'modal marking is counted separately from the scroll lock');
assert.match(lock, /if \(modalCount === 0\) delete/, 'stacked modals must clear the flag exactly once');
assert.match(lock, /options\?: \{ keepChrome\?: boolean \}/, 'overlays must be able to keep the shell furniture');

// --- the chrome yields -----------------------------------------------------
assert.match(css, /^\[data-modal-open\] \.ember-mobile-nav,/m);
assert.doesNotMatch(css, /ember-appearance-mobile/,
  'the floating Appearance pill is gone — Appearance lives in the hub menu');
assert.match(css, /^\[data-modal-open\] \.assistant-launcher \{ display: none; \}/m,
  'the launcher must stand down while a modal is open — its X sat on the scanner buttons');
assert.match(css, /\[data-assistant-open\] \.ember-app \.assistant-launcher \{\s*bottom: max\(\.65rem, env\(safe-area-inset-bottom\)\);/,
  'with the chat open the launcher drops to the freed bottom strip, off the composer');

// --- modals opened from the chat escape its backdrop-filter ----------------
for (const [name, src] of [['scanner', scanner], ['reader', ask], ['lightbox', lightbox]] as const) {
  assert.match(src, /import \{ createPortal \} from 'react-dom'/, `${name} must import createPortal`);
  assert.match(src, /return createPortal\(/, `${name} must render through a portal`);
  assert.match(src, /\n {4}document\.body,\n {2}\);/, `${name} must portal to <body>, not a nearer node`);
}

// --- and the chat survives them --------------------------------------------
assert.match(bubble, /if \(modalUp\(\)\) return;/,
  'a tap inside a portalled modal must not read as "clicked outside the chat"');
assert.match(bubble, /'Escape' && !modalUp\(\)/, 'Esc belongs to the top-most layer');

// --- the tour keeps what it points at --------------------------------------
assert.match(tour, /useBodyScrollLock\(status === 'active', \{ keepChrome: true \}\)/,
  'the tour spotlights the launcher and section menu — it must not hide them');

// --- there is always a way OUT of the lightbox ------------------------------
// Reported live: "if i try minimise this photo it doesnt work / i have to click
// off the modal". The picture swallowed its own click, so the one gesture every
// photo viewer answers to did nothing, and a photo sized to the viewport leaves
// almost no backdrop to hit instead. Assert the two escapes that do not depend
// on hitting a 40px target in a corner.
assert.match(lightbox, /onClick=\{onClose\}\n\s*className="max-w-\[92vw\]/,
  'the photo itself must close the lightbox, not stopPropagation');
assert.match(lightbox, /e\.key === 'Escape'/, 'Escape must close the lightbox');
assert.match(lightbox, /window\.addEventListener\('keydown', onKey\)/,
  'the Escape handler must actually be bound');
assert.match(lightbox, /window\.removeEventListener\('keydown', onKey\)/,
  'and unbound — a lightbox opened twice must not stack handlers');
// The PDF branch keeps stopPropagation on purpose: it is a document you scroll
// and click inside, so a stray click must not dismiss it.
assert.match(lightbox, /<iframe[\s\S]{0,400}?\n\s*\)/,
  'the PDF branch still exists');
assert.match(lightbox, /onClick=\{\(e\) => e\.stopPropagation\(\)\}\n\s*style=\{\{ width: 'min\(92vw, 850px\)'/,
  'the PDF must NOT close on click — you interact with it');

console.log('ModalLayer.test.ts: all assertions passed');
