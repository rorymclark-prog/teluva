import assert from 'node:assert/strict';
import { timelineDocumentSources, timelineTextChunks } from './timelineDocuments';
import test from 'node:test';
import {
  parseDateLoose,
  parseCsv,
  parseIcs,
  parseFreeTextLines,
  resolvePeople,
  findDuplicates,
  importCategoryFromWord,
  importRowReason,
  datePrecisionChange,
  TimelineCandidate,
} from './timelineImport';
import { TimelineEntry } from '../types';

// Fictional family only — this repo is public.
const MIA = { id: 'm-mia', name: 'Mia Lindqvist' };
const BEN = { id: 'm-ben', name: 'Ben Lindqvist' };
const JONAS = { id: 'm-jonas', name: 'Jonas' };
const NORA = { id: 'm-nora', name: 'Nora' };
const MEMBERS = [MIA, BEN, JONAS, NORA];

// ---------------------------------------------------------------------------
// parseDateLoose — a known day has NO datePrecision key (TimelineEntry's rule)
// ---------------------------------------------------------------------------

test('parseDateLoose: ISO date is a known day — no precision key at all', () => {
  const out = parseDateLoose('2019-04-12');
  assert.deepEqual(out, { date: '2019-04-12' });
  assert.equal(out && 'datePrecision' in out, false);
});

test('parseDateLoose: ISO month (2019-04) is month precision', () => {
  assert.deepEqual(parseDateLoose('2019-04'), { date: '2019-04-01', datePrecision: 'month' });
  assert.equal(parseDateLoose('2019-13'), null);
});

