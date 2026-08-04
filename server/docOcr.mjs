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
 * Low-confidence pages are treated as pages we could not read AT ALL rather
 * than pages we read badly. An unread page is named out loud and blocks the
 * negative; a badly-read page silently answers the question wrong. Given a
 * choice between a noisier UI and a wrong clause on a lease someone is about to
 * rely on, this file always takes the noise.
 *
 * DOCUMENT_TEXT_DETECTION rather than TEXT_DETECTION: the former is Vision's
 * dense-document model, which understands paragraphs, reading order and column
 * layout. TEXT_DETECTION is tuned for signage and street scenes and returns
 * contract text in an order that makes clause expansion meaningless.
 * ------------------------------------------------------------------------- */

// Vision's synchronous files:annotate accepts at most 5 pages per request, so a
// multi-page scan is fetched in batches.
export const OCR_PAGES_PER_REQUEST = 5;

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
  if (t.startsWith('application/pdf') || t === 'application/pdf') return 'file';
  if (t === 'image/tiff' || t === 'image/tif') return 'file';
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

/** Page numbers to request, in batches Vision will accept. */
export function pageBatches(pagesTotal, maxPages = OCR_MAX_PAGES, per = OCR_PAGES_PER_REQUEST) {
  const capped = Math.max(0, Math.min(Number(pagesTotal) || 0, maxPages));
  const batches = [];
  for (let start = 1; start <= capped; start += per) {
    const batch = [];
    for (let n = start; n < start + per && n <= capped; n++) batch.push(n);
    batches.push(batch);
  }
  return batches;
}

/**
 * Turn one Vision fullTextAnnotation response into our page shape.
 *
 * Returns null when the page is not usable — no text, or read with too little
 * confidence — because the caller records those as pages it could NOT read.
 * That distinction is the whole safety story: see the header.
 */
export function pageFromVisionResponse(resp, fallbackPageNumber) {
  if (!resp || resp.error) return null;
  const ann = resp.fullTextAnnotation;
  const text = typeof ann?.text === 'string' ? ann.text : '';
  if (!text.trim()) return null;

  // Vision reports confidence per detected page inside the annotation; a
  // files:annotate response carries exactly one. Absent confidence is treated
  // as usable — the field is documented as optional, and refusing a page for
  // lacking an optional field would throw away good reads.
  const conf = ann?.pages?.[0]?.confidence;
  if (typeof conf === 'number' && conf < OCR_MIN_PAGE_CONFIDENCE) return null;

  const n = resp.context?.pageNumber ?? fallbackPageNumber;
  return { n, text, confidence: typeof conf === 'number' ? conf : null };
}

/**
 * Assemble the coverage the client would otherwise have computed from a text
 * layer — with verifiable:false, which is what makes every downstream "we can't
 * claim a negative" branch fire.
 */
export function buildOcrCoverage(pages, pagesTotal) {
  const total = Math.max(Number(pagesTotal) || 0, pages.length);
  const read = new Set(pages.map((p) => p.n));
  const pagesWithoutText = [];
  for (let n = 1; n <= total; n++) if (!read.has(n)) pagesWithoutText.push(n);
  return {
    pagesTotal: total,
    pagesWithText: pages.length,
    pagesWithoutText,
    // NEVER true from this module. Every passage sliced out of this text is
    // OCR's reading of a photograph, and the app must say so.
    verifiable: false,
  };
}
