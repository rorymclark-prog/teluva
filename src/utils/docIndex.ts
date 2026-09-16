/**
 * The on-device text index the vault search runs over.
 * ---------------------------------------------------------------------------
 *
 * utils/docSearch.ts does the ranking; this gets it something to rank.
 *
 * Extracting a document's text is the expensive half — fetch the file from
 * Storage, run pdfjs over it, and for a scan, rasterise and OCR. Doing that for
 * thirty documents every time somebody asks a question is not a feature, it is
 * a hang. So text is extracted ONCE per document and cached in IndexedDB, keyed
 * by the document's contentHash so a replaced scan re-indexes itself and a
 * stale entry can never answer for a file that has changed underneath it.
 *
 * ── WHY INDEXEDDB AND NOT FIRESTORE ────────────────────────────────────────
 *
 * Because the alternative is putting the full text of every lease, will and
 * school report into the database at rest, in a product that goes to the
 * trouble of encrypting an ID number. The cached text never leaves this device,
 * which keeps the whole search — question, ranking and result — local. The cost
 * is that a second device indexes again on first use. That is a slower first
 * search, once, in exchange for not creating a new copy of everything the
 * family owns in a place they did not ask for one.
 *
 * ── WHAT IS DELIBERATELY NOT INDEXED ───────────────────────────────────────
 *
 * Anything canAskAboutDocument() refuses: medical and health documents (GDPR
 * special-category data), insurance policies while the reader stays dark, and
 * every document in a business space. A local keyword search that surfaced
 * "your blood result mentions X" would be a second way into exactly the
 * material the reader was built to stay out of — a policy is not a policy if
 * one route enforces it and another quietly does not.
 *
 * ── OCR ────────────────────────────────────────────────────────────────────
 *
 * Not run here, on purpose. OCR is a server round trip that costs a metered AI
 * action per document, and spending thirty of them to answer one question the
 * user has not been quoted for is not a decision this module gets to make on
 * their behalf. Documents with no text layer are recorded as `needsOcr` and
 * REPORTED to the caller so the UI can say "4 scans weren't searched" — they
 * are still findable by name (docSearch indexes name and category), and the
 * per-document reader still reads them in full, OCR and all, when opened.
 */

import { extractDocText } from './docText';
import { canAskAboutDocument } from './docReadEligibility';
import type { IndexedDoc } from './docSearch';
import type { DocPage } from '../types';

const DB_NAME = 'teluva-doc-index';
const DB_VERSION = 1;
const STORE = 'docText';

/** One cached document. `familyId` scopes it — a device can hold two spaces. */
export interface IndexEntry {
  key: string;            // `${familyId}:${docId}`
  familyId: string;
  docId: string;
  name: string;
  category: string;
  hash: string;           // contentHash, or a fallback derived from size+date
  pages: DocPage[];
  /** No text layer anywhere — findable by name, not by contents. */
  needsOcr: boolean;
  indexedAt: number;
}

/** What the caller hands in: enough to identify, fetch and gate a document. */
export interface IndexableDoc {
  id: string;
  name: string;
  category: string;
  fileType: string;
  /** downloadUrl (vault) or a data: URL (member documents). */
  src: string;
  contentHash?: string;
  fileSize?: number;
  uploadedAt?: string;
}

function keyOf(familyId: string, docId: string) { return `${familyId}:${docId}`; }

/**
 * A stable identity for the file's CONTENT.
 *
 * contentHash is the real answer, but it is absent on everything saved before
 * that field existed. Size+date is a weaker fallback and is honest about it:
 * it changes whenever the file is replaced by a different one, which is the
 * only property the cache actually needs.
 */
