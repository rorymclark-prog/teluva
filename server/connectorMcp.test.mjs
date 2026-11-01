import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import express from 'express';
import { createConnectorMcpRouter, MCP_PROTOCOL_VERSION } from './connectorMcp.mjs';
import { createImportInboxRouter, ImportInboxError } from './importInbox.mjs';

async function fixture() {
  const calls = { auth: 0, search: [], fetch: [], create: [], analyze: [], rest: [] };
  let revoked = false, fetchMode = 'prepared', providerFailure = false;
  const entries = new Map();
  const scopes = token => token === 'write' ? ['inbox:write'] : token === 'read' ? ['documents:read'] : ['documents:read', 'inbox:write'];
  const authenticateConnector = async req => {
    calls.auth++;
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (token === 'limited') throw Object.assign(new Error('private limiter detail'), { status: 429, headers: { 'Retry-After': '60' } });
    if (!['read', 'write', 'both', 'other'].includes(token) || revoked) throw Object.assign(new Error('private token secret'), { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://teluva.test/.well-known/oauth-protected-resource/mcp"' } });
    return { uid: 'verified-adult', spaceId: token === 'other' ? 'other-space' : 'selected-space', grantId: 'verified-grant', scopes: scopes(token), documentIds: ['d1', 'd2'] };
  };
  const inbox = {
    create: async (actor, space, input) => {
      calls.create.push({ actor, space, input });
      if (input.sourceName === 'invalid') throw new ImportInboxError(400, 'INVALID_IMPORT', 'Add the required import details.');
      const key = `${actor.uid}:${space}:${input.requestId}`;
      if (!entries.has(key)) entries.set(key, { id: 'pending-' + entries.size, spaceId: space, source: input.documentId ? { documentId: input.documentId } : { sourceText: input.sourceText, sourceName: input.sourceName, hasOriginalDocument: false },
        createdBy: actor.uid, revision: 1, status: 'pending', analysis: { status: input.proposal ? 'ready' : 'idle' }, ...(input.proposal ? { proposal: input.proposal } : {}) });
      return structuredClone(entries.get(key));
    },
    analyze: async (actor, space, id, options) => {
      calls.analyze.push({ actor, space, id, options });
      const value = [...entries.values()].find(item => item.id === id && item.spaceId === space);
      value.analysis = providerFailure ? { status: 'failed', error: 'Monthly AI allowance reached.' } : { status: 'ready', extractedText: 'Prepared source' };
      if (!providerFailure) value.proposal = { kind: 'asset', asset: { name: 'Draft only', category: 'Electronics' } };
      value.revision++;
      return structuredClone(value);
    },
  };
  const app = express();
  app.use('/mcp', createConnectorMcpRouter({ authenticateConnector, inbox, origin: 'https://teluva.test',
    searchDocuments: async (actor, space, options) => {
      calls.search.push({ actor, space, options });
      if (providerFailure) throw new Error('stack trace https://private.test?token=SECRET');
      return [ { id: 'd1', title: 'Invoice', url: 'https://teluva.test/?spaceId=selected-space&documentId=d1', downloadUrl: 'PRIVATE' },
        { id: 'unselected', title: 'Unselected private HR record', text: 'PRIVATE' },
        { id: 'd2', title: 'Selected policy', url: 'https://foreign.test/private?token=SECRET' } ];
    },
    fetchDocument: async (actor, space, id) => {
      calls.fetch.push({ actor, space, id });
      if (providerFailure) throw new Error('private provider token SECRET');
      return { id: fetchMode === 'wrong-id' ? 'unselected' : id, title: 'Selected invoice', text: fetchMode === 'unprepared' ? 'Use submit_import to prepare this PDF.' : 'AI transcription with invoice amount 250 EUR.',
        downloadUrl: 'SECRET', storagePath: 'PRIVATE', url: 'https://teluva.test/?Token=SECRET',
        metadata: { textPrepared: fetchMode !== 'unprepared', textOrigin: fetchMode === 'unprepared' ? 'not-prepared' : 'AI transcription', category: 'Financial', fileType: 'application/pdf', originalAvailableInTeluva: true, downloadUrl: 'SECRET' } };
    },
  }));
  const restService = Object.fromEntries(['list', 'create', 'update', 'analyze', 'apply', 'dismiss'].map(method => [method, async (...args) => {
    calls.rest.push({ method, args });
    if (args[1] === 'failure') throw new Error('RAW_PRIVATE_STACK');
    if (method === 'list') return [];
    return { id: 'draft', spaceId: args[1], status: 'pending' };
  }]));
  app.use('/api/import-inbox', createImportInboxRouter({ service: restService, authenticateFirebase: async req => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (token === 'limited') throw Object.assign(new Error('private quota key'), { status: 429, headers: { 'Retry-After': '30' } });
    if (token !== 'firebase') throw Object.assign(new Error('RAW_AUTH_DETAIL'), { status: 401 });
    return { uid: 'firebase-adult' };
  } }));
  const server = http.createServer(app);
  server.keepAliveTimeout = 1;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers } });
  const rpc = (method, params = {}, options = {}) => request('/mcp', { method: 'POST', token: 'both', ...options, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...options.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params, ...options.message }) });
  const tool = (name, args, options) => rpc('tools/call', { name, arguments: args }, options);
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return { calls, entries, request, rpc, tool, close, setRevoked: value => { revoked = value; }, setFetchMode: value => { fetchMode = value; }, failProvider: value => { providerFailure = value; } };
}

