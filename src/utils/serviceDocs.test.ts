// Bikes, scooters and receipts on service entries.
//
//   npx tsx src/utils/serviceDocs.test.ts
//
// Rory, 2026-09-12: "with vehicls in the app family app can we add scooters,
// bicycles etc i just had a bicycle service for example where does the
// receiot and document of the service live? also, we need for anything
// imagine i had a dishwasher service where do we keep it? the document"
//
// FIVE THINGS ARE GUARDED:
//
//  1. An old vehicle with no `kind` is a CAR, and is never rewritten to say so.
//     Fields a bike does not ask for are hidden, never wiped: a value already
//     on file keeps its field on screen.
//  2. The household doc is three-way-merged on save. `kind`, `docIds` and
//     `assetId` — and any key added after them — must survive a real
//     mergeShared round-trip, not just an eyeballed object.
//  3. Pointers dangle. A receipt deleted from the vault, an appliance deleted
//     from Assets: every reader filters, none throws.
//  4. The vault's "Filed with Trek FX · service 10 Sep" is DERIVED from the
//     household doc. It is checked here because nothing stores it.
//  5. Source-text guards on the two places a regression would be silent, each
//     with a CONTROL that proves the regex can fail.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeVehicleKind, vehicleKindOf, vehicleKindMeta, vehicleFieldProfile, showVehicleField, vehicleLabel,
  VEHICLE_KINDS,
} from './vehicle';
import {
  shortServiceDate, serviceVerb, serviceDocName, memberIdForName, resolveDocIds, missingDocCount,
  withDocId, withoutDocId, linkDoc, unlinkDoc, homeEntrySubject, filedWithIndex, filedWithText,
  serviceHistoryForAsset,
} from './serviceDocs';
import { applyHouseholdEdits } from './aiApply';
import { mergeShared } from './mergeShared';
import type { AiEdit } from '../components/AIChatbot';
import type { HouseholdInfo, HomeServiceRecord, Vehicle, VaultDocument } from '../types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ─── 1. Vehicle kinds ─────────────────────────────────────────────────────

{
  const oldCar: Vehicle = { id: 'v0', name: '', make: 'VW', model: 'Golf', registration: 'W-123AB' };
  assert.equal(vehicleKindOf(oldCar), 'car', 'absent kind must read as a car');
  assert.equal(vehicleKindOf({ ...oldCar, kind: 'bicycle' }), 'bicycle');
  // An unknown value on disk (a newer build's kind, a hand edit) must not crash
  // the reader — it reads as "other".
  assert.equal(vehicleKindOf({ ...oldCar, kind: 'hovercraft' as never }), 'other');

  assert.equal(normalizeVehicleKind('bike'), 'bicycle');
  assert.equal(normalizeVehicleKind('Bicycle'), 'bicycle');
  assert.equal(normalizeVehicleKind('E-Bike'), 'e_bike');
  assert.equal(normalizeVehicleKind('e scooter'), 'e_scooter');
  assert.equal(normalizeVehicleKind('scooter'), 'moped', 'a plain "scooter" is the motor kind (Vespa), the kick kind says e-scooter');
  assert.equal(normalizeVehicleKind('cargo bike'), 'cargo_bike');
  assert.equal(normalizeVehicleKind('Motorrad'), 'motorbike');
  assert.equal(normalizeVehicleKind('camper'), 'van');
  assert.equal(normalizeVehicleKind('car'), 'car');
  assert.equal(normalizeVehicleKind('boat'), 'other', 'an unknown word lands in the closed set, never as raw text');
  assert.equal(normalizeVehicleKind(''), undefined);
  assert.equal(normalizeVehicleKind('   '), undefined);
  assert.equal(normalizeVehicleKind(undefined), undefined);
  assert.equal(normalizeVehicleKind(42), undefined);
  for (const k of VEHICLE_KINDS) assert.equal(normalizeVehicleKind(k.kind), k.kind, `${k.kind} must round-trip`);

  const bike = vehicleFieldProfile('bicycle');
  assert.equal(bike.plate, false);
  assert.equal(bike.fuel, false);
  assert.equal(bike.inspection, false);
  assert.equal(bike.vignette, false);
  assert.equal(bike.parkingPermit, false);
  assert.equal(bike.vinLabel, 'Frame no.');
  // CONTROL: a car still asks for all of it.
  const car = vehicleFieldProfile('car');
  assert.ok(car.plate && car.fuel && car.inspection && car.vignette && car.parkingPermit);
  assert.notEqual(car.vinLabel, 'Frame no.');
  // A moped has a plate and an inspection but no motorway vignette.
  const moped = vehicleFieldProfile('moped');
  assert.ok(moped.plate && moped.inspection && !moped.vignette);

  // Hidden, never wiped: a value already on file keeps its field visible.
  assert.equal(showVehicleField(false, 'W-123AB'), true, 'a bike with a plate on file must still show the plate');
  assert.equal(showVehicleField(false, ''), false);
  assert.equal(showVehicleField(false, '   '), false);
  assert.equal(showVehicleField(false, undefined), false);
  assert.equal(showVehicleField(true, ''), true);

  assert.equal(vehicleLabel({ id: 'b', name: '', kind: 'bicycle' }), 'Bicycle');
  assert.equal(vehicleLabel({ id: 'c', name: '' }), 'Vehicle', 'an unnamed old record keeps saying what it always said');
  assert.equal(vehicleLabel({ id: 't', name: 'Trek FX', kind: 'bicycle' }), 'Trek FX');
  assert.ok(vehicleKindMeta('e_scooter').icon, 'every kind has an icon');
}

