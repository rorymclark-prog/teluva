import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFileOperationScope, FileOperationCancelled } from './fileOperationScope';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

test('a UID, space or unmount change during hashing stops before any upload', async () => {
  for (const index of [0, 1, 2]) {
    const identity: unknown[] = ['old-account', 'old-space', 0];
    const operation = createFileOperationScope(() => [...identity]);
    const hash = deferred<string>();
    let uploaded = false;
    const task = (async () => {
      await operation.step(() => hash.promise);
      await operation.step(async () => { uploaded = true; });
    })();
    identity[index] = index === 2 ? 1 : 'new';
    hash.resolve('synthetic-hash');
    await assert.rejects(task, FileOperationCancelled);
    assert.equal(uploaded, false);
  }
});

test('changing identity during photo compression prevents the first byte write', async () => {
  let space = 'old-space';
  const operation = createFileOperationScope(() => ['account', space, 0]);
  const compression = deferred<string>();
  const writes: string[] = [];
  const task = (async () => {
    await operation.step(async () => 'file-data');
    const photo = await operation.step(() => compression.promise);
    await operation.step(async () => { writes.push(`${space}:${photo}`); });
  })();
  await Promise.resolve();
  space = 'new-space';
  compression.resolve('photo-bytes');
  await assert.rejects(task, FileOperationCancelled);
  assert.deepEqual(writes, []);
});

test('an already-started upload may finish its original scope but no next batch upload or callback starts', async () => {
  let uid = 'old-account';
  let space = 'old-space';
  const operation = createFileOperationScope(() => [uid, space, 0]);
  const upload = deferred<void>();
  const writes: string[] = [];
  let callback = false;
  const task = (async () => {
    for (const name of ['first', 'second']) {
      await operation.step(async () => {
        writes.push(`${uid}:${space}:${name}`);
        await upload.promise;
      });
    }
    await operation.step(() => { callback = true; });
  })();
  uid = 'new-account'; space = 'new-space';
  upload.resolve();
  await assert.rejects(task, FileOperationCancelled);
  assert.deepEqual(writes, ['old-account:old-space:first']);
  assert.equal(callback, false);
});

test('a scope retained while choosing duplicate replacement cannot restart under another account', async () => {
  let uid = 'old-account';
  const operation = createFileOperationScope(() => [uid, 'space', 0]);
  await operation.step(async () => 'hash');
  uid = 'new-account';
  let upload = false;
  await assert.rejects(operation.step(() => { upload = true; }), FileOperationCancelled);
  assert.equal(upload, false);
});

test('a scope change during filing prevents a later old-file deletion; unchanged scopes complete normally', async () => {
  let epoch = 0;
  const operation = createFileOperationScope(() => ['account', 'space', epoch]);
  const steps: string[] = [];
  await assert.rejects((async () => {
    await operation.step(() => { steps.push('upload'); });
    await operation.step(() => { steps.push('file'); epoch++; });
    await operation.step(() => { steps.push('delete previous'); });
  })(), FileOperationCancelled);
  assert.deepEqual(steps, ['upload', 'file']);
  const valid = createFileOperationScope(() => ['account', 'space', epoch]);
  await valid.step(() => { steps.push('valid upload'); });
  await valid.step(() => { steps.push('valid file'); });
  assert.deepEqual(steps.slice(-2), ['valid upload', 'valid file']);
});

test('both live Vault panels capture before preparation and pass cancellation through replacement filing', () => {
  const source = fs.readFileSync(new URL('../components/DocumentVault.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/useEffect\(\(\) => \(\) => \{ operationEpoch\.current\+\+; \}, \[\]\)/g) || []).length, 2);
  assert.equal((source.match(/createFileOperationScope\(\(\) => \[auth\.currentUser\?\.uid, FAMILY_ID, operationEpoch\.current\]\)/g) || []).length, 2);
  for (const operation of ['computeFileHash(file)', 'readFile(file)', 'uploadVaultFile(file, docId, { shared: true })', 'uploadVaultPhoto(compressed, docId, { shared: true })']) {
    assert.ok(source.includes(`operation.step(() => ${operation})`));
  }
  assert.ok(source.includes('onUpload(newDoc, replaceId, operation.isCurrent)'));
  assert.ok(source.includes('onImport(uploaded, operation.isCurrent)'));
  const replacement = source.slice(source.indexOf('const handleUpload = async'), source.indexOf('const closeUpload ='));
  assert.equal((replacement.match(/!canEditRef\.current \|\| !isCurrent\(\)/g) || []).length, 2, 'replacement checks scope before deletion and again before persistence');
});
