import {
  DepartedRelative, ExtendedBirthday, FamilyMember, KinLink, KinPersonKind, KinRef,
} from '../types';

// ---------------------------------------------------------------------------
// The family tree: one index of everyone this app knows about, and the walks
// that turn two kinds of stored edge into every relationship a tree shows.
//
// THREE STORES, ONE INDEX. Living household members, Extended Birthdays
// (grandparents, aunts, godparents — people with a birthday worth remembering
// but no profile) and In Memory (the departed) are three separate documents
// with three separate id spaces. A tree spans all three or it is not a family
// tree, so every person here is addressed as `kind:id` and the index is the
// only place that knows which store a ref came from.
//
// STORE THE MINIMUM, DERIVE THE REST. Only 'parent' and 'partner' edges are
// ever written. Siblings, grandparents, aunts, cousins and the generation a
// person sits on are all computed from those two — because the moment a
// sibling list is STORED, adding a parent leaves it silently wrong, and
// nothing in the app is in a position to notice.
// ---------------------------------------------------------------------------

export interface KinPerson {
  ref: KinRef;
  kind: KinPersonKind;
  id: string;
  name: string;
  /** YYYY-MM-DD when we have a real one (members only). */
  birthdate?: string;
  /** 'MM-DD' — an extended birthday's recurring day, with no year. */
  birthdayMonthDay?: string;
  /** Best-effort birth year. In Memory holds free text, so this may be absent. */
  birthYear?: number;
  deathYear?: number;
  /** What the family called them relative to whoever typed it — free text. */
  relation?: string;
  /** True for anyone in the In Memory archive. */
  departed: boolean;
  /** 'M' | 'F' | 'U' — only members carry a gender field at all. */
  sex: 'M' | 'F' | 'U';
  /** Where this person is edited, in words, for the "open their record" link. */
  source: 'Family' | 'Extended birthdays' | 'In Memory';
  avatarUrl?: string;
  photoUrl?: string;
}

export const kinRef = (kind: KinPersonKind, id: string): KinRef => `${kind}:${id}`;

export function parseKinRef(ref: KinRef): { kind: KinPersonKind; id: string } | null {
  const i = ref.indexOf(':');
  if (i <= 0) return null;
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1);
  if (!id) return null;
  if (kind !== 'member' && kind !== 'extended' && kind !== 'memory') return null;
  return { kind, id };
}