// The assistant's door: list_add vehicles normalises kind; a car gets none.
{
  const add = (item: Record<string, string>): AiEdit => ({ kind: 'list_add', list: 'vehicles', item } as AiEdit);
  const existing: Vehicle = { id: 'v0', name: 'Golf', registration: 'W-1' };
  const out = applyHouseholdEdits({ vehicles: [existing] }, [
    add({ name: 'Trek FX', kind: 'bike' }),
    add({ name: 'Octavia', kind: 'car' }),
    add({ name: 'Fiat', kind: '' }),
    add({ name: 'Polo' }),
    add({ name: 'Canoe', kind: 'boat' }),
  ]);
  const byName = new Map((out.vehicles || []).map((v) => [v.name, v]));
  assert.equal(byName.get('Trek FX')?.kind, 'bicycle');
  assert.ok(!('kind' in byName.get('Octavia')!), 'a car is stored with no kind — absent means car');
  assert.ok(!('kind' in byName.get('Fiat')!), 'an empty kind is dropped, not stored as ""');
  assert.ok(!('kind' in byName.get('Polo')!));
  assert.equal(byName.get('Canoe')?.kind, 'other');
  assert.deepStrictEqual(byName.get('Golf'), existing, 'an old record is never rewritten to add a kind');
}

// ─── 2. mergeShared round-trip ────────────────────────────────────────────

const vaultDoc = (id: string, name: string, uploadedAt: string): VaultDocument => ({
  id, name, category: 'Financial', fileName: `${name}.pdf`, fileType: 'application/pdf', fileSize: 1000,
  storagePath: `vault/${id}.pdf`, downloadUrl: `https://example.invalid/${id}`, uploadedAt,
});
const DOCS: VaultDocument[] = [
  vaultDoc('d1', 'Trek FX — service 10 Sep 2026', '2026-09-10'),
  vaultDoc('d2', 'Dishwasher — repair 2 Mar 2025', '2025-03-02'),
];

const HOUSE: HouseholdInfo = {
  address: 'Hauptstraße 1',
  vehicles: [
    {
      id: 'bike1', name: 'Trek FX', kind: 'bicycle', vin: 'WTU123',
      serviceLog: [{ id: 's1', date: '2026-09-10', work: 'Annual service, new chain', cost: '€85', docIds: ['d1'] }],
    },
    { id: 'car1', name: 'Golf', registration: 'W-123AB' },
  ],
  homeServiceLog: [
    { id: 'h1', date: '2025-03-02', work: 'Replaced the drain pump', area: 'Kitchen', assetId: 'a1', docIds: ['d2'] },
  ],
};

