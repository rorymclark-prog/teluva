import React from 'react';
import { ScrollText, FileText, Clock, KeyRound, AlertCircle } from 'lucide-react';
import type { NamedByThem } from '../utils/familyLink';

/**
 * "THEY NAMED YOU." The receiving half of the successor ladder.
 *
 * One component, used by both the connected-families list on the home screen
 * and the household page, because the rules about what may be shown are
 * exactly the same in both places and two copies of that logic would drift.
 *
 * The rendering rule is: SHOW WHAT ARRIVED, SAY NOTHING ABOUT WHAT DIDN'T.
 * The projection in server/familyLink.mjs already decided; an absent field
 * means it did not cross, never that it is empty, so this file must not
 * infer "they have no instructions" from a missing `whatTheyShouldDo`. What
 * it CAN say is the honest general fact about what did not cross.
 *
 * ONE THING CROSSES AT EVERY RUNG (v326): who holds the signed will. Two lines
 * of copy in here used to promise the opposite — "where their papers are stays
 * with them" — and both were quietly made false by that change. They are gone.
 * When a boundary moves, the sentence describing it is part of the boundary.
 */
const NamedByThemCard: React.FC<{
  named: NamedByThem;
  /** Resolves one of OUR member ids to a name. */
  memberName?: (id: string) => string;
  /** Compact form for the home-screen list; full form on the household page. */
  compact?: boolean;
}> = ({ named, memberName, compact }) => {
  const who = memberName ? memberName(named.memberId) : 'someone in your family';
  const level = named.level || 'fact';

  return (
    <div className="rounded-2xl border border-clay-300 bg-clay-50 px-4 py-3">
      <p className="text-[13.5px] font-bold text-ink-900 flex items-start gap-2">
        <ScrollText className="w-4 h-4 text-clay-600 shrink-0 mt-0.5" />
        <span>{named.byName} named {who} to help with their estate.</span>
      </p>

      {named.findWill && named.findWill.length > 0 && (
        <div className="mt-2.5 ml-6 rounded-xl border border-clay-300 bg-white px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
            <KeyRound className="w-3 h-3" /> Where the signed will is
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {named.findWill.map((w, i) => (
              <li key={`${w.kind}-${i}`} className="text-[13px] text-ink-800">
                <span className="font-semibold">{w.kind}</span>
                {' — '}
                {w.unrecorded ? (
                  /* Not a criticism, an opening. This is the one thing the
                     person reading it can still fix, by asking, today. */
                  <span className="text-clay-700 inline-flex items-start gap-1">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    nobody has recorded who holds it. Worth asking them while you can.
                  </span>
                ) : w.registered ? (
                  <>lodged in a register{w.registryName ? ` (${w.registryName})` : ''}
                  {w.heldBy || w.notaryName ? `, held by ${w.heldBy || w.notaryName}` : ''}</>
                ) : (w.heldBy || w.notaryName) ? (
                  <>held by {w.heldBy || w.notaryName}</>
                ) : (
                  /* Reached only when nobody holds it and it is in no register,
                     so this sentence is the only thing that finds the will. */
                  <>kept at {w.originalLocation}</>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-ink-400 mt-1.5">
            Shared at every level, so the will can always be found.
          </p>
        </div>
      )}

      {level === 'fact' && (
        <p className="text-[12.5px] text-ink-600 mt-1 pl-6">
          They have shared the fact only. What they want done, and which papers
          they hold, stays with them.
        </p>
      )}

      {named.whatTheyShouldDo && (
        <div className="mt-2.5 ml-6 rounded-xl border border-clay-200 bg-white px-3.5 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
            What they would like {who} to do
          </p>
          {/* Their words, wrapped as written. Never parsed, never linkified —
              this is free text from another household. */}
          <p className="text-[13px] text-ink-800 mt-1 whitespace-pre-wrap">{named.whatTheyShouldDo}</p>
        </div>
      )}

      {!compact && named.documents && named.documents.length > 0 && (
        <div className="mt-2.5 ml-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">
            Papers they have on file
          </p>
          <ul className="space-y-1">
            {named.documents.map((d, i) => (
              <li key={`${d.kind}-${i}`} className="flex items-center gap-2 text-[13px] text-ink-800">
                <FileText className="w-3.5 h-3.5 text-ink-400 shrink-0" />
                <span className="font-semibold flex-1 min-w-0 truncate">{d.kind}</span>
                {d.lastReviewed && (
                  <span className="text-[11.5px] text-ink-400 tabular-nums shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {d.lastReviewed}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-ink-400 mt-1.5">
            The documents themselves stay with {named.byName}. Where each one is kept
            stays with them too — except the will, below.
          </p>
        </div>
      )}

      {compact && named.documents && named.documents.length > 0 && (
        <p className="text-[12.5px] text-ink-600 mt-1.5 pl-6">
          They have also shared which papers exist — open them to see.
        </p>
      )}
    </div>
  );
};

export default NamedByThemCard;
