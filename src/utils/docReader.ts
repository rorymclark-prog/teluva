/* ---------------------------------------------------------------------------
 * ONE implementation of "read this document and find these words".
 *
 * WHY THIS WAS PULLED OUT OF DocumentAskModal
 * -------------------------------------------
 * There are now two places a document gets read: the sheet you open from the
 * Document Vault, and the chat — where the answer is rendered inline, because
 * chat is meant to be the mouthpiece for the vault and being handed a button
 * that opens a second screen is not an answer.
 *
 * Those two are allowed to LOOK different. They are not allowed to BEHAVE
 * differently, and the parts that must not drift are exactly the parts that
 * carry the safety properties:
 *
 *   - the short-circuit when a document has no text layer, which is the only
 *     thing standing between the user and a confident "your lease doesn't
 *     mention that" about a document nobody managed to read;
 *   - trusting the coverage computed HERE from the actual file over anything
 *     echoed back by the server, since coverage is what decides whether a
 *     negative may be rendered at all;
 *   - treating 403 as an explainable refusal with its own wording rather than
 *     as a generic failure.
 *
 * A second hand-written copy of that in the chat would have been three
 * near-identical branches that drift apart at the first bug fix. So the async
 * pipeline lives here and returns a discriminated union; each caller decides
 * only how to draw it.
 * ------------------------------------------------------------------------- */

import { auth } from '../lib/firebase';
import { extractDocText } from './docText';
import type { DocCoverage, DocPassage, DocReadResult } from '../types';

export interface DocReaderTarget {
  name: string;
  category: string;
  fileType: string;
  /** data: or https: URL of the file itself. */
  src: string;
}

/** The server sends a reason code, never the words — the app owns the wording. */
export const BLOCKED_COPY: Record<string, string> = {
  insurance:
    "Insurance policies aren't readable here yet — that one's waiting on a legal review. Everything else in your vault works.",
  medical:
    "Medical documents aren't readable here. Open it to read it yourself — I'm not the right tool for a result that matters this much.",
  business: 'This is only available in family spaces for now.',
};

export type DocReadOutcome =
  | { kind: 'result'; result: DocReadResult }
  /** A deliberate, explainable refusal (403) — calm copy, not a red error. */
  | { kind: 'blocked'; message: string }
  /** We could not read the document at all. NOT the same as "nothing found". */
  | { kind: 'unreadable'; message: string; coverage: DocCoverage }
  | { kind: 'error'; message: string };

/**
 * Extract a document's text in the browser, sweep it server-side, and return
 * the passages.
 *
 * The document's text never touches the chat model: this is the same read-only
 * /api/doc-read call whichever entry point invoked it. Only the entry point
 * differs.
 */
export async function readDocument(
  doc: DocReaderTarget,
  question: string,
  opts: { isBusinessSpace?: boolean } = {},
): Promise<DocReadOutcome> {
  const q = question.trim();
  if (!q) return { kind: 'error', message: 'Nothing to search for.' };

  let pages;
  let coverage: DocCoverage;
  try {
    ({ pages, coverage } = await extractDocText(doc.src, doc.fileType));
  } catch (err: unknown) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Could not read this document — please try again.',
    };
  }

  // Short-circuit BEFORE spending a request. A photographed or fully-scanned
  // document has no text to sweep, and the honest answer is "I can't search
  // this", not "nothing matched". Those two sentences look identical to a user
  // and mean opposite things.
  if (coverage.pagesWithText === 0) {
    return {
      kind: 'unreadable',
      coverage,
      // Two shapes because docText.ts reaches here two ways: a real multi-page
      // PDF with no text layer anywhere (a photographed lease), and
      // unreadableCoverage() — pagesTotal 1 — for an image or a format we have
      // no extractor for. Claiming "all 1 pages are scanned images" for a .docx
      // would be a confident falsehood from the very code that exists to avoid
      // producing one.
      message:
        coverage.pagesTotal > 1
          ? `There is no text in this document for me to search — all ${coverage.pagesTotal} pages are scanned images. Open it and read it yourself; I would only be guessing.`
          : 'I couldn’t get any text out of this document — it may be a scan, a photo, or a format I can’t read. Open it and read it yourself; I would only be guessing.',
    };
  }

  try {
    const token = await auth.currentUser?.getIdToken();
    const resp = await fetch('/api/doc-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        pages,
        question: q,
        docName: doc.name,
        category: doc.category,
        spaceType: opts.isBusinessSpace ? 'business' : 'family',
        verifiable: coverage.verifiable,
      }),
    });

    if (resp.status === 403) {
      let reason: string | undefined;
      let serverMsg: string | undefined;
      try {
        const j = await resp.json();
        reason = typeof j?.reason === 'string' ? j.reason : undefined;
        serverMsg = typeof j?.error === 'string' ? j.error : undefined;
      } catch { /* body wasn't JSON — fall through to the generic line */ }
      return {
        kind: 'blocked',
        message: (reason && BLOCKED_COPY[reason]) || serverMsg || 'This document is not readable here.',
      };
    }

    if (!resp.ok) {
      // The server owns the wording for rate limits, quota and outages so the
      // whole app sounds like one voice.
      let msg = `Read failed (${resp.status})`;
      try { const j = await resp.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
      return { kind: 'error', message: msg };
    }

    const data: DocReadResult = await resp.json();
    return {
      kind: 'result',
      result: {
        passages: Array.isArray(data?.passages) ? (data.passages as DocPassage[]) : [],
        searchedFor: Array.isArray(data?.searchedFor) ? data.searchedFor : [],
        totalHits: typeof data?.totalHits === 'number' ? data.totalHits : 0,
        // Trust the coverage WE computed from the file over anything echoed
        // back: the provenance line and the "may I render a negative?" decision
        // both come from it, and they must describe the extraction that
        // actually happened rather than one the server inferred.
        coverage,
      },
    };
  } catch (err: unknown) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Could not read this document — please try again.',
    };
  }
}
