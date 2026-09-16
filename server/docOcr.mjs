/* ---------------------------------------------------------------------------
 * OCR for the document reader — reading documents that have no text layer.
 *
 * WHY THIS EXISTS, HAVING BEEN DELIBERATELY LEFT OUT OF v1
 * -------------------------------------------------------
 * v1 refused to read images, and the reason was a real one: every other passage
 * in this feature is a slice the server cuts out of a PDF's own content stream,
 * so "this string is genuinely in your document" holds by construction. OCR
 * output is a machine's reading of pixels, and nothing downstream can check it.
 *
 * That reasoning was sound and the scope was still wrong. The first real
 * document anyone tried was a nine-page scan of a Vienna lease — no text layer
 * anywhere — and that is the NORMAL case for a family vault: phone photos of
 * contracts, scans from a library machine, PDFs produced by a copier. A reader
 * that only handles born-digital PDFs cannot read most of what people keep.
 *
 * WHAT ACTUALLY CHANGES, AND WHAT DOES NOT
 * ----------------------------------------
 * The invariant weakens by exactly one step, and no further. A passage is still
 * a slice of text — nothing is generated, paraphrased or summarised, and no
 * model writes a sentence anyone reads. What we lose is the guarantee that the
 * text we sliced from matches the ink on the page.
 *
 * So the whole design is: make that one step VISIBLE and never let it become
 * silent. Everything OCR touches comes back with verifiable:false, which the
 * existing pipeline already carries end to end — every passage gets a "read
 * from an image" badge, and canRenderNegative() refuses to let the UI say "your
 * document doesn't mention that", because a word OCR missed looks exactly like
 * a word that was never there.
 *
 * Low-confidence pages USED to be treated as pages we could not read at all,
 * on the reasoning that an unread page is named out loud while a badly-read one
 * silently answers the question wrong. The reasoning was right and the
 * implementation was the wrong lever. Vision scores a photo of a plastic card
 * around 0.5 because it is curved and glossy, not because it is illegible, and
 * the app then told its owner "I couldn't make out any words in this document"
 * about a card they can read at arm's length. That sentence is false and
 * unappealable — the words existed and were deleted one function call earlier.
 *
 * The safety property was never held by the deletion. Nothing OCR touches can
 * produce a negative claim, because mergeOcrCoverage() sets verifiable:false for
 * the whole document and canRenderNegative() requires verifiable — so "your
 * lease says nothing about deposits" is already impossible from OCR'd text, at
 * full confidence or none. What the deletion actually bought was the illusion of
 * a second gate, paid for with the text. Low-confidence pages now come back
 * flagged, and the flag is logged rather than acted on.
 *
 * BOTH Vision text models, in that order. DOCUMENT_TEXT_DETECTION is the
 * dense-document model — paragraphs, reading order, column layout — and it is
 * right for the leases and contracts this feature was built for. It is also
 * capable of returning nothing at all for a handful of short lines on a
 * coloured background, which is what an ID card, a licence or a medical-aid
 * card is. TEXT_DETECTION reads those. So: document model first, and where it
 * finds nothing, the sparse model on that page alone. The order matters —
 * TEXT_DETECTION returns contract text in an order that makes clause expansion
 * meaningless, so it must never be what reads a page the other model could.
 * ------------------------------------------------------------------------- */

// How many page images go into one images:annotate call. Vision accepts up to
// 16; we send far fewer because the binding constraint is the 20MB request
// ceiling, and because a batch that fails costs us every page in it.
export const OCR_PAGES_PER_REQUEST = 5;

// Base64 budget for one Vision request, under the documented 20MB ceiling with
// room for the JSON envelope.
export const OCR_MAX_REQUEST_BYTES = 14 * 1024 * 1024;

// One rendered page. A 2200px A4 scan at JPEG 0.85 lands around 250-400KB
// (≈500KB base64); this leaves generous headroom for a dense colour page while
// still rejecting anything that is clearly not a rendered document page.
export const OCR_MAX_PAGE_BYTES = 4 * 1024 * 1024;