async function withFixture(run) { const f = await fixture(); try { await run(f); } finally { await f.close(); } }

test('Streamable HTTP initialization, JSON replies, notifications, method errors and auth challenges', () => withFixture(async f => {
  const unauthorized = await f.rpc('initialize', {}, { token: '' });
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate'), /resource_metadata="https:\/\/teluva.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.equal((await unauthorized.text()).includes('private token'), false);
  const initialized = await f.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Synthetic client', version: '1' } });
  const body = await initialized.json();
  assert.equal(body.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(body.result.capabilities.tools.listChanged, false);
  assert.equal(initialized.headers.get('cache-control'), 'private, no-store');
  assert.match(initialized.headers.get('content-type'), /application\/json/);
  assert.equal((await f.rpc('ping').then(response => response.json())).result.constructor, Object);
  const notification = await f.rpc('notifications/initialized', {}, { message: { id: undefined } });
  assert.equal(notification.status, 202); assert.equal(await notification.text(), '');
  const noIdWrite = await f.rpc('tools/call', { name: 'submit_import', arguments: { sourceText: 'Source', sourceName: 'Chatbot', requestId: 'not-a-request' } }, { message: { id: undefined } });
  assert.equal(noIdWrite.status, 400); assert.equal(f.calls.create.length, 0, 'tool notifications cannot secretly write drafts');
  assert.equal((await f.rpc('not/a/method').then(response => response.json())).error.code, -32601);
  assert.equal((await f.tool('apply_import', {}).then(response => response.json())).error.code, -32602, 'there is no canonical apply tool');
  const get = await f.request('/mcp'); assert.equal(get.status, 405); assert.equal(get.headers.get('allow'), 'POST');
  const evilOrigin = await f.rpc('ping', {}, { headers: { Origin: 'https://evil.test' } }); assert.equal(evilOrigin.status, 403);
  const invalidVersion = await f.rpc('ping', {}, { headers: { 'MCP-Protocol-Version': '2999-01-01' } }); assert.equal(invalidVersion.status, 400);
}));

test('tool discovery exposes only consented scopes and truthful read/write annotations', () => withFixture(async f => {
  const read = (await f.rpc('tools/list', {}, { token: 'read' }).then(response => response.json())).result.tools;
  assert.deepEqual(read.map(tool => tool.name), ['search', 'fetch', 'get_connection']);
  assert.ok(read.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint && !tool.annotations.openWorldHint));
  const write = (await f.rpc('tools/list', {}, { token: 'write' }).then(response => response.json())).result.tools;
  assert.deepEqual(write.map(tool => tool.name), ['get_connection', 'submit_import']);
  const submit = write.find(tool => tool.name === 'submit_import');
  assert.equal(submit.annotations.readOnlyHint, false); assert.equal(submit.annotations.destructiveHint, false); assert.equal(submit.annotations.idempotentHint, true);
  assert.equal(submit.inputSchema.additionalProperties, false);
  assert.equal(submit.inputSchema.properties.proposal.oneOf.length, 2, 'hosts discover the actual fixed asset/document proposal schema');
  const connection = (await f.tool('get_connection', {}, { token: 'read' }).then(response => response.json())).result.structuredContent;
  assert.deepEqual(connection, { spaceId: 'selected-space', scopes: ['documents:read'], selectedDocumentCount: 2, pendingReviewOnly: true });
  assert.equal(JSON.stringify(connection).includes('verified-adult'), false, 'connection inspection is bounded to the selected space');
}));

