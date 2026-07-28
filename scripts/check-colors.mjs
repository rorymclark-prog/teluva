#!/usr/bin/env node
// Fail the build when the app uses a colour shade the theme does not define.
//
// WHY THIS EXISTS
// ---------------
// Tailwind v4 resolves `text-rosa-800` against the `@theme` block in
// src/index.css. If `--color-rosa-800` is not there, Tailwind emits **no rule at
// all** — no warning, no error. `tsc --noEmit` passes, `vite build` passes, the
// class sits in the DOM doing nothing, and the element just inherits whatever
// colour its parent had. It looks plausible, so nobody notices.
//
// That is not hypothetical here. `text-rosa-800` is the "this document has
// EXPIRED" colour in TravelPack.tsx and MemberOverview.tsx — the single visual
// cue that a passport is out of date — and it rendered with no colour at all.
// index.css already carries two written-up post-mortems of the same failure
// (ink-300, rosa-600). This script is what stops there being a third.
//
// Run:  npm run check:colors        (also runs as part of `npm run lint`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const THEME_FILE = join(SRC, 'index.css');

// Utilities that take a colour token. Deliberately excludes `shadow-` (those
// resolve against --shadow-*, not --color-*).
const UTILITIES = [
  'text', 'bg', 'border', 'divide', 'ring', 'outline', 'fill', 'stroke',
  'from', 'via', 'to', 'accent', 'caret', 'decoration', 'placeholder', 'shadow',
].join('|');

// e.g. `hover:text-rosa-600`, `bg-ink-900/40`, `border-t-cream-200`.
// The 2-3 digit shade requirement is what keeps `border-b-2` and `grid-cols-2`
// out of the results.
const CLASS_RE = new RegExp(`\\b(?:${UTILITIES})-(?:[xytrbles]-)?([a-z]+)-(\\d{2,3})\\b`, 'g');
const TOKEN_RE = /--color-([a-z]+)-(\d{2,3})\s*:/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|css|html)$/.test(entry)) out.push(p);
  }
  return out;
}

const css = readFileSync(THEME_FILE, 'utf8');

// Families the project defines itself. A family that appears in @theme is ours,
// and every shade of it that the app uses must be defined. Families that never
// appear (white, black, red, slate, …) are Tailwind built-ins and are left
// alone — those are guaranteed to exist.
const defined = new Set();
const families = new Set();
for (const m of css.matchAll(TOKEN_RE)) {
  defined.add(`${m[1]}-${m[2]}`);
  families.add(m[1]);
}

const missing = new Map();   // "rosa-800" -> Set(files)
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(CLASS_RE)) {
    const [, family, shade] = m;
    if (!families.has(family)) continue;                 // Tailwind built-in family
    const token = `${family}-${shade}`;
    if (defined.has(token)) continue;
    if (!missing.has(token)) missing.set(token, new Set());
    missing.get(token).add(relative(ROOT, file));
  }
}

const usedOwn = [...defined].filter(t => {
  // report coverage over our own families only
  return families.has(t.split('-')[0]);
});

if (missing.size === 0) {
  console.log(`✓ colour tokens OK — ${families.size} project palettes, ${usedOwn.length} shades defined, every shade used in src/ resolves.`);
  process.exit(0);
}

console.error('\n✗ Colour classes used in src/ that the @theme block does not define.');
console.error('  Tailwind emits NO CSS for these — they are silently invisible.\n');
for (const [token, files] of [...missing].sort()) {
  const list = [...files].sort();
  console.error(`  --color-${token}   used in ${list.length} file(s): ${list.slice(0, 4).join(', ')}${list.length > 4 ? ', …' : ''}`);
}
console.error(`\n  Add the missing shades to the @theme block in src/index.css`);
console.error('  (interpolate within the existing ramp — do not invent a new hue).\n');
process.exit(1);
