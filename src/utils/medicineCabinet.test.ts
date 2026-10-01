import assert from 'node:assert/strict';
import { MedicineCabinetItem } from '../types';
import {
  EXPIRY_WARN_DAYS, MEDICINE_CATEGORIES, SUGGESTED_ESSENTIALS,
  categoryFromWord, coerceCount, groupByCategory, itemFromAi, itemStatus, needsRestock,
  normaliseExpiry, remainingSuggestions, restockNames, sortItems, summarise,
} from './medicineCabinet';

// Guards the medicine cabinet. Rory, 2026-09-21: "make a medical box hoem
// medical supplies (name it properly) for teluva where we can have our must
// hhaves and list them".
//
// Status is DERIVED from quantity, minimum, expiry and today. These tests pin
// the readings that would otherwise send somebody to a pharmacy for nothing —
// or, worse, leave an expired pack looking fine.

const TODAY = '2026-09-21';
const item = (over: Partial<MedicineCabinetItem>): MedicineCabinetItem => ({ id: 'x', name: 'Thing', ...over });

// --- normaliseExpiry ---------------------------------------------------------
assert.equal(normaliseExpiry('2027-03-15'), '2027-03-15');
assert.equal(normaliseExpiry('2027-03'), '2027-03-31', 'month-only = END of that month');
assert.equal(normaliseExpiry('03/2027'), '2027-03-31', 'pack style MM/YYYY');
assert.equal(normaliseExpiry('3.2027'), '2027-03-31', 'MM.YYYY, no leading zero');
assert.equal(normaliseExpiry('02/2028'), '2028-02-29', 'leap February');
assert.equal(normaliseExpiry('02/2027'), '2027-02-28');
assert.equal(normaliseExpiry('2027-02-30'), undefined, 'impossible day refused');
assert.equal(normaliseExpiry('13/2027'), undefined, 'impossible month refused');
assert.equal(normaliseExpiry('03/27'), undefined, 'two-digit year is ambiguous — refused, never guessed');
assert.equal(normaliseExpiry('soon'), undefined);
assert.equal(normaliseExpiry(''), undefined);
assert.equal(normaliseExpiry(undefined), undefined);

// The end-of-month rule is the point: a pack stamped for this month is still
// good on the 15th, and only expired once the month is over.
assert.equal(itemStatus(item({ expiry: normaliseExpiry('09/2026') }), '2026-09-21').state, 'expiring', 'stamped this month, still in date');
assert.equal(itemStatus(item({ expiry: normaliseExpiry('09/2026') }), '2026-10-01').state, 'expired', 'expired the day after the month ends');

// --- coerceCount -------------------------------------------------------------
assert.equal(coerceCount('3'), 3);
assert.equal(coerceCount(0), 0);
assert.equal(coerceCount('0'), 0);
assert.equal(coerceCount('two'), undefined);
assert.equal(coerceCount('-1'), undefined);
assert.equal(coerceCount('1.5'), undefined);
assert.equal(coerceCount(''), undefined);
assert.equal(coerceCount(undefined), undefined);
assert.equal(coerceCount('99999'), undefined);

// --- itemStatus --------------------------------------------------------------
assert.equal(itemStatus(item({ quantity: 2, minimum: 1, expiry: '2028-01-31' }), TODAY).state, 'ok');
assert.equal(itemStatus(item({ expiry: '2026-09-20' }), TODAY).state, 'expired', 'yesterday');
assert.equal(itemStatus(item({ expiry: '2026-09-21' }), TODAY).state, 'expiring', 'today is the last good day');
assert.equal(itemStatus(item({ quantity: 0, minimum: 1 }), TODAY).state, 'out');
assert.equal(itemStatus(item({ quantity: 0 }), TODAY).state, 'out', 'an explicit 0 is out even with no minimum');
assert.equal(itemStatus(item({ quantity: 1, minimum: 2 }), TODAY).state, 'low');
assert.equal(itemStatus(item({ quantity: 2, minimum: 2 }), TODAY).state, 'ok', 'AT the minimum is fine');
assert.equal(itemStatus(item({ quantity: 1 }), TODAY).state, 'ok', 'no minimum = never low');
assert.equal(itemStatus(item({ minimum: 2 }), TODAY).state, 'ok', 'no quantity = not counting, never low');
assert.equal(itemStatus(item({}), TODAY).state, 'ok');
assert.equal(itemStatus(item({ quantity: 0, expiry: '2026-01-01' }), TODAY).state, 'expired', 'expired outranks out');
assert.equal(itemStatus(item({ quantity: 1, minimum: 3, expiry: '2026-10-01' }), TODAY).state, 'low', 'low outranks expiring');

