import assert from 'node:assert/strict';
import { HouseholdInfo, Pet } from '../types';
import type { AiEdit } from '../components/AIChatbot';
import { applyHouseholdEdits, applyPetHealthEdits, hasPetHealthEdits } from './aiApply';
import { petAgeLabel } from './pet';
import { mergeShared } from './mergeShared';

// The write half of the pets work: "Buddy had his rabies jab on Tuesday, next
// one due next March" reaching the right animal's medical history.
//
// The assertion that matters most here is the one that REFUSES to guess. A pet
// is matched by name and nothing else — there is no plate, no VIN, no policy
// number — so the only two honest outcomes are "filed against the pet you
// named" and "I couldn't find that pet". Filing a vet bill against whichever
// animal happens to be first in the list is worse than not saving it, because
// nobody ever goes looking for it.

const edit = (records: {
  pet?: string; date: string; what: string; type?: string; vet?: string; cost?: string; nextDue?: string; notes?: string;
}[]): AiEdit => ({ kind: 'pet_health', records } as AiEdit);

const STORED: HouseholdInfo = {
  address: 'Ahornweg 12',
  doorCode: '1234',
  pets: [
    { id: 'p1', name: 'Buddy', species: 'Dog', microchip: '900123', healthLog: [{ id: 'h0', date: '2024-01-01', what: 'Neutered' }] },
    { id: 'p2', name: 'Mitzi', species: 'Cat' },
  ],
  vehicles: [{ id: 'v1', name: 'VW Golf' }],
  utilities: [{ id: 'u1', type: 'Electricity' }],
};
const clone = (): HouseholdInfo => JSON.parse(JSON.stringify(STORED));
const logOf = (h: HouseholdInfo, id: string) => (h.pets || []).find(p => p.id === id)?.healthLog || [];

// --- the kind is visible at all ---------------------------------------------
{
  assert.ok(hasPetHealthEdits([edit([{ date: '2026-01-01', what: 'x', pet: 'Buddy' }])]),
    'hasPetHealthEdits must see the kind, or the household is never even loaded and nothing saves');
  assert.ok(!hasPetHealthEdits([{ kind: 'contact', name: 'X' } as AiEdit]));
}

// --- the ordinary case ------------------------------------------------------
{
  const { household, matched, unmatched } = applyPetHealthEdits(clone(), [edit([{
    pet: 'Buddy', date: '2026-08-18', what: 'Rabies booster', type: 'Vaccination',
    vet: 'Tierklinik Hofer', cost: '€48', nextDue: '2027-08-18', notes: 'Left shoulder',
  }])]);
  assert.equal(matched, 1);
  assert.deepEqual(unmatched, []);
  const log = logOf(household, 'p1');
  assert.equal(log.length, 2, 'appended, not replaced — the neutering from 2024 is still there');
  const r = log[1];
  assert.equal(r.what, 'Rabies booster');
  assert.equal(r.nextDue, '2027-08-18');
  assert.equal(r.vet, 'Tierklinik Hofer');
  assert.ok(r.id && r.id !== 'h0', 'a fresh id, so undo can remove exactly this entry');
  assert.equal(logOf(household, 'p2').length, 0, 'and the cat is untouched');
}

// --- matching is forgiving about typing, strict about identity --------------
{
  const { matched } = applyPetHealthEdits(clone(), [edit([{ pet: '  buddy  ', date: '2026-08-18', what: 'Check-up' }])]);
  assert.equal(matched, 1, 'case and stray spaces must not lose a record');
}
{
  // THE ONE THAT MATTERS. A name that isn't on file is reported back, never
  // filed against the nearest animal.
  const { household, matched, unmatched } = applyPetHealthEdits(clone(), [edit([{
    pet: 'Rex', date: '2026-08-18', what: 'Rabies booster',
  }])]);
  assert.equal(matched, 0);
  assert.deepEqual(unmatched, ['Rex']);
  assert.equal(logOf(household, 'p1').length, 1, 'Buddy must not inherit a record meant for a dog we do not have');
  assert.equal(logOf(household, 'p2').length, 0);
  assert.deepEqual(household, STORED, 'nothing matched, so the document comes back untouched');
}
{
  // Two pets and no name is ambiguous, and ambiguity is not a licence to pick.
  const { matched, unmatched } = applyPetHealthEdits(clone(), [edit([{ date: '2026-08-18', what: 'Wormed' }])]);
  assert.equal(matched, 0, 'with more than one pet on file, an unnamed record must not be guessed at');
  assert.deepEqual(unmatched, ['Wormed'], 'and what could not be filed is named, so the reply can say so');
}
{
  // One pet, though, is not ambiguous.
  const single: HouseholdInfo = { ...clone(), pets: [{ id: 'p1', name: 'Buddy' }] };
  const { household, matched } = applyPetHealthEdits(single, [edit([{ date: '2026-08-18', what: 'Wormed' }])]);
  assert.equal(matched, 1, 'with exactly one pet there is nothing to resolve');
  assert.equal(logOf(household, 'p1').length, 1);
}

// --- rubbish in ------------------------------------------------------------
{
  const { household, matched } = applyPetHealthEdits(clone(), [edit([
    { pet: 'Buddy', date: '2026-08-18', what: '   ' },
    { pet: 'Buddy', date: '2026-08-18', what: '' },
  ])]);
  assert.equal(matched, 0, 'an entry with nothing that happened is not a record of anything');
  assert.deepEqual(household, STORED);
}
{
  const { household } = applyPetHealthEdits(clone(), [edit([{
    pet: 'Buddy', date: 'last Tuesday', what: 'Limping', nextDue: 'in a year',
  }])]);
  const r = logOf(household, 'p1')[1];
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, 'an unparseable date falls back to today rather than storing prose');
  assert.equal(r.nextDue, undefined,
    'a next-due that is not a date must be dropped — it drives a reminder, and an invented one is worse than none');
}
{
  assert.deepEqual(applyPetHealthEdits(clone(), []).household, STORED, 'no edits must return the document unchanged');
  const noPets: HouseholdInfo = { ...clone(), pets: [] };
  const { matched, unmatched } = applyPetHealthEdits(noPets, [edit([{ pet: 'Buddy', date: '2026-08-18', what: 'Jab' }])]);
  assert.equal(matched, 0);
  assert.deepEqual(unmatched, ['Buddy'], 'a family with no pets yet gets told, not silently dropped');
}