test('parseDateLoose: numeric month and year (09.2022, 9/2022) is month precision', () => {
  assert.deepEqual(parseDateLoose('09.2022'), { date: '2022-09-01', datePrecision: 'month' });
  assert.deepEqual(parseDateLoose('9/2022'), { date: '2022-09-01', datePrecision: 'month' });
  assert.equal(parseDateLoose('13.2022'), null);   // no month 13
  assert.equal(parseDateLoose('00.2022'), null);
  // A spreadsheet column written this way comes through the CSV path too.
  const rows = parseCsv('Datum;Ereignis\n09.2022;Kindergarten begonnen\n', MEMBERS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2022-09-01');
  assert.equal(rows[0].datePrecision, 'month');
});

test('parseDateLoose: dd.mm.yyyy is DAY-FIRST, not month-first', () => {
  assert.deepEqual(parseDateLoose('12.04.2019'), { date: '2019-04-12' });
});

test('parseDateLoose: CONTROL — 03.04.2024 reads as 3 April, never month-first', () => {
  // If this module were ever flipped to month-first (an easy, wrong "fix" for
  // a US-formatted test date), this would silently read as 2024-03-04.
  const out = parseDateLoose('03.04.2024');
  assert.deepEqual(out, { date: '2024-04-03' });
  assert.notDeepEqual(out, { date: '2024-03-04' });
});

test('parseDateLoose: dd/mm/yyyy slash form and two-digit year', () => {
  assert.deepEqual(parseDateLoose('12/04/2019'), { date: '2019-04-12' });
  assert.deepEqual(parseDateLoose('12.04.19'), { date: '2019-04-12' });
});

test('parseDateLoose: "12 April 2019", abbreviated month, and "12. April 2019"', () => {
  assert.deepEqual(parseDateLoose('12 April 2019'), { date: '2019-04-12' });
  assert.deepEqual(parseDateLoose('12 Apr 2019'), { date: '2019-04-12' });
  assert.deepEqual(parseDateLoose('12. April 2019'), { date: '2019-04-12' });
});

test('parseDateLoose: German month names', () => {
  assert.deepEqual(parseDateLoose('3 März 2019'), { date: '2019-03-03' });
  assert.deepEqual(parseDateLoose('1 Dezember 2020'), { date: '2020-12-01' });
  assert.deepEqual(parseDateLoose('Juni 2018'), { date: '2018-06-01', datePrecision: 'month' });
});

test('parseDateLoose: "April 2019" (no day) is MONTH precision, day stored as 01', () => {
  assert.deepEqual(parseDateLoose('April 2019'), { date: '2019-04-01', datePrecision: 'month' });
  assert.deepEqual(parseDateLoose('Apr 2019'), { date: '2019-04-01', datePrecision: 'month' });
});

test('parseDateLoose: bare year is YEAR precision', () => {
  assert.deepEqual(parseDateLoose('2019'), { date: '2019-01-01', datePrecision: 'year' });
});

test('parseDateLoose: "summer 2015" / "early 2019" style is YEAR precision', () => {
  assert.deepEqual(parseDateLoose('summer 2015'), { date: '2015-01-01', datePrecision: 'year' });
  assert.deepEqual(parseDateLoose('early 2019'), { date: '2019-01-01', datePrecision: 'year' });
  assert.deepEqual(parseDateLoose('Herbst 2020'), { date: '2020-01-01', datePrecision: 'year' });
});

test('parseDateLoose: invalid calendar dates return null, never a guessed date', () => {
  assert.equal(parseDateLoose('31.02.2024'), null);   // February never has 31 days
  assert.equal(parseDateLoose('29.02.2023'), null);   // 2023 is not a leap year
  assert.equal(parseDateLoose('32.01.2024'), null);
  assert.equal(parseDateLoose('25.13.2024'), null);   // month 13
});

test('parseDateLoose: CONTROL — the same day IS valid on a leap year', () => {
  // Proves isValidYmd can say yes as well as no — without this, "always
  // returns null" would trivially pass every rejection test above.
  assert.deepEqual(parseDateLoose('29.02.2024'), { date: '2024-02-29' });
});

test('parseDateLoose: garbage and empty input return null', () => {
  assert.equal(parseDateLoose(''), null);
  assert.equal(parseDateLoose('not a date'), null);
  assert.equal(parseDateLoose('sometime'), null);
});

// ---------------------------------------------------------------------------
// importCategoryFromWord — LifeCategory ids only; unknown → 'other'
// ---------------------------------------------------------------------------

test('importCategoryFromWord: ids, English words, plural labels and German words', () => {
  assert.equal(importCategoryFromWord('holiday'), 'holiday');
  assert.equal(importCategoryFromWord('Holidays'), 'holiday');   // LIFE_CATEGORIES label
  assert.equal(importCategoryFromWord('Memories'), 'memory');    // label, not a CATEGORY_WORDS entry
  assert.equal(importCategoryFromWord('Birth'), 'milestone');    // legacy type word
  assert.equal(importCategoryFromWord('Urlaub'), 'holiday');
  assert.equal(importCategoryFromWord('Schule'), 'school');
  assert.equal(importCategoryFromWord('Gesundheit'), 'medical');
});

test('importCategoryFromWord: an unknown word becomes other; a blank cell stays undefined', () => {
  assert.equal(importCategoryFromWord('Relocation'), 'other');
  assert.equal(importCategoryFromWord(''), undefined);
  assert.equal(importCategoryFromWord('   '), undefined);
  assert.equal(importCategoryFromWord(undefined), undefined);
});

// ---------------------------------------------------------------------------
// resolvePeople
// ---------------------------------------------------------------------------

test('resolvePeople: full name and first name match, case/diacritic-insensitive', () => {
  assert.deepEqual(resolvePeople('MIA graduated', MEMBERS), [MIA.id]);
  assert.deepEqual(resolvePeople('mîa graduated', MEMBERS), [MIA.id]);
  assert.deepEqual(resolvePeople('Mia Lindqvist graduated', MEMBERS), [MIA.id]);
});

test('resolvePeople: word boundary — does not match a name inside another word', () => {
  assert.deepEqual(resolvePeople('Benjamin bought a car', MEMBERS), []); // not Ben
});

test('resolvePeople: CONTROL — the same word DOES match as a standalone token', () => {
  assert.deepEqual(resolvePeople('Ben bought a car', MEMBERS), [BEN.id]);
});

test('resolvePeople: ambiguous shared first name resolves to none', () => {
  const cousins = [{ id: 'a', name: 'Sam Lindqvist' }, { id: 'b', name: 'Sam Poe' }];
  assert.deepEqual(resolvePeople('Sam started school', cousins), []);
});

test('resolvePeople: a full-name mention still resolves even when the first name is ambiguous', () => {
  const cousins = [{ id: 'a', name: 'Sam Lindqvist' }, { id: 'b', name: 'Sam Poe' }];
  assert.deepEqual(resolvePeople('Sam Lindqvist started school', cousins), ['a']);
});

test('resolvePeople: multiple distinct people in one line', () => {
  assert.deepEqual(new Set(resolvePeople('Jonas and Nora married', MEMBERS)), new Set([JONAS.id, NORA.id]));
});

test('resolvePeople: no members, no text -> empty, no throw', () => {
  assert.deepEqual(resolvePeople('anything', []), []);
  assert.deepEqual(resolvePeople('', MEMBERS), []);
});

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

test('parseCsv: comma-delimited with a header row; Type column maps to a LifeCategory', () => {
  const csv = 'Date,Title,Who,Type,Note\n2019-04-12,Nora born,Nora,Birth,Healthy 3.2kg';
  const out = parseCsv(csv, MEMBERS);
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '2019-04-12');
  assert.equal('datePrecision' in out[0], false);
  assert.equal(out[0].title, 'Nora born');
  assert.equal(out[0].category, 'milestone');
  assert.equal('type' in out[0], false, 'the legacy `type` field is never written');
  assert.deepEqual(out[0].memberIds, [NORA.id]);
  assert.equal(out[0].note, 'Healthy 3.2kg');
});

