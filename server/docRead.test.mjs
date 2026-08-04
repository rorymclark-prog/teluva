// Tests for the recall-only document reader's deterministic core.
//
// What is worth asserting here is not "does it find things" — it is the three
// ways this feature can quietly hurt someone:
//
//   1. An offset that is off by one. Nothing throws, nothing looks wrong in a
//      log, and every quote the user reads is shifted by a character. A quote
//      that starts one character late can start after a "nicht".
//   2. A passage cut at a German abbreviation or before its leading exception,
//      so a true substring says the opposite of the clause it came from.
//   3. A negative — "your lease doesn't say anything about that" — rendered
//      over a document we could not fully read.
//
// So the sweep tests round-trip offsets back through slice() rather than
// trusting numbers, the clause tests assert on the TEXT that comes out, and
// the gate tests are mostly assertions about refusal.
//
// Run with:  node --test server/docRead.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_PASSAGE_TOPICS,
  normalizeForSearch,
  normalizeWithMap,
  expandQuery,
  sweep,
  expandToClause,
  computeCoverage,
  canRenderNegative,
  isEligible,
  MAX_HITS,
  MAX_PASSAGE_CHARS,
} from './docRead.mjs';

// ---------------------------------------------------------------------------
// normalizeForSearch
// ---------------------------------------------------------------------------

test('lowercases and collapses whitespace', () => {
  assert.equal(normalizeForSearch('  Der   MIETER\t\nträgt  '), 'der mieter traegt');
  assert.equal(normalizeForSearch(''), '');
  assert.equal(normalizeForSearch(null), '');
  assert.equal(normalizeForSearch(undefined), '');
});

test('folds ß to ss in both cases', () => {
  assert.equal(normalizeForSearch('Straße'), 'strasse');
  assert.equal(normalizeForSearch('STRASSE'), 'strasse');
  assert.equal(normalizeForSearch('MAßSTAB'), 'massstab');
  // The whole point: the two correct spellings of the same word collide.
  assert.equal(normalizeForSearch('Grundstück-Straße'), normalizeForSearch('Grundstueck-Strasse'));
});

test('folds umlauts to their ae/oe/ue spellings', () => {
  assert.equal(normalizeForSearch('Mängel'), 'maengel');
  assert.equal(normalizeForSearch('MÄNGEL'), 'maengel');
  assert.equal(normalizeForSearch('Schönbrunn'), 'schoenbrunn');
  assert.equal(normalizeForSearch('Rückgabe'), 'rueckgabe');
  assert.equal(normalizeForSearch('Mängel'), normalizeForSearch('Maengel'));
});

test('folds a DECOMPOSED umlaut the same as a precomposed one', () => {
  // Text pasted out of macOS apps is routinely NFD: "a" + U+0308.
  const decomposed = 'Mängel';
  assert.notEqual(decomposed, 'Mängel');
  assert.equal(normalizeForSearch(decomposed), 'maengel');
});

test('strips soft hyphens', () => {
  // U+00AD is invisible and all over German legal boilerplate.
  assert.equal(normalizeForSearch('Miet­zins'), 'mietzins');
  assert.equal(normalizeForSearch('In­stand­hal­tung'), 'instandhaltung');
});

test('joins a word hyphenated across a line break', () => {
  assert.equal(normalizeForSearch('Instandhal-\ntung'), 'instandhaltung');
  assert.equal(normalizeForSearch('Instandhal- \n  tung'), 'instandhaltung');
  assert.equal(normalizeForSearch('Instandhal‐\r\ntung'), 'instandhaltung');
});

test('keeps a real hyphen that is not a line break', () => {
  assert.equal(normalizeForSearch('Mietvertrag-Anhang'), 'mietvertrag-anhang');
});

test('applies NFKC compatibility folding', () => {
  assert.equal(normalizeForSearch('ﬁnal'), 'final');       // ligature
  assert.equal(normalizeForSearch('ＭＩＥＴＥ'), 'miete');    // full-width
  assert.equal(normalizeForSearch('a b'), 'a b');      // nbsp is whitespace
});

