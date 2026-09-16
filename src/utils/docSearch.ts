/**
 * Searching ACROSS the whole document vault, in the browser.
 * ---------------------------------------------------------------------------
 *
 * The reader (utils/docReader.ts) answers "what does THIS lease say about
 * damp?" — you name the document, it reads it. That is the wrong shape for the
 * question people actually arrive with, which is "which of our papers mentions
 * the boiler warranty?" You cannot name the document; not knowing which one it
 * is IS the question.
 *
 * This module is the other half: given text already extracted from many
 * documents, rank them against a query and cut the sentence that matched.
 *
 * ── THE INVARIANT IT INHERITS ──────────────────────────────────────────────
 *
 * Every snippet is a SLICE of the stored page text — `text.slice(a, b)` and
 * nothing else. Never a summary, never a rephrasing, never a model's account
 * of what a page says. That is the same rule the reader holds itself to, and
 * it is what makes "this sentence is really in your document" true by
 * construction rather than by trust. A search result is evidence or it is
 * noise.
 *
 * ── WHY THERE IS NO MODEL IN HERE ──────────────────────────────────────────
 *
 * Ranking runs entirely on this device, over text this device extracted. No
 * page of a lease, a will or a school report is sent anywhere to answer "which
 * document mentions X" — which also means the search costs nothing and works
 * offline. The assistant's only role is deciding that a search should happen
 * and what to search FOR; the searching is arithmetic.
 *
 * Reading one of the results properly still goes through /api/doc-read, which
 * is a deliberate second step the user takes knowingly.
 *
 * ── SCORING ────────────────────────────────────────────────────────────────
 *
 * BM25-shaped, with the pieces that matter for a family vault:
 *
 *   · IDF, so "the" contributes nothing and "Hausverwaltung" contributes a lot.
 *     A vault holds 20-200 documents, and the rare word is almost always the
 *     one that identifies the right paper.
 *   · Length normalisation, so a 40-page lease does not outrank a one-page
 *     warranty on term frequency alone.
 *   · A PHRASE bonus when the query's words appear adjacent, because "medical
 *     aid number" and three separate mentions of "medical", "aid" and "number"
 *     are not the same find.
 *   · Prefix matching on longer terms, so "warrant" finds "warranty" and
 *     "Versicherung" finds "Versicherungsnummer" — German compounds make plain
 *     equality much weaker here than it looks in English.
 *
 * Diacritics are folded (Straße/Strasse, Wörter/Worter) because a family types
 * a query on whichever keyboard is to hand and the document was typed on
 * another.
 */

import type { DocPage } from '../types';

/** One document's extracted text, as the index holds it. */
export interface IndexedDoc {
  docId: string;
  name: string;
  category: string;
  /** contentHash at extraction time — a replaced scan invalidates the entry. */
  hash?: string;
  pages: DocPage[];
}

export interface SearchSnippet {
  page: number;
  /** A verbatim slice of that page's text. Never generated. */
  text: string;
  /** [start, end) offsets WITHIN `text` of the matched run, for highlighting. */
  marks: [number, number][];
}

export interface SearchHit {
  docId: string;
  name: string;
  category: string;
  score: number;
  /** How many distinct query terms this document matched at all. */
  matchedTerms: number;
  /**
   * The document's NAME matched, as opposed to (or as well as) its contents.
   *
   * Carried separately because it is the one hit that legitimately has no
   * snippet: "find my tax assessment" matches a document called "Tax
   * assessment 2025" whose German text says Einkommensteuerbescheid and never
   * the word tax. The UI must be able to say WHY that result is there, or it
   * looks like a result with the evidence missing.
   */
  matchedName: boolean;
  snippets: SearchSnippet[];
}

/** Words carried by almost every document, in the languages this app ships. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were',
  'be', 'been', 'it', 'this', 'that', 'with', 'as', 'at', 'by', 'from', 'my', 'our', 'your',
  'what', 'which', 'who', 'when', 'where', 'does', 'do', 'did', 'has', 'have', 'had', 'we', 'i',
  'der', 'die', 'das', 'und', 'oder', 'von', 'zu', 'in', 'im', 'den', 'dem', 'ein', 'eine',
  'ist', 'sind', 'war', 'waren', 'mit', 'auf', 'für', 'fur', 'bei', 'als', 'auch', 'nicht',
  'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'que', 'un', 'una', 'por', 'con',
  'le', 'les', 'des', 'du', 'et', 'est', 'pour', 'dans', 'sur', 'une',
]);

/**
 * Lowercase and strip diacritics, so a query typed on one keyboard matches a
 * document typed on another. NFD splits "ö" into "o" + combining diaeresis;
 * the range strip then removes the mark.
 */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Split into searchable terms. Keeps digits (a policy number IS a good query)
 * and keeps words joined by / or - as their parts too, because reference
 * numbers and compound German nouns both show up that way.
 */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of fold(s).split(/[^a-z0-9äöüß]+/i)) {
    if (raw.length >= 2) out.push(raw);
  }
  return out;
}

