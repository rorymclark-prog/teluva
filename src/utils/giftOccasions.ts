// One family's gift-giving calendar — birthdays, name days and Christmas —
// merged into a single "what's coming up, and what do they want" projection.
//
// WHY THIS EXISTS
// ----------------
// The app already knows three separate facts that determine when someone
// should get a present (birthdate, stored nameDay, and the fixed 25 Dec every
// family shares) and a fourth fact for what to get them (favorites flagged
// isWishlist). Nothing merged them. This module is that merge — a pure
// projection, no new field, no new store, same principle healthTimeline.ts
// documents for its own merge of scattered medical facts.
//
// THE ONE RULE: EACH MEMBER GETS EXACTLY ONE OCCASION, THE SOONEST ONE.
// A member is not shown three times (once per kind) — that would just be
// noise heading into the busiest gift-buying weeks of the year. Instead each
// member is bucketed under whichever of their three candidate occasions is
// closest, and only that one is shown. See buildGiftOccasions below.
import { FamilyMember, FavoriteItem } from '../types';
import { resolveNameDay, daysUntilNameDay, formatNameDay } from './nameDay';
import { parseDateOnly } from './age';

export type OccasionKind = 'birthday' | 'nameDay' | 'christmas';

export interface MemberOccasion {
  memberId: string;
  memberName: string;
  avatarUrl?: string;
  avatarColor: string;
  kind: OccasionKind;
  /** 'MM-DD' — the recurring month-day this occasion falls on. */
  monthDay: string;
  /** Whole days from `now` to the next occurrence (0 = today). Never negative. */
  daysUntil: number;
  /** This year's/next occurrence as a full YYYY-MM-DD — derived as today+daysUntil,
   *  NOT by re-deriving the date from monthDay, so it can never disagree with
   *  daysUntil. Display/relativeDayLabel-interop only; monthDay is the identity. */
  date: string;
  /** 'D Month', via formatNameDay — e.g. '19 March'. */
  dateLabel: string;
  /** Only set when kind === 'nameDay'. */
  feast?: string;
  /** member.favorites filtered to isWishlist === true, original array order. */
  wishlistItems: FavoriteItem[];
}

export interface OccasionGroup {
  kind: OccasionKind;
  /** 'Birthdays coming up' | 'Name days coming up' | 'Christmas' */
  label: string;
  /** Soonest first (daysUntil asc, then memberName asc on a tie). */
  members: MemberOccasion[];
}

export interface GiftOccasionsResult {
  /** Only non-empty groups. Sorted so the group containing the soonest
   *  occasion overall appears first. */
  groups: OccasionGroup[];
  /** True only when there is nothing to show at all — i.e. members.length === 0,
   *  since Christmas is a candidate for every member and groups.length would
   *  otherwise always be >= 1. Computed structurally (groups.length === 0),
   *  not from members.length, so it stays correct if that ever changes. */
  isEmpty: boolean;
}

const GROUP_META: Record<OccasionKind, string> = {
  birthday: 'Birthdays coming up',
  nameDay: 'Name days coming up',
  christmas: 'Christmas',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Full ISO birthdate → 'MM-DD', or null if unparseable/missing. Uses the same
 *  local-safe parser as healthTimeline.ts (parseDateOnly), not `new Date(iso)`
 *  directly, to avoid UTC/local off-by-one on the extracted day. */
function monthDayFromBirthdate(birthdate?: string): string | null {
  const d = parseDateOnly(birthdate);
  return d ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : null;
}

export function buildGiftOccasions({
  members,
  now,
}: {
  members: readonly FamilyMember[];
  /** Injected, never read from the clock in here — same convention as
   *  buildHealthTimeline's `now` parameter. */
  now: Date;
}): GiftOccasionsResult {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets: Record<OccasionKind, MemberOccasion[]> = { birthday: [], nameDay: [], christmas: [] };

  for (const member of members) {
    type Candidate = { kind: OccasionKind; monthDay: string; daysUntil: number; feast?: string };
    const candidates: Candidate[] = [];

    // --- birthday ---
    const birthdayMonthDay = monthDayFromBirthdate(member.birthdate);
    if (birthdayMonthDay) {
      const d = daysUntilNameDay(birthdayMonthDay, now);
      if (d != null) candidates.push({ kind: 'birthday', monthDay: birthdayMonthDay, daysUntil: d });
    }

    // --- name day: STORED branch only, never 'suggested' ---
    const resolved = resolveNameDay(member);
    if (resolved && resolved.source === 'stored') {
      const d = daysUntilNameDay(resolved.date, now);
      if (d != null) candidates.push({ kind: 'nameDay', monthDay: resolved.date, daysUntil: d, feast: resolved.feast });
    }

    // --- Christmas: always applies, always valid ---
    const xmasDays = daysUntilNameDay('12-25', now)!; // '12-25' is always a valid MM-DD, never null
    candidates.push({ kind: 'christmas', monthDay: '12-25', daysUntil: xmasDays });

    // Pick the soonest. Candidates were pushed in a fixed [birthday, nameDay,
    // christmas] order and we compare with strict `<`, so an exact tie keeps
    // the earlier-pushed (more personal) occasion — birthday beats nameDay
    // beats christmas on the same day.
    let soonest = candidates[0];
    for (const c of candidates) if (c.daysUntil < soonest.daysUntil) soonest = c;

    const occurrence = new Date(t0.getTime() + soonest.daysUntil * 86400000);
    const dateIso = `${occurrence.getFullYear()}-${pad2(occurrence.getMonth() + 1)}-${pad2(occurrence.getDate())}`;

    buckets[soonest.kind].push({
      memberId: member.id,
      memberName: member.name,
      avatarUrl: member.avatarUrl,
      avatarColor: member.avatarColor,
      kind: soonest.kind,
      monthDay: soonest.monthDay,
      daysUntil: soonest.daysUntil,
      date: dateIso,
      dateLabel: formatNameDay(soonest.monthDay),
      feast: soonest.kind === 'nameDay' ? soonest.feast : undefined,
      wishlistItems: (member.favorites || []).filter((f) => f.isWishlist === true),
    });
  }

  const groups: OccasionGroup[] = (['birthday', 'nameDay', 'christmas'] as const)
    .map((kind) => ({
      kind,
      label: GROUP_META[kind],
      members: [...buckets[kind]].sort(
        (a, b) => a.daysUntil - b.daysUntil || a.memberName.localeCompare(b.memberName),
      ),
    }))
    .filter((g) => g.members.length > 0)
    .sort((a, b) => a.members[0].daysUntil - b.members[0].daysUntil);

  return { groups, isEmpty: groups.length === 0 };
}
