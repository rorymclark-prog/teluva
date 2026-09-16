import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hero = readFileSync('src/components/StepHero.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

// The phone layout. Measured on the live build at 375px: beside the 40px badge
// and its 12px gap the headline had 211px, and the guided-setup resume title
// ("Welcome back — you're partway through") broke to three ragged lines with
// "Welcome" alone on the first. Dropping it to its own full-width row gives it
// 263px and two clean lines. A future tidy-up that folds the title back into
// the badge's column re-creates the wrap, silently.
assert.match(hero, /grid grid-cols-\[2\.5rem_minmax\(0,1fr\)\]/, 'the hero head is a grid, so the title can leave the badge column');
assert.match(hero, /col-span-2 sm:col-span-1 sm:col-start-2/, 'the title spans both columns on phones and returns to column two from sm up');
assert.match(hero, /text-balance/, 'balance still does the fine work once the width is there');

// One h3, one id: the dialog's aria-labelledby points at it. A responsive
// layout done by rendering the title twice would hand two elements the same id.
assert.equal((hero.match(/<h3/g) || []).length, 1, 'exactly one title element');
assert.equal((hero.match(/id=\{titleId\}/g) || []).length, 1, 'exactly one titleId');

// The eyebrow's gradient is painted with background-clip on the element's own
// box, so it must keep shrink-wrapping — as a grid item it would otherwise
// stretch to the column and show a different slice of the ramp per step.
assert.match(css, /\.step-eyebrow \{[^}]*width: fit-content/s, '.step-eyebrow must stay fit-content');
assert.doesNotMatch(hero, /step-eyebrow"[^>]*\stext-/, 'never put a text-* utility on .step-eyebrow — it repaints the glyphs opaque');

console.log('StepHero.test.ts: all assertions passed');
