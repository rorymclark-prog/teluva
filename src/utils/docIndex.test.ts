/**
 * Tests for the on-device document index.
 *
 * Node has no IndexedDB, so openDb() resolves null here and every read is a
 * miss. That is not a limitation of the test — it IS the private-browsing /
 * site-data-blocked path, and running the whole suite through it proves the
 * cache is an optimisation rather than a dependency: with the store completely
 * absent, buildIndex must still return a correct, complete, searchable set.
 *
 * Extraction is injected. The real extractDocText fetches over the network and
 * runs pdfjs; what needs testing here is the driver's bookkeeping — what it
 * skips, what it reports, what it refuses to swallow.
 */

import assert from 'node:assert/strict';
import { hashOf, indexable, buildIndex, type IndexableDoc } from './docIndex';
import { searchDocs } from './docSearch';
import { MEDICAL_READER_ENABLED } from '../config/features';

const doc = (o: Partial<IndexableDoc> & { id: string }): IndexableDoc => ({
  name: o.name ?? o.id,
  category: o.category ?? 'Housing',
  fileType: o.fileType ?? 'application/pdf',
  src: o.src ?? `https://example.test/${o.id}.pdf`,
  ...o,
});

/** An extractor that serves canned text and counts how often it is asked. */
function fakeExtractor(text: Record<string, string[]>) {
  const calls: string[] = [];
  const fn = async (src: string) => {
    calls.push(src);
    const id = src.split('/').pop()!.replace(/\.\w+$/, '');
    const pages = (text[id] || []).map((t, i) => ({ n: i + 1, text: t }));
    return { pages };
  };
  return { fn, calls };
}

// ── hashOf ─────────────────────────────────────────────────────────────────

assert.equal(hashOf(doc({ id: 'a', contentHash: 'abc123' })), 'abc123',
  'contentHash is the identity when present');

assert.equal(
  hashOf(doc({ id: 'a', fileSize: 4096, uploadedAt: '2026-01-02T00:00:00Z' })),
  's4096:2026-01-02T00:00:00Z',
  'falls back to size+date for documents saved before contentHash existed');

assert.notEqual(
  hashOf(doc({ id: 'a', fileSize: 4096, uploadedAt: '2026-01-02T00:00:00Z' })),
  hashOf(doc({ id: 'a', fileSize: 8192, uploadedAt: '2026-01-02T00:00:00Z' })),
  'a replaced file of a different size gets a different identity');

// ── eligibility: the policy the reader enforces, enforced here too ─────────

// Medical/Health follow MEDICAL_READER_ENABLED rather than a fixed answer —
// see docReadEligibility.test.ts for why. indexable() deliberately wraps
// canAskAboutDocument() instead of restating the policy, so what the reader
// will open is exactly what the search will index; asserting the flag here is
// what proves that wrapping is still in place, in either posture.
assert.equal(indexable(doc({ id: 'm', category: 'Medical' }), false), MEDICAL_READER_ENABLED,
  'Medical indexing follows the reader flag, because search must not see more than the reader does');
assert.equal(indexable(doc({ id: 'h', category: 'Health' }), false), MEDICAL_READER_ENABLED,
  'Health — the member-document vocabulary for the same class — follows the same flag');
assert.equal(indexable(doc({ id: 'l', category: 'Housing' }), true), false,
  'nothing in a business space is indexed');

// THE CONTROL. A function that returned false unconditionally would satisfy
// the business assertion above (and the medical ones too, whenever the flag is
// off). This is the one that fails if the filter is simply broken shut.
assert.equal(indexable(doc({ id: 'l', category: 'Housing' }), false), true,
  'CONTROL: an ordinary housing document IS indexable — the filter can say yes');

// ── an ineligible document is never even FETCHED ───────────────────────────
//
// The property this protects is not "it does not appear in results" — it is
// that the policy is applied before the network, so an ineligible document's
// bytes are never pulled into the browser at all. Business space is the right
// case to prove it with: it is the one denial that holds unconditionally, so
// this assertion cannot be silently turned off by flipping a reader flag the
// way a medical fixture could.

{
  const { fn, calls } = fakeExtractor({ ledger: ['Turnover 2026: EUR 41,000.'] });
  const res = await buildIndex('fam-1', [
    doc({ id: 'ledger', name: 'Company ledger', contentHash: 'b1' }),
  ], { extract: fn, isBusinessSpace: true });

  assert.equal(res.skipped, 1, 'a business-space document is skipped');
  assert.equal(res.docs.length, 0, 'and nothing is returned as searchable');
  assert.equal(calls.length, 0,
    'a skipped document is never even fetched — the policy holds before the network, not after');
}

