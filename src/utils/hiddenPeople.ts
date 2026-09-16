// People whose dates a family has chosen not to see.
//
//   npx tsx src/utils/hiddenPeople.test.ts
//
// WHY THIS EXISTS. A family record keeps everybody who was ever part of it —
// an ex-partner, an aunt nobody speaks to — and then puts their birthday on
// the calendar, the home screen and the phone every year. Deleting them is the
// wrong fix (the children still have that parent; the history is still true),
// so this is a way to stop SURFACING someone's dates without touching them.
//
// THREE LISTS, ONE ANSWER. Each account keeps its own list
// (families/{id}/prefs/{uid}, private to that account), the family can keep
// one for everybody (HubSettings.hiddenDatePeople), and an admin can hide a
// person from CHOSEN accounts only (HubSettings.hiddenDatePeopleFor — "hide
// Nora's birthday from Papa, leave it for the boys"). A date is hidden for an
// account when its person is on its own list, on the family's, or on an entry
// of the third list that names that account (hiddenForAccount below). None of
// the lists is ever written by this module; the with…/without… helpers only
// return the next value for a caller to save.
//
// The third list is kept apart from the family list, not folded into it as a
// `forUids` on each entry, because of the phones still running v354: they
// would read such an entry as family-wide and hide the date from the very
// people it was meant to be left for. An unknown key they simply ignore, so
// an old build fails open — it shows the date — instead of wide.
//
// BY ID, NOT BY NAME. A hidden person is a key — `member:<id>`,
// `extended:<id>`, `pet:<id>`, `linked:<linkId>:<personId>` — so renaming
// "Nora" to "Nora Berg" does not bring her birthday back, and hiding Nora
// never hides a different Nora in the in-laws' household.
//
// Names are used in exactly one place: a calendar event somebody TYPED, which
// has no id to go by. Such an event is hidden only when its title is flagged
// as a birthday, name day or anniversary AND names a hidden person as a whole
// word. "Nora's birthday" goes; "Dinner with Nora" is not one of her dates and
// stays. Anniversary records are the same case — they name the people they are
// about in their title, and they are anniversaries by definition.
//
// EVERY SURFACE FILTERS ITS INPUT through the functions below, before building
// anything, and never saves the filtered list back. The server carries a port
// of this file for the published feed and the daily reminders
// (server/hiddenPeople.mjs); hiddenPeopleParity.test.ts keeps the two in step.
//
// No lookbehind in any regex here — see eventKeywordFlags.ts for why (Safari
// before 16.4 rejects the whole module).
import type { FamilyMember, FamilyMemberRole, FamilyRole, HiddenDatePerson, HiddenDatePersonFor } from '../types';
import { isAnniversaryFlaggedTitle, isBirthdayFlaggedTitle } from './eventKeywordFlags';
import { resolveMe } from './me';

/** 'me' = this account's own list; 'family' = everyone; 'some' = the accounts an admin ticked. */
export type HiddenScope = 'me' | 'family' | 'some';

export const hiddenKey = {
  member: (id: string) => `member:${id}`,
  extended: (id: string) => `extended:${id}`,
  pet: (id: string) => `pet:${id}`,
  linked: (linkId: string, personId: string) => `linked:${linkId}:${personId}`,
};

interface NameMatcher { name: string; re: RegExp; ambiguous: boolean }

export interface HiddenPeople {
  /** Every hidden person's key, from both lists. */
  keys: ReadonlySet<string>;
  /** Names to look for in a typed birthday/anniversary title (normalised). */
  names: readonly string[];
  /** @internal compiled once per build, not per event */
  matchers: readonly NameMatcher[];
}

export const NO_HIDDEN_PEOPLE: HiddenPeople = { keys: new Set(), names: [], matchers: [] };

/** Records the hidden keys point at, so a hidden person's CURRENT name is matched as well as the one they had when hidden. */
export interface HiddenNameSources {
  members?: { id: string; name?: string }[];
  extendedBirthdays?: { id: string; name?: string }[];
  pets?: { id: string; name?: string }[];
}

