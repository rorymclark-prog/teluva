import { auth } from '../lib/firebase';
import { ClothingSizes, FavoriteItem, FamilyRole, SuccessorShareLevel, NameCelebration, Preferences } from '../types';

/**
 * Linked families — the client half.
 *
 * A connected household is NOT a space you can switch into. Nothing here goes
 * through the Firestore SDK: `familyLinks` is server-only (firestore.rules
 * denies the whole collection, and firestore-rules.test.mjs proves it), so
 * every call below is an authenticated fetch and the server projects the other
 * household's people through the allowlist in server/familyLink.mjs before
 * anything reaches this file.
 *
 * That is why SharedMember is a DIFFERENT type from FamilyMember rather than a
 * Partial<FamilyMember>: a partial would quietly widen every time FamilyMember
 * grew a field, and would tempt a component into reading `member.medical`
 * because the type said it might be there.
 */
export interface SharedMember {
  id: string;
  name: string;
  nickname?: string;
  role?: FamilyRole | string;
  birthdate?: string;
  avatarColor?: string;
  avatarUrl?: string;
  avatarStyle?: string;
  /* WHICH SWITCHES ARE ON for this person, straight from the server. The only
     way this side can tell an empty field apart from a category that was
     never sent — see SharedProfile, where it decides whether an empty state
     may honestly be drawn. Absent on payloads from before v322. */
  sharedCategories?: ShareCategory[];
  /* What they are into. `dietaryRestrictions` is in this object too but does
     NOT arrive with the rest — the server sends it only under `care`, because
     it can name a diagnosis or a religion. Anything here may therefore be
     absent for either reason: not filled in, or not shared. */
  preferences?: Partial<Pick<Preferences,
    'hobbies' | 'sports' | 'colorPreferences' | 'clothingBrands'
    | 'favoriteBooks' | 'favoriteMovies' | 'favoriteGames' | 'favoriteMusic'
    | 'favoriteMeals' | 'dislikedFoods' | 'dietaryRestrictions'>>;
  clothingSizes?: Pick<ClothingSizes,
    'tops' | 'bottoms' | 'shoes' | 'outerwear' | 'hatValue' | 'dressSize'
    | 'jacketSize' | 'ringSize' | 'heightCm' | 'lastUpdated'>;
  favorites?: Array<Pick<FavoriteItem,
    'id' | 'title' | 'category' | 'imageUrl' | 'isWishlist' | 'targetPrice'
    | 'webLink' | 'bought' | 'addedAt'>>;
  /** Only present when the other household switched 'care' on for this person.
   *  Five fields, not MedicalRecord — see SHAREABLE_MEDICAL_FIELDS. */
  medical?: {
    bloodGroup?: string;
    allergies?: string;
    emergencyMedication?: string;
    medications?: string;
    conditions?: string;
  };
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  /* What the names mean — the 'about' category. `confidence` is always
     present because a meaning rendered without its hedge is the app asserting
     folk etymology as fact about somebody's own family. */
  nameMeanings?: Array<{
    token: string;
    role: 'given' | 'middle' | 'family';
    meaning: string;
    origin?: string;
    explanation?: string;
    alsoKnown?: string;
    confidence: 'established' | 'likely' | 'contested';
  }>;
  /* Name days — the 'celebrations' category, opt-in. Crossed as the raw
     fields rather than a resolved list so the far side runs the SAME
     utils/nameCelebrations.ts resolver everybody else does; a second
     resolution written here is a second answer waiting to disagree. */
  nameDay?: string;
  nameDayFeast?: string;
  nameCelebrations?: NameCelebration[];
  nameCelebrationResolvedDates?: Record<string, Record<string, string>>;
}

export type ShareCategory = 'photo' | 'birthday' | 'about' | 'celebrations' | 'interests' | 'sizes' | 'wishes' | 'care';

export interface FamilyLink {
  id: string;
  status: 'pending' | 'active';
  /** Only ever present on a pending link YOU created — the side that must send it. */
  code?: string;
  expiresAt?: string;
  otherName: string;
  connectedAt?: string | null;
  /** Member ids of MY space that the other household can see. */
  sharedByMe: string[];
  shareFields?: Record<string, ShareCategory[]>;
  /** How many people they share back. The ids stay theirs. */
  sharedWithMeCount: number;
  /** 'everyone' keeps up with the family as it grows; 'chosen' is a fixed
   *  list. Absent on an old link means 'chosen' — see shareModeFor. */
  shareMode?: ShareMode;
  /** Only meaningful in 'everyone' mode: who is deliberately left out. */
  excludedByMe?: string[];
  /** How many people are in MY space, so the picker can say how many of them
   *  are actually crossing without making anyone count two lists. */
  myMemberCount?: number;
  /** They named one of ours in their estate plans. On the LIST response as
   *  well as /profiles, so being named reaches the home screen instead of
   *  waiting to be found. */
  namedByThem?: NamedByThem | null;
}

export type ShareMode = 'chosen' | 'everyone';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Please sign in first.');
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong.');
  return data as T;
}

export const listFamilyLinks = () =>
  call<{ links: FamilyLink[] }>('/api/family-link/list').then((d) => d.links || []);

export const createFamilyLink = () =>
  call<{ link: FamilyLink }>('/api/family-link/create', { method: 'POST', body: '{}' }).then((d) => d.link);

export const acceptFamilyLink = (code: string) =>
  call<{ link: FamilyLink }>('/api/family-link/accept', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }).then((d) => d.link);

