import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atlasPhotoMetadata, atlasLocationStatus, readAtlasPhotoMetadata, prepareAtlasPhotoDrafts } from './lifeAtlas';
import { createFileOperationScope } from './fileOperationScope';
const fixture = (name: string, type: string) => new File([readFileSync(join(import.meta.dirname, 'fixtures/atlas', name))], name, { type });
for (const [ext, type] of [['jpg', 'image/jpeg'], ['png', 'image/png'], ['heic', 'image/heic'], ['tiff', 'image/tiff']]) {
  const file = fixture('gps-vienna.' + ext, type), metadata = await readAtlasPhotoMetadata(file);
  assert.equal(metadata.lat, 48.2, ext + ' embedded GPS');
  assert.ok(Math.abs(metadata.lng! - 16.3666666667) < 0.000001);
  assert.equal(metadata.date, '2020-06-20');
  assert.equal(metadata.photoMetadata?.status, 'gps');
  assert.equal(metadata.photoMetadata?.originalName, file.name);
}
const zero = await readAtlasPhotoMetadata(fixture('gps-zero.jpg', 'image/jpeg'));
assert.equal(zero.lat, 0); assert.equal(zero.lng, 0); assert.equal(zero.photoMetadata?.status, 'gps');
const none = await readAtlasPhotoMetadata(fixture('no-metadata.jpg', 'image/jpeg'));
assert.equal(none.date, ''); assert.equal(none.photoMetadata?.status, 'no-gps');
const broken = await readAtlasPhotoMetadata(new File(['synthetic malformed photo'], 'corrupt.heic', { type: 'image/heic' }));
assert.equal(broken.photoMetadata?.status, 'read-error');
assert.equal(atlasPhotoMetadata({ latitude: NaN, longitude: 10 }).photoMetadata?.status, 'invalid-gps');
assert.match(atlasLocationStatus({ photoUrl: '/legacy-cover.jpg' }), /not checked/);
assert.match(atlasLocationStatus(none), /No GPS/);
assert.match(atlasLocationStatus(broken), /could not be read/);
const scope = createFileOperationScope(() => ['synthetic-scope']);
let originalReadBeforeCover = false;
const drafts = await prepareAtlasPhotoDrafts([fixture('gps-vienna.jpg', 'image/jpeg')], { scope,
  metadata: async file => { originalReadBeforeCover = true; return readAtlasPhotoMetadata(file); },
  thumbnail: async () => { assert.ok(originalReadBeforeCover); return 'data:image/jpeg;base64,c3ludGhldGljLWNvdmVy'; },
});
assert.equal(drafts[0].entry.lat, 48.2, 'GPS survives cover conversion in the saved entry');
assert.equal(drafts[0].entry.photoMetadata?.status, 'gps');
console.log('atlasMetadata: real synthetic JPEG/PNG/HEIC/TIFF EXIF, capture date, zero coordinates, missing/corrupt metadata and parse-before-cover verified');
