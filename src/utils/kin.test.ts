import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DepartedRelative, ExtendedBirthday, FamilyMember, KinLink } from '../types';
import {
  ancestorsOf, buildKinGraph, buildPeople, childrenOf, connectedTo, describeKinLink,
  descendantsOf, findKinCycles, generations, grandparentsOf, kinLifespan, kinLinkProblem,
  kinName, kinRef, normName, parentsOf, parseKinRef, partnersOf, resolveKinLinks,
  siblingsOf, yearFromLooseDate,
} from './kin';

// The family tree's data model. The three things worth breaking a build over:
//
//   1. PEOPLE COME FROM THREE STORES. A tree of only the people living in this
//      house is not a family tree — the grandparents are in Extended Birthdays
//      and the great-grandparents are in In Memory.
//   2. RELATIONSHIPS ARE DERIVED, NOT STORED. Siblings and grandparents fall
//      out of parent edges. Store them and the day someone adds a parent, the
//      stored copy is wrong with nothing to notice.
//   3. A CYCLE MUST BE REFUSED AT ENTRY. Nothing in the UI stops a family
//      picking their grandfather as their son, and a tree with a loop has no
//      top to draw from.

const member = (id: string, name: string, extra: Partial<FamilyMember> = {}): FamilyMember => ({
  id, name, role: 'Parent', avatarColor: 'bg-blue-500', clothingSizes: {}, documents: [], ...extra,
} as FamilyMember);

const ext = (id: string, name: string, extra: Partial<ExtendedBirthday> = {}): ExtendedBirthday => ({
  id, name, date: '03-12', createdAt: '2026-01-01', ...extra,
});

const dep = (id: string, name: string, extra: Partial<DepartedRelative> = {}): DepartedRelative => ({
  id, name, relation: 'Grandmother', documents: [], notes: [], createdAt: '2026-01-01', ...extra,
});

const link = (id: string, kind: 'parent' | 'partner', from: string, to: string, extra: Partial<KinLink> = {}): KinLink =>
  ({ id, kind, from, to, ...extra });

// A four-generation household, spanning all three stores.
const MEMBERS = [
  member('m1', 'Rory Clark', { gender: 'Male', birthdate: '1985-04-02' }),
  member('m2', 'Maria Clark', { gender: 'Female', birthdate: '1987-09-14', spouse: 'Rory Clark' }),
  member('m3', 'Maya Clark', { role: 'Child', gender: 'Female', birthdate: '2015-06-01' }),
  member('m4', 'Ben Clark', { role: 'Child', gender: 'male', birthdate: '2018-02-20' }),
];
const EXTENDED = [ext('e1', 'Grandma Sue', { relationship: 'Grandmother', originalYear: 1958 })];
const MEMORY = [dep('d1', 'Oma Anna', { born: '12 March 1938', died: '2019' })];

const SRC = { members: MEMBERS, extendedBirthdays: EXTENDED, inMemory: MEMORY };

const LINKS: KinLink[] = [
  link('l1', 'parent', 'member:m1', 'member:m3'),
  link('l2', 'parent', 'member:m2', 'member:m3'),
  link('l3', 'parent', 'member:m1', 'member:m4'),
  link('l4', 'parent', 'member:m2', 'member:m4'),
  link('l5', 'parent', 'extended:e1', 'member:m1'),
  link('l6', 'parent', 'memory:d1', 'extended:e1'),
];

// --- refs -------------------------------------------------------------------
{
  assert.equal(kinRef('member', 'abc'), 'member:abc');
  assert.deepEqual(parseKinRef('member:abc'), { kind: 'member', id: 'abc' });
  assert.deepEqual(parseKinRef('memory:d1'), { kind: 'memory', id: 'd1' });
  // An id containing a colon must survive the round trip — Firestore ids are
  // opaque, and splitting on the LAST colon would corrupt one silently.
  assert.deepEqual(parseKinRef('extended:a:b'), { kind: 'extended', id: 'a:b' });
  assert.equal(parseKinRef('member:'), null);
  assert.equal(parseKinRef(':abc'), null);
  assert.equal(parseKinRef('nonsense'), null);
  assert.equal(parseKinRef('vehicle:v1'), null, 'an unknown store must not resolve to a person');
}

