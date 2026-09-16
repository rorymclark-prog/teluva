/* ---------------------------------------------------------------------------
 * Key facts — client half.
 *
 * "The insurance policy saved had info like the contact number and what
 * reference to quote — extract that automatically, a summary of key features
 * at a push button." This is that button's pipeline: reuse the reader's
 * page collection (text layer + OCR fallback, one implementation —
 * collectDocPages), send the text to /api/doc-key-facts, store what survives
 * the server's verbatim filter on the vault document itself.
 *
 * Stored, not recomputed: extraction costs an AI call and the facts of a PDF
 * do not change. keyFactsHash records WHICH bytes the facts came from, so a
 * replaced scan shows the button again instead of last year's phone number.
 * ------------------------------------------------------------------------- */

import { auth } from '../lib/firebase';
import { collectDocPages, DOC_READ_CLIENT_TIMEOUT_MS, type DocReaderTarget } from './docReader';
import { loadDocuments, saveDocuments } from './db';
import { KEY_FACTS_VERSION } from './trip';
import type { DocKeyFact, VaultDocument } from '../types';

export type KeyFactsOutcome =
  | { kind: 'result'; facts: DocKeyFact[] }
  | { kind: 'error'; message: string };

export function vaultDocToReaderTarget(doc: VaultDocument): DocReaderTarget {
  return {
    name: doc.name,
    category: doc.category,
    fileType: doc.fileType,
    src: doc.downloadUrl,
    storagePath: doc.storagePath,
    contentHash: doc.contentHash,
  };
}

// "Has extraction already run for these bytes?" lives in utils/trip.ts
// (keyFactsCurrent) — it is pure and the trip pack's tests exercise it there.

export async function extractKeyFacts(target: DocReaderTarget): Promise<KeyFactsOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      extractKeyFactsInner(target),
      new Promise<KeyFactsOutcome>((resolve) => {
        timer = setTimeout(() => resolve({
          kind: 'error',
          message: `Reading “${target.name}” took too long and I stopped waiting — trying again often works.`,
        }), DOC_READ_CLIENT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function extractKeyFactsInner(target: DocReaderTarget): Promise<KeyFactsOutcome> {
  const collected = await collectDocPages(target);
  if (collected.kind !== 'ok') return { kind: 'error', message: collected.message };

  try {
    const token = await auth.currentUser?.getIdToken();
    const resp = await fetch('/api/doc-key-facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        pages: collected.pages,
        docName: target.name,
        verifiable: collected.coverage.verifiable,
      }),
    });
    if (!resp.ok) {
      let msg = `Could not read the document (${resp.status}).`;
      try { const j = await resp.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
      return { kind: 'error', message: msg };
    }
    const data = await resp.json();
    const facts: DocKeyFact[] = (Array.isArray(data?.facts) ? data.facts : [])
      .filter((f: unknown): f is DocKeyFact => {
        const x = f as DocKeyFact;
        return !!x && typeof x.label === 'string' && typeof x.value === 'string';
      })
      // Carry "who" through — v5's attributions were produced by the server
      // and then died RIGHT HERE, in a map that only knew the fields it was
      // first written with. Explicit fields (not spread) is still right —
      // this is the boundary that keeps unknown server output from being
      // persisted — but every field the type declares must be carried.
      .map((f: DocKeyFact) => ({
        label: f.label,
        value: f.value,
        ...(typeof f.who === 'string' && f.who ? { who: f.who } : {}),
        verified: f.verified === true,
      }));
    return { kind: 'result', facts };
  } catch (err: unknown) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'Could not read this document — please try again.',
    };
  }
}

/**
 * Persist extracted facts onto the vault document. Loads fresh and saves with
 * a base so a concurrent edit elsewhere merges instead of being clobbered —
 * the same discipline every other vault write uses.
 */
export async function saveKeyFacts(docId: string, facts: DocKeyFact[]): Promise<VaultDocument[] | null> {
  const current = await loadDocuments();
  const target = current.find((d) => d.id === docId);
  if (!target) return null;
  const today = new Date().toISOString().slice(0, 10);
  const next = current.map((d) => (
    d.id === docId
      ? { ...d, keyFacts: facts, keyFactsAt: today, keyFactsVersion: KEY_FACTS_VERSION, ...(d.contentHash ? { keyFactsHash: d.contentHash } : {}) }
      : d
  ));
  const ok = await saveDocuments(next, current);
  return ok === false ? null : next;
}