/** Query terms: tokenized, stopworded, deduped, order preserved. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(query)) {
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  // A query of nothing but stopwords ("what is it about") would otherwise
  // match everything equally, which reads as a broken search rather than an
  // unanswerable one. Fall back to the raw tokens so at least the ranking is
  // explicable, and let the caller decide it was too vague.
  return out.length ? out : tokenize(query);
}

/**
 * A term matches a document token when they are equal, or when the query term
 * is a prefix of it and long enough for that not to be noise.
 *
 * Four characters, not three: "ver" is a prefix of half the German language,
 * and "tax" should not match "taxi". Longer prefixes are where compounds live
 * ("versicherung" → "versicherungsnummer"), which is the case worth having.
 */
const MIN_PREFIX = 4;
function termMatches(term: string, token: string): boolean {
  if (term === token) return true;
  return term.length >= MIN_PREFIX && token.length > term.length && token.startsWith(term);
}

const K1 = 1.4;   // term-frequency saturation
const B = 0.7;    // length normalisation strength

/**
 * What a NAME match is worth, per term, beside the content score.
 *
 * The name and the category are the most deliberate text attached to a
 * document — a person typed them to describe the file — so a query matching
 * them is real evidence, and sometimes the ONLY evidence: "find my tax
 * assessment" over a German Einkommensteuerbescheid, where the only English in
 * the whole record is the name the family gave it.
 *
 * Scored as a SEPARATE FIELD rather than by stuffing repeated name tokens into
 * the content stream. Repetition is the classic shortcut and it goes wrong in
 * exactly the case that matters here: the copies inflate the document's length,
 * BM25's normalisation then rewards the shortest document, and a one-line paper
 * called "Boiler" beats a document that discusses the boiler five times. Two
 * fields, added, with the name's contribution bounded and unsaturating.
 *
 * 0.9 is calibrated against BM25's own scale: a saturated content match at
 * average length contributes roughly 1.4×idf, so a name match is worth about
 * two thirds of one solid content match. Enough that a well-named document
 * surfaces; not enough that a name alone outranks a document genuinely about
 * the query. A boost that always wins is a filename search wearing a full-text
 * search's clothes.
 */
const NAME_WEIGHT = 0.9;

interface DocStats {
  doc: IndexedDoc;
  /** term → count in the page text only. */
  tf: Map<string, number>;
  /** terms from name + category, scored separately. */
  nameTf: Map<string, number>;
  /** CONTENT length only — the name must not dilute it. */
  len: number;
}

function statsFor(doc: IndexedDoc): DocStats {
  const tf = new Map<string, number>();
  let len = 0;
  for (const p of doc.pages) {
    for (const t of tokenize(p.text || '')) { tf.set(t, (tf.get(t) || 0) + 1); len++; }
  }
  const nameTf = new Map<string, number>();
  // Category too — "which of my travel documents…" is a real query, and the
  // category is the family's own filing decision, same as the name.
  for (const t of tokenize(`${doc.name || ''} ${doc.category || ''}`)) {
    nameTf.set(t, (nameTf.get(t) || 0) + 1);
  }
  return { doc, tf, nameTf, len };
}

/** Does this query term appear in the document's name or category? */
function inName(stats: DocStats, term: string): boolean {
  for (const tok of stats.nameTf.keys()) if (termMatches(term, tok)) return true;
  return false;
}

/** Count of a query term in a doc, honouring prefix matching. */
function countIn(stats: DocStats, term: string): number {
  const exact = stats.tf.get(term) || 0;
  if (term.length < MIN_PREFIX) return exact;
  let n = exact;
  for (const [tok, c] of stats.tf) {
    if (tok !== term && termMatches(term, tok)) n += c;
  }
  return n;
}

const SNIPPET_RADIUS = 110;      // characters either side of the match
const MAX_SNIPPETS_PER_DOC = 3;

/**
 * Cut the passages around the best matches on a page.
 *
 * Boundaries are nudged out to whitespace so a snippet never begins or ends
 * mid-word — a slice that reads "…surance policy number is 4471…" makes the
 * reader doubt the quote, which is the one thing a verbatim slice exists to
 * prevent.
 */
