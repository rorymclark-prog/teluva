// The deterministic heart of the recall-only document reader.
//
// WHY THIS FILE EXISTS AT ALL
// The product claim is "recall, not advice": the user asks "what does my lease
// say about repairs?" and gets back VERBATIM passages out of their own upload.
// The claim is only checkable — by a lawyer, by a regulator, by us in six
// months — if it is a property of the CODE rather than a promise about how a
// language model behaves. So everything a user can actually be misled by is
// decided here, in a file with no network, no Firebase, no Gemini and no
// Express in it. The model's entire contribution downstream is a pair of
// integers and a tag from a closed list. It cannot reach into this file.
//
// The failure mode this whole module is shaped around is NOT a fabricated
// quote — verbatim slicing already makes that impossible. It is the confident
// negative: "your lease doesn't say anything about that." That sentence is the
// default output of every extraction gap, every image-only page and every
// synonym we failed to think of. It is silent, it is plausible, the user's
// reliance on it is the entire product, and a missed legal deadline is a real
// dated loss. Hence, throughout:
//
//   * search recall beats search precision (a false positive shows the user a
//     real sentence from their own document; a false negative shows them
//     nothing and lets them believe nothing is there),
//   * passages are widened outward rather than trimmed inward,
//   * and canRenderNegative() is deliberately hard to make true.

/**
 * Mirrors DOC_PASSAGE_TOPICS in src/types.ts. Duplicated rather than imported
 * because src/ is TypeScript compiled by Vite for the browser and this file is
 * plain ESM loaded by Cloud Run's node — there is no build step joining them.
 * If you add a topic there, add it here; docRead.test.mjs cannot catch the
 * drift for you because it cannot import the .ts either.
 */
export const DOC_PASSAGE_TOPICS = [
  'Repairs', 'Notice', 'Payment', 'Deposit', 'Termination',
  'Duration', 'Obligations', 'Deadline', 'Contact', 'General',
];

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

// Folds applied AFTER NFKC + lowercase. ß->ss and ä->ae are the German
// orthographic equivalences a search index must know: a lease that says
// "Straße" has to be found by someone typing "Strasse", and "Mängel" by
// someone typing "Maengel", because both spellings are correct German and the
// user has no idea which one their landlord's Word template used.
const CHAR_FOLDS = new Map([
  ['ß', 'ss'], ['ẞ', 'ss'],
  ['ä', 'ae'], ['ö', 'oe'], ['ü', 'ue'],
]);

// A hyphen that a PDF's line-breaker inserted, not one the author typed.
// pdfjs hands us "Instandhal-\ntung" for a word broken across two lines; if we
// leave it, the single most important word in an Austrian repair clause never
// matches anything. Also covers the Unicode hyphen forms Word likes to emit.
const LINE_BREAK_HYPHEN = /^[-‐‑−–][ \t\r]*\n[ \t\r]*/;

const COMBINING = /\p{M}/u;
const WHITESPACE = /\s/;

/**
 * Normalise a page of document text (or a query) into the form we search in.
 *
 * Everything here is lossy on purpose, and every loss is a case where two
 * strings a human would call "the same word" would otherwise not match.
 */
export function normalizeForSearch(s) {
  return normalizeWithMap(s).text;
}

/**
 * The same normalisation, but carrying an index map back to the RAW string.
 *
 * This is the part that has to be right. We SEARCH a normalised string but we
 * SLICE the original — because what the user reads must be the document's own
 * characters, umlauts, hyphens and all, not our folded search form. So for
 * every character of the normalised text we remember which raw characters
 * produced it. An off-by-one in here does not throw and does not look wrong in
 * a log; it silently shifts every quote the user is shown by a character, and
 * a quote that starts one character late can start after a "nicht".
 *
 * Returns { text, starts, ends } where for normalised index i the source is
 * raw.slice(starts[i], ends[i]). One raw char can produce two normalised chars
 * (ä -> "ae"), and many raw chars can produce one (a whitespace run -> " ") or
 * none (a soft hyphen), which is exactly why a length-preserving "normalise
 * then indexOf" cannot work.
 */
export function normalizeWithMap(input) {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  const chars = [];
  const starts = [];
  const ends = [];

  const push = (c, s, e) => { chars.push(c); starts.push(s); ends.push(e); };

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];

    // U+00AD SOFT HYPHEN is an invisible "you may break here" marker. It is
    // present in a lot of German legal boilerplate and in anything pasted out
    // of Word, and it is never part of the word the reader sees.
    if (ch === '­') { i += 1; continue; }

    // Hyphenation across a line break: drop the hyphen AND the break, so
    // "Instandhal-\ntung" becomes one token. Checked before the whitespace
    // branch so the newline goes with the hyphen rather than becoming a space.
    if (ch === '-' || ch === '‐' || ch === '‑' || ch === '−' || ch === '–') {
      const m = LINE_BREAK_HYPHEN.exec(raw.slice(i, i + 32));
      if (m) { i += m[0].length; continue; }
    }

    if (WHITESPACE.test(ch)) {
      let j = i;
      while (j < raw.length && WHITESPACE.test(raw[j])) j += 1;
      // Leading whitespace produces nothing, so an offset never lands on it.
      if (chars.length > 0) push(' ', i, i + 1);
      i = j;
      continue;
    }

    // Take the base character plus any combining marks that belong to it, so a
    // decomposed "a" + U+0308 folds to "ae" like a precomposed "ä" does. We
    // NFKC one cluster at a time rather than the whole string, because a
    // whole-string .normalize() changes lengths and destroys the map — the map
    // is the point of this function.
    let j = i + 1;
    while (j < raw.length && COMBINING.test(raw[j])) j += 1;
    const folded = fold(raw.slice(i, j).normalize('NFKC').toLowerCase());
    for (const c of folded) push(c, i, j);
    i = j;
  }

  // A trailing space would be a normalised character mapping to raw whitespace,
  // which is a legal but pointless place for a match to end.
  if (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop(); starts.pop(); ends.pop();
  }

  return { text: chars.join(''), starts, ends };
}

