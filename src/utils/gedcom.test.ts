import assert from 'node:assert/strict';
import { DepartedRelative, ExtendedBirthday, FamilyMember, KinLink } from '../types';
import { buildKinGraph, sexFromKinship } from './kin';
import { buildGedFamilies, gedcomDate, gedcomFilename, gedcomName, gedcomNick, gedcomSummary, toGedcom } from './gedcom';

// GEDCOM export — the reason a family's tree isn't trapped in this app.
//
// The file is read by software we will never see, so the assertions here are
// about the FORMAT holding up, not about it looking right. Two failures matter
// most: a stray '@' silently corrupting every line after it, and the
// person-centric → family-centric conversion losing a parent.

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

const SRC = {
  members: [
    member('m1', 'Rory Clark', { gender: 'Male', birthdate: '1985-04-02' }),
    member('m2', 'Maria Clark', { gender: 'Female', birthdate: '1987-09-14' }),
    member('m3', 'Maya Clark', { role: 'Child', gender: 'Female', birthdate: '2015-06-01' }),
    member('m4', 'Ben Clark', { role: 'Child', gender: 'Male', birthdate: '2018-02-20' }),
  ],
  extendedBirthdays: [ext('e1', 'Grandma Sue', { originalYear: 1958, relationship: 'Grandmother' })],
  inMemory: [dep('d1', 'Oma Anna', { born: '12 March 1938', died: '2019' })],
};
const LINKS: KinLink[] = [
  link('l1', 'parent', 'member:m1', 'member:m3'),
  link('l2', 'parent', 'member:m2', 'member:m3'),
  link('l3', 'parent', 'member:m1', 'member:m4'),
  link('l4', 'parent', 'member:m2', 'member:m4'),
  link('l5', 'parent', 'extended:e1', 'member:m1'),
  link('l6', 'parent', 'memory:d1', 'extended:e1'),
  link('l7', 'partner', 'member:m1', 'member:m2', { status: 'married' }),
];

const G = buildKinGraph(SRC, LINKS);
const FILE = toGedcom(G, { appVersion: 'v248', familyLabel: 'Clark', todayISO: '2026-08-21' });
const lines = FILE.split('\r\n');

// --- the shape of the file --------------------------------------------------
{
  assert.equal(lines[0], '0 HEAD', 'a GEDCOM file starts with HEAD or nothing will open it');
  assert.ok(FILE.includes('\r\n0 TRLR\r\n'), 'and ends with TRLR — a truncated file imports as garbage');
  assert.ok(FILE.includes('2 VERS 5.5.1'), '5.5.1 is the version everything imports');
  assert.ok(FILE.includes('1 CHAR UTF-8'), 'without CHAR, an umlaut in a surname is undefined behaviour');
  assert.ok(FILE.includes('2 FORM LINEAGE-LINKED'));
  assert.ok(FILE.includes('1 DATE 21 AUG 2026'));
  assert.ok(FILE.includes('1 NAME Clark'));

  for (const l of lines) {
    if (l === '') continue;
    assert.match(l, /^[0-9] [A-Z@]/, `every line must begin with a level and a tag — got "${l}"`);
  }
  // Levels may only ever step UP by one.
  let prev = 0;
  for (const l of lines) {
    if (l === '') continue;
    const lvl = Number(l[0]);
    assert.ok(lvl <= prev + 1, `level jumped from ${prev} to ${lvl} at "${l}" — that is a malformed record`);
    prev = lvl;
  }
}

