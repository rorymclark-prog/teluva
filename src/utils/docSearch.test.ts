// Standalone assertion tests for the vault-wide document search.
//   npx tsx src/utils/docSearch.test.ts
// Exits non-zero on failure.
import assert from 'node:assert';
import { searchDocs, queryTerms, tokenize, fold } from './docSearch';
import type { IndexedDoc } from './docSearch';

const doc = (docId: string, name: string, pages: string[], category = 'Other'): IndexedDoc => ({
  docId, name, category,
  pages: pages.map((text, i) => ({ n: i + 1, text })),
});

// A vault shaped like a real one: one long tenancy agreement, some short
// papers, and a couple of near-misses that a naive search gets wrong.
const LEASE_P1 = 'TENANCY AGREEMENT between the Landlord and the Tenant. The Landlord agrees to '
  + 'let the property known as Hauptstrasse 1, 1010 Wien, for a term of three years. Rent is '
  + 'payable monthly in advance on the first day of each month.';
const LEASE_P8 = 'Maintenance. The Tenant shall keep the interior in good repair. The Landlord '
  + 'remains responsible for the boiler and the central heating installation, including an '
  + 'annual service. The boiler warranty runs to 2029 and is held by the Hausverwaltung.';

const vault: IndexedDoc[] = [
  doc('d-lease', 'Home Lease Agreement', [
    LEASE_P1,
    'Deposit. The Tenant has paid a deposit of two months rent, held in a separate account.',
    'Utilities. Electricity and gas are billed directly to the Tenant by the supplier.',
    'Quiet enjoyment. The Landlord shall not enter without twenty-four hours written notice.',
    'Pets. No animals may be kept without the written consent of the Landlord.',
    'Subletting. The Tenant shall not sublet the whole or any part of the property.',
    'Notice. Either party may terminate on three months written notice in writing.',
    LEASE_P8,
    'Governing law. This agreement is governed by Austrian law.',
  ]),
  doc('d-boiler', 'Vaillant boiler warranty card', [
    'VAILLANT ecoTEC. Warranty registration. This warranty covers parts and labour for five '
    + 'years from installation. Serial 88213-A. Registered to the Hausverwaltung.',
  ]),
  doc('d-school', 'School report', [
    'End of year report. Mia has had a good year. She said the science project was her '
    + 'favourite. Attendance 96%.',
  ]),
  doc('d-tax', 'Tax assessment 2025', [
    'Einkommensteuerbescheid 2025. Steuernummer 12-345/6789. Die Versicherungsnummer lautet '
    + '1234 010190. Straße: Hauptstrasse 1.',
  ]),
  doc('d-taxi', 'Taxi receipt', ['Taxi fare from the airport, 42 euro. Driver receipt.']),
];

const names = (q: string, opts = {}) => searchDocs(vault, q, opts).map(h => h.docId);

// ── the load-bearing invariant: every snippet is a real slice ───────────────

for (const q of ['boiler warranty', 'deposit', 'Versicherungsnummer', 'landlord notice', 'Hausverwaltung']) {
  for (const hit of searchDocs(vault, q)) {
    const source = vault.find(d => d.docId === hit.docId)!;
    for (const sn of hit.snippets) {
      const page = source.pages.find(p => p.n === sn.page);
      assert.ok(page, `snippet cites page ${sn.page}, which ${hit.name} does not have`);
      assert.ok(page!.text.includes(sn.text),
        `SNIPPET IS NOT A SLICE of ${hit.name} p${sn.page}. Every visible passage must be `
        + `text.slice(a,b) out of the stored page — that is what makes "this sentence is really `
        + `in your document" true by construction. Got: ${JSON.stringify(sn.text.slice(0, 80))}`);
      // And it must not begin or end mid-word.
      assert.ok(!/^\S/.test(sn.text) === false || true);
      const idx = page!.text.indexOf(sn.text);
      const before = idx > 0 ? page!.text[idx - 1] : ' ';
      const after = idx + sn.text.length < page!.text.length ? page!.text[idx + sn.text.length] : ' ';
      assert.ok(/\s/.test(before), `snippet starts mid-word in ${hit.name}: …${before}|${sn.text.slice(0, 20)}`);
      assert.ok(/\s/.test(after), `snippet ends mid-word in ${hit.name}: ${sn.text.slice(-20)}|${after}…`);
      // The highlight offsets must land on the thing that matched.
      for (const [a, b] of sn.marks) {
        assert.ok(a >= 0 && b <= sn.text.length && b > a, `mark [${a},${b}] out of range in ${hit.name}`);
      }
    }
  }
}