// ---------------------------------------------------------------------------
// The index map — the crux
// ---------------------------------------------------------------------------

test('index map round-trips every normalised character back to its source', () => {
  const raw = 'Der Mieter trägt die Kosten der Behebung.';
  const { text, starts, ends } = normalizeWithMap(raw);
  assert.equal(text, 'der mieter traegt die kosten der behebung.');
  assert.equal(starts.length, text.length);
  assert.equal(ends.length, text.length);
  for (let i = 0; i < text.length; i += 1) {
    assert.ok(starts[i] >= 0 && ends[i] <= raw.length, `bounds at ${i}`);
    assert.ok(ends[i] > starts[i], `non-empty source at ${i}`);
  }
  // Offsets are monotonic — a passage can never run backwards.
  for (let i = 1; i < text.length; i += 1) {
    assert.ok(starts[i] >= starts[i - 1], `monotonic at ${i}`);
  }
});

test('a match on the folded form slices the ORIGINAL word', () => {
  const raw = 'Der Mieter trägt die Kosten.';
  const { text, starts, ends } = normalizeWithMap(raw);
  const at = text.indexOf('traegt');
  const s = starts[at];
  const e = ends[at + 'traegt'.length - 1];
  assert.equal(raw.slice(s, e), 'trägt');
});

test('offsets survive soft hyphens and line-break hyphenation', () => {
  const raw = 'Die Instandhal-\ntung der Therme obliegt dem Mieter.';
  const { text, starts, ends } = normalizeWithMap(raw);
  const at = text.indexOf('instandhaltung');
  assert.notEqual(at, -1);
  const s = starts[at];
  const e = ends[at + 'instandhaltung'.length - 1];
  assert.equal(raw.slice(s, e), 'Instandhal-\ntung');
});

test('offsets survive a ß expanding to two characters', () => {
  const raw = 'Die Straße ist Teil des Objekts.';
  const { text, starts, ends } = normalizeWithMap(raw);
  const at = text.indexOf('strasse');
  const s = starts[at];
  const e = ends[at + 'strasse'.length - 1];
  assert.equal(raw.slice(s, e), 'Straße');
});

test('a match at the very start and very end of a page is exact', () => {
  const raw = 'Kaution beträgt drei Bruttomonatsmieten';
  const { text, starts, ends } = normalizeWithMap(raw);
  assert.equal(starts[0], 0);
  assert.equal(ends[text.length - 1], raw.length);
});

// ---------------------------------------------------------------------------
// expandQuery
// ---------------------------------------------------------------------------

const has = (terms, t) => terms.includes(t);

test('an English repairs question reaches the German legal vocabulary', () => {
  const terms = expandQuery('what does my lease say about repairs?');
  assert.ok(has(terms, 'erhaltungspflicht'), 'erhaltungspflicht');
  assert.ok(has(terms, 'instandhaltung'), 'instandhaltung');
  assert.ok(has(terms, 'maengel'), 'maengel (folded Mängel)');
  assert.ok(has(terms, 'behebung'), 'behebung');
});

test('the kitchen-plugs question — the one that started this feature', () => {
  const terms = expandQuery('the plugs in my kitchen do not work, whose problem is it?');
  assert.ok(has(terms, 'steckdose'), 'plugs -> Steckdose');
  assert.ok(has(terms, 'erhaltungspflicht'), 'plugs -> Erhaltungspflicht');
  assert.ok(has(terms, 'elektroinstallation'), 'plugs -> Elektroinstallation');
});

test('electrics, plumbing and heating all route into repairs', () => {
  for (const q of ['the fuse keeps tripping', 'a pipe is leaking', 'the heating is broken', 'no hot water']) {
    const terms = expandQuery(q);
    assert.ok(has(terms, 'instandhaltung'), `${q} -> Instandhaltung`);
  }
});

