import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_WORKING_AGE, minWorkingAge, ageInYears, hideWorkFields, workingAgeNote, ADULT_AGE, hideSpouseField, spouseAgeNote } from './ageGates';
import { IdCountry } from '../types';

const here = path.dirname(fileURLToPath(import.meta.url));   // never .pathname — a space in the path silently no-ops
const root = path.resolve(here, '../..');

// A fixed "today" so the arithmetic below never depends on when this runs.
const NOW = new Date('2026-08-20T12:00:00Z');
const bornYearsAgo = (y: number, monthOffset = 0) => {
  const d = new Date(NOW);
  d.setFullYear(d.getFullYear() - y);
  d.setMonth(d.getMonth() + monthOffset);
  return d.toISOString().slice(0, 10);
};

// --- the table must cover every country the app can be set to ---------------
// A missing entry would silently fall back to the AT default, which is the
// quiet kind of wrong: right for four countries and unnoticed for the fifth.
{
  const declared = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8')
    .match(/export type IdCountry\s*=\s*([^;]+);/)?.[1] ?? '';
  const values = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1]) as IdCountry[];
  assert.ok(values.length >= 5, 'could not parse IdCountry out of types.ts');
  for (const c of values) {
    assert.ok(typeof MIN_WORKING_AGE[c] === 'number', `MIN_WORKING_AGE is missing ${c}`);
    assert.ok(MIN_WORKING_AGE[c] >= 13 && MIN_WORKING_AGE[c] <= 18, `${c}'s minimum age looks wrong`);
  }
  assert.deepStrictEqual(
    Object.keys(MIN_WORKING_AGE).sort(), [...values].sort(),
    'MIN_WORKING_AGE and IdCountry have drifted apart',
  );
}

assert.strictEqual(minWorkingAge('UK'), 13);
assert.strictEqual(minWorkingAge('US'), 14);
assert.strictEqual(minWorkingAge('AT'), 15);
assert.strictEqual(minWorkingAge(undefined), 15, 'no country set must fall back to the AT default');

// --- age arithmetic ---------------------------------------------------------
assert.strictEqual(ageInYears(bornYearsAgo(15), NOW), 15);
assert.strictEqual(ageInYears(bornYearsAgo(15, 1), NOW), 14, 'a birthday later this year has not happened yet');
assert.strictEqual(ageInYears(undefined, NOW), null);
assert.strictEqual(ageInYears('not a date', NOW), null);
// A future birthdate is a typo. Confidently hiding fields on the strength of
// one would be worse than admitting we don't know.
assert.strictEqual(ageInYears('2030-01-01', NOW), null);

// --- the gate ---------------------------------------------------------------

// The case that started this: a young child, no work details.
assert.strictEqual(hideWorkFields({ birthdate: bornYearsAgo(6), country: 'AT', now: NOW }), true);

// On the birthday itself the fields appear — the boundary is inclusive.
assert.strictEqual(hideWorkFields({ birthdate: bornYearsAgo(15), country: 'AT', now: NOW }), false);
assert.strictEqual(hideWorkFields({ birthdate: bornYearsAgo(14, 1), country: 'AT', now: NOW }), true);

// Country actually changes the answer — a 14-year-old is old enough in the UK
// and the US, not in Austria or South Africa.
for (const [country, expected] of [['UK', false], ['US', false], ['AT', true], ['ZA', true]] as const) {
  assert.strictEqual(
    hideWorkFields({ birthdate: bornYearsAgo(14), country, now: NOW }), expected,
    `a 14-year-old in ${country}`,
  );
}

// REFUSAL 1: an unknown birthdate must not hide anything. Most members are
// adults and the birthdate is one of the most commonly blank fields.
assert.strictEqual(hideWorkFields({ country: 'AT', now: NOW }), false);
assert.strictEqual(hideWorkFields({ birthdate: '', country: 'AT', now: NOW }), false);

// REFUSAL 2 — the important one. Work details already on file keep the fields
// visible whatever the age: a stored value that renders nowhere still reaches
// the AI context and the emergency card, and nobody can correct or clear it.
assert.strictEqual(
  hideWorkFields({ birthdate: bornYearsAgo(6), country: 'AT', hasWorkDetails: true, now: NOW }), false,
  'a value on file must never be hidden — that is data you can no longer see or delete',
);

// --- the note ---------------------------------------------------------------
// It has to name the age and the place, or a parent who just typed a birthdate
// reads vanishing fields as a bug.
for (const [country, age, where] of [['AT', '15', 'Austria'], ['ZA', '15', 'South Africa'], ['UK', '13', 'the UK'], ['US', '14', 'the US']] as const) {
  const note = workingAgeNote(country);
  assert.ok(note.includes(age), `the note for ${country} must name the age`);
  assert.ok(note.includes(where), `the note for ${country} must name the place`);
}