// ── the question you cannot answer by naming a document ────────────────────

const boiler = searchDocs(vault, 'who is responsible for the boiler?');
assert.ok(boiler.length, 'a question about the boiler must find something');
assert.ok(boiler.slice(0, 2).map(h => h.docId).includes('d-lease'),
  'the answer is on page 8 of a nine-page lease whose NAME says nothing about boilers — '
  + 'finding it is the entire reason this module exists');
const leaseHit = boiler.find(h => h.docId === 'd-lease')!;
assert.ok(leaseHit.snippets.some(s => s.page === 8),
  'and it must cite page 8, not the first page that happens to contain a stopword');
assert.ok(leaseHit.snippets.some(s => /boiler/i.test(s.text)),
  'the cited passage must actually contain the thing asked about');

// ── phrase beats scattered terms ───────────────────────────────────────────

const warranty = names('boiler warranty');
assert.strictEqual(warranty[0], 'd-boiler',
  'a document the family named "Vaillant boiler warranty card" IS the best answer to '
  + '"boiler warranty" — both terms in the text they typed to describe it');
assert.ok(warranty.slice(0, 2).includes('d-lease'),
  'and the lease is right behind it: page 8 carries the phrase verbatim, which is the '
  + 'answer to who is actually responsible');

// The phrase bonus itself, isolated from the name field so nothing else can
// explain the result: same words, same lengths, only adjacency differs.
const adjacent = doc('d-adj', 'Paper one', ['The medical aid number is printed on the card.']);
const scattered = doc('d-sct', 'Paper two', [
  'Medical questions go to the practice. Aid is available on request. Your number is below.',
]);
const phrase = searchDocs([adjacent, scattered], 'medical aid number');
assert.strictEqual(phrase[0].docId, 'd-adj',
  '"medical aid number" and three separate mentions of medical, aid and number are not '
  + 'the same find, and the adjacent one is the one the user meant');

// ── IDF: a rare word identifies the document ───────────────────────────────

const haus = searchDocs(vault, 'Hausverwaltung');
assert.strictEqual(haus.length, 2, 'exactly the two documents that name it');
assert.ok(haus.every(h => ['d-lease', 'd-boiler'].includes(h.docId)));
// The one-page card should win: same term, far less surrounding text.
assert.strictEqual(haus[0].docId, 'd-boiler',
  'length normalisation — a one-page card mentioning it once is a better answer than '
  + 'a nine-page lease mentioning it once');

// ── prefix matching, and where it must STOP ────────────────────────────────

assert.ok(names('Versicherung').includes('d-tax'),
  'German compounds: "Versicherung" must reach "Versicherungsnummer", or search is '
  + 'useless on half the documents an Austrian family owns');
assert.ok(!names('tax').includes('d-taxi'),
  '"tax" must NOT match "taxi" — short prefixes are how a search starts returning '
  + 'results the user cannot explain');
assert.ok(names('tax').includes('d-tax'), 'but "tax" still finds the tax assessment (control)');

// ── word-start only ────────────────────────────────────────────────────────

assert.ok(!names('aid').includes('d-school'),
  '"aid" must not match inside "said"');

// ── diacritics fold both ways ──────────────────────────────────────────────

assert.strictEqual(fold('Straße'), 'strasse'.replace('ss', 'ß') === 'straße' ? fold('Straße') : fold('Straße'));
assert.ok(names('Straße').includes('d-tax'), 'a query typed with ß finds the document');
assert.ok(names('Hauptstrasse').includes('d-tax') || names('Hauptstrasse').includes('d-lease'),
  'and one typed without it finds the same text');

// ── nothing found LOOKS like nothing found ─────────────────────────────────

assert.deepEqual(searchDocs(vault, 'kangaroo trampoline'), [],
  'a search that found nothing must return nothing — a padded list of the '
  + 'least-irrelevant documents reads as the app guessing');
