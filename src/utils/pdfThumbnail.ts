// First-page PDF thumbnail — renders page 1 to a small JPEG data: URL so a PDF
// in a document list can show a real preview instead of a generic file icon,
// the same way an image attachment already does. pdfjs-dist is dynamically
// imported (same lazy-chunk pattern as jszip in utils/share.ts) so it never
// weighs down the initial bundle — most sessions never render a PDF thumbnail.

// A singleton PROMISE, not a boolean flag — a document list can mount several
// PdfThumbnail instances at once (one per PDF row), each calling this within
// the same tick. A boolean flag has a classic race: two concurrent callers
// both see "not configured yet" before either finishes, so both kick off their
// own worker-src setup — pdfjs's worker then gets initialized twice, and the
// concurrent getDocument() calls that follow can hang instead of resolving or
// rejecting. Caching the PROMISE means every caller after the first just awaits
// the one in-flight setup instead of racing to redo it.
let pdfjsReady: Promise<typeof import('pdfjs-dist')> | null = null;

// Exported (additively — nothing else about this module changed) so that
// utils/docText.ts can share this ONE loader instead of standing up a second
// singleton. Two modules each configuring GlobalWorkerOptions.workerSrc is
// precisely the double-init race described above, and a document list mounting
// thumbnails while the user opens the document reader is exactly when it fires.
export function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsReady;
}

// `src` may be a data: URL (inline base64, MemberDocuments) or an https:
// download URL (Firebase Storage, DocumentVault) — pdfjs accepts either as `url`.
export async function pdfFirstPageThumbnail(src: string, maxWidthPx = 160): Promise<string> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ url: src }).promise;
  try {
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = maxWidthPx / baseViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.75);
  } finally {
    doc.cleanup();
  }
}
