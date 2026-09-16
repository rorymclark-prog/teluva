import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIFE_CATEGORY_IDS,
  TIMELINE_PARSE_MAX_ROWS,
  isValidTimelineDate,
  timelineParseSystem,
  sanitizeTimelineRows,
} from './timelineParse.mjs';

// Fictional family only — this repo is public.
const MEMBERS = [
  { id: 'm-mia', name: 'Mia Lindqvist' },
  { id: 'm-ben', name: 'Ben Lindqvist' },
];

const TEXT = [
  'Nora was born on 12 April 2019, healthy and 3.2kg.',
  'We moved into the new house in March 2019.',
  'Sometime in the summer of 2015 we got the dog.',
].join('\n');

const NORA = 'Nora was born on 12 April 2019, healthy and 3.2kg.';
const MOVE = 'We moved into the new house in March 2019.';
const DOG = 'Sometime in the summer of 2015 we got the dog.';

test('the category list matches lifeTimeline.ts LIFE_CATEGORIES exactly (no drift)', () => {
  const src = readFileSync(new URL('../src/utils/lifeTimeline.ts', import.meta.url), 'utf8');
  const block = /export const LIFE_CATEGORIES[^=]*=\s*\[([\s\S]*?)\];/.exec(src);
  assert.ok(block, 'LIFE_CATEGORIES must still be declared in lifeTimeline.ts');
  const ids = [...block[1].matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, LIFE_CATEGORY_IDS);
});

test('keeps a well-formed day-precision row, with NO datePrecision key', () => {
  const out = sanitizeTimelineRows({
    rows: [{
      date: '2019-04-12', title: 'Nora born',
      category: 'milestone', memberIds: ['m-mia'], note: '3.2kg', sourceText: NORA,
    }],
  }, MEMBERS, TEXT);
  assert.deepEqual(out, [{
    date: '2019-04-12', title: 'Nora born',
    category: 'milestone', memberIds: ['m-mia'], note: '3.2kg', sourceText: NORA,
  }]);
  assert.equal('datePrecision' in out[0], false, 'a known day is stored as an absent precision');
});

test('an old-style "day" precision is read as a known day and dropped from the row', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2019-04-12', datePrecision: 'day', title: 'Nora born', category: 'milestone', memberIds: [], sourceText: NORA }],
  }, MEMBERS, TEXT);
  assert.equal(out.length, 1);
  assert.equal('datePrecision' in out[0], false);
});

test('CONTROL — the same row with sourceText NOT in the input is dropped', () => {
  // Proves the verbatim-substring guard actually rejects, not just passes.
  const out = sanitizeTimelineRows({
    rows: [{
      date: '2019-04-12', title: 'Nora born', category: 'milestone', memberIds: [],
      sourceText: 'Nora was born in a hospital in Vienna on a rainy Tuesday.',
    }],
  }, MEMBERS, TEXT);
  assert.deepEqual(out, []);
});

test('a hallucinated event with no basis in the input text is dropped', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2020-01-01', title: 'Won the lottery', category: 'milestone', memberIds: [], sourceText: 'Won the lottery' }],
  }, MEMBERS, TEXT);
  assert.deepEqual(out, []);
});

test('an out-of-list category is coerced to "other", not dropped', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2019-03-01', datePrecision: 'month', title: 'Moved house', category: 'Relocation', memberIds: [], sourceText: MOVE }],
  }, MEMBERS, TEXT);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'other');
});

test('an old-style type word ("Birth") is not a LifeCategory id — it becomes "other"', () => {
  // The closed list is the LifeCategory ids; the old TIMELINE_TYPES words are not in it.
  const out = sanitizeTimelineRows({
    rows: [{ date: '2019-03-01', datePrecision: 'month', title: 'Moved house', category: 'Birth', memberIds: [], sourceText: MOVE }],
  }, MEMBERS, TEXT);
  assert.equal(out[0].category, 'other');
});

test('CONTROL — an in-list category survives unchanged', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2019-03-01', datePrecision: 'month', title: 'Moved house', category: 'home', memberIds: [], sourceText: MOVE }],
  }, MEMBERS, TEXT);
  assert.equal(out[0].category, 'home');
  assert.equal(out[0].datePrecision, 'month');
});

test('a missing category becomes "other"', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2019-03-01', datePrecision: 'month', title: 'Moved house', memberIds: [], sourceText: MOVE }],
  }, MEMBERS, TEXT);
  assert.equal(out[0].category, 'other');
});

test('a memberId the caller never offered is filtered out, the row survives', () => {
  const out = sanitizeTimelineRows({
    rows: [{
      date: '2019-03-01', datePrecision: 'month', title: 'Moved house',
      category: 'home', memberIds: ['m-mia', 'm-unknown-intruder'], sourceText: MOVE,
    }],
  }, MEMBERS, TEXT);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].memberIds, ['m-mia']);
});

test('unexpected keys from the model are stripped', () => {
  const out = sanitizeTimelineRows({
    rows: [{
      date: '2019-03-01', datePrecision: 'month', title: 'Moved house', category: 'home',
      memberIds: [], sourceText: MOVE, id: 'tl-evil', importBatchId: 'x', photos: [{ url: 'https://evil' }],
    }],
  }, MEMBERS, TEXT);
  assert.deepEqual(Object.keys(out[0]).sort(), ['category', 'date', 'datePrecision', 'memberIds', 'sourceText', 'title']);
});

