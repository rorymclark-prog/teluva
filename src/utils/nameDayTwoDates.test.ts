// Standalone assertion test — no test runner is configured in this project:
//   npx tsx src/utils/nameDayTwoDates.test.ts
// Exits non-zero on failure.
//
// TWO DATES FOR ONE NAME.
//
// nameDay.ts has always recorded that some names genuinely have two days
// (`alsoOn`) and that WHICH ONE A FAMILY KEEPS IS A FAMILY FACT. Until now the
// UI printed the second date as an unpressable footnote, so the only way to
// keep it was to decline the suggestion and retype the date by hand — losing
// the feast name and the explanation — and keeping BOTH was impossible.
//
// What is worth testing here is not the table (nameDay.test.ts owns that) but
// the two things that fail silently and expensively:
//
//   1. THE NOTIFY INVARIANT. Keeping two days must not mean two annual push
//      notifications nobody asked for. Exactly one entry may be primary, and
//      only a primary may notify — in every combination of pick, main-choice
//      and pre-existing primary.
//   2. THE EXPLANATION MUST MATCH THE DATE STORED. Each entry is read again
//      months later, on the day, when "why is this the date?" is the whole
//      question. An entry kept on 15 August whose explanation says
//      "12 September" is how the app ends up looking wrong about a fact it
//      was right about.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keptDaysFor, suggestLocal, NameDayPick, KeptDay, TwoDaySuggestion } from './nameCelebrations';

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${(err as Error)?.message || err}`); }
}

// Maria, exactly as the real table holds her — the clearest two-day case and
// the one that prompted this feature.
const MARIA: TwoDaySuggestion = {
  matchedName: 'Maria',
  date: '09-12',
  feast: 'Mariä Namen',
  explanation: 'Maria is in the Austrian Namenskalender: Mariä Namen (12 September).',
  alsoOn: { date: '08-15', feast: 'Mariä Himmelfahrt' },
};

// A name with only one day — most of the calendar.
const AGNES: TwoDaySuggestion = {
  matchedName: 'Agnes',
  date: '01-21',
  feast: 'Hl. Agnes',
  explanation: 'Agnes is in the Austrian Namenskalender: Hl. Agnes (21 January).',
};

console.log('keptDaysFor — a name with one day is untouched');

check('one day in, one day out, explanation preserved verbatim', () => {
  const days = keptDaysFor(AGNES, 'suggested');
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '01-21');
  assert.equal(days[0].feast, 'Hl. Agnes');
  assert.equal(days[0].explanation, AGNES.explanation);
  assert.equal(days[0].primary, true);
  assert.equal(days[0].notify, true);
});

check('a pick that cannot apply NEVER invents a second day', () => {
  // Defensive: a caller passing 'both' for a name with no alsoOn must not get
  // a fabricated date. nameDay.ts's one rule is never invent a name day.
  for (const pick of ['suggested', 'also', 'both'] as NameDayPick[]) {
    const days = keptDaysFor(AGNES, pick);
    assert.equal(days.length, 1, `pick '${pick}' produced ${days.length} days for a one-day name`);
    assert.equal(days[0].date, '01-21');
  }
});

console.log('keptDaysFor — the suggested day (the pre-existing path)');

check('keeps the catalogued day and does not rewrite its explanation', () => {
  const days = keptDaysFor(MARIA, 'suggested');
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '09-12');
  assert.equal(days[0].feast, 'Mariä Namen');
  // Unchanged wording is the point: this path predates the feature and its
  // phrasing is asserted by nameCelebrations.test.ts.
  assert.equal(days[0].explanation, MARIA.explanation);
});

console.log('keptDaysFor — the alternative day');

check('keeps 15 August with ITS feast, not the one we suggested', () => {
  const days = keptDaysFor(MARIA, 'also');
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '08-15');
  assert.equal(days[0].feast, 'Mariä Himmelfahrt');
  assert.equal(days[0].primary, true);
  assert.equal(days[0].notify, true);
});

check('its explanation names the day actually kept, and both dates', () => {
  const [day] = keptDaysFor(MARIA, 'also');
  assert.match(day.explanation, /15 August/, 'the stored date is missing from its own explanation');
  assert.match(day.explanation, /Mariä Himmelfahrt/);
  // Naming the other day too is what stops the entry reading like a mistake
  // to whoever opens it next.
  assert.match(day.explanation, /12 September/);
  assert.match(day.explanation, /Mariä Namen/);
});

console.log('keptDaysFor — keeping both');

check('returns two distinct days', () => {
  const days = keptDaysFor(MARIA, 'both');
  assert.equal(days.length, 2);
  assert.notEqual(days[0].date, days[1].date);
  assert.deepEqual(days.map((d) => d.date).sort(), ['08-15', '09-12']);
});

check('the main day leads and is the only one that notifies', () => {
  const days = keptDaysFor(MARIA, 'both', 'suggested');
  assert.equal(days[0].date, '09-12');
  assert.equal(days[0].primary, true);
  assert.equal(days[0].notify, true);
  // The whole point of the invariant: a family keeping two days must not be
  // signed up for two annual notifications by doing so.
  assert.equal(days[1].date, '08-15');
  assert.equal(days[1].primary, false);
  assert.equal(days[1].notify, false);
});

check('choosing the alternative as the main day reverses which one notifies', () => {
  const days = keptDaysFor(MARIA, 'both', 'also');
  assert.equal(days[0].date, '08-15');
  assert.equal(days[0].primary, true);
  assert.equal(days[0].notify, true);
  assert.equal(days[1].date, '09-12');
  assert.equal(days[1].primary, false);
  assert.equal(days[1].notify, false);
});

check('both entries say both days are kept', () => {
  for (const day of keptDaysFor(MARIA, 'both')) {
    assert.match(day.explanation, /keeps both/i, `"${day.feast}" does not say the family keeps both days`);
    assert.match(day.explanation, /12 September/);
    assert.match(day.explanation, /15 August/);
  }
});

console.log('keptDaysFor — a member who already keeps another day');

check('nothing claims primary over a celebration the family chose earlier', () => {
  // The caller's primary-choice screen asks the person. Demoting a day they
  // already chose is never this function's call to make.
  for (const pick of ['suggested', 'also', 'both'] as NameDayPick[]) {
    for (const day of keptDaysFor(MARIA, pick, 'suggested', true)) {
      assert.equal(day.primary, false, `pick '${pick}' claimed primary over an existing one`);
      assert.equal(day.notify, false, `pick '${pick}' would notify without being the primary`);
    }
  }
});

console.log('keptDaysFor — the invariant, swept');

check('at most one primary, and notify never outlives primary, in every combination', () => {
  const combos: [NameDayPick, 'suggested' | 'also', boolean][] = [];
  for (const pick of ['suggested', 'also', 'both'] as NameDayPick[]) {
    for (const main of ['suggested', 'also'] as const) {
      for (const hasPrimary of [false, true]) combos.push([pick, main, hasPrimary]);
    }
  }
  for (const [pick, main, hasPrimary] of combos) {
    for (const subject of [MARIA, AGNES]) {
      const days: KeptDay[] = keptDaysFor(subject, pick, main, hasPrimary);
      const label = `${subject.matchedName}/${pick}/${main}/existing=${hasPrimary}`;
      assert.ok(days.length >= 1, `${label} produced nothing`);
      assert.ok(days.filter((d) => d.primary).length <= 1, `${label} produced more than one primary`);
      for (const d of days) {
        if (d.notify) assert.equal(d.primary, true, `${label} notifies on a non-primary day`);
        assert.match(d.date, /^\d{2}-\d{2}$/, `${label} produced a malformed date`);
        assert.ok(d.feast.trim().length > 0, `${label} produced a day with no feast`);
        assert.ok(d.explanation.trim().length > 0, `${label} produced a day with no explanation`);
      }
    }
  }
});

console.log('the real table still carries Maria\'s second day');

check('suggestLocal on a Maria yields an alsoOn that flows straight in', () => {
  // End-to-end through the actual calendar, so a table edit that drops the
  // second date fails here rather than quietly removing the choice from the UI.
  const hit = suggestLocal({ name: 'Maria Steiner' });
  assert.ok(hit, 'the Namenskalender no longer recognises Maria');
  assert.equal(hit.date, '09-12');
  assert.ok(hit.alsoOn, 'Maria lost her second day — the chooser will not appear');
  assert.equal(hit.alsoOn.date, '08-15');

  const days = keptDaysFor({ ...hit, matchedName: hit.matchedName }, 'both');
  assert.equal(days.length, 2);
  assert.deepEqual(days.map((d) => d.date).sort(), ['08-15', '09-12']);
});

check('a name with no second day offers no choice', () => {
  const hit = suggestLocal({ name: 'Agnes Bauer' });
  assert.ok(hit);
  assert.equal(hit.alsoOn, undefined, 'Agnes gained a second day she does not have');
});

// ---------------------------------------------------------------------------
// The wiring. These are source assertions, the same technique
// nameCelebrationGate.test.ts uses: the logic above is only reached if the
// modal actually routes through it, and a tidy-up that goes back to building
// one celebration from `view` would pass every test above while restoring the
// exact dead-end this feature removed.
// ---------------------------------------------------------------------------
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
const modal = read('components/NameCelebrationModal.tsx');
const editor = read('components/EditMemberModal.tsx');

console.log('the modal is wired to the chooser');

check('the confirm path goes through keptDaysFor', () => {
  assert.match(modal, /keptDaysFor/, 'the modal no longer calls keptDaysFor — the second date is unreachable again');
});

check('the alternative date is a control, not a footnote', () => {
  assert.doesNotMatch(
    modal,
    /Some families instead keep/,
    'the passive "Some families instead keep …" footnote is back: it states the alternative and offers no way to take it.',
  );
});

check('the modal can hand back more than one celebration', () => {
  assert.match(
    modal,
    /onConfirm:\s*\(celebrations:\s*NameCelebration\[\]\)\s*=>\s*void/,
    'onConfirm no longer takes an array — keeping both days cannot be expressed.',
  );
});

console.log('the editor folds a batch without breaking the single-primary rule');

check('the demotion runs once for the whole batch', () => {
  const handler = editor.match(/const handleConfirmCelebration = [\s\S]*?\n {2}\};/);
  assert.ok(handler, 'handleConfirmCelebration has gone');
  assert.match(
    handler[0],
    /some\(\(c\) => c\.primary\)/,
    'the editor no longer checks the whole batch for a primary before demoting — folding two days in would either '
      + 'demote nothing or demote the day it just added.',
  );
  assert.match(handler[0], /\.\.\.added/, 'the batch is not spread into the list — only one of the two days would be kept.');
});

if (failures) {
  console.error(`\nnameDayTwoDates.test.ts: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nnameDayTwoDates.test.ts: all assertions passed');
