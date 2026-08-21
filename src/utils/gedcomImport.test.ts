import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DepartedRelative, ExtendedBirthday, FamilyMember, KinLink } from '../types';
import { buildKinGraph } from './kin';
import { toGedcom } from './gedcom';
import {
  MAX_IMPORT_PEOPLE,
  derefPointer,
  gedcomDisplayName,
  humanGedDate,
  importSummary,
  isGedPointer,
  isPrivatisedName,
  parseGedDate,
  parseGedLines,
  parseGedcom,
  planGedcomImport,
  titleFromName,
} from './gedcomImport';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), 'utf8');

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

// A small, ordinary tree: two grandparents, their two children, a marriage and
// a grandchild — plus the shapes that break naive readers.
const SAMPLE = [
  '0 HEAD',
  '1 SOUR MyHeritage',
  '1 CHAR UTF-8',
  '1 GEDC',
  '2 VERS 5.5.1',
  '0 @I1@ INDI',
  '1 NAME Willem de /Villiers/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 3 MAR 1951',
  '1 FAMS @F1@',
  '0 @I2@ INDI',
  '1 NAME Anna /Müller/',
  '1 SEX F',
  '1 BIRT',
  '2 DATE ABT 1955',
  '1 DEAT',
  '2 DATE 2019',
  '1 FAMS @F1@',
  '0 @I3@ INDI',
  '1 NAME Pieter de /Villiers/',
  '1 SEX M',
  '1 BIRT',
  '2 DATE 14 SEP 1980',
  '1 FAMC @F1@',
  '0 @I4@ INDI',
  '1 NAME Lettie de /Villiers/',
  '1 SEX F',
  '1 FAMC @F1@',
  '2 PEDI adopted',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I2@',
  '1 MARR',
  '2 DATE 1978',
  '1 CHIL @I3@',
  '1 CHIL @I4@',
  '0 TRLR',
  '',
].join('\r\n');

const ids = () => {
  let n = 0;
  return () => { n += 1; return `x${n}`; };
};
const plan = (text: string, existing: Parameters<typeof planGedcomImport>[1] = {}) =>
  planGedcomImport(text, existing, { newId: ids(), todayISO: '2026-08-21' });

console.log('\ngedcomImport');

// --- the line layer --------------------------------------------------------

test('reads level, xref, tag and value off a line', () => {
  const { lines } = parseGedLines('0 @I1@ INDI\r\n1 NAME Jan /Smit/\r\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { level: 0, xref: 'I1', tag: 'INDI', value: '' });
  assert.deepEqual(lines[1], { level: 1, xref: undefined, tag: 'NAME', value: 'Jan /Smit/' });
});

test('tolerates CR-only line endings, a BOM and indented lines', () => {
  const { lines, ignored } = parseGedLines('﻿0 HEAD\r  1 CHAR UTF-8\r');
  assert.equal(ignored, 0, 'a BOM must not turn the first line into junk');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].tag, 'CHAR');
});

test('counts unreadable lines instead of throwing', () => {
  const { lines, ignored } = parseGedLines('0 HEAD\nthis is not gedcom at all\n1 CHAR UTF-8\n');
  assert.equal(ignored, 1);
  assert.equal(lines.length, 2);
});

test('CONT is a newline and CONC is a plain join', () => {
  const { lines } = parseGedLines('1 NOTE She kept\n2 CONT bees, and\n2 CONC always had honey\n');
  assert.equal(lines.length, 1, 'continuations must fold into the line they continue');
  assert.equal(lines[0].value, 'She kept\nbees, andalways had honey');
});

test('a continuation with nothing above it is junk, not a record', () => {
  const { lines, ignored } = parseGedLines('2 CONT orphaned\n0 HEAD\n');
  assert.equal(ignored, 1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tag, 'HEAD');
});

test('a doubled @ in text comes back as one, and a pointer keeps its own', () => {
  const { lines } = parseGedLines('1 NOTE write to jan@@example.com\n1 FAMS @F1@\n');
  assert.equal(lines[0].value, 'write to jan@example.com');
  assert.equal(lines[1].value, '@F1@', 'a pointer is structural — unescaping it would break the link');
  assert.equal(isGedPointer('@F1@'), true);
  assert.equal(isGedPointer('not a pointer'), false);
  assert.equal(derefPointer('@F1@'), 'F1');
  assert.equal(derefPointer('plain text'), undefined);
});

