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

// Same OS share sheet as shareFile, but for a bulk selection — Web Share API
// Level 2 accepts a files array, so this hands ALL of them to whichever app the
// user picks (Mail, WhatsApp, AirDrop…) in one go, instead of one at a time.
export async function shareMultiple(items: { src: string; name: string }[]): Promise<void> {
  try {
    const files = await Promise.all(items.map((it) => srcToFile(it.src, it.name)));
    const title = `${files.length} document${files.length === 1 ? '' : 's'}`;
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title });
    } else {
      await navigator.share({ title });
    }
  } catch { /* user cancelled, or sharing unsupported for these files — no-op */ }
}

// Desktop (and anywhere else navigator.share doesn't exist) has no share sheet
// at all, so a bulk selection needs a different escape hatch: bundle everything
// into one .zip and download it, ready to attach by hand.
export async function downloadZip(items: { src: string; name: string }[], zipName = 'documents.zip'): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const it of items) {
    const res = await fetch(it.src);
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || '').replace('jpeg', 'jpg');
    let base = (it.name || 'document').replace(/[\\/:*?"<>|]+/g, '').trim() || 'document';
    if (ext && !base.toLowerCase().endsWith(`.${ext}`)) base = `${base}.${ext}`;
    let entryName = base;
    let n = 2;
    while (used.has(entryName)) {
      const dot = base.lastIndexOf('.');
      entryName = dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
      n++;
    }
    used.add(entryName);
    zip.file(entryName, blob);
  }
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = zipName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
