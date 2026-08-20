import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, PartyPopper, Check, RefreshCcw, CalendarDays, Sparkles, Loader2, AlertTriangle,
} from 'lucide-react';
import { NameCelebration } from '../types';
import { suggestLocal, LocalSuggestion, ResolvedCelebrations, celebrationDateInYear } from '../utils/nameCelebrations';
import { isValidNameDay, formatNameDay, splitNameTokens } from '../utils/nameDay';
import { auth } from '../lib/firebase';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import SheetGrabber from './SheetGrabber';

// Name Days & Name Celebrations — the confirmation UI.
//
// WHY THIS EXISTS
// This is the ONE place a suggestion becomes a fact. Every route through this
// component ends at exactly one of: a confirmed NameCelebration handed back
// via onConfirm, a recorded "no thanks" via onDismiss, or nothing at all
// (plain close). Nothing is ever written here directly — the caller
// (EditMemberModal) owns the member record and decides how to fold the
// result in, which keeps the "only one primary per member" invariant in one
// place instead of duplicated between this modal and its caller.
//
// The local Austrian table (suggestLocal) answers instantly and needs no
// network. Everything past that — a genuine cultural/religious connection for
// a name outside that calendar, or a different local match after "show me
// another" — goes through /api/name-celebration-research (mode 'suggest',
// server.js), whose sanitised proposals arrive already shaped for
// NameCelebration; an unreachable server surfaces as a plain retryable error.

function newCelebrationId(): string {
  return `celeb-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 'YYYY-MM-DD' -> '19 March 2027'. Locale-formatted rather than a hand-kept
 *  month table, since this is the only place a FULL (year-bearing) date is
 *  ever shown — everywhere else in the app a name day is a bare MM-DD. */
function formatFullDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * One proposal as /api/name-celebration-research (mode 'suggest') returns it
 * after server-side sanitising — every NameCelebration field minus the ones
 * only the family can set (id/confirmed/primary/notify). A movable rule
 * arrives with the server's own per-year resolutions already folded into
 * `resolvedDates` (this year and next, when the model resolved them with
 * confidence), so the modal never has to guess a Gregorian date client-side.
 */
interface ResearchProposal {
  title: string;
  celebrationOf: string;
  kind: NameCelebration['kind'];
  matchType: NameCelebration['matchType'];
  tradition?: string;
  explanation: string;
  source?: string;
  religious?: boolean;
  /** The server marks at most one proposal per batch as the stronger match. */
  recommended?: boolean;
  dateType: 'fixed' | 'movable';
  date?: string;
  movableRule?: string;
  resolvedDates?: Record<string, string>; // { '2026': '2026-11-24' }
}

type Proposal =
  | { origin: 'local'; local: LocalSuggestion }
  | { origin: 'research'; research: ResearchProposal };

/** The fields common to both proposal origins, normalised for display and for
 *  building the eventual NameCelebration. */
interface ProposalView {
  title: string;
  celebrationOf: string;
  kind: NameCelebration['kind'];
  matchType: NameCelebration['matchType'];
  tradition?: string;
  explanation: string;
  source?: string;
  dateType: 'fixed' | 'movable';
  date?: string;           // fixed only
  movableRule?: string;    // movable only
  resolvedDates?: Record<string, string>; // movable only — per-year cache from the server
  dateLabel: string;        // what to show on screen for "when"
  alsoOn?: { date: string; feast: string }; // local-only — the alternative Austrian date
}

function viewOf(p: Proposal): ProposalView {
  if (p.origin === 'local') {
    const { local } = p;
    return {
      title: local.feast,
      // The person's OWN token that matched — 'Sepp', not 'Josef'. A
      // NameCelebration.celebrationOf is always the real name, never the
      // catalogued form it was recognised through.
      celebrationOf: local.token,
      kind: 'name_day',
      matchType: local.matchType,
      tradition: local.tradition,
      explanation: local.explanation,
      dateType: 'fixed',
      date: local.date,
      dateLabel: formatNameDay(local.date),
      alsoOn: local.alsoOn,
    };
  }
  const r = p.research;
  // A movable rule's "when" is this year's resolution when the server had
  // one, else next year's (this year's may already have passed by the time
  // the family asks), else an honest "not yet known".
  const year = new Date().getFullYear();
  const upcoming = r.resolvedDates?.[String(year)] || r.resolvedDates?.[String(year + 1)];
  const dateLabel = r.dateType === 'fixed'
    ? formatNameDay(r.date || '')
    : (upcoming ? formatFullDate(upcoming) : 'date confirmed each year, not yet known');
  return {
    title: r.title,
    celebrationOf: r.celebrationOf,
    kind: r.kind,
    matchType: r.matchType,
    tradition: r.tradition,
    explanation: r.explanation,
    source: r.source,
    dateType: r.dateType,
    date: r.date,
    movableRule: r.movableRule,
    resolvedDates: r.resolvedDates,
    dateLabel,
  };
}

/** The spec's own framing for a second-name match — repeats the name itself
 *  rather than guessing a pronoun (the member record carries no gender field
 *  reliable enough to guess from). */
function secondNameQuestion(first: string, second: string, dateLabel: string): string {
  return `${first} does not have to be renamed. Would you like to celebrate ${first}'s second name, ${second}, on ${dateLabel}?`;
}

