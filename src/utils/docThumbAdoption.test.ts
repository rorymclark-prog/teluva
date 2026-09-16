// Standalone assertion tests — npx tsx src/utils/docThumbAdoption.test.ts
//
// THE BUG THIS LOCKS DOWN, because it is a whole class and not one slip.
//
// A document attached in this app is either an image or a PDF, and which one
// is not a detail the user chooses: the app's OWN scanner saves a two-sided ID
// as a PDF (the flow compiles both sides with compileImagesToPdf). So a
// passport photographed in the gallery is a JPEG and a passport scanned in the
// app is a PDF, and any thumbnail written as a bare `<img src={doc.fileData}>`
// renders the second one as the browser's broken-image glyph.
//
// That is what shipped: MemberIDs.tsx had THIRTEEN such sites and every one of
// them broke on exactly the documents the app itself produces. The owner saw
// torn-paper icons where his children's passports should have been.
//
// The galling part is that the fix already existed. PdfThumbnail.tsx renders a
// real first page and was already used correctly in six other components —
// MemberGuardians, MemberDocuments, MemberCV and others all check fileType
// before choosing a renderer. One screen simply never adopted it. That is the
// bug class worth a permanent guard: a shared component exists, most callers
// use it, and the one that does not is invisible because nothing enumerates
// the callers.
//
// DocThumb.tsx now owns the choice, so no caller has to remember it. This test
// asserts nobody reintroduces the bare-img shortcut.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const COMPONENTS = path.join(ROOT, 'src/components');

/* An <img> whose src is bound to a document's file bytes.
 *
 * Matches `fileData` specifically rather than any <img>, because plenty of
 * legitimate images (avatars, photos, rendered thumbnails that already went
 * through the type check) are perfectly fine. `fileData` is the field that can
 * hold a PDF, so it is the field that must never reach an <img> unguarded. */
const BARE_IMG_ON_FILEDATA = /<img\s+src=\{[^}]*fileData/;

/** A file is allowed to contain the pattern if it decides the type first. */
function guardsOnType(src: string): boolean {
  return /fileType[^\n]*startsWith\(\s*['"]image\//.test(src) || /isPdf/.test(src);
}

const files = fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.tsx'));
assert.ok(files.length > 20, 'sanity: the component directory was actually read');

const offenders: string[] = [];
for (const f of files) {
  if (f === 'DocThumb.tsx') continue;   // its own header quotes the bad pattern in prose
  const src = fs.readFileSync(path.join(COMPONENTS, f), 'utf8');
  if (BARE_IMG_ON_FILEDATA.test(src) && !guardsOnType(src)) offenders.push(f);
}

assert.deepStrictEqual(
  offenders, [],
  'these components render document bytes into an <img> without checking the file type first, so a '
  + 'PDF-scanned document shows as a broken image — use DocThumb instead:\n  ' + offenders.join('\n  '),
);

// MemberIDs.tsx is the screen this was found on, so it gets a named assertion
// rather than only being covered by the sweep. If someone reintroduces the
// pattern there specifically, the failure should say so by name.
{
  const memberIds = fs.readFileSync(path.join(COMPONENTS, 'MemberIDs.tsx'), 'utf8');
  assert.doesNotMatch(memberIds, BARE_IMG_ON_FILEDATA,
    'MemberIDs.tsx had 13 of these and every one broke on a document the app itself created');
  assert.match(memberIds, /DocThumb/,
    'and it must be using DocThumb — removing the <img> without replacing it would also satisfy the line above');
}

// MemberIdOverview.tsx (the "every ID number AND every document" rebuild) is
// the screen this brief was written against — it lists Section A's ID-number
// scans AND Section B's whole document list, both through DocThumb. Same
// named assertion as MemberIDs.tsx above, so a regression here says so by
// name instead of only showing up as one more path in the swept offenders list.
{
  const overview = fs.readFileSync(path.join(COMPONENTS, 'MemberIdOverview.tsx'), 'utf8');
  assert.doesNotMatch(overview, BARE_IMG_ON_FILEDATA,
    'MemberIdOverview.tsx renders both an ID scan (Section A) and every filed document (Section B) — '
    + 'a bare <img> on fileData here breaks on exactly the PDFs the app\'s own scanner produces');
  assert.match(overview, /DocThumb/,
    'and it must be using DocThumb — removing the <img> without replacing it would also satisfy the line above');
}

// ── PASS B: THE SAME BUG ONE HOP AWAY ─────────────────────────────────────
//
// The sweep above only sees `fileData` written INSIDE the img's own braces.
// That is not where the bug always lives. MemberOverview.tsx built a row as
// `{ label: 'Address', viewSrc: findAddressScan(member)?.fileData }` and then
// rendered `<img src={r.viewSrc}>` — the bytes were aliased one hop earlier,
// the img looked innocent, and the proof-of-address thumbnail broke for every
// PDF. Pass A did not catch it, which is exactly how a source guard rots into
// decoration: it keeps passing on the shape it was written against while the
// bug moves.
//
// So: collect every identifier that is assigned from an expression containing
// `fileData`, then flag any <img> whose src references one of them.

/** `const foo = …fileData…` and `foo: …fileData…` (an object-literal row). */
const ALIAS_DECL = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*fileData|([A-Za-z_$][\w$]*)\s*:\s*[^,;\n}]*fileData/g;
/** The expression inside an <img>'s src braces. */
const IMG_SRC_EXPR = /<img\s[^>]*?src=\{([^}]*)\}/g;