export function hashOf(doc: IndexableDoc): string {
  return doc.contentHash || `s${doc.fileSize ?? 0}:${doc.uploadedAt ?? ''}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      // Every failure path resolves null rather than rejecting. A browser in
      // private mode, or with site data blocked, must produce a search that is
      // slower (re-extracts each time) — never one that throws.
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
}

export function getEntry(familyId: string, docId: string): Promise<IndexEntry | null> {
  return tx<IndexEntry>('readonly', s => s.get(keyOf(familyId, docId)));
}

export function putEntry(entry: IndexEntry): Promise<unknown> {
  return tx('readwrite', s => s.put(entry));
}

export function deleteEntry(familyId: string, docId: string): Promise<unknown> {
  return tx('readwrite', s => s.delete(keyOf(familyId, docId)));
}

export async function allEntries(familyId: string): Promise<IndexEntry[]> {
  const all = await tx<IndexEntry[]>('readonly', s => s.getAll());
  return (all || []).filter(e => e && e.familyId === familyId);
}

/**
 * Forget everything cached for a family.
 *
 * Called on sign-out and on leaving a space: the extracted text of a family's
 * documents must not outlive access to the family. Without this, signing out on
 * a shared laptop leaves a searchable copy of the lease behind.
 */
export async function clearFamily(familyId: string): Promise<void> {
  for (const e of await allEntries(familyId)) await deleteEntry(familyId, e.docId);
}

/** Which documents may be indexed at all. */
export function indexable(doc: IndexableDoc, isBusinessSpace: boolean): boolean {
  return canAskAboutDocument({
    category: doc.category,
    name: doc.name,
    fileType: doc.fileType,
    isBusinessSpace,
  });
}

export interface IndexProgress {
  done: number;
  total: number;
  /** The document being worked on, for a line the user can read. */
  current: string;
}

export interface IndexResult {
  docs: IndexedDoc[];
  /** Indexed this run rather than served from cache. */
  extracted: number;
  /** Scans with no text layer: findable by name, contents not searched. */
  needsOcr: { docId: string; name: string }[];
  /** Fetch/parse failures. Reported, never silently treated as "empty". */
  failed: { docId: string; name: string }[];
  /** Ineligible by policy (medical, insurance-while-dark, business space). */
  skipped: number;
}

/**
 * Bring the index up to date for `docs` and return everything searchable.
 *
 * Cached entries whose hash still matches are reused untouched; everything else
 * is extracted now. Documents that fail and documents that need OCR are
 * RETURNED rather than dropped, because "we searched everything" and "we
 * searched everything we could read" are different sentences and the user is
 * entitled to the true one.
 */
export async function buildIndex(
  familyId: string,
  docs: IndexableDoc[],
  opts: {
    isBusinessSpace?: boolean;
    onProgress?: (p: IndexProgress) => void;
    signal?: AbortSignal;
    /** Seam for tests. Production always uses the real extractor. */
    extract?: (src: string, fileType: string) => Promise<{ pages: DocPage[] }>;
  } = {},
): Promise<IndexResult> {
  const extract = opts.extract || extractDocText;
  const eligible = docs.filter(d => d.id && d.src && indexable(d, !!opts.isBusinessSpace));
  const out: IndexResult = {
    docs: [], extracted: 0, needsOcr: [], failed: [],
    skipped: docs.length - eligible.length,
  };

  let done = 0;
  for (const doc of eligible) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.({ done, total: eligible.length, current: doc.name });
    const hash = hashOf(doc);
    let entry = await getEntry(familyId, doc.id);

    // A hash mismatch is a REPLACED FILE, not a cache miss to paper over: the
    // old text would answer questions about a document that no longer exists.
    if (!entry || entry.hash !== hash) {
      try {
        const { pages } = await extract(doc.src, doc.fileType);
        const usable = (pages || []).filter(p => p && typeof p.text === 'string');
        const hasText = usable.some(p => p.text.trim().length > 0);
        entry = {
          key: keyOf(familyId, doc.id),
          familyId,
          docId: doc.id,
          name: doc.name,
          category: doc.category,
          hash,
          pages: hasText ? usable : [],
          needsOcr: !hasText,
          indexedAt: Date.now(),
        };
        await putEntry(entry);
        out.extracted++;
      } catch {
        // A hard failure (network down, corrupt PDF). NOT cached — caching it
        // would make one bad afternoon permanent, and the next search would
        // report the document as unreadable forever without retrying.
        out.failed.push({ docId: doc.id, name: doc.name });
        done++;
        continue;
      }
    } else if (entry.name !== doc.name || entry.category !== doc.category) {
      // Renamed or refiled, same bytes: patch the metadata rather than
      // re-extracting. The name is a search field, so a stale one is a wrong
      // answer, not a cosmetic drift.
      entry = { ...entry, name: doc.name, category: doc.category };
      await putEntry(entry);
    }

    if (entry.needsOcr) out.needsOcr.push({ docId: doc.id, name: doc.name });
    out.docs.push({
      docId: entry.docId,
      name: entry.name,
      category: entry.category,
      hash: entry.hash,
      pages: entry.pages,
    });
    done++;
  }
  opts.onProgress?.({ done, total: eligible.length, current: '' });
  return out;
}
