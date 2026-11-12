/** Produce a small display cover; the selected original is never modified. */
export async function createAtlasCover(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error('This browser cannot open that photo. Export a JPEG or PNG and try again.'); });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This photo has no readable image.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo preview is unavailable in this browser.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const cover = canvas.toDataURL('image/jpeg', 0.85);
    if (!cover.startsWith('data:image/jpeg;base64,')) throw new Error('Could not prepare this photo.');
    return cover;
  } finally { URL.revokeObjectURL(url); }
}
