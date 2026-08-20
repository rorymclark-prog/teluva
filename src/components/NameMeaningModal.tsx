import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, BookOpen, Check, RefreshCcw, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { NameMeaning } from '../types';
import { auth } from '../lib/firebase';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { roleLabel, confidenceLabel, surnameKey } from '../utils/nameMeanings';
import SheetGrabber from './SheetGrabber';

// What our names mean — the sibling of NameCelebrationModal (when a name is
// celebrated); this one answers what it means.
//
// SAME TRUST MODEL, FOR A DIFFERENT REASON. Nothing here becomes the family's
// own record until they keep it. For a celebration that is about not activating
// a religious association nobody asked for. Here it is about etymology being
// genuinely contested: a meaning shown flat, with no hedge, is the app
// asserting folk etymology as fact about someone's own family name. Every row
// carries its confidence, "Sources disagree" included, and the family decides
// what is worth keeping.
//
// Like the celebration modal, this writes NOTHING itself. It hands confirmed
// entries back and the caller decides where each one goes — given names to the
// member, the surname to the space-level list (see utils/nameMeanings.ts for
// why those are two different stores).

interface NameMeaningModalProps {
  open: boolean;
  /** The name as CURRENTLY TYPED in the editor, so a name being fixed in this
   *  same session is what gets looked up. */
  displayName: string;
  /** Already-kept meanings for this member, given names and surname merged —
   *  what meaningsFor() returns. Shown so a repeat visit is not a blank screen. */
  existing: NameMeaning[];
  /** Confirmed entries, ready to fold in. The caller splits them by role. */
  onConfirm: (entries: NameMeaning[]) => void;
  /** Drop one already-kept meaning, by token. */
  onRemove: (token: string) => void;
  onClose: () => void;
}

interface ResearchEntry {
  token: string;
  role: NameMeaning['role'];
  meaning: string;
  origin?: string;
  explanation?: string;
  alsoKnown?: string;
  confidence: NameMeaning['confidence'];
  source?: string;
}