function originQuestion(name: string): string {
  return `Does this connection match the origin or meaning intended for ${name}'s name?`;
}

function celebrationDateLabel(c: NameCelebration): string {
  if (c.dateType === 'fixed') return formatNameDay(c.date) || 'date not set';
  const resolved = celebrationDateInYear(c, new Date().getFullYear());
  return resolved.date ? formatFullDate(resolved.date) : 'date confirmed each year, not yet known';
}

function buildCelebration(view: ProposalView, primary: boolean, notify: boolean): NameCelebration {
  const resolvedDates: Record<string, string> =
    view.dateType === 'movable' && view.resolvedDates ? { ...view.resolvedDates } : {};
  return {
    id: newCelebrationId(),
    kind: view.kind,
    title: view.title,
    celebrationOf: view.celebrationOf,
    matchType: view.matchType,
    tradition: view.tradition,
    explanation: view.explanation,
    source: view.source,
    dateType: view.dateType,
    date: view.dateType === 'fixed' ? view.date : undefined,
    movableRule: view.dateType === 'movable' ? view.movableRule : undefined,
    resolvedDates: Object.keys(resolvedDates).length ? resolvedDates : undefined,
    confirmed: true,
    primary,
    notify,
  };
}

type Phase = 'proposal' | 'custom' | 'primary-choice';

/** One question from the custom-date assist. `hint` is placeholder text only. */
interface AssistQuestion { id: string; question: string; hint?: string }

export interface NameCelebrationModalProps {
  open: boolean;
  /** Name/nickname as CURRENTLY TYPED in the editor, not the saved member —
   *  this modal is opened from an in-progress edit and must never re-read
   *  Firestore, so a name being fixed in the same session is what gets
   *  matched, not the stale record underneath it. */
  displayName: string;
  nickname?: string;
  /** The caller's merged view (legacy nameDay + nameCelebrations[]) computed
   *  over its OWN in-progress state via resolveCelebrations(). This modal
   *  never touches Firestore or the member object directly. */
  existing: ResolvedCelebrations;
  dismissed: boolean;
  suppressReligiousSuggestions: boolean;
  /**
   * Turn the family-wide religious-suggestion switch on or off from in here.
   *
   * PRESENT = the caller is an admin and may change it. ABSENT = they may not,
   * and the copy says who can instead of offering a button that would come
   * back 403 (the server enforces admin on /api/set-suggestion-prefs — this
   * prop only decides what to draw).
   *
   * It exists because the message telling you the switch is blocking the
   * search was a dead end: the only way to act on it was to abandon the edit,
   * leave for Members & roles, and come back. Same reason the calendar's empty
   * name-days panel now names its path.
   *
   * Must RESOLVE before the next research call — the server re-reads the
   * family flag on every one, so a fire-and-forget save would race it and the
   * first search after switching would still come back suppressed.
   */
  onChangeSuppressReligious?: (suppress: boolean) => Promise<void>;
  /** A fully-formed, confirmed NameCelebration — id/primary/notify already
   *  decided. The caller is responsible for the single-primary invariant
   *  (demote any other confirmed primary when celebration.primary is true). */
  onConfirm: (celebration: NameCelebration) => void;
  /** "No name celebration" — the caller records the dismissal. */
  onDismiss: () => void;
  onClose: () => void;
}

