/* Tests for the OCR path of the document reader.
 *
 * Two things are worth testing here and they are not the OCR itself (that is
 * Google's model, and mocking it would only test the mock):
 *
 *  1. THE SECURITY BOUNDARY. The server holds admin credentials for the whole
 *     bucket and the object path arrives from the client. isAllowedPath is the
 *     only thing standing between that and one family reading another's
 *     documents by asking politely.
 *
 *  2. THE HONESTY OF COVERAGE. Every "we cannot claim a negative" branch in the
 *     UI is driven by what buildOcrCoverage reports. A page OCR skipped, or
 *     read too faintly to trust, must come back as a page we did NOT read —
 *     because an unread page is named out loud and blocks "your lease doesn't
 *     mention that", whereas a badly-read page silently answers wrong.
 */
import {
  ocrKind,
  isAllowedPath,
  pageBatches,
  pageFromVisionResponse,
  buildOcrCoverage,
  OCR_MIN_PAGE_CONFIDENCE,
  OCR_MAX_PAGES,
} from './docOcr.mjs';

let failures = 0;
function check(cond, what) {
  if (!cond) failures++;
  console.log(`${cond ? '  ok' : 'FAIL'}  ${what}`);
}
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`}`);

const FID = 'fam_abc123';

console.log('isAllowedPath — the security boundary');
check(isAllowedPath(`families/${FID}/documents/d1/lease.pdf`, FID), 'own family path allowed');
check(!isAllowedPath('families/fam_someone_else/documents/d1/lease.pdf', FID), "another family's path refused");
check(!isAllowedPath(`families/${FID}x/documents/d1.pdf`, FID), 'a family id that merely starts the same is refused');
check(!isAllowedPath(`families/${FID}/../fam_other/x.pdf`, FID), 'traversal refused outright, not normalised');
check(!isAllowedPath(`/families/${FID}/x.pdf`, FID), 'absolute path refused');
check(!isAllowedPath('', FID), 'empty path refused');
check(!isAllowedPath(`families/${FID}/x.pdf`, ''), 'missing family id refuses everything');
check(!isAllowedPath(`families/${FID}/x.pdf`, undefined), 'undefined family id refuses everything');

console.log('\nocrKind — what we can and cannot turn into pixels');
eq(ocrKind('application/pdf'), 'file', 'pdf goes to the file endpoint');
eq(ocrKind('image/jpeg'), 'image', 'a phone photo goes to the image endpoint');
eq(ocrKind('image/tiff'), 'file', 'tiff is multi-page, so the file endpoint');
eq(ocrKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), null, 'a Word file has no pixels to read');
eq(ocrKind(''), null, 'a missing type is not guessed at');

console.log('\npageBatches — Vision takes at most five pages per request');
eq(pageBatches(3), [[1, 2, 3]], 'a short document is one request');
eq(pageBatches(9), [[1, 2, 3, 4, 5], [6, 7, 8, 9]], "Rory's nine-page lease is two requests");
eq(pageBatches(0), [], 'no pages means no requests');
check(pageBatches(500).flat().length === OCR_MAX_PAGES, 'a huge document is capped, not read forever');

console.log('\npageFromVisionResponse — a page we cannot trust is a page we did NOT read');
eq(
  pageFromVisionResponse({ fullTextAnnotation: { text: '§ 8 Erhaltung', pages: [{ confidence: 0.93 }] }, context: { pageNumber: 4 } }, 1),
  { n: 4, text: '§ 8 Erhaltung', confidence: 0.93 },
  'a confident page comes back with its real page number',
);
eq(pageFromVisionResponse({ error: { message: 'boom' } }, 2), null, 'an errored page is unread');
eq(pageFromVisionResponse({ fullTextAnnotation: { text: '   ' } }, 2), null, 'whitespace-only is unread, not empty text');
eq(
  pageFromVisionResponse({ fullTextAnnotation: { text: 'blurry', pages: [{ confidence: OCR_MIN_PAGE_CONFIDENCE - 0.01 }] } }, 2),
  null,
  'a page read too faintly to trust is unread rather than read badly',
);
check(
  pageFromVisionResponse({ fullTextAnnotation: { text: 'fine', pages: [{}] } }, 7)?.n === 7,
  'a missing (optional) confidence does not throw away a good read',
);

console.log('\nbuildOcrCoverage — what the UI is allowed to say');
{
  const cov = buildOcrCoverage([{ n: 1, text: 'a' }, { n: 3, text: 'c' }], 4);
  eq(cov.pagesWithText, 2, 'counts only pages we actually read');
  eq(cov.pagesWithoutText, [2, 4], 'names every page we did not');
  check(cov.verifiable === false, 'OCR coverage is NEVER verifiable — this is what badges every passage');
}
{
  const cov = buildOcrCoverage([], 9);
  eq(cov.pagesWithText, 0, 'a scan we could not read at all reports zero pages');
  eq(cov.pagesWithoutText.length, 9, 'and names all nine');
}
{
  // A page number beyond the stated total (Vision reporting more than the
  // client counted) must widen the total rather than be dropped or produce a
  // negative-length unread list.
  const cov = buildOcrCoverage([{ n: 1, text: 'a' }, { n: 2, text: 'b' }], 1);
  eq(cov.pagesTotal, 2, 'the total widens to fit the pages actually returned');
  eq(cov.pagesWithoutText, [], 'and nothing is reported unread');
}

console.log(failures === 0 ? '\nAll docOcr tests passed.' : `\n${failures} docOcr test(s) FAILED.`);
if (failures > 0) process.exit(1);