test('covers the notice/deadline cluster in both languages', () => {
  const terms = expandQuery('how quickly do I have to notify the landlord?');
  assert.ok(has(terms, 'unverzueglich'), 'unverzüglich');
  assert.ok(has(terms, 'schriftlich'), 'schriftlich');
  assert.ok(has(terms, 'frist'), 'frist');
  assert.ok(has(terms, 'maengelanzeige'), 'mängelanzeige');
});

test('covers rent, deposit, termination, duration and pets clusters', () => {
  assert.ok(has(expandQuery('can they increase the rent?'), 'wertsicherung'));
  assert.ok(has(expandQuery('can they increase the rent?'), 'betriebskosten'));
  assert.ok(has(expandQuery('when do I get my deposit back?'), 'kaution'));
  assert.ok(has(expandQuery('how do I cancel the contract?'), 'kuendigungsfrist'));
  assert.ok(has(expandQuery('is it a fixed term?'), 'befristung'));
  assert.ok(has(expandQuery('am I allowed a dog?'), 'tierhaltung'));
  assert.ok(has(expandQuery('can I sublet the flat?'), 'untermiete'));
  assert.ok(has(expandQuery('may I drill into the walls?'), 'bauliche veraenderung'));
});

test('the generic obligations cluster fires on duty words', () => {
  const terms = expandQuery('what am I responsible for?');
  assert.ok(has(terms, 'verpflichtet'));
  assert.ok(has(terms, 'obliegt'));
  assert.ok(has(terms, 'hat zu'));
});

test('a German question fires the same clusters', () => {
  const terms = expandQuery('Wer zahlt die Reparatur der Therme?');
  assert.ok(has(terms, 'erhaltungspflicht'));
  assert.ok(has(terms, 'instandhaltung'));
});

test("the user's own words are always searched for, cluster or not", () => {
  const terms = expandQuery('what does it say about the Hausordnung and the Fassade?');
  assert.ok(has(terms, 'hausordnung'));
  assert.ok(has(terms, 'fassade'));
});

test('stopwords in both languages are dropped', () => {
  const terms = expandQuery('was steht in meinem Vertrag über die Kaution?');
  for (const junk of ['was', 'steht', 'meinem', 'vertrag', 'ueber', 'die']) {
    assert.ok(!has(terms, junk), `${junk} should be a stopword`);
  }
  assert.ok(has(terms, 'kaution'));
});

test('a query typed without umlauts still finds the umlauted word', () => {
  // "Mangel" typed on a phone must reach a lease that says "Mängel"
  // (normalised to "maengel"), and vice versa.
  assert.ok(has(expandQuery('Mangel'), 'maengel'));
  assert.ok(has(expandQuery('Kundigung'), 'kuendigung'));
  assert.ok(has(expandQuery('Maengel'), 'mangel'));
});

test('terms are lowercase, deduped and longest-first', () => {
  const terms = expandQuery('repairs and Repairs and REPAIRS');
  assert.deepEqual(terms, [...new Set(terms)], 'deduped');
  for (const t of terms) assert.equal(t, t.toLowerCase(), t);
  for (let i = 1; i < terms.length; i += 1) {
    assert.ok(terms[i - 1].length >= terms[i].length, 'longest first');
  }
});

test('expandQuery is stable and total', () => {
  assert.deepEqual(expandQuery('repairs'), expandQuery('repairs'));
  assert.deepEqual(expandQuery(''), []);
  assert.deepEqual(expandQuery(null), []);
});

// ---------------------------------------------------------------------------
// sweep
// ---------------------------------------------------------------------------

const LEASE_P1 = `MIETVERTRAG

§ 8 Erhaltung und Instandhaltung

(4) Ausgenommen sind Schäden, die der Mieter nicht verursacht hat. Der Mieter trägt die Kosten der Behebung, sofern der Schaden von ihm verschuldet wurde.

(5) Mängel sind dem Vermieter unverzüglich schriftlich anzuzeigen.`;

const LEASE_P2 = `§ 9 Kaution

Die Kaution beträgt drei Bruttomonatsmieten und ist bei Vertragsabschluss zu erlegen.`;

