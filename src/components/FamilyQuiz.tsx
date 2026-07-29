import { useEffect, useState } from 'react';
import type { ElementType } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Sparkles, Trophy, Cake, Footprints, Ruler, Plane, Globe2, Baby, FileText,
  Check, ChevronRight, RotateCcw, PartyPopper, Users,
} from 'lucide-react';
import { FamilyMember, CalendarEvent } from '../types';

/**
 * A light, deterministic, client-side family trivia game. No AI, no network —
 * every question is derived straight from the family's own data (birthdates,
 * sizes, passports, languages, documents, care schedule). Small/incomplete
 * families are handled gracefully by simply skipping questions we can't
 * answer, rather than guessing or crashing.
 */

// ---------------------------------------------------------------------------
// Question model
// ---------------------------------------------------------------------------

interface QuizOption {
  id: string;
  label: string;
}

interface QuizQuestion {
  id: string;
  prompt: string;
  icon: ElementType;
  options: QuizOption[];
  correctId: string;
  correctReaction: string;
  wrongReaction: string;
  detail?: string;
}

interface Scored {
  member: FamilyMember;
  value: number;
}

// ---------------------------------------------------------------------------
// Small, dependency-free helpers (deterministic — no Math.random anywhere)
// ---------------------------------------------------------------------------

function firstName(m: FamilyMember): string {
  return m.name.split(/\s+/)[0] || m.name;
}