// --- the index spans all three stores ---------------------------------------
{
  const people = buildPeople(SRC);
  assert.equal(people.length, 6, 'members + extended + departed, or the tree is missing generations');
  const refs = people.map(p => p.ref);
  assert.ok(refs.includes('member:m1') && refs.includes('extended:e1') && refs.includes('memory:d1'),
    'all three stores must be represented, or a tree cannot reach past the people living here');

  const oma = people.find(p => p.ref === 'memory:d1')!;
  assert.equal(oma.departed, true);
  assert.equal(oma.birthYear, 1938, 'a year must be recovered from free text like "12 March 1938"');
  assert.equal(oma.deathYear, 2019);
  assert.equal(oma.source, 'In Memory');

  const sue = people.find(p => p.ref === 'extended:e1')!;
  assert.equal(sue.birthdayMonthDay, '03-12');
  assert.equal(sue.birthYear, 1958);
  assert.equal(sue.departed, false, 'an extended birthday is a LIVING person — the departed live in In Memory');

  const rory = people.find(p => p.ref === 'member:m1')!;
  assert.equal(rory.birthYear, 1985);
  assert.equal(rory.sex, 'M');
  assert.equal(people.find(p => p.ref === 'member:m2')!.sex, 'F');
  assert.equal(people.find(p => p.ref === 'member:m4')!.sex, 'M', 'gender is free text — matching must not be case-sensitive');
  // No gender FIELD exists on an extended birthday, but "Grandmother" is a
  // statement of sex the family typed themselves — reading it is not an
  // assumption, and discarding it exported her into a GEDCOM husband slot.
  assert.equal(sue.sex, 'F', 'a relationship word the family wrote must be read, not thrown away');
  const unknown = buildPeople({ extendedBirthdays: [ext('e9', 'Chris', { relationship: 'Family friend' })] })[0];
  assert.equal(unknown.sex, 'U', 'and a relationship that states no sex stays unknown rather than defaulting');

  // A MEMBER who simply never filled the field in. Defaulting that to a sex
  // would put an invented fact in a GEDCOM file that gets merged into other
  // people's trees.
  const blank = buildPeople({ members: [member('mx', 'No Gender Given')] })[0];
  assert.equal(blank.sex, 'U', 'an unanswered gender field is unknown, not a default');
  assert.equal(buildPeople({ members: [member('my', 'Odd', { gender: 'nonbinary' })] })[0].sex, 'U',
    'a gender the M/F mapping does not recognise is unknown rather than forced into a slot');
}

// --- loose years ------------------------------------------------------------
{
  assert.equal(yearFromLooseDate('1938'), 1938);
  assert.equal(yearFromLooseDate('12 March 1938'), 1938);
  assert.equal(yearFromLooseDate('spring of 2019'), 2019);
  assert.equal(yearFromLooseDate(''), undefined);
  assert.equal(yearFromLooseDate('sometime in the war'), undefined,
    'no year in the text means no year — never a guess');
  assert.equal(yearFromLooseDate('aged 87'), undefined, 'a two-digit number is not a year');
}

// --- the walks --------------------------------------------------------------
{
  const g = buildKinGraph(SRC, LINKS);
  assert.deepEqual(parentsOf(g, 'member:m3').sort(), ['member:m1', 'member:m2']);
  assert.deepEqual(childrenOf(g, 'member:m1').sort(), ['member:m3', 'member:m4']);

  assert.deepEqual(siblingsOf(g, 'member:m3'), ['member:m4'],
    'siblings are DERIVED from shared parents — nothing stores them');
  assert.deepEqual(siblingsOf(g, 'member:m1'), [], 'an only child has no siblings, not an error');

  assert.deepEqual(grandparentsOf(g, 'member:m3'), ['extended:e1'],
    'a grandparent is a parent of a parent, and lives in a different store entirely');
  assert.deepEqual(ancestorsOf(g, 'member:m3').sort(),
    ['extended:e1', 'member:m1', 'member:m2', 'memory:d1'],
    'the walk must cross every store to reach the great-grandmother');
  assert.deepEqual(descendantsOf(g, 'memory:d1').sort(),
    ['extended:e1', 'member:m1', 'member:m3', 'member:m4']);
}

