import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  FILE_BUCKET, fileContentUrl, filePathFromReference, isDurableFileReference,
  isFamilyFilePath, newProfileFileBindings, normalizeFileReference, normalizeFileReferences,
} from './fileReferences';

const path = 'families/space-a/documents/doc-1/School report..pdf';
const legacy = `https://firebasestorage.googleapis.com/v0/b/${FILE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=old-permanent-token`;
const canonical = fileContentUrl(path);
assert.equal(filePathFromReference(legacy), path);
assert.equal(filePathFromReference(canonical), path);
assert.equal(normalizeFileReference(legacy), canonical);
assert.equal(normalizeFileReference(canonical), canonical);
assert.ok(!canonical.includes('token='), 'saved references carry a path, never a reusable access grant');
assert.equal(filePathFromReference(fileContentUrl('families/household/timeline-photos/café.jpg')), 'families/household/timeline-photos/café.jpg');

for (const bad of ['', 'families/', 'families/a/', 'families/a/../b/passport', 'families/a/./scan',
  'families/a//scan', 'families/a/scan\\other', 'families/a/scan\n.jpg', '/families/a/scan',
  'other/a/scan', `families/a/${'é'.repeat(510)}`]) {
  assert.equal(isFamilyFilePath(bad), false, `reject malformed path ${JSON.stringify(bad)}`);
  assert.throws(() => fileContentUrl(bad));
}
for (const external of ['https://example.test/photo.jpg', 'data:image/png;base64,AA==', 'blob:https://example.test/id',
  legacy.replace(FILE_BUCKET, 'someone-elses-bucket'), legacy.replace('https:', 'http:'),
  legacy.replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com.attacker.test'),
  legacy.replace('https://', 'https://user:password@'), legacy.replace('/o/', '/unexpected/'),
  'https://example.test/api/files/content?path=families%2Fa%2Fscan']) {
  assert.equal(filePathFromReference(external), null);
  assert.equal(normalizeFileReference(external), external, 'external, inline and temporary sources retain their original semantics');
}
assert.equal(filePathFromReference(`${canonical}&path=families%2Fother%2Fscan`), null);
assert.equal(filePathFromReference(`${canonical}&token=extra`), null);
assert.equal(filePathFromReference(`${canonical}#fragment`), null);
assert.equal(filePathFromReference(`/api/files/content?path=${encodeURIComponent('families/a/../other/file')}`), null);
assert.equal(isDurableFileReference(canonical), true, 'chat can persist a protected same-origin attachment');
assert.equal(isDurableFileReference(legacy), true);
assert.equal(isDurableFileReference('data:image/png;base64,AA=='), false);
assert.equal(isDurableFileReference('blob:https://example.test/id'), false);

class TimestampFixture { constructor(public seconds: number) {} }
const timestamp = new TimestampFixture(1234), date = new Date('2026-10-29');
const source = { documents: [{ fileData: legacy }], nested: { photoUrl: legacy }, timestamp, date, external: 'https://example.test/photo.jpg' };
const normalized = normalizeFileReferences(source);
assert.equal(normalized.documents[0].fileData, canonical);
assert.equal(normalized.nested.photoUrl, canonical);
assert.equal(normalized.timestamp, timestamp, 'Firestore-like class instances retain their behavior');
assert.equal(normalized.date, date);
assert.equal(source.documents[0].fileData, legacy, 'normalization never mutates a merge base or live source');
assert.deepEqual(normalizeFileReferences(normalized), normalized, 'repeated load/save/cache cycles converge on the same references');
const hostile = JSON.parse(`{"__proto__":{"polluted":true},"fileData":${JSON.stringify(legacy)}}`);
const safe = normalizeFileReferences(hostile);
assert.equal(Object.getPrototypeOf(safe), Object.prototype);
assert.equal(({} as { polluted?: boolean }).polluted, undefined);
assert.ok(Object.hasOwn(safe, '__proto__'), 'normalization retains data keys without invoking prototype setters');

const alreadyLinked = { id: 'employee', documents: [{ downloadUrl: legacy, storagePath: path }] };
assert.deepEqual(newProfileFileBindings([normalizeFileReferences(alreadyLinked)], () => alreadyLinked, 'space-a'), [], 'retiring token URLs does not create new employee grants');
const newPath = 'families/space-a/documents/new/certificate.pdf';
const nextProfile = { ...alreadyLinked, documents: [...alreadyLinked.documents, { downloadUrl: fileContentUrl(newPath), storagePath: newPath }] };
assert.deepEqual(newProfileFileBindings([nextProfile], () => alreadyLinked, 'space-a'), [{ path: newPath, memberId: 'employee' }], 'admin binding includes only newly associated objects, deduplicated across URL/path fields');
assert.deepEqual(newProfileFileBindings([nextProfile], () => alreadyLinked, 'other-space'), [], 'a save cannot grant files from another space');

// Wiring coverage: all private metadata entry points must use the same stable
// reference contract, rather than leaving a forgotten permanent-URL reader.
const root = join(import.meta.dirname, '..', '..');
const db = readFileSync(join(root, 'src/utils/db.ts'), 'utf8');
assert.match(db, /from '\.\/storageClient'/);
for (const fn of ['revealMemberSensitive', 'saveFamilyMembers', 'saveCalendarEvents', 'saveReferenceDoc', 'loadReferenceDoc', 'subscribeReferenceDoc', 'loadChatHistory', 'loadAssets']) {
  const start = db.indexOf(`function ${fn}`);
  const next = db.indexOf('\nexport ', start + 1);
  assert.ok(start >= 0 && db.slice(start, next < 0 ? undefined : next).includes('normalizeFileReferences'), `${fn} canonicalizes existing file references`);
}
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [join(directory, entry.name)] : []);
for (const filename of walk(join(root, 'src'))) assert.ok(!/from ['"]firebase\/storage['"]/.test(readFileSync(filename, 'utf8')), 'browser code cannot recreate Firebase download tokens');
const chat = readFileSync(join(root, 'src/components/AIChatbot.tsx'), 'utf8');
assert.match(chat, /const isRemoteUrl = isDurableFileReference/);
assert.match(chat, /if \(isDurableFileReference\(src.dataUrl\)\)/);
for (const match of db.matchAll(/export async function (upload[A-Z]\w*)\(/g)) {
  const next = db.indexOf('\nexport ', match.index! + 1);
  const helper = db.slice(match.index, next < 0 ? undefined : next);
  assert.ok(helper.indexOf('const spaceAtStart = FAMILY_ID') < helper.indexOf('await '), `${match[1]} captures the intended space before reading bytes`);
  assert.ok(helper.includes('auth.currentUser?.uid !== accountAtStart'), `${match[1]} refuses a different account after reading source bytes`);
}
console.log('fileReferences.test.ts: canonical paths, bucket boundaries, legacy URLs, reader persistence and source wiring passed');
