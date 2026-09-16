/**
 * Tests for vault-wide search: the accounting sentence, and the wiring guards.
 *
 * The ranking is tested in docSearch.test.ts and the indexing in
 * docIndex.test.ts. What is left here is the part that is only true because
 * several files agree with each other — and the one line standing between a
 * lease's text and an unexpiring browser cache.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchVault, coverageLine, MAX_HITS, type VaultSearchOutcome } from './vaultSearch';
import type { IndexableDoc } from './docIndex';

const root = join(import.meta.dirname, '../..');
const decomment = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const outcome = (o: Partial<VaultSearchOutcome> = {}): VaultSearchOutcome => ({
  query: 'notice', hits: [], searched: 5, needsOcr: [], failed: [], skipped: 0, ...o,
});

// ── the accounting sentence ────────────────────────────────────────────────
//
// This is what makes "nothing found" readable. Each branch is a different
// reason the sweep was incomplete, and they must not be conflated.

assert.equal(coverageLine(outcome()), '',
  'a clean sweep says nothing — silence is the honest signal that nothing needs qualifying');

assert.match(coverageLine(outcome({ needsOcr: [{ docId: 'a', name: 'Lease scan' }] })),
  /1 scan has no readable text.*Lease scan/,
  'a single unreadable scan is named, because the user can act on knowing WHICH one');

assert.match(
  coverageLine(outcome({ needsOcr: [{ docId: 'a', name: 'A' }, { docId: 'b', name: 'B' }] })),
  /2 scans have no readable text/,
  'several are counted rather than listed — a chat bubble is not a manifest');

assert.match(coverageLine(outcome({ failed: [{ docId: 'a', name: 'Lease' }] })),
  /wouldn't load.*Lease/,
  'a document that failed to load is reported as such');

assert.match(coverageLine(outcome({ skipped: 3 })), /3 documents are outside what I can search/,
  'policy exclusions are counted out loud, not silently absorbed');

{
  // The three reasons are genuinely different problems with different fixes:
  // re-scan it, try again, or nothing (it is out of bounds on purpose). A line
  // that merged them into "3 documents weren't searched" would be useless.
  const all = coverageLine(outcome({
    needsOcr: [{ docId: 'a', name: 'A' }],
    failed: [{ docId: 'b', name: 'B' }],
    skipped: 2,
  }));
  assert.match(all, /no readable text/);
  assert.match(all, /wouldn't load/);
  assert.match(all, /outside what I can search/);
}

// ── searchVault: the counts describe TEXT searched, not files seen ──────────

{
  const docs: IndexableDoc[] = [
    { id: 'lease', name: 'Lease', category: 'Housing', fileType: 'application/pdf', src: 'x/lease', contentHash: '1' },
    { id: 'photo', name: 'Boiler photo', category: 'Housing', fileType: 'image/jpeg', src: 'x/photo', contentHash: '2' },
    { id: 'bloods', name: 'Blood test', category: 'Medical', fileType: 'application/pdf', src: 'x/bloods', contentHash: '3' },
  ];
  // buildIndex's real extractor is not reachable in node; searchVault owns the
  // composition, so drive it through the same seam docIndex exposes by giving
  // the photo no text and the medical document no chance to be opened at all.
  const { buildIndex } = await import('./docIndex');
  const idx = await buildIndex('fam', docs, {
    extract: async (src: string) => ({
      pages: src.endsWith('lease')
        ? [{ n: 1, text: 'The notice period is two months.' }]
        : [],
    }),
  });
  // The medical document IS in the sweep now (v345 put it behind
  // MEDICAL_READER_ENABLED, which is on) — that is the point of the change, and
  // this asserts the search and the reader agree about scope rather than the
  // search quietly seeing less than the reader will open.
  assert.equal(idx.skipped, 0, 'nothing in a family space is out of scope for the sweep');
  assert.deepEqual(idx.needsOcr.map(d => d.docId).sort(), ['bloods', 'photo'],
    'the photo and the text-layerless report are in the index by name only');

  const r = await searchVault('fam', docs, 'notice period', {});
  // searchVault uses the real extractor, which cannot fetch here — every
  // document fails, and that is the assertion worth making:
  assert.equal(r.searched, 0,
    'when nothing could be read, searched is 0 — never the number of files it '
    + 'LOOKED at. "Searched 3 documents, found nothing" would be a lie that '
    + 'sounds like an answer.');
  assert.equal(r.skipped, 0, 'nothing was out of bounds');
  assert.equal(r.failed.length, 2,
    'both PDFs failed: extractDocText answers for an image without fetching it, so a '
    + 'photograph is an OCR case rather than a network failure even when the network is gone');
  assert.equal(r.needsOcr.length, 1, 'and the photograph is reported as needing OCR');

  // THE SCOPE CONTROL. Every count above is now 0-or-all, which a searchVault
  // that had lost its eligibility filter entirely would also produce. A
  // business space is the denial that holds unconditionally, so this is what
  // proves the filter is still there and still consulted.
  const biz = await searchVault('fam', docs, 'notice period', { isBusinessSpace: true });
  assert.equal(biz.skipped, docs.length, 'in a business space every document is out of bounds');
  assert.equal(biz.searched, 0, 'and nothing is searched');
  const line = coverageLine(r);
  assert.match(line, /wouldn't load/);
  assert.match(line, /no readable text/);
}

// ── the cap ────────────────────────────────────────────────────────────────

assert.ok(MAX_HITS > 0 && MAX_HITS <= 10,
  'the hit cap has to be small enough to read on a phone and big enough to answer '
  + '"which of these is it"');

// ── THE CHOKEPOINT: search passages must never be persisted ────────────────
//
// slimForCloud feeds BOTH storage paths and spreads ...m, so a field it does
// not destructure away is a field it SAVES. For search that means a lease's
// clauses in a localStorage cache nothing expires — and, worse, replayed into
// the chat model on the next message, handing it exactly the document text this
// whole design keeps away from it.

const chatSrc = readFileSync(join(root, 'src/components/AIChatbot.tsx'), 'utf8');

const destructureOf = (src: string): string | null => {
  // Decomment FIRST and stay inside that string — see aiReveal.test.ts, where
  // mixing a stripped-text index with an original-text slice made this guard
  // silently read the wrong region.
  const clean = decomment(src);
  const at = clean.indexOf('const slimForCloud');
  if (at < 0) return null;
  const open = clean.indexOf('({', at);
  const close = clean.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return clean.slice(open, close).replace(/\s+/g, ' ');
};

const params = destructureOf(chatSrc);
assert.ok(params, 'slimForCloud not found — this guard has stopped guarding anything');
for (const field of ['search', 'searchKey', 'searchPending', 'searchProgress', 'searchResult', 'searchError']) {
  assert.ok(new RegExp(String.raw`\b${field}\b`).test(params!),
    `slimForCloud must destructure \`${field}\` off the message. It spreads ...m, so an `
    + 'unnamed field is a saved one — and searchResult carries verbatim passages out of '
    + "the family's documents.");
}

// The control. Without it the loop above would pass against any file at all.
const withoutIt = 'const slimForCloud = (msgs: ChatMessage[]) =>\n  msgs.map(({ images, ...m }) => {';
assert.ok(!/\bsearchResult\b/.test(destructureOf(withoutIt)!),
  'CONTROL FAILED: the guard matches a slimForCloud that does NOT strip searchResult, so '
  + 'it cannot detect the regression it exists to detect');

const dbSrc = decomment(readFileSync(join(root, 'src/utils/db.ts'), 'utf8'));
const saveFn = dbSrc.slice(dbSrc.indexOf('export async function saveChatHistory'));
assert.ok(!/\bsearchResult\b/.test(saveFn.slice(0, 1200)),
  'saveChatHistory must not pick up `searchResult` — its explicit field list is the second '
  + 'of the two guarantees that document text never reaches Firestore');

// ── the server contract and the prompt must agree ──────────────────────────

const serverSrc = readFileSync(join(root, 'server.js'), 'utf8');

assert.match(serverSrc, /\{"readDoc":[^\n]*"search": SearchRequest \| null/,
  'the declared JSON shape must include "search", or the model has no field to put a query in');
assert.match(serverSrc, /parsed\.search = sanitizeSearch\(/,
  'sanitizeSearch must actually be called — an unwired sanitiser is decoration');
assert.match(serverSrc, /SEARCHING EVERY DOCUMENT AT ONCE/,
  'the prompt must explain the field; a contract with no guidance produces null forever');

{
  // The failure this pairing exists to prevent: readDoc takes the user's whole
  // QUESTION and search takes a search PHRASE. Swap them and the reader answers
  // a keyword while the search hunts for the word "what".
  const at = serverSrc.indexOf('SEARCHING EVERY DOCUMENT AT ONCE');
  const section = serverSrc.slice(at, at + 4000);
  assert.match(section, /SEARCH PHRASE, not a question/,
    'the prompt must say the query is a phrase rather than a question');
  assert.match(section, /only one of the two per reply/,
    'the prompt must forbid emitting readDoc and search together');
  assert.match(section, /never say the vault does or does not contain something/,
    'the prompt must forbid the one sentence a model that sees no results cannot support');
}

// The client must never send the query anywhere but its own search.
assert.ok(!/doc-search|\/api\/search/.test(chatSrc),
  'there is no server search endpoint and there must not be one — the sweep is local, and '
  + 'a network call here would put document text back on the wire');

console.log('vaultSearch.test.ts — all assertions passed');