// Disambiguate two family members who share a first name within one question.
// A single last-initial isn't always enough (e.g. "Anna Schmidt" and "Anna
// Sommer" both reduce to "Anna S."), so fall through to the full remaining
// name segment, and finally to a stable per-member suffix for genuine
// full-name duplicates (twins, etc.) rather than ever rendering two
// identical-looking options.
function labelFor(m: FamilyMember, group: FamilyMember[]): string {
  const fn = firstName(m);
  const others = group.filter((o) => o.id !== m.id);
  const sameFirstName = others.filter((o) => firstName(o) === fn);
  if (sameFirstName.length === 0) return fn;

  const rest = m.name.split(/\s+/).slice(1).join(' ');
  const withRest = rest ? `${fn} ${rest}` : fn;

  // Does the full name still collide with another member who shares this
  // first name (not just their initial)?
  const stillCollides = sameFirstName.some((o) => o.name.split(/\s+/).slice(1).join(' ') === rest);
  if (!stillCollides) return withRest;

  return `${withRest} (${m.id.slice(-4)})`;
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function rotateArray<T>(arr: T[], by: number): T[] {
  if (arr.length === 0) return arr;
  const n = ((by % arr.length) + arr.length) % arr.length;
  return [...arr.slice(n), ...arr.slice(0, n)];
}

// Deterministic option set: the correct member, plus up to 3 distractors —
// preferring other members who also had valid data for this question, then
// padding with the rest of the pool. Position of the correct answer is
// rotated by `seed` so it isn't always first, without ever using Math.random.
function buildOptions(pool: FamilyMember[], correct: FamilyMember, eligible: FamilyMember[], seed: number): FamilyMember[] {
  const others = eligible.filter((m) => m.id !== correct.id);
  const filler = pool.filter((m) => m.id !== correct.id && !others.some((o) => o.id === m.id));
  const distractors = [...rotateArray(others, seed), ...rotateArray(filler, seed + 1)].slice(0, 3);
  const optionSet = [correct, ...distractors];
  return rotateArray(optionSet, seed * 3 + 1);
}

function pickWinnerScore(scores: Scored[], mode: 'max' | 'min'): Scored | null {
  if (scores.length < 2) return null;
  const sorted = [...scores].sort((a, b) => (mode === 'max' ? b.value - a.value : a.value - b.value));
  // A genuine tie has no single correct answer — skip the question rather than guess.
  if (sorted[0].value === sorted[1].value) return null;
  return sorted[0];
}

// ---------------------------------------------------------------------------
// Per-metric extractors (each returns null when the member has no usable data)
// ---------------------------------------------------------------------------

function daysUntilNextBirthday(birthdate: string | undefined, today: Date): number | null {
  const b = parseDate(birthdate);
  if (!b) return null;
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(todayMid.getFullYear(), b.getMonth(), b.getDate());
  if (next.getTime() < todayMid.getTime()) next = new Date(todayMid.getFullYear() + 1, b.getMonth(), b.getDate());
  return Math.round((next.getTime() - todayMid.getTime()) / (1000 * 60 * 60 * 24));
}

function birthdateMs(m: FamilyMember): number | null {
  const d = parseDate(m.birthdate);
  return d ? d.getTime() : null;
}

function shoeSizeValue(m: FamilyMember): number | null {
  const s = m.clothingSizes?.shoes;
  if (!s) return null;
  // Explicit UK/US sizing (without an EU marker) uses a different numeric
  // scale than EU sizing (e.g. UK 7 vs EU 40) — not safely comparable to
  // other members' EU-style entries, so skip rather than risk a wrong winner.
  if (/\b(UK|US)\b/i.test(s) && !/\bEU\b/i.test(s)) return null;
  const matches = s.match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map(parseFloat).filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  // Freeform ranges like "EU 30-31" or "EU 38 - 45" should compare on their
  // midpoint, not just the first (lower-bound) number the regex happens to
  // find first.
  return nums.length > 1 ? (Math.min(...nums) + Math.max(...nums)) / 2 : nums[0];
}

function heightValue(m: FamilyMember): number | null {
  const match = m.clothingSizes?.heightCm?.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const v = parseFloat(match[0]);
  return isNaN(v) ? null : v;
}

function languageCount(m: FamilyMember): number | null {
  const s = m.languages;
  if (!s || !s.trim()) return null;
  const parts = s.split(/[,/;&]|\band\b/i).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts.length : null;
}

function nearestPassportExpiryMs(m: FamilyMember): number | null {
  const dates: number[] = [];
  (m.passports || []).forEach((p) => { const d = parseDate(p.expiryDate); if (d) dates.push(d.getTime()); });
  const legacy = parseDate(m.passport?.expiryDate);
  if (legacy) dates.push(legacy.getTime());
  return dates.length ? Math.min(...dates) : null;
}

function documentCount(m: FamilyMember): number | null {
  const n = m.documents?.length || 0;
  return n > 0 ? n : null;
}

// Note: we deliberately don't derive a quiz question from careSchedule
// (dental/medical/vaccination due dates). Unlike birthdays or shoe sizes,
// health-appointment timing is sensitive, and this quiz is reachable by any
// logged-in user with no role gating or opt-in — so it's excluded outright
// rather than surfaced in a shared, gamified context.

// ---------------------------------------------------------------------------
// Question generators — one metric, one comparator, one deterministic winner
// ---------------------------------------------------------------------------

function makeComparisonQuestion(params: {
  members: FamilyMember[];
  metric: (m: FamilyMember) => number | null;
  mode: 'max' | 'min';
  seed: number;
  id: string;
  prompt: string;
  icon: ElementType;
  correctReaction: string;
  wrongReaction: (correctLabel: string) => string;
  formatDetail?: (value: number) => string;
}): QuizQuestion | null {
  const { members, metric, mode, seed, id, prompt, icon, correctReaction, wrongReaction, formatDetail } = params;
  const scores: Scored[] = [];
  members.forEach((m) => { const v = metric(m); if (v !== null) scores.push({ member: m, value: v }); });
  const winner = pickWinnerScore(scores, mode);
  if (!winner) return null;
  const optionMembers = buildOptions(members, winner.member, scores.map((s) => s.member), seed);
  if (optionMembers.length < 2) return null;
  return {
    id,
    prompt,
    icon,
    options: optionMembers.map((m) => ({ id: m.id, label: labelFor(m, optionMembers) })),
    correctId: winner.member.id,
    correctReaction,
    wrongReaction: wrongReaction(labelFor(winner.member, optionMembers)),
    detail: formatDetail ? formatDetail(winner.value) : undefined,
  };
}

function generateQuestions(members: FamilyMember[]): QuizQuestion[] {
  const today = new Date();
  const candidates: (QuizQuestion | null)[] = [
    makeComparisonQuestion({
      members, metric: (m) => daysUntilNextBirthday(m.birthdate, today), mode: 'min', seed: 0,
      id: 'birthday-next', prompt: "Whose birthday is coming up next?", icon: Cake,
      correctReaction: "Mark the calendar — cake o'clock is approaching!",
      wrongReaction: (label) => `Close! It's actually ${label} — better start planning.`,
      formatDetail: (days) => (days === 0 ? "It's today!" : days === 1 ? '1 day away.' : `${days} days away.`),
    }),
    makeComparisonQuestion({
      members, metric: shoeSizeValue, mode: 'max', seed: 1,
      id: 'shoe-size', prompt: 'Who has the biggest shoes to fill?', icon: Footprints,
      correctReaction: 'Certified biggest feet in the house!',
      wrongReaction: (label) => `Nope — that title belongs to ${label}.`,
      formatDetail: (v) => `Size ${v}.`,
    }),
    makeComparisonQuestion({
      members, metric: heightValue, mode: 'max', seed: 2,
      id: 'tallest', prompt: 'Who is the tallest in the family?', icon: Ruler,
      correctReaction: 'Standing tall above the rest!',
      wrongReaction: (label) => `Actually it's ${label} — the tape measure doesn't lie.`,
      formatDetail: (v) => `${v} cm.`,
    }),
    makeComparisonQuestion({
      members, metric: nearestPassportExpiryMs, mode: 'min', seed: 3,
      id: 'passport-expiry', prompt: 'Whose passport needs renewing first?', icon: Plane,
      correctReaction: 'Good eye — that one needs attention soonest.',
      wrongReaction: (label) => `It's actually ${label}'s passport — worth a reminder.`,
      formatDetail: (v) => `Expires ${new Date(v).toLocaleDateString()}.`,
    }),
    makeComparisonQuestion({
      members, metric: languageCount, mode: 'max', seed: 4,
      id: 'languages', prompt: 'Who speaks the most languages?', icon: Globe2,
      correctReaction: 'A true polyglot of the family!',
      wrongReaction: (label) => `${label} actually takes that crown.`,
      formatDetail: (v) => `${v} language${v === 1 ? '' : 's'}.`,
    }),
    makeComparisonQuestion({
      members, metric: birthdateMs, mode: 'max', seed: 5,
      id: 'youngest', prompt: 'Who is the youngest member of the family?', icon: Baby,
      correctReaction: 'The baby of the family, confirmed!',
      wrongReaction: (label) => `${label} is actually the youngest.`,
    }),
    makeComparisonQuestion({
      members, metric: documentCount, mode: 'max', seed: 6,
      id: 'documents', prompt: 'Who has the most documents on file?', icon: FileText,
      correctReaction: 'The most well-documented family member!',
      wrongReaction: (label) => `${label} has the fattest file.`,
      formatDetail: (v) => `${v} document${v === 1 ? '' : 's'} on file.`,
    }),
  ];
  return candidates.filter((q): q is QuizQuestion => q !== null).slice(0, 6);
}

function ratingFor(score: number, total: number): { title: string; message: string } {
  const pct = total > 0 ? score / total : 0;
  if (pct === 1) return { title: 'Family Trivia Champion!', message: 'Perfect score — you clearly pay attention at the dinner table.' };
  if (pct >= 0.75) return { title: 'Seriously Switched On', message: 'You know this family inside out.' };
  if (pct >= 0.5) return { title: 'Solid Effort', message: 'Not bad at all — a few gaps left to close.' };
  if (pct >= 0.25) return { title: 'Room to Grow', message: 'Time for a proper family catch-up.' };
  return { title: 'Back to Basics', message: 'Someone here has been paying more attention to their phone than their family.' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Phase = 'setup' | 'playing' | 'done';

export default function FamilyQuiz({ members, events, onClose }: { members: FamilyMember[]; events: CalendarEvent[]; onClose: () => void }) {
  void events; // this game only needs family-member data

  const [closing, setClosing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(members.map((m) => m.id)));
  const [phase, setPhase] = useState<Phase>('setup');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const handleClose = () => setClosing(true);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onClose, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMember = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedMembers = members.filter((m) => selected.has(m.id));
  const previewQuestions = phase === 'setup' && selectedMembers.length >= 2 ? generateQuestions(selectedMembers) : [];

  const handleStart = () => {
    if (selectedMembers.length < 2) return;
    const qs = generateQuestions(selectedMembers);
    if (qs.length === 0) return;
    setQuestions(qs);
    setQIndex(0);
    setScore(0);
    setPickedId(null);
    setPhase('playing');
  };

  const handlePick = (optionId: string, correctId: string) => {
    if (pickedId) return;
    setPickedId(optionId);
    if (optionId === correctId) setScore((s) => s + 1);
  };

  const handleNext = () => {
    if (qIndex + 1 < questions.length) {
      setQIndex((i) => i + 1);
      setPickedId(null);
    } else {
      setPhase('done');
    }
  };

  const handlePlayAgain = () => {
    setQIndex(0);
    setScore(0);
    setPickedId(null);
    setPhase('playing');
  };

  const question = phase === 'playing' ? questions[qIndex] : undefined;
  const QuestionIcon = question?.icon;

  const headerSubtitle =
    phase === 'setup' ? "Pick who's playing" :
    phase === 'playing' ? `Question ${qIndex + 1} of ${questions.length}` :
    'Final score';

  return (
    <AnimatePresence>
      {!closing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={handleClose}
          className="fixed inset-0 z-[120] bg-ink-900/40 backdrop-blur-sm flex items-center justify-center p-4 print:hidden"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Family Quiz"
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[90dvh] bg-white rounded-3xl shadow-lift flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-b border-cream-200 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-clay-50 flex items-center justify-center shrink-0">
                  {phase === 'done' ? <Trophy className="w-4 h-4 text-clay-600" /> : <Sparkles className="w-4 h-4 text-clay-600" />}
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold text-ink-900 leading-tight">Family Quiz</h2>
                  <p className="text-[12px] text-ink-400 truncate">{headerSubtitle}</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-full text-ink-400 hover:text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer shrink-0"
                aria-label="Close"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-5 sm:p-6 flex-1">
              {/* Too few family members overall */}
              {members.length < 2 && (
                <div className="flex flex-col items-center text-center gap-3 py-6">
                  <div className="w-14 h-14 rounded-2xl bg-clay-50 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-clay-600" />
                  </div>
                  <p className="text-sm font-semibold text-ink-800">Add more family members to play</p>
                  <p className="text-[13px] text-ink-400 max-w-xs leading-relaxed">
                    The family quiz compares people against each other — add at least one more family member first.
                  </p>
                  <button onClick={handleClose} className="btn-quiet mt-1">Close</button>
                </div>
              )}

              {/* Setup: pick who's playing */}
              {members.length >= 2 && phase === 'setup' && (
                <div className="space-y-5">
                  <div>
                    <p className="section-label mb-2 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Who&apos;s playing?</p>
                    <div className="flex flex-wrap gap-2">
                      {members.map((m) => {
                        const active = selected.has(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() => toggleMember(m.id)}
                            className={`chip px-3 py-1.5 text-[12px] transition-colors cursor-pointer ${
                              active ? 'bg-clay-500 text-white' : 'bg-cream-100 text-ink-500 border border-cream-300 hover:bg-cream-200'
                            }`}
                          >
                            {labelFor(m, members)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedMembers.length < 2 ? (
                    <div className="p-4 rounded-2xl border bg-cream-100 border-cream-200 text-center">
                      <p className="text-[13px] text-ink-500">Select at least 2 family members to play.</p>
                    </div>
                  ) : previewQuestions.length === 0 ? (
                    <div className="p-4 rounded-2xl border bg-cream-100 border-cream-200 text-center">
                      <p className="text-[13px] text-ink-500 leading-relaxed">
                        Not quite enough details yet — add a birthdate, shoe size, height, or passport expiry to a
                        couple of the selected people, then come back.
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl border bg-sage-50 border-sage-100 text-center">
                      <p className="text-[13px] font-semibold text-sage-700">
                        {previewQuestions.length} question{previewQuestions.length === 1 ? '' : 's'} ready to go!
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleStart}
                    disabled={selectedMembers.length < 2 || previewQuestions.length === 0}
                    className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-4 h-4" /> Start Quiz
                  </button>
                </div>
              )}

              {/* Playing */}
              {phase === 'playing' && question && QuestionIcon && (
                <div className="space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-cream-200 overflow-hidden">
                      <motion.div
                        className="h-full bg-clay-500 rounded-full"
                        initial={false}
                        animate={{ width: `${(qIndex / questions.length) * 100}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <span className="chip bg-cream-200 text-ink-600 shrink-0 tabular-nums">{score} correct</span>
                  </div>

                  <div className="text-center space-y-2.5">
                    <div className="w-11 h-11 rounded-2xl bg-clay-50 flex items-center justify-center mx-auto">
                      <QuestionIcon className="w-5 h-5 text-clay-600" />
                    </div>
                    <h3 className="font-display text-xl font-bold text-ink-900 leading-snug px-2">{question.prompt}</h3>
                  </div>

                  <div className="grid gap-2.5">
                    {question.options.map((opt) => {
                      const answered = pickedId !== null;
                      const isCorrectOpt = opt.id === question.correctId;
                      const isPicked = opt.id === pickedId;
                      let stateClasses = 'border-cream-300 bg-white hover:bg-cream-50 hover:border-cream-400 text-ink-800';
                      if (answered && isCorrectOpt) stateClasses = 'border-sage-300 bg-sage-50 text-sage-700';
                      else if (answered && isPicked) stateClasses = 'border-rosa-300 bg-rosa-50 text-rosa-700';
                      else if (answered) stateClasses = 'border-cream-200 bg-white text-ink-400 opacity-60';
                      return (
                        <button
                          key={opt.id}
                          onClick={() => handlePick(opt.id, question.correctId)}
                          disabled={answered}
                          className={`w-full text-left rounded-2xl border px-4 py-3.5 font-semibold text-[14px] transition-colors flex items-center justify-between gap-2 ${stateClasses} ${answered ? '' : 'cursor-pointer'}`}
                        >
                          {opt.label}
                          {answered && isCorrectOpt && <Check className="w-4 h-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  {pickedId && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-4 rounded-2xl border flex items-start gap-3 ${
                        pickedId === question.correctId ? 'bg-sage-50 border-sage-100' : 'bg-honey-50 border-honey-100'
                      }`}
                    >
                      <PartyPopper className={`w-4 h-4 mt-0.5 shrink-0 ${pickedId === question.correctId ? 'text-sage-600' : 'text-honey-700'}`} />
                      <div>
                        <p className={`text-[13px] font-medium ${pickedId === question.correctId ? 'text-sage-800' : 'text-honey-900'}`}>
                          {pickedId === question.correctId ? question.correctReaction : question.wrongReaction}
                        </p>
                        {question.detail && <p className="text-[12px] text-ink-400 mt-1">{question.detail}</p>}
                      </div>
                    </motion.div>
                  )}

                  {pickedId && (
                    <button onClick={handleNext} className="btn-primary w-full">
                      {qIndex + 1 < questions.length ? 'Next question' : 'See my score'} <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Done */}
              {phase === 'done' && (
                <div className="text-center space-y-4 py-2">
                  <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-clay-50 to-honey-50 flex items-center justify-center mx-auto">
                    <Trophy className="w-7 h-7 text-clay-600" />
                  </div>
                  <div>
                    <p className="text-display-sm text-ink-900 tabular-nums">
                      {score}<span className="text-ink-400 text-2xl">/{questions.length}</span>
                    </p>
                    <p className="font-display text-lg font-bold text-ink-900 mt-1">{ratingFor(score, questions.length).title}</p>
                    <p className="text-[13px] text-ink-500 mt-1.5 max-w-xs mx-auto leading-relaxed">
                      {ratingFor(score, questions.length).message}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 pt-2 print:hidden">
                    <button onClick={handlePlayAgain} className="btn-primary w-full">
                      <RotateCcw className="w-4 h-4" /> Play again
                    </button>
                    <button onClick={() => setPhase('setup')} className="btn-quiet w-full">
                      Change who&apos;s playing
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
