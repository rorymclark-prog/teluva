/* mergeOcrCoverage — what the app is allowed to say after OCR has run.
 *
 * Coverage is the one number in the document reader that a bug can turn into a
 * falsehood rather than a mess. "Your lease doesn't mention that" is gated on
 * it, and that sentence is the default output of every gap: an unread page, a
 * missed synonym, a scan too faint to read. So the two directions are tested
 * separately, because they fail differently:
 *
 *   - understating coverage costs a slightly noisier answer;
 *   - overstating it lets the app deny something the document actually says.
 *
 * docText.ts is importable here despite pulling in pdfjs, because pdfThumbnail
 * loads pdfjs by dynamic import INSIDE loadPdfjs() rather than at module scope.
 */
import { mergeOcrCoverage } from './docText';
import type { DocCoverage } from '../types';

let failures = 0;
function check(cond: boolean, what: string) {
  if (!cond) failures++;
  console.log(`${cond ? '  ok' : 'FAIL'}  ${what}`);
}
const eq = (a: unknown, b: unknown, what: string) =>
  check(JSON.stringify(a) === JSON.stringify(b),
    `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`}`);

console.log('mergeOcrCoverage');

{
  // Rory's lease: nine scanned pages, no text layer anywhere, all nine OCR'd.
  const base: DocCoverage = { pagesTotal: 9, pagesWithText: 0, pagesWithoutText: [1, 2, 3, 4, 5, 6, 7, 8, 9], verifiable: true };
  const merged = mergeOcrCoverage(base, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq(merged.pagesWithText, 9, 'every OCR-read page counts as read');
  eq(merged.pagesWithoutText, [], 'and none is left reported unread');
  check(merged.verifiable === false, 'verifiable is FALSE even though every page was read — the text is a machine reading of pixels');
}

{
  // The partial read that started this: OCR came back with page 9 only.
  const base: DocCoverage = { pagesTotal: 9, pagesWithText: 0, pagesWithoutText: [1, 2, 3, 4, 5, 6, 7, 8, 9], verifiable: true };
  const merged = mergeOcrCoverage(base, [9]);
  eq(merged.pagesWithoutText, [1, 2, 3, 4, 5, 6, 7, 8], 'the eight pages OCR failed on stay named as unread');
  eq(merged.pagesWithText, 1, 'and only the one page counts as read');
}

{
  // Mixed document: a born-digital first page with a scanned annexe behind it.
  const base: DocCoverage = { pagesTotal: 5, pagesWithText: 1, pagesWithoutText: [2, 3, 4, 5], verifiable: true };
  const merged = mergeOcrCoverage(base, [2, 3, 4, 5]);
  eq(merged.pagesWithText, 5, 'text-layer pages and OCR pages add up');
  check(merged.verifiable === false, 'ONE OCR page taints the whole document — the passage shown may be that page');
}

{
  const base: DocCoverage = { pagesTotal: 9, pagesWithText: 0, pagesWithoutText: [1, 2, 3], verifiable: true };
  eq(mergeOcrCoverage(base, []), base, 'OCR that read nothing changes nothing — including leaving verifiable alone');
  eq(mergeOcrCoverage(base, [0, -2, 1.5, NaN]), base, 'garbage page numbers are ignored, not counted as pages read');
}

{
  // A page number past the stated total (a client/server disagreement) must
  // widen the total rather than produce a document that claims more read pages
  // than it has.
  const base: DocCoverage = { pagesTotal: 1, pagesWithText: 0, pagesWithoutText: [1], verifiable: true };
  const merged = mergeOcrCoverage(base, [1, 2]);
  eq(merged.pagesTotal, 2, 'the total widens to fit');
  check(merged.pagesWithText <= merged.pagesTotal, 'read pages can never exceed the total');
}

console.log(failures === 0 ? '\nAll mergeOcrCoverage tests passed.' : `\n${failures} test(s) FAILED.`);
if (failures > 0) process.exit(1);