/** Loose name comparison, used ONLY for the spouse merge below. */
export const normName = (s?: string): string =>
  (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A four-digit year out of free text.
 *
 * DepartedRelative.born and .died are deliberately free text — "1938",
 * "12 March 1938", "spring of '38". A tree wants a year to sort generations
 * and GEDCOM wants one to export, and a year is the one part that can be
 * recovered without inventing anything. Anything with no plausible year in it
 * returns undefined rather than a guess.
 */
export function yearFromLooseDate(text?: string): number | undefined {
  const m = (text || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (!m) return undefined;
  return Number(m[1]);
}

function sexFromGender(gender?: string): 'M' | 'F' | 'U' {
  const g = (gender || '').trim().toLowerCase();
  if (!g) return 'U';
  if (/^(m|male|man|boy|männlich|mann)\b/.test(g)) return 'M';
  if (/^(f|female|woman|girl|w|weiblich|frau)\b/.test(g)) return 'F';
  return 'U';
}

// --- Kinship words ---------------------------------------------------------
// Only members have a gender field. Everyone else — grandparents in Extended
// Birthdays, the departed in In Memory — has a RELATIONSHIP the family typed
// in their own words, and "Grandmother" is not a guess about someone's sex, it
// is a statement of it. Throwing that away and exporting SEX U put Grandma Sue
// in a GEDCOM HUSB slot, which is how it was noticed.
//
// German and Afrikaans included deliberately: this is an Austrian household
// with South African family, and "Oma"/"Ouma" are what actually get typed.

// Two lists per sex, and the split is the whole trick. A word is only safe to
// match as a SUBSTRING if it cannot appear inside a word of the other sex —
// 'gran' looks harmless until it matches 'grandfather', which is how this was
// found. Anything short or collision-prone is matched as a whole word instead.
// 'mother' inside 'grandmother'/'stepmother' and 'father' inside
// 'grandfather'/'stepfather' are both same-sex, so those stay substrings and
// every compound resolves for free.
const F_LONG = ['mother', 'mummy', 'mommy', 'grandma', 'granny', 'aunt', 'auntie', 'tante', 'tannie', 'sister', 'daughter', 'wife', 'niece', 'schwester', 'tochter', 'moeder', 'dogter', 'suster', 'vrou'];
const M_LONG = ['father', 'daddy', 'grandad', 'granddad', 'grandpa', 'uncle', 'onkel', 'brother', 'husband', 'nephew', 'widower', 'vater', 'vader', 'bruder', 'sohn', 'seun', 'broer'];
/** Whole word only: 'ma' inside 'Emma', 'oma' inside 'Thomas', 'gran' inside 'grandfather'. */
const F_EXACT = ['ma', 'mom', 'mum', 'mama', 'nan', 'nana', 'gran', 'oma', 'ouma', 'widow', 'frau'];
const M_EXACT = ['pa', 'papa', 'dad', 'son', 'bro', 'opa', 'oupa', 'oom', 'herr'];

/**
 * A sex stated by a relationship word, or 'U'.
 *
 * 'widower' is checked (as a long word) before 'widow' (as an exact one), so
 * the longer word wins rather than being eaten by its own prefix.
 */
export function sexFromKinship(text?: string): 'M' | 'F' | 'U' {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return 'U';
  if (F_LONG.some((w) => t.includes(w))) return 'F';
  if (M_LONG.some((w) => t.includes(w))) return 'M';
  const tokens = t.split(/[^a-zäöüß]+/).filter(Boolean);
  if (tokens.some((tok) => F_EXACT.includes(tok))) return 'F';
  if (tokens.some((tok) => M_EXACT.includes(tok))) return 'M';
  return 'U';
}

/**
 * The relationship first, then the name.
 *
 * "Grandma Sue" carries it in the name because that IS her name here; the
 * relationship field may be empty. Both are the family's own words, so neither
 * is an inference — and anything unrecognised stays 'U' rather than defaulting.
 */
const sexFromWords = (relation?: string, name?: string): 'M' | 'F' | 'U' => {
  const byRelation = sexFromKinship(relation);
  return byRelation !== 'U' ? byRelation : sexFromKinship(name);
};

export interface KinSources {
  members?: readonly FamilyMember[];
  extendedBirthdays?: readonly ExtendedBirthday[];
  inMemory?: readonly DepartedRelative[];
}

/** Everyone, in one list — members first, then extended, then the departed. */
export function buildPeople(src: KinSources): KinPerson[] {
  const out: KinPerson[] = [];

  for (const m of src.members || []) {
    out.push({
      ref: kinRef('member', m.id),
      kind: 'member',
      id: m.id,
      name: m.name,
      birthdate: m.birthdate,
      birthYear: m.birthdate ? Number(m.birthdate.slice(0, 4)) || undefined : undefined,
      relation: m.role,
      departed: false,
      sex: sexFromGender(m.gender),
      source: 'Family',
      avatarUrl: m.avatarUrl,
    });
  }

  for (const e of src.extendedBirthdays || []) {
    out.push({
      ref: kinRef('extended', e.id),
      kind: 'extended',
      id: e.id,
      name: e.name,
      birthdayMonthDay: e.date,
      birthYear: e.originalYear,
      relation: e.relationship,
      departed: false,
      sex: sexFromWords(e.relationship, e.name),
      source: 'Extended birthdays',
    });
  }

  for (const d of src.inMemory || []) {
    out.push({
      ref: kinRef('memory', d.id),
      kind: 'memory',
      id: d.id,
      name: d.name,
      birthYear: yearFromLooseDate(d.born),
      deathYear: yearFromLooseDate(d.died),
      relation: d.relation,
      departed: true,
      sex: sexFromWords(d.relation, d.name),
      source: 'In Memory',
      photoUrl: d.photoUrl,
    });
  }

  return out;
}

export const peopleIndex = (people: readonly KinPerson[]): Map<KinRef, KinPerson> =>
  new Map(people.map((p) => [p.ref, p]));

/** A person's display name, or a plain marker when the ref no longer resolves. */
export function kinName(ref: KinRef, index: Map<KinRef, KinPerson>): string {
  const p = index.get(ref);
  if (p) return (p.name || '').trim() || 'Unnamed';
  return 'Someone no longer on file';
}

// --- The spouse merge ------------------------------------------------------
// FamilyMember.spouse (v245) is free text, written that way on purpose: an
// adult child's husband or a grandparent's late wife is very often not in the
// vault at all, and a field that could only hold people already on file would
// be empty in exactly the cases worth recording.
//
// So when that text names someone who IS on file, the tree already knows about
// that marriage and must not ask the family to enter it a second time. This is
// a READ-SIDE merge — the same shape as withContactBirthdays — and NOT a
// second store: nothing here is ever written back, so the profile field stays
// the only home for that fact.
//
// A derived link is marked, and the UI refuses to delete it, saying where it
// comes from instead. That is the honest answer: delete it here and it would
// reappear on the next render, because the profile still says it.

export interface ResolvedKinLink extends KinLink {
  /** Set when this link was computed from a profile field, not stored. */
  derivedFrom?: string;
}

const pairKey = (a: KinRef, b: KinRef) => [a, b].sort().join('|');

/**
 * Stored links plus the partnerships implied by `member.spouse`.
 *
 * A stored link between the same two people always wins — once a family has
 * said "married, since 1994" in the tree, that is richer than a name match and
 * must not be shadowed by a duplicate.
 */
export function resolveKinLinks(
  stored: readonly KinLink[],
  people: readonly KinPerson[],
  members: readonly FamilyMember[] = [],
): ResolvedKinLink[] {
  const index = peopleIndex(people);
  // Drop links whose people are gone: deleting a member must not leave an edge
  // dangling off the side of the tree.
  const live = stored.filter((l) => index.has(l.from) && index.has(l.to));
  const seen = new Set(live.filter((l) => l.kind === 'partner').map((l) => pairKey(l.from, l.to)));

  const byName = new Map<string, KinPerson[]>();
  for (const p of people) {
    const key = normName(p.name);
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(p); else byName.set(key, [p]);
  }

  const derived: ResolvedKinLink[] = [];
  for (const m of members) {
    const target = normName(m.spouse);
    if (!target) continue;
    const matches = byName.get(target) || [];
    // AMBIGUITY IS NOT A LICENCE TO PICK. Two people on file with the same
    // name means we cannot know which one the profile meant, so the tree says
    // nothing and the family can draw the link themselves.
    if (matches.length !== 1) continue;
    const other = matches[0];
    const self = kinRef('member', m.id);
    if (other.ref === self) continue;
    const key = pairKey(self, other.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    derived.push({
      id: `derived-spouse-${m.id}`,
      kind: 'partner',
      from: self,
      to: other.ref,
      derivedFrom: `${(m.name || '').trim() || 'a'}’s profile`,
    });
  }

  return [...live, ...derived];
}

// --- The walks -------------------------------------------------------------

export interface KinGraph {
  people: KinPerson[];
  index: Map<KinRef, KinPerson>;
  links: ResolvedKinLink[];
  parents: Map<KinRef, KinRef[]>;
  children: Map<KinRef, KinRef[]>;
  partners: Map<KinRef, KinRef[]>;
}

const push = (m: Map<KinRef, KinRef[]>, k: KinRef, v: KinRef) => {
  const a = m.get(k);
  if (a) { if (!a.includes(v)) a.push(v); } else m.set(k, [v]);
};

export function buildKinGraph(src: KinSources, stored: readonly KinLink[]): KinGraph {
  const people = buildPeople(src);
  const links = resolveKinLinks(stored, people, src.members || []);
  const parents = new Map<KinRef, KinRef[]>();
  const children = new Map<KinRef, KinRef[]>();
  const partners = new Map<KinRef, KinRef[]>();

  for (const l of links) {
    if (l.from === l.to) continue;
    if (l.kind === 'parent') {
      push(parents, l.to, l.from);
      push(children, l.from, l.to);
    } else {
      push(partners, l.from, l.to);
      push(partners, l.to, l.from);
    }
  }

  return { people, index: peopleIndex(people), links, parents, children, partners };
}

export const parentsOf = (g: KinGraph, ref: KinRef): KinRef[] => g.parents.get(ref) || [];
export const childrenOf = (g: KinGraph, ref: KinRef): KinRef[] => g.children.get(ref) || [];
export const partnersOf = (g: KinGraph, ref: KinRef): KinRef[] => g.partners.get(ref) || [];

/** Anyone sharing at least one parent. Half-siblings count, and are not flagged. */
export function siblingsOf(g: KinGraph, ref: KinRef): KinRef[] {
  const out = new Set<KinRef>();
  for (const p of parentsOf(g, ref)) {
    for (const c of childrenOf(g, p)) if (c !== ref) out.add(c);
  }
  return [...out];
}

export function grandparentsOf(g: KinGraph, ref: KinRef): KinRef[] {
  const out = new Set<KinRef>();
  for (const p of parentsOf(g, ref)) for (const gp of parentsOf(g, p)) out.add(gp);
  return [...out];
}

/**
 * Every ancestor, breadth-first.
 *
 * `seen` alone bounds the walk, and the person themselves is deliberately NOT
 * excluded: in a corrupt document where someone is their own great-grandfather
 * they genuinely ARE in their own ancestor list, and that is the only signal
 * findKinCycles has to work with. Skipping the start ref to make the output
 * look tidier would leave the cycle detector unable to detect a cycle.
 */
export function ancestorsOf(g: KinGraph, ref: KinRef): KinRef[] {
  const seen = new Set<KinRef>();
  const queue = [...parentsOf(g, ref)];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...parentsOf(g, cur));
  }
  return [...seen];
}

export function descendantsOf(g: KinGraph, ref: KinRef): KinRef[] {
  const seen = new Set<KinRef>();
  const queue = [...childrenOf(g, ref)];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...childrenOf(g, cur));
  }
  return [...seen];
}