// --- dates -----------------------------------------------------------------

test('reads the three ordinary date shapes', () => {
  assert.deepEqual(parseGedDate('12 MAR 1938'), { text: '12 MAR 1938', monthDay: '03-12', year: 1938, approximate: false });
  assert.equal(parseGedDate('MAR 1938')?.monthDay, undefined, 'a month with no day must not become the 1st');
  assert.equal(parseGedDate('MAR 1938')?.year, 1938);
  assert.equal(parseGedDate('1938')?.year, 1938);
  assert.equal(parseGedDate(''), undefined);
});

test('an approximate date is flagged and a range keeps its first date', () => {
  assert.equal(parseGedDate('ABT 1938')?.approximate, true);
  assert.equal(parseGedDate('ABT 1938')?.year, 1938);
  const between = parseGedDate('BET 1938 AND 1940');
  assert.equal(between?.year, 1938);
  assert.equal(between?.approximate, true);
  assert.equal(parseGedDate('12 MAR 1938')?.approximate, false);
});

test('a birthday with no year still yields a month and day', () => {
  const d = parseGedDate('5 JAN');
  assert.equal(d?.monthDay, '01-05');
  assert.equal(d?.year, undefined);
});

test('the original wording is kept for the free-text fields', () => {
  assert.equal(parseGedDate('ABT 1861')?.text, 'ABT 1861');
});

// --- names -----------------------------------------------------------------

test('a structured name loses its slashes', () => {
  assert.equal(gedcomDisplayName('Willem de /Villiers/'), 'Willem de Villiers');
  assert.equal(gedcomDisplayName('Sue'), 'Sue');
});

test("the family's own name comes back when NICK contains the whole name", () => {
  assert.equal(gedcomDisplayName('Sue', 'Grandma Sue'), 'Grandma Sue');
  assert.equal(gedcomDisplayName('Anna /Müller/', 'Oma Anna Müller'), 'Oma Anna Müller');
});

test('a genuine nickname does not replace the name and lose the surname', () => {
  assert.equal(gedcomDisplayName('Robert /Smith/', 'Bob'), 'Robert Smith');
});

test('a nameless record still gets something to show', () => {
  assert.equal(gedcomDisplayName('', ''), 'Unnamed');
  assert.equal(gedcomDisplayName('', 'Ouma'), 'Ouma');
});

test('a privacy placeholder is not a name', () => {
  assert.equal(isPrivatisedName('Living van der Merwe'), true);
  assert.equal(isPrivatisedName('Private'), true);
  assert.equal(isPrivatisedName('<Private>'), true);
  assert.equal(isPrivatisedName('Withheld'), true);
  assert.equal(isPrivatisedName(''), true);
  assert.equal(isPrivatisedName('Livingstone Smith'), false, 'a real name that starts with those letters is a real name');
  assert.equal(isPrivatisedName('Anna Müller'), false);
});

test('the kinship word in a name is pulled out on its own', () => {
  assert.equal(titleFromName('Ouma Katrien'), 'Ouma');
  assert.equal(titleFromName('Great Oupa Willem'), 'Great Oupa');
  assert.equal(titleFromName('Anna Müller'), undefined);
  assert.equal(titleFromName(''), undefined);
});

// --- dates a family reads --------------------------------------------------

test('an imported date is rendered in words, not GEDCOM keywords', () => {
  assert.equal(humanGedDate(parseGedDate('4 JUL 1901')), '4 July 1901');
  assert.equal(humanGedDate(parseGedDate('ABT 1975')), 'about 1975');
  assert.equal(humanGedDate(parseGedDate('BET 1905 AND 1907')), 'between 1905 and 1907');
  assert.equal(humanGedDate(parseGedDate('BEF 1900')), 'before 1900');
  assert.equal(humanGedDate(parseGedDate('AFT 12 MAR 1938')), 'after 12 March 1938');
  assert.equal(humanGedDate(parseGedDate('MAR 1938')), 'March 1938');
  assert.equal(humanGedDate(parseGedDate('1938')), '1938');
  assert.equal(humanGedDate(undefined), undefined);
});

test('a date nothing can be made of keeps the family’s own words', () => {
  assert.equal(humanGedDate(parseGedDate('during the war')), 'during the war');
});

// --- records ---------------------------------------------------------------

