// Optional integrated verification; never run against a production database.
// firebase emulators:exec --config firebase.invites.emulator.json --only firestore --project rules-probe "node --test server/connectorFlow.emulator.mjs"
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createConnectorAuth, CONNECTOR_ORIGIN } from './connectorAuth.mjs';
import { CONNECTOR_COLLECTIONS, createFirestoreConnectorStore } from './connectorAuthStore.mjs';
import { createConnectorIntegration } from './connectorIntegration.mjs';
import { createImportInbox, createImportInboxRouter } from './importInbox.mjs';
import { createConnectorMcpRouter } from './connectorMcp.mjs';

const endpoint = /^(127\.0\.0\.1|localhost):(\d{1,5})$/.exec(process.env.FIRESTORE_EMULATOR_HOST || '');
if (!endpoint || Number(endpoint[2]) < 1 || Number(endpoint[2]) > 65535
  || ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'].some(key => process.env[key] && process.env[key] !== 'rules-probe')) {
  throw new Error('Connector flow checks require a loopback Firestore emulator and the synthetic rules-probe project. Production is never allowed.');
}

const runId = randomUUID();
const prefix = `connector-flow-${runId.slice(0, 12)}`;
const syntheticIp = `198.18.${parseInt(runId.slice(0, 2), 16)}.${parseInt(runId.slice(2, 4), 16)}`;
const callback = 'https://claude.ai/api/mcp/auth_callback';
const resource = `${CONNECTOR_ORIGIN}/mcp`;
const verifier = `synthetic-verifier-${runId}-${runId}`;
const challenge = createHash('sha256').update(verifier).digest('base64url');
const quote = 'Synthetic appliance receipt: model SAMPLE, purchase price 250.00 EUR.';
const proposal = { kind: 'asset', asset: { name: 'Synthetic test appliance', category: 'Appliance', model: 'SAMPLE', purchasePrice: '250.00', currency: 'EUR', purchaseDate: '2026-01-10' } };

