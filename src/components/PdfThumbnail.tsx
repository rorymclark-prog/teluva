import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { pdfFirstPageThumbnail } from '../utils/pdfThumbnail';

// A real first-page preview for a PDF document row, instead of a generic file
// icon — same visual treatment as an image attachment once it loads. Falls
// back to the plain icon (in the same box) while rendering, or permanently if
// the render fails (a corrupt/unusual PDF shouldn't break the list).
export default function PdfThumbnail({ src, size = 'w-12 h-12' }: { src: string; size?: string }) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setThumb(null);
    pdfFirstPageThumbnail(src)
      .then((url) => { if (active) setThumb(url); })
      .catch(() => { /* keep the icon fallback */ });
    return () => { active = false; };
  }, [src]);

  if (thumb) {
    return <img src={thumb} alt="" className={`${size} rounded-xl object-cover border border-cream-200 shrink-0 bg-white`} />;
  }
  return (
    <div className={`${size} rounded-xl bg-cream-100 border border-cream-200 flex items-center justify-center shrink-0`}>
      <FileText className="w-5 h-5 text-rosa-500" />
    </div>
  );
}