// --- people -----------------------------------------------------------------
{
  const indi = lines.filter(l => / INDI$/.test(l));
  assert.equal(indi.length, 6, 'every person is exported, including ones with no links yet');
  assert.ok(FILE.includes('1 NAME Rory /Clark/'), 'the surname must be in slashes or importers read it as a given name');
  assert.ok(FILE.includes('1 SEX M') && FILE.includes('1 SEX F'));
  // No 'SEX U' in this fixture any more, and that is the fix: every person in
  // it has either a gender field or a relationship word that states one. The
  // unknown case is asserted on its own below.
  assert.ok(!FILE.includes('1 SEX U'),
    'a relationship the family typed states a sex — discarding it is what put a grandmother in the HUSB slot');
  assert.ok(FILE.includes('2 DATE 2 APR 1985'), 'YYYY-MM-DD must become a GEDCOM date');
  assert.ok(FILE.includes('2 DATE 1938') && FILE.includes('2 DATE 2019'),
    'a year recovered from In Memory free text is still a usable GEDCOM date');
  assert.ok(FILE.includes('1 NOTE Recorded in Teluva as: Grandmother'),
    'the family’s own word for someone must survive the export');
  assert.ok(FILE.includes('2 NICK Grandma Sue'), 'and so must the name they actually call her');
}
{
  // THE SEX A RELATIONSHIP ALREADY STATES. Only members have a gender field;
  // everyone else has a relationship the family typed. "Grandmother" is not an
  // inference about someone's sex, it is a statement of it — and discarding it
  // is what put Grandma Sue in a GEDCOM HUSB slot.
  assert.equal(sexFromKinship('Grandmother'), 'F');
  assert.equal(sexFromKinship('Great-grandmother'), 'F', 'a compound must still resolve');
  assert.equal(sexFromKinship('Grandfather'), 'M');
  assert.equal(sexFromKinship('Oma'), 'F');
  assert.equal(sexFromKinship('Oupa'), 'M', 'Afrikaans counts — this is a South African family');
  assert.equal(sexFromKinship('Onkel'), 'M');
  assert.equal(sexFromKinship('Brother'), 'M', '"brother" must not be read as containing "mother"');
  assert.equal(sexFromKinship('Godparent'), 'U', 'a word that states no sex must stay unknown');
  assert.equal(sexFromKinship('Family friend'), 'U');
  assert.equal(sexFromKinship(''), 'U');
  assert.equal(sexFromKinship('Emma'), 'U', '"ma" inside a given name is not a mother');
  assert.equal(sexFromKinship('Thomas'), 'U', 'and "ma" inside Thomas is not either');

  const g = buildKinGraph({
    extendedBirthdays: [ext('e1', 'Grandma Sue'), ext('e2', 'Bob', { relationship: 'Uncle' })],
    inMemory: [dep('d1', 'Anna', { relation: 'Great-grandmother' })],
  }, []);
  const byName = (n: string) => g.people.find(p => p.name === n)!;
  assert.equal(byName('Grandma Sue').sex, 'F', 'the name itself carries it when there is no relationship field');
  assert.equal(byName('Bob').sex, 'M', 'and the relationship field carries it when the name does not');
  assert.equal(byName('Anna').sex, 'F');
}
{
  // The whole point of the above: she must land in the WIFE slot.
  const g = buildKinGraph(
    { extendedBirthdays: [ext('e1', 'Grandma Sue')], members: [member('c', 'Child')] },
    [link('x', 'parent', 'extended:e1', 'member:c')],
  );
  const f = toGedcom(g);
  assert.match(f, /1 WIFE @I\d+@/, 'a grandmother belongs in WIFE, not HUSB');
  assert.ok(!/1 HUSB/.test(f), 'and nothing should be filling the HUSB slot at all here');
}
{
  // A recurring birthday with no year is not a GEDCOM date. It must NOT be
  // padded out to an invented year — that would put a false fact in a file
  // that gets merged into other people's trees.
  const g = buildKinGraph({ extendedBirthdays: [ext('e9', 'Auntie Jo')] }, []);
  const f = toGedcom(g);
  assert.ok(!/2 DATE/.test(f), 'no year means no BIRT DATE at all');
  assert.ok(f.includes('1 NOTE Birthday 12 MAR (year not recorded)'),
    'and the day is preserved in a note, so nothing is actually lost');
}
{
  // Known dead with no recoverable year.
  const g = buildKinGraph({ inMemory: [dep('d9', 'Great-Uncle Pete', { died: 'during the war' })] }, []);
  assert.ok(toGedcom(g).includes('1 DEAT Y'),
    'someone in the In Memory archive is known to have died — DEAT Y states that without inventing a date');
}

