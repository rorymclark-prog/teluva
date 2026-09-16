/**
 * Every capitalised JSX tag in src/ must resolve to something this file
 * imports or declares.
 *
 * THE BUG THIS EXISTS FOR (found 2026-08-29, live since v330). Dashboard.tsx
 * rendered `<Lock className="w-4 h-4" />` in the notice an employee sees on
 * the Team screen of a business space — and never imported `Lock` from
 * lucide-react. It did not fail to compile. `lib.dom.d.ts` declares
 * `var Lock` (the Web Locks API interface, line ~15539), so the identifier
 * resolved to a real global and `npx tsc --noEmit` exited 0. Vite happily
 * emitted `jsx(Lock, {...})` into the production bundle, where React saw a
 * constructor, treated it as a class component, called `new Lock()` and got
 * "Illegal constructor" — which unmounts the WHOLE app, not just the icon.
 * Result: every non-admin employee who tapped Team got a white screen, on
 * the exact screen built to reassure them, for five versions.
 *
 * Neither of the two gates could see it: the type checker because the name
 * genuinely exists, and the eye because the diff looks like every other icon
 * line. That is what makes it worth a test rather than a fix alone.
 *
 * The collision surface is not one name. lucide-react also exports `Image`,
 * `Text`, `Option`, `Range`, `Selection`, `Notification`, `Navigation`,
 * `History` and `Table` — all of which are, or shadow, DOM globals too. Any
 * of them forgotten in an import list fails exactly the same way.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const srcDir = join(root, 'src');
let checks = 0;
const check = (label: string, fn: () => void) => { fn(); checks++; if (process.env.VERBOSE) console.log('  ✓', label); };

const files = readdirSync(srcDir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
  .map((e) => join(e.parentPath ?? srcDir, e.name));

check('there are .tsx files to scan at all', () => {
  assert.ok(files.length > 50, `only found ${files.length} .tsx files — the scan is not reaching src/`);
});

/**
 * Strip comments and string/template literals before scanning. Without this
 * the scan trips on prose: AccountLoadError.tsx's header comment says "must
 * never be replaced with <FamilyOnboarding />", which is a sentence, not a
 * render.
 */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/**
 * A JSX open tag, NOT a generic type argument. The discriminator is the
 * character before "<": `useState<HTMLInputElement>` and `Record<K, V>` put
 * an identifier char, `>` or `]` there; a JSX tag never does.
 */
function jsxTags(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/(^|[^A-Za-z0-9_$>\]])<([A-Z][A-Za-z0-9_]*)(\s[^<>]*)?\/?>/g)) out.add(m[2]);
  for (const m of src.matchAll(/(^|[^A-Za-z0-9_$>\]])<([A-Z][A-Za-z0-9_]*)\s+[a-z]/g)) out.add(m[2]);
  return out;
}

function isDeclared(name: string, src: string): boolean {
  return new RegExp(
    `import[^;]*\\b${name}\\b[^;]*from` +          // any import form
    `|\\b(const|let|var|function|class|enum)\\s+${name}\\b` +
    `|:\\s*${name}\\s*[,}]` +                       // destructured rename: ({ icon: Icon })
    `|\\b${name}\\s*[,}]\\s*=\\s*`,
  ).test(src);
}

const offenders: string[] = [];
for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const src = strip(raw);
  for (const name of jsxTags(src)) {
    if (!isDeclared(name, raw)) offenders.push(`${file.replace(root, '')}: <${name} …>`);
  }
}

check('every JSX component resolves to an import or a local declaration', () => {
  assert.deepStrictEqual(
    offenders,
    [],
    'JSX tag with no import and no local declaration. If the name is also a DOM global ' +
      '(Lock, Image, Text, Option, Range, Selection, Notification, Table…) this COMPILES ' +
      'and white-screens at runtime. Add the missing import:\n  ' + offenders.join('\n  '),
  );
});

/** The specific regression, named, so a future import-list tidy-up can't quietly drop it again. */
check('Dashboard.tsx imports Lock from lucide-react', () => {
  const src = readFileSync(join(srcDir, 'components', 'Dashboard.tsx'), 'utf8');
  const usesLock = /(^|[^A-Za-z0-9_$>\]])<Lock[\s/>]/.test(strip(src));
  if (!usesLock) return; // the notice was removed — nothing to guard
  const imported = /import\s*\{[^}]*\bLock\b[^}]*\}\s*from\s*'lucide-react'/s.test(src);
  assert.ok(imported, 'Dashboard.tsx renders <Lock> but does not import it from lucide-react');
});

/** The scan must actually be looking at Dashboard.tsx, not an empty list. */
check('the scan reaches the file the bug was in', () => {
  assert.ok(
    files.some((f) => f.endsWith(join('components', 'Dashboard.tsx'))),
    'Dashboard.tsx is not in the scanned set',
  );
});

console.log(`jsxComponents: ${checks} checks passed`);