// --- a sibling added later appears without anything being re-saved ----------
{
  const withThird = [...MEMBERS, member('m5', 'Nina Clark', { role: 'Child' })];
  const g = buildKinGraph({ ...SRC, members: withThird }, [
    ...LINKS, link('l7', 'parent', 'member:m1', 'member:m5'), link('l8', 'parent', 'member:m2', 'member:m5'),
  ]);
  assert.deepEqual(siblingsOf(g, 'member:m3').sort(), ['member:m4', 'member:m5'],
    'the whole reason siblings are derived: adding a child must not leave an older stored list wrong');
}

// --- half-siblings ----------------------------------------------------------
{
  const g = buildKinGraph(
    { members: [...MEMBERS, member('m6', 'Tom'), member('m7', 'Half')] },
    [
      link('a', 'parent', 'member:m1', 'member:m3'),
      link('b', 'parent', 'member:m2', 'member:m3'),
      link('c', 'parent', 'member:m1', 'member:m7'),
      link('d', 'parent', 'member:m6', 'member:m7'),
    ],
  );
  assert.deepEqual(siblingsOf(g, 'member:m3'), ['member:m7'],
    'one shared parent is enough — a half-sibling is a sibling, and the tree does not editorialise');
}

// --- generations ------------------------------------------------------------
{
  const g = buildKinGraph(SRC, [...LINKS, link('p1', 'partner', 'member:m1', 'member:m2', { status: 'married' })]);
  const gen = generations(g, 'member:m1');
  assert.equal(gen.get('member:m1'), 0);
  assert.equal(gen.get('member:m2'), 0, 'a partner sits on the same row');
  assert.equal(gen.get('member:m3'), 1);
  assert.equal(gen.get('extended:e1'), -1);
  assert.equal(gen.get('memory:d1'), -2, 'four generations must land on four rows');
  assert.equal(gen.get('member:m4'), 1);
}
{
  // Someone reachable only THROUGH a marriage still gets a row.
  const g = buildKinGraph(
    { members: [member('a', 'A'), member('b', 'B')], extendedBirthdays: [ext('x', 'B’s mother')] },
    [link('p', 'partner', 'member:a', 'member:b'), link('q', 'parent', 'extended:x', 'member:b')],
  );
  const gen = generations(g, 'member:a');
  assert.equal(gen.get('extended:x'), -1, 'a partner’s mother is a generation up, reached across the marriage');
}
{
  const g = buildKinGraph(SRC, LINKS);
  const gen = generations(g, 'member:m1');
  // Co-parenthood alone is a path: Rory → Maya → Maya's other parent.
  assert.equal(gen.get('member:m2'), 0,
    'the other parent of a shared child must land on the same row, marriage recorded or not');

  // Someone with no edges at all has no place in the layout. Guessing one —
  // dropping them next to the root because they live in the same house — is
  // how a tree starts asserting relationships nobody entered.
  const lone = buildKinGraph({ ...SRC, members: [...MEMBERS, member('m9', 'Nobody')] }, LINKS);
  assert.equal(generations(lone, 'member:m1').has('member:m9'), false,
    'an unconnected person must be left out of the layout, not placed by guesswork');

  assert.deepEqual(generations(g, 'member:nope').size, 0, 'an unknown root yields nothing, not a crash');
  assert.ok(connectedTo(g, 'member:m1').has('memory:d1'));
}