test('connector OAuth, MCP and review inbox use real Firestore transactions and rules', async t => {
  const adminApp = initializeApp({ projectId: 'rules-probe' }, `connector-flow-${runId}`);
  const db = getFirestore(adminApp);
  const spaces = new Set();
  const uids = new Set();
  const written = new Set();
  const identities = new Map();
  const objects = new Map();
  const byteAcl = new Set();
  let extractionCount = 0;
  let sequence = 0;
  let rpcSequence = 0;
  let server, rules;
  // The rate limiter deliberately reuses fixed keys. Preserve any unrelated
  // synthetic runner's pre-existing counters instead of deleting them.
  const originalLimits = new Map((await db.collection(CONNECTOR_COLLECTIONS.limits).get()).docs.map(row => [row.ref.path, row.data()]));
  const adapter = createFirestoreConnectorStore(db);
  const store = {
    get: adapter.get,
    transaction(callback) {
      return adapter.transaction(transaction => callback({
        get: transaction.get,
        set(collection, id, value) {
          written.add(`${CONNECTOR_COLLECTIONS[collection]}/${id}`);
          transaction.set(collection, id, value);
        },
      }));
    },
  };
  const bucket = { name: 'synthetic-connector-flow-bucket', file(path) {
    return { name: path,
      async getMetadata() {
        const bytes = objects.get(path);
        if (!bytes) throw Object.assign(new Error('synthetic missing object'), { code: 404 });
        return [{ size: String(bytes.length), contentType: 'text/plain', generation: '1' }];
      },
      async download() {
        const bytes = objects.get(path);
        if (!bytes) throw Object.assign(new Error('synthetic missing object'), { code: 404 });
        return [Buffer.from(bytes)];
      },
    };
  } };
  const integration = createConnectorIntegration({ db, bucket,
    getUserIdentity: async uid => identities.get(uid) || null,
    getPolicy: async (spaceId, path, _metadata, caller) => ({ estate: false, ownerAllowed: path.startsWith(`families/${spaceId}/`) && byteAcl.has(`${caller.uid}:${path}`) }),
    generateContent: async body => {
      const source = body.contents.flatMap(content => content.parts).map(part => part.text || '').join('\n');
      assert.ok(source.includes(quote), 'the extractor receives the selected original, not an arbitrary URL');
      extractionCount++;
      return { ok: true, async json() { return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ proposal, extractedText: quote, evidenceQuotes: [quote] }) }] } }] }; } };
    },
    aiRateLimited: () => false, checkAiUsage: async () => null, recordAiUsage: async () => {}, aiReady: true, aiConsentVersion: 1,
  });
  const auth = createConnectorAuth({ db, store, verifyFirebaseToken: async token => {
    if (!token.startsWith('fixture:')) throw new Error('invalid fixture identity');
    const uid = token.slice(8);
    const identity = identities.get(uid);
    if (!identity?.emailVerified || identity.disabled) throw new Error('invalid fixture identity');
    return { uid, email_verified: true };
  }, resolveMembership: integration.resolveMembership, canReadDocument: integration.canReadDocument });
  const inbox = createImportInbox({ db, resolveMembership: integration.resolveMembership, canReadDocument: integration.canReadDocument, extractDocument: integration.extractDocument });
  const app = express();
  app.use(auth.router);
  app.use('/api/import-inbox', createImportInboxRouter({ service: inbox, authenticateFirebase: auth.requireFirebase }));
  // Match server.js wiring: the MCP router supplies the verified connection as
  // actor, never arguments from the model, to both integration callbacks.
  app.use('/mcp', createConnectorMcpRouter({ authenticateConnector: auth.authenticateConnector, inbox, origin: CONNECTOR_ORIGIN,
    searchDocuments: (actor, _spaceId, { query }) => integration.searchDocuments(actor, query),
    fetchDocument: (actor, _spaceId, documentId) => integration.fetchDocument(actor, documentId),
  }));

  async function fixture(label, type = 'family') {
    const base = `${prefix}-${++sequence}-${label}`;
    const spaceId = `${base}-space`, otherId = `${base}-other`;
    const owner = `${base}-owner`, staff = `${base}-staff`, child = `${base}-child`, outsider = `${base}-outsider`;
    spaces.add(spaceId); spaces.add(otherId);
    const documentId = 'selected-original', unselectedId = 'unselected-original';
    const documents = [documentId, unselectedId].map((id, index) => ({ id, name: index ? 'Unselected synthetic secret' : 'Synthetic appliance receipt', category: 'Other',
      storagePath: `families/${spaceId}/documents/${id}/original.txt`, fileType: 'text/plain', fileSize: Buffer.byteLength(quote), contentHash: createHash('sha256').update(`${spaceId}:${id}`).digest('hex') }));
    const batch = db.batch();
    batch.set(db.doc(`families/${spaceId}/info/info`), { type, name: 'Synthetic connector space' });
    batch.set(db.doc(`families/${otherId}/info/info`), { type: 'business', name: 'Unrelated synthetic space' });
    batch.set(db.doc(`families/${spaceId}/reference/documents`), { docs: documents });
    for (const [uid, role] of [[owner, 'admin'], [staff, 'member'], [child, 'child'], [outsider, null]]) {
      uids.add(uid);
      identities.set(uid, { email: `${uid}@example.invalid`, emailVerified: true, disabled: false });
      // A deliberately different account-wide active pointer must not redirect
      // authorization, review, or apply away from the explicit selected space.
      batch.set(db.doc(`users/${uid}`), { familyId: otherId, role: 'member', aiConsent: { granted: true, version: 1 } });
      if (role) batch.set(db.doc(`families/${spaceId}/roles/${uid}`), { role });
    }
    for (const document of documents) {
      objects.set(document.storagePath, Buffer.from(document.id === documentId ? quote : 'Do not disclose the unselected synthetic original.'));
      byteAcl.add(`${owner}:${document.storagePath}`);
    }
    await batch.commit();
    return { spaceId, otherId, owner, staff, child, outsider, documentId, unselectedId, documents,
      assets: () => db.collection(`families/${spaceId}/assets`).get() };
  }
  async function request(path, { method = 'GET', user, token, body, form = false } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, redirect: 'manual', headers: {
      // Distinct run key; clientIp uses the trusted right-hand Cloud Run chain.
      'X-Forwarded-For': `${runId}, ${syntheticIp}, 35.191.0.1`,
      ...(body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }),
      ...(token || user ? { Authorization: `Bearer ${token || `fixture:${user}`}` } : {}),
    }, body: body === undefined ? undefined : form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, data, headers: response.headers };
  }
  async function pending(clientId) {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', resource, scope: 'documents:read inbox:write', code_challenge_method: 'S256', code_challenge: challenge, state: `fixture-${runId}` });
    const response = await request(`/oauth/authorize?${q}`);
    assert.equal(response.status, 302, JSON.stringify(response.data));
    const redirect = new URL(response.headers.get('location'));
    assert.equal(redirect.origin, CONNECTOR_ORIGIN);
    const id = redirect.searchParams.get('connector_authorize');
    assert.ok(id);
    return id;
  }
  async function grant(f, { clientId, user = f.owner, scopes = ['documents:read', 'inbox:write'], documentIds = [f.documentId] } = {}) {
    if (!clientId) {
      const registered = await request('/oauth/register', { method: 'POST', body: { client_name: 'Synthetic emulator client', redirect_uris: [callback], token_endpoint_auth_method: 'none' } });
      assert.equal(registered.status, 201, JSON.stringify(registered.data));
      clientId = registered.data.client_id;
    }
    const id = await pending(clientId);
    const consent = await request(`/api/connectors/authorization/${id}`, { user });
    assert.equal(consent.status, 200);
    assert.deepEqual(consent.data.scopes, ['documents:read', 'inbox:write']);
    const approved = await request(`/api/connectors/authorization/${id}`, { method: 'POST', user, body: { approve: true, spaceId: f.spaceId, scopes, documentIds } });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    const redirect = new URL(approved.data.redirectUrl);
    assert.equal(redirect.origin + redirect.pathname, callback);
    assert.equal(redirect.searchParams.get('iss'), CONNECTOR_ORIGIN);
    assert.equal(redirect.searchParams.get('state'), `fixture-${runId}`);
    return { clientId, code: redirect.searchParams.get('code') };
  }
  const exchange = input => request('/oauth/token', { method: 'POST', form: true, body: { client_id: input.clientId, grant_type: 'authorization_code', code: input.code, redirect_uri: callback, resource, code_verifier: verifier } });
  const refresh = (clientId, token) => request('/oauth/token', { method: 'POST', form: true, body: { client_id: clientId, grant_type: 'refresh_token', refresh_token: token, resource } });
  const rpc = (token, method, params) => request('/mcp', { method: 'POST', token, body: { jsonrpc: '2.0', id: ++rpcSequence, method, ...(params ? { params } : {}) } });
  const tool = (token, name, args = {}) => rpc(token, 'tools/call', { name, arguments: args });
  const result = response => { assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.data.result?.isError, false, JSON.stringify(response.data)); return response.data.result.structuredContent; };
  const reviewPath = (f, id, action = '') => `/api/import-inbox/${id}${action ? `/${action}` : ''}?spaceId=${f.spaceId}`;

  try {
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.once('error', reject);
    });
    let rulesFixture;
    await t.test('DCR through MCP analysis stays a draft until explicit admin review and idempotent apply', async () => {
      const f = await fixture('happy');
      rulesFixture = f;
      const connection = await grant(f);
      const tokens = await exchange(connection);
      assert.equal(tokens.status, 200, JSON.stringify(tokens.data));
      const token = tokens.data.access_token;
      const initialized = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic probe', version: '1' } });
      assert.equal(initialized.data.result.serverInfo.name, 'teluva-connector');
      const listed = await rpc(token, 'tools/list');
      assert.deepEqual(listed.data.result.tools.map(item => item.name).sort(), ['fetch', 'get_connection', 'search', 'submit_import']);
      const searched = result(await tool(token, 'search', { query: 'appliance' }));
      assert.deepEqual(searched.results.map(item => item.id), [f.documentId]);
      assert.equal(result(await tool(token, 'fetch', { id: f.documentId })).text, quote);
      assert.equal((await f.assets()).size, 0);
      const before = extractionCount;
      const submitted = result(await tool(token, 'submit_import', { requestId: 'original-analysis', documentId: f.documentId, analyze: true }));
      assert.equal(extractionCount, before + 1);
      assert.equal(submitted.pendingReviewOnly, true);
      assert.equal(submitted.item.status, 'pending');
      assert.equal(submitted.item.analysis.status, 'ready');
      assert.equal(submitted.item.source.hasOriginalDocument, true);
      assert.equal((await f.assets()).size, 0, 'analysis never files an asset');
      const listedInbox = await request(`/api/import-inbox?spaceId=${f.spaceId}`, { user: f.owner });
      assert.equal(listedInbox.status, 200, JSON.stringify(listedInbox.data));
      assert.equal(listedInbox.data.items.length, 1);
      const item = submitted.item;
      const reviewed = await request(reviewPath(f, item.id), { method: 'PATCH', user: f.owner, body: { proposal: { ...proposal, asset: { ...proposal.asset, location: 'Reviewed cupboard' } }, expectedRevision: item.revision } });
      assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
      assert.equal((await f.assets()).size, 0, 'review edits still do not apply');
      const applies = await Promise.all([1, 2].map(() => request(reviewPath(f, item.id, 'apply'), { method: 'POST', user: f.owner, body: { expectedRevision: reviewed.data.item.revision } })));
      for (const applied of applies) assert.equal(applied.status, 200, JSON.stringify(applied.data));
      assert.equal(applies[0].data.item.appliedRecordId, applies[1].data.item.appliedRecordId);
      const retry = await request(reviewPath(f, item.id, 'apply'), { method: 'POST', user: f.owner, body: { expectedRevision: reviewed.data.item.revision } });
      assert.equal(retry.status, 200);
      const assets = await f.assets();
      assert.equal(assets.size, 1);
      assert.equal(assets.docs[0].data().location, 'Reviewed cupboard');
      assert.deepEqual(assets.docs[0].data().documentIds, [f.documentId]);
      assert.equal(assets.docs[0].data().importSource.reviewedBy, f.owner);
      assert.equal(assets.docs[0].data().importSource.hasOriginalDocument, true);
      assert.equal((await db.collection(`families/${f.otherId}/assets`).get()).size, 0);
    });

    await t.test('business scope, selected evidence and child/member review boundaries hold over HTTP', async () => {
      const f = await fixture('business', 'business');
      const registered = await request('/oauth/register', { method: 'POST', body: { redirect_uris: [callback] } });
      const clientId = registered.data.client_id;
      for (const [user, spaceId] of [[f.child, f.spaceId], [f.staff, f.spaceId], [f.owner, f.otherId]]) {
        const id = await pending(clientId);
        const denied = await request(`/api/connectors/authorization/${id}`, { method: 'POST', user, body: { approve: true, spaceId, scopes: ['documents:read'], documentIds: [f.documentId] } });
        assert.equal(denied.status, 403, JSON.stringify(denied.data));
      }
      const connection = await grant(f, { clientId, user: f.staff, scopes: ['inbox:write'], documentIds: [] });
      const tokens = (await exchange(connection)).data;
      const listed = await rpc(tokens.access_token, 'tools/list');
      assert.deepEqual(listed.data.result.tools.map(item => item.name).sort(), ['get_connection', 'submit_import']);
      assert.equal((await tool(tokens.access_token, 'fetch', { id: f.documentId })).data.result.isError, true);
      const submitted = result(await tool(tokens.access_token, 'submit_import', { requestId: 'staff-text', sourceName: 'Explicitly pasted synthetic text', sourceText: quote, proposal, analyze: false }));
      assert.equal(submitted.item.source.hasOriginalDocument, false);
      assert.equal((await request(reviewPath(f, submitted.item.id, 'apply'), { method: 'POST', user: f.staff, body: {} })).status, 403);
      assert.equal((await request(reviewPath(f, submitted.item.id, 'apply'), { method: 'POST', user: f.child, body: {} })).status, 403);
      assert.equal((await request(`/api/import-inbox?spaceId=${f.spaceId}`, { user: f.child })).status, 403);
      assert.equal((await request(`/api/import-inbox?spaceId=${f.otherId}`, { user: f.owner })).status, 403);
      const mismatched = await request(`/api/import-inbox?spaceId=${f.spaceId}`, { method: 'POST', user: f.owner, body: { spaceId: f.otherId, requestId: 'wrong-space', sourceName: 'Synthetic', sourceText: quote, proposal } });
      assert.equal(mismatched.status, 400);
      const admin = (await exchange(await grant(f, { clientId }))).data.access_token;
      assert.equal((await tool(admin, 'fetch', { id: f.unselectedId })).data.result.isError, true);
      assert.equal((await tool(admin, 'search', { query: 'receipt', spaceId: f.otherId })).data.result.isError, true);
      assert.equal((await f.assets()).size, 0);
      assert.equal((await db.collection(`families/${f.otherId}/assets`).get()).size, 0);
    });

    await t.test('withdrawn byte access and removed current Vault sources cannot leak through MCP', async () => {
      const f = await fixture('source');
      const token = (await exchange(await grant(f))).data.access_token;
      assert.equal(result(await tool(token, 'fetch', { id: f.documentId })).text, quote);
      const path = f.documents[0].storagePath;
      byteAcl.delete(`${f.owner}:${path}`);
      assert.deepEqual(result(await tool(token, 'search', { query: 'receipt' })).results, []);
      assert.equal((await tool(token, 'fetch', { id: f.documentId })).data.result.isError, true);
      byteAcl.add(`${f.owner}:${path}`);
      await db.doc(`families/${f.spaceId}/reference/documents`).set({ docs: [f.documents[1]] });
      assert.deepEqual(result(await tool(token, 'search', { query: 'receipt' })).results, []);
      const fetched = await tool(token, 'fetch', { id: f.documentId });
      assert.equal(fetched.data.result.isError, true);
      assert.equal(JSON.stringify(fetched.data).includes(quote), false);
      const before = extractionCount;
      assert.equal((await tool(token, 'submit_import', { requestId: 'removed-source', documentId: f.documentId, analyze: true })).data.result.isError, true);
      assert.equal(extractionCount, before);
      assert.equal((await db.collection(`families/${f.spaceId}/importInbox`).get()).size, 0);
    });

    await t.test('real transactions prevent code replay, rotate refresh, revoke and pin role updateTime across rejoin', async () => {
      const f = await fixture('tokens');
      const connection = await grant(f);
      const exchanges = await Promise.all([exchange(connection), exchange(connection)]);
      assert.deepEqual(exchanges.map(response => response.status).sort(), [200, 400]);
      const first = exchanges.find(response => response.status === 200).data;
      const rotated = await refresh(connection.clientId, first.refresh_token);
      assert.equal(rotated.status, 200);
      assert.equal((await rpc(rotated.data.access_token, 'tools/list')).status, 200);
      assert.equal((await refresh(connection.clientId, first.refresh_token)).status, 400);
      assert.equal((await rpc(rotated.data.access_token, 'tools/list')).status, 401);
      assert.equal((await refresh(connection.clientId, rotated.data.refresh_token)).status, 400);
      const revocable = (await exchange(await grant(f, { clientId: connection.clientId }))).data;
      const managed = await request(`/api/connectors?spaceId=${f.spaceId}`, { user: f.owner });
      assert.equal(managed.data.connectors.length, 1);
      assert.equal((await request(`/api/connectors/${managed.data.connectors[0].id}`, { method: 'DELETE', user: f.owner })).status, 200);
      assert.equal((await rpc(revocable.access_token, 'tools/list')).status, 401);
      const rejoin = (await exchange(await grant(f, { clientId: connection.clientId }))).data;
      const role = db.doc(`families/${f.spaceId}/roles/${f.owner}`);
      const before = (await role.get()).updateTime.toMillis();
      await role.delete();
      await role.set({ role: 'admin' });
      assert.notEqual((await role.get()).updateTime.toMillis(), before, 'real authoritative membership version changed');
      assert.equal((await rpc(rejoin.access_token, 'tools/list')).status, 401, 'same role after rejoin cannot resurrect prior consent');
      assert.equal((await refresh(connection.clientId, rejoin.refresh_token)).status, 400);
    });

    await t.test('Firestore rules deny direct connector registry and import inbox access even to the space administrator', async () => {
      rules = await initializeTestEnvironment({ projectId: 'rules-probe', firestore: { host: endpoint[1], port: Number(endpoint[2]), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
      const browser = rules.authenticatedContext(rulesFixture.owner, { email_verified: true }).firestore();
      await assertSucceeds(getDoc(doc(browser, `families/${rulesFixture.spaceId}/reference/documents`)));
      for (const collection of Object.values(CONNECTOR_COLLECTIONS)) {
        const path = [...written].find(value => value.startsWith(`${collection}/`));
        assert.ok(path, `the integrated flow exercised ${collection}`);
        await assertFails(getDoc(doc(browser, path)));
        await assertFails(setDoc(doc(browser, path), { uid: rulesFixture.owner, scopes: ['documents:read', 'inbox:write'] }));
      }
      const rows = await db.collection(`families/${rulesFixture.spaceId}/importInbox`).get();
      assert.equal(rows.size, 1);
      await assertFails(getDoc(doc(browser, rows.docs[0].ref.path)));
      await assertFails(setDoc(doc(browser, rows.docs[0].ref.path), { status: 'applied' }));
      const serverReview = await request(`/api/import-inbox?spaceId=${rulesFixture.spaceId}`, { user: rulesFixture.owner });
      assert.equal(serverReview.status, 200);
      assert.equal(serverReview.data.items.length, 1, 'the authorized server review path remains available');
    });
  } finally {
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    if (rules) await rules.cleanup();
    for (const spaceId of spaces) await db.recursiveDelete(db.doc(`families/${spaceId}`));
    const paths = [...written, ...[...uids].map(uid => `users/${uid}`)];
    for (let offset = 0; offset < paths.length; offset += 400) {
      const batch = db.batch();
      for (const path of paths.slice(offset, offset + 400)) {
        if (originalLimits.has(path)) batch.set(db.doc(path), originalLimits.get(path));
        else batch.delete(db.doc(path));
      }
      await batch.commit();
    }
    await db.terminate();
    await deleteApp(adminApp);
  }
});
