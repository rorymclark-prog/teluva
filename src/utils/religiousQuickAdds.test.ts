// Standalone assertion test — no test runner is configured in this project,
// so run it directly: npx tsx src/utils/religiousQuickAdds.test.ts
// Exits non-zero on failure.
//
// Covers the 'Religious' AnniversaryKind added 2026-09-16 (Rory: "i think we
// should have options to add religious or spiritually important days"):
//   * the kind itself renders with a friendly label and its own icon, and
//     doesn't disturb the five kinds that came before it (CONTROL);
//   * the Computus math behind the Easter quick-add chips is independently
//     correct — checked against dates verified via WebSearch on 2026-09-16,
//     not recalled from memory (see the Sources list in this change's report);
//   * every new quick-add chip prefills the right title/kind, and either a
//     correct computed date (fixed/Easter) or a blank date + caveat (lunar/
//     lunisolar) — never a guessed date;
//   * a pre-existing quick-add chip is unaffected (CONTROL).
//
// This module has no Firebase/db.ts dependency (see its own header comment),
// unlike AnniversariesView.tsx which imports it — importing the component
// directly here would trigger a Firebase auth redirect-sign-in attempt at
// module load time in this Node/tsx environment.
import assert from 'node:assert/strict';
import {
  KINDS,
  KIND_LABELS,
  KIND_ICONS,
  QUICK_ADDS,
  quickAddDate,
  gregorianEaster,
  orthodoxEaster,
} from './religiousQuickAdds';

// --- the kind itself --------------------------------------------------------

assert.ok(KINDS.includes('Religious'), 'Religious must be a selectable kind');
assert.equal(KIND_LABELS.Religious, 'Religious or spiritual', 'the stored value alone reads oddly in the UI — needs the friendlier label');
assert.ok(KIND_ICONS.Religious, 'Religious needs an icon');
assert.notEqual(KIND_ICONS.Religious, KIND_ICONS.Wedding, "Religious must have its OWN icon, not reuse Wedding's");

// CONTROL — the five pre-existing kinds are untouched by this change.
for (const k of ['Wedding', 'Engagement', 'Adoption', 'Anniversary', 'Other'] as const) {
  assert.equal(KIND_LABELS[k], k, `${k}'s label must still read as itself, unlike Religious`);
}

// --- Computus: Western (Gregorian) Easter -----------------------------------
// Reference dates verified via WebSearch on 2026-09-16:
//   "Easter Sunday 2024 date" -> Sunday, 31 March 2024
//   "Easter Sunday 2025 date" -> Sunday, 20 April 2025
//   "Easter Sunday 2026 date" -> Sunday, 5 April 2026
//   "Easter Sunday 2027 date" -> Sunday, 28 March 2027

assert.equal(gregorianEaster(2024), '03-31');
assert.equal(gregorianEaster(2025), '04-20');
assert.equal(gregorianEaster(2026), '04-05');
assert.equal(gregorianEaster(2027), '03-28');

// --- Computus: Orthodox Easter -----------------------------------------------
// Reference dates verified via WebSearch on 2026-09-16:
//   "Orthodox Easter 2025 date" -> Sunday, 20 April 2025 (coincided with the West that year)
//   "Orthodox Easter 2026 date" -> Sunday, 12 April 2026

assert.equal(orthodoxEaster(2025), '04-20');
assert.equal(orthodoxEaster(2026), '04-12');

// --- quick-add chips: fixed and computed dates ------------------------------

{
  const christmas = QUICK_ADDS.find(qa => qa.key === 'christmas')!;
  assert.equal(christmas.kind, 'Religious');
  assert.equal(christmas.title, 'Christmas');
  assert.equal(christmas.dateless, undefined, 'Christmas is a genuine fixed date, not left blank');
  assert.equal(quickAddDate('christmas'), '12-25');

  const easter = QUICK_ADDS.find(qa => qa.key === 'easter')!;
  assert.equal(easter.kind, 'Religious');
  assert.equal(easter.dateless, undefined, 'Easter is computed, not left blank');
  const thisYear = new Date().getFullYear();
  assert.equal(quickAddDate('easter'), gregorianEaster(thisYear), 'the chip must compute fresh for the current year, not a baked-in date');

  const orthodox = QUICK_ADDS.find(qa => qa.key === 'orthodox-easter')!;
  assert.equal(orthodox.kind, 'Religious');
  assert.equal(quickAddDate('orthodox-easter'), orthodoxEaster(thisYear));
}

// --- quick-add chips: lunar/lunisolar — blank date + caveat -----------------

{
  const lunarKeys = [
    'ramadan-start', 'eid-fitr', 'eid-adha', 'rosh-hashanah',
    'yom-kippur', 'hanukkah', 'passover', 'diwali', 'vesak', 'lunar-new-year',
  ] as const;

  for (const key of lunarKeys) {
    const qa = QUICK_ADDS.find(q => q.key === key);
    assert.ok(qa, `${key} must be a quick-add chip`);
    assert.equal(qa!.kind, 'Religious');
    assert.equal(qa!.dateless, true, `${key} must be marked dateless — never a guessed date`);
    assert.ok(qa!.caveat && qa!.caveat.length > 0, `${key} must explain why its date is blank`);
    assert.equal(quickAddDate(key), '', `${key} must not prefill any date`);
  }

  // A representative spread across traditions, not just one.
  const titles = lunarKeys.map(k => QUICK_ADDS.find(q => q.key === k)!.title);
  assert.ok(titles.some(t => /Ramadan|Eid/.test(t)), 'Muslim observances must be represented');
  assert.ok(titles.some(t => /Rosh Hashanah|Yom Kippur|Hanukkah|Passover/.test(t)), 'Jewish observances must be represented');
  assert.ok(titles.some(t => /Diwali/.test(t)), 'Hindu observances must be represented');
  assert.ok(titles.some(t => /Vesak/.test(t)), 'Buddhist observances must be represented');
}

// CONTROL — a pre-existing, non-religious quick-add chip is unaffected: still
// kind 'Other', still a computed date, no caveat forced onto it.
{
  const mothers = QUICK_ADDS.find(qa => qa.key === 'mothers')!;
  assert.equal(mothers.kind, 'Other');
  assert.equal(mothers.dateless, undefined);
  assert.equal(mothers.caveat, undefined);
  assert.ok(/^\d{2}-\d{2}$/.test(quickAddDate('mothers')), "Mother's Day must still resolve to a real MM-DD date");
}

console.log('religiousQuickAdds.test.ts: all assertions passed');