test('year precision requires 01-01; a model claiming a specific day at year precision is rejected', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2015-06-15', datePrecision: 'year', title: 'Got the dog', category: 'milestone', memberIds: [], sourceText: DOG }],
  }, MEMBERS, TEXT);
  assert.deepEqual(out, [], 'a specific day/month at year precision means the model invented one');
});

test('CONTROL — the correctly-normalised year-precision row DOES survive', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2015-01-01', datePrecision: 'year', title: 'Got the dog', category: 'milestone', memberIds: [], sourceText: DOG }],
  }, MEMBERS, TEXT);
  assert.equal(out.length, 1);
  assert.equal(out[0].datePrecision, 'year');
});

test('month precision requires day 01', () => {
  const bad = sanitizeTimelineRows({
    rows: [{ date: '2019-03-15', datePrecision: 'month', title: 'Moved house', category: 'home', memberIds: [], sourceText: MOVE }],
  }, MEMBERS, TEXT);
  assert.deepEqual(bad, []);
});

test('isValidTimelineDate: precision rules and calendar validity', () => {
  assert.equal(isValidTimelineDate('2024-02-29', undefined), true);
  assert.equal(isValidTimelineDate('2023-02-29', undefined), false);
  assert.equal(isValidTimelineDate('2019-03-01', 'month'), true);
  assert.equal(isValidTimelineDate('2019-03-02', 'month'), false);
  assert.equal(isValidTimelineDate('2019-01-01', 'year'), true);
  assert.equal(isValidTimelineDate('2019-02-01', 'year'), false);
  assert.equal(isValidTimelineDate('2019-3-1', undefined), false);
});

test('an empty date survives for explicit undated review, never defaulted', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '', title: 'Something happened', category: 'other', memberIds: [], sourceText: 'Nora was born' }],
  }, MEMBERS, TEXT);
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '');
});

test('an impossible calendar date (31 Feb) is rejected', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2024-02-31', title: 'x', category: 'other', memberIds: [], sourceText: 'Nora was born' }],
  }, MEMBERS, TEXT);
  assert.deepEqual(out, []);
});

test('a missing title drops the row', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2019-04-12', title: '', category: 'milestone', memberIds: [], sourceText: NORA }],
  }, MEMBERS, TEXT);
  assert.deepEqual(out, []);
});

test('duplicate rows (same date + same title) collapse to one', () => {
  const row = { date: '2019-04-12', title: 'Nora born', category: 'milestone', memberIds: [], sourceText: NORA };
  const out = sanitizeTimelineRows({ rows: [row, { ...row }, { ...row }] }, MEMBERS, TEXT);
  assert.equal(out.length, 1);
});

test('more than the row cap are capped', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    date: '2019-03-01', datePrecision: 'month', title: `Event ${i}`, category: 'other', memberIds: [], sourceText: MOVE,
  }));
  const out = sanitizeTimelineRows({ rows }, MEMBERS, TEXT);
  assert.equal(out.length, TIMELINE_PARSE_MAX_ROWS);
});

test('garbage shapes return an empty list, never throw', () => {
  assert.deepEqual(sanitizeTimelineRows(null, MEMBERS, TEXT), []);
  assert.deepEqual(sanitizeTimelineRows({ rows: 'nope' }, MEMBERS, TEXT), []);
  assert.deepEqual(sanitizeTimelineRows({ rows: [null, 42, 'x'] }, MEMBERS, TEXT), []);
  assert.deepEqual(sanitizeTimelineRows({ rows: [{}] }, [], ''), []);
});

test('no members offered means every memberId is filtered out, never a bare crash', () => {
  const out = sanitizeTimelineRows({
    rows: [{ date: '2019-04-12', title: 'Nora born', category: 'milestone', memberIds: ['m-mia'], sourceText: NORA }],
  }, [], TEXT);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].memberIds, []);
});

test('the system prompt names every LifeCategory id and never fabricates a fallback date', () => {
  const sys = timelineParseSystem(MEMBERS, '2026-09-13');
  for (const t of LIFE_CATEGORY_IDS) assert.ok(sys.includes(`"${t}"`), t);
  assert.ok(sys.includes('NEVER invent a day, month, or year'));
  assert.ok(sys.includes('m-mia: Mia Lindqvist'));
  assert.ok(!/"day"/.test(sys), 'the prompt must not offer "day" as a precision — absent means day');
});

test('the system prompt with no members says memberIds must be empty', () => {
  const sys = timelineParseSystem([], '2026-09-13');
  assert.ok(sys.includes('memberIds" must be an empty array'));
});

test('server.js wires the route with the member/quota preamble and the sanitiser', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = server.indexOf("app.post('/api/timeline/parse'");
  assert.ok(start > 0, 'POST /api/timeline/parse must exist');
  const body = server.slice(start, server.indexOf('\n});', start));
  for (const needle of ['requireMember(req)', 'aiRateLimited(caller.uid)', 'aiGateBlocked(caller)', 'checkAiUsage(caller.familyId)', 'recordAiUsage(caller.familyId)', 'sanitizeTimelineRows(parsed, memberList, text)', 'TIMELINE_PARSE_MAX_CHARS']) {
    assert.ok(body.includes(needle), `route must call ${needle}`);
  }
  // CONTROL: the slice really is the route body, not the whole file.
  assert.ok(!body.includes("app.post('/api/doc-key-facts'"), 'the route slice must stop at its own closing brace');
});


test('historical documents preserve relative dates and distinguish delivered training from education', () => {
  const prompt = timelineParseSystem(MEMBERS, '2026-09-16', true);
  assert.match(prompt, /Do not resolve present/);
  assert.match(prompt, /trainer belong to work/);
});