test('reads people and families out of an ordinary file', () => {
  const f = parseGedcom(SAMPLE);
  assert.equal(f.indis.length, 4);
  assert.equal(f.fams.length, 1);
  assert.equal(f.charset, 'UTF-8');
  assert.equal(f.indis[0].name, 'Willem de /Villiers/');
  assert.equal(f.indis[0].sex, 'M');
  assert.equal(f.indis[0].birth?.year, 1951);
  assert.deepEqual(f.fams[0].spouses, ['I1', 'I2']);
  assert.deepEqual(f.fams[0].children, ['I3', 'I4']);
  assert.equal(f.fams[0].married, true);
});

test('a death fact marks someone as departed, with or without a date', () => {
  const f = parseGedcom(SAMPLE);
  assert.equal(f.indis[1].dead, true);
  assert.equal(f.indis[1].death?.year, 2019);
  assert.equal(f.indis[0].dead, false);

  const bare = parseGedcom('0 @I1@ INDI\n1 NAME Jan /Smit/\n1 DEAT Y\n0 TRLR\n');
  assert.equal(bare.indis[0].dead, true, 'DEAT with no date still means the person has died');
  assert.equal(bare.indis[0].death, undefined);

  const buried = parseGedcom('0 @I1@ INDI\n1 NAME Jan /Smit/\n1 BURI\n2 DATE 1990\n0 TRLR\n');
  assert.equal(buried.indis[0].dead, true, 'a burial with no DEAT still means the person has died');
});

test('PEDI is read from the child, which is where 5.5.1 puts it', () => {
  const f = parseGedcom(SAMPLE);
  assert.deepEqual(f.indis[3].famc, [{ xref: 'F1', pedi: 'adopted' }]);
  assert.equal(f.indis[2].famc[0].pedi, undefined);
});

test('an unfamiliar tag between two known ones does not end the record', () => {
  const f = parseGedcom([
    '0 @I1@ INDI',
    '1 NAME Jan /Smit/',
    '1 _MILT Some other program’s own tag',
    '2 DATE 1944',
    '1 SEX M',
    '0 TRLR',
  ].join('\n'));
  assert.equal(f.indis[0].sex, 'M', 'a tag we do not know must be stepped over, not treated as the end');
});

test('a record with no xref is skipped rather than crashing the read', () => {
  const f = parseGedcom('0 INDI\n1 NAME Nobody\n0 @I2@ INDI\n1 NAME Jan /Smit/\n0 TRLR\n');
  assert.equal(f.indis.length, 1);
  assert.equal(f.indis[0].xref, 'I2');
});

// --- the plan --------------------------------------------------------------

test('new people land in Extended birthdays, the departed in In Memory', () => {
  const r = plan(SAMPLE);
  assert.equal(r.plan.refusal, undefined);
  assert.equal(r.plan.counts.newPeople, 4);
  assert.equal(r.extendedBirthdays.length, 3);
  assert.equal(r.inMemory.length, 1);
  assert.equal(r.inMemory[0].name, 'Anna Müller');
  assert.equal(r.inMemory[0].born, 'about 1955', 'the file’s uncertainty is kept — its keywords are not');
  assert.equal(r.inMemory[0].died, '2019');
});

test('an ancestor with no birthday is still imported, with an empty date', () => {
  const r = plan(SAMPLE);
  const lettie = r.extendedBirthdays.find((e) => e.name === 'Lettie de Villiers');
  assert.ok(lettie, 'a person with no birth date must not be dropped from the tree');
  assert.equal(lettie!.date, '', 'no birthday recorded is the honest value, not an invented one');
  const willem = r.extendedBirthdays.find((e) => e.name === 'Willem de Villiers');
  assert.equal(willem!.date, '03-03');
  assert.equal(willem!.originalYear, 1951);
});

test('the file’s families become parent and partner links', () => {
  const r = plan(SAMPLE);
  assert.equal(r.plan.counts.newLinks, 5, 'one marriage and two parents for each of two children');
  const partner = r.links.filter((l) => l.kind === 'partner');
  assert.equal(partner.length, 1);
  assert.equal(partner[0].status, 'married');
  assert.equal(r.links.filter((l) => l.kind === 'parent').length, 4);
});

