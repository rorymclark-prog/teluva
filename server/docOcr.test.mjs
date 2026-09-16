/* Tests for the OCR path of the document reader.
 *
 * Three things are worth testing here, and none of them is the OCR itself
 * (that is Google's model, and mocking it would only test the mock):
 *
 *  1. THE SECURITY BOUNDARY. The server holds admin credentials for the whole
 *     bucket and the object path arrives from the client. isAllowedPath is the
 *     only thing standing between that and one family reading another's
 *     documents by asking politely.
 *
 *  2. WHAT WE ACCEPT FROM THE CLIENT. Page images are rendered in the browser
 *     and posted here, so validateOcrImages is handling untrusted input that we
 *     then forward to a paid API on the user's behalf.
 *
 *  3. A PAGE WE CANNOT TRUST IS A PAGE WE DID NOT *VOUCH FOR* — which is not
 *     the same as a page whose words we throw away. pageFromVisionResponse
 *     returns a doubtful page FLAGGED (lowConfidence), and coverage keeps it
 *     out of the read-page list so it still blocks "your lease doesn't mention
 *     that". Until v345 it returned null instead, and the result was the app
 *     telling people a card they can read perfectly came back blank.
 *
 *  4. WE READ BOTH VISION ANNOTATIONS. DOCUMENT_TEXT_DETECTION populates
 *     fullTextAnnotation for dense pages and can leave it empty for a photo of
 *     a card, where the whole text sits in textAnnotations[0] instead.
 */
import {
  textFromVisionResponse,
  ocrKind,
  isAllowedPath,
  validateOcrImages,
  imageBatches,
  pageFromVisionResponse,
  OCR_MIN_PAGE_CONFIDENCE,
  OCR_MAX_PAGES,
  OCR_MAX_PAGE_BYTES,
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
eq(ocrKind('image/tiff'), null, 'tiff is refused: only Vision\'s PDF path takes it, and that path is the bug');
eq(ocrKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), null, 'a Word file has no pixels to read');
eq(ocrKind(''), null, 'a missing type is not guessed at');

console.log('\nvalidateOcrImages — untrusted input on its way to a paid API');
{
  const ok = validateOcrImages([{ n: 2, image: 'QUJD' }, { n: 1, image: 'REVG' }]);
  check(ok.ok, 'well-formed pages accepted');
  eq(ok.images.map((p) => p.n), [1, 2], 'pages are ordered, so the answer reads in document order');
}
check(!validateOcrImages([]).ok, 'an empty list is refused, not treated as a document with no text');
check(!validateOcrImages(undefined).ok, 'a missing list is refused');
check(!validateOcrImages([{ n: 0, image: 'QUJD' }]).ok, 'page 0 does not exist');
check(!validateOcrImages([{ n: 1.5, image: 'QUJD' }]).ok, 'a fractional page number is refused');
check(!validateOcrImages([{ n: 1, image: 'data:image/jpeg;base64,QUJD' }]).ok,
  'a data: prefix is REFUSED, not stripped — silently repairing a payload hides the client bug');
check(!validateOcrImages([{ n: 1, image: '' }]).ok, 'an empty image is refused');
check(!validateOcrImages([{ n: 1, image: 'A'.repeat(OCR_MAX_PAGE_BYTES + 1) }]).ok, 'an oversized page is refused with a reason');
check(!validateOcrImages(Array.from({ length: OCR_MAX_PAGES + 1 }, (_, i) => ({ n: i + 1, image: 'QUJD' }))).ok,
  'more pages than the cap is refused outright rather than silently truncated');
{
  const dup = validateOcrImages([{ n: 1, image: 'QUJD' }, { n: 1, image: 'REVG' }]);
  check(dup.ok && dup.images.length === 1, 'a duplicated page is dropped, never OCR\'d and billed twice');
}

