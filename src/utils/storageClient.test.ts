import assert from 'node:assert/strict';
import { createFileSession, createStorageClient, deleteObject, fetchFileBlob, getDownloadURL, ref, uploadBytes, type FileUser, type FileSessionLock, type FileSessionIntent, type FileSessionIntentStore } from './storageClient';
import { FILE_BUCKET, fileContentUrl } from './fileReferences';

const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const ok = () => new Response('{}', { status: 200 });
const user = (uid: string): FileUser => ({ uid, getIdToken: async () => `fixture-token-${uid}` });
const memoryIntents = (): FileSessionIntentStore => {
  let current: FileSessionIntent | null = null;
  return { read: () => current, write: value => { current = value; } };
};
const serialLock = (): FileSessionLock => {
  let queue: Promise<unknown> = Promise.resolve();
  return run => { const task = queue.catch(() => {}).then(run); queue = task.catch(() => {}); return task; };
};
const makeSession = (options: Parameters<typeof createFileSession>[0]) => createFileSession({
  withLock: serialLock(), intentStore: memoryIntents(), ...options,
});

// Two tabs share cookies. An origin-wide lock covers the ENTIRE old response,
// and stale hourly refreshes may not replace a newer account's global intent.
{
  const withLock = serialLock(), intentStore = memoryIntents();
  const a = user('tab-a'), b = user('tab-b');
  const pendingA = deferred<Response>();
  const calls: string[] = [];
  const request: typeof fetch = async (_url, init) => {
    const token = new Headers(init?.headers).get('Authorization') || '';
    calls.push(`${init?.method}:${token}`);
    return token.endsWith('tab-a') ? pendingA.promise : ok();
  };
  const tabA = createFileSession({ getUser: () => a, fetch: request, withLock, intentStore });
  const tabB = createFileSession({ getUser: () => b, fetch: request, withLock, intentStore });
  const openingA = tabA.ensure(a).then(() => false, () => true);
  await tick();
  const openingB = tabB.changeIdentity(b);
  await tick();
  assert.deepEqual(calls, ['DELETE:', 'POST:Bearer fixture-token-tab-a']);
  pendingA.resolve(ok());
  assert.equal(await openingA, true);
  await openingB;
  assert.equal(tabB.isReadyFor('tab-b'), true);
  assert.deepEqual(calls, ['DELETE:', 'POST:Bearer fixture-token-tab-a', 'DELETE:', 'POST:Bearer fixture-token-tab-b']);
  await assert.rejects(tabA.ensure(a, true), /account changed in another tab/i);
  assert.equal(calls.length, 4, 'a stale tab refresh cannot overwrite a newer shared cookie');
}
{
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  try {
    let requests = 0;
    const active = user('unsupported');
    const session = createFileSession({ getUser: () => active, intentStore: memoryIntents(), fetch: async () => { requests += 1; return ok(); } });
    await assert.rejects(session.ensure(active), /cannot open protected files safely/);
    assert.equal(requests, 0, 'unsupported browsers fail closed without an unsafe per-tab exchange');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
}


// Cookie mutations serialize even when an old account's POST is already on
// the wire. Ignoring its promise is insufficient: its Set-Cookie still lands.
{
  let active: FileUser | null = user('a');
  const postA = deferred<Response>();
  const calls: string[] = [];
  const session = makeSession({ getUser: () => active, fetch: async (_url, init) => {
    const token = new Headers(init?.headers).get('Authorization') || '';
    calls.push(`${init?.method}:${token}`);
    return token.endsWith('-a') ? postA.promise : ok();
  } });
  const a = session.ensure(active).then(() => false, () => true);
  await tick();
  assert.deepEqual(calls, ['DELETE:', 'POST:Bearer fixture-token-a']);
  active = user('b');
  const b = session.changeIdentity(active);
  await tick();
  assert.equal(calls.length, 2, 'new identity waits for older Set-Cookie response');
  postA.resolve(ok());
  assert.equal(await a, true, 'old identity cannot become ready after account switch');
  await b;
  assert.deepEqual(calls, ['DELETE:', 'POST:Bearer fixture-token-a', 'DELETE:', 'POST:Bearer fixture-token-b']);
  assert.equal(session.isReadyFor('a'), false);
  assert.equal(session.isReadyFor('b'), true);
  await session.clear();
  assert.equal(session.isReadyFor('b'), false);
  assert.equal(calls.at(-1), 'DELETE:');
}
{
  const active = user('same');
  let count = 0;
  const session = makeSession({ getUser: () => active, fetch: async () => { count += 1; return ok(); } });
  const first = session.ensure(active), second = session.ensure(active);
  assert.equal(first, second, 'auth listener and provider share one initial handshake');
  await first;
  await session.ensure(active);
  assert.equal(count, 2, 'a ready same-account session is reused');
  await session.ensure(active, true);
  assert.equal(count, 3, 'token refresh renews the cookie without changing identity');
  const originalNow = Date.now;
  const time = Date.now();
  try {
    Date.now = () => time + 61 * 60_000;
    assert.equal(session.isReadyFor(active.uid), false, 'a long-sleeping app cannot trust an expired one-hour session');
    await session.ensure(active);
    assert.equal(count, 4, 'foreground renewal exchanges a fresh token after a long sleep');
  } finally { Date.now = originalNow; }
}
{
  let active: FileUser | null = user('a');
  const token = deferred<string>();
  active.getIdToken = () => token.promise;
  const calls: string[] = [];
  const session = makeSession({ getUser: () => active, fetch: async (_url, init) => { calls.push(init?.method || ''); return ok(); } });
  const opening = session.ensure(active).then(() => false, () => true);
  await tick();
  active = null;
  const clearing = session.clear();
  token.resolve('expired-account-token');
  assert.equal(await opening, true);
  await clearing;
  assert.deepEqual(calls, ['DELETE', 'DELETE'], 'a token resolved after sign-out is never exchanged');
}
{
  const active = user('blocked');
  const calls: string[] = [];
  const session = makeSession({ getUser: () => active, fetch: async (_url, init) => {
    calls.push(init?.method || ''); return new Response('{}', { status: 503 });
  } });
  await assert.rejects(session.ensure(active), /Could not close/);
  assert.deepEqual(calls, ['DELETE'], 'a previous cookie must be cleared before another account opens');
  assert.equal(session.isReadyFor(active.uid), false);
  await assert.rejects(session.clear(), /Could not close/, 'failed logout is reported to its caller');
}
{
  const active = user('storage-blocked');
  let requests = 0;
  const session = makeSession({
    getUser: () => active,
    intentStore: { read: () => { throw new Error('intent storage unavailable'); }, write: () => { throw new Error('intent storage unavailable'); } },
    fetch: async () => { requests += 1; return ok(); },
  });
  let closing!: Promise<void>, changing!: Promise<void>;
  assert.doesNotThrow(() => { closing = session.clear(); }, 'unavailable browser storage must reach logout .catch');
  await assert.rejects(closing, /intent storage unavailable/);
  assert.doesNotThrow(() => { changing = session.changeIdentity(active); }, 'auth callbacks must receive a rejected promise, never a synchronous exception');
  await assert.rejects(changing, /intent storage unavailable/);
  await assert.rejects(session.ensure(active), /intent storage unavailable/);
  assert.equal(requests, 0, 'unavailable identity coordination cannot start an unsafe cookie exchange');
}
{
  const active = user('storage-later-blocked'), memory = memoryIntents();
  let blocked = false;
  const session = makeSession({ getUser: () => active, intentStore: {
    read: () => { if (blocked) throw new Error('storage became unavailable'); return memory.read(); }, write: memory.write,
  }, fetch: async () => ok() });
  await session.ensure(active);
  blocked = true;
  assert.equal(session.isReadyFor(active.uid), false, 'foreground readiness fails closed if coordination storage disappears');
  let retry!: Promise<void>;
  assert.doesNotThrow(() => { retry = session.ensure(active); });
  await assert.rejects(retry, /storage became unavailable/);
}

// File requests use explicit object paths, a fresh Bearer token for mutations,
// and no Firebase Storage SDK or permanent URL capability.
{
  const active = user('writer');
  const calls: { url: string; init?: RequestInit }[] = [];
  const storage = createStorageClient({ getUser: () => active, fetch: async (url, init) => { calls.push({ url: String(url), init }); return ok(); } });
  const path = 'families/space-a/documents/doc-1/report.pdf';
  const target = ref(storage, path);
  const bytes = new Blob(['private fixture'], { type: 'application/pdf' });
  await uploadBytes(target, bytes, { contentType: bytes.type });
  assert.equal(calls[0].url, fileContentUrl(path));
  assert.equal(calls[0].init?.method, 'PUT');
  assert.equal(calls[0].init?.body, bytes);
  assert.equal(new Headers(calls[0].init?.headers).get('Authorization'), 'Bearer fixture-token-writer');
  assert.equal(new Headers(calls[0].init?.headers).get('Content-Type'), 'application/pdf');
  assert.equal(await getDownloadURL(target), fileContentUrl(path));
  assert.equal(calls.length, 1, 'getting a reference never mints another token or performs a public download');
  const oldUrl = `https://firebasestorage.googleapis.com/v0/b/${FILE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=retired`;
  await deleteObject(ref(storage, oldUrl));
  assert.equal(calls[1].url, fileContentUrl(path));
  assert.equal(calls[1].init?.method, 'DELETE');
  await assert.rejects(uploadBytes(target, new Blob([new Uint8Array(20 * 1024 * 1024)])), /smaller than 20 MB/);
  assert.equal(calls.length, 2, 'oversize bytes never reach the network');
  assert.throws(() => ref(storage, 'https://example.test/file.pdf'));
  assert.equal(new Headers(calls[0].init?.headers).get('x-teluva-file-scope'), null, 'profile uploads stay owner-bound by default');
  await uploadBytes(target, bytes, { contentType: bytes.type, shared: true });
  assert.equal(new Headers(calls[2].init?.headers).get('x-teluva-file-scope'), 'shared', 'the general Vault explicitly requests shared team-file visibility');
}
{
  let active: FileUser | null = user('old');
  const token = deferred<string>();
  active.getIdToken = () => token.promise;
  let count = 0;
  const storage = createStorageClient({ getUser: () => active, fetch: async () => { count += 1; return ok(); } });
  const saving = uploadBytes(ref(storage, 'families/old/documents/one/file'), new Blob(['fixture']));
  active = user('next'); token.resolve('old-token');
  await assert.rejects(saving, /account changed/);
  assert.equal(count, 0, 'an old upload cannot use a newly active account');
}
{
  const storage = createStorageClient({ getUser: () => user('child'), fetch: async () => new Response('{}', { status: 403 }) });
  await assert.rejects(uploadBytes(ref(storage, 'families/a/documents/one/file'), new Blob(['fixture'])), (error: { code?: string }) => error.code === 'storage/unauthorized');
}
{
  await assert.rejects(fetchFileBlob('/api/files/content?path=families%2Fa%2Fscan', async () => new Response('{"error":"denied"}', { status: 403 })), /no longer have permission/,
    'an error response cannot be copied into a new document as image bytes');
}
console.log('storageClient.test.ts: authenticated mutations, size limits, account changes, serialized cookie renewal and logout failures passed');