/**
 * Which row each person sits on, relative to `root` (root = 0, parents = -1,
 * children = +1, partners level with each other).
 *
 * A single BFS over all three edge types, so a person reachable only through a
 * marriage — a wife's parents, say — still gets a row. People with no path to
 * the root at all are left out; the view draws them in an "unconnected" list
 * rather than guessing where they belong.
 */
export function generations(g: KinGraph, root: KinRef): Map<KinRef, number> {
  const gen = new Map<KinRef, number>();
  if (!g.index.has(root)) return gen;
  gen.set(root, 0);
  const queue: KinRef[] = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    const level = gen.get(cur)!;
    const step = (next: KinRef, delta: number) => {
      if (gen.has(next)) return;
      gen.set(next, level + delta);
      queue.push(next);
    };
    for (const p of parentsOf(g, cur)) step(p, -1);
    for (const c of childrenOf(g, cur)) step(c, 1);
    for (const s of partnersOf(g, cur)) step(s, 0);
  }
  return gen;
}

/** Everyone reachable from `root` by any edge — one connected family. */
export function connectedTo(g: KinGraph, root: KinRef): Set<KinRef> {
  return new Set(generations(g, root).keys());
}

// --- Guarding what gets added ----------------------------------------------

/**
 * Why a proposed link cannot be added, in words the family can act on, or null.
 *
 * The cycle check is the one that matters. Nothing about the UI stops someone
 * picking their own grandfather as their son, and a tree with a cycle in it is
 * not merely wrong — every ancestor walk in this file would run forever
 * without the visited-set guards, and the drawn tree has no top. Catch it at
 * the point of entry, where the family can still see which two people they
 * just connected.
 */
