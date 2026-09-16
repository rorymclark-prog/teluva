import { FileText, Image as ImageIcon } from 'lucide-react';
import PdfThumbnail from './PdfThumbnail';

/* One thumbnail that picks its renderer from the file's TYPE.
 *
 * THE BUG THIS EXISTS TO STOP. Several places rendered an attached document as
 * a bare `<img src={doc.fileData}>` with no check on what the file actually
 * was. A photographed passport is a JPEG and looked fine; a passport scanned
 * through the app's own scanner is a PDF, because the two-sided ID flow
 * compiles both sides with compileImagesToPdf — and an <img> pointed at
 * `data:application/pdf;...` renders as the browser's broken-image glyph. So
 * the documents most likely to be there, filed the way the app itself files
 * them, were the ones that showed as torn paper.
 *
 * PdfThumbnail (a real first-page render) already existed and was already used
 * in six other components. This is not a new capability; it is the one screen
 * that never adopted it, wrapped so the next screen cannot make the same
 * omission — the type check is now inside the component rather than something
 * each caller has to remember.
 *
 * Falls back to a labelled icon rather than a broken image for anything with
 * no visual form (a .docx, a file whose type we were never told). An icon says
 * "there is a document here, it just cannot be previewed"; a broken image says
 * "this is damaged", and only one of those is true.
 */
export default function DocThumb({
  src,
  fileType,
  size = 'w-14 h-10',
  alt = '',
  chrome = true,
}: {
  src?: string;
  fileType?: string;
  size?: string;
  alt?: string;
  /* Draw the rounded border and white backing. Pass false when the caller has
   * already drawn them — a bordered, rounded thumb dropped inside a bordered,
   * rounded tile shows a doubled edge and a sliver of the outer background at
   * each corner, which is exactly what the document tiles on the ID tab do. */
  chrome?: boolean;
}) {
  const box = chrome
    ? `${size} rounded-lg overflow-hidden border border-clay-200 bg-white shrink-0`
    : `${size} overflow-hidden shrink-0`;
  const type = (fileType || '').toLowerCase();

  if (!src) {
    return (
      <div className={`${box} flex items-center justify-center bg-cream-100`}>
        <ImageIcon className="w-4 h-4 text-ink-300" />
      </div>
    );
  }

  if (type.startsWith('image/')) {
    return <img src={src} alt={alt} className={`${box} object-cover`} />;
  }

  if (type.includes('pdf')) {
    return <PdfThumbnail src={src} size={box} />;
  }

  /* No fileType recorded — the case that matters most, because older records
   * predate the field entirely. Sniff the data URL's own declared type rather
   * than guessing image and risking the broken glyph all over again. A
   * Storage https: URL with no type falls through to the icon, which is the
   * honest answer: we genuinely do not know what it is. */
  if (src.startsWith('data:image/')) {
    return <img src={src} alt={alt} className={`${box} object-cover`} />;
  }
  if (src.startsWith('data:application/pdf')) {
    return <PdfThumbnail src={src} size={box} />;
  }

  return (
    <div className={`${box} flex items-center justify-center bg-cream-100`}>
      <FileText className="w-4 h-4 text-rosa-500" />
    </div>
  );
}