/** Lowercase and strip accents, so "Klára" and "Klara" are the same person. */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Words that say who someone is rather than what they are called. "Aunt Klara"
// is found in "Klara's birthday", and must never be found by "Aunt".
const HONORIFICS = new Set([
  'aunt', 'auntie', 'aunty', 'uncle', 'grandma', 'granny', 'grandpa', 'grandad',
  'granddad', 'grandmother', 'grandfather', 'nana', 'nan', 'oma', 'opa', 'omi',
  'opi', 'tante', 'onkel', 'cousin', 'cousine', 'mr', 'mrs', 'ms', 'miss', 'dr',
  'frau', 'herr', 'my', 'our',
]);

// Names that are also ordinary calendar words (same list as
// eventMemberMatch.ts). For these a bare mention is not enough.
const AMBIGUOUS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'summer', 'winter', 'spring', 'autumn', 'easter', 'noel',
]);

// An initial or a two-letter nickname matches too much to hide anything by.
const MIN_NAME_LENGTH = 3;

/** The full name, and the first word of it that is not an honorific. */
export function candidateNames(name: string | undefined): string[] {
  const full = normalizeName(name || '');
  if (!full) return [];
  const out: string[] = [];
  if (full.length >= MIN_NAME_LENGTH) out.push(full);
  const first = full.split(' ').find((t) => !HONORIFICS.has(t.replace(/\.$/, '')));
  if (first && first !== full && first.length >= MIN_NAME_LENGTH) out.push(first);
  return out;
}

const B = '[^\\p{L}\\p{N}_]';      // one character that is not part of a word
const NB = '(?![\\p{L}\\p{N}_])';   // the end of a word

function compile(name: string): NameMatcher {
  const e = escapeRe(name).replace(/ /g, '\\s+');
  // A trailing "s" is allowed for the German possessive: "Klaras Geburtstag".
  return { name, re: new RegExp(`(?:^|${B})${e}s?${NB}`, 'u'), ambiguous: AMBIGUOUS.has(name) };
}

function matcherHits(m: NameMatcher, title: string): boolean {
  if (!m.re.test(title)) return false;
  if (!m.ambiguous) return true;
  const e = escapeRe(m.name);
  return (
    new RegExp(`^\\s*${e}\\s*[-–—:,&]`, 'u').test(title) ||
    new RegExp(`${e}'?s${NB}`, 'u').test(title) ||
    new RegExp(`(?:^|${B})(?:for|with|fur)\\s+${e}${NB}`, 'u').test(title)
  );
}

/**
 * The effective hidden set: every key on any of the given lists (the account's
 * own and the family's), and every name those people go by.
 */
export function buildHiddenPeople(
  lists: ReadonlyArray<ReadonlyArray<HiddenDatePerson> | undefined | null>,
  current: HiddenNameSources = {},
): HiddenPeople {
  const keys = new Set<string>();
  const rawNames: string[] = [];
  for (const list of lists) {
    for (const p of list || []) {
      if (!p || typeof p.id !== 'string' || !p.id) continue;
      keys.add(p.id);
      if (p.name) rawNames.push(p.name);
    }
  }
  if (!keys.size) return NO_HIDDEN_PEOPLE;
  const lookup = (prefix: string, recs?: { id: string; name?: string }[]) => {
    for (const r of recs || []) if (keys.has(`${prefix}:${r.id}`) && r.name) rawNames.push(r.name);
  };
  lookup('member', current.members);
  lookup('extended', current.extendedBirthdays);
  lookup('pet', current.pets);
  const names = [...new Set(rawNames.flatMap(candidateNames))];
  return { keys, names, matchers: names.map(compile) };
}

export function isHiddenKey(hp: HiddenPeople, key: string): boolean {
  return hp.keys.has(key);
}

/** Does this title name a hidden person as a whole word? */
export function titleNamesHiddenPerson(title: string | undefined, hp: HiddenPeople): boolean {
  if (!title || !hp.matchers.length) return false;
  const t = normalizeName(title);
  return hp.matchers.some((m) => matcherHits(m, t));
}

// --- The filters. Each takes a surface's INPUT and returns what it may show. --

/** Members whose birthday and name days may be shown. Not a filter for anything else a member has. */
export function visibleDateMembers<T extends { id: string }>(members: T[], hp: HiddenPeople): T[] {
  if (!hp.keys.size) return members;
  return members.filter((m) => !hp.keys.has(hiddenKey.member(m.id)));
}