function fold(s) {
  let out = '';
  for (const c of s) out += CHAR_FOLDS.get(c) ?? c;
  return out;
}

// ---------------------------------------------------------------------------
// Query expansion — the actual value of the feature
// ---------------------------------------------------------------------------
//
// The user types "plugs". Their Austrian lease says "Erhaltungspflichten des
// Mieters" and never once uses a word the user typed. Without this table the
// sweep returns nothing, the reader shows nothing, and the user concludes
// their lease is silent about the broken kitchen sockets. That conclusion is
// wrong, it is our fault, and it is invisible. So the table is deliberately
// over-inclusive: every cluster costs at most some extra passages on screen,
// and the alternative costs a deadline.
//
// `triggers` are what fires the cluster (including plain-English words a
// German lease will never contain, like "plug" or "landlord must"); `terms`
// are what we then sweep the document for. Terms are written in their natural
// spelling and normalised on the way out, so "Mängel" here becomes "maengel".

const SYNONYM_CLUSTERS = [
  {
    topic: 'Repairs',
    triggers: [
      'repair', 'repairs', 'maintenance', 'maintain', 'fix', 'fixing', 'broken', 'break',
      'defect', 'defective', 'faulty', 'fault', 'damage', 'damaged', 'wear', 'renovate',
      // The screenshot that started this feature was a photo of a kitchen wall
      // with two dead sockets. Nobody in that situation types "Erhaltungs-
      // pflicht"; they type "plugs". Electrical, plumbing and heating
      // vocabulary therefore has to route into the repairs cluster.
      'plug', 'plugs', 'socket', 'sockets', 'outlet', 'breaker', 'fuse', 'fuses',
      'wiring', 'wire', 'electric', 'electrical', 'electrics', 'power',
      'plumbing', 'pipe', 'pipes', 'leak', 'boiler', 'heater', 'heating', 'radiator',
      'water', 'tap', 'drain', 'appliance', 'oven', 'stove', 'kitchen', 'bathroom',
      'reparatur', 'instandhaltung', 'erhaltung', 'erhaltungspflicht', 'behebung',
      'mangel', 'maengel', 'mängel', 'schaden', 'schäden', 'instandsetzung',
      'steckdose', 'sicherung', 'strom', 'elektro', 'heizung', 'wasser', 'rohr',
      'therme', 'kaputt', 'defekt', 'reparieren',
    ],
    terms: [
      'reparatur', 'reparaturen', 'reparieren', 'instandhaltung', 'instandhaltungspflicht',
      'erhaltung', 'erhaltungspflicht', 'erhaltungspflichten', 'erhaltungsarbeiten',
      'behebung', 'beheben', 'mangel', 'mängel', 'mangelhaft', 'schaden', 'schäden',
      'beschädigung', 'instandsetzung', 'wartung', 'abnützung', 'abnutzung',
      'steckdose', 'steckdosen', 'sicherung', 'sicherungen', 'strom', 'elektro',
      'elektrische', 'elektroinstallation', 'leitung', 'leitungen',
      'heizung', 'therme', 'wasser', 'rohr', 'rohre', 'sanitär', 'gasgerät',
      'repair', 'repairs', 'maintenance', 'defect', 'defects', 'damage', 'faulty',
    ],
  },
  {
    topic: 'Notice',
    triggers: [
      'notice', 'notify', 'notification', 'inform', 'report', 'tell', 'deadline',
      'within days', 'how long', 'how soon', 'immediately', 'in writing',
      'anzeige', 'anzeigen', 'meldung', 'melden', 'mitteilung', 'frist', 'fristen',
      'unverzüglich', 'unverzueglich', 'schriftlich', 'mängelanzeige', 'maengelanzeige',
    ],
    terms: [
      'anzeige', 'anzuzeigen', 'anzeigen', 'mängelanzeige', 'meldung', 'zu melden',
      'mitteilung', 'mitzuteilen', 'bekanntgabe', 'verständigen', 'verständigung',
      'frist', 'fristen', 'binnen', 'innerhalb', 'unverzüglich', 'umgehend',
      'sofort', 'schriftlich', 'in schriftform', 'eingeschrieben', 'nachweislich',
      'notice', 'notify', 'inform', 'in writing', 'without delay', 'deadline',
    ],
  },
  {
    topic: 'Payment',
    triggers: [
      'rent', 'payment', 'pay', 'paying', 'due', 'owe', 'cost', 'costs', 'charge',
      'increase', 'raise', 'index', 'bill', 'invoice', 'price', 'expensive',
      'miete', 'mietzins', 'zahlung', 'zahlen', 'fällig', 'faellig', 'betriebskosten',
      'erhöhung', 'erhoehung', 'wertsicherung', 'kosten', 'entgelt',
    ],
    terms: [
      'miete', 'mietzins', 'hauptmietzins', 'nettomiete', 'bruttomiete',
      'zahlung', 'zahlungen', 'zu zahlen', 'zahlbar', 'fällig', 'fälligkeit',
      'betriebskosten', 'nebenkosten', 'akonto', 'abrechnung',
      'erhöhung', 'anhebung', 'index', 'indexierung', 'wertsicherung', 'vpi',
      'umsatzsteuer', 'entgelt', 'kaution', 'überweisung', 'verzug', 'verzugszinsen',
      'rent', 'payment', 'due', 'increase', 'service charges',
    ],
  },
  {
    topic: 'Deposit',
    triggers: [
      'deposit', 'security', 'bond', 'kaution', 'sicherheitsleistung', 'sicherstellung',
    ],
    terms: [
      'kaution', 'kautionsbetrag', 'sicherheitsleistung', 'sicherstellung',
      'sicherheit', 'barkaution', 'sparbuch', 'rückzahlung der kaution',
      'deposit', 'security deposit',
    ],
  },
  {
    topic: 'Termination',
    triggers: [
      'terminate', 'termination', 'end', 'ending', 'cancel', 'cancellation', 'quit',
      'move out', 'leave', 'evict', 'eviction',
      'kündigung', 'kuendigung', 'kündigen', 'kuendigen', 'kündigungsfrist',
      'auflösung', 'aufloesung', 'räumung', 'raeumung', 'ausziehen',
    ],
    terms: [
      'kündigung', 'kündigen', 'kündigungsfrist', 'kündigungstermin',
      'aufkündigung', 'auflösung', 'vorzeitige auflösung', 'einvernehmliche auflösung',
      'räumung', 'zurückstellung', 'übergabe', 'rückgabe',
      'terminate', 'termination', 'notice period', 'end of the lease',
    ],
  },
  {
    topic: 'Duration',
    triggers: [
      'term', 'duration', 'how long', 'fixed', 'fixed term', 'expire', 'expiry',
      'renew', 'renewal', 'start date', 'end date',
      'befristung', 'befristet', 'laufzeit', 'dauer', 'unbefristet', 'verlängerung',
      'verlaengerung', 'beginn',
    ],
    terms: [
      'befristung', 'befristet', 'unbefristet', 'laufzeit', 'dauer', 'vertragsdauer',
      'mietdauer', 'beginnt', 'beginn', 'endet', 'verlängerung', 'verlängert',
      'erneuerung', 'term', 'duration', 'fixed term',
    ],
  },
  {
    topic: 'Obligations',
    triggers: [
      'pet', 'pets', 'dog', 'cat', 'animal',
      'sublet', 'sublease', 'subletting', 'airbnb', 'guest', 'roommate',
      'alteration', 'alterations', 'renovation', 'modify', 'change', 'build',
      'drill', 'paint', 'install', 'allowed', 'permission', 'consent',
      'tierhaltung', 'haustier', 'haustiere', 'hund', 'katze',
      'untermiete', 'untervermietung', 'weitergabe',
      'umbau', 'bauliche veränderung', 'bauliche veraenderung', 'veränderung',
      'zustimmung', 'genehmigung', 'erlaubt',
    ],
    terms: [
      'tierhaltung', 'haustier', 'haustiere', 'tiere', 'hund', 'katze',
      'untermiete', 'untervermietung', 'weitergabe', 'überlassung',
      'umbau', 'umbauten', 'bauliche veränderung', 'bauliche veränderungen',
      'veränderungen', 'investition', 'zustimmung', 'einwilligung', 'genehmigung',
      'schriftliche zustimmung', 'vermieters', 'untersagt', 'verboten', 'gestattet',
      'pets', 'sublet', 'alterations',
    ],
  },
  {
    // The catch-all. Almost every question about a contract is really "who has
    // to do what", so this cluster fires broadly and its terms are the German
    // constructions that carry duty regardless of subject matter.
    topic: 'Obligations',
    triggers: [
      'obliged', 'obligation', 'obligations', 'responsible', 'responsibility',
      'must', 'have to', 'has to', 'duty', 'liable', 'liability', 'entitled', 'right',
      'who pays', 'whose', 'my job', 'landlord', 'tenant',
      'pflicht', 'pflichten', 'verpflichtet', 'verpflichtung', 'obliegt', 'hat zu',
      'haftung', 'haftet', 'zuständig', 'zustaendig', 'vermieter', 'mieter',
    ],
    terms: [
      'pflicht', 'pflichten', 'verpflichtet', 'verpflichtung', 'verpflichtungen',
      'obliegt', 'obliegen', 'hat zu', 'ist zu', 'sind zu', 'zu tragen',
      'trägt', 'haftung', 'haftet', 'zuständig', 'berechtigt', 'ausgenommen',
      'obliged', 'responsible', 'shall', 'duty',
    ],
  },
];

