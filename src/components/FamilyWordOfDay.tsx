import { useEffect, useState } from 'react';
import { BookHeart, ChevronRight } from 'lucide-react';
import { FamilyWord } from '../types';
import { loadFamilyWords } from '../utils/db';

// A tiny, low-lift "reason to open the app" — resurfaces one entry from the
// family's own private-word glossary (FamilyWordsView), which today only
// exists behind an intentional tab nobody stumbles into. Stable per calendar
// day (day-of-year % word count, same rotation trick OnThisDay.tsx already
// uses) rather than random, so it doesn't reshuffle on every re-render.

const DAY = 1000 * 60 * 60 * 24;

function dayOfYear(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / DAY);
}

export default function FamilyWordOfDay({ demo = false, onOpen }: { demo?: boolean; onOpen: () => void }) {
  const [words, setWords] = useState<FamilyWord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Demo is an ephemeral sandbox — same rule FamilyWordsView.tsx follows,
    // never read the real family's glossary into a demo session.
    if (demo) { setLoaded(true); return; }
    let active = true;
    loadFamilyWords()
      .then((doc) => { if (active) setWords(doc?.words || []); })
      .catch(() => { /* stay empty — card just won't render */ })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [demo]);

  if (!loaded || words.length === 0) return null;

  const word = words[dayOfYear(new Date()) % words.length];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="card w-full text-left p-4 flex items-center gap-3 hover:bg-cream-50 transition-colors cursor-pointer"
    >
      <div className="w-10 h-10 rounded-2xl bg-dusk-100 text-dusk-700 flex items-center justify-center shrink-0">
        <BookHeart className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-ink-400 uppercase tracking-wider">Family word of the day</p>
        <p className="text-[14px] font-semibold text-ink-800 truncate">
          “{word.word}” <span className="text-ink-400 font-normal">— {word.meaning}</span>
        </p>
        {(word.coinedBy || word.stillUsed) && (
          <p className="text-[12px] text-ink-500 mt-0.5">
            {word.coinedBy ? `Coined by ${word.coinedBy.split(/\s+/)[0]}` : ''}
            {word.coinedBy && word.stillUsed ? ' · ' : ''}
            {word.stillUsed ? 'still says it today' : ''}
          </p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-ink-300 shrink-0" />
    </button>
  );
}