export function visibleExtendedBirthdays<T extends { id: string }>(list: T[], hp: HiddenPeople): T[] {
  if (!hp.keys.size) return list;
  return list.filter((e) => !hp.keys.has(hiddenKey.extended(e.id)));
}

export function visiblePets<T extends { id: string }>(pets: T[], hp: HiddenPeople): T[] {
  if (!hp.keys.size) return pets;
  return pets.filter((p) => !hp.keys.has(hiddenKey.pet(p.id)));
}

/** People shared by a connected household (utils/familyLink.ts), for one link. */
export function visibleLinkedPeople<T extends { id: string }>(linkId: string, people: T[], hp: HiddenPeople): T[] {
  if (!hp.keys.size) return people;
  return people.filter((p) => !hp.keys.has(hiddenKey.linked(linkId, p.id)));
}

/** An anniversary record involves a hidden person if it is tagged to one, or its title names one. */
export function anniversaryIsHidden(rec: { memberIds?: string[]; title?: string }, hp: HiddenPeople): boolean {
  if (!hp.keys.size) return false;
  if ((rec.memberIds || []).some((id) => hp.keys.has(hiddenKey.member(id)))) return true;
  return titleNamesHiddenPerson(rec.title, hp);
}

export function visibleAnniversaries<T extends { memberIds?: string[]; title?: string }>(list: T[], hp: HiddenPeople): T[] {
  if (!hp.keys.size) return list;
  return list.filter((a) => !anniversaryIsHidden(a, hp));
}

/**
 * Is this TYPED calendar event one of a hidden person's dates?
 *
 * Only an event whose title says it is a birthday, name day or anniversary can
 * be. Then:
 *   * it names a hidden person → hidden ("Nora's birthday", "Klaras Geburtstag");
 *   * an anniversary tagged to a hidden member → hidden (it involves them);
 *   * a birthday tagged ONLY to hidden members → hidden. A birthday party is
 *     often tagged to whoever is going, so one hidden guest among the tags
 *     does not make it theirs.
 */
export function eventIsHiddenDate(ev: { title?: string; memberIds?: string[] }, hp: HiddenPeople): boolean {
  if (!hp.keys.size) return false;
  const title = ev.title || '';
  const birthday = isBirthdayFlaggedTitle(title);
  const anniversary = isAnniversaryFlaggedTitle(title);
  if (!birthday && !anniversary) return false;
  if (titleNamesHiddenPerson(title, hp)) return true;
  const tags = ev.memberIds || [];
  const hiddenTags = tags.filter((id) => hp.keys.has(hiddenKey.member(id)));
  if (anniversary && hiddenTags.length > 0) return true;
  return birthday && tags.length > 0 && hiddenTags.length === tags.length;
}

export function visibleEvents<T extends { title?: string; memberIds?: string[] }>(events: T[], hp: HiddenPeople): T[] {
  if (!hp.keys.size) return events;
  return events.filter((e) => !eventIsHiddenDate(e, hp));
}

/** The person behind a calendar occasion (utils/virtualEvents.ts), or null for one that belongs to nobody in particular. */
export function occasionPersonKey(ev: { kind: string; sourceId: string }): string | null {
  switch (ev.kind) {
    case 'birthday':
    case 'nameDay':
      return hiddenKey.member(ev.sourceId);
    case 'extendedBirthday':
      return hiddenKey.extended(ev.sourceId);
    case 'petBirthday':
      return hiddenKey.pet(ev.sourceId);
    default:
      return null;
  }
}

// --- Hidden from chosen accounts (HubSettings.hiddenDatePeopleFor) ----------
//
// Written by an admin, read by everybody: the settings doc is readable by the
// whole family, so a ticked account's app can see that an entry names it and
// honour it — and can SAY so in its own "Hidden dates" list in Settings.
// That is deliberate. A birthday that silently vanishes from one
// person's calendar is a mystery at best and a covert act at worst; this
// feature hides dates, never the fact of hiding them from the person it
// affects. Accounts that are not ticked are not shown the entry at all
// (hiddenRows below) — for them nothing is hidden, so there is nothing to
// explain.