function snippetsFor(doc: IndexedDoc, terms: string[]): SearchSnippet[] {
  const found: (SearchSnippet & { hits: number })[] = [];

  for (const p of doc.pages) {
    const text = p.text || '';
    if (!text) continue;
    const folded = fold(text);

    // Every position where any query term begins.
    const positions: { at: number; len: number; term: string }[] = [];
    for (const term of terms) {
      let from = 0;
      for (;;) {
        const at = folded.indexOf(term, from);
        if (at < 0) break;
        from = at + 1;
        // Word-start only: matching "aid" inside "said" is how a search starts
        // returning nonsense the user cannot explain.
        const before = at > 0 ? folded[at - 1] : ' ';
        if (/[a-z0-9]/.test(before)) continue;
        // Run to the end of the word so the highlight covers "versicherungs-
        // nummer" rather than the first twelve characters of it.
        let end = at + term.length;
        while (end < folded.length && /[a-z0-9äöüß]/.test(folded[end])) end++;
        positions.push({ at, len: end - at, term });
      }
    }
    if (!positions.length) continue;
    positions.sort((a, b) => a.at - b.at);

    // Cluster positions that would land in the same window, so three mentions
    // in one sentence produce one snippet rather than three near-identical ones.
    let cluster: typeof positions = [];
    const flush = () => {
      if (!cluster.length) return;
      const first = cluster[0];
      const last = cluster[cluster.length - 1];
      let start = Math.max(0, first.at - SNIPPET_RADIUS);
      let end = Math.min(text.length, last.at + last.len + SNIPPET_RADIUS);
      while (start > 0 && !/\s/.test(text[start - 1])) start--;
      while (end < text.length && !/\s/.test(text[end])) end++;
      const slice = text.slice(start, end).trim();
      // Re-anchor the marks to the trimmed slice.
      const lead = text.slice(start, end).length - text.slice(start, end).trimStart().length;
      const marks = cluster
        .map(c => [c.at - start - lead, c.at - start - lead + c.len] as [number, number])
        .filter(([a, b]) => a >= 0 && b <= slice.length);
      found.push({
        page: p.n,
        text: slice,
        marks,
        hits: new Set(cluster.map(c => c.term)).size * 10 + cluster.length,
      });
      cluster = [];
    };
    for (const pos of positions) {
      if (cluster.length && pos.at - cluster[0].at > SNIPPET_RADIUS) flush();
      cluster.push(pos);
    }
    flush();
  }

  // Best first: a window covering three DIFFERENT query terms beats one
  // covering the same term three times.
  found.sort((a, b) => b.hits - a.hits || a.page - b.page);
  return found.slice(0, MAX_SNIPPETS_PER_DOC).map(({ hits: _hits, ...s }) => s);
}

/** Does the document contain the query's terms adjacent, in order? */
function hasPhrase(doc: IndexedDoc, terms: string[]): boolean {
  if (terms.length < 2) return false;
  const phrase = terms.join(' ');
  for (const p of doc.pages) {
    // Collapse whitespace so a phrase broken across a line break still counts —
    // PDFs break lines wherever the layout did, not where the sentence does.
    if (fold(p.text || '').replace(/\s+/g, ' ').includes(phrase)) return true;
  }
  return false;
}

export interface SearchOptions {
  /** Drop hits below this share of the top score. Keeps the tail out. */
  minScoreRatio?: number;
  limit?: number;
}

/**
 * Rank documents against a query.
 *
 * Returns only documents that matched at least one term — never a padded list.
 * A search that found nothing must LOOK like it found nothing, because the
 * alternative is the user reading the least-irrelevant document in the vault
 * and concluding the app is guessing.
 */
export function searchDocs(
  docs: IndexedDoc[],
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const terms = queryTerms(query);
  if (!terms.length || !docs.length) return [];

  // A document with no extracted text is still indexed: its name and category
  // are searchable, which is the difference between "we could not read that
  // scan" and "that scan does not exist".
  const stats = docs.map(statsFor).filter(s => s.len > 0 || s.nameTf.size > 0);
  if (!stats.length) return [];
  // Averaged over documents that HAVE content — an unreadable scan contributing
  // a zero would drag the average down and distort every other document's
  // length normalisation.
  const withText = stats.filter(s => s.len > 0);
  const avgLen = withText.length
    ? withText.reduce((a, s) => a + s.len, 0) / withText.length
    : 1;
  const N = stats.length;

  // Document frequency per term, for IDF. Counted across BOTH fields, so a term
  // that is common in titles is correctly treated as common.
  const df = new Map<string, number>();
  for (const term of terms) {
    let n = 0;
    for (const s of stats) if (countIn(s, term) > 0 || inName(s, term)) n++;
    df.set(term, n);
  }

  const hits: SearchHit[] = [];
  for (const s of stats) {
    let score = 0;
    let matchedTerms = 0;
    let matchedName = false;
    for (const term of terms) {
      const f = countIn(s, term);
      const named = inName(s, term);
      if (f === 0 && !named) continue;
      matchedTerms++;
      if (named) matchedName = true;
      const n = df.get(term) || 0;
      // BM25 IDF, floored at a small positive value: a term present in EVERY
      // document scores ~0 under the textbook formula and can go negative,
      // which would rank a document DOWN for containing what was asked for.
      const idf = Math.max(0.05, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
      if (f > 0) {
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (s.len / avgLen))));
      }
      if (named) score += idf * NAME_WEIGHT;
    }
    if (!matchedTerms) continue;
    // Covering more of the query is worth more than hammering one term.
    score *= 1 + 0.35 * ((matchedTerms - 1) / Math.max(1, terms.length - 1));
    if (hasPhrase(s.doc, terms)) score *= 1.6;
    hits.push({
      docId: s.doc.docId,
      name: s.doc.name,
      category: s.doc.category,
      score,
      matchedTerms,
      matchedName,
      snippets: snippetsFor(s.doc, terms),
    });
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const ratio = opts.minScoreRatio ?? 0.18;
  const top = hits.length ? hits[0].score : 0;
  const kept = hits.filter(h => h.score >= top * ratio);
  return typeof opts.limit === 'number' ? kept.slice(0, opts.limit) : kept;
}