function aliasedOffenders(src: string): string[] {
  const aliases = new Set<string>();
  for (const m of src.matchAll(ALIAS_DECL)) {
    const name = m[1] || m[2];
    /* `fileData: doc.fileData` aliases nothing — it is the field itself being
     * passed on under its own name, and Pass A already owns that shape. */
    if (name && name !== 'fileData') aliases.add(name);
  }
  const hits: string[] = [];
  for (const m of src.matchAll(IMG_SRC_EXPR)) {
    const expr = m[1];
    for (const a of aliases) {
      if (new RegExp(`\\b${a}\\b`).test(expr)) { hits.push(`${expr.trim()} (holds ${a})`); break; }
    }
  }
  return hits;
}

const aliasOffenders: string[] = [];
for (const f of files) {
  if (f === 'DocThumb.tsx') continue;
  const src = fs.readFileSync(path.join(COMPONENTS, f), 'utf8');
  if (guardsOnType(src)) continue;
  for (const hit of aliasedOffenders(src)) aliasOffenders.push(`${f}: ${hit}`);
}

assert.deepStrictEqual(
  aliasOffenders, [],
  'these <img> tags are fed a variable that holds a document\'s bytes, so a PDF renders as a broken '
  + 'image even though the img itself does not mention fileData — pass the fileType through and use '
  + 'DocThumb:\n  ' + aliasOffenders.join('\n  '),
);

// ── THE CONTROLS ────────────────────────────────────────────────────────────
//
// The sweep asserts an EMPTY list, which a regex that matched nothing at all
// would also produce — the classic way a guard like this rots into decoration.
// These prove the pattern really does fire, and that the exemption really does
// exempt.

{
  assert.match(
    '<img src={doc.fileData} alt="" className="w-9 h-9" />',
    BARE_IMG_ON_FILEDATA,
    'CONTROL: the offending shape IS matched — without this the empty-offenders result means nothing',
  );
  assert.doesNotMatch(
    '<DocThumb src={doc.fileData} fileType={doc.fileType} />',
    BARE_IMG_ON_FILEDATA,
    'CONTROL: the correct replacement is NOT matched, so the guard does not forbid the fix',
  );
  assert.ok(
    guardsOnType("doc.fileType.startsWith('image/') ? <img src={doc.fileData} /> : <PdfThumbnail />"),
    'CONTROL: a caller that checks the type first is correctly exempted — several real components do this '
    + 'and must not be flagged',
  );
  assert.ok(
    !guardsOnType('<img src={doc.fileData} />'),
    'CONTROL: and the exemption does not fire on a file that never checks the type, which would silently '
    + 'excuse every offender',
  );
}

// Controls for Pass B. The one that matters is a verbatim reconstruction of
// MemberOverview.tsx's real shape before the fix — if this stops matching, the
// pass has stopped catching the bug it was written for.
{
  const memberOverviewBefore = `
    const rows: { label: string; viewSrc?: string }[] = [];
    if (member.address) rows.push({ label: 'Address', viewSrc: findAddressScan(member)?.fileData });
    return <img src={r.viewSrc} alt="" className="w-full h-full object-cover" />;
  `;
  assert.deepStrictEqual(
    aliasedOffenders(memberOverviewBefore).length, 1,
    'CONTROL: the real pre-fix MemberOverview shape IS caught — this is the case pass A missed',
  );
  assert.doesNotMatch(
    memberOverviewBefore, BARE_IMG_ON_FILEDATA,
    'CONTROL: and pass A genuinely does NOT catch it, which is the whole reason pass B exists',
  );
  assert.deepStrictEqual(
    aliasedOffenders(`
      const rows = [{ label: 'Address', viewSrc: scan?.fileData, viewType: scan?.fileType }];
      return <DocThumb src={r.viewSrc} fileType={r.viewType} size="w-full h-full" />;
    `),
    [],
    'CONTROL: the fixed shape is clean — pass B must not forbid the correct code',
  );
  assert.deepStrictEqual(
    aliasedOffenders('<img src={member.photo} alt="" />'),
    [],
    'CONTROL: an img fed something that never touched fileData is left alone, so this does not '
    + 'degrade into "no <img> anywhere"',
  );
}

console.log(`docThumbAdoption.test.ts: all assertions passed (${files.length} components swept)`);
