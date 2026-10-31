import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureProfileFileScope, fileProfileAttachment, persistProfileFile, PROFILE_FILE_LIMIT_BYTES } from './profileFiles';

let reads = 0;
let uploads = 0;
const inline = `data:application/pdf;base64,${'A'.repeat(550 * 1024)}`;
const stored = async () => ({ storagePath: `families/business/documents/doc-${++uploads}/cv.pdf`, downloadUrl: `/api/files/content?path=families%2Fbusiness%2Fdocuments%2Fdoc-${uploads}%2Fcv.pdf` });
const options = { size: 400 * 1024, demo: false, readDataUrl: async () => { reads++; return inline; }, upload: stored };
const documents = await Promise.all([persistProfileFile(options), persistProfileFile(options)]);
assert.equal(uploads, 2);
assert.equal(reads, 0, 'real business files never enter the member document as base64');
assert.ok(JSON.stringify(documents).length < 1024, 'two substantial files store small metadata rather than exceeding the Firestore document limit');
assert.ok(documents.every(file => file.storagePath && file.downloadUrl.startsWith('/api/files/content?')));
await persistProfileFile({ ...options, size: 5 * 1024 * 1024 });
assert.equal(uploads, 3, 'a normal multi-page CV is accepted');
await assert.rejects(persistProfileFile({ ...options, size: PROFILE_FILE_LIMIT_BYTES }), /smaller than 20 MB/);
assert.equal(uploads, 3, 'oversized files are refused before any gateway side effect');
const preview = await persistProfileFile({ ...options, demo: true });
assert.equal(preview.downloadUrl, inline);
assert.equal(preview.storagePath, '');
assert.equal(uploads, 3, 'the unsaved demo never uploads');
await assert.rejects(persistProfileFile({ ...options, upload: async () => { throw new Error('permission denied'); } }), /permission denied/);
assert.equal(reads, 1, 'gateway failure does not fall back to inlining private bytes');

const steps: string[] = [];
const filing = {
  isCurrent: () => true,
  store: async () => { steps.push('upload'); return documents[0]; },
  save: async () => { steps.push('file'); return true; },
  retirePrevious: async () => { steps.push('retire'); },
};
await fileProfileAttachment(filing);
assert.deepEqual(steps, ['upload', 'file', 'retire'], 'previous evidence is removed only after the replacement is filed successfully');
steps.length = 0;
await assert.rejects(fileProfileAttachment({ ...filing, save: async () => { steps.push('file pending'); return false; } }), /cloud sync is pending/);
assert.deepEqual(steps, ['upload', 'file pending'], 'offline metadata filing keeps the previous evidence');
steps.length = 0;
await assert.rejects(fileProfileAttachment({ ...filing, save: async () => { steps.push('file denied'); throw new Error('permission denied'); } }), /permission denied/);
assert.deepEqual(steps, ['upload', 'file denied']);
for (const index of [0, 1, 2, 3]) {
  const identity: unknown[] = ['account-A', 'business-A', 'member-A', 0];
  const isCurrent = captureProfileFileScope(() => [...identity]);
  let release!: (value: typeof documents[0]) => void;
  const upload = new Promise<typeof documents[0]>(resolve => { release = resolve; });
  let filed = false;
  let retired = false;
  const operation = fileProfileAttachment({ isCurrent, store: () => upload, save: async () => { filed = true; return true; }, retirePrevious: async () => { retired = true; } });
  identity[index] = index === 3 ? 1 : 'changed';
  release(documents[0]);
  await assert.rejects(operation, /profile or account changed/);
  assert.equal(filed, false, `changed UID, space, profile or unmount epoch (${index}) blocks the delayed callback`);
  assert.equal(retired, false);
}
let stillCurrent = true;
steps.length = 0;
await assert.rejects(fileProfileAttachment({ ...filing, isCurrent: () => stillCurrent, save: async () => { steps.push('file'); stillCurrent = false; return true; } }), /profile or account changed/);
assert.deepEqual(steps, ['upload', 'file'], 'an account/space switch during filing cannot invoke old-record deletion');

const cv = readFileSync(new URL('../components/MemberCV.tsx', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../components/MemberDocuments.tsx', import.meta.url), 'utf8');
assert.equal((cv.match(/persistProfileFile\(/g) || []).length, 2, 'CV and work-document uploads both use reference storage');
assert.doesNotMatch(cv, /isDemoMode\(\)\s*\|\|\s*isBusinessSpace/);
assert.match(docs, /fileData: stored\.downloadUrl/);
assert.match(docs, /storagePath: stored\.storagePath/);
assert.match(docs, /return onAddDocument\(member\.id, newDoc\)/, 'the filing result reaches the replacement controller');
assert.match(docs, /onDeleteDocument\(member\.id, replacingId, \[id\]\)/, 'a newly filed duplicate is explicitly retained while cleaning up its predecessor');
for (const source of [cv, docs]) {
  assert.match(source, /captureProfileFileScope\(\(\) => \[auth\.currentUser\?\.uid, FAMILY_ID,/);
  assert.match(source, /useEffect\(\(\) => \(\) => \{ fileEpoch\.current\+\+; \}, \[member\.id\]\)/, 'unmount and profile transitions invalidate in-flight callbacks');
  assert.match(source, /await fileProfileAttachment\(\{ isCurrent/);
}
console.log('profileFiles: real business CVs and documents stay small, private, failure-safe and demo-local');