export function kinLinkProblem(
  candidate: { kind: 'parent' | 'partner'; from: KinRef; to: KinRef },
  g: KinGraph,
): string | null {
  const { kind, from, to } = candidate;
  if (!from || !to) return 'Pick two people first.';
  if (from === to) return 'A person cannot be their own parent or partner.';
  if (!g.index.has(from) || !g.index.has(to)) return 'One of those people is no longer on file.';

  if (kind === 'partner') {
    if (partnersOf(g, from).includes(to)) {
      // Say WHERE it already comes from. A family who never drew this link
      // being told "already recorded" with no explanation would reasonably
      // conclude the app is broken — the fact is sitting in a profile field
      // they filled in months ago, on a different screen.
      const existing = g.links.find(
        (l) => l.kind === 'partner' && ((l.from === from && l.to === to) || (l.from === to && l.to === from)),
      );
      return existing?.derivedFrom
        ? `Already recorded — ${existing.derivedFrom} names them as the spouse. Change it there.`
        : 'They are already recorded as partners.';
    }
    return null;
  }

  if (parentsOf(g, to).includes(from)) return `${kinName(from, g.index)} is already a parent of ${kinName(to, g.index)}.`;
  if (parentsOf(g, from).includes(to)) {
    return `${kinName(to, g.index)} is already recorded as ${kinName(from, g.index)}’s parent — one of the two is the wrong way round.`;
  }
  // The child is an ancestor of the proposed parent ⇒ a loop.
  if (ancestorsOf(g, from).includes(to)) {
    return `That would make ${kinName(to, g.index)} their own ancestor. Check which way round the two are.`;
  }
  return null;
}

