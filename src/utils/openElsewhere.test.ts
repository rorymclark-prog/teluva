import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileExtensionFor } from './share';

/**
 * "If we open a lease or any legal doc we must have the choice to open it in
 * ChatGPT or whatever AI app we have downloaded on that device."
 *
 * Two halves. The file has to ARRIVE as what it is — a lease named .jpg is
 * refused or read as a broken image — and the action has to be findable and
 * honest about the fact that the file leaves.
 */
let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

/* ── THE EXTENSION ────────────────────────────────────────────────────────
 * The old code was `blob.type.split('/')[1] || 'jpg'`. Storage serves plenty
 * of blobs with no content-type at all, and every one of them became .jpg. */
check('a PDF blob is a .pdf', fileExtensionFor('Lease', 'application/pdf') === 'pdf');
check('a content-type with a charset still resolves',
  fileExtensionFor('Notes', 'text/plain; charset=utf-8') === 'txt');
check('a name that already carries the extension wins over the MIME type',
  fileExtensionFor('lease.pdf', 'application/octet-stream') === 'pdf');
check('an empty content-type falls back to the URL, not to jpg',
  fileExtensionFor('Lease', '', 'https://x/y/lease-2026.pdf?token=abc') === 'pdf');
check('and only then to a guess',
  fileExtensionFor('Lease', '', 'https://x/y/blob') === 'jpg');
check('jpeg is normalised to jpg everywhere it can appear',
  fileExtensionFor('x.jpeg', '') === 'jpg' && fileExtensionFor('x', 'image/jpeg') === 'jpg');
check('a query string is not mistaken for an extension',
  fileExtensionFor('Lease', '', 'https://x/y/file?alt=media&v=2.png') === 'jpg');
check('word documents survive the trip',
  fileExtensionFor('Contract', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') === 'docx');

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const share = read('src/utils/share.ts');
const helper = read('src/utils/openElsewhere.ts');
const viewer = read('src/components/DocumentViewer.tsx');
const ask = read('src/components/DocumentAskModal.tsx');

check('the file name never doubles its extension',
  /endsWith\(`\.\$\{ext\}`\) \? safe :/.test(share));
check('a PDF with no blob type is still typed as a PDF for the receiving app',
  /ext === 'pdf' \? 'application\/pdf'/.test(share));

/* ── SAYING IT LEAVES ─────────────────────────────────────────────────────
 * This is the one place in the app where a document deliberately goes
 * somewhere Teluva does not control. It must be said in words. */
check('the user is told the file leaves before it does',
  /out of Teluva to whichever app you pick/.test(helper));
check('and told that the other app\'s rules apply, not ours',
  /covered by their rules, not ours/.test(helper));
check('and warned that a will or a passport is a different decision',
  /will, a passport or anything medical/.test(helper));
/* Asked ONCE. A dialog somebody dismisses on reflex protects nobody. */
check('the warning is once a session, not once a tap',
  /acknowledgedThisSession = true;/.test(helper) && /if \(!acknowledgedThisSession\)/.test(helper));
check('and it resets between accounts', /export function resetOpenElsewhereConsent/.test(helper));

/* appConfirm, never window.confirm: in a webview window.confirm returns false
 * with NO dialog, so the action would silently never happen. */
/* Strip the comments: the file EXPLAINS why window.confirm is wrong here, and
 * a bare grep flagged its own explanation. */
const helperCode = helper.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('the confirmation uses appConfirm, not window.confirm',
  /appConfirm\(/.test(helperCode) && !/window\.confirm/.test(helperCode));

/* A share sheet that cannot take files would send the title alone and look
 * like it worked. Saying "unavailable" is better than sending nothing. */
check('a browser that cannot share files reports it instead of sending a title',
  /return 'unavailable';/.test(helper) && !/text: name/.test(helper));

/* ── FINDABLE ─────────────────────────────────────────────────────────────
 * The mechanism already existed behind a button labelled "Share". The feature
 * is the label. */
check('the viewer names the apps rather than saying "Share"',
  /Open in ChatGPT, Claude or another app/.test(viewer));
check('the ask sheet offers it too, where the legal boundary is stated',
  /Open it in ChatGPT or another app/.test(ask));
/* But it must not read as an alternative to a qualified person — that whole
 * footer exists to route legal questions to one. */
check('and it is offered after the qualified-person route, not instead of it',
  ask.indexOf('Who can actually answer this') < ask.indexOf('Open it in ChatGPT or another app'));
check('the button is hidden where there is no share sheet at all',
  /canOpenElsewhere && \(/.test(viewer) && /canOpenElsewhere \? handOver : undefined/.test(ask));

console.log(`openElsewhere.test.ts: ${n} assertions passed.`);
