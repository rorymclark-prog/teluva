import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanFeatureUpdate } from './featureUpdates';
const release = JSON.parse(readFileSync('CHANGES.json', 'utf8'));
const log = JSON.parse(readFileSync('public/changelog.json', 'utf8'));
const feature = cleanFeatureUpdate(release.feature);
assert.ok(feature, 'the important release has a supported demonstration');
assert.deepEqual(feature, cleanFeatureUpdate(log[0].feature), 'the announcement and history explain the same feature');
for (const value of [null, {}, { ...feature, demo: 'unknown' }, { ...feature, id: '../arbitrary' }, { ...feature, title: '' }, { ...feature, description: 42 }]) {
  assert.equal(cleanFeatureUpdate(value), null, 'malformed or unsupported history metadata cannot create a card');
}
assert.equal(cleanFeatureUpdate({ ...feature, extra: 'ignored' })?.id, feature.id);
console.log('featureUpdates.test.ts: curated feature metadata and history agree; malformed cards rejected');