{
  // The future-key pattern, at every level this feature touches: the doc, a
  // vehicle, a service entry and a house entry. Whatever gets added next must
  // survive without anyone remembering this code exists.
  const base = clone(HOUSE) as unknown as Record<string, any>;
  base.somethingAddedLater = [{ id: 'x1' }];
  base.vehicles[0].somethingAddedLater = 'bike-level';
  base.vehicles[0].serviceLog[0].somethingAddedLater = 'entry-level';
  base.homeServiceLog[0].somethingAddedLater = 'house-entry-level';

  // Local: link a second receipt to the bike service and unlink nothing else,
  // through the same helpers VehiclesView uses (they spread the record).
  const local = clone(base);
  local.vehicles[0] = { ...local.vehicles[0], serviceLog: local.vehicles[0].serviceLog.map((r: any) => linkDoc(r, 'd3')) };

  // Server, concurrently: somebody else logged a new house job and renamed the car.
  const server = clone(base);
  server.homeServiceLog = [...server.homeServiceLog, { id: 'h2', date: '2026-09-11', work: 'Chimney swept' }];
  server.vehicles[1] = { ...server.vehicles[1], name: 'Golf (old)' };

  const saved = mergeShared<Record<string, any>>(base, local, server);
  const bike = saved.vehicles.find((v: any) => v.id === 'bike1');
  assert.equal(bike.kind, 'bicycle', 'kind must survive the merge');
  assert.deepStrictEqual(bike.serviceLog[0].docIds, ['d1', 'd3'], 'the new link must land');
  assert.equal(bike.somethingAddedLater, 'bike-level');
  assert.equal(bike.serviceLog[0].somethingAddedLater, 'entry-level');
  const h1 = saved.homeServiceLog.find((r: any) => r.id === 'h1');
  assert.equal(h1.assetId, 'a1', 'assetId must survive the merge');
  assert.deepStrictEqual(h1.docIds, ['d2'], 'docIds on a house entry must survive the merge');
  assert.equal(h1.somethingAddedLater, 'house-entry-level');
  assert.ok(saved.homeServiceLog.some((r: any) => r.id === 'h2'), "the other writer's new job must survive");
  assert.equal(saved.vehicles.find((v: any) => v.id === 'car1').name, 'Golf (old)', "the other writer's rename must survive");
  assert.ok(Array.isArray(saved.somethingAddedLater) && saved.somethingAddedLater.length === 1);
  assert.equal(saved.address, 'Hauptstraße 1');
}

{
  // Unlinking the LAST receipt drops the key — an absent key, not `[]` — and
  // keeps every other key on the record.
  const rec = { id: 's1', date: '2026-09-10', work: 'x', docIds: ['d1'], somethingAddedLater: 1 };
  const out = unlinkDoc(rec, 'd1');
  assert.ok(!('docIds' in out), 'the last unlink must remove the key');
  assert.equal((out as any).somethingAddedLater, 1, 'unlinkDoc must spread the record');
  assert.deepStrictEqual(rec.docIds, ['d1'], 'unlinkDoc must not mutate its input');
  assert.deepStrictEqual(linkDoc(rec, 'd1').docIds, ['d1'], 'linking twice is a no-op');
  assert.deepStrictEqual(withDocId(undefined, 'd9'), ['d9']);
  assert.equal(withoutDocId(['d1'], 'd1'), undefined);
  assert.deepStrictEqual(withoutDocId(['d1', 'd2'], 'd1'), ['d2']);
}

// ─── 3. Dangling pointers never throw ─────────────────────────────────────