test('an adopted child keeps how they joined the family', () => {
  const r = plan(SAMPLE);
  const lettie = r.extendedBirthdays.find((e) => e.name === 'Lettie de Villiers')!;
  const hers = r.links.filter((l) => l.kind === 'parent' && l.to === `extended:${lettie.id}`);
  assert.equal(hers.length, 2);
  assert.ok(hers.every((l) => l.via === 'adoptive'), 'PEDI adopted must survive the import');
  const pieter = r.extendedBirthdays.find((e) => e.name === 'Pieter de Villiers')!;
  const his = r.links.filter((l) => l.kind === 'parent' && l.to === `extended:${pieter.id}`);
  assert.ok(his.every((l) => l.via === undefined), 'a birth parent is the default and stores nothing');
});

test('a divorce comes through as a divorce', () => {
  const r = plan([
    '0 @I1@ INDI', '1 NAME A /One/', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME B /Two/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '1 DIV', '0 TRLR',
  ].join('\n'));
  assert.equal(r.links.find((l) => l.kind === 'partner')!.status, 'divorced');
});

// --- matching, and the refusal to guess ------------------------------------

const member = (id: string, name: string): FamilyMember => ({
  id, name, role: 'Parent', avatarColor: 'clay', clothingSizes: {}, documents: [],
} as unknown as FamilyMember);

test('someone already on file is matched, not duplicated', () => {
  const existing = { members: [member('m1', 'Pieter de Villiers')] };
  const r = plan(SAMPLE, existing);
  assert.equal(r.plan.counts.matched, 1);
  assert.equal(r.plan.counts.newPeople, 3, 'the person already on file must not be added a second time');
  assert.ok(!r.extendedBirthdays.some((e) => e.name === 'Pieter de Villiers'));
  const toPieter = r.links.filter((l) => l.kind === 'parent' && l.to === 'member:m1');
  assert.equal(toPieter.length, 2, 'his imported parents attach to the record he already has');
});

test('two people on file with the same name means neither is chosen', () => {
  const existing = {
    members: [member('m1', 'Pieter de Villiers'), member('m2', 'Pieter de Villiers')],
  };
  const r = plan(SAMPLE, existing);
  assert.equal(r.plan.counts.ambiguous, 1);
  assert.equal(r.plan.counts.matched, 0);
  assert.ok(!r.extendedBirthdays.some((e) => e.name === 'Pieter de Villiers'),
    'an ambiguous person must not be quietly created either — the family has to say which one');
  assert.ok(r.plan.links.some((l) => l.action === 'blocked'),
    'links to a person nobody could place must be reported, not dropped in silence');
});

test('two people in the FILE with one match on file fuses nobody', () => {
  const twice = [
    '0 @I1@ INDI', '1 NAME Jan /Smit/', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Jan /Smit/', '1 FAMC @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@', '0 TRLR',
  ].join('\n');
  const r = plan(twice, { members: [member('m1', 'Jan Smit')] });
  assert.equal(r.plan.counts.ambiguous, 2, 'both would claim the same record, so neither may have it');
  assert.equal(r.plan.counts.matched, 0);
  assert.equal(r.plan.counts.newPeople, 0);
});

test('matching ignores case and stray spacing, and nothing else', () => {
  const r = plan(SAMPLE, { members: [member('m1', '  pieter   DE villiers ')] });
  assert.equal(r.plan.counts.matched, 1);
  const near = plan(SAMPLE, { members: [member('m1', 'Piet de Villiers')] });
  assert.equal(near.plan.counts.matched, 0, 'a near-miss is a different person, not a fuzzy match');
});

test('a name the vault holds under the family’s own words round-trips', () => {
  const existing: { extendedBirthdays: ExtendedBirthday[] } = {
    extendedBirthdays: [{ id: 'e1', name: 'Grandma Sue', date: '07-04', createdAt: '2020-01-01' }],
  };
  const out = toGedcom(buildKinGraph(existing, []), { todayISO: '2026-08-21' });
  assert.ok(out.includes('1 NAME Sue') && out.includes('2 NICK Grandma Sue'));
  const r = plan(out, existing);
  assert.equal(r.plan.counts.matched, 1, 'a tree exported from here and read straight back must match itself');
  assert.equal(r.plan.counts.newPeople, 0);
});

// --- links that must not be written ----------------------------------------

test('a connection already on file is recognised rather than doubled', () => {
  const first = plan(SAMPLE);
  const existing = {
    extendedBirthdays: first.extendedBirthdays,
    inMemory: first.inMemory,
    links: first.links,
  };
  const again = planGedcomImport(SAMPLE, existing, { newId: ids(), todayISO: '2026-08-21' });
  assert.equal(again.plan.counts.newLinks, 0, 'importing the same file twice must add no second copy of anything');
  assert.equal(again.plan.counts.matched, 4);
  assert.equal(again.links.length, existing.links.length);
  assert.ok(again.plan.links.every((l) => l.action === 'already'));
});