// --- the spouse merge -------------------------------------------------------
// member.spouse is free text (v245). Where it names someone on file, the tree
// must already know — the family should not have to enter that marriage twice.
{
  const people = buildPeople(SRC);
  const links = resolveKinLinks([], people, MEMBERS);
  const partner = links.filter(l => l.kind === 'partner');
  assert.equal(partner.length, 1, 'Maria’s spouse field names Rory, who is on file — that is a partnership');
  assert.equal(partner[0].derivedFrom, 'Maria Clark’s profile',
    'a derived link must say where it came from, so the UI can refuse to delete it and point at the profile instead');
  assert.deepEqual([partner[0].from, partner[0].to].sort(), ['member:m1', 'member:m2']);
}
{
  // A stored link WINS. Once the family has said "married, since 1994" in the
  // tree, a name match must not shadow it with a bare duplicate.
  const people = buildPeople(SRC);
  const stored = [link('s1', 'partner', 'member:m1', 'member:m2', { status: 'married' })];
  const links = resolveKinLinks(stored, people, MEMBERS);
  const partner = links.filter(l => l.kind === 'partner');
  assert.equal(partner.length, 1, 'the derived link must not duplicate a stored one');
  assert.equal(partner[0].status, 'married');
  assert.equal(partner[0].derivedFrom, undefined, 'the stored link is the one that survives, with its detail intact');
}
{
  // Direction must not matter: the pair is the same pair either way round.
  const people = buildPeople(SRC);
  const stored = [link('s1', 'partner', 'member:m2', 'member:m1')];
  assert.equal(resolveKinLinks(stored, people, MEMBERS).filter(l => l.kind === 'partner').length, 1,
    'a partnership is undirected — storing it the other way round must still suppress the derived copy');
}
{
  // A spouse who is NOT on file — the ordinary case the free-text field exists for.
  const members = [member('m1', 'Rory Clark', { spouse: 'Someone Not In The Vault' })];
  assert.equal(resolveKinLinks([], buildPeople({ members }), members).length, 0,
    'a spouse who is not a person on file produces no edge, and no phantom person');
}
{
  // TWO people with the same name is ambiguous, and ambiguity is not a licence
  // to pick — the same rule the pet health log follows.
  const members = [
    member('m1', 'Rory Clark', { spouse: 'Maria Clark' }),
    member('m2', 'Maria Clark'),
    member('m3', 'Maria Clark'),
  ];
  assert.equal(resolveKinLinks([], buildPeople({ members }), members).length, 0,
    'two people share that name, so which marriage is meant is unknowable — draw nothing');
}
{
  const members = [member('m1', 'Rory Clark', { spouse: '  rory   clark ' })];
  assert.equal(resolveKinLinks([], buildPeople({ members }), members).length, 0,
    'a spouse field naming its own owner must not create a self-marriage');
  assert.equal(normName('  Rory   Clark '), 'rory clark');
}
{
  // Deleting a person must not leave an edge hanging off the side of the tree.
  const people = buildPeople({ members: [member('m1', 'A')] });
  const links = resolveKinLinks([link('l', 'parent', 'member:m1', 'member:GONE')], people, []);
  assert.equal(links.length, 0, 'a link to someone no longer on file must be dropped, not drawn to nowhere');
}

