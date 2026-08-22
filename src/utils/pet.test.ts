import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pet, PetHealthRecord } from '../types';
import { isDeceased, nextVaccinationDate, petAgeLabel, petDeadlines, petLabel, sortHealthLog } from './pet';
import { buildCalendarPetBirthdays } from './familyDates';
import { buildOccasionSeries, buildVirtualEvents } from './virtualEvents';

// Guards the pets work. Rory, 2026-08-20: "pets!!!!!! yo we forgot abou
// pets!!!!!! name, birthday, medical history so on and so on" and "yeah pets to
// alot of families are just as important as children!"
//
// The assertion this file cares about most is the one about a pet that has
// died. Everything else here is arithmetic; that one is the app not hurting
// somebody.

const here = path.dirname(fileURLToPath(import.meta.url));   // never .pathname — a space in the path silently no-ops
const root = path.resolve(here, '../..');

const pad2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** An ISO date N days from today — deadlines are measured against the real clock. */
const inDays = (n: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return iso(d);
};

const pet = (p: Partial<Pet> & { name: string }): Pet => ({ id: 'p1', ...p });
const health = (r: Partial<PetHealthRecord> & { what: string }): PetHealthRecord => ({
  id: `h-${r.what}`, date: '2026-01-01', ...r,
});

const NOW = new Date(2026, 7, 20);   // 2026-08-20, local

// --- petLabel ---------------------------------------------------------------
{
  assert.equal(petLabel(pet({ name: 'Buddy' })), 'Buddy');
  assert.equal(petLabel(pet({ name: '  ', species: 'Cat' })), 'Cat');
  assert.equal(petLabel(pet({ name: '' })), 'Pet');
}

// --- deadlines --------------------------------------------------------------
{
  const p = pet({
    name: 'Buddy',
    nextVaccinationDue: inDays(10),
    nextTreatmentDue: inDays(-3),
    insuranceRenewal: inDays(40),
    licenceExpiry: inDays(200),
  });
  const d = petDeadlines(p);
  assert.deepEqual(d.map(x => x.kind), ['treatment', 'vaccination', 'insurance', 'licence'], 'soonest first, overdue first of all');
  assert.equal(d[0].days, -3);
  assert.equal(d[1].days, 10);
  assert.deepEqual(petDeadlines(pet({ name: 'Buddy' })), [], 'a pet with no dates owes nothing');
}

// --- A PET THAT HAS DIED IS NOT NAGGED ABOUT --------------------------------
// The whole reason deceasedDate exists rather than "just delete the pet". If
// this ever goes green-to-red, someone has moved the gate out of the resolver
// and into the callers, and one of them will forget.
{
  const p = pet({
    name: 'Buddy',
    nextVaccinationDue: inDays(-5),
    nextTreatmentDue: inDays(2),
    insuranceRenewal: inDays(9),
    licenceExpiry: inDays(30),
    deceasedDate: '2026-03-01',
  });
  assert.ok(isDeceased(p));
  assert.deepEqual(petDeadlines(p), [], 'a pet who has died must produce no reminders at all');
  assert.deepEqual(
    buildCalendarPetBirthdays([{ ...p, birthdate: '2019-09-14' }], NOW), [],
    'and no birthday on the family calendar',
  );
  // A non-date in the field must not silently switch the gate on.
  assert.equal(isDeceased(pet({ name: 'Buddy', deceasedDate: 'last year' })), false);
}

// --- nextVaccinationDate: one fact, two possible stores, one resolver -------
{
  const withLog = pet({
    name: 'Buddy',
    healthLog: [
      health({ what: 'Rabies booster', type: 'Vaccination', date: '2025-09-01', nextDue: inDays(300) }),
      health({ what: 'Distemper', type: 'Vaccination', date: '2026-01-04', nextDue: inDays(60) }),
    ],
  });
  assert.equal(nextVaccinationDate(withLog), inDays(60), 'the soonest future next-due in the history');

  assert.equal(
    nextVaccinationDate({ ...withLog, nextVaccinationDue: inDays(5) }), inDays(5),
    'an explicitly typed date overrides the history — a human overriding a field is making a statement',
  );

  // An old card's next-due is history, not a deadline.
  const stale = pet({
    name: 'Buddy',
    healthLog: [health({ what: 'Rabies', type: 'Vaccination', date: '2019-01-01', nextDue: '2020-01-01' })],
  });
  assert.equal(nextVaccinationDate(stale), null, 'a booster that was due in 2020 is not a reminder in 2026');

  // But an explicit override IS surfaced when overdue: "it was due in March and
  // we never went" is exactly the thing to be nagged about.
  const overdue = pet({ name: 'Buddy', nextVaccinationDue: inDays(-40) });
  assert.equal(petDeadlines(overdue)[0].days, -40);

  // Non-vaccination entries are not vaccinations, however they are dated.
  const dental = pet({
    name: 'Buddy',
    healthLog: [health({ what: 'Dental scale and polish', type: 'Dental', date: '2026-02-01', nextDue: inDays(30) })],
  });
  assert.equal(nextVaccinationDate(dental), null);
  // …and one typed as Other still counts if the text says booster, because the
  // model and the family both write free text into `what`.
  const looseText = pet({
    name: 'Buddy',
    healthLog: [health({ what: 'Yearly booster', type: 'Other', date: '2026-02-01', nextDue: inDays(30) })],
  });
  assert.equal(nextVaccinationDate(looseText), inDays(30));
}