test('a partner link written the other way round is the same fact', () => {
  const first = plan([
    '0 @I1@ INDI', '1 NAME A /One/', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME B /Two/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '0 TRLR',
  ].join('\n'));
  const reversed = planGedcomImport([
    '0 @I1@ INDI', '1 NAME B /Two/', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME A /One/', '1 FAMS @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '0 TRLR',
  ].join('\n'), {
    extendedBirthdays: first.extendedBirthdays, inMemory: first.inMemory, links: first.links,
  }, { newId: ids(), todayISO: '2026-08-21' });
  assert.equal(reversed.plan.counts.newLinks, 0, 'a marriage is undirected — the reverse is not a new fact');
  assert.deepEqual(reversed.plan.links.map(l => l.action), ['already'],
    'and it reads as already recorded, not as a problem — a family re-importing their own file has done nothing wrong');
});

test('a file that would make someone their own ancestor is refused that link', () => {
  const loop = [
    '0 @I1@ INDI', '1 NAME A /One/', '1 FAMS @F1@', '1 FAMC @F2@',
    '0 @I2@ INDI', '1 NAME B /Two/', '1 FAMC @F1@', '1 FAMS @F2@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@',
    '0 @F2@ FAM', '1 HUSB @I2@', '1 CHIL @I1@',
    '0 TRLR',
  ].join('\n');
  const r = plan(loop);
  assert.equal(r.plan.counts.newLinks, 1, 'the first edge is fine; the one closing the loop is not');
  const blocked = r.plan.links.find((l) => l.action === 'blocked');
  assert.ok(blocked, 'the refused link must appear in the preview with its reason');
  assert.ok(/ancestor|wrong way round/i.test(blocked!.reason || ''));
  assert.equal(r.links.filter((l) => l.kind === 'parent').length, 1);
});

test('the imported links are the same array the preview counted', () => {
  const r = plan(SAMPLE);
  assert.equal(r.links.length, r.plan.counts.newLinks,
    'the preview and the records that get saved come out of one call, so they cannot disagree');
  assert.equal(
    r.extendedBirthdays.length + r.inMemory.length,
    r.plan.counts.newPeople,
  );
});

test('existing records are carried through untouched, ahead of the new ones', () => {
  const existing: { extendedBirthdays: ExtendedBirthday[]; inMemory: DepartedRelative[]; links: KinLink[] } = {
    extendedBirthdays: [{ id: 'e1', name: 'Auntie Jo', date: '07-04', createdAt: '2020-01-01' }],
    inMemory: [{ id: 'd1', name: 'Oupa Kobus', relation: 'Grandfather', documents: [], notes: [], createdAt: '2020-01-01' }],
    links: [{ id: 'l1', kind: 'partner', from: 'extended:e1', to: 'memory:d1' }],
  };
  const r = plan(SAMPLE, existing);
  assert.equal(r.extendedBirthdays[0].id, 'e1');
  assert.equal(r.inMemory[0].id, 'd1');
  assert.equal(r.links[0].id, 'l1', 'an import adds; it never rewrites what was already there');
});

// --- what a real export from a genealogy site actually contains ------------

const PRIVATISED = [
  '0 @I1@ INDI', '1 NAME Ouma /Katrien/', '1 DEAT Y', '1 FAMS @F1@',
  '0 @I2@ INDI', '1 NAME Living /Katrien/', '1 FAMC @F1@',
  '0 @F1@ FAM', '1 WIFE @I1@', '1 CHIL @I2@', '1 CHIL @I99@', '0 TRLR',
].join('\n');

test('a person the file hides is left out, and said so, not added as "Living"', () => {
  const r = plan(PRIVATISED);
  assert.equal(r.plan.counts.newPeople, 1);
  assert.ok(!r.extendedBirthdays.some((e) => /Living/.test(e.name)),
    'a permanent record called "Living Smith" is worse than telling the family the file withheld them');
  assert.ok(r.plan.warnings.some((w) => /hidden/i.test(w)));
  const blocked = r.plan.links.find((l) => l.action === 'blocked' && /hides/.test(l.reason || ''));
  assert.ok(blocked, 'the link to a hidden person needs the real reason, not a shrug');
});