// Words carrying no search value. Dropped from the user's own phrasing only —
// curated cluster terms like "hat zu" are never filtered, because there the
// stopword IS the legal construction.
const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'as', 'so', 'not',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'does', 'do', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'my', 'me', 'i', 'you', 'your', 'it', 'its', 'they', 'them', 'their', 'we',
  'say', 'says', 'said', 'about', 'on', 'in', 'of', 'for', 'to', 'from', 'at',
  'by', 'with', 'this', 'that', 'these', 'those', 'there', 'here', 'any', 'some',
  'can', 'could', 'would', 'should', 'may', 'might', 'will', 'shall', 'get',
  'anything', 'something', 'please', 'tell', 'show', 'find', 'look', 'need',
  'contract', 'document', 'lease', 'agreement', 'paper', 'papers', 'file',
  // German (normalised forms — ü has already become ue by the time we compare)
  'was', 'steht', 'im', 'in', 'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einen', 'einem', 'eines', 'einer', 'und', 'oder', 'aber',
  'ist', 'sind', 'war', 'waren', 'sein', 'seine', 'mein', 'meine', 'meinem',
  'meinen', 'meiner', 'ich', 'mir', 'mich', 'du', 'sie', 'wir', 'es', 'sich',
  'zu', 'zum', 'zur', 'ueber', 'ob', 'wie', 'wo', 'wann', 'wenn', 'weil',
  'auf', 'an', 'am', 'mit', 'von', 'vom', 'fuer', 'dass', 'nicht', 'kein',
  'keine', 'man', 'habe', 'haben', 'wird', 'werden', 'muss', 'soll',
  'kann', 'koennen', 'da', 'doch', 'noch', 'nur', 'auch', 'bei', 'aus',
  'nach', 'vor', 'wer', 'welche', 'welcher', 'welches', 'sagt', 'sagen',
  'vertrag', 'mietvertrag', 'dokument', 'unterlagen',
]);

