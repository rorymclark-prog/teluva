import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createFileOperationScope } from './fileOperationScope';

const key = '__teluvaServiceOriginalTest';
const bundled = await build({
  entryPoints: [new URL('./serviceDocUpload.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'synthetic-upload-io', setup(builder) {
    builder.onResolve({ filter: /^(\.\/db|\.\.\/lib\/firebase|\.\/documentDedup)$/ }, args => ({ path: args.path, namespace: 'synthetic-upload' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic-upload' }, args => ({ contents: args.path === './db'
      ? `export const loadDocuments=(...a)=>globalThis.${key}.load(...a); export const saveDocuments=(...a)=>globalThis.${key}.save(...a); export const uploadVaultFile=(...a)=>globalThis.${key}.upload(...a);`
      : args.path === './documentDedup' ? `export const computeFileHash=(...a)=>globalThis.${key}.hash(...a);`
        : `export const auth={get currentUser(){return globalThis.${key}.user;}};`, loader: 'js' }));
  } }],
});
const { uploadServiceDocFile } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const original = new File([new Uint8Array([37, 80, 68, 70, 0, 255, 13, 10, 42])], 'original.pdf', { type: 'application/pdf' });
const existing = { id: 'private', name: 'Private existing file', contentHash: 'same-hash' };
let calls: string[];
let uploaded: { file: File; options: unknown };
let saved: any[];
function reset() {
  calls = [];
  (globalThis as any)[key] = {
    user: { displayName: 'Synthetic account' },
    hash: async () => { calls.push('hash'); return 'same-hash'; },
    load: async () => { calls.push('load'); return [existing]; },
    upload: async (file: File, id: string, options: unknown) => { calls.push('upload'); uploaded = { file, options }; return { storagePath: `families/space-a/documents/${id}/original.pdf`, downloadUrl: `/api/files/content?path=${id}` }; },
    save: async (next: any[], base: any[]) => { calls.push('save'); saved = [next, base]; return true; },
  };
}
reset();
const identity: unknown[] = ['account-a', 'space-a', 'asset-a', 0, true];
const result = await uploadServiceDocFile(original, { name: 'Asset original', scope: createFileOperationScope(() => [...identity]), shared: true, dedupe: false });
assert.equal(result.kind, 'ok');
assert.equal(result.deduped, false, 'asset originals never borrow a private existing object’s ACL');
assert.deepEqual(calls, ['hash', 'load', 'upload', 'save']);
assert.deepEqual(new Uint8Array(await uploaded!.file.arrayBuffer()), new Uint8Array(await original.arrayBuffer()), 'the uploaded file keeps every original byte, including binary content');
assert.equal(uploaded!.file.type, original.type);
assert.deepEqual(uploaded!.options, { shared: true });
assert.equal(saved![0][0].fileSize, original.size);
assert.equal(saved![0][1], existing, 'existing evidence stays intact');
assert.deepEqual(saved![1], [existing]);
reset();
assert.equal((await uploadServiceDocFile(original, { name: 'Existing service behavior' })).deduped, true);
assert.deepEqual(calls, ['hash', 'load'], 'existing service callers keep their dedupe behavior');

for (const phase of ['hash', 'load', 'upload', 'save']) {
  for (const index of [0, 1, 2, 3, 4]) {
    reset();
    const scopeIdentity: unknown[] = ['account-a', 'space-a', 'asset-a', 0, true];
    let release!: (value: any) => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const value = phase === 'hash' ? 'new-hash' : phase === 'load' ? [] : phase === 'upload' ? { storagePath: 'families/space-a/documents/original/file.pdf', downloadUrl: '/api/files/content?path=original' } : true;
    (globalThis as any)[key][phase] = async () => { calls.push(phase); started(); return pending; };
    const operation = uploadServiceDocFile(original, { name: 'Original', scope: createFileOperationScope(() => [...scopeIdentity]), shared: true, dedupe: false });
    await began;
    scopeIdentity[index] = index === 3 ? 1 : index === 4 ? false : 'changed';
    release(value);
    assert.equal((await operation).kind, 'error');
    const order = ['hash', 'load', 'upload', 'save'];
    assert.deepEqual(calls, order.slice(0, order.indexOf(phase) + 1), `${phase}: a changed UID, space, asset, mount or permission (${index}) stops every subsequent stage`);
  }
}
delete (globalThis as any)[key];
console.log('serviceDocUpload: original bytes, shared asset evidence, existing dedupe and 20 scope cancellation boundaries passed');
