import assert from 'node:assert/strict';
import type { AssetItem } from '../types';
import { assetDateMs, assetReminders, assetRecordChecklist, isIncidentAsset, replacementReviewDue, validateAssetRegister } from './assetRegister';

const tv: AssetItem = { id: 'tv', name: 'TV', category: 'Electronics', createdAt: '2026-10-01' };
const now = new Date(2026, 9, 31, 12);
assert.equal(assetDateMs('2026-02-31'), null);
assert.equal(assetDateMs('2026-13-01'), null);
assert.notEqual(assetDateMs('2028-02-29'), null);
assert.equal(assetRecordChecklist(tv).filter(c => c.recorded).length, 0);
assert.equal(assetRecordChecklist({ ...tv, documentIds: ['invoice'] }).find(c => c.label.includes('proof'))?.recorded, true);
assert.equal(isIncidentAsset({ ...tv, status: 'damaged' }), true);
assert.equal(isIncidentAsset({ ...tv, status: 'sold', incident: { type: 'damaged' } }), false);
const covered = { ...tv, warrantyUntil: '2026-11-07', warranties: [
  { id: 'm', kind: 'manufacturer' as const, endDate: '2026-11-07' },
  { id: 'r', kind: 'retailer' as const, endDate: '2026-11-15', reminderDays: [] },
] };
assert.equal(assetReminders([covered], now).length, 1, 'same legacy date is not duplicated; explicit opt-out is respected');
assert.equal(assetReminders([{ ...covered, status: 'sold' }], now).length, 0);
assert.equal(assetReminders([{ ...tv, warrantyUntil: '2026-11-07' }], now)[0].days, 7);
assert.equal(assetReminders([{ ...tv, warrantyUntil: '2026-02-31' }], now).length, 0);
assert.equal(assetReminders([{ ...tv, returnByDate: '2026-10-31' }], now)[0].days, 0);
assert.equal(assetReminders([{ ...tv, returnByDate: '2026-10-30' }], now).length, 0);
assert.equal(replacementReviewDue({ ...tv, replacementValue: '450' }, now), true);
assert.equal(replacementReviewDue({ ...tv, replacementValue: '450', replacementValueCheckedAt: '2026-10-31' }, now), false);
assert.equal(replacementReviewDue({ ...tv, replacementValue: '450', replacementValueCheckedAt: '2025-10-31' }, now), true);
assert.match(validateAssetRegister({ ...tv, warranties: [{ id: 'bad', kind: 'extended', startDate: '2026-12-01', endDate: '2026-11-01' }] })!, /on or after/);
assert.equal(validateAssetRegister(tv), null, 'legacy records do not need migration');
console.log('assetRegister: date validity, legacy compatibility, cover opt-out, damaged claims and readiness passed');