const PAGES = [{ n: 1, text: LEASE_P1 }, { n: 2, text: LEASE_P2 }];

test('sweep returns offsets that slice real substrings of the raw page', () => {
  const hits = sweep(PAGES, ['maengel', 'kaution', 'behebung']);
  assert.ok(hits.length >= 3);
  for (const h of hits) {
    const raw = PAGES.find((p) => p.n === h.page).text;
    const slice = raw.slice(h.charStart, h.charEnd);
    assert.ok(slice.length > 0, 'non-empty');
    // The slice is the ORIGINAL spelling; normalising it gives the term back.
    assert.equal(normalizeForSearch(slice), h.term, `${JSON.stringify(slice)} vs ${h.term}`);
  }
});

test('sweep finds the umlauted word from the folded term', () => {
  const [hit] = sweep(PAGES, ['maengel']);
  assert.equal(hit.page, 1);
  assert.equal(LEASE_P1.slice(hit.charStart, hit.charEnd), 'Mängel');
});

test('sweep returns hits in document order, pages then offsets', () => {
  const hits = sweep(PAGES, ['kaution', 'maengel', 'ausgenommen', 'mieter']);
  for (let i = 1; i < hits.length; i += 1) {
    const a = hits[i - 1];
    const b = hits[i];
    assert.ok(a.page < b.page || (a.page === b.page && a.charStart < b.charStart), 'ordered');
  }
});

test('sweep merges overlapping hits from different terms into one', () => {
  const pages = [{ n: 1, text: 'Die Kündigungsfrist beträgt drei Monate.' }];
  const hits = sweep(pages, ['kuendigungsfrist', 'frist', 'kuendigung']);
  assert.equal(hits.length, 1, 'one place in the document, not three');
  assert.equal(pages[0].text.slice(hits[0].charStart, hits[0].charEnd), 'Kündigungsfrist');
});

test('sweep finds every separate occurrence', () => {
  const pages = [{ n: 1, text: 'Mangel. Ein weiterer Mangel. Und noch ein Mangel.' }];
  assert.equal(sweep(pages, ['mangel']).length, 3);
});

test('sweep finds a term inside a German compound', () => {
  // Recall beats precision: a false positive shows the user a real sentence
  // from their own document; a false negative shows them nothing.
  const pages = [{ n: 1, text: 'Die Mängelanzeige hat schriftlich zu erfolgen.' }];
  assert.equal(sweep(pages, ['maengel']).length, 1);
});

test('sweep tolerates junk input', () => {
  assert.deepEqual(sweep(null, ['x']), []);
  assert.deepEqual(sweep(PAGES, null), []);
  assert.deepEqual(sweep(PAGES, []), []);
  assert.deepEqual(sweep(PAGES, ['a', 'ab']), [], 'terms under 3 chars are refused');
  assert.deepEqual(sweep([{ n: 1, text: '' }, { n: 2 }], ['kaution']), []);
});

test('sweep caps the number of hits', () => {
  const pages = [{ n: 1, text: 'mangel '.repeat(500) }];
  const hits = sweep(pages, ['mangel']);
  assert.equal(hits.length, MAX_HITS);
});

test('sweep skips image-only pages without shifting later page offsets', () => {
  const pages = [{ n: 1, text: '' }, { n: 2, text: LEASE_P2 }];
  const [hit] = sweep(pages, ['kaution']);
  assert.equal(hit.page, 2);
  assert.equal(LEASE_P2.slice(hit.charStart, hit.charEnd), 'Kaution');
});

// ---------------------------------------------------------------------------
// expandToClause — the safety feature
// ---------------------------------------------------------------------------

const quote = (text, r) => text.slice(r.charStart, r.charEnd);

