import assert from 'node:assert/strict';
import { readProtectedPreview } from './protectedPreview';
import { fileContentUrl } from './fileReferences';
const source = fileContentUrl('families/synthetic-family/documents/test/image.png');
const calls: boolean[] = [];
const user = { uid: 'synthetic-user', getIdToken: async (force = false) => { calls.push(force); return force ? 'refreshed' : 'initial'; } };
const defaults = { getUser: () => user, getSpace: () => 'synthetic-family' };
{
  let requests = 0;
  const blob = await readProtectedPreview(source, { ...defaults, fetch: async (url, options) => {
    assert.equal(url, source); assert.equal(options?.cache, 'no-store'); assert.equal(options?.redirect, 'error');
    requests++;
    if (requests === 1) return new Response('Synthetic expired token', { status: 401 });
    assert.equal((options!.headers as Record<string, string>).Authorization, 'Bearer refreshed');
    return new Response('synthetic original bytes', { headers: { 'Content-Type': 'image/png' } });
  } });
  assert.deepEqual(calls, [false, true]); assert.equal(await blob.text(), 'synthetic original bytes');
}
for (const status of [401, 403, 404, 500]) {
  let count = 0;
  await assert.rejects(readProtectedPreview(source, { ...defaults, fetch: async () => { count++; return new Response('', { status }); } }));
  assert.equal(count, status === 401 ? 2 : 1, 'permission and missing-file failures are never retried as authentication');
}
await assert.rejects(readProtectedPreview('https://external.invalid/private', { ...defaults, fetch: async () => { throw Error('Tokens must never go here'); } }));
let wrongSpaceRequested = false;
await assert.rejects(readProtectedPreview(source, { ...defaults, getSpace: () => 'another-space', fetch: async () => { wrongSpaceRequested = true; return new Response(''); } }), /different space/);
assert.equal(wrongSpaceRequested, false, 'a stale reference must not fetch another space’s bytes');
for (const change of ['user', 'space']) {
  let identity = user, space = 'synthetic-family';
  await assert.rejects(readProtectedPreview(source, { getUser: () => identity, getSpace: () => space, fetch: async () => {
    if (change === 'user') identity = { ...user }; else space = 'another-space';
    return new Response('old private bytes');
  } }), /account or space changed/);
}
await assert.rejects(readProtectedPreview(source, { ...defaults, fetch: async () => new Response('', { headers: { 'Content-Type': 'image/png' } }) }), /empty file/);
await assert.rejects(readProtectedPreview(source, { ...defaults, fetch: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) }), /not return a document/);
let cancelled = false;
await assert.rejects(readProtectedPreview(source, { ...defaults, timeoutMs: 10, fetch: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'image/png' } }) }), /stopped or timed out/);
assert.ok(cancelled, 'a timed-out stream is released');
await assert.rejects(readProtectedPreview(source, { ...defaults, timeoutMs: 10, getUser: (() => { const stalled = { ...user, getIdToken: () => new Promise<string>(() => {}) }; return () => stalled; })() }), /stopped or timed out/, 'a stalled authentication refresh must not leave the preview opening forever');
console.log('protectedPreview: bearer auth, bounded 401 refresh, denied/missing originals, external-token exclusion, account/space fences, empty/error payloads and timeout cleanup verified');