test('a pointer to somebody not in the file says exactly that', () => {
  const r = plan(PRIVATISED);
  const dangling = r.plan.links.find((l) => /does not actually contain/.test(l.reason || ''));
  assert.ok(dangling, 'a CHIL pointing at a missing record must be named as such');
});

test('the departed get a relationship, because In Memory shows one and requires one', () => {
  const r = plan(PRIVATISED);
  assert.equal(r.inMemory[0].relation, 'Ouma',
    'the kinship word in the name is the family’s own, and it is also what tells the tree her sex');
  const noWord = plan('0 @I1@ INDI\n1 NAME Anna /Müller/\n1 DEAT Y\n0 TRLR\n');
  assert.equal(noWord.inMemory[0].relation, 'Relative',
    'blank would be a record the In Memory form itself would reject');
});

test('a NICK dropped as a name still gives up its kinship word', () => {
  const r = plan([
    '0 @I1@ INDI', '1 NAME Katrien /van der Merwe/', '2 NICK Ouma Katrien', '1 DEAT Y', '0 TRLR',
  ].join('\n'));
  assert.equal(r.inMemory[0].name, 'Katrien van der Merwe', 'the surname is not thrown away for a nickname');
  assert.equal(r.inMemory[0].relation, 'Ouma', 'but the word that came with it is not lost either');
});

test('imported dates reach the record in words', () => {
  const r = plan([
    '0 @I1@ INDI', '1 NAME Jan /Smit/',
    '1 BIRT', '2 DATE 4 JUL 1901',
    '1 DEAT', '2 DATE ABT 1975', '0 TRLR',
  ].join('\n'));
  assert.equal(r.inMemory[0].born, '4 July 1901');
  assert.equal(r.inMemory[0].died, 'about 1975',
    'In Memory shows this under a photograph — "ABT 1975" is programmer text');
});

test('a story in the file becomes a remembered note, not nothing', () => {
  const r = plan([
    '0 @I1@ INDI', '1 NAME Jan /Smit/', '1 DEAT Y',
    '1 NOTE Kept bees, and wrote to jan@@example.com every Sunday', '0 TRLR',
  ].join('\n'));
  assert.equal(r.inMemory[0].notes.length, 1);
  assert.equal(r.inMemory[0].notes[0].text, 'Kept bees, and wrote to jan@example.com every Sunday');
});

test('Teluva’s own relationship note is used as the relationship, not kept as a story', () => {
  const r = plan([
    '0 @I1@ INDI', '1 NAME Sue', '1 DEAT Y', '1 NOTE Recorded in Teluva as: Grandmother', '0 TRLR',
  ].join('\n'));
  assert.equal(r.inMemory[0].relation, 'Grandmother');
  assert.equal(r.inMemory[0].notes.length, 0, 'the app’s own bookkeeping note is not a memory of her');
});

// --- refusals --------------------------------------------------------------

test('an empty or non-GEDCOM file is refused with a reason, not half-read', () => {
  assert.match(plan('').plan.refusal || '', /empty/i);
  assert.match(plan('   \n  \n').plan.refusal || '', /empty/i);
  const notGed = plan('Dear Rory,\n\nHere is the family tree I promised.\n\nLove, Ma\n');
  assert.match(notGed.plan.refusal || '', /GEDCOM|damaged/i);
  assert.equal(notGed.extendedBirthdays.length, 0);
  assert.equal(notGed.links.length, 0);
});

test('a refused file carries the vault back unchanged, not empty', () => {
  const existing: { extendedBirthdays: ExtendedBirthday[]; inMemory: DepartedRelative[]; links: KinLink[] } = {
    extendedBirthdays: [{ id: 'e1', name: 'Auntie Jo', date: '07-04', createdAt: '2020-01-01' }],
    inMemory: [{ id: 'd1', name: 'Oupa Kobus', relation: 'Grandfather', documents: [], notes: [], createdAt: '2020-01-01' }],
    links: [{ id: 'l1', kind: 'partner', from: 'extended:e1', to: 'memory:d1' }],
  };
  // Saving a refused plan must be a no-op, not a wipe. These three arrays are
  // what the caller writes — holding empty ones here would mean any path that
  // reached the save without re-reading `refusal` deleted the whole vault.
  for (const bad of ['', 'Dear Rory, here is the tree.\n']) {
    const r = plan(bad, existing);
    assert.ok(r.plan.refusal);
    assert.deepEqual(r.extendedBirthdays, existing.extendedBirthdays);
    assert.deepEqual(r.inMemory, existing.inMemory);
    assert.deepEqual(r.links, existing.links);
  }
});