test('search and fetch enforce the bound selected documents even if an integration callback overreturns', () => withFixture(async f => {
  const search = (await f.tool('search', { query: 'invoice' }).then(response => response.json())).result.structuredContent;
  assert.deepEqual(search.results.map(row => row.id), ['d1', 'd2']);
  assert.equal(JSON.stringify(search).includes('Unselected private'), false);
  assert.equal(JSON.stringify(search).includes('foreign.test'), false);
  assert.equal(JSON.stringify(search).includes('SECRET'), false);
  assert.equal(f.calls.search[0].space, 'selected-space');
  assert.deepEqual(f.calls.search[0].actor.documentIds, ['d1', 'd2']);
  assert.equal(f.calls.search[0].actor.grantId, 'verified-grant');
  assert.deepEqual(f.calls.search[0].options.documentIds, ['d1', 'd2']);
  const fetched = (await f.tool('fetch', { id: 'd1' }).then(response => response.json())).result.structuredContent;
  assert.equal(fetched.id, 'd1');
  assert.equal(fetched.metadata.textPrepared, true);
  assert.equal(fetched.metadata.textOrigin, 'AI transcription');
  assert.match(fetched.metadata.note, /may be incomplete.*original/i);
  assert.equal(fetched.metadata.category, 'Financial');
  assert.equal(fetched.metadata.originalAvailableInTeluva, true);
  assert.equal(JSON.stringify(fetched).includes('SECRET'), false);
  assert.equal(JSON.stringify(fetched).includes('storagePath'), false);
  assert.deepEqual(f.calls.fetch[0].actor.documentIds, ['d1', 'd2']);
  const before = f.calls.fetch.length;
  const denied = (await f.tool('fetch', { id: 'unselected' }).then(response => response.json())).result;
  assert.equal(denied.isError, true); assert.equal(f.calls.fetch.length, before);
  f.setFetchMode('unprepared');
  const unprepared = (await f.tool('fetch', { id: 'd1' }).then(response => response.json())).result.structuredContent;
  assert.equal(unprepared.metadata.textPrepared, false, 'fallback instructions do not masquerade as prepared original text');
  assert.match(unprepared.metadata.note, /submit_import/);
  f.setFetchMode('wrong-id');
  assert.equal((await f.tool('fetch', { id: 'd1' }).then(response => response.json())).result.isError, true);
}));

test('space/scope overrides are rejected before callbacks and every request reauthenticates', () => withFixture(async f => {
  for (const [name, args] of [['search', { query: 'x', spaceId: 'other-space' }], ['fetch', { id: 'd1', spaceId: 'other-space' }], ['get_connection', { spaceId: 'other-space' }], ['submit_import', { requestId: 'x', sourceText: 'notes', sourceName: 'Chatbot', spaceId: 'other-space' }]]) {
    assert.equal((await f.tool(name, args).then(response => response.json())).result.isError, true);
  }
  assert.equal(f.calls.search.length + f.calls.fetch.length + f.calls.create.length, 0);
  const paramOverride = await f.rpc('tools/call', { name: 'fetch', arguments: { id: 'd1' }, spaceId: 'other-space' }).then(response => response.json());
  assert.equal(paramOverride.error.code, -32602);
  const writeOnlyRead = await f.tool('fetch', { id: 'd1' }, { token: 'write' }).then(response => response.json());
  assert.equal(writeOnlyRead.result.isError, true); assert.match(JSON.stringify(writeOnlyRead), /INSUFFICIENT_SCOPE/);
  await f.rpc('initialize'); f.setRevoked(true);
  const revoked = await f.tool('fetch', { id: 'd1' }); assert.equal(revoked.status, 401); assert.equal(f.calls.fetch.length, 0);
}));

