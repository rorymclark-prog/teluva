// ---------------------------------------------------------------------------
// Per-page text extraction for the recall-only document reader.
//
// WHY CLIENT-SIDE, AND WHY AT READ TIME (not once at upload, stored on the doc):
//
// Every vault document's metadata lives in ONE Firestore document —
// families/{familyId}/reference/documents, written by saveReferenceDoc — and
// that single blob is (a) JSON.stringify'd whole into localStorage on every
// change, (b) three-way merged field-by-field on every save, and (c) shipped
// into the AI chat context on every single turn. A lease is easily 60k
// characters of text; putting extracted text on the document record would blow
// up all four of those at once — the localStorage quota, the merge cost, the
// Firestore 1MB document limit, and the per-message token bill — for data that
// is read maybe twice in a document's lifetime.
//
// Extracting on demand instead costs exactly nothing at rest, needs no
// migration, and works on every document already in the vault (including ones
// uploaded years ago), which a "extract at upload" design never would.
//
// THE FAILURE MODE THIS FILE EXISTS TO PREVENT: not a wrong quote — a confident
// "your lease doesn't say anything about that". That sentence is the default
// output of every extraction gap: an image-only scanned page, a PDF whose text
// layer is broken, a document truncated by a size cap. So this module's real
// product is not `pages` — it is `coverage`. Coverage is what tells the UI it
// is NOT allowed to render a negative. Every branch below is written to be
// pessimistic about what we managed to read: when in doubt, a page goes in
// pagesWithoutText, because the cost of understating coverage is a slightly
// noisier UI and the cost of overstating it is a missed legal deadline.

import type { DocPage, DocCoverage } from '../types';

// Hard cap on total extracted text. A 400-page scanned bundle would otherwise
// pin the main thread and blow the request body on the way to /api/doc-read.
// Past the cap we STOP and say so in coverage rather than silently reading half
// a document and letting it look complete — see buildTruncatedCoverage below.
const MAX_TOTAL_CHARS = 400_000;

// A page with fewer than this many non-whitespace characters is treated as
// having no usable text layer. Scanned pages routinely yield a stray header,
// a page number, or a few characters of OCR junk from an embedded stamp — that
// is not text we can honestly claim to have read.
const MIN_CHARS_FOR_TEXT = 20;

// pdfjs is loaded through pdfThumbnail.ts's singleton loader ON PURPOSE, rather
// than being imported again here. That module caches a PROMISE (not a boolean)
// precisely because two callers in the same tick would otherwise both configure
// GlobalWorkerOptions.workerSrc, initialize the worker twice, and leave the
// following getDocument() calls hanging instead of resolving — read the comment
// at the top of pdfThumbnail.ts for the full story. A document list is exactly
// the place where that races: several PdfThumbnail rows are mounting while the
// user taps "Ask" on one of them, so this module and that one are genuinely
// concurrent. A second singleton here would be a second competing init and
// would reintroduce the identical bug, so we share the one loader. The only
// change made to pdfThumbnail.ts was adding `export` to the existing
// loadPdfjs() — purely additive, no behaviour change.
import { loadPdfjs } from './pdfThumbnail';

/**
 * Pull per-page text out of a document.
 *
 * `src` may be a data: URL (inline base64 — MemberDocuments stores fileData
 * that way) or an https: Firebase Storage download URL (DocumentVault). pdfjs
 * accepts either as `url`, and fetch() handles both for the text/plain path.
 *
 * Never throws for "we could not read this" — that is a coverage state, not an
 * error. It only propagates hard failures (network down, corrupt PDF), which
 * the caller must surface as an error rather than as an empty result: an empty
 * result and a failed read must never look the same to the user.
 */
