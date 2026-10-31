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

test('all asset photo kinds stop before applying to another draft, including a second new item with the same blank id', async () => {
  for (const kind of ['primary', 'receipt', 'extra']) {
    for (const change of ['item', 'new-draft', 'admin', 'unmount']) {
      const identity: unknown[] = ['account', 'space', '', 1, true, true, 'edit', kind];
      const operation = createFileOperationScope(() => [...identity]);
      const preparation = deferred<string>();
      const writes: string[] = [], applied: string[] = [];
      const task = (async () => {
        const image = await operation.step(() => preparation.promise);
        if (kind === 'extra') await operation.step(() => { writes.push(image); });
        await operation.step(() => { applied.push(image); });
      })();
      const rejected = assert.rejects(task, FileOperationCancelled);
      if (change === 'item') identity[2] = 'asset-b';
      else if (change === 'new-draft') identity[3] = 2;
      else if (change === 'admin') identity[5] = false;
      else identity[4] = false;
      preparation.resolve('asset-a-image');
      await rejected;
      assert.deepEqual(writes, [], `${kind}/${change}: no upload begins under a changed edit scope`);
      assert.deepEqual(applied, [], `${kind}/${change}: no old image reaches another draft`);
    }
  }
});

test('an old photo completion cannot clear a replacement upload’s busy flag', async () => {
  let epoch = 1, mounted = true, busy = true;
  const first = createFileOperationScope(() => ['account', 'space', epoch, mounted]);
  const upload = deferred<string>();
  const firstEpoch = epoch;
  const task = (async () => {
    try { await first.step(() => upload.promise); }
    finally { if (mounted && epoch === firstEpoch) busy = false; }
  })();
  const rejected = assert.rejects(task, FileOperationCancelled);
  epoch += 1; // Cancel A, open B and start its upload before A resolves.
  busy = true;
  upload.resolve('old-file-url');
  await rejected;
  assert.equal(busy, true);
});

test('both asset photo editors bind picker intent and every stage, while draft removal never deletes evidence', () => {
  for (const filename of ['Assets.tsx', 'AssetDetailModal.tsx']) {
    const source = fs.readFileSync(new URL(`../components/${filename}`, import.meta.url), 'utf8');
    const begin = source.indexOf('const triggerPhoto =');
    const end = source.indexOf('// ── Save', begin) > 0 ? source.indexOf('// ── Save', begin) : source.indexOf('const handleSave =', begin);
    const photos = source.slice(begin, end);
    assert.match(photos, /pendingPhoto\.current = createFileOperationScope/);
    for (const identity of ['auth.currentUser?.uid', 'FAMILY_ID', 'photoEditing.current', 'photoEpoch.current', 'photoMounted.current', 'photoWritable.current']) assert.ok(photos.includes(identity), `${filename}: missing ${identity}`);
    assert.ok(photos.indexOf('setUploadingPhotos(true)') < photos.indexOf("if (kind !== 'extra')"), `${filename}: primary/receipt must enter the shared busy state`);
    assert.match(photos, /operation\.step\(\(\) => readFile/);
    assert.match(photos, /operation\.step\(\(\) => compressImageToAvatar/);
    assert.match(photos, /operation\.step\(\(\) => uploadAssetPhoto/);
    assert.match(photos, /setEditing(?:Item)?\(prev => operation\.isCurrent\(\)/);
    assert.match(photos, /photoEpoch\.current === epoch/);
    assert.doesNotMatch(source, /deleteAssetPhoto\(/, `${filename}: cancelling a draft must preserve the original file`);
  }
  const source = fs.readFileSync(new URL('../components/Assets.tsx', import.meta.url), 'utf8');
  const scan = source.slice(source.indexOf('const processImageForScan ='), source.indexOf('// ── Photos'));
  assert.match(scan, /operation\.step\(\(\) => fetch\('\/api\/scan-asset'/);
  assert.match(scan, /operation\.step\(\(\) => resp\.json\(\)\)/);
  assert.match(scan, /if \(!operation\.isCurrent\(\)\) return prev/);
});