/** Every person who is their own ancestor — a repair list for data that predates the guard. */
export function findKinCycles(g: KinGraph): KinRef[] {
  return g.people.map((p) => p.ref).filter((ref) => ancestorsOf(g, ref).includes(ref));
}

// --- Describing an edge in the UI ------------------------------------------

const VIA_WORDS: Record<string, string> = {
  birth: '',
  adoptive: 'adoptive',
  step: 'step',
  foster: 'foster',
};

const STATUS_WORDS: Record<string, string> = {
  married: 'Married',
  partner: 'Partners',
  divorced: 'Divorced',
  widowed: 'Widowed',
};

/** e.g. "Parent of Maya", "Adoptive parent of Maya", "Married to Rory". */
export function describeKinLink(l: ResolvedKinLink, index: Map<KinRef, KinPerson>): string {
  if (l.kind === 'partner') {
    const word = STATUS_WORDS[l.status || ''] || 'Partner of';
    return l.status === 'married' || l.status === 'divorced' || l.status === 'widowed'
      ? `${word} — ${kinName(l.from, index)} & ${kinName(l.to, index)}`
      : `${kinName(l.from, index)} & ${kinName(l.to, index)}`;
  }
  const via = VIA_WORDS[l.via || 'birth'];
  const label = via ? `${via.charAt(0).toUpperCase()}${via.slice(1)} parent` : 'Parent';
  return `${kinName(l.from, index)} — ${label.toLowerCase()} of ${kinName(l.to, index)}`;
}

/** "1962–2019", "b. 1962", "d. 2019", or ''. */
export function kinLifespan(p: KinPerson): string {
  const born = p.birthYear;
  const died = p.deathYear;
  if (born && died) return `${born}–${died}`;
  if (born) return p.departed ? `b. ${born}` : `b. ${born}`;
  if (died) return `d. ${died}`;
  return '';
}
