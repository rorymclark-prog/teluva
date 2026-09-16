/**
 * Search every filed document at once.
 * ---------------------------------------------------------------------------
 *
 * The document reader answers "what does THIS lease say about notice?" — you
 * name the document, it quotes it. This answers the question that comes first
 * and had no home: "which of my documents mentions the notice period?"
 *
 * ── WHERE THIS RUNS, AND WHY IT MATTERS ────────────────────────────────────
 *
 * Entirely in the browser. The query, the index, the ranking and the passages
 * never leave the device.
 *
 * That is not an optimisation, it is the whole design. The chat model's job
 * stops at deciding that a question is a search and writing the query — the
 * same shape as the reader, where it contributes a document id and a phrase and
 * sees nothing that comes back. It never receives a document's text, so it
 * cannot paraphrase a lease, cannot summarise a will, and cannot state that a
 * document "doesn't mention" something. Every line the user reads under a
 * search result is a slice cut out of text this browser extracted, and that
 * property is enforced by construction in docSearch.ts rather than requested in
 * a prompt.
 *
 * It also means a vault-wide search costs nothing per query. The AI action is
 * spent once, on the message that decided to search; the sweep itself is free
 * and repeatable, which is what makes "just try another word" a reasonable
 * thing to tell someone.
 *
 * ── WHAT A RESULT IS AND IS NOT ────────────────────────────────────────────
 *
 * A ranked list of documents with the matching passages, and the honest
 * accounting that goes with it: how many documents were actually searched, how
 * many scans have no text layer, how many failed to load, how many are out of
 * bounds by policy. Without those numbers "no results" is unreadable — it could
 * mean the vault does not contain the answer, or that the six documents most
 * likely to contain it are photographs.
 *
 * It is NOT an answer. Nothing here interprets, and no result is ever the last
 * word: the per-document reader stays one tap away and it is the thing that
 * reads a whole document properly, OCR included.
 */

import { buildIndex, type IndexableDoc, type IndexProgress } from './docIndex';
import { searchDocs, type SearchHit } from './docSearch';

export interface VaultSearchOutcome {
  query: string;
  hits: SearchHit[];
  /** Documents whose CONTENTS were searched. */
  searched: number;
  /** In the index by name only — a scan with no text layer. */
  needsOcr: { docId: string; name: string }[];
  /** Could not be loaded at all this run. */
  failed: { docId: string; name: string }[];
  /** Excluded by policy: medical/health, business space, insurance-while-dark. */
  skipped: number;
}

/**
 * The most hits worth putting in a chat bubble.
 *
 * A search that returns fourteen documents has not answered anything; it has
 * moved the reading job back to the person who asked. Six is enough to cover a
 * real "which of these is it" and few enough to scan on a phone. Anything below
 * the cut is still reachable by narrowing the words, which the card says.
 */
export const MAX_HITS = 6;

export interface VaultSearchOptions {
  isBusinessSpace?: boolean;
  onProgress?: (p: IndexProgress) => void;
  signal?: AbortSignal;
  maxHits?: number;
}

/**
 * Index what needs indexing, then search everything.
 *
 * `familyId` scopes the on-device cache; two spaces on one laptop must not read
 * each other's extracted text.
 */
export async function searchVault(
  familyId: string,
  docs: IndexableDoc[],
  query: string,
  opts: VaultSearchOptions = {},
): Promise<VaultSearchOutcome> {
  const q = (query || '').trim();
  const index = await buildIndex(familyId, docs, {
    isBusinessSpace: opts.isBusinessSpace,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

  const hits = q ? searchDocs(index.docs, q) : [];
  return {
    query: q,
    hits: hits.slice(0, opts.maxHits ?? MAX_HITS),
    // The count is of documents whose TEXT was searched, so a vault of twenty
    // photographs reports "searched 0" rather than "searched 20, found
    // nothing" — the second sentence is a lie that sounds like an answer.
    searched: index.docs.filter(d => d.pages.some(p => p.text.trim())).length,
    needsOcr: index.needsOcr,
    failed: index.failed,
    skipped: index.skipped,
  };
}

/**
 * The one-line accounting under a result, in plain words.
 *
 * Split out from the component because it is the sentence that decides whether
 * "nothing found" is trustworthy, and it deserves to be tested on its own.
 * Returns '' when there is nothing to qualify — a clean sweep says so by
 * staying quiet rather than reassuring the user at length.
 */
export function coverageLine(r: VaultSearchOutcome): string {
  const parts: string[] = [];
  if (r.needsOcr.length) {
    parts.push(r.needsOcr.length === 1
      ? `1 scan has no readable text, so only its name was searched (${r.needsOcr[0].name})`
      : `${r.needsOcr.length} scans have no readable text, so only their names were searched`);
  }
  if (r.failed.length) {
    parts.push(r.failed.length === 1
      ? `1 document wouldn't load (${r.failed[0].name})`
      : `${r.failed.length} documents wouldn't load`);
  }
  if (r.skipped) {
    parts.push(r.skipped === 1
      ? '1 document is outside what I can search'
      : `${r.skipped} documents are outside what I can search`);
  }
  if (!parts.length) return '';
  return parts.join('; ') + '.';
}