// A hard ceiling on what one read will OCR. Past this we stop and SAY we
// stopped (the pages we never looked at are reported as unread, which blocks
// any negative claim) rather than quietly reading the first chunk and letting
// it look like the whole document.
export const OCR_MAX_PAGES = 20;

// Below this mean confidence a page is recorded as UNREAD, not as read-badly.
// Vision reports per-page confidence in 0..1; a clean phone photo of a printed
// contract sits well above 0.8, while a blurred or heavily skewed page falls
// away sharply. The exact number matters less than the direction of the error:
// too high costs a page we might have read, too low costs a wrong answer.
export const OCR_MIN_PAGE_CONFIDENCE = 0.6;

/**
 * Is this a file we can OCR at all?
 *
 * Vision's file endpoint takes PDF and TIFF; its image endpoint takes the
 * common raster formats. Anything else (Word, Pages, zip) has no pixels to read
 * and must fall through to "we could not read this", never to "nothing found".
 */
export function ocrKind(fileType) {
  const t = (fileType || '').toLowerCase();
  // 'file' means "a PDF the client rasterises for us". TIFF is deliberately
  // absent: Vision only accepts it through the PDF endpoint, which is the very
  // path that returned "Bad image data" for eight pages out of nine, and pdfjs
  // cannot render a TIFF for us instead. Answering "this kind of file cannot be
  // read as an image" is true and useful; accepting it and failing later is not.
  if (t.startsWith('application/pdf') || t === 'application/pdf') return 'file';
  if (t === 'image/tiff' || t === 'image/tif') return null;
  if (t.startsWith('image/')) return 'image';
  return null;
}

/**
 * A storage path this caller is allowed to read.
 *
 * THE SECURITY BOUNDARY OF THIS ENDPOINT. The server holds admin credentials
 * for the whole bucket, so an unchecked path here would read any family's
 * documents on request — the client sends the path, and the client is not
 * trusted. Every object the vault writes lives under families/{familyId}/, so
 * the check is a prefix match against the caller's OWN family id, resolved
 * server-side from their token rather than from anything they sent.
 *
 * Rejects traversal outright rather than normalising it: a path containing ".."
 * has no legitimate reason to exist here, and silently repairing hostile input
 * is how a boundary becomes a suggestion.
 */
export function isAllowedPath(storagePath, familyId) {
  if (typeof storagePath !== 'string' || !storagePath) return false;
  if (!familyId || typeof familyId !== 'string') return false;
  if (storagePath.includes('..')) return false;
  if (storagePath.startsWith('/')) return false;
  return storagePath.startsWith(`families/${familyId}/`);
}

/**
 * Validate the rendered page images a client sent.
 *
 * These arrive from the browser, so nothing about them is assumed: the page
 * numbers order the result and must be real integers, the payloads are handed
 * straight to Google and must be base64 and bounded, and the count must be
 * capped or one request could spend an unbounded amount of someone else's
 * money. Returns a REASON on rejection, because "please try again" on a
 * document that will never work is worse than saying what is wrong.
 */
export function validateOcrImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, error: 'No page images were sent for reading.' };
  }
  if (images.length > OCR_MAX_PAGES) {
    return { ok: false, error: `Only the first ${OCR_MAX_PAGES} pages can be read at once.` };
  }
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const p of images) {
    const n = p?.n;
    const image = p?.image;
    if (!Number.isInteger(n) || n < 1 || n > 10000) return { ok: false, error: 'Page images are not in the expected format.' };
    if (seen.has(n)) continue;                       // a duplicate page is dropped, never OCR'd twice
    if (typeof image !== 'string' || image.length === 0) return { ok: false, error: 'Page images are not in the expected format.' };
    // Reject a data: prefix rather than stripping it. Vision wants raw base64,
    // and quietly repairing a payload shape hides a client bug until the day it
    // produces something we cannot repair.
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(image)) return { ok: false, error: 'Page images are not in the expected format.' };
    if (image.length > OCR_MAX_PAGE_BYTES) return { ok: false, error: 'One of those pages is too large to read — try a lower-resolution copy.' };
    total += image.length;
    seen.add(n);
    out.push({ n, image });
  }
  if (!out.length) return { ok: false, error: 'No page images were sent for reading.' };
  if (total > OCR_MAX_PAGES * OCR_MAX_PAGE_BYTES) return { ok: false, error: 'That scan is too large to read here — try a lower-resolution copy.' };
  return { ok: true, images: out.sort((a, b) => a.n - b.n) };
}

