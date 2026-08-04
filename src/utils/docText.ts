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

  // Images have no text layer to extract HERE — but they are no longer the end
  // of the road.
  //
  // v1 refused them outright, and the reasoning was the load-bearing invariant
  // rather than effort: every other passage is a slice cut out of text this
  // module extracted, so "this string is really in your document" holds by
  // construction, while an OCR'd string is a machine's reading of pixels that
  // nothing downstream can confirm.
  //
  // That reasoning was right and the scope was wrong. The first real document
  // anyone tried was a nine-page scan of a lease, and that is the NORMAL case
  // for a family vault. So utils/docReader.ts now falls through to /api/doc-ocr
  // whenever this returns no readable pages, and everything OCR produces is
  // marked verifiable:false — which badges every passage and, crucially, still
  // forbids the one sentence that was never safe: "your document doesn't
  // mention that". The invariant weakened by exactly one step and was made
  // visible rather than quietly dropped.
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

// ---------------------------------------------------------------------------
// Rasterising pages for OCR
// ---------------------------------------------------------------------------

// The long edge we render a page to before handing it to OCR. Vision reads a
// printed A4 page reliably from about 1600px on the long edge; the scans in a
// real vault arrive between 1600 and 2600 and read at 0.88–0.93 confidence, so
// this sits at the top of that band. Going higher buys nothing and costs upload
// time and phone memory on exactly the devices least able to spare either.
const OCR_RENDER_LONG_EDGE = 2200;

// JPEG rather than PNG, and 0.85 rather than 0.92: OCR cares about edge
// contrast in glyphs, which survives this comfortably, and a page of scanned
// text is ~250KB here against ~4MB as PNG.
const OCR_RENDER_QUALITY = 0.85;

export interface RenderedPage {
  n: number;
  /** Base64 JPEG, no data: prefix — the shape Vision's `image.content` wants. */
  image: string;
}

/**
 * Render specific pages of a PDF to JPEGs for OCR.
 *
 * WHY THE CLIENT DOES THIS RATHER THAN HANDING THE PDF TO THE SERVER
 * ------------------------------------------------------------------
 * v186 sent the whole PDF to Vision's files:annotate and let Vision rasterise
 * it. On the first real document anyone tried — a 12MB, nine-page scan of a
 * Vienna lease — Vision returned "Bad image data" for eight of the nine pages
 * and read only page 9, which happened to hold the smallest image in the file.
 * The result was an app that had OCR, said it had OCR, and could not read the
 * document.
 *
 * The pages themselves were fine: extracted and posted to images:annotate
 * individually, the very same page images came back at 0.88–0.93 confidence
 * with full text. The fault was entirely in handing Vision a large PDF and
 * asking it to do the rasterising.
 *
 * So we rasterise. pdfjs is already loaded here — it just opened this document
 * to look for a text layer — and rendering a page is what it is best at. What
 * the server receives is one modest JPEG per page, which is the input Vision is
 * most reliable on, and the failure mode changes shape entirely: a page that
 * cannot be rendered is one page reported as unread, not eight.
 *
 * Pages are rendered ONE AT A TIME and the canvas is released between them. A
 * 2200px page is ~25MB of RGBA; nine of those held at once is how you get a
 * blank tab on an iPhone.
 */
export async function renderDocPages(
  src: string,
  pageNumbers: number[],
): Promise<RenderedPage[]> {
  if (!pageNumbers.length) return [];
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ url: src }).promise;
  const out: RenderedPage[] = [];
  try {
    for (const n of pageNumbers) {
      if (n < 1 || n > doc.numPages) continue;
      let canvas: HTMLCanvasElement | null = null;
      try {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        // pdfjs's scale 1 is 72dpi — an A4 page is 595x842 there, far too small
        // to read. So this is normally an UPSCALE (~2.6x for A4), which lands
        // near the embedded scan's own resolution. Clamped so a pathologically
        // small page size cannot ask for a canvas the device can't allocate.
        const scale = Math.min(OCR_RENDER_LONG_EDGE / Math.max(base.width, base.height), 6);
        const viewport = page.getViewport({ scale });

        canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        // Scanned pages are photographs of white paper; without this, any page
        // with transparency renders text onto black and OCR reads nothing.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const url = canvas.toDataURL('image/jpeg', OCR_RENDER_QUALITY);
        const comma = url.indexOf(',');
        if (comma > 0) out.push({ n, image: url.slice(comma + 1) });
      } catch {
        // One page that will not render is one page we report as unread. It
        // must never cost us the pages either side of it.
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
    }
  } finally {
    try { doc.cleanup(); } catch { /* nothing useful to do */ }
  }
  return out;
}

/**
 * Fold OCR'd pages into the coverage computed from the text layer.
 *
 * Coverage is the safety-critical number in this feature: it is what decides
 * whether the app is ever allowed to say "your document doesn't mention that".
 * Merging it is therefore done HERE, in one pure function, rather than in the
 * component that happens to need it — and it is deliberately pessimistic in
 * both directions.
 *
 * verifiable goes to false and never comes back. A document where OCR read one
 * page and the text layer supplied eight is, as a whole, no longer something we
 * can promise matches the ink — and the passage the user ends up reading may be
 * the OCR'd one. Tracking provenance per page and re-deriving it per passage
 * would be more precise and would give three separate places for the wrong
 * answer to leak out of; one document-wide flag cannot.
 */
export function mergeOcrCoverage(base: DocCoverage, ocrPageNumbers: number[]): DocCoverage {
  const read = new Set(ocrPageNumbers.filter((n) => Number.isInteger(n) && n > 0));
  if (read.size === 0) return base;

  const stillMissing = base.pagesWithoutText.filter((n) => !read.has(n));
  const pagesTotal = Math.max(base.pagesTotal, ...read);
  return {
    pagesTotal,
    pagesWithText: Math.max(0, pagesTotal - stillMissing.length),
    pagesWithoutText: stillMissing,
    verifiable: false,
  };
}