// --- refusing a bad link ----------------------------------------------------
{
  const g = buildKinGraph(SRC, LINKS);
  assert.equal(kinLinkProblem({ kind: 'parent', from: 'member:m1', to: 'member:m3' }, g)?.includes('already a parent'), true);
  assert.match(kinLinkProblem({ kind: 'parent', from: 'member:m1', to: 'member:m1' }, g) || '', /own parent or partner/);
  assert.match(kinLinkProblem({ kind: 'parent', from: 'member:m1', to: 'member:ghost' }, g) || '', /no longer on file/);
  assert.match(kinLinkProblem({ kind: 'parent', from: '', to: 'member:m3' }, g) || '', /Pick two people/);

  // THE CYCLE. Maya is Rory's daughter; making Maya Rory's mother would make
  // her her own great-grandmother, and the drawn tree would have no top.
  const problem = kinLinkProblem({ kind: 'parent', from: 'member:m3', to: 'member:m1' }, g);
  assert.match(problem || '', /wrong way round/,
    'a direct reversal must be caught, and named as a reversal rather than an abstract error');

  // A longer loop: the great-grandmother made a descendant of her own great-grandchild.
  const deep = kinLinkProblem({ kind: 'parent', from: 'member:m3', to: 'memory:d1' }, g);
  assert.match(deep || '', /own ancestor/, 'a cycle three edges long must be caught too, not just a direct swap');

  // Legitimate additions are not blocked.
  assert.equal(kinLinkProblem({ kind: 'parent', from: 'member:m2', to: 'member:m3' }, buildKinGraph(SRC, [LINKS[0]])), null);
  assert.equal(kinLinkProblem({ kind: 'partner', from: 'member:m3', to: 'member:m4' }, g), null,
    'two people with no partnership recorded between them may be linked');

  // Rory and Maria are already partners — via MARIA'S PROFILE, which nobody
  // drew on this screen. "Already recorded" with no explanation would read as
  // a bug, so the refusal has to point at the field that says it.
  assert.match(kinLinkProblem({ kind: 'partner', from: 'member:m1', to: 'member:m2' }, g) || '',
    /Maria Clark’s profile/,
    'a refusal caused by a profile field must name that field, or the app looks broken');
}
{
  // Step-parents mean a child can legitimately have more than two parents.
  const g = buildKinGraph(SRC, LINKS);
  assert.equal(kinLinkProblem({ kind: 'parent', from: 'extended:e1', to: 'member:m3' }, g), null,
    'a third parent must be allowed — step and adoptive families are not an error state');
}
{
  const g = buildKinGraph(SRC, [...LINKS, link('p', 'partner', 'member:m1', 'member:m2')]);
  assert.match(kinLinkProblem({ kind: 'partner', from: 'member:m2', to: 'member:m1' }, g) || '', /already recorded as partners/,
    'the duplicate check must be direction-blind');
}

// --- surviving a cycle that is already in the data --------------------------
{
  // The guard is new; a document written before it could hold a loop. Every
  // walk must terminate anyway, or one bad edge takes the whole screen down.
  const g = buildKinGraph({ members: [member('a', 'A'), member('b', 'B')] }, [
    link('x', 'parent', 'member:a', 'member:b'),
    link('y', 'parent', 'member:b', 'member:a'),
  ]);
  assert.deepEqual(ancestorsOf(g, 'member:a').sort(), ['member:a', 'member:b'],
    'a cyclic ancestor walk must terminate rather than hang the view');
  assert.deepEqual(descendantsOf(g, 'member:a').sort(), ['member:a', 'member:b']);
  assert.equal(generations(g, 'member:a').size, 2, 'the layout walk must terminate too');
  assert.deepEqual(findKinCycles(g).sort(), ['member:a', 'member:b'],
    'and the bad data must be reportable, so it can be repaired rather than merely survived');
  assert.deepEqual(findKinCycles(buildKinGraph(SRC, LINKS)), [], 'clean data reports nothing');
}

// --- self-links and duplicates in stored data -------------------------------
{
  const g = buildKinGraph({ members: [member('a', 'A')] }, [link('x', 'parent', 'member:a', 'member:a')]);
  assert.deepEqual(parentsOf(g, 'member:a'), [], 'a self-parent already in the document must be ignored, not drawn');
}
{
  const g = buildKinGraph({ members: [member('a', 'A'), member('b', 'B')] }, [
    link('x', 'parent', 'member:a', 'member:b'),
    link('y', 'parent', 'member:a', 'member:b'),
  ]);
  assert.deepEqual(parentsOf(g, 'member:b'), ['member:a'], 'a duplicated edge must not double the parent');
  assert.deepEqual(childrenOf(g, 'member:a'), ['member:b']);
}

