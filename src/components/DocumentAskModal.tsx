import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Search, Loader2, FileText, Copy, Share2, Check, ExternalLink,
  AlertTriangle, Scale, ChevronDown, Quote,
} from 'lucide-react';
import { DocCoverage, DocPassage, DocReadResult } from '../types';
import { readDocument } from '../utils/docReader';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { canShare } from '../utils/share';
import { auth } from '../lib/firebase';
import SheetGrabber from './SheetGrabber';

// ---------------------------------------------------------------------------
// DocumentAskModal — the user-facing surface of the recall-only reader.
//
// This component IS the legal boundary made visible. Almost every string below
// is a fixed template that lives in this file; the ONLY variable text that ever
// reaches the screen is (a) a verbatim slice of the user's own document, cut by
// the server out of text this client extracted, and (b) the literal search terms
// that were swept for. The model's outputs are character offsets and a topic tag
// from a closed list — it never authors a sentence anybody reads.
//
// The most dangerous thing this feature can do is NOT invent a quote (the server
// slices, so it structurally can't). It is to say, confidently, "your lease
// doesn't mention that". That is the default outcome of every extraction gap,
// image-only page and missed synonym; it is silent; and a missed legal deadline
// is a real dated loss. So the zero-passage state is a FIXED TEMPLATE RENDERED
// HERE (see NoMatchState), it names what was searched for, and it names the
// pages we could not read — computed from `coverage` in this file, never trusted
// from a flag the server sent.
//
// TODO (decided follow-up, deliberately not shipped in v1): a "translate this
// clause" button. It is blocked on a lawyer's answer about whether rendering a
// German clause in English crosses from recall into interpretation. Shipping it
// now would be the one thing in this design that has not been signed off.
// ---------------------------------------------------------------------------

export interface DocumentAskModalDoc {
  id: string;
  name: string;
  category: string;
  fileType: string;
  /** data: or https: URL of the file itself — handed straight to extractDocText. */
  src: string;
  /** Object path in the vault bucket. Without it, a scanned document (no text
   *  layer) cannot be OCR'd — the server fetches the bytes itself and refuses
   *  anything outside the caller's own family. See server/docOcr.mjs. */
  storagePath?: string;
  /** Invalidates the server-side OCR cache when a scan is replaced. */
  contentHash?: string;
}

export interface DocumentAskModalProps {
  doc: DocumentAskModalDoc | null;
  isBusinessSpace?: boolean;
  /**
   * A search phrase to prefill AND run immediately, without the user typing or
   * tapping anything. Set when the assistant opened this — the user already
   * asked their question in the chat, and making them re-type it into a second
   * box would be the app forgetting what it was just told. Chat stays the
   * mouthpiece; this sheet is only where the answer is rendered.
   *
   * The document text still never reaches the chat model: this runs the same
   * /api/doc-read call as a manual ask. Only the ENTRY POINT moved.
   */
  autoQuestion?: string;
  onClose: () => void;
}

/**
 * AUSTRIA-SPECIFIC. These are the places a Vienna tenant can actually take a
 * clause to; they are listed as plain information, not as a recommendation, and
 * deliberately include the "this one costs money / needs membership" fact next
 * to each so the list is not quietly selling anything.
 *
 * When Teluva opens to South African users this needs its own equivalent list
 * (Rental Housing Tribunal, Legal Aid SA, the relevant Law Society) chosen by
 * the space's country rather than hardcoded — do not just append SA bodies to
 * this array, an Austrian tenant should never be pointed at a SA tribunal.
 */
const WHO_CAN_ANSWER: { name: string; note: string }[] = [
  { name: 'Mieterhilfe (City of Vienna)', note: 'free tenancy advice' },
  { name: 'Mietervereinigung / Mieterschutzverband', note: 'membership-based' },
  { name: 'Arbeiterkammer Wien', note: 'free for members' },
];

/**
 * Example questions, by document category. These are not suggestions about what
 * matters — they are the words most likely to actually appear in that kind of
 * document, which is the only thing a keyword sweep can help with.
 */