test('submit_import writes pending drafts only, auto-analyzes selected originals, and retries do not create or analyze twice', () => withFixture(async f => {
  const input = { requestId: 'stable-submit', documentId: 'd1' };
  const first = (await f.tool('submit_import', input).then(response => response.json())).result.structuredContent;
  assert.equal(first.pendingReviewOnly, true);
  assert.equal(first.item.status, 'pending'); assert.equal(first.item.analysis.status, 'ready');
  assert.match(first.message, /No asset or vault metadata was applied/);
  assert.equal(f.calls.analyze.length, 1);
  const again = (await f.tool('submit_import', input).then(response => response.json())).result.structuredContent;
  assert.equal(again.item.id, first.item.id); assert.equal(f.entries.size, 1); assert.equal(f.calls.analyze.length, 1);
  const before = f.calls.create.length;
  assert.equal((await f.tool('submit_import', { ...input, requestId: 'unselected', documentId: 'secret' }).then(response => response.json())).result.isError, true);
  assert.equal((await f.tool('submit_import', { ...input, requestId: 'write-only' }, { token: 'write' }).then(response => response.json())).result.isError, true);
  assert.equal(f.calls.create.length, before, 'document-backed imports need both read and inbox-write consent before any draft write');
  const text = (await f.tool('submit_import', { requestId: 'text-only', sourceText: 'Extracted notes', sourceName: 'External chatbot', proposal: { kind: 'asset', asset: { name: 'Typed draft', category: 'Other' } } }, { token: 'write' }).then(response => response.json())).result.structuredContent;
  assert.equal(text.item.source.hasOriginalDocument, false);
  assert.equal(f.calls.analyze.length, 1, 'submitted proposals do not trigger model work implicitly');
  f.failProvider(true);
  const failed = (await f.tool('submit_import', { requestId: 'analysis-failed', documentId: 'd2' }).then(response => response.json())).result;
  assert.equal(failed.isError, false);
  assert.equal(failed.structuredContent.item.analysis.status, 'failed');
  assert.equal(failed.structuredContent.item.status, 'pending');
  assert.match(failed.structuredContent.item.analysis.error, /allowance/);
}));

test('protocol/body/rate-limit failures are bounded and provider errors do not disclose credentials', () => withFixture(async f => {
  const invalidJson = await f.request('/mcp', { method: 'POST', token: 'both', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(invalidJson.status, 400); assert.equal((await invalidJson.json()).error.code, -32700);
  const batch = await f.request('/mcp', { method: 'POST', token: 'both', headers: { 'Content-Type': 'application/json' }, body: '[]' }); assert.equal(batch.status, 400);
  const oversized = await f.rpc('ping', { payload: 'x'.repeat(180_000) }); assert.equal(oversized.status, 413);
  const limited = await f.rpc('ping', {}, { token: 'limited' }); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60'); assert.equal(limited.headers.get('www-authenticate'), null);
  const safe = await limited.text(); assert.equal(safe.includes('private limiter'), false);
  f.failProvider(true);
  const failure = await f.tool('search', { query: 'x' }).then(response => response.json());
  assert.equal(failure.result.isError, true); assert.equal(JSON.stringify(failure).includes('SECRET'), false); assert.equal(JSON.stringify(failure).includes('private.test'), false);
}));

test('REST review routes bind Firebase actor and explicit space, echo scope, preserve limits and sanitize errors', () => withFixture(async f => {
  const headers = { 'Content-Type': 'application/json' };
  const listed = await f.request('/api/import-inbox?spaceId=selected-space', { token: 'firebase' });
  assert.deepEqual(await listed.json(), { spaceId: 'selected-space', items: [] });
  const routes = [ ['POST', '/api/import-inbox', { requestId: 'x', sourceText: 'Source', sourceName: 'Named source' }], ['PATCH', '/api/import-inbox/draft', { proposal: {} }],
    ...['analyze', 'apply', 'dismiss'].map(action => ['POST', `/api/import-inbox/draft/${action}`, { expectedRevision: 2 }]) ];
  for (const [method, path, body] of routes) {
    const response = await f.request(path + '?spaceId=selected-space', { method, token: 'firebase', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200); assert.equal((await response.json()).spaceId, 'selected-space');
  }
  assert.ok(f.calls.rest.every(call => call.args[0].uid === 'firebase-adult' && call.args[1] === 'selected-space'));
  const count = f.calls.rest.length;
  const mismatch = await f.request('/api/import-inbox?spaceId=selected-space', { method: 'POST', token: 'firebase', headers, body: JSON.stringify({ spaceId: 'other-space' }) });
  assert.equal(mismatch.status, 400); assert.equal(f.calls.rest.length, count);
  const unauthorized = await f.request('/api/import-inbox?spaceId=selected-space'); assert.equal(unauthorized.status, 401); assert.equal((await unauthorized.text()).includes('RAW_AUTH'), false);
  const rate = await f.request('/api/import-inbox?spaceId=selected-space', { token: 'limited' }); assert.equal(rate.status, 429); assert.equal(rate.headers.get('retry-after'), '30');
  const provider = await f.request('/api/import-inbox?spaceId=failure', { token: 'firebase' }); assert.equal(provider.status, 500); assert.equal((await provider.text()).includes('RAW_PRIVATE_STACK'), false);
}));
