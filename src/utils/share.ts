// Native OS share sheet (Web Share API) — how you AirDrop/WhatsApp/email/text a
// file from a phone. `canShare` gates the button off entirely on desktop
// browsers that don't implement navigator.share (most don't) — the existing
// Download button already covers that case, so hiding is the right fallback.
export const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

export async function srcToFile(src: string, name: string): Promise<File> {
  const res = await fetch(src);
  const blob = await res.blob();
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const safe = (name || 'document').replace(/[^\w\s.-]/g, '').trim() || 'document';
  return new File([blob], `${safe}.${ext}`, { type: blob.type || 'image/jpeg' });
}

export async function shareFile(src: string, name: string): Promise<void> {
  try {
    const file = await srcToFile(src, name);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      await navigator.share({ title: name, text: name });
    }
  } catch { /* user cancelled, or sharing unsupported for this file — no-op */ }
}
