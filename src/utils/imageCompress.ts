// Downscale an image (data URL) to a small avatar thumbnail so it fits well
// inside a Firestore member record (which caps at ~1MB). A full phone photo as
// base64 is several MB and silently fails to save — this keeps it ~10-40KB.
export async function compressImageToAvatar(src: string, maxDim = 256, quality = 0.72): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(src); return; }
        ctx.drawImage(img, 0, 0, width, height);
        try { resolve(canvas.toDataURL('image/jpeg', quality)); }
        catch { resolve(src); }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    } catch {
      resolve(src);
    }
  });
}
