import { jsPDF } from 'jspdf';

function loadImageDims(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('Failed to load image. Make sure the file format is valid.'));
    img.src = src;
  });
}

export interface CompiledPdf {
  data: string;
  name: string;
  size: number;
}

// Multi-page PDF from one or more image data URLs — one page per image, in order
// (used for a single scanned page, or a two-sided ID's front+back as pages 1+2).
export async function compileImagesToPdf(imageDataUrls: string[], fileName: string): Promise<CompiledPdf> {
  const dims = await Promise.all(imageDataUrls.map(loadImageDims));
  const pdf = new jsPDF({
    orientation: dims[0].width > dims[0].height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [dims[0].width, dims[0].height],
  });
  imageDataUrls.forEach((src, i) => {
    if (i > 0) {
      pdf.addPage([dims[i].width, dims[i].height], dims[i].width > dims[i].height ? 'landscape' : 'portrait');
    }
    pdf.addImage(src, 'JPEG', 0, 0, dims[i].width, dims[i].height);
  });
  const pdfDataUrl = pdf.output('datauristring');
  const base64Content = pdfDataUrl.split(',')[1];
  const bytesCount = Math.round((base64Content.length * 3) / 4);
  const cleanName = fileName.replace(/\.[^/.]+$/, '') + '.pdf';
  return { data: pdfDataUrl, name: cleanName, size: bytesCount };
}

export function compileImageToPdf(imageDataUrl: string, fileName: string): Promise<CompiledPdf> {
  return compileImagesToPdf([imageDataUrl], fileName);
}