/**
 * Group rendered pages into requests Vision will accept — bounded by BOTH the
 * page count and the total bytes, since one dense colour page can be worth
 * several sparse ones and it is the byte ceiling that returns a bare 400.
 */
export function imageBatches(images, per = OCR_PAGES_PER_REQUEST, maxBytes = OCR_MAX_REQUEST_BYTES) {
  const batches = [];
  let batch = [];
  let bytes = 0;
  for (const p of images) {
    if (batch.length > 0 && (batch.length >= per || bytes + p.image.length > maxBytes)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(p);
    bytes += p.image.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/**
 * Turn one Vision fullTextAnnotation response into our page shape.
 *
 * Returns null when the page is not usable — no text, or read with too little
 * confidence — because the caller records those as pages it could NOT read.
 * That distinction is the whole safety story: see the header.
 */
/**
 * The text out of a Vision response, from EITHER annotation.
 *
 * `fullTextAnnotation` is what DOCUMENT_TEXT_DETECTION produces and it is the
 * right shape for dense document text. `textAnnotations[0].description` is the
 * flat whole-image string, and it is populated for sparse imagery where the
 * document model finds no block structure to report.
 *
 * A photograph of a plastic card — an e-card, a driving licence, a medical-aid
 * card — is exactly that sparse case: a handful of short lines over a coloured
 * background with glare and curvature. Reading only `fullTextAnnotation` meant
 * a perfectly legible card could come back with nothing at all, and the app
 * then told the user the page was blank. Preferring the document annotation and
 * falling back to the flat one costs nothing and is the difference between
 * reading a card and denying it exists.
 */
export function textFromVisionResponse(resp) {
  const full = resp?.fullTextAnnotation?.text;
  if (typeof full === 'string' && full.trim()) return full;
  const flat = resp?.textAnnotations?.[0]?.description;
  if (typeof flat === 'string' && flat.trim()) return flat;
  return '';
}

export function pageFromVisionResponse(resp, fallbackPageNumber) {
  if (!resp || resp.error) return null;
  const text = textFromVisionResponse(resp);
  if (!text.trim()) return null;

  // Vision reports confidence per detected page inside the annotation; a
  // files:annotate response carries exactly one. Absent confidence is treated
  // as usable — the field is documented as optional, and refusing a page for
  // lacking an optional field would throw away good reads.
  const conf = resp.fullTextAnnotation?.pages?.[0]?.confidence;

  // A LOW-CONFIDENCE PAGE IS NOW RETURNED, FLAGGED — NOT DISCARDED.
  //
  // This used to return null, on the principle that a page we cannot trust is a
  // page we did not read. The principle is right; deleting the text was the
  // wrong way to hold it. Vision would read a card correctly, score it 0.5
  // because it is a curved glossy surface rather than a flat page, and the app
  // would tell the user "I couldn't make out any words in this document" about
  // an image they can read perfectly themselves. That sentence is false, and it
  // is unfalsifiable from the outside — the words existed and were thrown away
  // one function call earlier.
  //
  // The safety property was never owned by this deletion anyway. What must
  // never happen is the app claiming a document does NOT say something, and
  // that is decided by COVERAGE: a low-confidence page stays out of the
  // read-page list, so it still counts as unread for every negative claim. The
  // text comes through badged instead of vanishing, which is strictly more
  // honest in both directions — the user sees what was read AND that it may be
  // misread.
  const lowConfidence = typeof conf === 'number' && conf < OCR_MIN_PAGE_CONFIDENCE;

  const n = resp.context?.pageNumber ?? fallbackPageNumber;
  return {
    n,
    text,
    confidence: typeof conf === 'number' ? conf : null,
    lowConfidence,
  };
}

