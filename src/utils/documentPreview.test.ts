import assert from 'node:assert/strict';
import { documentStorageDescription, isPlainTextType, readPlainTextPreview, TEXT_PREVIEW_MAX_BYTES } from './documentPreview';
import { toFamilyDoc } from './vaultDoc';
import { fileContentUrl } from './fileReferences';
import type { VaultDocument } from '../types';

const original: VaultDocument = { id: 'synthetic', name: 'Synthetic receipt', category: 'Other', fileName: 'receipt.txt', fileType: 'text/plain', fileSize: 20, storagePath: 'families/example/documents/receipt.txt', downloadUrl: fileContentUrl('families/example/documents/receipt.txt'), uploadedAt: '2026-11-07', contentHash: 'synthetic-hash', connectorSource: { representation: 'original', byteSource: 'authorized-host-file' } };
const mapped = toFamilyDoc(original);
assert.equal(mapped.storagePath, original.storagePath); assert.equal(mapped.contentHash, original.contentHash);
assert.deepEqual(mapped.connectorSource, original.connectorSource);
assert.equal(documentStorageDescription(mapped).label, 'Protected Vault file');
assert.match(documentStorageDescription(mapped).detail, /Imported original attachment/);
assert.match(documentStorageDescription(toFamilyDoc({ ...original, connectorSource: { representation: 'export' } })).detail, /Imported document export/);
for (const [fileData, label] of [['PLACEHOLDER', 'Placeholder'], ['', 'Placeholder'], ['data:text/plain,example', 'Embedded file'], ['blob:example', 'Temporary browser preview'], ['https://example.invalid/file.txt', 'Linked file'], ['unknown-reference', 'Storage not verified']]) {
  assert.equal(documentStorageDescription({ ...mapped, fileData }).label, label, 'provenance alone cannot claim a protected/synced file');
}
assert.ok(isPlainTextType('TEXT/PLAIN; charset=utf-8'));
assert.ok(!isPlainTextType('text/html')); assert.ok(!isPlainTextType('application/octet-stream'));

const source = original.downloadUrl;
const user = { uid: 'synthetic-user', getIdToken: async () => 'synthetic-token' };
const defaults = { getUser: () => user, getSpace: () => 'example' };
const raw = '<script>window.unwanted = true</script>\n<img src=x onerror=alert(1)>\nSynthetic receipt € 49.00';
{
  let calls = 0;
  const text = await readPlainTextPreview(source, { ...defaults, fetch: async (url, init) => {
    calls++; assert.equal(url, source); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    return new Response(raw, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } });
  assert.equal(calls, 1); assert.equal(text, raw, 'markup is returned only as text, never interpreted');
}
for (const invalid of ['https://example.invalid/file.txt', fileContentUrl('families/other/documents/receipt.txt'), 'data:text/plain,hello', 'blob:example']) {
  await assert.rejects(readPlainTextPreview(invalid, { ...defaults, fetch: async () => { throw Error('No request allowed'); } }), /current space/);
}
for (const status of [401, 403, 404, 500]) {
  await assert.rejects(readPlainTextPreview(source, { ...defaults, fetch: async () => new Response('private provider details', { status }) }), /unavailable or you no longer have permission/);
}
for (const type of ['text/html', 'application/json', 'application/octet-stream']) {
  await assert.rejects(readPlainTextPreview(source, { ...defaults, fetch: async () => new Response(raw, { headers: { 'Content-Type': type } }) }), /not plain text/);
}
{
  let calls = 0;
  await assert.rejects(readPlainTextPreview(source, { ...defaults, knownSize: TEXT_PREVIEW_MAX_BYTES + 1, fetch: async () => { calls++; return new Response(''); } }), /64 KB/);
  assert.equal(calls, 0);
  await assert.rejects(readPlainTextPreview(source, { ...defaults, fetch: async () => new Response('small', { headers: { 'Content-Type': 'text/plain', 'Content-Length': String(TEXT_PREVIEW_MAX_BYTES + 1) } }) }), /64 KB/);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(TEXT_PREVIEW_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  await assert.rejects(readPlainTextPreview(source, { ...defaults, fetch: async () => new Response(stream, { headers: { 'Content-Type': 'text/plain' } }) }), /64 KB/);
  assert.ok(cancelled, 'an unadvertised oversized response is cancelled before retaining more than the bound');
}
{
  const bytes = new TextEncoder().encode('€');
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); c.enqueue(bytes.slice(1)); c.close(); } });
  assert.equal(await readPlainTextPreview(source, { ...defaults, fetch: async () => new Response(stream, { headers: { 'Content-Type': 'text/plain' } }) }), '€');
  await assert.rejects(readPlainTextPreview(source, { ...defaults, fetch: async () => new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'text/plain' } }) }));
  await assert.rejects(readPlainTextPreview(source, { ...defaults, fetch: async () => new Response('binary\0data', { headers: { 'Content-Type': 'text/plain' } }) }), /non-text data/);
}
for (const change of ['account', 'space']) {
  let identity = user, space = 'example', calls = 0;
  const changingUser = { uid: user.uid, getIdToken: async () => { if (change === 'account') identity = { ...changingUser }; else space = 'other'; return 'synthetic-token'; } };
  identity = changingUser;
  await assert.rejects(readPlainTextPreview(source, { getUser: () => identity, getSpace: () => space, fetch: async () => { calls++; return new Response(''); } }), /account or space changed/);
  assert.equal(calls, 0, 'identity changes during token retrieval cannot send a request');
}
{
  let space = 'example';
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('old space text')); c.close(); } });
  await assert.rejects(readPlainTextPreview(source, { ...defaults, getSpace: () => space, fetch: async () => { space = 'other'; return new Response(stream, { headers: { 'Content-Type': 'text/plain' } }); } }), /account or space changed/);
}
{
  const controller = new AbortController(); let started = false, cancelled = false;
  const promise = readPlainTextPreview(source, { ...defaults, signal: controller.signal, fetch: async () => { started = true; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/plain' } }); } });
  while (!started) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); await assert.rejects(promise, /stopped/); assert.ok(cancelled);
}
console.log('documentPreview.test.ts: honest storage/provenance, current-space authorized reads, bounded UTF-8, inert text payloads, refusal and cancellation pass');