test('parseCsv: semicolon-delimited German export (Austrian Excel)', () => {
  const csv = 'Datum;Ereignis;Personen;Kategorie\n15.03.2019;Umzug nach Wien;Nora;Umzug\nJuni 2018;Sommerferien;;Urlaub';
  const out = parseCsv(csv, MEMBERS);
  assert.equal(out.length, 2);
  assert.equal(out[0].date, '2019-03-15');
  assert.equal(out[0].title, 'Umzug nach Wien');
  assert.equal(out[0].category, 'home');
  assert.deepEqual(out[0].memberIds, [NORA.id]);
  assert.equal(out[1].date, '2018-06-01');
  assert.equal(out[1].datePrecision, 'month');
  assert.equal(out[1].category, 'holiday');
});

test('parseCsv: tab-delimited', () => {
  const out = parseCsv('date\ttitle\n2020-01-01\tNew year');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'New year');
  assert.equal(out[0].category, undefined, 'no category column → the review row asks');
});

test('parseCsv: an unknown category word becomes other', () => {
  const out = parseCsv('Date,Title,Category\n2020-01-01,Something,Relocation');
  assert.equal(out[0].category, 'other');
});

test('parseCsv: quoted fields containing the delimiter', () => {
  const out = parseCsv('Date,Title\n2021-05-01,"Moved house, finally"');
  assert.equal(out[0].title, 'Moved house, finally');
});

test('parseCsv: a row with an unparseable date is kept, flagged needsDate, never dropped', () => {
  const out = parseCsv('Date,Title\nsometime,Family trip');
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '');
  assert.equal(out[0].needsDate, true);
});

test('parseCsv: unrecognisable file shape returns nothing rather than garbage rows', () => {
  assert.deepEqual(parseCsv('Foo,Bar\n1,2'), []);
});

test('parseCsv: CONTROL — a recognised header on the same shaped data DOES produce rows', () => {
  assert.equal(parseCsv('Title,Note\nBirthday party,cake').length, 1);
});

// ---------------------------------------------------------------------------
// parseIcs
// ---------------------------------------------------------------------------