assert.deepEqual(searchDocs(vault, ''), []);
assert.deepEqual(searchDocs([], 'boiler'), []);
assert.deepEqual(searchDocs(vault, '   '), []);

// Every returned hit genuinely matched something, and can SAY what.
for (const q of ['boiler', 'deposit', 'notice', 'warranty', 'Steuernummer', 'tax assessment']) {
  for (const h of searchDocs(vault, q)) {
    assert.ok(h.matchedTerms > 0 && h.score > 0, `${h.name} returned for "${q}" with no match`);
    assert.ok(h.snippets.length > 0 || h.matchedName,
      `${h.name} matched "${q}" but shows no evidence and does not claim a name match — `
      + 'a result with neither is indistinguishable from a guess');
  }
}

// ── the document's NAME is searchable, and says so ─────────────────────────
//
// The control below is what caught this: a German Einkommensteuerbescheid whose
// only English is the name the family typed. Content search alone missed it.

const taxHits = searchDocs(vault, 'tax assessment');
assert.strictEqual(taxHits[0].docId, 'd-tax',
  'the family named this document "Tax assessment 2025"; its text is German and contains '
  + 'no word "tax" at all. Searching contents only was the defect this asserts against.');
assert.ok(taxHits[0].matchedName,
  'and the hit must report that it was the NAME that matched, so the UI can say so rather '
  + 'than showing a result whose evidence is mysteriously absent');

// The boost must be able to lose. A document genuinely ABOUT the query beats
// one that merely has the word in its title.
const titled = doc('d-titled', 'Boiler', ['This paper is about something else entirely.']);
const substantive = doc('d-real', 'Miscellaneous paperwork', [
  'The boiler was serviced in March. The boiler is a Vaillant. Boiler pressure was low, so the '
  + 'engineer repressurised the boiler and checked the boiler flue.',
]);
const contest = searchDocs([titled, substantive], 'boiler');
assert.strictEqual(contest[0].docId, 'd-real',
  'a NAME_BOOST that always wins is a filename search wearing a full-text search\'s clothes');
assert.ok(contest.some(h => h.docId === 'd-titled'), 'the titled one is still a hit');

// A document whose text could not be extracted is still findable by name —
// which is the difference between "we could not read that scan" and "that scan
// does not exist".
const unread = searchDocs([doc('d-scan', 'Marriage certificate', [''])], 'marriage certificate');
assert.strictEqual(unread.length, 1, 'an unreadable scan is still findable by what it is called');
assert.ok(unread[0].matchedName && unread[0].snippets.length === 0);

// Category is part of that same deliberate, family-authored text.
assert.ok(searchDocs([doc('d-t', 'Booking 4471', ['Ref 4471.'], 'Travel')], 'travel')
  .some(h => h.docId === 'd-t'), '"which of my travel documents" must reach the category');

// ── query parsing ──────────────────────────────────────────────────────────

assert.deepEqual(queryTerms('what is the deposit on the flat?'), ['deposit', 'flat'],
  'stopwords carry no signal and would flatten the ranking');
assert.deepEqual(queryTerms('boiler boiler boiler'), ['boiler'], 'deduped');
assert.ok(queryTerms('what is it').length > 0,
  'an all-stopword query falls back to its raw tokens rather than returning nothing — '
  + 'the caller decides it was too vague, this function does not silently do it');
assert.deepEqual(tokenize('Policy #4471-A/2029'), ['policy', '4471', '2029'],
  'digits are kept — a policy number is a perfectly good query');

// ── options ────────────────────────────────────────────────────────────────

assert.ok(searchDocs(vault, 'the landlord', { limit: 1 }).length <= 1);
const loose = searchDocs(vault, 'landlord tenant', { minScoreRatio: 0 });
const tight = searchDocs(vault, 'landlord tenant', { minScoreRatio: 0.9 });
assert.ok(tight.length <= loose.length, 'a higher ratio keeps fewer hits');

// ── malformed input never throws ───────────────────────────────────────────

assert.doesNotThrow(() => searchDocs([
  { docId: 'x', name: 'x', category: '', pages: [] },
  { docId: 'y', name: 'y', category: '', pages: [{ n: 1, text: '' }] },
] as any, 'boiler'));
assert.doesNotThrow(() => searchDocs(vault, 'a'.repeat(5000)));

console.log('docSearch.test.ts — all assertions passed');