/** Terms shorter than this match inside half the words in a German document. */
const MIN_TERM_LENGTH = 3;

/**
 * Turn a natural-language question into the list of strings we will actually
 * sweep the document for. Lowercased, normalised, deduped, longest first (so a
 * multiword term is tried and merged before one of its own words re-finds the
 * same spot).
 *
 * The returned array is shown to the user verbatim as `searchedFor`. That is
 * not decoration: it is the only way a user can tell the difference between
 * "the document is silent" and "we searched for the wrong words".
 */
export function expandQuery(question) {
  const q = normalizeForSearch(question);
  const terms = new Set();

  // The user's own significant words, always. Even if no cluster fires — a
  // question about something we never anticipated ("Fassade", "Lift",
  // "Hausordnung") must still search for the word the user typed.
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const w of words) {
    if (w.length < MIN_TERM_LENGTH || STOPWORDS.has(w)) continue;
    for (const v of umlautVariants(w)) terms.add(v);
  }

  for (const cluster of SYNONYM_CLUSTERS) {
    if (!clusterFires(cluster, q, words)) continue;
    for (const t of cluster.terms) {
      const n = normalizeForSearch(t);
      if (n.length >= MIN_TERM_LENGTH) terms.add(n);
    }
  }

  // Longest first, then alphabetical so the order is stable across runs (this
  // array ends up on screen and in tests).
  return [...terms].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

function clusterFires(cluster, normalizedQuestion, words) {
  const wordSet = new Set(words);
  for (const trigger of cluster.triggers) {
    const t = normalizeForSearch(trigger);
    if (!t) continue;
    if (t.includes(' ')) {
      if (normalizedQuestion.includes(t)) return true;
      continue;
    }
    if (wordSet.has(t)) return true;
    // Cheap plural/inflection tolerance: "repairs" fires "repair", "Mängeln"
    // fires "maengel". Only for triggers long enough that the prefix is not an
    // accident. Firing an extra cluster costs a few extra search terms; not
    // firing the right one costs the whole answer.
    if (t.length >= 4) {
      for (const w of wordSet) {
        if (w.startsWith(t) && w.length - t.length <= 3) return true;
      }
    }
    // German builds words by gluing them together, and the join is exactly
    // where a prefix test stops working: someone typing "Elektriker" is asking
    // about the same thing as the trigger "elektro", but neither string is a
    // prefix of the other — they diverge at the seventh character. Same for
    // "Heizkörper"/"heizung", "Wasserschaden"/"wasser". A six-character shared
    // stem is long enough that an accidental collision is rare and short enough
    // to survive the seam, and firing a cluster wrongly only ever costs a few
    // extra search terms — see the recall-over-precision note at the top.
    if (t.length >= 6) {
      for (const w of wordSet) {
        if (w.length >= 6 && sharedPrefixLength(w, t) >= 6) return true;
      }
    }
  }
  return false;
}

function sharedPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/**
 * Umlaut spelling variants of one of the USER's words, both directions.
 *
 * normalizeForSearch folds ä -> ae, so a document saying "Mängel" is indexed
 * as "maengel" — and a user who typed "Mangel" on a phone keyboard, or
 * "Maengel" out of habit, would match neither/only one. We therefore branch at
 * every a/o/u (could have been an umlaut) and every ae/oe/ue (could have been
 * written as one), and search for all the spellings.
 *
 * Only applied to the user's own words. The curated cluster terms already
 * carry both spellings explicitly, and branching those would multiply the
 * visible `searchedFor` list into noise.
 */
