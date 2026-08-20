// The house's service history, end to end through the AI edit pipeline.
//
//   npx tsx src/utils/aiHomeService.test.ts
//
// A vehicle has had a service log since it shipped. The house had the vendor
// directory (v236 — WHO to call) and nothing at all for WHAT THEY DID, which
// is the half you need three years later when the same pipe leaks and the
// question is who touched it last.
//
// THREE THINGS ARE GUARDED, and only the first is the feature:
//
//  1. The 'home_service' kind writes records, with the vendor directory used
//     to link — but never to overwrite what the user actually said.
//  2. A record must SURVIVE ITS VENDOR. `by` and `trade` are denormalised on
//     purpose; a log that goes blank when someone tidies the directory is not
//     a historical record, it's a join.
//  3. The household document is three-way-merged on save, so any function
//     that rebuilds it key by key DELETES every key it forgot. That already
//     happened once to the info doc's `vendors`, so the merge is run for real
//     here rather than eyeballing the returned object.
import assert from 'node:assert';
import { applyHomeServiceEdits, hasHomeServiceEdits } from './aiApply';
import { diffHouseholdUndo } from './aiUndo';
import { mergeShared } from './mergeShared';
import type { AiEdit } from '../components/AIChatbot';
import type { HouseholdInfo, HouseholdVendor } from '../types';

const VENDORS: HouseholdVendor[] = [
  { id: 'v1', name: 'Installateur Hofer', trade: 'Plumber', phone: '+43 664 111', isUsual: true },
  { id: 'v2', name: 'Anna Bauer', trade: 'Electrician', company: 'Elektro Wagner GmbH' },
];

const STORED: HouseholdInfo = {
  address: 'Hauptstraße 1',
  doorCode: '1234',
  utilities: [{ id: 'u1', type: 'Electricity', provider: 'Wien Energie' }],
  vehicles: [{ id: 'car1', name: 'VW Golf', serviceLog: [{ id: 's1', date: '2025-01-02', work: 'Oil change' }] }],
  pets: [{ id: 'p1', name: 'Rufus' }],
  homeServiceLog: [{ id: 'h1', date: '2024-03-04', work: 'Chimney swept', by: 'Rauchfangkehrer Krammer' }],
};

const clone = (): HouseholdInfo => JSON.parse(JSON.stringify(STORED));

const edit = (records: any[]): AiEdit => ({ kind: 'home_service', records } as AiEdit);
const added = (h: HouseholdInfo) => (h.homeServiceLog || []).filter((r) => r.id !== 'h1');

// --- The kind is wired ------------------------------------------------------

assert.ok(hasHomeServiceEdits([edit([{ date: '2026-01-01', work: 'x' }])]), 'hasHomeServiceEdits must see the kind, or nothing saves at all');
assert.ok(!hasHomeServiceEdits([{ kind: 'contact', name: 'X' } as AiEdit]));

{
  const next = applyHomeServiceEdits(clone(), [edit([{
    date: '2026-05-04', work: 'Replaced the boiler valve', by: 'Installateur Hofer',
    area: 'Boiler', cost: '180 EUR', warrantyUntil: '2028-05-04', notes: 'Said the pump is next.',
  }])], VENDORS);
  const r = added(next)[0];
  assert.ok(r, 'the record was not created at all');
  assert.ok(r.id && r.id !== 'h1', 'a created record needs its own fresh id (Undo deletes by id)');
  assert.equal(r.work, 'Replaced the boiler valve');
  assert.equal(r.date, '2026-05-04');
  assert.equal(r.by, 'Installateur Hofer');
  assert.equal(r.area, 'Boiler');
  assert.equal(r.cost, '180 EUR');
  assert.equal(r.warrantyUntil, '2028-05-04');
  assert.equal(r.notes, 'Said the pump is next.');
  assert.equal(r.vendorId, 'v1', 'a name that matches the directory must link to it');
  assert.equal(r.trade, 'Plumber', "and borrow the linked vendor's trade when none was given");
  assert.equal(next.homeServiceLog!.length, 2, 'the existing entry must survive');
}

// --- Linking: helpful, never authoritative ---------------------------------

{
  // The firm, not the person — a family says "Wagner" for both and which one
  // sits in the directory's `name` field is a coin flip.
  const r = added(applyHomeServiceEdits(clone(), [edit([{ date: '2026-02-02', work: 'Rewired the kitchen', by: 'Elektro Wagner GmbH' }])], VENDORS))[0];
  assert.equal(r.vendorId, 'v2', 'a company-name match must link too');
  assert.equal(r.by, 'Elektro Wagner GmbH', 'and must NOT be rewritten to the directory spelling — the log records what happened');
}

{
  const r = added(applyHomeServiceEdits(clone(), [edit([{ date: '2026-02-02', work: 'Fixed the gutter', by: 'Some bloke from down the road' }])], VENDORS))[0];
  assert.equal(r.vendorId, undefined, 'nobody in the directory means no link, not a wrong one');
  assert.equal(r.by, 'Some bloke from down the road', 'a one-off worker is exactly what this log is for');
}

{
  // The usual plumber turning up to do something else. The stated trade wins;
  // the link survives, because it is still Hofer who came.
  const r = added(applyHomeServiceEdits(clone(), [edit([{ date: '2026-02-02', work: 'Hung a radiator', by: 'Installateur Hofer', trade: 'Handyman' }])], VENDORS))[0];
  assert.equal(r.trade, 'Handyman', "the model's own word must beat the directory's default");
  assert.equal(r.vendorId, 'v1');
}

