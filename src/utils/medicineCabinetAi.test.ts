import assert from 'node:assert/strict';
import type { AiEdit } from '../components/AIChatbot';
import type { HouseholdInfo } from '../types';
import { applyHouseholdEdits, hasHouseholdEdits } from './aiApply';
import { buildPatch, findInContext, recordPhrase } from './aiDestructive';
import { diffHouseholdUndo } from './aiUndo';

// The assistant's road into the Medicine Cabinet. Every value the model sends
// is text; these pin the places where text becomes a number or a date.

const add = (item: Record<string, string>): AiEdit => ({ kind: 'list_add', list: 'medicineCabinet', item });

// --- list_add ----------------------------------------------------------------
const base: HouseholdInfo = { address: '1 Test St', pets: [{ id: 'p1', name: 'Rex' }] };
assert.ok(hasHouseholdEdits([add({ name: 'Plasters' })]), 'a cabinet add counts as a household edit (else it is never saved)');

const after = applyHouseholdEdits(base, [
  add({ name: 'Nasal spray', quantity: '2', minimum: '1', expiry: '03/2027', category: 'cold', location: 'Hall cupboard' }),
  add({ name: 'Tweezers' }),
  add({ name: 'Vague', quantity: 'a few', expiry: 'next year' }),
  add({ name: '   ', quantity: '3' }),
]);
const cab = after.medicineCabinet!;
assert.equal(cab.length, 3, 'the nameless one is refused');
assert.deepEqual({ ...cab[0], id: '' }, { id: '', name: 'Nasal spray', category: 'Cold, cough & allergy', quantity: 2, minimum: 1, expiry: '2027-03-31', location: 'Hall cupboard' });
assert.equal(typeof cab[0].quantity, 'number', 'a number, not the string "2"');
assert.deepEqual({ ...cab[2], id: '' }, { id: '', name: 'Vague' }, 'unvalidated values are dropped, not stored raw');
assert.ok(cab.every(c => c.id && typeof c.id === 'string'));
assert.equal(new Set(cab.map(c => c.id)).size, cab.length, 'distinct ids');
// Spread safety: everything else on the household survives the add.
assert.equal(after.address, '1 Test St');
assert.deepEqual(after.pets, base.pets);
// Appends to an existing cabinet rather than replacing it.
const twice = applyHouseholdEdits(after, [add({ name: 'Plasters' })]);
assert.equal(twice.medicineCabinet!.length, 4);
assert.equal(twice.medicineCabinet![0].id, cab[0].id);

// --- update_record patches -----------------------------------------------------
assert.deepEqual(buildPatch('medicine_item', { quantity: '0' }), { quantity: 0 });
assert.deepEqual(buildPatch('medicine_item', { quantity: '3', minimum: '2' }), { quantity: 3, minimum: 2 });
assert.deepEqual(buildPatch('medicine_item', { quantity: 'a few' }), {}, 'NaN never reaches the record');
assert.deepEqual(buildPatch('medicine_item', { expiry: '06/2028' }), { expiry: '2028-06-30' });
assert.deepEqual(buildPatch('medicine_item', { expiry: 'soon' }), {}, 'an unreadable expiry cannot overwrite a good one');
assert.deepEqual(buildPatch('medicine_item', { category: 'stomach' }), { category: 'Stomach & gut' });
assert.deepEqual(buildPatch('medicine_item', { category: '???' }), {});
assert.deepEqual(buildPatch('medicine_item', { name: '  ' }), {}, 'cannot blank the name');
assert.deepEqual(buildPatch('medicine_item', { note: 'top shelf', id: 'evil', status: 'low' }), { notes: 'top shelf' }, 'whitelist: no id, no stored status');
// CONTROL: the existing numeric coercion for other kinds is untouched.
assert.deepEqual(buildPatch('vehicle', { serviceIntervalMonths: '12' }), { serviceIntervalMonths: 12 });

// --- find / phrase (so update & delete can locate the row) -----------------------
const ctx = { household: after };
const found = findInContext(ctx, 'medicine_item', cab[0].id) as any;
assert.ok(found && (found.record || found).name !== undefined, 'medicine_item is found in the household context');
assert.equal(findInContext(ctx, 'medicine_item', 'nope'), null, 'CONTROL: an unknown id is not found');
assert.equal(recordPhrase('medicine_item', cab[0]), 'medicine cabinet item Nasal spray');

// --- undo ----------------------------------------------------------------------
const undo = diffHouseholdUndo(base, after).filter(r => r.domain === 'medicineItem');
assert.equal(undo.length, 3);
assert.deepEqual(undo.map(r => r.label), ['Nasal spray', 'Tweezers', 'Vague']);
assert.equal(diffHouseholdUndo(after, after).filter(r => r.domain === 'medicineItem').length, 0, 'CONTROL: no change, nothing to undo');

console.log('medicineCabinetAi.test.ts: all assertions passed');