function umlautVariants(word) {
  const MAX_BRANCHES = 4;
  let branches = 0;
  let out = [''];

  for (let i = 0; i < word.length;) {
    const two = word.slice(i, i + 2);
    if ((two === 'ae' || two === 'oe' || two === 'ue') && branches < MAX_BRANCHES) {
      branches += 1;
      out = out.flatMap((p) => [p + two, p + two[0]]);
      i += 2;
      continue;
    }
    const c = word[i];
    if ((c === 'a' || c === 'o' || c === 'u') && branches < MAX_BRANCHES) {
      branches += 1;
      out = out.flatMap((p) => [p + c, p + c + 'e']);
      i += 1;
      continue;
    }
    out = out.map((p) => p + c);
    i += 1;
  }

  return [...new Set(out)].filter((w) => w.length >= MIN_TERM_LENGTH);
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/** More than this and the UI is a wall of text; the model gets a ranked subset. */
export const MAX_HITS = 200;

/**
 * Find every occurrence of every term across every page, in document order.
 *
 * Offsets are into the RAW page text — pages[i].text.slice(charStart, charEnd)
 * is a real substring of the user's document — even though the matching itself
 * happened in the normalised form. That translation is the crux of this file;
 * see normalizeWithMap.
 *
 * Overlapping hits from different terms ("mangel" and "maengel" landing on the
 * same word, "kündigungsfrist" and "frist") are merged into one, so the count
 * the user is shown ("showing 3 of 7") counts places in the document rather
 * than counting our own synonym table.
 */
export function sweep(pages, terms) {
  const list = Array.isArray(pages) ? pages : [];
  const wanted = (Array.isArray(terms) ? terms : [])
    .map((t) => normalizeForSearch(t))
    .filter((t) => t.length >= MIN_TERM_LENGTH);
  if (!wanted.length) return [];

  const hits = [];

  for (const page of list) {
    const raw = typeof page?.text === 'string' ? page.text : '';
    if (!raw) continue;
    const { text, starts, ends } = normalizeWithMap(raw);
    if (!text) continue;

    const pageHits = [];
    for (const term of wanted) {
      let from = 0;
      for (;;) {
        const at = text.indexOf(term, from);
        if (at === -1) break;
        pageHits.push({
          page: page.n,
          charStart: starts[at],
          charEnd: ends[at + term.length - 1],
          term,
        });
        // Advance by one, not by term.length: overlapping self-matches are
        // merged below anyway, and skipping ahead can step over a second
        // occurrence inside a compound word.
        from = at + 1;
      }
    }

    // Document order, and at any one position the longest term first so the
    // merged hit is anchored on the most specific match.
    pageHits.sort((a, b) => a.charStart - b.charStart
      || (b.charEnd - b.charStart) - (a.charEnd - a.charStart)
      || (a.term < b.term ? -1 : 1));

    for (const h of pageHits) {
      const prev = hits[hits.length - 1];
      if (prev && prev.page === h.page && h.charStart <= prev.charEnd) {
        // Overlap (or abutment) — one place in the document, not two.
        if (h.charEnd > prev.charEnd) prev.charEnd = h.charEnd;
        continue;
      }
      hits.push(h);
    }
  }

  // Cap in document order rather than by score: this array is what `totalHits`
  // is honest about, and dropping from the end is the one truncation the user
  // can reason about.
  return hits.slice(0, MAX_HITS);
}

// ---------------------------------------------------------------------------
// Clause expansion — a safety feature, not typography
// ---------------------------------------------------------------------------

/** Beyond this a "passage" is a page, and the user stops reading it. */
export const MAX_PASSAGE_CHARS = 1200;

/** How far back we will look for the numbered heading a sentence sits under. */
const CLAUSE_LOOKBACK = 700;

// German abbreviations that end in a full stop and are NOT the end of a
// sentence. Getting this wrong is not cosmetic: cutting a passage at "Abs." in
// "Abs. 2 gilt nicht für Schäden, die..." hands the user a fragment whose
// meaning is the opposite of the clause it came from.
const ABBREVIATIONS = new Set([
  'abs', 'z', 'lit', 'bzw', 'inkl', 'exkl', 'ca', 'zb', 'dh', 'bspw', 'evtl',
  'ggf', 'usw', 'etc', 'vgl', 'nr', 'art', 'pkt', 'zif', 'ziff', 'bzgl',
  'mind', 'max', 'jew', 'insb', 'iso', 'idr', 'sog', 'gem', 'lt', 'zzgl',
  'einschl', 'ua', 'uvm', 'dgl', 'abschn', 'anl', 'beil', 'hr', 'fr', 'dr',
  'prof', 'mag', 'ing', 'st', 'bzw', 'no', 'vs', 'eg', 'ie',
]);

// The forms an Austrian contract numbers its clauses with. Recognised only at
// the start of a line or a sentence, so a "(4)" mid-sentence is not mistaken
// for a heading.
const CLAUSE_START = new RegExp(
  '^[ \\t]*(?:'
  // A bare bullet is a clause start in its own right — plenty of Austrian
  // house rules and annexes list obligations as bullets with no numbering,
  // and the bullet is the only thing marking where the item begins.
  + '[-–—•*·]\\s+(?=\\S)'
  + '|(?:[-–—•*·]\\s*)?(?:'
  + '§+\\s*\\d{1,3}[a-z]?(?:\\s*\\(\\d{1,2}\\))?'      // § 8, §§ 8, § 8 (4), § 1096a
  + '|abs\\.?\\s*\\d{1,2}'                              // Abs. 2
  + '|z\\.?\\s*\\d{1,2}(?![\\d])'                       // Z 3
  + '|ziff(?:er)?\\.?\\s*\\d{1,2}'                      // Ziffer 3
  + '|punkt\\s*\\d{1,3}'                                // Punkt 5
  + '|lit\\.?\\s*[a-z]\\b'                              // lit. a
  + '|artikel\\s*\\d{1,3}'
  + '|\\(\\d{1,2}\\)'                                   // (4)
  + '|\\([a-z]\\)'                                      // (a)
  + '|[a-z]\\)'                                         // a)
  + '|\\d{1,3}(?:\\.\\d{1,3}){1,3}\\.?'                 // 8.3, 12.3.1
  + '|\\d{1,3}\\.(?=\\s)'                               // 8.  (numbered item)
  + ')(?=[\\s:.)\\u00a0]|$))',
  'i',
);

/**
 * Widen a hit outward to something a human can safely read on its own.
 *
 * THIS IS A SAFETY FEATURE. A verbatim substring can be a perfectly honest
 * quote and still reverse the meaning of the clause it came from, because
 * German legal drafting puts the exception first ("Ausgenommen davon sind
 * Schäden, die der Mieter nicht verursacht hat. Der Mieter trägt die Kosten
 * der Behebung.") and the condition last ("...sofern der Mieter den Schaden
 * nicht verursacht hat"). A quote that starts after the "Ausgenommen" or stops
 * before the "sofern" is a lie assembled entirely out of true words. So we
 * expand backwards to the sentence AND to the numbered clause the sentence
 * sits under, and forwards to the end of the sentence.
 *
 * Returns { charStart, charEnd, truncated } — offsets into pageText.
 */
export function expandToClause(pageText, charStart, charEnd) {
  const text = typeof pageText === 'string' ? pageText : '';
  const hitStart = clamp(charStart, 0, text.length);
  const hitEnd = clamp(Math.max(charEnd, hitStart), 0, text.length);
  if (!text) return { charStart: 0, charEnd: 0, truncated: false };

  const sentenceStart = findSentenceStart(text, hitStart);
  const clauseStart = findClauseStart(text, sentenceStart);
  const sentenceEnd = findSentenceEnd(text, hitEnd);

  // Prefer the widest honest passage; fall back inward only when the cap
  // forces it, and never inward past the hit itself.
  let start = clauseStart;
  let end = Math.max(sentenceEnd, hitEnd);

  if (end - start > MAX_PASSAGE_CHARS && start + MAX_PASSAGE_CHARS < hitEnd) {
    start = sentenceStart;
  }
  if (end - start > MAX_PASSAGE_CHARS && start + MAX_PASSAGE_CHARS < hitEnd) {
    start = hitStart;
  }

  let truncated = false;
  if (end - start > MAX_PASSAGE_CHARS) {
    // WHY THE START IS THE HALF WE KEEP: a leading "Ausgenommen…",
    // "Sofern nicht…", "Mit Ausnahme von…" or "Der Vermieter — nicht der
    // Mieter — …" inverts the whole passage. Losing the tail leaves a passage
    // that is incomplete, which the UI can say. Losing the head leaves a
    // passage that is WRONG, which nothing can say.
    let cut = start + MAX_PASSAGE_CHARS;
    const space = text.lastIndexOf(' ', cut);
    if (space > start + MAX_PASSAGE_CHARS * 0.8) cut = space;
    end = Math.max(cut, hitEnd);
    truncated = end < sentenceEnd;
  }

  return { charStart: start, charEnd: end, truncated };
}

function clamp(n, lo, hi) {
  const v = Number.isFinite(n) ? Math.trunc(n) : lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Is the '.' / '!' / '?' at index i a real end of sentence? */
function isSentenceEnd(text, i) {
  const ch = text[i];
  if (ch !== '.' && ch !== '!' && ch !== '?') return false;

  if (ch === '.') {
    // The token immediately before the dot decides it.
    let k = i - 1;
    while (k >= 0 && /[\p{L}]/u.test(text[k])) k -= 1;
    const word = text.slice(k + 1, i).toLowerCase();

    // "8." / "12.3." — a numbered item, not a sentence.
    if (k >= 0 && /\d/.test(text[k]) && word === '') return false;
    if (word && ABBREVIATIONS.has(word)) return false;
    // "z.B.", "d.h.", "u.a." — a lone letter before the dot is an
    // abbreviation, never a word ending a German sentence.
    if (word.length === 1) return false;
  }

  // A German sentence starts with a capital (every noun is capitalised), a
  // section sign or a digit. Followed by a lowercase letter, that dot belonged
  // to something else — "usw. und", "Nr. 4 lit. a".
  let j = i + 1;
  while (j < text.length && /[)"'»”’\]]/.test(text[j])) j += 1;
  if (j >= text.length) return true;
  if (!/\s/.test(text[j])) return false;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  if (j >= text.length) return true;
  const next = text[j];
  if (/[a-zäöüß]/.test(next)) return false;
  return true;
}

/** Start of the sentence containing `pos` (a blank line always counts). */
function findSentenceStart(text, pos) {
  for (let i = pos - 1; i >= 0; i -= 1) {
    if (isSentenceEnd(text, i)) return skipSpaceForward(text, i + 1);
    // A blank line is a hard boundary in an extracted PDF page — pdfjs gives
    // us paragraph breaks far more reliably than it gives us punctuation.
    if (text[i] === '\n' && /^[ \t\r]*\n/.test(text.slice(i + 1))) {
      return skipSpaceForward(text, i + 1);
    }
  }
  return 0;
}

/** End of the sentence containing `pos`. */
function findSentenceEnd(text, pos) {
  for (let i = Math.max(0, pos - 1); i < text.length; i += 1) {
    if (isSentenceEnd(text, i)) {
      let j = i + 1;
      while (j < text.length && /[)"'»”’\]]/.test(text[j])) j += 1;
      return j;
    }
    if (text[i] === '\n' && /^[ \t\r]*\n/.test(text.slice(i + 1))) return i;
  }
  return text.length;
}

function skipSpaceForward(text, i) {
  let j = i;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  return j;
}

/**
 * Walk back from a sentence start to the beginning of the numbered clause it
 * belongs to, if one starts close enough to plausibly be its heading.
 *
 * Candidates are line starts and sentence starts, because contracts number
 * clauses both ways: on their own line ("§ 8\nErhaltung\n(4) Der Mieter…") and
 * inline in flowing text ("… vereinbart. (4) Der Mieter hat …").
 */
function findClauseStart(text, sentenceStart) {
  const floor = Math.max(0, sentenceStart - CLAUSE_LOOKBACK);
  const candidates = [];

  if (CLAUSE_START.test(text.slice(sentenceStart, sentenceStart + 40))) return sentenceStart;

  for (let i = sentenceStart - 1; i >= floor; i -= 1) {
    if (text[i] === '\n') candidates.push(skipHorizontalSpace(text, i + 1));
    else if (isSentenceEnd(text, i)) candidates.push(skipSpaceForward(text, i + 1));
  }
  if (floor === 0) candidates.push(0);

  // candidates are already nearest-first; the nearest preceding heading is the
  // one this sentence sits under.
  for (const c of candidates) {
    if (c > sentenceStart || c < floor) continue;
    if (CLAUSE_START.test(text.slice(c, c + 40))) return c;
  }
  return sentenceStart;
}

function skipHorizontalSpace(text, i) {
  let j = i;
  while (j < text.length && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j += 1;
  return j;
}

// ---------------------------------------------------------------------------
// Coverage and the negative gate
// ---------------------------------------------------------------------------

/**
 * A page with fewer than this many non-whitespace characters has no usable
 * text layer. Twenty is deliberately generous: a scanned page routinely comes
 * back with a stray page number or a header artefact, and counting that as
 * "read" is precisely how a scan gets treated as searched.
 */
export const MIN_PAGE_CHARS = 20;

/** @returns DocCoverage (see src/types.ts) */
export function computeCoverage(pages, opts) {
  const list = Array.isArray(pages) ? pages : [];
  const pagesWithoutText = [];
  for (const p of list) {
    const text = typeof p?.text === 'string' ? p.text : '';
    const solid = text.replace(/\s+/gu, '').length;
    if (solid < MIN_PAGE_CHARS) pagesWithoutText.push(p?.n);
  }
  return {
    pagesTotal: list.length,
    pagesWithText: list.length - pagesWithoutText.length,
    pagesWithoutText,
    // Strict true — an absent or truthy-ish flag must not become "verified".
    verifiable: opts?.verifiable === true,
  };
}

/**
 * May the UI say "your document does not mention this"?
 *
 * This one boolean is what stands between the user and the most dangerous
 * sentence the product can produce. Everything else here can only be wrong in
 * a way the user can see (a passage that doesn't answer their question is
 * visibly useless); a wrong negative is invisible, is believed, and is acted
 * on by not acting.
 *
 * So it is true only when all three things hold at once:
 *   verifiable            — the text came from a real PDF text layer, not OCR
 *                           of a photo, so it can be checked against a ground
 *                           truth rather than trusted,
 *   no unreadable pages   — we cannot claim silence about a page we never read,
 *   pagesTotal > 0        — an empty document has not been searched, it has
 *                           been skipped, and "no pages" must never read as
 *                           "nothing found".
 */
export function canRenderNegative(coverage) {
  if (!coverage || typeof coverage !== 'object') return false;
  if (coverage.verifiable !== true) return false;
  if (!Array.isArray(coverage.pagesWithoutText) || coverage.pagesWithoutText.length > 0) return false;
  return coverage.pagesTotal > 0;
}

// ---------------------------------------------------------------------------
// The routing / deny gate
// ---------------------------------------------------------------------------

/**
 * Names that mean "this is an insurance document", whatever folder it was
 * filed in. No leading \b on the German stems on purpose: German compounds
 * ("Haushaltsversicherung", "Versicherungspolizze") have no word boundary
 * where an English speaker expects one.
 */
const INSURANCE_NAME = new RegExp([
  'polizze', 'polizzen', 'versicherungspolizze', 'versicherungsschein',
  'versicherung', 'versicherer', 'deckung',
  '\\binsurance\\b', '\\bpolicy\\s*schedule\\b', '\\bcover\\s*note\\b',
].join('|'), 'i');

/**
 * Decide whether this document may be read by the generic recall reader at all.
 *
 * @param {{category?: string, name?: string, spaceType?: string, insuranceReaderOn?: boolean}} input
 * @returns {{ok: boolean, reason?: string, route?: 'insurance'}}
 */
export function isEligible(input) {
  const category = String(input?.category ?? '');
  const name = String(input?.name ?? '');
  const spaceType = String(input?.spaceType ?? '');
  const insuranceReaderOn = input?.insuranceReaderOn === true;

  // Medical is excluded on self-diagnosis and special-category-data grounds,
  // NOT because the text cannot be read. Verbatim recall out of a discharge
  // letter or a lab report is exactly the material a worried person will
  // over-read, and Art. 9 GDPR data has no business flowing through a general
  // question-answering path at all.
  //
  // BOTH WORDS, because this app has two category vocabularies for the same
  // pile of files: VaultDocument.category says 'Medical', FamilyDocument
  // .category (the per-member Documents tab, src/types.ts:36) says 'Health'.
  // Checking only one of them denies the shared vault copy of a lab result and
  // admits the copy sitting on the member's own profile — the same document,
  // the same risk, filed twice under two spellings.
  if (category === 'Medical' || category === 'Health') return { ok: false, reason: 'medical' };

  // THE BACK DOOR THIS CLOSES: the insurance reader is a separate, more
  // constrained feature behind FEATURE_INSURANCE_READER, and that flag is
  // blocked on an Austrian lawyer's opinion about GewO §137 (whether reading a
  // policy back to someone is Versicherungsvermittlung). Without a name check
  // here, a user files their Polizze under "Financial", asks a question, and
  // the entire gate is bypassed in one tap — the generic reader would answer
  // insurance questions out of an insurance document while the feature it was
  // carved out of is still switched off pending legal advice. Category is the
  // user's filing habit; the name is the evidence.
  if (INSURANCE_NAME.test(name) && !insuranceReaderOn) {
    return { ok: false, reason: 'insurance', route: 'insurance' };
  }

  // Deferred until per-member document scoping exists. Today every member of a
  // space can read every other member's records, so pointing a document reader
  // at business documents would put employment contracts and salary clauses
  // one tap away from every coworker.
  if (spaceType === 'business') return { ok: false, reason: 'business' };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Clause listing — the way out of the empty-search dead end
// ---------------------------------------------------------------------------

/**
 * Every clause in the document, in reading order, whether or not anything
 * matched.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sweep above is a keyword search, and a keyword search has one failure
 * mode that no amount of tuning removes: the user's word is simply not in the
 * document. Someone with two dead sockets types "Elektriker". An Austrian lease
 * says "Elektroleitungen", "Erhaltungspflichten", "Behebung". Zero hits — and
 * before this function existed, zero hits meant zero CANDIDATES, which meant
 * the ranking model was never called at all and the user was told, in effect,
 * that their lease is silent about electrics while § 8 sits there saying who
 * pays for them.
 *
 * The old answer to that was to keep adding synonyms to SYNONYM_CLUSTERS. That
 * is an infinite job: every trade, every appliance, every dialect word, in two
 * languages, forever — and each gap is invisible until a real person hits it
 * and is told something false.
 *
 * So when the search finds nothing, we stop searching and start LISTING: hand
 * the model the document's own clauses and let it point at the ones that deal
 * with what was asked. That is a judgement about relevance, which is exactly
 * what a language model is for, and it generalises to words nobody enumerated.
 *
 * WHAT THIS DOES NOT CHANGE: the model still only ever returns ids. Every
 * character the user reads is still sliced by the server out of the page it
 * holds. Nothing is generated, and a clause the model nominates is marked
 * matchedSearch:false so the UI can say plainly that these are related clauses
 * rather than matches for the words that were typed.
 */
export function splitClauses(pages, opts = {}) {
  const max = Number.isFinite(opts.max) ? opts.max : 400;
  const minChars = Number.isFinite(opts.minChars) ? opts.minChars : 40;
  const out = [];

  for (const p of Array.isArray(pages) ? pages : []) {
    const text = typeof p?.text === 'string' ? p.text : '';
    const page = typeof p?.n === 'number' ? p.n : null;
    if (!text || page === null) continue;

    // Keyed by start offset, keeping the LONGEST range that starts there.
    // expandToClause widens backwards to the numbered-clause marker, so three
    // sentences under "(4)" all report the same start and progressively later
    // ends; keeping the longest collapses them into the one paragraph a human
    // would call the clause, instead of three nested near-duplicates.
    const byStart = new Map();

    let i = 0;
    let guard = 0;
    while (i < text.length && guard < 20000) {
      guard += 1;
      while (i < text.length && WHITESPACE.test(text[i])) i += 1;
      if (i >= text.length) break;

      const { charStart, charEnd } = expandToClause(text, i, Math.min(i + 1, text.length));
      const s = Math.max(0, Math.min(charStart, text.length));
      const e = Math.max(s, Math.min(charEnd, text.length));

      const prev = byStart.get(s);
      if (!prev || e > prev) byStart.set(s, e);

      // Forward progress is not optional: expandToClause can legitimately
      // return a range that starts BEFORE i and ends AT i, and a loop that
      // trusted its end offset would sit still forever.
      i = e > i ? e : i + 1;
    }

    for (const [s, e] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
      const slice = text.slice(s, e);
      if (slice.trim().length < minChars) continue;
      out.push({ page, charStart: s, charEnd: e, text: slice });
      if (out.length >= max) return out;
    }
  }

  return out;
}