// --- two pets in one batch --------------------------------------------------
{
  const { household, matched } = applyPetHealthEdits(clone(), [edit([
    { pet: 'Buddy', date: '2026-08-18', what: 'Rabies booster' },
    { pet: 'Mitzi', date: '2026-08-18', what: 'Flea treatment' },
    { pet: 'Buddy', date: '2026-08-19', what: 'Nail clip' },
  ])]);
  assert.equal(matched, 3);
  assert.deepEqual(logOf(household, 'p1').map(r => r.what), ['Neutered', 'Rabies booster', 'Nail clip']);
  assert.deepEqual(logOf(household, 'p2').map(r => r.what), ['Flea treatment']);
}

// --- the structural guards --------------------------------------------------
// HouseholdInfo is three-way-merged on save, so any key this function fails to
// carry through reads as a DELETION. That applies at BOTH levels here — the
// document and the pet — and the pet level is the newer, sharper edge: a pet
// now has twenty-five fields for a rebuild-by-key to eat.
{
  const { household } = applyPetHealthEdits(clone(), [edit([{ pet: 'Buddy', date: '2026-08-18', what: 'Jab' }])]);
  const saved = mergeShared<HouseholdInfo>(clone(), household, clone());
  assert.equal(saved.address, 'Ahornweg 12');
  assert.equal(saved.doorCode, '1234', 'a secret this function never reads must still survive it');
  assert.equal(saved.vehicles?.length, 1);
  assert.equal(saved.utilities?.length, 1);
  const buddy = (saved.pets || []).find(p => p.id === 'p1')!;
  assert.equal(buddy.species, 'Dog', 'the pet must be spread, not rebuilt');
  assert.equal(buddy.microchip, '900123', 'a field this function never names must survive it');
}
{
  const withFutureKey = { ...clone(), somethingAddedLater: [{ id: 'x1' }] } as unknown as HouseholdInfo;
  const base = JSON.parse(JSON.stringify(withFutureKey));
  const { household } = applyPetHealthEdits(withFutureKey, [edit([{ pet: 'Buddy', date: '2026-08-18', what: 'Jab' }])]);
  const saved = mergeShared<HouseholdInfo>(base, household, base) as unknown as Record<string, unknown>;
  assert.ok(
    Array.isArray(saved.somethingAddedLater) && (saved.somethingAddedLater as unknown[]).length === 1,
    'applyPetHealthEdits drops any HouseholdInfo key it does not name — rebuild it key-by-key and the next household field dies here',
  );
}
{
  // Same guard one level down: a Pet field added tomorrow must survive too.
  const withFuturePetField = clone();
  (withFuturePetField.pets![0] as unknown as Record<string, unknown>).somethingAddedLater = 'keep me';
  const { household } = applyPetHealthEdits(withFuturePetField, [edit([{ pet: 'Buddy', date: '2026-08-18', what: 'Jab' }])]);
  const buddy = (household.pets || []).find(p => p.id === 'p1') as unknown as Record<string, unknown>;
  assert.equal(buddy.somethingAddedLater, 'keep me',
    'a Pet key this function does not name must survive it — the pet is spread for exactly this reason');
}

// A pet not touched by this batch must come back as the SAME object, so the
// merge has nothing spurious to reconcile.
{
  const before = clone();
  const { household } = applyPetHealthEdits(before, [edit([{ pet: 'Buddy', date: '2026-08-18', what: 'Jab' }])]);
  assert.equal(household.pets![1], before.pets![1], 'an untouched pet is passed through by reference, not copied');
}

// --- the one boolean the model can only send as text -----------------------
// list_add items are Record<string, string>. Spreading "false" straight onto a
// boolean field stores a TRUTHY string, and the family who explicitly said the
// birthday was NOT a guess is the one who gets "about 7" forever.
{
  const add = (birthdateEstimated: string): AiEdit => ({
    kind: 'list_add', list: 'pets', item: { name: 'Nala', birthdate: '2024-08-25', birthdateEstimated },
  } as AiEdit);
  const yes = applyHouseholdEdits({ pets: [] }, [add('true')]).pets![0];
  assert.equal(yes.birthdateEstimated, true, 'a string "true" must become a real boolean');

  for (const falsey of ['false', 'no', '', 'FALSE']) {
    const p2 = applyHouseholdEdits({ pets: [] }, [add(falsey)]).pets![0];
    assert.notEqual(p2.birthdateEstimated, true,
      `"${falsey}" must not read as an estimated birthday — the string is truthy, the answer is not`);
    assert.ok(!petAgeLabel({ ...p2, id: 'x' }, new Date(2026, 7, 20))?.startsWith('about'),
      `"${falsey}" must not put "about" in front of the age`);
  }
  // A pet added without the key at all is unaffected.
  const plain = applyHouseholdEdits({ pets: [] }, [{ kind: 'list_add', list: 'pets', item: { name: 'Buddy' } } as AiEdit]).pets![0];
  assert.equal(plain.birthdateEstimated, undefined);
}

console.log('aiPetHealth.test.ts: all assertions passed');
