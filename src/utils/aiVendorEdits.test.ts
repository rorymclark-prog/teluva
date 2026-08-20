// Household vendors, end to end through the AI edit pipeline.
//
//   npx tsx src/utils/aiVendorEdits.test.ts
//
// TWO THINGS ARE GUARDED HERE, and only one of them is the feature.
//
// 1. The 'vendor' AiEdit kind itself — the assistant could not write to
//    FamilyInfo.vendors at all until v236, so a user who told it "our plumber
//    is Hofer, 0664 123" got a warm confirmation and an empty vendor list.
//
// 2. THE REAL DANGER, which has nothing to do with vendors being AI-fileable:
//    applyInfoEdits and the Undo path both return the WHOLE info document, and
//    saveFamilyInfo three-way-merges it against what this client last saw. A
//    key present in the base and missing from the value is therefore read as a
//    DELETE and applied. Any code that rebuilds the document key by key will
//    silently destroy every key it forgot. That already happened once — the
//    Undo path was written as { numbers, contacts, providers } before `vendors`
//    existed — so the tests below run the REAL mergeShared over the result
//    rather than just eyeballing the returned object.
import assert from 'node:assert';
import { applyInfoEdits, hasInfoEdits } from './aiApply';
import { removeUndoneInfoRecords } from './aiUndo';
import { mergeShared } from './mergeShared';
import type { AiEdit } from '../components/AIChatbot';
import type { FamilyInfo } from '../types';

const STORED: FamilyInfo = {
  numbers: [{ id: 'n1', label: 'Meter number', value: '4471' }],
  contacts: [{ id: 'c1', name: 'Volksschule Ottakring', relation: 'School' }],
  providers: [{ id: 'p1', name: 'Dr Berger', type: 'GP practice' }],
  vendors: [{ id: 'v1', name: 'Installateur Hofer', trade: 'Plumber', phone: '+43 664 111', isUsual: true }],
};

const clone = (): FamilyInfo => JSON.parse(JSON.stringify(STORED));

// --- The kind is wired ------------------------------------------------------

{
  const edit: AiEdit = {
    kind: 'vendor', name: 'Elektro Wagner', trade: 'Electrician', company: 'Wagner GmbH',
    phone: '+43 1 555', afterHoursPhone: '+43 664 999', accountRef: 'KD-8812',
    lastServiceDate: '2026-05-04', isUsual: true, notes: 'Rewired the kitchen.',
  };
  const next = applyInfoEdits(clone(), [edit]);
  assert.equal(next.vendors!.length, 2, 'the vendor edit must actually create a row');
  const v = next.vendors!.find((x) => x.name === 'Elektro Wagner')!;
  assert.ok(v, 'the new vendor is missing entirely');
  assert.ok(v.id && v.id !== 'v1', 'a created record needs its own fresh id (Undo deletes by id)');
  assert.equal(v.trade, 'Electrician');
  assert.equal(v.company, 'Wagner GmbH');
  assert.equal(v.afterHoursPhone, '+43 664 999', 'the out-of-hours line is the point of this list');
  assert.equal(v.accountRef, 'KD-8812');
  assert.equal(v.lastServiceDate, '2026-05-04');
  assert.equal(v.isUsual, true);
  assert.equal(v.notes, 'Rewired the kitchen.');
}

assert.ok(hasInfoEdits([{ kind: 'vendor', name: 'X' } as AiEdit]), 'hasInfoEdits must see a vendor edit, or nothing saves at all');

// --- Trade matching ---------------------------------------------------------

const tradeOf = (raw?: string) => {
  const next = applyInfoEdits(clone(), [{ kind: 'vendor', name: 'Someone', trade: raw } as AiEdit]);
  return next.vendors!.find((v) => v.name === 'Someone')!;
};

assert.equal(tradeOf('Plumber').trade, 'Plumber', 'exact match');
assert.equal(tradeOf('plumber').trade, 'Plumber', 'a model will not reproduce our capitalisation');
assert.equal(tradeOf('  LOCKSMITH ').trade, 'Locksmith');
assert.equal(tradeOf('boiler').trade, 'Boiler / heating', '"Boiler / heating" is never coming back verbatim');
assert.equal(tradeOf('Locksmith (24h)').trade, 'Locksmith');
assert.equal(tradeOf(undefined).trade, 'Other', 'no trade given is Other, not a crash');
assert.equal(tradeOf('').trade, 'Other');

