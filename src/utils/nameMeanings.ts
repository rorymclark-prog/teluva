import { FamilyMember, NameMeaning, SurnameMeaning } from '../types';
import { splitNameTokens } from './nameDay';

// ---------------------------------------------------------------------------
// Name meanings — what a person's names MEAN, as opposed to when they are
// celebrated (utils/nameCelebrations.ts).
//
// THE ONE STRUCTURAL DECISION, and everything here follows from it: given names
// live on the member, the surname lives once per space. A surname is shared by
// definition — four people called Clark are one etymology, not four — so
// copying it onto each member would mean researching the same name four times
// and letting four copies of one fact drift apart. Given names genuinely are
// the person's own, so they stay with them.
//
// The join is by lower-cased surname text, not by member id, because that is
// what actually makes two people share a name. It also means a family with more
// than one surname (step-families, a partner who kept their name, a child
// carrying both) works without a special case.
// ---------------------------------------------------------------------------

export const surnameKey = (token: string) => token.trim().toLowerCase();

/**
 * The name parts we would ask about for this member, in the order they appear
 * in their name. Nickname is deliberately NOT included: a nickname is a name
 * the family gave, and looking up "what Mimi means" would answer about a
 * stranger's name rather than about the person.
 */
export function nameTokensFor(member: Pick<FamilyMember, 'name'>): string[] {
  return splitNameTokens(member.name);
}

/**
 * Everything known about this member's names, given names and surname together,
 * in the order the names appear — which is the order a person reads them out.
 *
 * `surnameMeanings` comes from the space-level FamilyInfo doc. A member whose
 * surname has not been researched simply has no family-role entry; that is the
 * honest state, not a gap to fill with a guess.
 */
export function meaningsFor(
  member: Pick<FamilyMember, 'name' | 'nameMeanings'>,
  surnameMeanings: SurnameMeaning[] = [],
): NameMeaning[] {
  const own = (member.nameMeanings || []).filter((m) => m.confirmed);
  const byKey = new Map(surnameMeanings.filter((s) => s.confirmed).map((s) => [s.key, s]));

  const out: NameMeaning[] = [];
  const seen = new Set<string>();
  for (const token of nameTokensFor(member)) {
    const key = surnameKey(token);
    if (seen.has(key)) continue;      // "Anna Anna" is not two lookups
    seen.add(key);

    // The member's own entry wins for a token they hold themselves — that is
    // the only place a 'given'/'middle' meaning can live. Only when they have
    // none do we look for a surname entry, so a person whose FIRST name happens
    // to match somebody's surname can never be shown the wrong etymology.
    const mine = own.find((m) => surnameKey(m.token) === key);
    if (mine) { out.push(mine); continue; }
    const shared = byKey.get(key);
    if (shared) out.push(shared);
  }
  return out;
}

/** Which of this member's name parts nobody has looked up yet. */
export function unresearchedTokens(
  member: Pick<FamilyMember, 'name' | 'nameMeanings'>,
  surnameMeanings: SurnameMeaning[] = [],
): string[] {
  const known = new Set(meaningsFor(member, surnameMeanings).map((m) => surnameKey(m.token)));
  const seen = new Set<string>();
  return nameTokensFor(member).filter((t) => {
    const key = surnameKey(t);
    if (known.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fold newly-confirmed meanings into the two stores at once, since one research
 * call answers about both.
 *
 * Returns the member's own list and the space's surname list SEPARATELY,
 * because they are saved through different paths (onPatchMember vs
 * saveFamilyInfo) and merging them into one blob here would be the first step
 * towards a single store that has to know about both.
 *
 * Re-confirming a name REPLACES its entry rather than appending: a family that
 * looks up "Clark" twice wants the newer answer, not two rows saying almost the
 * same thing. Match is on the token, case-insensitively.
 */
export function foldMeanings(
  existingOwn: NameMeaning[],
  existingSurnames: SurnameMeaning[],
  incoming: NameMeaning[],
): { own: NameMeaning[]; surnames: SurnameMeaning[] } {
  const own = [...existingOwn];
  const surnames = [...existingSurnames];

  for (const m of incoming) {
    if (!m.token.trim() || !m.meaning.trim()) continue;
    if (m.role === 'family') {
      const entry: SurnameMeaning = { ...m, role: 'family', key: surnameKey(m.token) };
      const at = surnames.findIndex((s) => s.key === entry.key);
      if (at >= 0) surnames[at] = entry; else surnames.push(entry);
    } else {
      const at = own.findIndex((o) => surnameKey(o.token) === surnameKey(m.token));
      if (at >= 0) own[at] = m; else own.push(m);
    }
  }
  return { own, surnames };
}

/** Human label for the role chip, in the family's words rather than the schema's. */
export function roleLabel(role: NameMeaning['role']): string {
  if (role === 'family') return 'Family name';
  if (role === 'middle') return 'Second name';
  return 'First name';
}

/**
 * How sure the app is allowed to sound. Rendered next to EVERY meaning — a
 * derivation stated flat, with no hedge, is the app asserting folk etymology as
 * fact about someone's own family, which is the specific failure this exists to
 * stop.
 */
export function confidenceLabel(confidence: NameMeaning['confidence']): string {
  if (confidence === 'established') return 'Well established';
  if (confidence === 'contested') return 'Sources disagree';
  return 'Most likely';
}