/** A uid list off a Firestore doc: strings only, no blanks, no repeats. Anything else is dropped, never guessed at. */
export function cleanForUids(uids: unknown): string[] {
  if (!Array.isArray(uids)) return [];
  const out: string[] = [];
  for (const u of uids) if (typeof u === 'string' && u && !out.includes(u)) out.push(u);
  return out;
}

/**
 * The entries of the chosen-accounts list that hide someone from THIS account,
 * as plain HiddenDatePerson values ready for buildHiddenPeople. No uid (signed
 * out, or a feed link whose creator can't be read) → nothing: an entry only
 * ever applies to an account it names.
 */
export function hiddenForAccount(
  list: ReadonlyArray<HiddenDatePersonFor> | undefined | null,
  uid: string | null | undefined,
): HiddenDatePerson[] {
  if (!uid || !Array.isArray(list)) return [];
  const out: HiddenDatePerson[] = [];
  for (const e of list) {
    if (!e || typeof e.id !== 'string' || !e.id) continue;
    if (!cleanForUids(e.forUids).includes(uid)) continue;
    out.push({ id: e.id, name: typeof e.name === 'string' ? e.name : '', hiddenAt: e.hiddenAt, ...(e.by ? { by: e.by } : {}) });
  }
  return out;
}

/** Every list that counts for one account, in the order buildHiddenPeople takes them. */
export function accountHiddenLists(input: {
  personal?: HiddenDatePerson[] | null;
  family?: HiddenDatePerson[] | null;
  forSome?: HiddenDatePersonFor[] | null;
  uid: string | null | undefined;
}): (HiddenDatePerson[] | undefined)[] {
  return [input.personal || undefined, input.family || undefined, hiddenForAccount(input.forSome, input.uid)];
}

/**
 * Hide a person from more accounts. Already hidden from some → the new uids
 * are ADDED to theirs (hiding Nora from Ben as well never shows her to Papa
 * again). No uids → the list comes back unchanged.
 */
export function withHiddenFor(
  list: HiddenDatePersonFor[] | undefined,
  person: HiddenDatePerson,
  uids: readonly string[],
): HiddenDatePersonFor[] {
  const cur = list || [];
  const add = cleanForUids(uids);
  if (!add.length) return cur;
  const i = cur.findIndex((e) => e.id === person.id);
  if (i < 0) return [...cur, { ...person, forUids: add }];
  const have = cleanForUids(cur[i].forUids);
  const fresh = add.filter((u) => !have.includes(u));
  if (!fresh.length) return cur;
  return cur.map((e, j) => (j === i ? { ...e, forUids: [...have, ...fresh] } : e));
}

/**
 * "Change who": set exactly who a person is hidden from. Everything else about
 * the entry — when it was hidden, by whom — is kept. Nobody left → the entry
 * is removed, because an entry that hides from nobody is just noise that a
 * later reader has to reason about. Not on the list → unchanged.
 */
export function withHiddenForOnly(
  list: HiddenDatePersonFor[] | undefined,
  key: string,
  uids: readonly string[],
): HiddenDatePersonFor[] {
  const cur = list || [];
  if (!cur.some((e) => e.id === key)) return cur;
  const only = cleanForUids(uids);
  if (!only.length) return cur.filter((e) => e.id !== key);
  return cur.map((e) => (e.id === key ? { ...e, forUids: only } : e));
}

/**
 * Show a person again. With `uid`: to that one account only (an admin who was
 * ticked showing them again for themselves); the entry goes when nobody is
 * left on it. Without: to everyone it was hidden from.
 */
export function withoutHiddenFor(
  list: HiddenDatePersonFor[] | undefined,
  key: string,
  uid?: string,
): HiddenDatePersonFor[] {
  const cur = list || [];
  if (uid === undefined) return cur.filter((e) => e.id !== key);
  const entry = cur.find((e) => e.id === key);
  if (!entry) return cur;
  return withHiddenForOnly(cur, key, cleanForUids(entry.forUids).filter((u) => u !== uid));
}