console.log('\nimageBatches — bounded by pages AND by bytes');
{
  const pages = Array.from({ length: 9 }, (_, i) => ({ n: i + 1, image: 'x' }));
  eq(imageBatches(pages).map((b) => b.length), [5, 4], "Rory's nine-page lease is two requests");
}
eq(imageBatches([]), [], 'nothing to read is no requests');
{
  // Three pages that individually fit but together blow the request ceiling.
  const big = [1, 2, 3].map((n) => ({ n, image: 'x'.repeat(600) }));
  const batches = imageBatches(big, 5, 1000);
  check(batches.length === 3, 'the byte ceiling splits a batch the page count would have allowed');
  check(batches.every((b) => b.length >= 1), 'a page larger than the ceiling still goes out alone rather than being dropped');
}

console.log('\ntextFromVisionResponse — read BOTH annotations, not just the document one');
eq(
  textFromVisionResponse({ fullTextAnnotation: { text: 'dense contract text' } }),
  'dense contract text',
  'the document annotation is preferred when present',
);
eq(
  textFromVisionResponse({ textAnnotations: [{ description: 'MIA CLARK\n2110056029083' }] }),
  'MIA CLARK\n2110056029083',
  'THE CARD BUG. A photo of a plastic card is sparse imagery: DOCUMENT_TEXT_DETECTION '
  + 'can return no fullTextAnnotation at all while textAnnotations[0] holds the whole '
  + 'legible card. Reading only the first field told people their clear photo was blank.',
);
eq(
  textFromVisionResponse({ fullTextAnnotation: { text: '  ' }, textAnnotations: [{ description: 'real text' }] }),
  'real text',
  'a blank document annotation must not shadow a populated flat one',
);
eq(textFromVisionResponse({}), '', 'genuinely nothing is still nothing');

console.log('\npageFromVisionResponse — low confidence is FLAGGED, not deleted');
eq(
  pageFromVisionResponse({ fullTextAnnotation: { text: '§ 8 Erhaltung', pages: [{ confidence: 0.93 }] }, context: { pageNumber: 4 } }, 1),
  { n: 4, text: '§ 8 Erhaltung', confidence: 0.93, lowConfidence: false },
  'a confident page comes back with its real page number',
);
eq(pageFromVisionResponse({ error: { message: 'boom' } }, 2), null, 'an errored page is unread');
eq(pageFromVisionResponse({ fullTextAnnotation: { text: '   ' } }, 2), null, 'whitespace-only is unread, not empty text');
{
  // THE CONTRACT CHANGE. This assertion used to demand null, on the principle
  // that a page we cannot trust is a page we did not read. The principle still
  // holds — but it is enforced by COVERAGE (a low-confidence page stays out of
  // the read-page list, so it still blocks every negative claim), not by
  // throwing the words away. Deleting the text made the app say "I couldn't
  // make out any words" about a card the owner can read perfectly, which is a
  // false statement no one downstream can detect or appeal.
  const faint = pageFromVisionResponse(
    { fullTextAnnotation: { text: 'blurry', pages: [{ confidence: OCR_MIN_PAGE_CONFIDENCE - 0.01 }] } },
    2,
  );
  check(faint?.text === 'blurry', 'a faintly-read page keeps its text instead of vanishing');
  check(faint?.lowConfidence === true, 'and is flagged, so the UI can badge it and coverage can exclude it');
  // The CONTROL: the flag must actually depend on the threshold, not be
  // hardcoded true. Without this, a bug that flagged every page — silently
  // dropping all of them from coverage — would pass the assertion above.
  const clear = pageFromVisionResponse(
    { fullTextAnnotation: { text: 'sharp', pages: [{ confidence: OCR_MIN_PAGE_CONFIDENCE + 0.01 }] } },
    2,
  );
  check(clear?.lowConfidence === false, 'a page just above the floor is NOT flagged');
}
check(
  pageFromVisionResponse({ fullTextAnnotation: { text: 'fine', pages: [{}] } }, 7)?.n === 7,
  'a missing (optional) confidence does not throw away a good read',
);
check(
  pageFromVisionResponse({ textAnnotations: [{ description: 'card' }] }, 3)?.lowConfidence === false,
  'a flat-annotation read has no confidence to check and must not be flagged as doubtful',
);

console.log(failures === 0 ? '\nAll docOcr tests passed.' : `\n${failures} docOcr test(s) FAILED.`);
if (failures > 0) process.exit(1);
