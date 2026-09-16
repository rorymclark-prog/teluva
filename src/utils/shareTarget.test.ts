/* Standalone assertions — npx tsx src/utils/shareTarget.test.ts
 *
 * WHAT IS BEING GUARDED, and why it needs guarding at all.
 *
 * Sharing a document into Teluva crosses four files that cannot see each
 * other: the manifest declares the target, public/sw.js (plain unbundled JS)
 * receives the POST, src/utils/sharedInbox.ts (TypeScript, compiled by Vite)
 * collects what the worker left, and server.js catches the case where the
 * worker never ran. Nothing but agreement holds them together — the worker and
 * the module literally cannot import from each other.
 *
 * And every way this breaks is SILENT. A wrong cache name, a changed path
 * prefix, a renamed header: no exception anywhere. The person taps Share,
 * picks Teluva, the app opens, and the document simply is not there. There is
 * no error to search for and no log line to find, because from each file's own
 * point of view everything worked.
 *
 * So the constants are asserted identical across the files by reading both off
 * disk, and each has a control proving the check can fail.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  SHARE_CACHE, SHARE_ENTRY_PREFIX, SHARE_FILENAME_HEADER, SHARE_FLAG,
  filenameFrom, shareOutcome, launchedFromShare,
} from './sharedInbox';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const sw = read('public/sw.js');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const server = read('server.js');

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

// ── 1. The manifest actually declares a share target ───────────────────────
const st = manifest.share_target;
check('the manifest declares a share_target', !!st);
check('it POSTs — a GET target cannot carry files at all', st.method === 'POST');
check('multipart, which is the only enctype that carries files', st.enctype === 'multipart/form-data');
check('it accepts files, not just a title and a link', Array.isArray(st.params?.files) && st.params.files.length > 0);
check('the file field is named "files", which is what sw.js reads off the form',
  st.params.files[0].name === 'files');
check('and it accepts the two things a document actually is',
  st.params.files[0].accept.includes('application/pdf')
  && st.params.files[0].accept.some((a: string) => a.startsWith('image/')));

// ── 2. The four constants agree across the files that cannot import ────────
check('sw.js uses the same cache name as sharedInbox.ts',
  sw.includes(`const SHARE_CACHE = '${SHARE_CACHE}'`));
check('sw.js stores entries under the same path prefix',
  sw.includes(`const SHARE_ENTRY_PREFIX = '${SHARE_ENTRY_PREFIX}'`));
check('sw.js writes the filename under the same header name',
  sw.includes(`const SHARE_FILENAME_HEADER = '${SHARE_FILENAME_HEADER}'`));
check('sw.js intercepts exactly the path the manifest points at',
  sw.includes(`const SHARE_TARGET_PATH = '${st.action}'`));
check('and the redirect it answers with carries the flag the app reads',
  sw.includes(`'/?${SHARE_FLAG}=1'`));

// ── 3. The interception happens BEFORE the GET guard ───────────────────────
// The fetch handler's second line is `if (request.method !== 'GET') return;`.
// A share is a POST. Put the interception after that line and it never runs —
// which is not a crash, it is a share that silently reaches the server.
const guardAt = sw.indexOf("request.method !== 'GET'");
const interceptAt = sw.indexOf("request.method === 'POST'");
check('sw.js checks for the share POST before the GET-only guard drops it',
  interceptAt > -1 && guardAt > -1 && interceptAt < guardAt);

// 303, not 302: a 302 preserves the method, so the browser would re-issue the
// navigation as a POST to "/" and the app would never load.
check('the worker redirects with 303 so the follow-up is a GET',
  /Response\.redirect\([^)]*,\s*303\s*\)/.test(sw));

// ── 4. The server catches the share the worker did not ─────────────────────
check('server.js answers POST /share-target explicitly',
  server.includes("app.post('/share-target'"));
check('it redirects rather than falling through to the SPA catch-all',
  /app\.post\('\/share-target'[\s\S]{0,200}redirect\(303/.test(server));
check('and the app can tell that case apart', server.includes(`/?${SHARE_FLAG}=lost`));

// ── 5. The filename survives, because a document called "blob" is lost ─────
const hdr = (v: string | null) => ({ headers: { get: () => v } });
check('an ordinary name comes through',
  filenameFrom(hdr(encodeURIComponent('Meldezettel 2026.pdf')), { type: 'application/pdf' }) === 'Meldezettel 2026.pdf');
check('a non-ASCII name survives the header round trip',
  filenameFrom(hdr(encodeURIComponent('Meldezettel Müller.pdf')), { type: 'application/pdf' }) === 'Meldezettel Müller.pdf');
check('a path in the name is reduced to the name',
  filenameFrom(hdr(encodeURIComponent('/Users/x/Downloads/scan.pdf')), { type: 'application/pdf' }) === 'scan.pdf');
check('a missing name still produces something with the right extension',
  filenameFrom(hdr(null), { type: 'application/pdf' }) === 'shared-document.pdf');
check('and for an image too',
  filenameFrom(hdr(null), { type: 'image/jpeg' }) === 'shared-document.jpeg');
check('a malformed encoding does not throw, it falls back',
  filenameFrom(hdr('%E0%A4%A'), { type: 'application/pdf' }) === 'shared-document.pdf');

// ── 6. Outcome parsing ─────────────────────────────────────────────────────
check('a worker-handled share reads as files', shareOutcome('?shared=1') === 'files');
check('a server-caught share reads as lost', shareOutcome('?shared=lost') === 'lost');
check('an ordinary launch reads as neither', shareOutcome('') === null);
check('an unrelated query does not look like a share', shareOutcome('?do=emergency') === null);
check('launchedFromShare is true only for the case with files',
  launchedFromShare('?shared=1') && !launchedFromShare('?shared=lost'));

// ── 7. The other two doors a file can come in by ───────────────────────────
//
// Web Share Target is Android and ChromeOS only — iOS Safari does not
// implement it, so on an iPhone Teluva never appears in the share sheet and
// none of the above ever runs. Drag-and-drop and paste are the routes that DO
// work everywhere else, which is why they are part of this feature and not a
// nice-to-have: without them the iOS answer is "leave the app, save to Files,
// come back, find it in the picker".
const vault = read('src/components/DocumentVault.tsx');

check('the vault takes a file handed to it from outside', /incomingFile\??:\s*File \| null/.test(vault));
check('the upload form can be opened already holding one', /initialFile\??:\s*File \| null/.test(vault));
check('files dropped on the vault are accepted', /onDrop=\{/.test(vault));

// dragover MUST preventDefault or the browser navigates away to display the
// dropped file, losing the page. This is the single most common reason a drop
// target silently does nothing.
check('dragover prevents the browser default that would navigate away',
  /onDragOver[\s\S]{0,400}preventDefault\(\)/.test(vault));

// A file copied in Finder or Explorer reports an EMPTY clipboard types list,
// so a paste handler keyed on types misses precisely the case it is for.
check('paste reads clipboardData.files rather than inspecting types',
  /clipboardData\?\.files/.test(vault));
check('paste is ignored while typing, so pasting into search does not open the upload form',
  /INPUT'\s*\|\|\s*tag === 'TEXTAREA'/.test(vault));

// An arriving file must be spent once. If it survives the panel closing, the
// next press of "Upload document" reopens holding a document the person
// already filed or already declined.
check('an arriving file is cleared when the upload panel closes',
  /if \(showUpload\) return;[\s\S]{0,200}setDroppedFile\(null\)/.test(vault));

// ── THE CONTROLS ───────────────────────────────────────────────────────────
//
// Checks 2 and 3 are substring searches against a file. A typo in the search
// string, or a rename in sw.js, makes them assert nothing while still passing
// — the exact way this kind of guard rots. These prove each one can fail.
{
  const drifted = sw.replace(`const SHARE_CACHE = '${SHARE_CACHE}'`, "const SHARE_CACHE = 'teluva-something-else'");
  check('CONTROL: a renamed cache in sw.js WOULD be caught',
    !drifted.includes(`const SHARE_CACHE = '${SHARE_CACHE}'`));

  const reordered = "self.addEventListener('fetch', (e) => {\n  if (request.method !== 'GET') return;\n  if (request.method === 'POST') {}\n});";
  check('CONTROL: the ordering check DOES fail when the interception moves below the guard',
    !(reordered.indexOf("request.method === 'POST'") < reordered.indexOf("request.method !== 'GET'")));

  check('CONTROL: a 302 redirect would NOT satisfy the 303 check',
    !/Response\.redirect\([^)]*,\s*303\s*\)/.test("return Response.redirect('/?shared=1', 302);"));

  check('CONTROL: a manifest with only title/text/url would fail the files check',
    !Array.isArray(({ params: { title: 'title' } } as { params: { files?: unknown[] } }).params.files));

  check('CONTROL: the dragover check DOES fail on a handler that omits preventDefault',
    !/onDragOver[\s\S]{0,400}preventDefault\(\)/.test('onDragOver={(e) => { e.dataTransfer.dropEffect = "copy"; }}'));
  check('CONTROL: and it passes on one that includes it, so it is not simply unmatchable',
    /onDragOver[\s\S]{0,400}preventDefault\(\)/.test('onDragOver={(e) => { e.preventDefault(); }}'));
  check('CONTROL: a paste handler reading .items instead of .files WOULD be caught',
    !/clipboardData\?\.files/.test('const it = e.clipboardData?.items?.[0];'));
}

console.log(`shareTarget.test.ts: ${n} assertions passed.`);
