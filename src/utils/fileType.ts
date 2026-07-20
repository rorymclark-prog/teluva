// Recognise a PDF from a src string even without an explicit mimeType: a base64
// data URL says so directly, and a Firebase Storage download URL keeps the
// original filename (incl. extension) in its path (see uploadVaultFile).
export function looksLikePdf(src: string, mimeType?: string): boolean {
  if (mimeType) return mimeType === 'application/pdf';
  if (src.startsWith('data:application/pdf')) return true;
  return /\.pdf(\?|#|$)/i.test(src);
}