function newMeaningId(): string {
  return `mean-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const CONFIDENCE_CHIP: Record<NameMeaning['confidence'], string> = {
  established: 'bg-sage-100 text-sage-700',
  likely: 'bg-cream-200 text-ink-600',
  // Deliberately the warning tint, not a neutral one: "sources disagree" is
  // the row a family most needs to notice before repeating it to someone.
  contested: 'bg-honey-100 text-honey-800',
};

const MeaningRow: React.FC<{ m: NameMeaning | ResearchEntry; onDrop?: () => void }> = ({ m, onDrop }) => {
  return (
    <div className="rounded-2xl border border-cream-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-display text-[15px] font-semibold text-ink-900">{m.token}</p>
            <span className="chip bg-cream-200 text-ink-500">{roleLabel(m.role)}</span>
            <span className={`chip ${CONFIDENCE_CHIP[m.confidence]}`}>{confidenceLabel(m.confidence)}</span>
          </div>
          <p className="text-[13.5px] text-ink-800 mt-1">{m.meaning}</p>
          {m.origin && <p className="text-[12.5px] text-ink-500 mt-0.5">{m.origin}</p>}
        </div>
        {onDrop && (
          <button
            type="button"
            onClick={onDrop}
            aria-label={`Remove the meaning kept for ${m.token}`}
            className="shrink-0 p-1.5 rounded-xl text-ink-300 hover:text-rosa-600 hover:bg-rosa-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {m.explanation && <p className="text-[13px] text-ink-600 leading-relaxed mt-2">{m.explanation}</p>}
      {m.alsoKnown && <p className="text-[12.5px] text-ink-500 mt-1.5">Also: {m.alsoKnown}</p>}
      {m.source && <p className="text-[11.5px] text-ink-400 mt-1.5">{m.source}</p>}
    </div>
  );
};

export default function NameMeaningModal({
  open, displayName, existing, onConfirm, onRemove, onClose,
}: NameMeaningModalProps) {
  useBodyScrollLock(open);

  const [researching, setResearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<ResearchEntry[] | null>(null);

  // A fresh look every time it opens: the name may have been corrected in the
  // editor since, and a stale result would be about the old spelling.
  useEffect(() => {
    if (!open) return;
    setFound(null);
    setError(null);
  }, [open, displayName]);

  async function runResearch() {
    setResearching(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in again.');
      const token = await user.getIdToken();
      const res = await fetch('/api/name-celebration-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: 'meaning', name: displayName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not reach the research service.');
      setFound(Array.isArray(data.entries) ? data.entries : []);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setResearching(false);
    }
  }

  function handleKeep() {
    if (!found?.length) return;
    onConfirm(found.map((e) => ({ ...e, id: newMeaningId(), confirmed: true })));
    onClose();
  }

  const keptKeys = new Set(existing.map((m) => surnameKey(m.token)));
  // Only offer to keep what would actually change something. Re-running the
  // lookup on a name that is already fully recorded should not present the
  // same rows again as if they were new.
  const fresh = (found || []).filter((e) => !keptKeys.has(surnameKey(e.token)));
  const alreadyKept = (found || []).length - fresh.length;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[220] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-900/55 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="card relative w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-meaning-title"
          >
            <SheetGrabber onClose={onClose} />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-dusk-50 text-dusk-600 flex items-center justify-center shrink-0">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 id="name-meaning-title" className="font-display text-lg font-semibold text-ink-900 leading-snug">
                    What these names mean
                  </h3>
                  <p className="text-[13px] text-ink-500 truncate">{displayName}</p>
                </div>
              </div>
              <button
                type="button" onClick={onClose} aria-label="Close"
                className="shrink-0 -m-1 p-1.5 rounded-xl text-ink-400 hover:text-ink-700 hover:bg-cream-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {existing.length > 0 && (
                <div className="space-y-2.5">
                  <p className="section-label">Kept</p>
                  {existing.map((m) => (
                    <MeaningRow key={m.id} m={m} onDrop={() => onRemove(m.token)} />
                  ))}
                </div>
              )}

              {researching && (
                <div className="flex items-center gap-2.5 text-[13.5px] text-ink-600 rounded-2xl border border-cream-200 bg-cream-50/60 p-4">
                  <Loader2 className="w-4 h-4 animate-spin text-clay-700 shrink-0" />
                  <span>Looking up what these names mean…</span>
                </div>
              )}

              {!researching && error && (
                <div className="rounded-2xl border border-rosa-100 bg-rosa-50 p-4 space-y-2.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rosa-600 shrink-0 mt-0.5" />
                    <p className="text-[13.5px] leading-relaxed text-rosa-800">{error}</p>
                  </div>
                  <button type="button" onClick={() => void runResearch()} className="btn-quiet text-[13px] px-4 py-2">
                    <RefreshCcw className="w-3.5 h-3.5" /> Try again
                  </button>
                </div>
              )}

              {!researching && !error && found !== null && (
                fresh.length > 0 ? (
                  <div className="space-y-2.5">
                    <p className="section-label">Found</p>
                    {fresh.map((e) => <MeaningRow key={e.token} m={e} />)}
                    {alreadyKept > 0 && (
                      <p className="text-[12px] text-ink-400">
                        {alreadyKept === 1 ? 'One name you already have is not shown again.' : `${alreadyKept} names you already have are not shown again.`}
                      </p>
                    )}
                  </div>
                ) : (
                  // The honest empty answer, and it must read as a real result
                  // rather than a failure — plenty of names, surnames
                  // especially, have no derivation anyone can evidence.
                  <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4">
                    <p className="text-[13.5px] leading-relaxed text-ink-600">
                      {alreadyKept > 0
                        ? 'Nothing new — you already have everything that could be found for this name.'
                        : 'No established meaning found for these names. That is a real answer, not a gap: plenty of names, surnames especially, have no derivation anyone can evidence.'}
                    </p>
                  </div>
                )
              )}

              {!researching && found === null && !error && (
                <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4">
                  <p className="text-[13.5px] leading-relaxed text-ink-600">
                    Every part of the name is looked up separately — first name, second names and the family name are
                    usually three different languages. Nothing is kept until you say so.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-cream-200">
              {fresh.length > 0 && (
                <button type="button" onClick={handleKeep} className="btn-primary text-[13px] px-4 py-2.5">
                  <Check className="w-3.5 h-3.5" /> Keep {fresh.length === 1 ? 'this' : `these ${fresh.length}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => void runResearch()}
                disabled={researching}
                className="btn-quiet text-[13px] px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {found === null
                  ? <><BookOpen className="w-3.5 h-3.5" /> Look them up</>
                  : <><RefreshCcw className="w-3.5 h-3.5" /> Look again</>}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
