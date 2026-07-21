// One shared "is this already saved?" check, used everywhere a document can
// be created (AI chat, per-member upload, hub Document Vault upload) — so
// duplicate detection behaves the same way no matter which path someone uses.

export interface DupMatch<T> {
  doc: T;
  confidence: 'definite' | 'probable' | 'probable-type';
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

// Curated families of alternate names/languages for the SAME real-world
// document type — catches the case a hash/filename check structurally can't:
// a "Meldezettel" rescanned weeks later and titled "Central Register of
// Residents Confirmation" shares no bytes and no filename with the original,
// but is obviously the same document to a human. Same idea as MemberIDs.tsx's
// IDENTITY_SCAN_PATTERNS (which links a scan to a structured field) — this is
// the sibling check for "is this a second copy of the same TYPE of document".
// Extend this list as new real-world naming variants surface.
const DOCUMENT_TYPE_FAMILIES: RegExp[] = [
  /meldezettel|anmeldebest|register.*resident|residence.*registration|registration.*confirmation/i,
  /passport|reisepass/i,
  /national\s*id|id\s*card|personalausweis|smart id|id book/i,
  /driver|f(?:ü|ue)hrerschein|driving licen[cs]e/i,
  /birth cert|geburtsurkunde/i,
  /marriage cert|heiratsurkunde|marriage registration/i,
  /e-?card/i,
  /tax|steuer|sars/i,
];

// Caller must pre-scope `existing` to whatever should count as "the same
// document slot" (typically: same person, same category) — this function
// does no member/category filtering itself, so passing the wrong scope would
// cross-match e.g. two different people's passports as duplicates of each
// other. Independent of findLikelyDuplicate — call both and prefer whichever
// (if either) returns a match.
export function findLikelyDuplicateByType<T extends { name: string }>(newName: string, existing: T[]): DupMatch<T> | null {
  const family = DOCUMENT_TYPE_FAMILIES.find((p) => p.test(newName));
  if (!family) return null;
  const hit = existing.find((d) => family.test(d.name));
  return hit ? { doc: hit, confidence: 'probable-type' } : null;
}