// --- "Change who": replace how a person is hidden (v356) --------------------
//
// Hiding again only ever ADDS (withHidden, withHiddenFor). "Change who" is the
// other verb: the admin says how this person should be hidden NOW, and every
// list the admin may change is made to say exactly that — so going from "Just
// for you" to "Hidden from Papa" is one choice, not "Show again" and start
// over. Other accounts' own lists (prefs/{uid}) are private to them: nothing
// here reads or touches them, and a person another account hid for itself
// stays hidden for that account whatever the admin picks.

/** What "Change who" sets a person to: one of the three scopes, and with 'some' exactly which accounts. */
export type RehideChoice = { scope: 'me' } | { scope: 'family' } | { scope: 'some'; forUids: string[] };

/** The three lists one admin's app can change: its own, the family's, and the chosen-accounts list. */
export interface HiddenLists {
  personal: HiddenDatePerson[];
  family: HiddenDatePerson[];
  forSome: HiddenDatePersonFor[];
}

/**
 * The lists after "Change who". The person ends up on exactly the list the
 * choice implies and off the other two:
 *   * 'me'     → on `personal`; off `family` and `forSome`;
 *   * 'family' → on `family`; off `personal` and `forSome`;
 *   * 'some'   → a `forSome` entry naming exactly `forUids`; off `family` and
 *                `personal`. (If `forUids` names `me`, they are still hidden
 *                from me — through the entry, not my own list.)
 * `person` is what to write on a list they are new to (`by` becomes `me`); on
 * a list they are already on, their entry is kept. 'some' with nobody ticked
 * changes nothing — "Show again" is how a hide ends, never an empty choice.
 * A list that doesn't change comes back as the same array, so a caller can
 * tell which saves it actually needs. Every other person is untouched.
 */
export function rehide(
  current: { personal?: HiddenDatePerson[] | null; family?: HiddenDatePerson[] | null; forSome?: HiddenDatePersonFor[] | null },
  person: HiddenDatePerson,
  choice: RehideChoice,
  me: string | null | undefined,
): HiddenLists {
  const personal = current.personal || [];
  const family = current.family || [];
  const forSome = current.forSome || [];
  const key = person.id;
  const entry: HiddenDatePerson = { ...person, ...(me ? { by: me } : {}) };
  const off = <T extends { id: string }>(list: T[]): T[] => (list.some((p) => p?.id === key) ? list.filter((p) => p?.id !== key) : list);
  if (choice.scope === 'me') return { personal: withHidden(personal, entry), family: off(family), forSome: off(forSome) };
  if (choice.scope === 'family') return { personal: off(personal), family: withHidden(family, entry), forSome: off(forSome) };
  const uids = cleanForUids(choice.forUids);
  if (!uids.length) return { personal, family, forSome };
  const had = forSome.find((e) => e?.id === key);
  const have = had ? cleanForUids(had.forUids) : null;
  const same = !!have && have.length === uids.length && uids.every((u) => have.includes(u));
  const nextFor = !had ? withHiddenFor(forSome, entry, uids) : same ? forSome : withHiddenForOnly(forSome, key, uids);
  return { personal: off(personal), family: off(family), forSome: nextFor };
}

/**
 * Which save goes first. The personal list and the settings doc are two
 * writes that can't share a transaction, so the one that ADDS the person to
 * their new place goes first and the one that takes them off the old place
 * second: if the second fails, they are hidden from everyone the new choice
 * says AND still by the old list — more hidden, never less. (The family list
 * and the chosen-accounts list are one settings save, so between those two
 * there is no in-between at all.)
 */
export function rehideOrder(choice: RehideChoice): readonly ['personal', 'settings'] | readonly ['settings', 'personal'] {
  return choice.scope === 'me' ? ['personal', 'settings'] as const : ['settings', 'personal'] as const;
}

/**
 * How a row is hidden now, as "Change who" should open on it: the family list
 * wins (nobody sees them); then a chosen-accounts entry with its accounts
 * ticked — plus this account if its own list hides them too, since that is
 * who doesn't see them today; otherwise "Just for me".
 */
