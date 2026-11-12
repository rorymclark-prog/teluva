import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { loadPdfjs } from '../utils/pdfThumbnail';
import { useProtectedPreview } from '../hooks/useProtectedPreview';
import { looksLikePdf } from '../utils/fileType';

function PreviewError({ onRetry, error }: { onRetry: () => void; error?: string }) {
  return (
    <div className="p-4 text-center text-sm text-ink-600" role="status">
      <p>{error || 'Couldn’t open the preview. Try again or download the original.'}</p>
      <button type="button" className="btn-quiet mx-auto mt-3" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function ImageDocumentPreview({ source, name }: { source: string; name: string }) {
  const file = useProtectedPreview(source);
  if (file.loading) return <p role="status" className="p-4 text-center text-sm">Opening original…</p>;
  if (file.error) return <PreviewError error={file.error} onRetry={file.retry} />;
  return <ImagePreview key={file.source} source={file.source!} name={name} retrySource={file.retry} />;
}

/** Card/photo URLs often have no extension. The protected response's MIME
 * selects the viewer instead of guessing that every opaque path is a JPEG. */
export function DocumentFilePreview({ source, name, mimeType, onImageClick }: { source: string; name: string; mimeType?: string; onImageClick?: () => void }) {
  const file = useProtectedPreview(source);
  if (file.loading) return <p role="status" className="p-4 text-center text-sm">Opening original…</p>;
  if (file.error) return <PreviewError error={file.error} onRetry={file.retry} />;
  const type = file.type && file.type !== 'application/octet-stream' ? file.type : mimeType;
  const pdf = type ? type === 'application/pdf' : looksLikePdf(source);
  return pdf ? <PdfPreview key={file.source} source={file.source!} name={name} retrySource={file.retry} /> : <ImagePreview key={file.source} source={file.source!} name={name} retrySource={file.retry} onImageClick={onImageClick} />;
}

function ImagePreview({ source, name, retrySource, onImageClick }: { key?: string; source: string; name: string; retrySource: () => void; onImageClick?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <img
        key={attempt}
        src={source}
        alt={name}
        className={failed ? 'hidden' : `w-full h-full object-contain ${onImageClick ? 'cursor-zoom-out' : 'pointer-events-none'}`}
        onClick={onImageClick}
        referrerPolicy="no-referrer"
        onLoad={() => setFailed(false)}
        onError={() => setFailed(true)}
      />
      {failed && <PreviewError onRetry={() => { setFailed(false); setAttempt(value => value + 1); retrySource(); }} />}
    </>
  );
}

// Protected file responses are sandboxed. Render the PDF in Teluva so preview
// works even when the browser refuses to run its embedded PDF viewer.
export function PdfDocumentPreview({ source, name }: { source: string; name: string }) {
  const file = useProtectedPreview(source);
  if (file.loading) return <p role="status" className="p-4 text-center text-sm">Opening original…</p>;
  if (file.error) return <PreviewError error={file.error} onRetry={file.retry} />;
  return <PdfPreview key={file.source} source={file.source!} name={name} retrySource={file.retry} />;
}

function PdfPreview({ source, name, retrySource }: { key?: string; source: string; name: string; retrySource: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [renderedPage, setRenderedPage] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let loading: PDFDocumentLoadingTask | undefined;
    const timer = setTimeout(() => { if (active) { setFailed(true); active = false; void loading?.destroy().catch(() => {}); } }, 20_000);
    void (async () => {
      const pdfjs = await loadPdfjs();
      if (!active) return;
      loading = pdfjs.getDocument({ url: source });
      const document = await loading.promise;
      if (active) setPdf(document);
    })().catch(() => { if (active) setFailed(true); }).finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      void loading?.destroy().catch(() => {});
    };
  }, [source, attempt]);

  useEffect(() => {
    const surface = canvas.current;
    if (!pdf || !surface) return;
    let active = true;
    let rendering: RenderTask | undefined;
    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (!active) return;
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1800 / Math.max(size.width, size.height) });
      surface.width = Math.max(1, Math.ceil(viewport.width));
      surface.height = Math.max(1, Math.ceil(viewport.height));
      rendering = page.render({ canvas: surface, viewport });
      await rendering.promise;
      if (active) setRenderedPage(pageNumber);
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; rendering?.cancel(); };
  }, [pdf, pageNumber]);

  const ready = !failed && renderedPage === pageNumber;
  return (
    <div className="flex h-full w-full flex-col">
      {pdf && pdf.numPages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-cream-200 p-1 text-xs">
          <button type="button" className="btn-quiet" disabled={pageNumber === 1 || !ready} onClick={() => setPageNumber(pageNumber - 1)}>Previous</button>
          <span aria-live="polite">{pageNumber} / {pdf.numPages}</span>
          <button type="button" className="btn-quiet" disabled={pageNumber === pdf.numPages || !ready} onClick={() => setPageNumber(pageNumber + 1)}>Next</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" key={pageNumber}>
        <canvas ref={canvas} role="img" aria-label={`${name}, page ${pageNumber}`} className={ready ? 'block h-auto w-full' : 'hidden'} />
        {failed ? <PreviewError onRetry={() => { setPdf(null); setPageNumber(1); setRenderedPage(0); setFailed(false); setAttempt(value => value + 1); retrySource(); }} />
          : !ready && <p className="p-4 text-center text-sm text-ink-600" role="status">Loading preview…</p>}
      </div>
    </div>
  );
}
