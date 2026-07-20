// One shared "is this already saved?" check, used everywhere a document can
// be created (AI chat, per-member upload, hub Document Vault upload) — so
// duplicate detection behaves the same way no matter which path someone uses.

export interface DupMatch<T> {
  doc: T;
  confidence: 'definite' | 'probable';
}

type Signature = { fileName: string; fileSize: number; contentHash?: string };

// SHA-256 over the raw bytes — a few ms even at this app's ~20MB upload cap,
// no library needed (Web Crypto is available in every browser this app targets).
export async function computeFileHash(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Convenience wrapper for the base64 data: URLs already used throughout this
// app (AI-chat attachments, the per-member upload form) instead of a raw Blob.
export async function hashDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  return computeFileHash(await res.blob());
}

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

// definite = identical bytes (same file, any filename — catches a re-scan
// saved under a different name). probable = same filename + size, used as a
// fallback for documents saved before contentHash existed.
export function findLikelyDuplicate<T extends Signature>(newDoc: Signature, existing: T[]): DupMatch<T> | null {
  if (newDoc.contentHash) {
    const hit = existing.find((d) => d.contentHash === newDoc.contentHash);
    if (hit) return { doc: hit, confidence: 'definite' };
  }
  const hit = existing.find(
    (d) => !d.contentHash && normalizeName(d.fileName) === normalizeName(newDoc.fileName) && d.fileSize === newDoc.fileSize,
  );
  return hit ? { doc: hit, confidence: 'probable' } : null;
}