// --- wiring -----------------------------------------------------------------
{
  const editor = fs.readFileSync(path.join(root, 'src/components/EditMemberModal.tsx'), 'utf8');

  // Gated on the birthdate as CURRENTLY TYPED, not member.birthdate — filling
  // one in should change the form under your hands.
  const call = editor.slice(editor.indexOf('hideWorkFields({'), editor.indexOf('hideWorkFields({') + 200);
  assert.ok(/birthdate,/.test(call), 'the gate must read the edited birthdate, not the saved member');
  assert.ok(/hasWorkDetails:\s*!!\(employer \|\| jobTitle \|\| workPhone \|\| workAddress\)/.test(call),
    'every work field must count toward hasWorkDetails, or one of them can go invisible while set');

  // All four fields sit inside the gate — leaving one out would half-hide the
  // section and look like a rendering bug.
  const gated = editor.slice(editor.indexOf('hideWorkFields({'), editor.indexOf('Online Status'));
  for (const f of ['setEmployer', 'setJobTitle', 'setWorkPhone', 'setWorkAddress']) {
    assert.ok(gated.includes(f), `${f}'s input must be inside the gated block`);
  }

  // The hidden state explains itself.
  assert.ok(editor.includes('workingAgeNote(country)'), 'the hidden state must render the explanation');
}

// --- the spouse gate --------------------------------------------------------

assert.strictEqual(ADULT_AGE, 18);

// Deliberately country-blind, unlike the working-age gate above. If someone
// later "fixes" this by threading a country through, these four must still
// agree — the moment they don't, the comment in ageGates.ts explaining why
// there is no table has become false.
for (const c of ['AT', 'ZA', 'UK', 'US'] as const) {
  assert.strictEqual(
    hideSpouseField({ birthdate: bornYearsAgo(17), now: NOW }), true,
    `a 17-year-old is under the gate regardless of country (checked while ${c} was in mind)`,
  );
}

// The boundary, inclusive on the birthday itself.
assert.strictEqual(hideSpouseField({ birthdate: bornYearsAgo(18), now: NOW }), false);
assert.strictEqual(hideSpouseField({ birthdate: bornYearsAgo(17, 1), now: NOW }), true);
assert.strictEqual(hideSpouseField({ birthdate: bornYearsAgo(6), now: NOW }), true);

// The same two refusals as the work gate.
assert.strictEqual(hideSpouseField({ now: NOW }), false, 'no birthdate, no hiding');
assert.strictEqual(
  hideSpouseField({ birthdate: bornYearsAgo(15), hasSpouse: true, now: NOW }), false,
  'a spouse already on file must stay visible — it names a living person, and a name nobody can see is a name nobody can correct',
);

assert.ok(spouseAgeNote().includes('18'), 'the note must name the age it gates on');

// --- spouse wiring ----------------------------------------------------------
{
  const editor = fs.readFileSync(path.join(root, 'src/components/EditMemberModal.tsx'), 'utf8');
  const call = editor.slice(editor.indexOf('hideSpouseField({'), editor.indexOf('hideSpouseField({') + 120);
  assert.ok(/birthdate,/.test(call), 'the gate must read the edited birthdate, not the saved member');
  assert.ok(/hasSpouse:\s*!!spouse/.test(call), 'a spouse already typed or loaded must keep the field visible');
  assert.ok(editor.includes('spouseAgeNote()'), 'the hidden state must explain itself');

  // ...but not on top of the work note. Both gates fail together on any child
  // young enough, and these notes exist to explain a disappearance — the work
  // fields used to be on every profile; a spouse field never was. Two grey
  // apologies stacked on a six-year-old read worse than one.
  const spouseBranch = editor.slice(editor.indexOf('hideSpouseField({'), editor.indexOf('Employer / workplace'));
  assert.ok(/hideWorkFields\(\{[\s\S]*?\)\s*\n?\s*\? null/.test(spouseBranch),
    'the spouse note must yield to the work note when both gates are closed');
  // Saved, not merely rendered — a field that renders and never commits is
  // the failure this modal's Save path makes easy to miss.
  assert.ok(/spouse: spouse\.trim\(\) \|\| undefined,/.test(editor), 'spouse must be written on Save');
  assert.ok(/setSpouse\(member\.spouse \|\| ''\)/.test(editor), 'spouse must be loaded when the modal opens');
}

// The server must be told never to infer a marriage. Two adults in one family
// space, sharing a surname and an address, are not evidence of anything — and
// a relationship the assistant assumed and filed is invisible to the people it
// is wrong about.
{
  const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const at = serverSrc.indexOf('  spouse is who an adult member');
  assert.ok(at > 0, 'server.js must document the spouse field key');
  const note = serverSrc.slice(at, serverSrc.indexOf('\n', at));
  assert.ok(/NEVER INFER IT/.test(note), 'the prompt must forbid inferring a spouse');
  assert.ok(/sharing a surname/.test(note), 'the prompt must name the specific wrong inferences');
  assert.ok(/clear_field/.test(note), 'a separation must clear the field, not be written into it');
}

console.log('ageGates.test.ts: all assertions passed');