export async function extractDocText(
  src: string,
  fileType: string,
): Promise<{ pages: DocPage[]; coverage: DocCoverage }> {
  const type = (fileType || '').toLowerCase();

  // Images: no text layer, and v1 does NOT OCR them.
  //
  // The OCR path is deliberately deferred, and the reason is the load-bearing
  // invariant rather than effort: OCR output cannot be checked against a ground
  // truth. Every other passage in this feature is a slice the server cuts out
  // of text we extracted, so "this string is really in your document" is
  // verifiable by construction. An OCR'd string is the model's (or Tesseract's)
  // reading of pixels — nothing downstream can confirm it, which means no
  // negative claim could ever be safely rendered from it, and a passage badged
  // "we think it says this" is worse than no feature at all for a document
  // someone is about to rely on. So the reader is simply not offered for
  // photos; docReadEligibility.ts hides the button for image/* types.
  if (type.startsWith('image/')) {
    return { pages: [], coverage: unreadableCoverage() };
  }

  if (type === 'application/pdf' || type.startsWith('application/pdf')) {
    return extractPdf(src);
  }

  if (type.startsWith('text/')) {
    return extractPlainText(src);
  }

  // Anything else (Word, Pages, zip…): we have no extractor, so we have no
  // text. Returning an unreadable coverage rather than throwing keeps the
  // caller's branch simple — pagesWithText === 0 means "we could not read this
  // document", which the UI renders from a fixed template. It must NOT render
  // "nothing found" here; the difference between those two sentences is the
  // whole feature.
  return { pages: [], coverage: unreadableCoverage() };
}

// ---------------------------------------------------------------------------

async function extractPdf(src: string): Promise<{ pages: DocPage[]; coverage: DocCoverage }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ url: src }).promise;
  try {
    const pagesTotal = doc.numPages;
    const pages: DocPage[] = [];
    let budget = MAX_TOTAL_CHARS;
    let stoppedAtPage = 0; // 1-based page we ran out of budget on; 0 = never

    for (let n = 1; n <= pagesTotal; n++) {
      if (budget <= 0) { stoppedAtPage = n; break; }

      let text = '';
      try {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        text = joinTextItems(content.items);
      } catch {
        // One bad page must not lose the other 40. An unreadable page is
        // honestly reported as a page with no text, which is exactly what it is
        // from the user's point of view — and which blocks any negative claim.
        text = '';
      }

      if (text.length > budget) {
        // Truncated pages are recorded as NOT read (see buildCoverage): we hold
        // part of the page, so we cannot say what the rest of it does or does
        // not contain. Keeping the partial text is still worth it — a passage
        // we DO find in it is real.
        text = text.slice(0, budget);
        stoppedAtPage = n;
      }
      budget -= text.length;
      pages.push({ n, text });
      if (stoppedAtPage) break;
    }

    return {
      pages,
      // Real text-layer extraction: verifiable. Every character came out of the
      // PDF's own content stream, so the server can slice offsets out of it and
      // the resulting passage is provably the document's own words.
      coverage: buildCoverage(pages, pagesTotal, { verifiable: true, truncatedFromPage: stoppedAtPage }),
    };
  } finally {
    // Same discipline as pdfThumbnail.ts — pdfjs holds worker-side buffers per
    // document and leaks them across repeated reads without this.
    doc.cleanup();
  }
}