// --- names and dates in isolation -------------------------------------------
{
  assert.equal(gedcomName('Rory Michael Clark'), 'Rory Michael /Clark/');
  assert.equal(gedcomName('Oma'), 'Oma', 'a single name gets no empty surname slashes');
  assert.equal(gedcomName('  '), 'Unnamed');

  // A name that OPENS with a relationship word is a nickname, and the
  // last-token-is-a-surname rule invents a surname out of it. Found by reading
  // an actual exported file, where Grandma Sue had become surname "Sue".
  assert.equal(gedcomName('Grandma Sue'), 'Sue',
    'a family nickname must not manufacture a surname the family never wrote');
  assert.equal(gedcomName('Auntie Jo'), 'Jo');
  assert.equal(gedcomName('Oma Anna Müller'), 'Anna /Müller/',
    'but a real surname after the title must still be found');
  assert.equal(gedcomName('Great Aunt Margaret Hughes'), 'Margaret /Hughes/');
  assert.equal(gedcomName('Uncle Bob'), 'Bob');
  assert.equal(gedcomName('Oma'), 'Oma', 'stripping must never consume the only word left');

  // ...and the words the family actually uses are kept, not thrown away.
  assert.equal(gedcomNick('Grandma Sue'), 'Grandma Sue',
    'the name everyone recognises must survive in NICK');
  assert.equal(gedcomNick('Rory Michael Clark'), undefined, 'an unchanged name needs no nickname');
  assert.equal(gedcomNick('Oma'), undefined);
  assert.equal(gedcomDate('1985-04-02'), '2 APR 1985');
  assert.equal(gedcomDate('1985-13-02'), undefined, 'a month that cannot exist must not be exported');
  assert.equal(gedcomDate(undefined, 1938), '1938');
  assert.equal(gedcomDate('not a date'), undefined);
  assert.equal(gedcomDate(undefined, 12), undefined, 'a two-digit "year" is not a year');
}

// --- families: the person-centric → family-centric conversion ---------------
{
  const fams = buildGedFamilies(G);
  const withKids = fams.filter(f => f.children.length);
  assert.equal(withKids.length, 3, 'Maya+Ben share one family; Rory has his own; Sue has hers');

  const siblings = withKids.find(f => f.children.length === 2)!;
  assert.deepEqual(siblings.parents.sort(), ['member:m1', 'member:m2']);
  assert.deepEqual(siblings.children.sort(), ['member:m3', 'member:m4'],
    'siblings must land in ONE family record — two would import as unrelated children');

  // The marriage attaches to the family they already share, rather than
  // spawning a second, childless one.
  assert.equal(siblings.status, 'married');
  assert.equal(fams.length, 3, 'a marriage between two existing parents adds no extra family record');

  assert.ok(FILE.includes('1 MARR Y'));
  const fam = FILE.slice(FILE.indexOf('@F'), FILE.indexOf('0 TRLR'));
  assert.ok(/1 HUSB @I1@/.test(FILE) || /1 HUSB @I/.test(fam));
  assert.ok(/1 CHIL @I/.test(FILE));
}
{
  // A childless partnership is still a fact worth exporting.
  const g = buildKinGraph({ members: [member('a', 'A'), member('b', 'B')] },
    [link('p', 'partner', 'member:a', 'member:b', { status: 'married' })]);
  const fams = buildGedFamilies(g);
  assert.equal(fams.length, 1);
  assert.equal(fams[0].children.length, 0);
  assert.ok(toGedcom(g).includes('1 MARR Y'));
}
{
  const g = buildKinGraph({ members: [member('a', 'A'), member('b', 'B')] },
    [link('p', 'partner', 'member:a', 'member:b', { status: 'divorced' })]);
  const f = toGedcom(g);
  assert.ok(f.includes('1 MARR Y') && f.includes('1 DIV Y'),
    'a divorce is a marriage that ended — both facts, or an importer shows neither');
}
{
  // An adopted child keeps BOTH sets of parents, which is what PEDI is for.
  const g = buildKinGraph(
    { members: [member('bm', 'Birth Mother', { gender: 'Female' }), member('am', 'Adoptive Mum', { gender: 'Female' }), member('c', 'Child')] },
    [
      link('x', 'parent', 'member:bm', 'member:c'),
      link('y', 'parent', 'member:am', 'member:c', { via: 'adoptive' }),
    ],
  );
  const fams = buildGedFamilies(g);
  assert.equal(fams.length, 2, 'birth and adoptive parents are different families in GEDCOM');
  const f = toGedcom(g);
  assert.ok(f.includes('2 PEDI adopted'), 'the adoptive family must be tagged, or the two read as one confused set');
  assert.equal((f.match(/1 FAMC/g) || []).length, 2, 'the child belongs to both families');
  assert.ok(!f.includes('2 PEDI birth'), 'birth is the default — tagging it is noise, not information');
}
{
  // Same-sex parents: GEDCOM has one HUSB slot and one WIFE slot, and both
  // people must still appear. Dropping one is the failure to avoid.
  const g = buildKinGraph(
    { members: [member('a', 'Ana', { gender: 'Female' }), member('b', 'Bea', { gender: 'Female' }), member('c', 'Kid')] },
    [link('x', 'parent', 'member:a', 'member:c'), link('y', 'parent', 'member:b', 'member:c')],
  );
  const f = toGedcom(g);
  assert.ok(/1 HUSB @I/.test(f) && /1 WIFE @I/.test(f),
    'both parents must be emitted — the slot names are GEDCOM’s problem, not a reason to lose a mother');
  assert.equal((f.match(/1 (HUSB|WIFE) @I/g) || []).length, 2);
}
{
  // Three parents in one pedigree group: more than the record can hold. The
  // extra must be NAMED in the file rather than vanishing.
  const g = buildKinGraph(
    { members: [member('a', 'A'), member('b', 'B'), member('c', 'C'), member('k', 'Kid')] },
    [
      link('x', 'parent', 'member:a', 'member:k'),
      link('y', 'parent', 'member:b', 'member:k'),
      link('z', 'parent', 'member:c', 'member:k'),
    ],
  );
  const f = toGedcom(g);
  assert.match(f, /1 NOTE Also recorded as a parent here:/,
    'a parent with no slot must be written down, not silently dropped');
}