const ICS_SIMPLE = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:1@example.com',
  'DTSTART;VALUE=DATE:20190412',
  'SUMMARY:Nora born',
  'DESCRIPTION:3.2kg\\, healthy',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseIcs: DATE (all-day) VEVENT is a known day', () => {
  const out = parseIcs(ICS_SIMPLE);
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '2019-04-12');
  assert.equal('datePrecision' in out[0], false);
  assert.equal(out[0].title, 'Nora born');
  assert.equal(out[0].note, '3.2kg, healthy'); // \, unescaped
});

test('parseIcs: DATE-TIME with UTC Z converts to a local date', () => {
  const ics = ['BEGIN:VEVENT', 'DTSTART:20240815T230000Z', 'SUMMARY:Late flight home', 'END:VEVENT'].join('\r\n');
  const out = parseIcs(ics);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Late flight home');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(out[0].date));
});

test('parseIcs: a folded SUMMARY line is unfolded before reading', () => {
  const ics = [
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20200101',
    'SUMMARY:A very long event title that got fo',
    ' lded across two lines',
    'END:VEVENT',
  ].join('\r\n');
  assert.equal(parseIcs(ics)[0].title, 'A very long event title that got folded across two lines');
});

test('parseIcs: RRULE flags repeats, imports only the one occurrence', () => {
  const ics = ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20200315', 'SUMMARY:Wedding anniversary', 'RRULE:FREQ=YEARLY', 'END:VEVENT'].join('\r\n');
  const out = parseIcs(ics);
  assert.equal(out.length, 1);
  assert.equal(out[0].repeats, true);
});

test('parseIcs: CONTROL — an event with no RRULE is not flagged as repeating', () => {
  assert.equal(parseIcs(ICS_SIMPLE)[0].repeats, undefined);
});

test('parseIcs: a VEVENT with no DTSTART is kept with needsDate rather than dropped', () => {
  const out = parseIcs(['BEGIN:VEVENT', 'SUMMARY:Undated memory', 'END:VEVENT'].join('\r\n'));
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '');
  assert.equal(out[0].needsDate, true);
});

// ---------------------------------------------------------------------------
// parseFreeTextLines
// ---------------------------------------------------------------------------

test('parseFreeTextLines: leading date reads for free', () => {
  const { candidates, unparsedLines } = parseFreeTextLines('12.04.2019 Nora born', []);
  assert.equal(unparsedLines.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].date, '2019-04-12');
  assert.equal('datePrecision' in candidates[0], false);
  assert.equal(candidates[0].title, 'Nora born');
});

test('parseFreeTextLines: multi-word leading date with a dash separator', () => {
  const { candidates } = parseFreeTextLines('12 April 2019 — Jonas and Nora married', MEMBERS);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].date, '2019-04-12');
  assert.equal(candidates[0].title, 'Jonas and Nora married');
  assert.deepEqual(new Set(candidates[0].memberIds), new Set([JONAS.id, NORA.id]));
});

test('parseFreeTextLines: month/year-only leading date ("March 2019 moved to Vienna")', () => {
  const { candidates } = parseFreeTextLines('March 2019 moved to Vienna', []);
  assert.equal(candidates[0].date, '2019-03-01');
  assert.equal(candidates[0].datePrecision, 'month');
  assert.equal(candidates[0].title, 'moved to Vienna');
});

test('parseFreeTextLines: bare-year leading date, and a "2015:" colon form', () => {
  const { candidates } = parseFreeTextLines('2015 Jonas and Nora married\n2016: Mia started school', []);
  assert.equal(candidates[0].date, '2015-01-01');
  assert.equal(candidates[0].datePrecision, 'year');
  assert.equal(candidates[0].title, 'Jonas and Nora married');
  assert.equal(candidates[1].date, '2016-01-01');
  assert.equal(candidates[1].title, 'Mia started school');
});