{
  // An unmatched trade must not be thrown away. A row reading "Other" with no
  // trace of the word "Roofer" is a worse record than the sentence the user
  // typed.
  const v = tradeOf('Roofer');
  assert.equal(v.trade, 'Other');
  assert.match(v.notes || '', /Roofer/, 'an unrecognised trade must survive in notes');

  const withNotes = applyInfoEdits(clone(), [
    { kind: 'vendor', name: 'Dach GmbH', trade: 'Roofer', notes: 'Fixed the gutter.' } as AiEdit,
  ]).vendors!.find((x) => x.name === 'Dach GmbH')!;
  assert.match(withNotes.notes || '', /Roofer/);
  assert.match(withNotes.notes || '', /Fixed the gutter\./, "the user's own note must not be overwritten by ours");
}

// --- Nothing else in the document may be disturbed --------------------------

{
  const next = applyInfoEdits(clone(), [{ kind: 'vendor', name: 'New Person' } as AiEdit]);
  assert.deepStrictEqual(next.numbers, STORED.numbers);
  assert.deepStrictEqual(next.contacts, STORED.contacts);
  assert.deepStrictEqual(next.providers, STORED.providers);
  assert.ok(next.vendors!.some((v) => v.id === 'v1'), 'the existing vendor must survive a new one being added');
}

{
  // The original bug, in reverse: a CONTACT edit must not take the vendors
  // with it. This is what the old carry-through comment protected.
  const next = applyInfoEdits(clone(), [{ kind: 'contact', name: 'Kindergarten', phone: '123' } as AiEdit]);
  assert.deepStrictEqual(next.vendors, STORED.vendors, 'a contact edit must leave the vendor list alone');
}

// --- THE MERGE ROUND TRIP: a forgotten key is a deletion --------------------

/** What actually reaches Firestore when this client saves `value`. */
const afterSave = (value: FamilyInfo): FamilyInfo =>
  mergeShared<FamilyInfo>(clone(), value, clone());

{
  const saved = afterSave(applyInfoEdits(clone(), [{ kind: 'contact', name: 'Dentist reception' } as AiEdit]));
  assert.equal(saved.vendors?.length, 1, 'applyInfoEdits + save must not delete the vendor list');
  assert.equal(saved.numbers?.length, 1);
}

{
  // The Undo path. Written longhand as { numbers, contacts, providers } this
  // wiped `vendors` on every undo of an AI-filed contact/number/provider.
  const undone = removeUndoneInfoRecords(clone(), {
    contacts: new Set<string>(),
    numbers: new Set<string>(),
    providers: new Set(['p1']),
    vendors: new Set<string>(),
  });
  assert.deepStrictEqual(undone.providers, [], 'the undone provider must actually go');
  const saved = afterSave(undone);
  assert.equal(saved.vendors?.length, 1, 'REGRESSION: undoing a provider deleted the whole household vendor list');
  assert.equal(saved.vendors?.[0].name, 'Installateur Hofer');
  assert.equal(saved.contacts?.length, 1);
  assert.equal(saved.numbers?.length, 1);
}

{
  // Undoing a vendor removes that vendor and nothing else.
  const saved = afterSave(removeUndoneInfoRecords(clone(), {
    contacts: new Set<string>(), numbers: new Set<string>(), providers: new Set<string>(), vendors: new Set(['v1']),
  }));
  assert.deepStrictEqual(saved.vendors, [], 'the undone vendor must go');
  assert.equal(saved.providers?.length, 1, 'and nothing else may move');
}

{
  // The structural guard. A future key added to FamilyInfo must survive both
  // paths WITHOUT anyone remembering these functions exist — which is the only
  // reason both of them spread the document instead of naming its keys.
  const withFutureKey = { ...clone(), somethingAddedLater: [{ id: 'x1', name: 'Future' }] } as unknown as FamilyInfo;
  const base = JSON.parse(JSON.stringify(withFutureKey));

  const undone = removeUndoneInfoRecords(withFutureKey, {
    contacts: new Set<string>(), numbers: new Set<string>(), providers: new Set(['p1']), vendors: new Set<string>(),
  });
  const savedUndo = mergeShared<FamilyInfo>(base, undone, base) as unknown as Record<string, unknown>;
  assert.ok(
    Array.isArray(savedUndo.somethingAddedLater) && (savedUndo.somethingAddedLater as unknown[]).length === 1,
    'removeUndoneInfoRecords must carry a key it has never heard of — rebuild it key-by-key and the next FamilyInfo field dies here',
  );

  const applied = applyInfoEdits(withFutureKey, [{ kind: 'number', label: 'L', value: 'V' } as AiEdit]);
  const savedApply = mergeShared<FamilyInfo>(base, applied, base) as unknown as Record<string, unknown>;
  assert.ok(
    Array.isArray(savedApply.somethingAddedLater) && (savedApply.somethingAddedLater as unknown[]).length === 1,
    'applyInfoEdits drops any FamilyInfo key it does not name — add the key here AND to applyInfoEdits',
  );
}

console.log('aiVendorEdits.test.ts: all assertions passed');