// --- escaping ---------------------------------------------------------------
{
  // '@' is GEDCOM's pointer delimiter. One un-escaped one in a name or note
  // corrupts the file from that line onward.
  const g = buildKinGraph({ members: [member('a', 'Jo @ Home')] }, []);
  const f = toGedcom(g);
  assert.ok(f.includes('1 NAME Jo @@ /Home/'), 'a literal @ must be doubled, or the file is corrupt from there on');
  assert.ok(/0 @I1@ INDI/.test(f), 'but a POINTER’s @ is structural and must stay single, or every link in the file breaks');
  assert.ok(!/[^@]@[^@]/.test(f.split('\r\n').filter(l => !/@[A-Z0-9]+@/.test(l)).join('\r\n')),
    'no un-doubled @ may survive in a text value');
}
{
  // A long note must wrap with CONC rather than producing an over-length line.
  const long = 'x'.repeat(700);
  const g = buildKinGraph({ inMemory: [dep('d', 'Long', { relation: long })] }, []);
  const f = toGedcom(g);
  assert.ok(f.includes('CONC'), 'an over-long value must be split with CONC');
  for (const l of f.split('\r\n')) assert.ok(l.length <= 210, `line too long for the spec: ${l.length}`);
}
{
  // A newline inside a note is CONT, not a raw break that ends the record.
  const g = buildKinGraph({ inMemory: [dep('d', 'Multi', { relation: 'line one\nline two' })] }, []);
  const f = toGedcom(g);
  assert.ok(f.includes('2 CONT line two'), 'a newline must become CONT or the record ends early');
  assert.ok(!/\n(?!\r)/.test(f.replace(/\r\n/g, '')), 'no bare newlines may reach the file');
}

// --- the summary shown before download --------------------------------------
{
  const s = gedcomSummary(G);
  assert.equal(s.people, 6);
  assert.equal(s.families, 3);
  assert.deepEqual(s.unlinked, [], 'everyone in this fixture is connected');

  const g2 = buildKinGraph({ ...SRC, members: [...SRC.members, member('m9', 'Nobody')] }, LINKS);
  assert.deepEqual(gedcomSummary(g2).unlinked, ['Nobody'],
    'someone with no links must be named before export, so the family can connect them first');
}
{
  assert.equal(gedcomFilename('Clark', '2026-08-21'), 'clark-tree-2026-08-21.ged');
  assert.equal(gedcomFilename('  ', '2026-08-21'), 'family-tree-2026-08-21.ged');
  assert.equal(gedcomFilename('O’Brien & Sons', '2026-08-21'), 'o-brien-sons-tree-2026-08-21.ged');
}

// --- an empty tree ----------------------------------------------------------
{
  const f = toGedcom(buildKinGraph({}, []));
  assert.ok(f.startsWith('0 HEAD') && f.includes('0 TRLR'),
    'an empty vault must still produce a valid file rather than a broken one');
}

console.log('gedcom.test.ts: all assertions passed');
