import React from 'react';
import { ArrowLeft, Users, Cake, Link2, Gift, Ruler } from 'lucide-react';
import type { SharedMember, NamedByThem } from '../utils/familyLink';
import { sharedSizeEntries, sharedWishes } from './SharedProfile';
import NamedByThemCard from './NamedByThemCard';
import { useHiddenPeople } from '../contexts/HiddenPeopleContext';
import { visibleLinkedPeople } from '../utils/hiddenPeople';

/**
 * The connected household seen as ONE thing — "open up the family profile and
 * see some things collectively".
 *
 * Everything on this page is derived from what has ALREADY crossed the link.
 * There is no new endpoint and no new permission: if a birthday is not shared
 * it is not counted here either, so a household cannot learn by aggregation
 * something it was not allowed to learn person by person. That is the whole
 * design rule for this file — a summary of denied facts is still a denied
 * fact, and the fastest way to leak one is to total it up.
 */

const initial = (name: string) => (name.trim()[0] || '?').toUpperCase();

/** Days until the next occurrence of a month/day, ignoring the year. */
export function daysUntilBirthday(birthdate?: string, today: Date = new Date()): number | null {
  if (!birthdate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  if (!m) return null;
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(today.getFullYear(), month, day);
  if (next.getTime() < base.getTime()) next = new Date(today.getFullYear() + 1, month, day);
  return Math.round((next.getTime() - base.getTime()) / 86400000);
}

const whenLabel = (days: number) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`);

const SharedHousehold: React.FC<{
  householdName: string;
  photoUrl?: string;
  members: SharedMember[];
  /** The link these people came over — what "Hide Nora's dates" is keyed by. */
  linkId?: string;
  /** How many of MY people they can see — the other direction of the same link. */
  sharedByMeCount: number;
  connectedAt?: string | null;
  namedByThem?: NamedByThem | null;
  memberName?: (id: string) => string;
  onOpenPerson: (member: SharedMember) => void;
  onClose: () => void;
  onViewPhoto?: (url: string) => void;
}> = ({
  householdName, photoUrl, members, linkId, sharedByMeCount, connectedAt,
  namedByThem, memberName, onOpenPerson, onClose, onViewPhoto,
}) => {
  const { hidden } = useHiddenPeople();
  // Only people whose birthday actually crossed can appear here, and nobody
  // whose dates this family has hidden.
  const upcoming = (linkId ? visibleLinkedPeople(linkId, members, hidden) : members)
    .map((m) => ({ m, days: daysUntilBirthday(m.birthdate) }))
    .filter((x): x is { m: SharedMember; days: number } => x.days !== null && x.days <= 120)
    .sort((a, b) => a.days - b.days)
    .slice(0, 4);

  const withSizes = members.filter((m) => sharedSizeEntries(m).length).length;
  const withWishes = members.filter((m) => sharedWishes(m).length).length;
  const withBirthday = members.filter((m) => m.birthdate).length;

  const since = connectedAt
    ? new Date(connectedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="card overflow-hidden min-h-[500px] flex flex-col">
      <div className="p-4 sm:p-6 border-b border-cream-200">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 hover:text-ink-800 mb-4 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Your family
        </button>

        <div className="flex items-center gap-4 sm:gap-5">
          {photoUrl ? (
            <button
              type="button"
              onClick={() => onViewPhoto?.(photoUrl)}
              className="avatar-ring cursor-zoom-in shrink-0"
              aria-label={`See the ${householdName} photo full size`}
            >
              <img
                src={photoUrl}
                alt={householdName}
                className="w-24 h-24 lg:w-28 lg:h-28 rounded-full object-cover"
              />
            </button>
          ) : (
            <div className="w-24 h-24 lg:w-28 lg:h-28 rounded-full bg-dusk-100 text-dusk-600 flex items-center justify-center shrink-0">
              <Users className="w-10 h-10" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-ink-900 leading-tight break-words">
              {householdName}
            </h2>
            <p className="text-[13px] text-ink-500 mt-1.5">
              {members.length} {members.length === 1 ? 'person' : 'people'} shared with you
              {' · '}you share {sharedByMeCount} back
            </p>
            {since && (
              <p className="text-[12.5px] text-ink-400 mt-0.5 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Connected since {since}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6 flex-1">
        {/* The full form: this is the page with room for what they want done
            and which papers exist, when they chose to share those. */}
        {namedByThem && <NamedByThemCard named={namedByThem} memberName={memberName} />}

        {upcoming.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2.5 flex items-center gap-1.5">
              <Cake className="w-3.5 h-3.5" /> Coming up
            </h3>
            <div className="space-y-1.5">
              {upcoming.map(({ m, days }) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onOpenPerson(m)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-cream-200 bg-white hover:bg-cream-50 text-left transition-colors cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-full ${m.avatarColor || 'bg-clay-500'} text-white flex items-center justify-center shrink-0 font-bold text-[13px]`}>
                    {m.avatarUrl
                      ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full rounded-full object-cover" />
                      : initial(m.name)}
                  </div>
                  <p className="flex-1 min-w-0 text-[13.5px] font-bold text-ink-900 truncate">{m.name}</p>
                  <span className={`text-[12px] font-semibold tabular-nums shrink-0 ${days <= 1 ? 'text-clay-600' : 'text-ink-500'}`}>
                    {whenLabel(days)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2.5 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> Everyone they share
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenPerson(m)}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl border border-cream-200 bg-white hover:border-clay-300 hover:bg-cream-50 transition-colors cursor-pointer"
              >
                <div className={`w-14 h-14 rounded-full ${m.avatarColor || 'bg-clay-500'} text-white flex items-center justify-center font-bold text-[18px]`}>
                  {m.avatarUrl
                    ? <img src={m.avatarUrl} alt={m.name} className="w-full h-full rounded-full object-cover" />
                    : initial(m.name)}
                </div>
                <p className="text-[12.5px] font-bold text-ink-900 text-center leading-tight break-words w-full">
                  {m.name}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Counts of what crossed, so the page is honest about how much of this
            household you can actually see rather than implying you see it all. */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: Cake, n: withBirthday, label: withBirthday === 1 ? 'birthday' : 'birthdays' },
            { icon: Ruler, n: withSizes, label: withSizes === 1 ? 'has sizes' : 'have sizes' },
            { icon: Gift, n: withWishes, label: withWishes === 1 ? 'wish list' : 'wish lists' },
          ].map(({ icon: Icon, n, label }) => (
            <div key={label} className="rounded-2xl border border-cream-200 bg-cream-50/60 px-3 py-3 text-center">
              <Icon className="w-4 h-4 text-ink-400 mx-auto mb-1" />
              <p className="text-[17px] font-bold text-ink-900 tabular-nums leading-none">{n}</p>
              <p className="text-[11.5px] text-ink-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        <p className="text-[12.5px] text-ink-400 text-center">
          Only what {householdName} chose to share appears here.
        </p>
      </div>
    </div>
  );
};

export default SharedHousehold;