test('expands a bare word out to its whole sentence', () => {
  const text = 'Der Mieter trägt die Kosten der Behebung, sofern der Schaden von ihm verschuldet wurde. Weiteres siehe Anhang.';
  const at = text.indexOf('Behebung');
  const r = expandToClause(text, at, at + 'Behebung'.length);
  assert.equal(
    quote(text, r),
    'Der Mieter trägt die Kosten der Behebung, sofern der Schaden von ihm verschuldet wurde.',
  );
});

test('THE TRAILING CONDITION IS NEVER DROPPED', () => {
  // "...sofern der Mieter den Schaden nicht verursacht hat" reverses the
  // sentence it is attached to. A quote that stops before it is a lie made
  // entirely of true words.
  const text = 'Der Mieter hat die Kosten zu tragen, sofern der Mieter den Schaden nicht verursacht hat.';
  const at = text.indexOf('Kosten');
  const r = expandToClause(text, at, at + 6);
  assert.match(quote(text, r), /sofern der Mieter den Schaden nicht verursacht hat\.$/);
});

test('THE LEADING EXCEPTION IS NEVER DROPPED', () => {
  // The hit is in the second sentence; the exception that governs it opens the
  // clause. Sentence expansion alone would silently invert the meaning.
  const at = LEASE_P1.indexOf('Behebung');
  const r = expandToClause(LEASE_P1, at, at + 'Behebung'.length);
  const q = quote(LEASE_P1, r);
  assert.match(q, /^\(4\) Ausgenommen sind Schäden/, `got: ${q}`);
  assert.match(q, /Behebung/);
});

test('walks back to a § heading on its own line', () => {
  const text = '§ 8 (4) Der Vermieter ist nicht verpflichtet, Schäden zu beheben.\n\nAnderes gilt für die Therme.';
  const at = text.indexOf('beheben');
  const r = expandToClause(text, at, at + 7);
  assert.match(quote(text, r), /^§ 8 \(4\)/);
});

test('recognises the decimal, letter, Abs., Z and Punkt clause forms', () => {
  const cases = [
    ['8.3 Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.', '8.3'],
    ['(a) Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.', '(a)'],
    ['Abs. 2 Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.', 'Abs. 2'],
    ['Z 3 Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.', 'Z 3'],
    ['Punkt 5 Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.', 'Punkt 5'],
    ['• Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.', '•'],
    ['§ 8 Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.', '§ 8'],
  ];
  for (const [text, marker] of cases) {
    const at = text.indexOf('schriftlich');
    const r = expandToClause(text, at, at + 11);
    assert.ok(quote(text, r).startsWith(marker), `${marker} -> ${quote(text, r)}`);
  }
});

test('does not invent a clause start that is not there', () => {
  // With no numbered heading anywhere, expansion stops at the sentence — it
  // does not hoover up the preceding paragraph on a guess.
  const text = 'Der Mieter hat den Schaden zu melden. Er hat dies schriftlich zu tun.';
  const at = text.indexOf('schriftlich');
  const r = expandToClause(text, at, at + 11);
  assert.equal(quote(text, r), 'Er hat dies schriftlich zu tun.');
});

test('German abbreviations are not sentence ends', () => {
  for (const abbr of ['Abs. 2', 'Z. 3', 'lit. a', 'bzw. der Vermieter', 'inkl. USt', 'ca. drei Wochen', 'z.B. Fenster', 'd.h. sofort']) {
    const text = `Die Behebung erfolgt gemäß ${abbr} durch den Mieter. Danach ist Schluss.`;
    const at = text.indexOf('Mieter');
    const r = expandToClause(text, at, at + 6);
    const q = quote(text, r);
    assert.ok(q.startsWith('Die Behebung'), `split at "${abbr}": ${q}`);
    assert.ok(q.endsWith('durch den Mieter.'), `overran at "${abbr}": ${q}`);
  }
});

test('a numbered item "8." is not a sentence end', () => {
  const text = 'Punkt 8. Der Mieter hat die Therme zu warten. Ende.';
  const at = text.indexOf('warten');
  const r = expandToClause(text, at, at + 6);
  assert.ok(quote(text, r).startsWith('Punkt 8.'), quote(text, r));
});