// --- words on screen --------------------------------------------------------
{
  const g = buildKinGraph(SRC, LINKS);
  assert.equal(kinName('member:m1', g.index), 'Rory Clark');
  assert.equal(kinName('member:gone', g.index), 'Someone no longer on file',
    'a dangling ref must read as a plain fact, never as "undefined"');

  assert.match(describeKinLink(link('l', 'parent', 'member:m1', 'member:m3'), g.index), /Rory Clark — parent of Maya Clark/);
  assert.match(describeKinLink(link('l', 'parent', 'member:m1', 'member:m3', { via: 'adoptive' }), g.index), /adoptive parent of/);
  assert.match(describeKinLink(link('l', 'partner', 'member:m1', 'member:m2', { status: 'married' }), g.index), /^Married —/);

  assert.equal(kinLifespan(buildPeople(SRC).find(p => p.ref === 'memory:d1')!), '1938–2019');
  assert.equal(kinLifespan(buildPeople(SRC).find(p => p.ref === 'member:m1')!), 'b. 1985');
  assert.equal(kinLifespan({ ref: 'x', kind: 'member', id: 'x', name: 'X', departed: false, sex: 'U', source: 'Family' }), '');
}

// --- the wiring -------------------------------------------------------------
// Source-as-text: the model above is worth nothing if the screen never reads
// it, and a silently-unwired view is exactly the failure this repo keeps
// hitting (see project_teluva_settings_not_reread).
{
  const here = path.dirname(fileURLToPath(import.meta.url));   // never .pathname — a space in the path silently no-ops
  const read = (rel: string) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

  const db = read('utils/db.ts');
  assert.ok(db.includes("saveReferenceDoc('familyTree'"), 'the tree must have a save path');
  assert.ok(db.includes("loadReferenceDoc<FamilyTreeDoc>('familyTree'"), 'and a load path');

  // NOTE THE TRAILING '(' ON EVERY ONE OF THESE. Asserting a bare identifier
  // is satisfied by the import line, so the check passes while the call it was
  // written to guard has been deleted — an assertion that cannot fail is worse
  // than no assertion, because it reads as coverage.
  const view = read('components/FamilyTreeView.tsx');
  assert.ok(view.includes('loadFamilyTree()'), 'the view must actually read the document');
  // Sliced, because `saveFamilyTree(` now has a SECOND call site in the GEDCOM
  // import path — a whole-file `includes` for it stays green with the write
  // that every hand-drawn link depends on deleted. When a function is called
  // from more than one place, slice the caller you mean.
  const persist = view.slice(view.indexOf('const persist'), view.indexOf('const addLink'));
  assert.ok(persist.length > 40 && persist.length < 400, 'the persist callback must still be the thing being sliced');
  assert.ok(persist.includes('saveFamilyTree('),
    'persist must write the document, or every edit is lost on reload');
  assert.ok(view.includes('loadExtendedBirthdays()') && view.includes('loadInMemory()') && view.includes('loadFamilyMembers()'),
    'all THREE person stores must be loaded, or the tree stops at the front door');
  assert.ok(view.includes('kinLinkProblem('), 'the view must run the guard before saving a link');
  assert.ok(view.includes('toGedcom('), 'export must be reachable from the screen, not just exist in a util');

  const dash = read('components/Dashboard.tsx');
  assert.ok(/'familyTree'/.test(dash), 'the view must be registered in the ViewId union and VIEWS list');
  // '<' deliberately: the bare name is also on the React.lazy import line, so
  // `includes('FamilyTreeView')` passes with the render deleted — a screen
  // that is registered, reachable from the menu, and draws nothing.
  assert.ok(dash.includes('<FamilyTreeView'), 'and actually rendered');

  const menu = read('components/SectionMenu.tsx');
  assert.ok(/'familyTree'/.test(menu),
    'an unlisted view falls into "More" — the tree belongs with the other Memories');
}

console.log('kin.test.ts: all assertions passed');