/* The four things an admin can turn on or off per person, inside the ceiling
 * the server allowlist sets. Kept in step with SHARE_CATEGORIES in
 * server/familyLink.mjs — familyLinkWiring.test.ts fails if they drift. */
export const SHARE_CATEGORIES: Array<{
  id: ShareCategory; label: string; hint: string; optIn?: boolean;
}> = [
  { id: 'photo', label: 'Photo', hint: 'Their picture, if they have one' },
  { id: 'birthday', label: 'Birthday', hint: 'The date, their age and their star sign' },
  { id: 'about', label: 'Name meaning', hint: 'What their first name and the family name mean' },
  {
    id: 'celebrations',
    label: 'Name days',
    hint: 'Their Namenstag or name celebration, and the tradition it comes from',
    /* OPT-IN, and not out of squeamishness about parties. A feast day names a
     * religion — 'Hl. Josef', or a tradition reading 'Gaudiya Vaishnava /
     * Hindu'. That is Art. 9 data, the same reason 'care' is opt-in. */
    optIn: true,
  },
  {
    id: 'interests',
    label: 'What they like',
    hint: 'Hobbies, colours, music, books — for when there is no wish list',
  },
  { id: 'sizes', label: 'Sizes', hint: 'Clothes and shoes, for presents' },
  { id: 'wishes', label: 'Wish list', hint: 'What they still want' },
  {
    id: 'care',
    label: 'In their care',
    hint: 'Allergies, medicines and who to ring — for whoever is minding them',
    /* OFF unless somebody switches it on, for this person, for this family.
     * The other four are what an old link already shared; this one is not,
     * and turning it on by default would disclose a child's allergies to
     * every connected household the day it shipped. */
    optIn: true,
  },
];

export const ALL_SHARE_CATEGORIES: ShareCategory[] = SHARE_CATEGORIES.map((c) => c.id);
/** What an absent entry means — the four that existed before opt-ins did. */
export const DEFAULT_SHARE_CATEGORIES: ShareCategory[] =
  SHARE_CATEGORIES.filter((c) => !c.optIn).map((c) => c.id);

/** No entry for a person means the DEFAULTS — every link made before this
 *  existed, and every opt-in category nobody has chosen yet. */
export function categoriesForMember(
  shareFields: Record<string, ShareCategory[]> | undefined,
  memberId: string,
): ShareCategory[] {
  const set = shareFields?.[memberId];
  return Array.isArray(set) ? set : DEFAULT_SHARE_CATEGORIES;
}

export const setFamilyLinkShare = (
  linkId: string,
  memberIds: string[],
  shareFields?: Record<string, ShareCategory[]>,
  /* Sent explicitly rather than inferred: in 'everyone' mode the ids are the
   * NOT-excluded, and a server left to guess which dial moved would write the
   * right-looking list into the wrong key. */
  shareMode?: ShareMode,
) =>
  call<{
    sharedByMe: string[];
    shareFields: Record<string, ShareCategory[]>;
    shareMode?: ShareMode;
    excludedByMe?: string[];
  }>('/api/family-link/share', {
    method: 'POST',
    body: JSON.stringify({ linkId, memberIds, shareFields, shareMode }),
  }).then((d) => ({
    sharedByMe: d.sharedByMe || [],
    shareFields: d.shareFields || {},
    shareMode: d.shareMode,
    excludedByMe: d.excludedByMe || [],
  }));

/** They named one of OUR people as who takes over. The fact only — their
 *  instructions stay in their estate document, where they belong. */
/**
 * They named one of OUR people to help with their estate.
 *
 * `level` is how much THEY chose to say — see SuccessorShareLevel in types.ts.
 * The extra fields only appear at the rung that permits them, so a component
 * can render whatever is present without knowing the ladder: absent means it
 * did not cross, never that it is empty.
 */
export interface NamedByThem {
  memberId: string;
  byName: string;
  level?: SuccessorShareLevel;
  /** When they last changed how much they share — so we can say "this is new". */
  setAt?: string;
  /** 'instructions' and above: what they want this person to do. */
  whatTheyShouldDo?: string;
  /** 'documents' only: which KINDS of paper exist, and how current. Never
   *  where any of it is kept, and never the files. */
  documents?: Array<{ kind: string; lastReviewed?: string }>;
  /** EVERY RUNG, including 'fact': who to ask for the signed original.
   *  Either a custodian, or — only when there is no custodian and no
   *  registration — where it is kept, or a plain `unrecorded`. See rule 3b in
   *  server/familyLink.mjs; this is the one thing the ladder never withholds,
   *  because a will nobody can find is a lost will. */
  findWill?: Array<{
    kind: string;
    heldBy?: string;
    notaryName?: string;
    registered?: 'registered';
    registryName?: string;
    originalLocation?: string;
    unrecorded?: boolean;
  }>;
}

export const loadFamilyLinkProfiles = (linkId: string) =>
  call<{ members: SharedMember[]; otherName: string; otherPhotoUrl?: string; namedByThem?: NamedByThem | null }>(
    `/api/family-link/profiles?linkId=${encodeURIComponent(linkId)}`,
  );

export const revokeFamilyLink = (linkId: string) =>
  call<{ ok: true }>('/api/family-link/revoke', {
    method: 'POST',
    body: JSON.stringify({ linkId }),
  });

/** "9" / "3 mo" — enough to know which cousin is which, without a birthday maths detour. */
export function sharedAge(birthdate?: string): string | null {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) years -= 1;
  if (years < 0) return null;
  if (years >= 2) return `${years}`;
  const months = years * 12 + (monthDelta < 0 ? monthDelta + 12 : monthDelta);
  return `${Math.max(0, months)} mo`;
}