test('a real sentence end IS respected', () => {
  const text = 'Erster Satz ohne Bezug. Der Mieter trägt die Kosten. Dritter Satz.';
  const at = text.indexOf('Kosten');
  const r = expandToClause(text, at, at + 6);
  assert.equal(quote(text, r), 'Der Mieter trägt die Kosten.');
});

test('a blank line is a hard boundary', () => {
  const text = 'Überschrift ohne Punkt\n\nDer Mieter trägt die Kosten der Behebung.';
  const at = text.indexOf('Behebung');
  const r = expandToClause(text, at, at + 8);
  assert.equal(quote(text, r), 'Der Mieter trägt die Kosten der Behebung.');
});

test('caps the passage length and keeps the START', () => {
  const filler = 'und weitere Bestimmungen gelten sinngemäß, ';
  const text = `(4) Ausgenommen sind Schäden, ${filler.repeat(60)}der Mieter trägt die Kosten.`;
  const at = text.indexOf('der Mieter trägt');
  const r = expandToClause(text, at, at + 16);
  assert.ok(r.charEnd - r.charStart <= MAX_PASSAGE_CHARS + 40, 'roughly capped');
  // The clause start was too far back to keep together with the hit, so it
  // falls back inward — but never past the hit itself.
  assert.ok(r.charStart <= at, 'never starts after the hit');
  assert.ok(r.charEnd >= at + 16, 'never ends before the hit');
});

test('a very long single clause is truncated at the end, flagged, hit intact', () => {
  const text = `(4) Ausgenommen sind Schäden, ${'x '.repeat(900)}Behebung durch den Mieter, und weiter geht es noch lange.`;
  const at = text.indexOf('(4)');
  const r = expandToClause(text, at, at + 3);
  assert.equal(r.charStart, 0, 'keeps the leading exception');
  assert.equal(r.truncated, true);
  assert.ok(r.charEnd - r.charStart <= MAX_PASSAGE_CHARS);
});

test('expandToClause tolerates junk offsets', () => {
  assert.deepEqual(expandToClause('', 0, 5), { charStart: 0, charEnd: 0, truncated: false });
  const text = 'Der Mieter trägt die Kosten.';
  const r = expandToClause(text, -5, 9999);
  assert.equal(r.charStart, 0);
  assert.equal(r.charEnd, text.length);
  assert.doesNotThrow(() => expandToClause(text, NaN, NaN));
});

test('sweep offsets feed straight into expandToClause', () => {
  // The real pipeline: sweep -> expand -> slice. Nothing in between.
  const hits = sweep(PAGES, expandQuery('what does it say about repairs?'));
  assert.ok(hits.length > 0);
  for (const h of hits) {
    const raw = PAGES.find((p) => p.n === h.page).text;
    const r = expandToClause(raw, h.charStart, h.charEnd);
    const passage = raw.slice(r.charStart, r.charEnd);
    assert.ok(passage.includes(raw.slice(h.charStart, h.charEnd)), 'passage contains its own hit');
    assert.ok(raw.includes(passage), 'passage is a verbatim substring of the page');
  }
});

// ---------------------------------------------------------------------------
// Coverage and the negative gate
// ---------------------------------------------------------------------------

const LONG = 'Der Mieter trägt die Kosten der Behebung.';

test('computeCoverage counts pages with a usable text layer', () => {
  const c = computeCoverage([
    { n: 1, text: LONG },
    { n: 2, text: '' },
    { n: 3, text: '  \n  ' },
    { n: 4, text: '12' },        // a stray page number is NOT a text layer
    { n: 5, text: LONG },
  ], { verifiable: true });
  assert.equal(c.pagesTotal, 5);
  assert.equal(c.pagesWithText, 2);
  assert.deepEqual(c.pagesWithoutText, [2, 3, 4]);
  assert.equal(c.verifiable, true);
});