// ── the driver ─────────────────────────────────────────────────────────────

{
  const { fn, calls } = fakeExtractor({
    lease: ['The tenant shall give two months notice.', 'Deposit: EUR 2400.'],
    scan: [],                       // a photographed document: no text layer
    report: ['Term ends 30 June.'],
  });
  const res = await buildIndex('fam-1', [
    doc({ id: 'lease', name: 'Apartment lease', contentHash: 'h1' }),
    doc({ id: 'scan', name: 'Scanned boiler warranty', fileType: 'image/jpeg', contentHash: 'h2' }),
    doc({ id: 'report', name: 'School report', category: 'Education', contentHash: 'h3' }),
  ], { extract: fn });

  assert.equal(res.skipped, 0, 'nothing eligible was skipped');
  assert.equal(res.extracted, 3, 'the three eligible documents were extracted');
  assert.equal(res.docs.length, 3, 'and all three are returned as searchable');

  assert.deepEqual(res.needsOcr.map(d => d.docId), ['scan'],
    'the text-layerless scan is REPORTED, not silently dropped');
  assert.ok(res.docs.some(d => d.docId === 'scan'),
    'and it is still in the searchable set, so its NAME can still find it');

  // The promise the needsOcr report makes to the user: findable by name.
  const byName = searchDocs(res.docs, 'boiler warranty');
  assert.equal(byName[0]?.docId, 'scan',
    'a scan with no text layer is still found by its name');
  assert.equal(byName[0]?.snippets.length, 0,
    'with no passages, because there is no text to quote — the hit is honest about that');

  const byContent = searchDocs(res.docs, 'two months notice');
  assert.equal(byContent[0]?.docId, 'lease', 'and the text documents are searched by content');
}

// ── failures are reported, never mistaken for "nothing in there" ────────────

{
  const fn = async (src: string) => {
    if (src.includes('broken')) throw new Error('network down');
    return { pages: [{ n: 1, text: 'ordinary text' }] };
  };
  const res = await buildIndex('fam-1', [
    doc({ id: 'broken', name: 'Vehicle registration', contentHash: 'h1' }),
    doc({ id: 'fine', name: 'Warranty', contentHash: 'h2' }),
  ], { extract: fn });

  assert.deepEqual(res.failed.map(d => d.docId), ['broken'],
    'a hard failure is reported by name');
  assert.ok(!res.docs.some(d => d.docId === 'broken'),
    'and the failed document does NOT enter the index as an empty one — an empty '
    + 'document and an unread one must never look the same to the search');
  assert.equal(res.docs.length, 1, 'one document failing does not abandon the rest');
  assert.equal(res.needsOcr.length, 0,
    'a failure is not an OCR case: "we could not fetch it" and "it has no text layer" '
    + 'are different problems with different fixes');
}

// ── progress and abort ─────────────────────────────────────────────────────

{
  const { fn } = fakeExtractor({ a: ['x'], b: ['y'], c: ['z'] });
  const seen: string[] = [];
  const res = await buildIndex('fam-1', [
    doc({ id: 'a', contentHash: '1' }), doc({ id: 'b', contentHash: '2' }), doc({ id: 'c', contentHash: '3' }),
  ], { extract: fn, onProgress: p => seen.push(`${p.done}/${p.total}`) });

  assert.equal(seen[0], '0/3', 'progress starts at zero of the ELIGIBLE count');
  assert.equal(seen[seen.length - 1], '3/3', 'and finishes complete');
  assert.equal(res.docs.length, 3);
}

{
  const ctrl = new AbortController();
  let n = 0;
  const fn = async () => {
    if (++n === 2) ctrl.abort();
    return { pages: [{ n: 1, text: 'x' }] };
  };
  const res = await buildIndex('fam-1', [
    doc({ id: 'a', contentHash: '1' }), doc({ id: 'b', contentHash: '2' }), doc({ id: 'c', contentHash: '3' }),
  ], { extract: fn, signal: ctrl.signal });

  assert.equal(res.docs.length, 2,
    'aborting stops the sweep and returns what was already indexed, rather than throwing away the work');
}

// ── an empty vault is not an error ─────────────────────────────────────────

{
  const res = await buildIndex('fam-1', [], { extract: async () => ({ pages: [] }) });
  assert.deepEqual(res.docs, []);
  assert.equal(res.skipped, 0);
  assert.deepEqual(searchDocs(res.docs, 'anything'), [],
    'and searching an empty index returns nothing rather than blowing up');
}

console.log('docIndex.test.ts — all assertions passed');