const EXAMPLE_TERMS: Record<string, string[]> = {
  Legal: ['repairs', 'notice period', 'deposit', 'ending the lease'],
  Financial: ['fees', 'payment dates', 'cancellation'],
};
const DEFAULT_EXAMPLE_TERMS = ['dates', 'obligations', 'contact details'];

/**
 * Fixed copy for the server's three refusal reasons. The server sends a machine
 * `reason`, never the sentence — so the wording a user reads for "we won't read
 * your medical records" is reviewable here, in the codebase, rather than being
 * whatever a prompt produced that day.
 */

/** How many quotes show before the "show the rest" control appears. */
const INITIAL_VISIBLE_PASSAGES = 3;

const LONG_PRESS_MS = 450;

/**
 * Whether a negative ("no passage matched") may be stated without also naming
 * what we could not read.
 *
 * COMPUTED HERE ON PURPOSE. server/docRead.mjs exports its own canRenderNegative
 * and the response could easily have carried a boolean — but a boolean is a
 * claim, and the one claim this whole feature exists to never make on faith is
 * "I read all of it". `coverage` carries the raw facts (page counts, which pages
 * had no text layer, whether the source is checkable at all), so the client
 * derives the answer from the facts it can see rather than trusting a flag that
 * a server bug, a cache, or a future refactor could flip to `true`.
 */
function canRenderNegativeFrom(coverage: DocCoverage): boolean {
  return coverage.verifiable && coverage.pagesWithoutText.length === 0;
}

