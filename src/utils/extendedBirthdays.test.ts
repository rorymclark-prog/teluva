// Standalone assertion test — same convention as familyDates.test.ts:
//   npx tsx src/utils/extendedBirthdays.test.ts
// Exits non-zero on failure.
//
// Covers the two halves of the v228 split-brain fix:
//   extendedBirthdaySources.withContactBirthdays — the read-side safety net
//     that folds a legacy ContactEntry.birthdate into the extended-birthday
//     list so it behaves identically wherever one still exists (an unmigrated
//     family, or a phone on a cached older build of the PWA).
//   aiApply.applyExtendedBirthdayEdits — the write side, now that the
//     assistant has an `extended_birthday` kind to write instead of being
//     pointed at a contact's birthdate.
//
// The dedupe rules are the point of both: the same person must not end up
// listed twice, and two DIFFERENT people who share a day must both survive.
import assert from 'node:assert';
import { withContactBirthdays, isFromContact } from './extendedBirthdaySources';
import { applyExtendedBirthdayEdits, hasExtendedBirthdayEdits } from './aiApply';
import type { AiEdit } from '../components/AIChatbot';
import type { ContactEntry, ExtendedBirthday } from '../types';

function eb(partial: Partial<ExtendedBirthday> & Pick<ExtendedBirthday, 'id' | 'name' | 'date'>): ExtendedBirthday {
  return { createdAt: '2026-08-20', ...partial };
}

function contact(partial: Partial<ContactEntry> & Pick<ContactEntry, 'id' | 'name'>): ContactEntry {
  return { ...partial };
}

// ── withContactBirthdays: a contact birthday becomes a full entry ──────────
{
  const merged = withContactBirthdays([], [
    contact({ id: 'c1', name: 'Granny Sue', birthdate: '1948-03-04', relation: 'Grandmother', note: 'Loves lilies' }),
  ]);
  assert.strictEqual(merged.length, 1);
  assert.deepStrictEqual(merged[0], {
    id: 'contact-c1',
    name: 'Granny Sue',
    relationship: 'Grandmother',
    date: '03-04',
    originalYear: 1948,
    notes: 'Loves lilies',
    createdAt: '',
  });
  assert.ok(isFromContact(merged[0]), 'a synthesised entry must be identifiable as contact-sourced');
}

// ── a contact with no birthdate, no name or a junk date is skipped ─────────
{
  const merged = withContactBirthdays([], [
    contact({ id: 'c1', name: 'No Birthday' }),
    contact({ id: 'c2', name: '   ', birthdate: '1970-01-01' }),
    contact({ id: 'c3', name: 'Bad Date', birthdate: '4 March' }),
    contact({ id: 'c4', name: 'Month Day Only', birthdate: '03-04' }),
  ]);
  assert.deepStrictEqual(merged, [], 'only a full YYYY-MM-DD birthdate on a named contact counts');
}

// ── the real ExtendedBirthday wins over a duplicate contact ────────────────
//    It is the richer record (relationship + notes the family typed) and the
//    only one they can edit, so the contact copy must not shadow or double it.
{
  const real = eb({ id: 'x1', name: 'Granny Sue', date: '03-04', relationship: 'Grandmother', originalYear: 1948 });
  const merged = withContactBirthdays([real], [
    contact({ id: 'c1', name: '  granny sue ', birthdate: '1948-03-04', relation: 'Gran' }),
  ]);
  assert.strictEqual(merged.length, 1, 'the same person recorded in both homes must appear once');
  assert.strictEqual(merged[0], real, 'and it must be the dedicated record that survives');
}

// ── two DIFFERENT people sharing a day both survive ────────────────────────
{
  const merged = withContactBirthdays([eb({ id: 'x1', name: 'Granny Sue', date: '03-04' })], [
    contact({ id: 'c1', name: 'Uncle Ben', birthdate: '1955-03-04' }),
  ]);
  assert.strictEqual(merged.length, 2);
  assert.deepStrictEqual(merged.map(e => e.name).sort(), ['Granny Sue', 'Uncle Ben']);
}

// ── the same contact listed twice only lands once ─────────────────────────
{
  const merged = withContactBirthdays([], [
    contact({ id: 'c1', name: 'Auntie Jo', birthdate: '1962-11-09' }),
    contact({ id: 'c2', name: 'Auntie Jo', birthdate: '1962-11-09' }),
  ]);
  assert.strictEqual(merged.length, 1);
}

// ── blank relationship/notes collapse to undefined, not empty strings ──────
//    OnThisDay and NeedsAttention branch on truthiness; '' would render an
//    empty dash-separated fragment.
{
  const [entry] = withContactBirthdays([], [
    contact({ id: 'c1', name: 'Plain', birthdate: '1990-06-15', relation: '   ', note: '' }),
  ]);
  assert.strictEqual(entry.relationship, undefined);
  assert.strictEqual(entry.notes, undefined);
}

// ── the input list is never mutated ────────────────────────────────────────
{
  const existing = [eb({ id: 'x1', name: 'Granny Sue', date: '03-04' })];
  withContactBirthdays(existing, [contact({ id: 'c1', name: 'Uncle Ben', birthdate: '1955-03-04' })]);
  assert.strictEqual(existing.length, 1, 'withContactBirthdays must not push into its argument');
}

