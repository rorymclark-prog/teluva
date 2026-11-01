import assert from 'node:assert/strict';
import { createImportInboxClient, importStatusLabel, importErrorMessage, InboxRequestError, validatedConnectorRedirect, processImportBatch, type ImportInboxItem, type ImportBatchEntry } from './importInboxClient';
import { createFileOperationScope } from './fileOperationScope';

const item: ImportInboxItem = { id: 'draft-one', spaceId: 'space-A', createdBy: 'user-one', status: 'pending', source: { sourceName: 'Synthetic receipt' }, analysis: { status: 'idle' }, revision: 1, createdAt: '', updatedAt: '' };
let uid = 'user-one', space = 'space-A', generation = 1;
let tokenHook = async () => 'synthetic-token';
const calls: { url: string; init: RequestInit }[] = [];
let fetchHook = async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ spaceId: space, item, items: [item], connectors: [] }), { status: 200 });
const api = createImportInboxClient({ getUser: () => uid ? { uid, getIdToken: () => tokenHook() } : null, getSpace: () => space, getGeneration: () => generation, fetch: (async (url, init) => { calls.push({ url: String(url), init: init! }); return fetchHook(String(url), init!); }) as typeof fetch });
await api.list();
assert.equal(calls.at(-1)!.url, '/api/import-inbox?spaceId=space-A');
assert.equal(calls.at(-1)!.init.headers!['Authorization'], 'Bearer synthetic-token');
assert.equal(calls.at(-1)!.init.cache, 'no-store');
await api.create({ sourceText: 'Synthetic source', sourceName: 'Receipt email', requestId: 'request-one' });
assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { sourceText: 'Synthetic source', sourceName: 'Receipt email', requestId: 'request-one' });
await api.patch('draft/one', { kind: 'asset', asset: { name: 'Television', category: 'Electronics' } }, 7);
assert.equal(calls.at(-1)!.url, '/api/import-inbox/draft%2Fone?spaceId=space-A');
assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).expectedRevision, 7);
await api.act('draft-one', 'apply', 8);
assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).expectedRevision, 8);
assert.equal(calls.at(-1)!.init.method, 'POST');
const count = calls.length;
tokenHook = async () => { space = 'space-B'; return 'synthetic-token'; };
await assert.rejects(api.list(), /account, space or panel changed/);
assert.equal(calls.length, count, 'space change during token refresh must prevent any request');
space = 'space-A'; tokenHook = async () => 'synthetic-token';
fetchHook = async () => { uid = 'user-two'; return new Response(JSON.stringify({ spaceId: 'space-A', items: [item] })); };
await assert.rejects(api.list(), /account, space or panel changed/, 'a late response cannot enter another account');
uid = 'user-one';
fetchHook = async () => ({ ok: true, json: async () => { generation++; return { spaceId: 'space-A', items: [item] }; } }) as Response;
await assert.rejects(api.list(), /account, space or panel changed/, 'JSON parsing is fenced as well as fetch');
fetchHook = async () => new Response(JSON.stringify({ spaceId: 'space-B', items: [] }));
await assert.rejects(api.list(), /space response could not be verified/);
fetchHook = async () => new Response(JSON.stringify({ error: 'The source changed', code: 'SOURCE_CHANGED' }), { status: 409 });
await assert.rejects(api.act('draft-one', 'apply', 3), error => error instanceof InboxRequestError && error.code === 'SOURCE_CHANGED' && importErrorMessage(error).includes('Analyze it again'));
fetchHook = async () => new Response(JSON.stringify({ error: 'Duplicate', code: 'DUPLICATE_ASSET', details: { candidates: [{ id: 'existing', name: 'Existing television' }] } }), { status: 409 });
await assert.rejects(api.act('draft-one', 'apply', 3), error => error instanceof InboxRequestError && error.details?.candidates?.[0].name === 'Existing television');
fetchHook = async () => new Response('Unexpected gateway response', { status: 502 });
await assert.rejects(api.list(), /could not be completed/);

for (const url of ['https://chatgpt.com/connector_platform_oauth_redirect?code=synthetic&state=example', 'https://chatgpt.com/connector/oauth/fixture_1?error=access_denied', 'https://claude.ai/api/mcp/auth_callback?code=synthetic', 'http://127.0.0.1:9876/callback?state=synthetic', 'http://localhost:9876/callback', 'http://[::1]:9876/callback']) assert.equal(validatedConnectorRedirect(url), url);
for (const url of ['javascript:alert(1)', '/callback', 'https://chatgpt.com.evil.test/connector_platform_oauth_redirect', 'https://chatgpt.com/other', 'https://claude.ai/api/mcp/auth_callback/extra', 'https://user:pass@claude.ai/api/mcp/auth_callback', 'https://claude.ai:444/api/mcp/auth_callback', 'http://localhost/callback', 'http://localhost.evil.test:9876/callback', 'https://chatgpt.com/connector/oauth/valid#fragment']) assert.throws(() => validatedConnectorRedirect(url));
assert.throws(() => validatedConnectorRedirect('https://claude.ai/api/mcp/auth_callback', 'chatgpt.com'), /could not be verified/);
assert.equal(importStatusLabel({ ...item, proposal: { kind: 'asset', asset: { name: 'TV' } }, analysis: { status: 'failed' } }), 'Needs attention');
assert.equal(importStatusLabel({ ...item, status: 'applied', analysis: { status: 'running' } }), 'Added');

const file = new File(['synthetic receipt'], 'receipt.txt', { type: 'text/plain' });
const entries: ImportBatchEntry[] = ['one', 'two'].map(id => ({ id, name: id, file, requestId: `request-${id}`, status: 'queued' }));
const results = new Map(entries.map(entry => [entry.id, entry]));
let identity = 'space-A', uploads = 0, creates = 0, failFirstCreate = true;
const applied: ImportInboxItem[] = [];
const batchOptions = {
  scope: createFileOperationScope(() => [identity]),
  upload: async () => `original-${++uploads}`,
  create: async ({ documentId, requestId }: { documentId: string; requestId: string }) => { creates++; if (requestId === 'request-one' && failFirstCreate) { failFirstCreate = false; throw new Error('Synthetic temporary failure'); } return { ...item, id: requestId, source: { documentId } }; },
  onEntry: (entry: ImportBatchEntry) => { results.set(entry.id, entry); }, onItem: (value: ImportInboxItem) => { applied.push(value); },
};
await processImportBatch(entries, batchOptions);
assert.equal(uploads, 2); assert.equal(creates, 2); assert.equal(results.get('one')!.status, 'error'); assert.equal(results.get('one')!.documentId, 'original-1'); assert.equal(results.get('two')!.status, 'done');
await processImportBatch([...results.values()], batchOptions);
assert.equal(uploads, 2, 'retry retains the saved original rather than uploading bytes twice');
assert.equal(creates, 3, 'successful imports are not queued again');
assert.equal(applied.length, 2);
assert.equal(results.get('one')!.requestId, 'request-one', 'retry keeps the same idempotency key');
await assert.rejects(processImportBatch(Array.from({ length: 21 }, () => entries[0]), batchOptions), /up to 20/);
let cancelledCreates = 0;
await assert.rejects(processImportBatch([entries[0]], { ...batchOptions, scope: createFileOperationScope(() => [identity]), upload: async () => { identity = 'space-B'; return 'saved-original'; }, create: async () => { cancelledCreates++; return item; } }), /account, space or upload panel changed/);
assert.equal(cancelledCreates, 0, 'scope change after upload never queues a document into the next space');
console.log('importInboxClient.test.ts: scoped requests, revision conflicts, OAuth callbacks and partial batch retries pass');