// Expiry window edges
const edge = (n: number) => {
  const d = new Date(2026, 8, 21 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
assert.equal(itemStatus(item({ expiry: edge(EXPIRY_WARN_DAYS) }), TODAY).state, 'expiring');
assert.equal(itemStatus(item({ expiry: edge(EXPIRY_WARN_DAYS + 1) }), TODAY).state, 'ok');
assert.equal(itemStatus(item({ expiry: edge(10) }), TODAY).days, 10);
assert.equal(itemStatus(item({ expiry: edge(-3) }), TODAY).days, -3);
assert.equal(itemStatus(item({}), TODAY).days, undefined);
// An unreadable stored expiry must not crash or falsely expire the item.
assert.equal(itemStatus(item({ expiry: 'garbage' }), TODAY).state, 'ok');

// --- needsRestock: expired/out/low buy; expiring only watches ------------------
assert.equal(needsRestock(item({ expiry: '2026-01-01' }), TODAY), true);
assert.equal(needsRestock(item({ quantity: 0 }), TODAY), true);
assert.equal(needsRestock(item({ quantity: 1, minimum: 2 }), TODAY), true);
assert.equal(needsRestock(item({ expiry: edge(20) }), TODAY), false, 'expiring soon is not a purchase yet');
assert.equal(needsRestock(item({ quantity: 3, minimum: 2 }), TODAY), false);

// --- restockNames ------------------------------------------------------------
const shelf: MedicineCabinetItem[] = [
  item({ id: 'a', name: 'Plasters', quantity: 0, minimum: 1 }),
  item({ id: 'b', name: 'Nasal spray', quantity: 1, minimum: 1 }),
  item({ id: 'c', name: 'Eye drops', expiry: '2026-01-01' }),
  item({ id: 'd', name: 'plasters', quantity: 0 }),      // duplicate name, different case
  item({ id: 'e', name: '  ', quantity: 0 }),              // blank name
];
assert.deepEqual(restockNames(shelf, [], TODAY), ['Plasters', 'Eye drops']);
assert.deepEqual(restockNames(shelf, [{ name: 'PLASTERS ', checked: false }], TODAY), ['Eye drops'], 'already on the list, unticked');
assert.deepEqual(restockNames(shelf, [{ name: 'Plasters', checked: true }], TODAY), ['Plasters', 'Eye drops'], 'a ticked entry is a finished trip');

// --- sorting, grouping, summary ------------------------------------------------
const mixed: MedicineCabinetItem[] = [
  item({ id: '1', name: 'Zinc', category: 'Skin, wounds & burns' }),
  item({ id: '2', name: 'Aloe', category: 'Skin, wounds & burns', quantity: 0 }),
  item({ id: '3', name: 'Bandage', category: 'First-aid supplies', expiry: '2026-01-01' }),
  item({ id: '4', name: 'Loose thing' }),
];
assert.deepEqual(sortItems(mixed, TODAY).map(i => i.id), ['3', '2', '4', '1'], 'expired, out, then ok by name');
const groups = groupByCategory(mixed, TODAY);
assert.deepEqual(groups.map(g => g.category), ['Skin, wounds & burns', 'First-aid supplies', 'Other'], 'fixed category order, empties omitted, uncategorised → Other');
assert.deepEqual(groups[0].items.map(i => i.id), ['2', '1'], 'problem items first inside a group');
assert.deepEqual(summarise(mixed, TODAY), { restock: 2, expired: 1, expiring: 0, total: 4 });
assert.deepEqual(summarise([], TODAY), { restock: 0, expired: 0, expiring: 0, total: 0 });

// --- categoryFromWord --------------------------------------------------------
for (const c of MEDICINE_CATEGORIES) assert.equal(categoryFromWord(c), c, `exact: ${c}`);
assert.equal(categoryFromWord('pain'), 'Pain & fever');
assert.equal(categoryFromWord('Fever'), 'Pain & fever');
assert.equal(categoryFromWord('allergy'), 'Cold, cough & allergy');
assert.equal(categoryFromWord('stomach'), 'Stomach & gut');
assert.equal(categoryFromWord('burns'), 'Skin, wounds & burns');
assert.equal(categoryFromWord('first aid'), 'First-aid supplies');
assert.equal(categoryFromWord('thermometer'), 'First-aid supplies');
assert.equal(categoryFromWord('something unrecognisable'), undefined, 'unknown → uncategorised, not "Other"');
assert.equal(categoryFromWord(''), undefined);
assert.equal(categoryFromWord(undefined), undefined);

// --- itemFromAi: every value is text on the way in --------------------------------
assert.deepEqual(
  itemFromAi({ name: ' Plasters ', category: 'first aid', quantity: '2', minimum: '1', expiry: '06/2028', location: 'Hall cupboard', notes: 'assorted' }),
  { name: 'Plasters', category: 'First-aid supplies', quantity: 2, minimum: 1, expiry: '2028-06-30', location: 'Hall cupboard', notes: 'assorted' },
);
assert.deepEqual(itemFromAi({ name: 'Tweezers' }), { name: 'Tweezers' }, 'only the name is required');
assert.deepEqual(
  itemFromAi({ name: 'Thing', quantity: 'a few', minimum: '-2', expiry: 'next year', category: '???' }),
  { name: 'Thing' },
  'values that will not validate are DROPPED, not stored raw',
);
assert.equal(itemFromAi({ name: '   ' }), null);
assert.equal(itemFromAi({ quantity: '3' }), null);
assert.deepEqual(itemFromAi({ name: 'X', note: 'via note' }), { name: 'X', notes: 'via note' }, 'accepts "note" as well as "notes"');
assert.ok(!('id' in (itemFromAi({ name: 'X', id: 'evil' }) ?? {})), 'the model does not choose ids');

// --- suggestions ---------------------------------------------------------------
assert.ok(SUGGESTED_ESSENTIALS.length >= 25);
const names = SUGGESTED_ESSENTIALS.map(s => s.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'no duplicate suggestions');
for (const s of SUGGESTED_ESSENTIALS) {
  assert.ok(MEDICINE_CATEGORIES.includes(s.category), `${s.name}: known category`);
  assert.ok(Number.isInteger(s.minimum) && s.minimum >= 1, `${s.name}: sane minimum`);
  // Names only: no strengths, doses or brand-style capitals digits ("500 mg", "5 ml").
  assert.ok(!/\d\s?(mg|ml|g|mcg|%)\b/i.test(s.name), `${s.name}: no dosing in a suggestion`);
}
assert.ok(SUGGESTED_ESSENTIALS.some(s => s.forChildren) && SUGGESTED_ESSENTIALS.some(s => !s.forChildren));

// CONTROL for the no-dosing guard above: it must actually fire on a dose.
assert.ok(/\d\s?(mg|ml|g|mcg|%)\b/i.test('Pain relief 500 mg'), 'control: the dosing pattern catches a dose');

const have = [item({ name: 'plasters' }), item({ name: 'Children’s fever reducer' }), item({ name: "children's pain relief" })];
const left = remainingSuggestions(have).map(s => s.name);
assert.ok(!left.includes('Plasters'), 'matched ignoring case');
assert.ok(!left.includes('Children’s fever reducer'), 'matched exactly');
assert.ok(!left.includes('Children’s pain relief'), 'curly and straight apostrophes are the same word');
assert.equal(remainingSuggestions([]).length, SUGGESTED_ESSENTIALS.length);

console.log('medicineCabinet.test.ts: all assertions passed');