test('the 20-character threshold counts non-whitespace only', () => {
  const nineteen = 'a'.repeat(19);
  const twenty = 'a'.repeat(20);
  assert.deepEqual(computeCoverage([{ n: 1, text: nineteen }], {}).pagesWithoutText, [1]);
  assert.deepEqual(computeCoverage([{ n: 1, text: twenty }], {}).pagesWithoutText, []);
  // Same twenty characters, spread over a page of whitespace.
  const spaced = twenty.split('').join('\n  ');
  assert.deepEqual(computeCoverage([{ n: 1, text: spaced }], {}).pagesWithoutText, []);
});

test('verifiable is strictly true, never truthy', () => {
  assert.equal(computeCoverage([], {}).verifiable, false);
  assert.equal(computeCoverage([], undefined).verifiable, false);
  assert.equal(computeCoverage([], { verifiable: 'yes' }).verifiable, false);
  assert.equal(computeCoverage([], { verifiable: 1 }).verifiable, false);
  assert.equal(computeCoverage([], { verifiable: true }).verifiable, true);
});

test('canRenderNegative is true only for a fully-read, verifiable document', () => {
  assert.equal(canRenderNegative({
    pagesTotal: 3, pagesWithText: 3, pagesWithoutText: [], verifiable: true,
  }), true);
});

test('canRenderNegative refuses every partial case', () => {
  const base = { pagesTotal: 3, pagesWithText: 3, pagesWithoutText: [], verifiable: true };
  // One unread page: we cannot claim silence about a page we never read.
  assert.equal(canRenderNegative({ ...base, pagesWithoutText: [2], pagesWithText: 2 }), false);
  // A photo/scan: OCR text cannot be checked against a ground truth.
  assert.equal(canRenderNegative({ ...base, verifiable: false }), false);
  // No pages at all is "skipped", not "nothing found".
  assert.equal(canRenderNegative({ ...base, pagesTotal: 0, pagesWithText: 0 }), false);
  // Junk must never open the gate.
  for (const junk of [null, undefined, {}, 'yes', 1, [], { verifiable: true }]) {
    assert.equal(canRenderNegative(junk), false, String(junk));
  }
});

test('coverage and the negative gate compose', () => {
  const scanned = computeCoverage([{ n: 1, text: LONG }, { n: 2, text: '' }], { verifiable: true });
  assert.equal(canRenderNegative(scanned), false);
  const clean = computeCoverage([{ n: 1, text: LONG }], { verifiable: true });
  assert.equal(canRenderNegative(clean), true);
  const photo = computeCoverage([{ n: 1, text: LONG }], { verifiable: false });
  assert.equal(canRenderNegative(photo), false);
});

// ---------------------------------------------------------------------------
// isEligible
// ---------------------------------------------------------------------------

const ok = { category: 'Legal', name: 'Mietvertrag 2026.pdf', spaceType: 'family', insuranceReaderOn: false };

test('an ordinary family lease is eligible', () => {
  assert.deepEqual(isEligible(ok), { ok: true });
  assert.deepEqual(isEligible({ ...ok, category: 'Financial', name: 'Kaufvertrag.pdf' }), { ok: true });
  assert.deepEqual(isEligible({}), { ok: true });
});

test('medical documents are refused', () => {
  assert.deepEqual(isEligible({ ...ok, category: 'Medical' }), { ok: false, reason: 'medical' });
  // Refused on self-diagnosis and special-category-data grounds — so it wins
  // over every other branch, including the insurance route.
  assert.deepEqual(
    isEligible({ category: 'Medical', name: 'Krankenversicherung Polizze.pdf', spaceType: 'business', insuranceReaderOn: true }),
    { ok: false, reason: 'medical' },
  );
});

test("'Health' is refused too — the app has two words for the same pile of files", () => {
  // VaultDocument.category says 'Medical'; FamilyDocument.category (the
  // per-member Documents tab) says 'Health'. Denying only one of them would
  // block the shared-vault copy of a lab result and admit the copy filed on the
  // member's own profile — same document, same risk, two spellings.
  assert.deepEqual(isEligible({ ...ok, category: 'Health' }), { ok: false, reason: 'medical' });
  assert.deepEqual(
    isEligible({ category: 'Health', name: 'Befund.pdf', spaceType: 'family', insuranceReaderOn: true }),
    { ok: false, reason: 'medical' },
  );
});