/** "3", "3 and 5", "3, 5 and 9" — for naming unread pages in prose. */
function pageList(pages: number[]): string {
  if (pages.length === 0) return '';
  if (pages.length === 1) return String(pages[0]);
  return `${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Pulls a leading clause reference off a passage so a copied quote carries its
 * own address — "§ 8 (4), page 3 — Home Lease Agreement: …" rather than an
 * orphan sentence nobody can find again in the original.
 *
 * This is pure string work on the user's own text: server/docRead.mjs's
 * expandToClause already widened each passage BACK to the start of its enclosing
 * numbered clause, so when a clause marker exists it is at character 0. Nothing
 * is inferred — if the pattern isn't literally there, there is no reference.
 */
function clauseRef(text: string): string | null {
  const m = text.match(
    /^\s*(§+\s*\d+[a-zA-Z]?(?:\s*\(\d+\))?(?:\s*Abs\.?\s*\d+)?|Abs\.?\s*\d+|\d+(?:\.\d+)+|\([a-zA-Z0-9]{1,3}\))/,
  );
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

export default function DocumentAskModal({ doc, isBusinessSpace = false, autoQuestion, onClose }: DocumentAskModalProps) {
  useBodyScrollLock(!!doc);

  const [question, setQuestion] = useState('');
  // Two distinct busy phases because they feel completely different: pulling the
  // text layer out of a 40-page PDF is seconds of local work with no network at
  // all, and a spinner that says "Searching…" for that whole time reads as a
  // hang. Say what is actually happening.
  const [phase, setPhase] = useState<'idle' | 'extracting' | 'searching'>('idle');
  const [result, setResult] = useState<DocReadResult | null>(null);
  const [askedQuestion, setAskedQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [showAllPassages, setShowAllPassages] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic id for the in-flight read. Extraction + a Gemini round-trip is
  // easily several seconds, and the user can close the sheet and open it on a
  // DIFFERENT document inside that window. Without this, document A's passages
  // paint under document B's name and provenance line — quotes attributed to a
  // document they did not come from, which is the worst single bug this screen
  // could have. Every setState after an await checks it still owns the run.
  const runIdRef = useRef(0);
  // "<docId>::<phrase>" of the assistant-supplied ask already started, so it is
  // run exactly once. Cleared on close so reopening the same document from a
  // later chat message asks again rather than showing an empty sheet.
  const autoRunRef = useRef('');

  // Which passages are on screen. The response carries BOTH the ones the model
  // judged to answer the question (surfaced) and the ones code found but the
  // model set aside (surfaced:false) — see DocPassage.surfaced. Collapsed, only
  // the surfaced ones show; expanded, everything does, so "showing 3 of 7" is a
  // control that reveals the other four rather than a number that just admits
  // they exist. Document order throughout: re-sorting by relevance would be an
  // unlabelled judgement about which of the user's own clauses matters most.
  const surfaced = useMemo(
    () => (result?.passages ?? []).filter((p) => p.surfaced !== false),
    [result],
  );
  const visible = useMemo(() => {
    if (!result) return [];
    if (showAllPassages) return result.passages;
    return surfaced.slice(0, INITIAL_VISIBLE_PASSAGES);
  }, [result, showAllPassages, surfaced]);

  const docId = doc?.id ?? null;

  // Hard reset on every change of document (and on close). Deliberately keyed on
  // the id, not the object: callers commonly build the `doc` prop inline, so the
  // object identity changes on every parent render and an object-keyed effect
  // would wipe the result the user is reading.
  useEffect(() => {
    runIdRef.current += 1;
    setQuestion('');
    setPhase('idle');
    setResult(null);
    setAskedQuestion('');
    setError(null);
    setBlocked(null);
    setShowAllPassages(false);
    setHelpOpen(false);
    if (!docId) autoRunRef.current = '';
  }, [docId]);

  const busy = phase !== 'idle';

  const runRead = useCallback(async (rawQuestion: string) => {
    const q = rawQuestion.trim();
    if (!doc || !q || busy) return;

    const runId = ++runIdRef.current;
    const owns = () => runIdRef.current === runId;

    setError(null);
    setBlocked(null);
    setResult(null);
    setShowAllPassages(false);
    setHelpOpen(false);
    setAskedQuestion(q);
    // Both stages are one call now, so this sheet can no longer distinguish
    // "extracting" from "searching". They were never separately actionable —
    // nothing the user could do differed between them — and one honest spinner
    // beats two labels that have to be kept in step with utils/docReader.ts.
    setPhase('searching');

    // The pipeline itself lives in utils/docReader.ts because the chat runs the
    // IDENTICAL read and renders it inline. The safety-carrying parts (the
    // no-text-layer short-circuit, trusting locally-computed coverage, 403 as a
    // refusal rather than an error) must not drift between the two, so there is
    // one implementation and two ways of drawing it.
    const outcome = await readDocument(
      {
        name: doc.name,
        category: doc.category,
        fileType: doc.fileType,
        src: doc.src,
        storagePath: doc.storagePath,
        contentHash: doc.contentHash,
      },
      q,
      { isBusinessSpace },
    );
    if (!owns()) return;

    setPhase('idle');
    if (outcome.kind === 'result') setResult(outcome.result);
    else if (outcome.kind === 'blocked') setBlocked(outcome.message);
    else setError(outcome.message);   // 'unreadable' and 'error' both read as an error here
  }, [doc, busy, isBusinessSpace]);

  // The assistant opened this with a question already in hand — run it.
  //
  // Guarded by a ref keyed on document + phrase rather than by the effect deps
  // alone: runRead is rebuilt on every `busy` flip, so a plain dependency on it
  // would re-fire the moment the first read finishes and bill a second AI
  // action for a question nobody asked twice. The ref makes "this exact ask has
  // been started" a fact that survives re-renders.
  useEffect(() => {
    const phrase = (autoQuestion || '').trim();
    if (!doc || !phrase) return;
    const key = `${doc.id}::${phrase}`;
    if (autoRunRef.current === key) return;
    autoRunRef.current = key;
    setQuestion(phrase);
    void runRead(phrase);
  }, [doc, autoQuestion, runRead]);

  const askAgain = useCallback(() => {
    setResult(null);
    setError(null);
    setBlocked(null);
    setAskedQuestion('');
    setHelpOpen(false);
    // rAF: the input is in the pinned footer and only becomes the visual focus
    // once the results above it are gone. Focusing in the same tick fires the
    // mobile keyboard while the layout is still collapsing and the field ends up
    // scrolled off under it.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const openDocument = useCallback(() => {
    if (!doc) return;
    window.open(doc.src, '_blank', 'noopener,noreferrer');
  }, [doc]);

  const examples = (doc && EXAMPLE_TERMS[doc.category]) || DEFAULT_EXAMPLE_TERMS;

  return (
    <AnimatePresence>
      {doc && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="doc-ask-title"
            className="relative z-10 w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-lift max-h-[92dvh] flex flex-col"
          >
            <SheetGrabber onClose={onClose} className="pt-2" />

            {/* ── Pinned top. Everything here stays on screen while the quotes
                 scroll underneath: the document you are reading, and the two
                 statements the quotes are only safe to read in the presence of. */}
            <div className="shrink-0 px-4 sm:px-5 pt-3 pb-3 border-b border-cream-200 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-2xl bg-cream-100 text-ink-500 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 id="doc-ask-title" className="font-display text-[17px] font-bold text-ink-900 leading-tight truncate">
                      {doc.name}
                    </h2>
                    <p className="text-[12px] text-ink-500">Ask what it says — you get its own words back.</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 -m-1 rounded-xl text-ink-400 hover:text-ink-700 hover:bg-cream-100 cursor-pointer shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* RULE A — never collapsible, never behind a "learn more". If the
                  quotes are on screen, this sentence is on screen. */}
              <p className="text-[12px] leading-snug text-ink-600 bg-cream-100 border border-cream-300 rounded-xl px-3 py-2">
                These are the exact words from your own document. Teluva doesn&rsquo;t interpret them and
                doesn&rsquo;t give legal advice.
              </p>

              {result && <ProvenanceLine coverage={result.coverage} docName={doc.name} />}
            </div>

            {/* ── Scrolling body ── */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
              {busy && <BusyState phase={phase} />}

              {!busy && blocked && (
                <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4 space-y-3">
                  <p className="text-[14px] leading-relaxed text-ink-700">{blocked}</p>
                  <button type="button" onClick={openDocument} className="btn-quiet text-[13px] px-4 py-2">
                    <ExternalLink className="w-3.5 h-3.5" /> Open the document
                  </button>
                </div>
              )}

              {!busy && error && (
                <div className="rounded-2xl border border-rosa-100 bg-rosa-50 p-4 space-y-3">
                  <p className="text-[13.5px] leading-relaxed text-rosa-800">{error}</p>
                  <button type="button" onClick={openDocument} className="btn-quiet text-[13px] px-4 py-2">
                    <ExternalLink className="w-3.5 h-3.5" /> Open the document
                  </button>
                </div>
              )}

              {!busy && !blocked && !error && !result && (
                <IdleState
                  examples={examples}
                  onPick={(term) => { setQuestion(term); void runRead(term); }}
                />
              )}

              {!busy && !blocked && !error && result && visible.length === 0 && (
                <NoMatchState
                  result={result}
                  onOpenDocument={openDocument}
                  onAskAgain={askAgain}
                />
              )}

              {!busy && !blocked && !error && result && visible.length > 0 && (
                <>
                  <SelectionTransparency
                    result={result}
                    expanded={showAllPassages}
                    onExpand={() => setShowAllPassages(true)}
                  />

                  <div className="space-y-2.5">
                    {visible.map((p, i) => (
                      <QuoteCard
                        key={`${p.page}-${p.charStart}-${i}`}
                        passage={p}
                        docName={doc.name}
                        verifiable={result.coverage.verifiable}
                      />
                    ))}
                  </div>

                  <EscalationFooter
                    open={helpOpen}
                    onToggle={() => setHelpOpen((v) => !v)}
                    onAskAgain={askAgain}
                  />
                </>
              )}
            </div>

            {/* ── Pinned footer: the question box.
                 Bottom, not top, because this is a one-handed standing-up screen
                 and the thumb lives here. It stays mounted while results are
                 shown so a follow-up word is one tap away. */}
            <form
              className="shrink-0 border-t border-cream-200 p-3 sm:p-4 flex items-center gap-2 bg-white rounded-b-none sm:rounded-b-3xl"
              onSubmit={(e) => { e.preventDefault(); void runRead(question); }}
            >
              <input
                ref={inputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What does this document say about…"
                enterKeyHint="search"
                autoComplete="off"
                className="field flex-1"
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !question.trim()}
                className="btn-primary px-4 shrink-0 disabled:opacity-50"
                aria-label="Search this document"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------

function BusyState({ phase }: { phase: 'extracting' | 'searching' | 'idle' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-5 text-[13.5px] text-ink-600">
      <Loader2 className="w-4 h-4 animate-spin text-clay-700 shrink-0" />
      {/* Honest, not decorative: extraction is local and can take a while on a
          big PDF, and it is not the same wait as the network round-trip. */}
      <span>{phase === 'extracting' ? 'Reading the document…' : 'Searching…'}</span>
    </div>
  );
}

function IdleState({ examples, onPick }: { examples: string[]; onPick: (term: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[13.5px] text-ink-600 leading-relaxed">
        Type a word and I&rsquo;ll show you every place it appears, in the document&rsquo;s own wording.
      </p>
      <div className="flex flex-wrap gap-2">
        {examples.map((term) => (
          <button
            key={term}
            type="button"
            onClick={() => onPick(term)}
            // min-h-11: standing-up, one-handed. A 20px chip is not a tap target.
            className="chip min-h-11 px-4 bg-cream-100 text-ink-700 hover:bg-cream-200 cursor-pointer transition-colors"
          >
            <Search className="w-3 h-3" /> {term}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * RULE B — composed here, in code, out of the coverage numbers. Nothing the
 * server's model produced contributes a single word of it. Partial coverage gets
 * the honey/amber cautionary treatment because a user who skims past it will
 * read the results below as if they came from the whole document.
 */
function ProvenanceLine({ coverage, docName }: { coverage: DocCoverage; docName: string }) {
  const unread = coverage.pagesWithoutText;
  const full = unread.length === 0;

  if (full && coverage.verifiable) {
    return (
      <p className="text-[11.5px] leading-snug text-ink-500">
        Read from the text of all {coverage.pagesTotal} {plural(coverage.pagesTotal, 'page', 'pages')} of {docName}.
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-xl bg-honey-50 border border-honey-200 px-3 py-2">
      <AlertTriangle className="w-3.5 h-3.5 text-honey-800 shrink-0 mt-0.5" />
      <p className="text-[11.5px] leading-snug text-honey-900">
        {unread.length > 0 ? (
          // NOT "…are scanned images", which is what this line originally said.
          // buildCoverage() in utils/docText.ts puts a page in pagesWithoutText
          // for THREE reasons — no text layer, text we truncated at the char
          // budget, and pages the extractor never reached — and only the first
          // is a scan. Naming a false cause is the same failure this whole
          // screen exists to prevent, and it is the more dangerous direction: a
          // user who knows page 12 is typed text reads "page 12 is a scanned
          // image" as a glitch and dismisses the warning, when the warning is
          // real and means we did not read page 12.
          <>
            I could only read {coverage.pagesWithText} of {coverage.pagesTotal} pages as text — I
            couldn&rsquo;t read {plural(unread.length, 'page', 'pages')} {pageList(unread)} (scanned
            images, or more text than I could take in).
          </>
        ) : (
          <>
            {/* verifiable === false with every page carrying text: the text came
                from OCR of a photo/scan, so it cannot be checked against a ground
                truth. Same warning weight — for the same reason. */}
            This document was read as an image, so its text came from OCR and I can&rsquo;t check it
            against the original.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * RULE D — selection transparency.
 *
 * Verbatim quoting is structurally blind to exactly one interpretive act:
 * choosing WHICH verbatim quotes to show. If the deterministic sweep found seven
 * matches and three are on screen, the edit is the opinion. So the count is
 * stated plainly, at the top, in normal-weight body text — not tucked into a
 * footnote — and the terms that were swept for are shown verbatim so the user can
 * see that "repairs" was searched and "Instandhaltung" was not.
 */
const SEARCH_TERMS_PREVIEW = 8;

function SelectionTransparency({
  result, expanded, onExpand,
}: { result: DocReadResult; expanded: boolean; onExpand: () => void }) {
  const [searchTermsOpen, setSearchTermsOpen] = useState(false);
  const surfacedCount = result.passages.filter((p) => p.surfaced !== false).length;
  const shown = expanded ? result.passages.length : Math.min(INITIAL_VISIBLE_PASSAGES, surfacedCount);
  const hiddenInPayload = result.passages.length - shown;
  // Hits the sweep found that the server did not serialise at all (its cap on
  // set-aside passages). The expand cannot reveal these, so it says so rather
  // than letting the count quietly disagree with what the button produces.
  const missingFromPayload = Math.max(0, result.totalHits - result.passages.length);

  return (
    <div className="space-y-1.5">
      {result.related && (
        // Nothing in the document contained the words that were typed; every
        // clause below is here because it is ABOUT the subject. That has to be
        // stated before the passages, not inferred from a chip beside them —
        // a related clause read as a match is how someone comes away believing
        // their lease says something it does not.
        <p className="text-[13.5px] leading-relaxed text-ink-700">
          Nothing in this document uses those words. These clauses are about the same subject —
          read them yourself before relying on them.
        </p>
      )}
      {result.totalHits > shown && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13px] font-semibold text-ink-800">
            Showing {shown} of {result.totalHits} matches
          </p>
          {hiddenInPayload > 0 && (
            <button
              type="button"
              onClick={onExpand}
              className="chip min-h-11 px-3 bg-dusk-50 text-dusk-700 border border-dusk-100 hover:bg-dusk-100 cursor-pointer transition-colors"
            >
              <ChevronDown className="w-3 h-3" /> Show the other {hiddenInPayload} anyway
            </button>
          )}
        </div>
      )}

      {expanded && missingFromPayload > 0 && (
        <p className="text-[11.5px] leading-snug text-ink-500">
          {missingFromPayload} further {plural(missingFromPayload, 'match', 'matches')} for the same words
          {plural(missingFromPayload, ' is', ' are')} in the document but not in this result. Search a
          narrower word to bring {plural(missingFromPayload, 'it', 'them')} up.
        </p>
      )}

      {/* A real question expands to ~50 terms, most of them German stems the
          user never typed. Dumping all of them reads as noise and the honesty
          is lost in it — so lead with a readable handful and let the rest open.
          The full list stays reachable: "these are the words I looked for" is
          only a meaningful claim if the user can actually check it, which is
          the same reason the passages themselves ship set-aside and all. */}
      {result.searchedFor.length > 0 && (
        <p className="text-[11.5px] leading-snug text-ink-500">
          I searched: {(searchTermsOpen ? result.searchedFor : result.searchedFor.slice(0, SEARCH_TERMS_PREVIEW)).join(', ')}
          {!searchTermsOpen && result.searchedFor.length > SEARCH_TERMS_PREVIEW && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => setSearchTermsOpen(true)}
                className="underline underline-offset-2 font-semibold text-ink-600 hover:text-ink-900 cursor-pointer"
              >
                and {result.searchedFor.length - SEARCH_TERMS_PREVIEW} more
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * RULE C — one verbatim passage, with the address it came from.
 *
 * The copy affordance is hand-rolled rather than reusing CopyableValue on
 * purpose. CopyableValue's menu carries a "Scan" action that hands its content
 * to the AI chat — and free-form AI prose about a lease clause is the precise
 * failure mode this entire screen exists to prevent. What IS reused is its label
 * convention: the copied string is prefixed with what the value is, so a quote
 * pasted into WhatsApp arrives as
 * "§ 8 (4), page 3 — Home Lease Agreement: …" and not as an orphan sentence.
 *
 * data-copy-scan marks this block as already-handled so GlobalCopyScan's
 * document-level long-press backs off — its generic copy would lift the bare
 * quote WITHOUT the page and document name, which is the one part that makes a
 * quote usable by an adviser.
 */
interface QuoteCardProps {
  passage: DocPassage;
  docName: string;
  verifiable: boolean;
  key?: string;   // tolerated so `<QuoteCard key={…} … />` type-checks (same reason as Tile in FamilyStats.tsx)
}

function QuoteCard({ passage, docName, verifiable }: QuoteCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const ref = clauseRef(passage.text);
  const label = `${ref ? `${ref}, ` : ''}page ${passage.page} — ${docName}`;
  const copyText = `${label}: ${passage.text}`;

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };
  useEffect(() => clearTimer, []);

  const startPress = () => {
    firedRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setMenuOpen(true);
      try { navigator.vibrate?.(10); } catch { /* unsupported — purely a nicety */ }
    }, LONG_PRESS_MS);
  };

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — nothing to fall back to, fail quiet */ }
    setMenuOpen(false);
  };

  const doShare = async () => {
    try {
      await navigator.share({ title: label, text: copyText });
    } catch { /* share sheet cancelled/unavailable — not an error worth surfacing */ }
    setMenuOpen(false);
  };

  // A set-aside passage is still the user's own document, word for word, and is
  // fully copyable — it is just not being put forward as answering the question.
  // Muting the frame keeps that distinction visible without implying the text is
  // any less real than the rest.
  const setAside = passage.surfaced === false;

  return (
    <div
      data-copy-scan="1"
      className={`relative rounded-2xl border overflow-hidden ${
        setAside ? 'border-cream-200 bg-white' : 'border-cream-300 bg-cream-50'
      }`}
    >
      <div
        onPointerDown={startPress}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onClick={() => { if (!firedRef.current) setMenuOpen(true); }}
        onContextMenu={(e) => e.preventDefault()}
        className="cursor-pointer select-none p-3.5 space-y-2"
        style={{ WebkitTouchCallout: 'none' }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip bg-sage-100 text-sage-700">{passage.topic}</span>
          <span className="chip bg-cream-200 text-ink-600 tabular-nums">page {passage.page}</span>
          {ref && <span className="chip bg-cream-200 text-ink-600 font-mono">{ref}</span>}
          {!verifiable && (
            // Every passage from an unverifiable source is badged — the words are
            // OCR's reading of a photo, not a text layer we can check.
            <span className="chip bg-honey-100 text-honey-800">read from an image</span>
          )}
          {setAside && (
            // The reason it is on screen at all: code found it, the assistant
            // judged it not to answer THIS question. Saying so is the point of
            // shipping it — the user gets to disagree with that judgement.
            <span className="chip bg-cream-200 text-ink-500">found, but set aside</span>
          )}
          {!passage.matchedSearch && (
            // Honest attribution of WHY this is on screen: the deterministic
            // sweep did not find it, so a model chose it. Different level of
            // trust, said out loud rather than blended in with the rest.
            <span className="chip bg-cream-200 text-ink-500">nearby, not a direct match</span>
          )}
        </div>

        {/* No serif is defined in this theme, so the "this is a quotation, not
            our prose" signal is carried by the rule, the marks and the looser
            leading rather than by a typeface we would have to import. */}
        <div className="flex gap-2.5">
          <Quote className="w-3.5 h-3.5 text-ink-300 shrink-0 mt-1" />
          <p className="text-[14.5px] leading-relaxed text-ink-900 whitespace-pre-wrap break-words">
            &ldquo;{passage.text}&rdquo;
          </p>
        </div>
      </div>

      {copied && (
        <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-ink-900 text-white text-[11px] font-semibold px-2.5 py-1 whitespace-nowrap pointer-events-none z-10">
          <Check className="w-3 h-3" /> Copied
        </span>
      )}

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[210]" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
          <div className="absolute z-[211] bottom-2 right-2 flex items-center gap-1 rounded-xl bg-ink-900 text-white p-1 shadow-lift">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void doCopy(); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" /> Copy quote
            </button>
            {canShare && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void doShare(); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5" /> Share
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * RULE E — the zero-passage state. The highest-risk moment in the product.
 *
 * Every sentence here is a constant in this file. Nothing the server sent
 * contributes prose; the only interpolations are the literal search terms and
 * page numbers. It never says the document does not cover the topic — it says a
 * passage did not match those words, which is the only thing that is actually
 * true, and then it names the reasons that can be so.
 */
function NoMatchState({
  result, onOpenDocument, onAskAgain,
}: { result: DocReadResult; onOpenDocument: () => void; onAskAgain: () => void }) {
  const { coverage } = result;
  const unread = coverage.pagesWithoutText;
  const safeNegative = canRenderNegativeFrom(coverage);
  // Capped here for a different reason than in SelectionTransparency: this is
  // the screen where the user is deciding whether to believe "it isn't in
  // there". A wall of 50 German stems reads as the machine flailing, and the
  // sentence it is meant to support — "I really did look" — gets less credible
  // the longer the list runs. A readable handful plus the count carries it.
  const shownTerms = result.searchedFor.slice(0, SEARCH_TERMS_PREVIEW);
  const restCount = result.searchedFor.length - shownTerms.length;
  const terms = shownTerms.join(', ') + (restCount > 0 ? `, and ${restCount} more` : '');

  return (
    <div className="rounded-2xl border border-honey-200 bg-honey-50 p-4 space-y-3">
      <p className="text-[15px] font-semibold text-ink-900">No passage matched those words.</p>

      <p className="text-[13.5px] leading-relaxed text-ink-700">
        That does not mean the document doesn&rsquo;t cover it — wording, scan quality and search terms
        all affect this.{terms ? ` I searched: ${terms}.` : ''}
      </p>

      {!safeNegative && (
        <p className="text-[13.5px] leading-relaxed text-honey-900">
          {unread.length > 0 && (
            <>
              …and I couldn&rsquo;t read {plural(unread.length, 'page', 'pages')} {pageList(unread)} at all,
              so I can&rsquo;t tell you it isn&rsquo;t in {plural(unread.length, 'that one', 'those')}.
            </>
          )}
          {unread.length === 0 && (
            // Full page coverage but an unverifiable source: OCR read every page,
            // and OCR silently drops words. "Not found" is still not a fact here.
            <>
              …and this document was read as an image rather than as text, so a word OCR missed would
              look exactly like a word that isn&rsquo;t there.
            </>
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={onOpenDocument} className="btn-quiet text-[13px] px-4 py-2.5">
          <ExternalLink className="w-3.5 h-3.5" /> Open the document
        </button>
        <button type="button" onClick={onAskAgain} className="btn-quiet text-[13px] px-4 py-2.5">
          <Search className="w-3.5 h-3.5" /> Search a different word
        </button>
      </div>
    </div>
  );
}

/**
 * RULE F — the escalation.
 *
 * Users will read three verbatim clauses and then ask "so does the landlord have
 * to fix it?". There is no reliable way to detect that question, and answering it
 * is the exact thing this product must never do. So it is pre-empted instead:
 * the boundary is stated unprompted under every non-empty result, before anyone
 * gets as far as asking, and the next move is offered in the same breath.
 */
function EscalationFooter({
  open, onToggle, onAskAgain,
}: { open: boolean; onToggle: () => void; onAskAgain: () => void }) {
  return (
    <div className="pt-1 space-y-2.5 border-t border-cream-200">
      <p className="text-[12.5px] leading-relaxed text-ink-500 pt-3">
        Whether any of this legally obliges someone is a question for a person qualified to answer it —
        that&rsquo;s the one thing I can&rsquo;t tell you. What I can do is show you more of what your
        document says.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAskAgain}
          className="chip min-h-11 px-4 bg-cream-100 text-ink-700 hover:bg-cream-200 cursor-pointer transition-colors"
        >
          <Search className="w-3 h-3" /> Search this document for something else
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`chip min-h-11 px-4 cursor-pointer transition-colors ${
            open ? 'bg-dusk-100 text-dusk-700' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
          }`}
        >
          <Scale className="w-3 h-3" /> Who can actually answer this
        </button>
      </div>

      {open && (
        <div className="rounded-2xl border border-dusk-100 bg-dusk-50 p-3.5 space-y-2">
          <ul className="space-y-1.5">
            {WHO_CAN_ANSWER.map((o) => (
              <li key={o.name} className="text-[13px] leading-snug text-ink-700">
                <span className="font-semibold text-ink-900">{o.name}</span>
                <span className="text-ink-500"> — {o.note}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] leading-snug text-ink-600">
            For anything else, a Rechtsanwalt or the relevant Kammer.
          </p>
          <p className="text-[12.5px] leading-snug text-ink-600">
            They&rsquo;ll want the exact clause — which you now have. Tap a quote above to copy it.
          </p>
        </div>
      )}
    </div>
  );
}