// --- age --------------------------------------------------------------------
{
  assert.equal(petAgeLabel(pet({ name: 'B' }), NOW), null, 'no birthdate, no claim');
  assert.equal(petAgeLabel(pet({ name: 'B', birthdate: '2025-06-20' }), NOW), '14 months');
  assert.equal(petAgeLabel(pet({ name: 'B', birthdate: '2026-07-20' }), NOW), '1 month');
  assert.equal(petAgeLabel(pet({ name: 'B', birthdate: '2026-08-20' }), NOW), '0 months');
  assert.equal(petAgeLabel(pet({ name: 'B', birthdate: '2019-09-14' }), NOW), '6 years');
  assert.equal(petAgeLabel(pet({ name: 'B', birthdate: '2019-08-20' }), NOW), '7 years');

  // A rescue's birthday is a vet's guess. The app must never print it as fact.
  assert.equal(
    petAgeLabel(pet({ name: 'B', birthdate: '2019-08-20', birthdateEstimated: true }), NOW), 'about 7 years',
  );

  // Age stops at the date they died, not today.
  assert.equal(
    petAgeLabel(pet({ name: 'B', birthdate: '2010-01-01', deceasedDate: '2023-01-01' }), NOW), '13 years',
  );
  // A birthdate after the end date is not a negative age.
  assert.equal(petAgeLabel(pet({ name: 'B', birthdate: '2030-01-01' }), NOW), null);
}

// --- sortHealthLog ----------------------------------------------------------
{
  const log = [health({ what: 'a', date: '2024-01-01' }), health({ what: 'b', date: '2026-05-05' })];
  assert.deepEqual(sortHealthLog(log).map(r => r.what), ['b', 'a'], 'newest first');
  assert.deepEqual(log.map(r => r.what), ['a', 'b'], 'and the caller’s array is not mutated');
}

// --- birthdays on the family calendar ---------------------------------------
{
  const pets = [
    pet({ id: 'p1', name: 'Buddy', species: 'Dog', birthdate: '2019-09-14' }),
    pet({ id: 'p2', name: 'Mitzi', birthdate: '' }),                       // no birthday → nothing
    pet({ id: 'p3', name: 'Nala', birthdate: '2024-08-25', birthdateEstimated: true }),
  ];
  const built = buildCalendarPetBirthdays(pets, NOW);
  assert.deepEqual(built.map(b => b.petId), ['p3', 'p1'], 'soonest first');
  assert.equal(built[1].turningAge, 7);
  assert.equal(built[1].species, 'Dog');
  assert.equal(built[0].estimated, true);
  assert.equal(built[1].estimated, false);
  assert.equal(built[0].daysUntil, 5);

  // …and into the month grid, where the hedge has to survive.
  const grid = buildVirtualEvents({ petBirthdays: built }, '2026-08-01', '2026-09-30');
  const nala = grid.find(e => e.sourceId === 'p3')!;
  const buddy = grid.find(e => e.sourceId === 'p1')!;
  assert.equal(nala.kind, 'petBirthday');
  assert.equal(nala.title, "Nala's birthday");
  assert.equal(nala.detail, 'about 2', 'an estimated birthday must never render as "turns"');
  assert.equal(buddy.detail, 'turns 7');
  assert.ok(nala.id.startsWith('virtual:petBirthday:'), 'namespaced so it can never collide with a stored event id');
  assert.equal((nala as { memberIds?: string[] }).memberIds, undefined, 'a pet is not a family member id');

  // …and out through the .ics export, into a calendar that will never know it
  // was a guess unless the description says so.
  const series = buildOccasionSeries({ petBirthdays: built }, NOW);
  const exported = series.find(s => s.id === 'virtual-petBirthday-p3')!;
  assert.equal(exported.repeat, 'yearly');
  assert.match(exported.description!, /Born about 2024/);
  assert.match(series.find(s => s.id === 'virtual-petBirthday-p1')!.description!, /Born 2019/);
}

