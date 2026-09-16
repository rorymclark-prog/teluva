import { useEffect, useState } from 'react';
import { Users, Phone, Lock } from 'lucide-react';
import { loadBusinessDirectory, type DirectoryEntry } from '../utils/db';

/**
 * Who works here — the answer an employee gets instead of the team list.
 *
 * Since v330 a colleague's record is an HR file: firestore.rules lets an
 * employee read their own and nobody else's, which is right and which left
 * "Your team" holding one person. A list of one is not a safe answer, it is an
 * answer that looks like a broken app — and the person most likely to conclude
 * that is a new employee on their first day.
 *
 * So this asks a smaller question of the server, which holds the allowlist
 * (server/directory.mjs): name, job title, work phone. It is a DIRECTORY, not
 * a set of profiles — the rows do not open anything, because there is nothing
 * behind them this account may read, and a row that navigates to a permission
 * error is worse than a row that does not navigate.
 */
export default function TeamDirectory({ selfMemberId }: { selfMemberId?: string }) {
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBusinessDirectory()
      .then((d) => { if (!cancelled) setEntries(d.members || []); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  // Still loading, or the call failed. A failure is silent on purpose: the
  // note above this component already explains why the list is short, and a
  // red error box about a directory would read as "your access is broken".
  if (failed || !entries || entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-cream-200 overflow-hidden">
      <div className="px-3.5 py-2.5 bg-cream-50 border-b border-cream-200 flex items-center gap-2">
        <Users className="w-3.5 h-3.5 text-ink-400 shrink-0" />
        <h5 className="section-label flex-1">Team directory</h5>
        <span className="chip bg-cream-200 text-ink-600">{entries.length}</span>
      </div>
      <ul className="divide-y divide-cream-100">
        {entries.map((m) => (
          <li key={m.id} className="px-3.5 py-2.5 flex items-center gap-3">
            <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-[11px] font-bold ${m.avatarColor || 'bg-clay-500'}`}>
              {m.name.trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-900 truncate">
                {m.name}
                {m.id === selfMemberId && <span className="ml-1.5 text-[11px] font-medium text-ink-400">you</span>}
              </p>
              {(m.jobTitle || m.role) && (
                <p className="text-[11.5px] text-ink-500 truncate">{m.jobTitle || m.role}</p>
              )}
            </div>
            {m.workPhone && (
              /* A tel: link, not a copy button — on the phone this is the
                 whole reason to open a staff directory. */
              <a
                href={`tel:${m.workPhone.replace(/[^\d+]/g, '')}`}
                className="p-1.5 rounded-lg text-ink-400 hover:text-clay-600 hover:bg-cream-100 transition-colors shrink-0"
                title={`Call ${m.name} on ${m.workPhone}`}
                aria-label={`Call ${m.name}`}
              >
                <Phone className="w-3.5 h-3.5" />
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="px-3.5 py-2 bg-cream-50 border-t border-cream-100 flex items-start gap-1.5">
        <Lock className="w-3 h-3 text-ink-300 mt-0.5 shrink-0" />
        <p className="text-[11px] text-ink-400 leading-relaxed">
          Work contact only. Personal numbers, addresses, birthdays and medical details
          stay between each person and an owner of this space.
        </p>
      </div>
    </div>
  );
}
