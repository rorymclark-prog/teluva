import React, { useMemo } from 'react';
import { Gift, Cake, Sparkles, TreePine, ExternalLink, Check, ChevronRight } from 'lucide-react';
import { FamilyMember } from '../types';
import { warmAvatarColor } from '../utils/avatarPalette';
import { relativeDayLabel, todayIsoLocal } from '../utils/memberAppointments';
import { buildGiftOccasions, OccasionKind, MemberOccasion } from '../utils/giftOccasions';
import EmptyState from './EmptyState';

interface Props {
  members: FamilyMember[];
  onSelectMember: (memberId: string) => void;
}

// Duplicated (not imported) from MemberFavorites.tsx's own CATEGORY_CHIP —
// that file doesn't export it, matching HealthTimeline.tsx's precedent of
// copying REFERRAL_KIND_CHIP verbatim rather than importing. Keep in sync by
// hand; if MemberFavorites.tsx ever exports its map, import instead.
const CATEGORY_CHIP: Record<string, string> = {
  'Toy': 'bg-honey-100 text-honey-700',
  'Clothing & Style': 'bg-rosa-100 text-rosa-700',
  'Hobbies & Sports': 'bg-sage-100 text-sage-700',
  'Books & Media': 'bg-dusk-100 text-dusk-700',
  'Food & Treats': 'bg-clay-100 text-clay-700',
  'Other': 'bg-cream-200 text-ink-600',
};

const KIND_META: Record<OccasionKind, { Icon: typeof Cake; tint: string; dot: string }> = {
  birthday: { Icon: Cake, tint: 'border-rosa-100 bg-rosa-50', dot: 'bg-rosa-100 text-rosa-600' },
  nameDay: { Icon: Sparkles, tint: 'border-dusk-100 bg-dusk-50', dot: 'bg-dusk-100 text-dusk-700' },
  christmas: { Icon: TreePine, tint: 'border-sage-100 bg-sage-50', dot: 'bg-sage-100 text-sage-700' },
};

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/**
 * Birthdays, name days and Christmas, merged into one "who's up next and what
 * do they want" view — see utils/giftOccasions.ts for the merge logic. This
 * component is read-only: every path out is `onSelectMember`, which the
 * caller wires into that member's Wishlist tab (MemberFavorites.tsx) via
 * Dashboard.tsx's goToMemberTab helper. No editing, no "add item" affordance
 * lives here.
 */
export default function GiftsOccasionsView({ members, onSelectMember }: Props) {
  // One `now` for the whole render, injected into the pure module — same
  // convention as HealthTimeline.tsx.
  const now = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => todayIsoLocal(now), [now]);
  const result = useMemo(() => buildGiftOccasions({ members, now }), [members, now]);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header — mirrors ShoppingList.tsx's card header pattern */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-honey-100 text-honey-700 shrink-0">
            <Gift className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink-900">Gifts &amp; Occasions</h2>
            <p className="text-[13px] text-ink-400 font-medium">
              Birthdays, name days and Christmas — everyone's wishlist, sorted by what's coming up first.
            </p>
          </div>
        </div>
      </div>

      {result.isEmpty ? (
        <div className="card p-5">
          <EmptyState
            icon={Gift}
            tone="honey"
            title="No upcoming occasions yet"
            description="Add a birthdate or name day on a family member's profile to see their gift occasions here."
          />
        </div>
      ) : (
        result.groups.map((group) => (
          <section key={group.kind} className="space-y-3">
            <h3 className="text-[12px] font-bold text-ink-400 uppercase tracking-wide flex items-center gap-1.5">
              {group.label}
            </h3>
            <div className="space-y-3">
              {group.members.map((mo) => (
                <MemberOccasionCard
                  key={mo.memberId}
                  occasion={mo}
                  todayIso={todayIso}
                  onSelectMember={onSelectMember}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

// Typed as React.FC (rather than a plain function) purely so it can take a
// `key` prop when rendered from .map() below — matches HealthTimeline.tsx's
// own sub-components (HistoryRow, YearGroup, UpcomingRow), which do the same
// for the same reason.
const MemberOccasionCard: React.FC<{
  occasion: MemberOccasion; todayIso: string; onSelectMember: (id: string) => void;
}> = ({ occasion, todayIso, onSelectMember }) => {
  const meta = KIND_META[occasion.kind];
  const Icon = meta.Icon;
  const member = occasion; // fields already flattened onto MemberOccasion

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${meta.tint}`}>
      {/* Member row */}
      <div className="flex items-center gap-3">
        {member.avatarUrl ? (
          <img src={member.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
        ) : (
          <span className={`w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold text-white uppercase shrink-0 ${warmAvatarColor(member.avatarColor)}`}>
            {member.memberName.charAt(0)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink-900">
            {firstName(member.memberName)}
            {occasion.kind === 'nameDay' && occasion.feast && (
              <span className="ml-1.5 text-[12px] font-normal text-ink-500">({occasion.feast})</span>
            )}
          </p>
          <p className="text-[12.5px] text-ink-500 tabular-nums">{occasion.dateLabel}</p>
        </div>
        <span className={`chip shrink-0 ${meta.dot}`}>
          <Icon className="w-3.5 h-3.5" />
          {relativeDayLabel(occasion.date, todayIso)}
        </span>
      </div>

      {/* Wishlist items, or the lean nudge when there are none */}
      <div className="mt-3.5 space-y-2">
        {occasion.wishlistItems.length === 0 ? (
          <button
            type="button"
            onClick={() => onSelectMember(occasion.memberId)}
            className="w-full text-left text-[12.5px] text-ink-400 italic flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/60 hover:bg-white transition-colors"
          >
            <span>No wishlist items yet for {firstName(member.memberName)}.</span>
            <span className="flex items-center gap-0.5 text-dusk-600 not-italic font-semibold shrink-0">
              Add some <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </button>
        ) : (
          occasion.wishlistItems.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/70 ${item.bought ? 'opacity-60' : ''}`}
            >
              <span className={`chip shrink-0 ${CATEGORY_CHIP[item.category] ?? 'bg-cream-200 text-ink-600'}`}>
                {item.category}
              </span>
              <span className={`flex-1 min-w-0 text-[13px] font-medium text-ink-800 truncate ${item.bought ? 'line-through' : ''}`}>
                {item.title}
              </span>
              {item.targetPrice && (
                <span className="shrink-0 font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded chip bg-honey-100 text-honey-700 tabular-nums">
                  {item.targetPrice.startsWith('€') || item.targetPrice.startsWith('$') ? item.targetPrice : `€${item.targetPrice}`}
                </span>
              )}
              {item.bought && (
                <span className="chip bg-sage-100 text-sage-700 shrink-0"><Check className="w-3 h-3" /> Secured</span>
              )}
              {item.webLink && (
                <a
                  href={item.webLink.startsWith('http') ? item.webLink : `https://${item.webLink}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 hover:bg-cream-200 text-ink-400 hover:text-dusk-500 rounded transition-colors shrink-0"
                  title="Open shopping page"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ))
        )}
        <button
          type="button"
          onClick={() => onSelectMember(occasion.memberId)}
          className="text-[11.5px] text-ink-400 hover:text-dusk-600 font-semibold flex items-center gap-0.5 px-3 pt-0.5"
        >
          Manage {firstName(member.memberName)}'s wishlist <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