test('parseFreeTextLines: trailing date is also read', () => {
  const { candidates } = parseFreeTextLines('Nora born 12.04.2019', []);
  assert.equal(candidates[0].date, '2019-04-12');
  assert.equal(candidates[0].title, 'Nora born');
});

test('parseFreeTextLines: a list bullet is not part of the date or title', () => {
  const { candidates } = parseFreeTextLines('- 12.04.2019 Nora born', []);
  assert.equal(candidates[0].date, '2019-04-12');
  assert.equal(candidates[0].title, 'Nora born');
});

test('parseFreeTextLines: a line with no readable date goes to unparsedLines, not dropped', () => {
  const { candidates, unparsedLines } = parseFreeTextLines('The year we got the dog', []);
  assert.equal(candidates.length, 0);
  assert.deepEqual(unparsedLines, ['The year we got the dog']);
});

test('parseFreeTextLines: splits on newlines and the "·" bullet separator', () => {
  const text = '12.04.2019 Nora born · 2015 Jonas and Nora married\n2019 moved to Vienna';
  const { candidates, unparsedLines } = parseFreeTextLines(text, []);
  assert.equal(candidates.length, 3);
  assert.equal(unparsedLines.length, 0);
});

// ---------------------------------------------------------------------------
// findDuplicates
// ---------------------------------------------------------------------------

const EXISTING: TimelineEntry[] = [
  { id: 'e1', date: '2019-04-12', title: 'Nora born', category: 'milestone' },
  { id: 'e2', date: '2019-03-01', datePrecision: 'month', title: 'Moved to Vienna' },
];

function candidate(over: Partial<TimelineCandidate>): TimelineCandidate {
  return { key: 'k', date: '2019-04-12', title: 'Nora born', memberIds: [], sourceText: 'src', ...over };
}

test('findDuplicates: same date + same title flags duplicateOf the existing entry', () => {
  assert.equal(findDuplicates([candidate({})], EXISTING, [])[0].duplicateOf, 'e1');
});

test('findDuplicates: CONTROL — a different date is NOT flagged, proving the check is real', () => {
  assert.equal(findDuplicates([candidate({ date: '2019-04-13' })], EXISTING, [])[0].duplicateOf, undefined);
});

test('findDuplicates: CONTROL — same date but an unrelated title is NOT flagged', () => {
  assert.equal(findDuplicates([candidate({ title: 'Started school' })], EXISTING, [])[0].duplicateOf, undefined);
});

test('findDuplicates: month-precision existing entry matches a known-day candidate in the same month', () => {
  const [out] = findDuplicates([candidate({ date: '2019-03-15', title: 'Moved to Vienna' })], EXISTING, []);
  assert.equal(out.duplicateOf, 'e2');
});

test('findDuplicates: a year-only candidate matches an existing entry in that year', () => {
  const [out] = findDuplicates([candidate({ date: '2019-01-01', datePrecision: 'year', title: 'Moved to Vienna' })], EXISTING, []);
  assert.equal(out.duplicateOf, 'e2');
});

test('findDuplicates: a "X born <date>" candidate matches a member birthdate with no existing entry', () => {
  const members = [{ id: 'nora', name: 'Nora', birthdate: '2019-04-12' }];
  assert.equal(findDuplicates([candidate({ title: 'Nora born' })], [], members)[0].duplicateOf, 'member:nora');
});

test('findDuplicates: CONTROL — the same born row for a DIFFERENT member is not matched', () => {
  const members = [{ id: 'ben', name: 'Ben', birthdate: '2019-04-12' }];
  assert.equal(findDuplicates([candidate({ title: 'Nora born' })], [], members)[0].duplicateOf, undefined);
});

test('findDuplicates: a dateless candidate is left untouched (nothing to compare)', () => {
  const [out] = findDuplicates([candidate({ date: '', needsDate: true })], EXISTING, []);
  assert.equal(out.duplicateOf, undefined);
  assert.equal(out.needsDate, true);
});

// ---------------------------------------------------------------------------
// Review-screen rules
// ---------------------------------------------------------------------------