export default function NameCelebrationModal({
  open, displayName, nickname, existing, dismissed, suppressReligiousSuggestions,
  onChangeSuppressReligious, onConfirm, onDismiss, onClose,
}: NameCelebrationModalProps) {
  useBodyScrollLock(open);

  const [phase, setPhase] = useState<Phase>('proposal');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [rejectedTitles, setRejectedTitles] = useState<string[]>([]);
  // Research returns up to 3 proposals in one (metered) call — the
  // recommended one leads, the rest wait here so "Show another connection"
  // serves a genuine alternative the model already offered (the spec's Ganga
  // case: Dev Deepawali recommended, Maha Shivaratri as the alternative)
  // before spending another AI call.
  const [researchQueue, setResearchQueue] = useState<ResearchProposal[]>([]);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchExhausted, setResearchExhausted] = useState(false);

  const [customTitle, setCustomTitle] = useState('');
  const [customCelebrationOf, setCustomCelebrationOf] = useState('');
  const [customExplanation, setCustomExplanation] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  // "Help me work it out" — the custom form asks for a title, a reason and a
  // date up front, which is three blank boxes when what a family actually has
  // is a feeling that some day matters. This asks two or three questions and
  // writes the boxes from the answers.
  //
  // It FILLS the form rather than replacing it: every field stays editable and
  // nothing is saved until they press Save, so the assistant is a first draft
  // and the family still has the last word. That also means a proposal that
  // comes back without a date is a perfectly good outcome — see the server's
  // never-invent-a-date rule.
  const [assistQuestions, setAssistQuestions] = useState<AssistQuestion[] | null>(null);
  const [assistAnswers, setAssistAnswers] = useState<Record<string, string>>({});
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistMissing, setAssistMissing] = useState<string | null>(null);

  const [pendingCelebration, setPendingCelebration] = useState<NameCelebration | null>(null);
  const [primaryPick, setPrimaryPick] = useState<'existing' | 'new'>('existing');
  // Which phase asked the primary-choice question, so "Back" returns to
  // wherever the family actually was — the custom-date form (with what they
  // typed still in it) rather than always falling back to the proposal card.
  const [pendingFromPhase, setPendingFromPhase] = useState<Phase>('proposal');

  const firstName = splitNameTokens(displayName)[0] || displayName;

  // Reset to the local suggestion (if any) every time the modal opens. Not
  // re-run on every prop change: the editor behind this modal is not
  // interactive while it's open, so name/nickname/existing cannot change
  // mid-session — only `open` flipping true matters.
  useEffect(() => {
    if (!open) return;
    setPhase('proposal');
    setRejectedTitles([]);
    setResearchQueue([]);
    setResearchError(null);
    setResearchExhausted(false);
    setPendingCelebration(null);
    setPrimaryPick('existing');
    const local = dismissed
      ? null
      : suggestLocal(
          { name: displayName, nickname, nameCelebrationDismissed: false, nameCelebrations: existing.all },
          { suppressReligiousSuggestions },
        );
    setProposal(local ? { origin: 'local', local } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const view = proposal ? viewOf(proposal) : null;

  /**
   * `suppressOverride` exists for exactly one caller: the admin who has just
   * turned religious suggestions back on. This function closes over the
   * `suppressReligiousSuggestions` PROP, and the prop is still the old `true`
   * during the tick in which that handler runs — so without the override the
   * search fired straight after switching would post suppressReligious: true,
   * the server would OR it with the (now false) family flag and suppress
   * anyway, and the family would see the same empty result. The button would
   * look broken while having worked perfectly.
   */
  async function runResearch(rejected: string[], suppressOverride?: boolean) {
    setResearching(true);
    setResearchError(null);
    setResearchExhausted(false);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const res = await fetch('/api/name-celebration-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mode: 'suggest',
          name: displayName,
          // The server's prompt reasons about steps 3-4 per token, so it gets
          // the same split the local matcher walked.
          givenNames: splitNameTokens(displayName),
          nickname: nickname || undefined,
          suppressReligious: suppressOverride ?? suppressReligiousSuggestions,
          rejectedTitles: rejected,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not reach the research service.');
      const proposals: ResearchProposal[] = Array.isArray(data.proposals) ? data.proposals : [];
      // Recommended leads; genuine alternatives from the same answer queue up
      // behind it for "Show another connection".
      const ordered = [
        ...proposals.filter((r) => r.recommended),
        ...proposals.filter((r) => !r.recommended),
      ];
      const [next, ...rest] = ordered;
      setResearchQueue(rest);
      if (!next) {
        setResearchExhausted(true);
        setProposal(null);
      } else {
        setProposal({ origin: 'research', research: next });
      }
    } catch (e) {
      setResearchError(e instanceof Error ? e.message : 'Could not reach the research service.');
    } finally {
      setResearching(false);
    }
  }

  // Turn the family-wide switch back on and immediately do what the family
  // came here for. Two things are deliberate:
  //  - the save is AWAITED before searching again, because the server re-reads
  //    the family flag on every research call and would otherwise still see
  //    the old value;
  //  - rejectedTitles is NOT cleared. Those are titles the family actually saw
  //    and declined, and "never repeat a declined title" holds regardless of
  //    why the last search came back empty.
  const [allowingReligious, setAllowingReligious] = useState(false);
  const [allowReligiousError, setAllowReligiousError] = useState<string | null>(null);
  async function handleAllowReligious() {
    if (!onChangeSuppressReligious) return;
    setAllowingReligious(true);
    setAllowReligiousError(null);
    try {
      await onChangeSuppressReligious(false);
      await runResearch(rejectedTitles, false);
    } catch (err: any) {
      setAllowReligiousError(err?.message ?? 'Could not change the setting.');
    } finally {
      setAllowingReligious(false);
    }
  }

  function handleShowAnother() {
    const title = view?.title;
    const nextRejected = title ? [...rejectedTitles, title] : rejectedTitles;
    setRejectedTitles(nextRejected);
    const rejectedSet = new Set(nextRejected.map((t) => t.toLowerCase()));
    const queued = researchQueue.find((r) => !rejectedSet.has(r.title.toLowerCase()));
    if (queued) {
      setResearchQueue((q) => q.filter((r) => r !== queued));
      setProposal({ origin: 'research', research: queued });
      return;
    }
    void runResearch(nextRejected);
  }

  function proceedOrAskPrimary(celebrationView: ProposalView, fromPhase: Phase) {
    const hasPrimary = !!existing.primary;
    const celebration = buildCelebration(celebrationView, !hasPrimary, !hasPrimary);
    if (hasPrimary) {
      setPendingCelebration(celebration);
      setPrimaryPick('existing');
      setPendingFromPhase(fromPhase);
      setPhase('primary-choice');
    } else {
      onConfirm(celebration);
      onClose();
    }
  }

  function handleConfirmProposal() {
    if (!view) return;
    proceedOrAskPrimary(view, 'proposal');
  }

  function openCustom() {
    const seed = view?.celebrationOf || firstName;
    setCustomCelebrationOf(seed);
    setCustomTitle(`${seed}'s Name Celebration`);
    setCustomExplanation('');
    setCustomDate('');
    setCustomError(null);
    setAssistQuestions(null);
    setAssistAnswers({});
    setAssistError(null);
    setAssistMissing(null);
    setPhase('custom');
  }

  async function assistCall(body: Record<string, unknown>) {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in again.');
    const token = await user.getIdToken();
    const res = await fetch('/api/name-celebration-research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: 'custom_assist', name: customCelebrationOf.trim() || firstName, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not reach the assistant.');
    return data;
  }

  async function startAssist() {
    setAssistBusy(true);
    setAssistError(null);
    setAssistMissing(null);
    try {
      const data = await assistCall({});
      setAssistQuestions(Array.isArray(data.questions) ? data.questions : null);
      setAssistAnswers({});
    } catch (err: any) {
      setAssistError(err?.message ?? 'Something went wrong.');
    } finally {
      setAssistBusy(false);
    }
  }

  async function finishAssist() {
    if (!assistQuestions) return;
    // Unanswered questions are simply left out rather than sent blank — a
    // family that only wants to answer the first one should not have the
    // model reasoning from two empty strings.
    const answers = assistQuestions
      .map((q) => ({ question: q.question, answer: (assistAnswers[q.id] || '').trim() }))
      .filter((a) => a.answer);
    if (!answers.length) { setAssistError('Answer at least one question first.'); return; }
    setAssistBusy(true);
    setAssistError(null);
    try {
      const { proposal } = await assistCall({ answers });
      if (!proposal) throw new Error('Nothing came back — try again.');
      if (proposal.title) setCustomTitle(proposal.title);
      if (proposal.explanation) setCustomExplanation(proposal.explanation);
      // Only ever set from a date the ANSWERS determined. The server returns
      // null rather than guessing, and that null must not clear a date the
      // family had already typed themselves.
      if (proposal.date) { setCustomDate(proposal.date); setCustomError(null); }
      setAssistMissing(proposal.date ? null : (proposal.missing || null));
      setAssistQuestions(null);
    } catch (err: any) {
      setAssistError(err?.message ?? 'Something went wrong.');
    } finally {
      setAssistBusy(false);
    }
  }

  function handleConfirmCustom() {
    if (!isValidNameDay(customDate)) { setCustomError('Use MM-DD, e.g. 03-19 for 19 March.'); return; }
    if (!customCelebrationOf.trim()) { setCustomError('Say whose name this celebrates.'); return; }
    if (!customTitle.trim()) { setCustomError('Give the day a title.'); return; }
    if (!customExplanation.trim()) { setCustomError('Say what this day means to your family.'); return; }
    proceedOrAskPrimary({
      title: customTitle.trim(),
      celebrationOf: customCelebrationOf.trim(),
      kind: 'name_celebration',
      matchType: 'custom',
      explanation: customExplanation.trim(),
      dateType: 'fixed',
      date: customDate,
      dateLabel: formatNameDay(customDate),
    }, 'custom');
  }

  function handleFinishPrimaryChoice() {
    if (!pendingCelebration) return;
    const makeNewPrimary = primaryPick === 'new';
    onConfirm({ ...pendingCelebration, primary: makeNewPrimary, notify: makeNewPrimary });
    onClose();
  }

  function handleDismiss() {
    onDismiss();
    onClose();
  }

  const showAnotherLabel = proposal?.origin === 'local' ? 'Search other traditions' : 'Show another connection';

  return (
    <AnimatePresence>
      {open && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm anim-fade"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="card relative w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-3xl p-6 z-10 anim-pop"
        >
          <SheetGrabber onClose={onClose} />

          <div className="flex items-center justify-between pb-4 border-b border-cream-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-clay-50 text-clay-600 shrink-0"><PartyPopper className="w-5 h-5" /></div>
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold text-ink-900">Name Days &amp; Name Celebrations</h3>
                <p className="text-[13px] font-semibold text-ink-500 truncate">for {firstName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 text-ink-400 hover:text-ink-700 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {phase === 'proposal' && (
              <>
                {researching && (
                  <div className="flex items-center gap-2.5 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-5 text-[13.5px] text-ink-600">
                    <Loader2 className="w-4 h-4 animate-spin text-clay-700 shrink-0" />
                    <span>Looking for a connection…</span>
                  </div>
                )}

                {!researching && researchError && (
                  <div className="rounded-2xl border border-rosa-100 bg-rosa-50 p-4 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rosa-600 shrink-0 mt-0.5" />
                      <p className="text-[13.5px] leading-relaxed text-rosa-800">{researchError}</p>
                    </div>
                    <button type="button" onClick={() => void runResearch(rejectedTitles)} className="btn-quiet text-[13px] px-4 py-2">
                      <RefreshCcw className="w-3.5 h-3.5" /> Try again
                    </button>
                  </div>
                )}

                {!researching && !researchError && view && (
                  <ProposalCard view={view} firstName={firstName} />
                )}

                {!researching && !researchError && !view && (
                  <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4">
                    <p className="text-[13.5px] leading-relaxed text-ink-600">
                      {researchExhausted && `No further connections found for ${firstName}.`}
                      {!researchExhausted && suppressReligiousSuggestions && !dismissed &&
                        (onChangeSuppressReligious
                          ? 'Religious suggestions are turned off for this family. You can search other traditions, choose a date yourselves, or turn them back on.'
                          : 'Religious suggestions are turned off for this family — you can still search other traditions or choose a date yourselves. An admin can turn them back on in Members & roles.')}
                      {!researchExhausted && !(suppressReligiousSuggestions && !dismissed) && dismissed &&
                        `The family previously said no name celebration for ${firstName}. You can look again any time.`}
                      {!researchExhausted && !(suppressReligiousSuggestions && !dismissed) && !dismissed && existing.primary &&
                        `${firstName} already has a primary celebration. Search another tradition, or add one of your own.`}
                      {!researchExhausted && !(suppressReligiousSuggestions && !dismissed) && !dismissed && !existing.primary &&
                        `No established name day found for ${firstName} in the local Austrian calendar — most names outside it genuinely have none. Try searching other traditions, or choose a date yourselves.`}
                    </p>
                    {/* Rory (2026-08-20, on this exact box for Ganga): "i want
                        to be able to toggle on religious setting here?" — the
                        message named the thing standing in the way and then
                        offered no way to move it. Admin-only, because the
                        server rejects anyone else; the copy above tells a
                        non-admin who to ask rather than drawing a 403 button.
                        Says "for the whole family" out loud: this is reached
                        from ONE member's edit screen and changes a setting for
                        everyone, which is not what the surrounding context
                        implies. */}
                    {!researchExhausted && suppressReligiousSuggestions && !dismissed && onChangeSuppressReligious && (
                      <div className="mt-3 pt-3 border-t border-cream-200">
                        {allowReligiousError && (
                          <p className="text-[12.5px] text-rosa-600 mb-2">{allowReligiousError}</p>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleAllowReligious()}
                          disabled={allowingReligious}
                          className="btn-quiet text-[13px] px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {allowingReligious
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Turning on…</>
                            : <><Sparkles className="w-3.5 h-3.5" /> Turn them back on</>}
                        </button>
                        <p className="text-[12px] text-ink-400 mt-1.5">
                          For the whole family, not just {firstName} — the same switch as in Members &amp; roles. You can turn it off again there.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {!researching && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {view && (
                      <button type="button" onClick={handleConfirmProposal} className="btn-primary text-[13px] px-4 py-2.5">
                        <Check className="w-3.5 h-3.5" /> Yes, use this day
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={view ? handleShowAnother : () => void runResearch(rejectedTitles)}
                      className="btn-quiet text-[13px] px-4 py-2.5"
                    >
                      {view ? <><RefreshCcw className="w-3.5 h-3.5" /> {showAnotherLabel}</> : <><Sparkles className="w-3.5 h-3.5" /> Search other traditions</>}
                    </button>
                    <button type="button" onClick={openCustom} className="btn-quiet text-[13px] px-4 py-2.5">
                      <CalendarDays className="w-3.5 h-3.5" /> Choose our own date
                    </button>
                    {!dismissed && (
                      <button type="button" onClick={handleDismiss} className="btn-quiet text-[13px] px-4 py-2.5 text-ink-400">
                        No name celebration
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {phase === 'custom' && (
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] text-ink-500">A date the family chooses — not looked up anywhere.</p>
                  {!assistQuestions && (
                    <button
                      type="button"
                      onClick={() => void startAssist()}
                      disabled={assistBusy}
                      className="shrink-0 text-[12.5px] font-semibold text-clay-600 hover:text-clay-700 cursor-pointer inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {assistBusy
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…</>
                        : <><Sparkles className="w-3.5 h-3.5" /> Help me work it out</>}
                    </button>
                  )}
                </div>

                {assistError && <p className="text-[12.5px] text-rosa-600">{assistError}</p>}

                {/* The questions. Deliberately in the same panel as the form
                    rather than a separate screen: the family can see what they
                    are filling in, and abandoning halfway leaves the form
                    exactly as it was. */}
                {assistQuestions && (
                  <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                    <p className="text-[12.5px] text-ink-500 leading-snug">
                      Answer what you can — anything you skip is simply left out. Your answers fill in the boxes
                      below, and you can change every one of them afterwards.
                    </p>
                    {assistQuestions.map((q) => (
                      <div key={q.id}>
                        <label className="text-[13px] font-semibold text-ink-800 leading-snug block mb-1">{q.question}</label>
                        <textarea
                          rows={2}
                          className="field resize-none"
                          placeholder={q.hint}
                          value={assistAnswers[q.id] || ''}
                          onChange={(e) => setAssistAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void finishAssist()}
                        disabled={assistBusy}
                        className="btn-primary text-[13px] px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {assistBusy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Working…</> : <><Sparkles className="w-3.5 h-3.5" /> Fill it in</>}
                      </button>
                      <button type="button" onClick={() => setAssistQuestions(null)} className="btn-quiet text-[13px] px-4 py-2.5">
                        Never mind
                      </button>
                    </div>
                  </div>
                )}

                {/* A proposal that came back WITHOUT a date is a success, not a
                    failure — the server refuses to invent one, so this says
                    what is still needed instead of quietly leaving the field
                    empty for the family to discover on Save. */}
                {assistMissing && (
                  <p className="text-[12.5px] text-honey-800 bg-honey-50 border border-honey-100 rounded-xl px-3 py-2 leading-snug">
                    Filled in what your answers gave. {assistMissing}
                  </p>
                )}

                {customError && <p className="text-[12.5px] text-rosa-600">{customError}</p>}
                <div>
                  <label className="field-label">Celebrating whose name</label>
                  <input type="text" className="field" placeholder="e.g. Ganga" value={customCelebrationOf} onChange={(e) => setCustomCelebrationOf(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Title</label>
                  <input type="text" className="field" placeholder="e.g. Ganga's Family Day" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Why this day</label>
                  <textarea rows={2} className="field resize-none" placeholder="What this day means to your family" value={customExplanation} onChange={(e) => setCustomExplanation(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Date (MM-DD)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="MM-DD, e.g. 03-19"
                      className="field"
                      value={customDate}
                      onChange={(e) => { setCustomDate(e.target.value.trim()); setCustomError(null); }}
                    />
                  </div>
                  <div>
                    <label className="field-label">Or pick a date</label>
                    <input
                      type="date"
                      className="field"
                      onChange={(e) => {
                        // A recurring day has no year — only the MM-DD slice is
                        // kept, same convention as nameDay.ts throughout.
                        if (e.target.value) { setCustomDate(e.target.value.slice(5)); setCustomError(null); }
                      }}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setPhase('proposal')} className="btn-quiet text-[13px] px-4 py-2.5">Cancel</button>
                  <button type="button" onClick={handleConfirmCustom} className="btn-primary text-[13px] px-4 py-2.5">Save this date</button>
                </div>
              </div>
            )}

            {phase === 'primary-choice' && pendingCelebration && existing.primary && (
              <div className="space-y-3.5">
                <p className="text-[13.5px] leading-relaxed text-ink-700">
                  {firstName} already has a primary celebration — only the primary notifies every year by default.
                  Which should it be?
                </p>
                <div className="space-y-2">
                  <PrimaryOption
                    selected={primaryPick === 'existing'}
                    onSelect={() => setPrimaryPick('existing')}
                    title={existing.primary.title}
                    subtitle={celebrationDateLabel(existing.primary)}
                  />
                  <PrimaryOption
                    selected={primaryPick === 'new'}
                    onSelect={() => setPrimaryPick('new')}
                    title={pendingCelebration.title}
                    subtitle={celebrationDateLabel(pendingCelebration)}
                  />
                </div>
                <p className="text-[12px] text-ink-400">
                  The one not chosen stays on file as an additional celebration — not notified by default, and never deleted.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setPhase(pendingFromPhase)} className="btn-quiet text-[13px] px-4 py-2.5">Back</button>
                  <button type="button" onClick={handleFinishPrimaryChoice} className="btn-primary text-[13px] px-4 py-2.5">Confirm</button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
      )}
    </AnimatePresence>
  );
}

function ProposalCard({ view, firstName }: { view: ProposalView; firstName: string }) {
  const isSecondName = view.matchType === 'second_name';
  return (
    <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`chip ${view.kind === 'name_day' ? 'bg-sage-100 text-sage-700' : 'bg-honey-100 text-honey-800'}`}>
          {view.kind === 'name_day' ? 'Name Day' : 'Name Celebration'}
        </span>
        {view.tradition && <span className="chip bg-cream-200 text-ink-600">{view.tradition}</span>}
      </div>

      <div>
        <p className="text-[13px] text-ink-500">
          We found a possible celebration for <span className="font-semibold text-ink-800">{view.celebrationOf}</span>
        </p>
        <p className="font-display text-[16px] font-semibold text-ink-900 mt-0.5">{view.title}</p>
        <p className="text-[13.5px] text-ink-700 mt-1">
          {view.dateType === 'fixed'
            ? view.dateLabel
            : `${view.dateLabel}${view.movableRule ? ` — moves each year (${view.movableRule})` : ''}`}
        </p>
      </div>

      <p className="text-[13.5px] leading-relaxed text-ink-700">{view.explanation}</p>

      {view.alsoOn && (
        <p className="text-[12px] text-ink-500">
          Some families instead keep {formatNameDay(view.alsoOn.date)} ({view.alsoOn.feast}).
        </p>
      )}

      {view.source && <p className="text-[11.5px] text-ink-400">Source: {view.source}</p>}

      <p className="text-[13.5px] font-semibold text-ink-800 pt-2 border-t border-cream-200">
        {isSecondName ? secondNameQuestion(firstName, view.celebrationOf, view.dateLabel) : originQuestion(view.celebrationOf)}
      </p>
    </div>
  );
}

function PrimaryOption({
  selected, onSelect, title, subtitle,
}: { selected: boolean; onSelect: () => void; title: string; subtitle: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border p-3.5 transition-colors cursor-pointer ${
        selected ? 'border-clay-500 bg-clay-50' : 'border-cream-200 bg-white hover:border-cream-300'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-clay-500' : 'border-cream-300'}`}>
          {selected && <div className="w-2 h-2 rounded-full bg-clay-500" />}
        </div>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink-900 truncate">{title}</p>
          <p className="text-[12px] text-ink-500">{subtitle}</p>
        </div>
      </div>
    </button>
  );
}