export function rowChoice(row: HiddenListRow | undefined, me: string | null | undefined): RehideChoice {
  if (!row) return { scope: 'me' };
  if (row.scopes.includes('family')) return { scope: 'family' };
  if (row.scopes.includes('some')) {
    const uids = cleanForUids(row.forUids);
    return { scope: 'some', forUids: row.scopes.includes('me') && me && !uids.includes(me) ? [...uids, me] : uids };
  }
  return { scope: 'me' };
}

/**
 * Who "Choose who" starts with ticked. A new hide: nobody — it never guesses
 * who you meant. "Change who": whoever doesn't see them now — the accounts on
 * the entry; you, for "Just for me"; every account, for "Everyone" — so
 * switching to "Choose who" starts from the truth and one untick or one tick
 * is the whole change, never an accidental show-again.
 */
export function startingTicks(now: RehideChoice | null, me: string | null | undefined, allUids: readonly string[]): string[] {
  if (!now) return [];
  if (now.scope === 'some') return cleanForUids(now.forUids);
  if (now.scope === 'me') return me ? [me] : [];
  return cleanForUids(allUids);
}

/** The two lists on the settings doc that "Change who" rewrites in one save. */
export type SettingsHiddenLists = Pick<HiddenLists, 'family' | 'forSome'>;

// --- The "Show again" list ----------------------------------------------------

export interface HiddenListRow {
  person: HiddenDatePerson;
  scopes: HiddenScope[];
  /** With scope 'some': the accounts this person is hidden from. */
  forUids?: string[];
}

/** Does this row stop THIS account seeing the person? (A 'some' row an admin manages for others does not.) */
export function rowHidesFor(row: HiddenListRow, uid: string | null | undefined): boolean {
  if (row.scopes.includes('me') || row.scopes.includes('family')) return true;
  return !!uid && row.scopes.includes('some') && (row.forUids || []).includes(uid);
}

/**
 * One row per hidden person for the "Show again" list, saying which list(s)
 * hide them. The chosen-accounts list is shown to an admin in full (`manage`
 * — they are the ones who change it) and to anyone else only where it names
 * them: "hidden for you by the family", so a missing birthday is never a
 * mystery. An account an entry does not name sees nothing of it.
 */
export function hiddenRows(
  personal: HiddenDatePerson[] | undefined,
  family: HiddenDatePerson[] | undefined,
  some?: { list: HiddenDatePersonFor[] | undefined; uid: string | null | undefined; manage: boolean },
): HiddenListRow[] {
  const rows = new Map<string, HiddenListRow>();
  for (const p of personal || []) if (p?.id) rows.set(p.id, { person: p, scopes: ['me'] });
  for (const p of family || []) {
    if (!p?.id) continue;
    const row = rows.get(p.id);
    if (row) row.scopes.push('family');
    else rows.set(p.id, { person: p, scopes: ['family'] });
  }
  for (const e of some?.list || []) {
    if (!e?.id) continue;
    const forUids = cleanForUids(e.forUids);
    if (!forUids.length) continue;
    if (!some?.manage && !(some?.uid && forUids.includes(some.uid))) continue;
    const row = rows.get(e.id);
    if (row) { row.scopes.push('some'); row.forUids = forUids; }
    else rows.set(e.id, { person: { id: e.id, name: e.name || '', hiddenAt: e.hiddenAt, ...(e.by ? { by: e.by } : {}) }, scopes: ['some'], forUids });
  }
  return [...rows.values()].sort((a, b) => a.person.name.localeCompare(b.person.name));
}

// --- Who can be ticked --------------------------------------------------------

/** A sign-in account in this family, as the "Choose who" checklist shows it. */
export interface HideAccount {
  uid: string;
  /** The member it belongs to, else the account's own display name, else its email. */
  label: string;
  role: FamilyRole;
  isMe: boolean;
}

/**
 * The family's accounts (families/{id}/roles) labelled the way the family
 * knows them. An account is linked to a member by FamilyMember.linkedUid, or
 * failing that by a unique email match — utils/me.ts resolveMe, the same join
 * the greeting uses, and just as cosmetic: this only decides what a checkbox
 * says, never who may do what. Unlinked accounts fall back to the name they
 * signed up with. Admins are listed like anyone else (hiding a date from
 * another parent is the case this exists for), and so is the person ticking.
 * Your own account first, then by name, so the list doesn't reshuffle.
 */