test('importRowReason: duplicate, undated and year-only birth rows start unchecked', () => {
  assert.equal(importRowReason(candidate({ duplicateOf: 'e1' })), 'Already on the timeline');
  assert.equal(importRowReason(candidate({ date: '', needsDate: true })), 'Needs a date');
  assert.match(importRowReason(candidate({ date: '2019-01-01', datePrecision: 'year', title: 'Nora born' })) || '', /births already show/);
});

test('importRowReason: CONTROL — a dated, new, non-birth row is ready (null)', () => {
  assert.equal(importRowReason(candidate({ title: 'Started school' })), null);
  // and a year-only row that is NOT a birth is ready too
  assert.equal(importRowReason(candidate({ date: '2015-01-01', datePrecision: 'year', title: 'Got the dog' })), null);
});

test('datePrecisionChange: coarser keeps the known parts, finer never invents them', () => {
  assert.equal(datePrecisionChange('2019-04-12', 'day', 'month'), '2019-04-01');
  assert.equal(datePrecisionChange('2019-04-12', 'day', 'year'), '2019-01-01');
  assert.equal(datePrecisionChange('2019-04-01', 'month', 'day'), '', 'the day was never known');
  assert.equal(datePrecisionChange('2019-01-01', 'year', 'month'), '', 'the month was never known');
  assert.equal(datePrecisionChange('', 'day', 'year'), '');
});

test('datePrecisionChange: CONTROL — staying at day keeps the full date', () => {
  assert.equal(datePrecisionChange('2019-04-12', 'day', 'day'), '2019-04-12');
});


// Document extraction must compare within a scan and respect different owners.
{
 const candidate = {key:'one',date:'2013-01-01',datePrecision:'year' as const,title:'Started at Example Studio',category:'work' as const,memberIds:['a'],sourceText:'2013 Example Studio'};
 const rows = findDuplicates([candidate,{...candidate,key:'two'},{...candidate,key:'three',memberIds:['b']}],[]);
 assert.equal(rows[1].duplicateOf,'one');
 assert.equal(rows[2].duplicateOf,undefined,'different people can share a role or qualification');
}

{
 const document = {id:'cert',name:'Certificate',category:'Education' as const,fileName:'cert.pdf',fileType:'application/pdf',fileSize:20,uploadedAt:'2026-09-16',fileData:'https://files/cert',storagePath:'family/cert'};
 const person = {id:'a',name:'Alex',role:'Parent',clothingSizes:{},documents:[document]} as import('../types').FamilyMember;
 const vault = {...document,id:'vault-cert',downloadUrl:document.fileData,memberId:'a'};
 const sources = timelineDocumentSources([person],[vault],'a');
 assert.equal(sources.length,1,'profile/vault copy is scanned once');
 assert.equal(sources[0].vaultId,'vault-cert');
 assert.deepEqual(sources[0].memberIds,['a']);
 assert.equal(timelineDocumentSources([person],[{...vault,memberId:'b',storagePath:'other',downloadUrl:'other'}],'a').length,1,'another person’s vault file is excluded');
 const shared = timelineDocumentSources([], [{...vault,memberId:undefined}],'a');
 assert.deepEqual(shared[0].memberIds,[],'unassigned files never acquire the selected person automatically');
 const text = 'A'.repeat(18500)+'1999 Completed school'+'B'.repeat(22000);
 const chunks=timelineTextChunks(text);
 assert.ok(chunks.every(c=>c.length<=18000));
 assert.ok(chunks.some(c=>c.includes('1999 Completed school')));
 assert.equal(chunks[0]+chunks.slice(1).map(c=>c.slice(600)).join(''),text,'chunking retains the entire document');
}

assert.ok(findDuplicates([{key:'new',date:'',title:'First aid certificate',memberIds:['a'],sourceText:'First aid certificate'}],[{id:'old',date:'',title:'First aid certificate',memberIds:['a']}])[0].duplicateOf,'repeated scans also flag already-saved undated moments');