test('a file with more people than the vault can hold is refused whole', () => {
  const many = ['0 HEAD'];
  for (let i = 1; i <= MAX_IMPORT_PEOPLE + 1; i += 1) many.push(`0 @I${i}@ INDI`, `1 NAME P${i} /Test/`);
  many.push('0 TRLR');
  const r = plan(many.join('\n'));
  assert.ok(r.plan.refusal, 'half an archive is worse than none of it');
  assert.match(r.plan.refusal!, new RegExp(String(MAX_IMPORT_PEOPLE)));
  assert.equal(r.extendedBirthdays.length, 0);
});

test('a legacy character set is warned about, not silently mangled', () => {
  const ansel = SAMPLE.replace('1 CHAR UTF-8', '1 CHAR ANSEL');
  const r = plan(ansel);
  assert.ok(r.plan.warnings.some((w) => /ANSEL/.test(w)));
  assert.equal(r.plan.refusal, undefined, 'a warning, not a refusal — the names are still mostly right');
  const utf = plan(SAMPLE);
  assert.ok(!utf.plan.warnings.some((w) => /ANSEL|UTF/.test(w)));
});

test('unreadable lines are counted in the warnings', () => {
  const damaged = SAMPLE.replace('1 SEX M', 'SEX M\r\ngarbage');
  const r = plan(damaged);
  assert.ok(r.plan.warnings.some((w) => /could not be read/.test(w)));
});

test('the confirm line says what is about to happen', () => {
  const r = plan(SAMPLE);
  const summary = importSummary(r.plan);
  assert.match(summary, /4 new people/);
  assert.match(summary, /5 connections/);
  const one = importSummary({ ...r.plan, counts: { ...r.plan.counts, newPeople: 1, newLinks: 1, matched: 0 } });
  assert.match(one, /1 new person/);
  assert.match(one, /1 connection/);
});

// --- wiring ----------------------------------------------------------------

test('the tree view reads a file, previews it, and only then writes', () => {
  const view = read('../components/FamilyTreeView.tsx');
  // Sliced, not searched. `saveFamilyTree(` also appears in the hand-drawn
  // link path, so a whole-file `includes` for it passes with the import's own
  // call deleted — the same shape as asserting a bare identifier and getting
  // the import line.
  const picker = view.slice(view.indexOf('const chooseFile'), view.indexOf('const confirmImport'));
  const confirm = view.slice(view.indexOf('const confirmImport'), view.indexOf('if (!loaded)'));
  assert.ok(picker.length > 100 && confirm.length > 100, 'both halves of the import must exist');

  // Choosing a file must PLAN and stop. The moment a write moves into the
  // picker, the preview becomes decoration over an import that already
  // happened — and there is no undo for a hundred records.
  assert.ok(picker.includes('planGedcomImport('), 'the picker must be the thing that plans');
  assert.ok(!/\bsave[A-Z]\w*\(/.test(picker), 'choosing a file must write nothing at all');

  assert.ok(confirm.includes('if (!pending'), 'the write must be gated on there being a previewed plan');
  for (const call of ['saveExtendedBirthdays(', 'saveInMemory(', 'saveFamilyTree(']) {
    assert.ok(confirm.includes(call), `confirming an import must write ${call}`);
  }
  assert.ok(/accept=["'][^"']*\.ged/.test(view), 'the file picker must accept .ged');
  assert.ok(!view.includes('window.confirm('),
    'a native confirm renders as a broken page in the iOS PWA — see ConfirmDeleteButton');
});

test('the module refuses to import household members', () => {
  const src = read('./gedcomImport.ts');
  assert.ok(!/saveFamilyMembers|members\.push|newMembers/.test(src),
    'an import must never create FamilyMembers — a great-grandfather does not need a medical record');
  const r = plan(SAMPLE, { members: [member('m1', 'Pieter de Villiers')] });
  assert.equal(r.plan.people.filter((p) => p.action === 'matched')[0].ref, 'member:m1',
    'it may still attach to a member who is already there');
});

console.log(`\n  ${passed} assertions groups passed\n`);