export function hideAccounts(
  roles: Record<string, Partial<FamilyMemberRole> | undefined> | null | undefined,
  members: readonly FamilyMember[],
  me: string | null | undefined,
): HideAccount[] {
  const out: HideAccount[] = [];
  for (const [uid, r] of Object.entries(roles || {})) {
    if (!uid || !r || (r.role !== 'admin' && r.role !== 'member' && r.role !== 'child')) continue;
    const member = resolveMe(members, uid, r.email).member;
    const label = (member?.name || r.displayName || r.email || 'Unnamed account').trim();
    out.push({ uid, label, role: r.role, isMe: uid === me });
  }
  return out.sort((a, b) => (a.isMe === b.isMe ? a.label.localeCompare(b.label) : a.isMe ? -1 : 1));
}

/**
 * "Hidden from Papa and Ben" — who a 'some' row hides a person from, said the
 * way an admin reads it. The reader is "you"; beyond two names it becomes a
 * count ("Hidden from you and 2 others", "Hidden from 3 people"). An account
 * no longer in the family, or not loaded yet, is still counted — the number
 * must never come out smaller than the list it describes.
 */
export function hiddenFromWords(
  forUids: readonly string[],
  accounts: readonly HideAccount[],
  me: string | null | undefined,
): string {
  const uids = cleanForUids(forUids);
  if (!uids.length) return 'Hidden from nobody';
  const mine = !!me && uids.includes(me);
  const others = uids.filter((u) => u !== me);
  const named = others.map((u) => accounts.find((a) => a.uid === u)?.label).filter((l): l is string => !!l);
  const allNamed = named.length === others.length;
  if (mine && others.length === 0) return 'Hidden from you';
  if (uids.length <= 2 && allNamed) {
    const names = mine ? ['you', ...named] : named;
    return `Hidden from ${names.join(' and ')}`;
  }
  if (mine) return `Hidden from you and ${others.length === 1 ? '1 other' : `${others.length} others`}`;
  return `Hidden from ${uids.length === 1 ? '1 person' : `${uids.length} people`}`;
}

/** Add a person to a list. Already there → the list is returned unchanged. */
export function withHidden(list: HiddenDatePerson[] | undefined, person: HiddenDatePerson): HiddenDatePerson[] {
  const cur = list || [];
  if (cur.some((p) => p.id === person.id)) return cur;
  return [...cur, person];
}

/** Take a person off a list. Nothing else about them changes. */
export function withoutHidden(list: HiddenDatePerson[] | undefined, key: string): HiddenDatePerson[] {
  return (list || []).filter((p) => p.id !== key);
}

// --- The chat assistant -----------------------------------------------------

interface ChatContextDates {
  members?: { id: string }[];
  calendar?: { title?: string; memberIds?: string[] }[];
  anniversaries?: { memberIds?: string[]; title?: string }[];
  extendedBirthdays?: { id: string }[];
}

/**
 * The assistant's copy of FAMILY DATA with every one of a hidden person's
 * dates marked `datesHidden: true` — the member or extended-birthday record,
 * the anniversaries that involve them, the calendar entries that are their
 * birthday or anniversary. Nothing is removed: asked directly ("when is
 * Nora's birthday?") the assistant can still answer. server.js's HIDDEN DATES
 * rule is what keeps it from volunteering them. Returns `ctx` itself when
 * nobody is hidden.
 */
export function markHiddenDatesForChat<C extends ChatContextDates>(ctx: C, hp: HiddenPeople): C {
  if (!hp.keys.size) return ctx;
  const mark = <T extends object>(list: T[] | undefined, isHidden: (x: T) => boolean): T[] | undefined =>
    list?.map((x) => (isHidden(x) ? { ...x, datesHidden: true } : x));
  return {
    ...ctx,
    members: mark(ctx.members, (m) => hp.keys.has(hiddenKey.member(m.id))),
    calendar: mark(ctx.calendar, (e) => eventIsHiddenDate(e, hp)),
    anniversaries: mark(ctx.anniversaries, (a) => anniversaryIsHidden(a, hp)),
    extendedBirthdays: mark(ctx.extendedBirthdays, (e) => hp.keys.has(hiddenKey.extended(e.id))),
  };
}