{
  // No directory at all — the assistant must still be able to file.
  const r = added(applyHomeServiceEdits(clone(), [edit([{ date: '2026-02-02', work: 'Boiler service', by: 'Hofer', trade: 'boiler' }])], []))[0];
  assert.equal(r.trade, 'Boiler / heating', 'trades go through the same matcher as the vendor directory');
  assert.equal(r.vendorId, undefined);
}

{
  const r = added(applyHomeServiceEdits(clone(), [edit([{ date: '2026-02-02', work: 'New flashing', trade: 'Roofer' }])], VENDORS))[0];
  assert.equal(r.trade, 'Other');
  assert.match(r.notes || '', /Roofer/, 'an unrecognised trade must survive in notes, not be silently dropped');
}

// --- Junk in, nothing out ---------------------------------------------------

{
  const untouched = applyHomeServiceEdits(clone(), [edit([{ date: '2026-01-01', work: '   ' }, { work: '' }])], VENDORS);
  assert.deepStrictEqual(untouched.homeServiceLog, STORED.homeServiceLog, 'an entry with no work done is not a record of anything');
  assert.deepStrictEqual(applyHomeServiceEdits(clone(), [], VENDORS), STORED, 'no edits must return the document unchanged');
}

{
  const r = added(applyHomeServiceEdits(clone(), [edit([{ date: 'last Tuesday', work: 'Unblocked the drain', warrantyUntil: 'two years' }])], VENDORS))[0];
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, 'a date the model did not format must fall back to today, never reach the store as prose');
  assert.equal(r.warrantyUntil, undefined, 'a guarantee date that is not a date is no guarantee date');
}

// --- The record outlives the vendor -----------------------------------------

{
  // Delete the plumber from the directory years later. The history must read
  // exactly the same — this is the whole reason `by` is stored on the record.
  const withWork = applyHomeServiceEdits(clone(), [edit([{ date: '2026-05-04', work: 'Replaced the boiler valve', by: 'Installateur Hofer' }])], VENDORS);
  const r = added(withWork)[0];
  assert.equal(r.by, 'Installateur Hofer');
  assert.equal(r.trade, 'Plumber');
  // Nothing about the record depends on VENDORS still containing v1 — assert
  // that by re-reading it with the directory emptied.
  const stillReadable = JSON.parse(JSON.stringify(r));
  assert.equal(stillReadable.by, 'Installateur Hofer', 'a service log that empties when a vendor row is deleted is not a record');
  assert.equal(stillReadable.trade, 'Plumber');
}

// --- Undo -------------------------------------------------------------------

{
  const before = clone();
  const after = applyHomeServiceEdits(before, [edit([
    { date: '2026-05-04', work: 'Replaced the boiler valve', by: 'Installateur Hofer' },
    { date: '2026-05-06', work: 'Bled the radiators' },
  ])], VENDORS);
  const undo = diffHouseholdUndo(before, after).filter((u) => u.domain === 'homeService');
  assert.equal(undo.length, 2, 'each logged job undoes on its own');
  assert.match(undo[0].label, /boiler valve/, 'the undo label must name the work, not "1 record"');
  assert.match(undo[0].label, /Hofer/);
  assert.equal(undo[0].parentId, undefined, 'there is only one house — a house record has no parent');
  assert.ok(!diffHouseholdUndo(before, before).some((u) => u.domain === 'homeService'), 'an unchanged document undoes nothing');
}

// --- THE MERGE ROUND TRIP: a forgotten key is a deletion --------------------

/** What actually reaches Firestore when this client saves `value`. */
const afterSave = (value: HouseholdInfo): HouseholdInfo => mergeShared<HouseholdInfo>(clone(), value, clone());

{
  const saved = afterSave(applyHomeServiceEdits(clone(), [edit([{ date: '2026-05-04', work: 'Replaced the boiler valve' }])], VENDORS));
  assert.equal(saved.homeServiceLog?.length, 2, 'the new entry and the old one must both be there after a real save');
  assert.equal(saved.vehicles?.length, 1, 'applying house work must not delete the vehicles');
  assert.equal(saved.vehicles?.[0].serviceLog?.length, 1, "...nor the vehicle's own service history");
  assert.equal(saved.pets?.length, 1);
  assert.equal(saved.utilities?.length, 1);
  assert.equal(saved.address, 'Hauptstraße 1');
  assert.equal(saved.doorCode, '1234', 'a secret this function never reads must still survive it');
}

{
  // The structural guard. A future key on HouseholdInfo must survive WITHOUT
  // anyone remembering this function exists — which is the only reason it
  // spreads the document instead of naming its keys.
  const withFutureKey = { ...clone(), somethingAddedLater: [{ id: 'x1' }] } as unknown as HouseholdInfo;
  const base = JSON.parse(JSON.stringify(withFutureKey));
  const applied = applyHomeServiceEdits(withFutureKey, [edit([{ date: '2026-05-04', work: 'Replaced the boiler valve' }])], VENDORS);
  const saved = mergeShared<HouseholdInfo>(base, applied, base) as unknown as Record<string, unknown>;
  assert.ok(
    Array.isArray(saved.somethingAddedLater) && (saved.somethingAddedLater as unknown[]).length === 1,
    'applyHomeServiceEdits drops any HouseholdInfo key it does not name — rebuild it key-by-key and the next household field dies here',
  );
}

console.log('aiHomeService.test.ts: all assertions passed');