{
  assert.deepStrictEqual(resolveDocIds(['gone', 'd1', 'd1'], DOCS).map((d) => d.id), ['d1'], 'drop unknown, dedupe');
  assert.equal(missingDocCount(['gone', 'gone', 'd1', 'also-gone'], DOCS), 2);
  assert.deepStrictEqual(resolveDocIds(undefined, DOCS), []);
  assert.equal(missingDocCount(undefined, DOCS), 0);
  // Junk on disk (a hand edit, an older build) — filtered, not thrown on.
  assert.deepStrictEqual(resolveDocIds([null, 5, 'd2'] as unknown as string[], DOCS).map((d) => d.id), ['d2']);
  assert.equal(missingDocCount('d1' as unknown as string[], DOCS), 0);

  const junk = {
    vehicles: [{ id: 'v', name: 'X' }, { id: 'w', name: 'Y', serviceLog: [{ id: 'r', date: '', work: 'x', docIds: 'd1' }] }],
    homeServiceLog: [{ id: 'h', date: '', work: '', docIds: null }],
  } as unknown as HouseholdInfo;
  assert.equal(filedWithIndex(junk).size, 0);
  assert.equal(filedWithIndex(null).size, 0);
  assert.equal(filedWithIndex(undefined).size, 0);
  assert.equal(filedWithIndex({}).size, 0);

  assert.deepStrictEqual(serviceHistoryForAsset(HOUSE, 'deleted-asset'), []);
  assert.deepStrictEqual(serviceHistoryForAsset(HOUSE, undefined), []);
  assert.deepStrictEqual(serviceHistoryForAsset(null, 'a1'), []);
  assert.deepStrictEqual(serviceHistoryForAsset({ homeServiceLog: [null] } as unknown as HouseholdInfo, 'a1'), []);

  // An appliance deleted from Assets: the entry falls back to its own words.
  const r: HomeServiceRecord = { id: 'h', date: '2025-03-02', work: 'Replaced the drain pump', assetId: 'gone' };
  assert.equal(homeEntrySubject({ ...r, area: 'Kitchen' }, [{ id: 'a1', name: 'Dishwasher' }]), 'Kitchen');
  assert.equal(homeEntrySubject(r, []), 'Replaced the drain pump');
  assert.equal(homeEntrySubject({ ...r, work: 'x'.repeat(60) }).length, 40, 'a long work text is capped — it becomes a file name');
  assert.equal(homeEntrySubject({ ...r, work: '' }), 'Home');
  assert.equal(homeEntrySubject({ ...r, assetId: 'a1' }, [{ id: 'a1', name: 'Dishwasher' }]), 'Dishwasher');
}

// ─── 4. The derived "Filed with …" line ───────────────────────────────────