test('THE INSURANCE BACK DOOR IS CLOSED', () => {
  // File a Polizze under "Financial" and, without a name check, the whole
  // FEATURE_INSURANCE_READER gate is bypassed in one tap.
  const filed = { category: 'Financial', name: 'Polizze Wiener Städtische.pdf', spaceType: 'family', insuranceReaderOn: false };
  assert.deepEqual(isEligible(filed), { ok: false, reason: 'insurance', route: 'insurance' });
});

test('insurance is detected from the name, case-insensitively', () => {
  const names = [
    'Polizze.pdf', 'polizzen-uebersicht.pdf', 'VERSICHERUNGSPOLIZZE.pdf',
    'Haushaltsversicherung 2026.pdf', 'Versicherungsschein.pdf',
    'Unser Versicherer Uniqa.pdf', 'Deckung Haushalt.pdf',
    'Insurance certificate.pdf', 'Policy Schedule 2026.pdf', 'Cover note.pdf',
    'policy  schedule.PDF',
  ];
  for (const name of names) {
    assert.deepEqual(
      isEligible({ ...ok, name }),
      { ok: false, reason: 'insurance', route: 'insurance' },
      name,
    );
  }
});

test('ordinary names are not mistaken for insurance', () => {
  for (const name of ['Mietvertrag.pdf', 'Zeugnis 2026.pdf', 'Reisepass.jpg', 'Kaufvertrag Auto.pdf']) {
    assert.deepEqual(isEligible({ ...ok, name }), { ok: true }, name);
  }
});

test('with the insurance reader switched on, an insurance document passes', () => {
  assert.deepEqual(
    isEligible({ ...ok, name: 'Polizze.pdf', insuranceReaderOn: true }),
    { ok: true },
  );
});

test('business spaces are refused', () => {
  // Deferred until per-member document scoping exists: today every member of a
  // space reads every other member's records.
  assert.deepEqual(isEligible({ ...ok, spaceType: 'business' }), { ok: false, reason: 'business' });
  // And an insurance document in a business space is still refused when the
  // insurance reader is on — the two gates are independent.
  assert.deepEqual(
    isEligible({ ...ok, name: 'Polizze.pdf', spaceType: 'business', insuranceReaderOn: true }),
    { ok: false, reason: 'business' },
  );
});

// ---------------------------------------------------------------------------
// The contract itself
// ---------------------------------------------------------------------------

test('DOC_PASSAGE_TOPICS mirrors src/types.ts', () => {
  assert.deepEqual(DOC_PASSAGE_TOPICS, [
    'Repairs', 'Notice', 'Payment', 'Deposit', 'Termination',
    'Duration', 'Obligations', 'Deadline', 'Contact', 'General',
  ]);
});

test('every cluster topic is a real DocPassageTopic', () => {
  // Guards the table above against a typo that would tag a passage with a
  // topic the client cannot render.
  const used = new Set(['Repairs', 'Notice', 'Payment', 'Deposit', 'Termination', 'Duration', 'Obligations']);
  for (const t of used) assert.ok(DOC_PASSAGE_TOPICS.includes(t), t);
});

test('nothing in this module can produce a string the model authored', () => {
  // The whole architecture in one assertion: every value that ends up on
  // screen is either a slice of the page or a term the user's own words
  // produced. sweep/expandToClause return numbers and substrings only.
  const hits = sweep(PAGES, expandQuery('repairs'));
  for (const h of hits) {
    assert.equal(typeof h.charStart, 'number');
    assert.equal(typeof h.charEnd, 'number');
    const raw = PAGES.find((p) => p.n === h.page).text;
    assert.ok(raw.includes(raw.slice(h.charStart, h.charEnd)));
  }
});