// ── 29 February is carried through untouched ──────────────────────────────
//    The collapse-to-28-in-an-ordinary-year convention lives in nameDay.ts and
//    server/yearlyCelebrations.mjs; this layer must not pre-empt it.
{
  const [entry] = withContactBirthdays([], [contact({ id: 'c1', name: 'Leapling', birthdate: '2000-02-29' })]);
  assert.strictEqual(entry.date, '02-29');
}

// ── applyExtendedBirthdayEdits: the happy path ────────────────────────────
{
  const edits: AiEdit[] = [
    { kind: 'extended_birthday', name: 'Godfather Karl', relationship: 'Godfather', date: '07-21', originalYear: 1959, notes: 'Vienna' },
  ];
  assert.ok(hasExtendedBirthdayEdits(edits));
  const out = applyExtendedBirthdayEdits([], edits);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'Godfather Karl');
  assert.strictEqual(out[0].date, '07-21');
  assert.strictEqual(out[0].originalYear, 1959);
  assert.strictEqual(out[0].relationship, 'Godfather');
  assert.ok(out[0].id, 'a new record needs an id');
  assert.match(out[0].createdAt, /^\d{4}-\d{2}-\d{2}$/);
}

// ── a full YYYY-MM-DD from the model is DROPPED, not sliced ───────────────
//    Slicing would look like it worked while leaving originalYear empty, i.e.
//    silently losing the birth year the model just supplied.
{
  const out = applyExtendedBirthdayEdits([], [
    { kind: 'extended_birthday', name: 'Granny Sue', date: '1948-03-04' },
    { kind: 'extended_birthday', name: 'No Date', date: '' },
    { kind: 'extended_birthday', name: '  ', date: '03-04' },
  ] as AiEdit[]);
  assert.deepStrictEqual(out, []);
}

// ── mentioning the same person in two sessions doesn't create two ─────────
{
  const existing = [eb({ id: 'x1', name: 'Granny Sue', date: '03-04' })];
  const out = applyExtendedBirthdayEdits(existing, [
    { kind: 'extended_birthday', name: 'granny sue', date: '03-04', relationship: 'Gran' },
  ] as AiEdit[]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'x1', 'the record already on file is kept as-is');
  assert.strictEqual(existing.length, 1, 'and the input array is not mutated');
}

// ── two people sharing a day are both added ───────────────────────────────
{
  const out = applyExtendedBirthdayEdits([], [
    { kind: 'extended_birthday', name: 'Granny Sue', date: '03-04' },
    { kind: 'extended_birthday', name: 'Uncle Ben', date: '03-04' },
  ] as AiEdit[]);
  assert.strictEqual(out.length, 2);
  assert.notStrictEqual(out[0].id, out[1].id);
}

// ── a non-integer year is dropped rather than stored ──────────────────────
{
  const out = applyExtendedBirthdayEdits([], [
    { kind: 'extended_birthday', name: 'Fuzzy', date: '05-05', originalYear: 1959.5 },
  ] as AiEdit[]);
  assert.strictEqual(out[0].originalYear, undefined);
}

// ── unrelated edit kinds are ignored ──────────────────────────────────────
{
  const edits = [{ kind: 'anniversary', label: 'Wedding', date: '06-01' }] as unknown as AiEdit[];
  assert.strictEqual(hasExtendedBirthdayEdits(edits), false);
  assert.deepStrictEqual(applyExtendedBirthdayEdits([], edits), []);
}

// ── a stray birthdate on a `contact` edit is re-routed, not dropped ───────
//    The prompt stopped asking for it and applyInfoEdits stopped writing it,
//    so without this the model volunteering one would lose the birthday
//    silently — worse than the bug being fixed, because the family would have
//    been told it was saved.
{
  const edits = [
    { kind: 'contact', name: 'Granny Sue', relation: 'Grandmother', phone: '0664 111', birthdate: '1948-03-04' },
  ] as unknown as AiEdit[];
  assert.ok(hasExtendedBirthdayEdits(edits), 'a contact edit with a birthdate must trigger the extended-birthday write');
  const out = applyExtendedBirthdayEdits([], edits);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, 'Granny Sue');
  assert.strictEqual(out[0].date, '03-04');
  assert.strictEqual(out[0].originalYear, 1948);
  assert.strictEqual(out[0].relationship, 'Grandmother');
}

// ── an ordinary contact edit stays out of the birthday list ───────────────
{
  const edits = [{ kind: 'contact', name: 'School Office', phone: '01 555' }] as unknown as AiEdit[];
  assert.strictEqual(hasExtendedBirthdayEdits(edits), false);
  assert.deepStrictEqual(applyExtendedBirthdayEdits([], edits), []);
}

// ── and it doesn't double up with an explicit edit for the same person ────
{
  const out = applyExtendedBirthdayEdits([], [
    { kind: 'extended_birthday', name: 'Granny Sue', date: '03-04', originalYear: 1948 },
    { kind: 'contact', name: 'Granny Sue', birthdate: '1948-03-04' },
  ] as unknown as AiEdit[]);
  assert.strictEqual(out.length, 1);
}

// ── a partial birthdate on a contact edit is ignored, not half-saved ──────
{
  const edits = [{ kind: 'contact', name: 'Vague', birthdate: '03-04' }] as unknown as AiEdit[];
  assert.strictEqual(hasExtendedBirthdayEdits(edits), false);
}

console.log('extendedBirthdays.test.ts: all assertions passed');