{
  const assets = [{ id: 'a1', name: 'Dishwasher' }];
  const index = filedWithIndex(HOUSE, assets);
  const now = new Date(2026, 8, 12);
  assert.deepStrictEqual(index.get('d1')?.map((f) => filedWithText(f, now)), ['Trek FX · service 10 Sep'],
    'this year: no year');
  assert.deepStrictEqual(index.get('d2')?.map((f) => filedWithText(f, now)), ['Dishwasher · repair 2 Mar 2025'],
    'another year: with the year; "Replaced" reads as a repair');
  assert.equal(index.has('d3'), false);

  // One receipt filed on two entries lists both.
  const both = clone(HOUSE);
  both.homeServiceLog![0].docIds = ['d2', 'd1'];
  assert.equal(filedWithIndex(both, assets).get('d1')?.length, 2);

  // The appliance was deleted from Assets: the line still reads, from `area`.
  assert.deepStrictEqual(filedWithIndex(HOUSE, []).get('d2')?.map((f) => filedWithText(f, now)), ['Kitchen · repair 2 Mar 2025']);

  // The vault document itself carries no back-pointer — the whole point of
  // deriving it. CONTROL: the service entry's side does carry the link, so
  // the same regex is proven able to find a link field.
  const typesSrc = fs.readFileSync(path.join(repoRoot, 'src/types.ts'), 'utf8');
  const body = (name: string) => {
    const m = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}\\n`).exec(typesSrc);
    assert.ok(m, `interface ${name} not found in types.ts`);
    return m![1];
  };
  const linkField = /^\s*(docIds|serviceIds|filedWith|serviceEntryId|entryIds?)\??:/m;
  assert.ok(!linkField.test(body('VaultDocument')), 'VaultDocument must not store a back-pointer to service entries');
  assert.ok(linkField.test(body('ServiceRecord')), 'control: the regex must find ServiceRecord.docIds');
}

// Names and small helpers.
{
  assert.equal(serviceDocName('Trek FX', 'service', '2026-09-10'), 'Trek FX — service 10 Sep 2026');
  assert.equal(serviceDocName('', 'repair', ''), 'Service — repair');
  assert.equal(shortServiceDate('2026-09-10'), '10 Sep 2026');
  assert.equal(shortServiceDate('2026-13-01'), '');
  assert.equal(shortServiceDate('not a date'), '');
  assert.equal(serviceVerb('Fixed a puncture'), 'repair');
  assert.equal(serviceVerb('Annual service'), 'service');
  const members = [{ id: 'm1', name: 'Rory' }, { id: 'm2', name: 'Rory Senior' }];
  assert.equal(memberIdForName(members, ' rory '), 'm1');
  assert.equal(memberIdForName(members, 'Ror'), undefined, 'no prefix guessing — a receipt on the wrong profile is worse than none');
  assert.equal(memberIdForName(members, ''), undefined);
}

// ─── 5. Source-text guards (each with a CONTROL) ─────────────────────────

{
  // (a) The house form rebuilds the whole record on save. Without `...initial`
  // first, every edit deletes docIds and assetId — and anything added later.
  const hv = fs.readFileSync(path.join(repoRoot, 'src/components/HouseholdView.tsx'), 'utf8');
  const start = hv.indexOf('function HomeServiceForm(');
  assert.ok(start > 0, 'HomeServiceForm not found in HouseholdView.tsx');
  const next = hv.indexOf('\nfunction ', start + 10);
  const form = hv.slice(start, next > 0 ? next : undefined);
  const spreadsFirst = /onSave\(\{\s*\.\.\.initial,/;
  assert.ok(spreadsFirst.test(form), 'HomeServiceForm must build its record as onSave({ ...initial, … })');
  // CONTROL: the longhand rebuild this replaced must NOT pass.
  assert.ok(!spreadsFirst.test('onSave({\n      id: initial?.id ?? newId(),\n      ...initial,'),
    'control: a spread AFTER the named keys is not "first"');
  assert.ok(!spreadsFirst.test('onSave({\n      id: initial?.id ?? newId(),'), 'control: no spread at all must fail');
  assert.ok(/docIds: docIds\.length \? docIds : undefined/.test(form) && /assetId: assetId \|\| undefined/.test(form),
    'the form must write docIds and assetId back');

  // (b) The receipt viewer is portalled to <body>. The vehicle sheet has a
  // backdrop-blur, which makes it the containing block for position:fixed —
  // rendered inline, the viewer would be trapped inside the sheet.
  const sd = fs.readFileSync(path.join(repoRoot, 'src/components/ServiceDocs.tsx'), 'utf8');
  const portalled = /createPortal\(\s*<DocumentViewer[\s\S]{0,300}?document\.body/;
  assert.ok(portalled.test(sd), 'ServiceDocChips must portal DocumentViewer to document.body');
  assert.ok(!portalled.test('{viewing && <DocumentViewer document={x} onClose={close} />}'),
    'control: an inline DocumentViewer must fail the portal check');

  // (c) A new vehicle starts with NO kind, so tapping Save on an untouched
  // form writes a car the same way it always did.
  const vv = fs.readFileSync(path.join(repoRoot, 'src/components/VehiclesView.tsx'), 'utf8');
  const blank = /const BLANK: Vehicle = \{([\s\S]*?)\};/.exec(vv);
  assert.ok(blank, 'BLANK not found in VehiclesView.tsx');
  assert.ok(!/\bkind:/.test(blank![1]), 'BLANK must not stamp a kind');
  assert.ok(/\bkind:/.test("id: '', kind: 'car', name: ''"), 'control: the kind regex must match a stamped kind');
}

console.log('serviceDocs.test.ts: all assertions passed');