// --- wiring: every surface that has to consume this actually does -----------
// The failure mode for all of the below is silence — the field saves, and
// nothing anywhere reads it.
{
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  const needs = read('src/components/NeedsAttention.tsx');
  assert.ok(needs.includes('...computePetNudges(pets),'), 'the digest must include pet deadlines');
  assert.ok(needs.includes('setPets(h?.pets || [])'), 'and must actually load the pets to nudge about');

  const cal = read('src/components/FamilyCalendar.tsx');
  assert.ok(cal.includes('calendarDivisions?.petBirthdays'), 'the calendar must read the division toggle');
  assert.ok(cal.includes('buildCalendarPetBirthdays(pets)'), 'and build the birthdays');
  assert.ok(/petBirthdays: !isBusinessSpace && settings\.calendarDivisions\?\.petBirthdays !== false \? petBirthdays : \[\],[\s\S]{0,400}buildIcs/.test(cal),
    'pet birthdays must reach family .ics exports and stay out of business calendars');

  // Pets live on their OWN screen (v248) rather than at the bottom of
  // Household. The data did not move — still HouseholdInfo.pets, still saved
  // through saveHousehold — so this checks the form, and that Household is no
  // longer a second editor of the same list.
  const petsView = read('src/components/PetsView.tsx');
  for (const field of ['birthdate', 'chipRegistry', 'nextVaccinationDue', 'insuranceRenewal', 'deceasedDate', 'healthLog']) {
    // The WRITE, not the word. Every one of these names also appears in the
    // save/serialise block below the form, so `includes(field)` stays green
    // with the input deleted — which is precisely the invisible field this
    // assertion says it is preventing. The colon matters too: `patch({
    // birthdate` alone is satisfied by `patch({ birthdateEstimated`.
    assert.ok(petsView.includes(`patch({ ${field}:`), `the pet form must offer ${field} — a type-only field is invisible`);
  }
  // Trailing '(' deliberately: a bare identifier is satisfied by the import
  // line, so the assertion would pass with the call deleted.
  assert.ok(petsView.includes('loadHousehold()') && petsView.includes('saveHousehold('),
    'the pets screen must read and write the household document — a second store for the same list is how two screens start disagreeing about the same dog');

  const house = read('src/components/HouseholdView.tsx');
  assert.ok(!/PetForm|PetsSection/.test(house),
    'Household must not keep a second copy of the pet form — two editors of one list drift apart field by field');

  const dashNav = read('src/components/Dashboard.tsx');
  // '<' deliberately: the bare name is on the React.lazy import line too, so
  // `includes('PetsView')` passes with the render deleted.
  assert.ok(/'pets'/.test(dashNav) && dashNav.includes('<PetsView'),
    'pets must be reachable from the menu — Household is where you look for a door code, not for the dog');
  assert.ok(/'pets'/.test(read('src/components/SectionMenu.tsx')),
    'and listed in the section menu rather than falling into "More"');

  // The AI half. A field in the type but not in the prompt cannot be filed, and
  // a kind in the prompt with no apply path reports success and saves nothing.
  const server = read('server.js');
  // Sliced to the pets clause of the list_add prompt. A whole-file `includes`
  // says only that the word exists SOMEWHERE in a 4,000-line prompt file —
  // `insuranceRenewal` is already shared with vehicles, and the next list to
  // borrow one of these names would hold this guard green while pets lost it.
  const petsPrompt = server.slice(server.indexOf('pets (name, species'), server.indexOf('utilities (type, provider'));
  assert.ok(petsPrompt.length > 400 && petsPrompt.length < 3000, 'the pets clause must still be what is being sliced');
  for (const field of ['chipRegistry', 'birthdateEstimated', 'deceasedDate', 'nextTreatmentDue', 'licenceExpiry']) {
    assert.ok(petsPrompt.includes(field), `server.js's pets field list must mention ${field}`);
  }
  assert.ok(server.includes('"kind":"pet_health"'), 'the assistant must be told the pet_health kind exists');

  const dash = read('src/components/Dashboard.tsx');
  assert.ok(dash.includes('applyPetHealthEdits('), 'pet_health must be applied, not just declared');
  assert.ok(dash.includes('hasPetHealthEdits(edits)'), 'and the household save must run when only a pet_health edit is present');
  assert.ok(dash.includes("idsFor('petHealth')") || dash.includes("r.domain === 'petHealth'"), 'and be undoable');

  const chat = read('src/components/AIChatbot.tsx');
  assert.ok(/kind: 'pet_health'/.test(chat), 'pet_health must be in the AiEdit union or nothing type-checks it');
}

console.log('pet.test.ts: all assertions passed');