async function extractPlainText(src: string): Promise<{ pages: DocPage[]; coverage: DocCoverage }> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not fetch document text (${res.status})`);
  const raw = await res.text();
  // Plain text has no pages; treating the whole file as page 1 keeps the
  // {page, charStart, charEnd} contract identical for the server sweep, which
  // has no idea (and must not need to know) what kind of file this came from.
  const text = raw.length > MAX_TOTAL_CHARS ? raw.slice(0, MAX_TOTAL_CHARS) : raw;
  const truncated = raw.length > MAX_TOTAL_CHARS;
  const pages: DocPage[] = [{ n: 1, text }];
  return {
    pages,
    coverage: buildCoverage(pages, 1, { verifiable: true, truncatedFromPage: truncated ? 1 : 0 }),
  };
}

// ---------------------------------------------------------------------------

/**
 * Join pdfjs text items into something a human (and a keyword sweep) can read.
 *
 * pdfjs items carry NO reliable spaces: a PDF positions text runs by coordinate
 * transform, so "Kündigungsfrist beträgt" may arrive as two items with nothing
 * between them, and a naive ''.join() produces "Kündigungsfristbeträgt" — a
 * word the search sweep can never match. That is a silent false negative, i.e.
 * the exact failure this feature must not have.
 *
 * So we err toward INSERTING a space when neither side supplies one. The
 * trade-off is real and chosen deliberately: an extra space occasionally lands
 * inside a word that a font change split into two runs ("Kündigungs frist").
 * Over-spacing loses one match; under-spacing glues words together and loses
 * many. Recall is what the user is relying on, so we take the cheaper error.
 *
 * Hyphen at end of a run gets no space — the server's normalizeForSearch()
 * rejoins hyphen+newline splits, and inserting a space there would defeat it.
 *
 * `hasEOL` (pdfjs's own end-of-line signal, present on TextItem) becomes a real
 * newline, which is what lets the server's expandToClause() find sentence and
 * numbered-clause boundaries (§ 8 (4), 12.3, (a)) instead of one endless line.
 */
function joinTextItems(items: unknown[]): string {
  let out = '';
  for (const raw of items) {
    // TextMarkedContent items have no `str` — skip them rather than casting
    // blindly; pdfjs interleaves them with real text items.
    const item = raw as { str?: unknown; hasEOL?: unknown };
    if (typeof item.str !== 'string') continue;
    const str = item.str;

    if (str) {
      const prev = out.slice(-1);
      const needsSpace =
        out.length > 0 &&
        !/\s/.test(prev) &&
        prev !== '-' && prev !== '‐' && prev !== '­' &&
        !/^\s/.test(str);
      if (needsSpace) out += ' ';
      out += str;
    }
    if (item.hasEOL === true) out += '\n';
  }
  return out;
}

/** Non-whitespace character count — whitespace is not evidence we read a page. */
function meaningfulLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function buildCoverage(
  pages: DocPage[],
  pagesTotal: number,
  opts: { verifiable: boolean; truncatedFromPage: number },
): DocCoverage {
  const withoutText: number[] = [];
  let withText = 0;

  for (const p of pages) {
    // A page we only partially hold counts as NOT read. It genuinely has text,
    // so this looks wrong — but pagesWithoutText is consumed by
    // canRenderNegative(), and the only honest meaning there is "pages whose
    // text we do not fully have". Counting a truncated page as read would let
    // the UI say "your lease says nothing about deposits" on the strength of
    // the first half of page 12.
    const truncated = opts.truncatedFromPage > 0 && p.n >= opts.truncatedFromPage;
    if (!truncated && meaningfulLength(p.text) >= MIN_CHARS_FOR_TEXT) withText++;
    else withoutText.push(p.n);
  }

  // Pages we never got to at all (cap hit, or the loop broke early) are unread
  // by definition and must appear here — otherwise a 60-page document whose
  // first 20 pages we read would advertise itself as fully covered.
  for (let n = pages.length + 1; n <= pagesTotal; n++) withoutText.push(n);

  return {
    pagesTotal,
    pagesWithText: withText,
    pagesWithoutText: withoutText,
    verifiable: opts.verifiable,
  };
}

/**
 * Coverage for "we could not read this at all" (image, unsupported format).
 *
 * Deliberately belt-and-braces: verifiable:false ALONE should already stop any
 * negative claim, but pagesTotal:1 / pagesWithoutText:[1] blocks it a second
 * time via the pagesWithoutText check. Two independent gates, because a future
 * refactor of canRenderNegative() that drops one of them must not silently turn
 * a photo of a contract into "your contract doesn't mention that".
 */
function unreadableCoverage(): DocCoverage {
  return { pagesTotal: 1, pagesWithText: 0, pagesWithoutText: [1], verifiable: false };
}
