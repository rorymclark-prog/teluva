// Synthetic-only MCP original intake -> HTTP batch preparation -> explicit review.
// firebase emulators:exec --config firebase.invites.emulator.json --only firestore --project rules-probe "node --import tsx --test server/importPreparation.emulator.mjs"
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createConnectorOriginals } from './connectorOriginals.mjs';
import { createConnectorMcpRouter } from './connectorMcp.mjs';
import { createImportInbox, createImportInboxRouter } from './importInbox.mjs';
import { createImportInboxClient } from '../src/utils/importInboxClient.ts';
import { prepareImportDrafts } from '../src/utils/importPreparation.ts';
import { createFileOperationScope } from '../src/utils/fileOperationScope.ts';

if (!/^(127\.0\.0\.1|localhost):\d{1,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')
  || ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'].some(key => process.env[key] && process.env[key] !== 'rules-probe')) throw Error('Only the loopback rules-probe Firestore emulator is allowed.');

test('selected originals become categorized pending drafts in family and business, and only explicit admin review files records', async () => {
  const app = initializeApp({ projectId: 'rules-probe' }, `prepare-${randomUUID()}`), db = getFirestore(app);
  const spaces = [], grants = [], objects = new Map(), metadata = new Map(), unusable = new Map();
  let extracts = 0;
  const resolveMembership = async (actor, space, { transaction } = {}) => {
    const ref = db.doc(`families/${space}/roles/${actor.uid}`), snap = transaction ? await transaction.get(ref) : await ref.get();
    return snap.exists ? { role: snap.data().role, aiConsent: true, membershipVersion: 'synthetic-v1' } : null;
  };
  const canReadDocument = async (actor, space, docOrId) => {
    const role = (await resolveMembership(actor, space))?.role;
    const document = typeof docOrId === 'string' ? (await db.doc(`families/${space}/reference/documents`).get()).data()?.docs?.find(doc => doc.id === docOrId) : docOrId;
    return !!document && (role === 'admin' || role === 'member' && document.connectorSource?.importedBy === actor.uid);
  };
  const inbox = createImportInbox({ db, resolveMembership, canReadDocument, extractDocument: async (_actor, _space, source) => {
    extracts++;
    const text = objects.get(source.document.storagePath).toString('utf8');
    assert.match(text, /^SYNTHETIC ONLY/);
    if (unusable.get(source.document.id) === 'schema') return { proposal: { kind: 'asset', asset: { name: 'Unusable synthetic model output', category: 'Unsupported' } } };
    if (unusable.get(source.document.id) === 'size') return { proposal: { kind: 'document', document: { name: 'Synthetic oversized response', category: 'Other' } }, extractedText: 'x'.repeat(40_001) };
    const proposal = text.includes('Laptop')
      ? { kind: 'asset', asset: { name: 'Synthetic laptop', category: 'Electronics', serialNumber: 'FIXTURE-001', purchaseDate: '2026-01-10' } }
      : { kind: 'document', document: { name: 'Synthetic founding minutes', category: 'Legal', docDate: '2026-01-10' } };
    return { proposal, extractedText: text, evidenceQuotes: [text.split('\n')[1]] };
  } });
  const bucket = { file(path) { return {
    async save(bytes, options) { if (objects.has(path)) throw Object.assign(Error('Already saved'), { code: 412 }); objects.set(path, Buffer.from(bytes)); metadata.set(path, options.metadata); },
    async getMetadata() { return [{ ...metadata.get(path), size: String(objects.get(path)?.length) }]; },
  }; } };
  const originals = createConnectorOriginals({ db, bucket, resolveMembership, canReadDocument, inbox, origin: 'https://teluva.test' });
  const http = express();
  http.use('/mcp', createConnectorMcpRouter({ inbox, originals, origin: 'https://teluva.test',
    authenticateConnector: async req => {
      const id = req.get('Authorization')?.replace('Bearer fixture:', '');
      const grant = id && (await db.doc(`connector_grants/${id}`).get()).data();
      if (!grant || grant.revokedAt) throw Error('Invalid synthetic grant');
      return { ...grant, grantId: id };
    },
    recordConnectorUse: async () => {}, searchDocuments: async () => { throw Error('No broad source search'); }, fetchDocument: async () => { throw Error('No unselected document read'); },
  }));
  http.use('/api/import-inbox', createImportInboxRouter({ service: inbox, authenticateFirebase: async req => {
    const uid = req.get('Authorization')?.replace('Bearer fixture:', '');
    if (!['member', 'admin', 'child'].includes(uid)) throw Object.assign(Error('Invalid fixture identity'), { status: 401 });
    return { uid };
  } }));
  const server = await new Promise((resolve, reject) => { const s = http.listen(0, '127.0.0.1', () => resolve(s)); s.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const type of ['family', 'business']) {
      const spaceId = `preparation-${type}-${randomUUID()}`, grantId = `prepare-${randomUUID()}`;
      spaces.push(spaceId); grants.push(grantId);
      await db.doc(`families/${spaceId}`).set({ type });
      for (const [uid, role] of [['member', 'member'], ['admin', 'admin'], ['child', 'child']]) await db.doc(`families/${spaceId}/roles/${uid}`).set({ role });
      await db.doc(`connector_grants/${grantId}`).set({ uid: 'member', spaceId: spaceId, scopes: ['inbox:write'], documentIds: [], expiresAt: Date.now() + 600_000, membershipVersion: 'synthetic-v1' });
      const rpc = async (name, args = {}) => {
        const response = await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: `Bearer fixture:${grantId}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
        assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.result?.isError, false, JSON.stringify(body)); return body.result.structuredContent;
      };
      const connection = await rpc('get_connection');
      assert.deepEqual(connection.scopes, ['inbox:write']); assert.equal(connection.selectedDocumentCount, 0);
      const items = new Map(), entries = [], sources = [];
      for (const name of ['receipt', 'minutes']) {
        const bytes = Buffer.from(`SYNTHETIC ONLY\n${name === 'receipt' ? 'Laptop serial FIXTURE-001 purchased 2026-01-10' : 'Founding minutes dated 2026-01-10'}`);
        const input = { requestId: `source-${name}`, fileName: name + '.txt', mimeType: 'text/plain', contentBase64: bytes.toString('base64'), source: { provider: 'local', label: 'Explicit synthetic fixture ' + name, representation: 'original', sourceId: name } };
        const imported = await rpc('import_original', input), retried = await rpc('import_original', input);
        assert.equal(imported.item.id, retried.item.id); assert.equal(imported.original.sha256, createHash('sha256').update(bytes).digest('hex'));
        assert.equal(imported.item.status, 'pending'); assert.equal(imported.item.proposal, undefined);
        items.set(imported.item.id, imported.item); sources.push({ id: imported.original.documentId, bytes });
        entries.push({ id: name, name: name + '.txt', requestId: input.requestId, inboxItemId: imported.item.id, documentId: imported.original.documentId, status: 'done' });
      }
      let uid = 'member';
      const api = createImportInboxClient({ getUser: () => ({ uid, getIdToken: async () => `fixture:${uid}` }), getSpace: () => spaceId, fetch: (url, options) => fetch(base + url, options) });
      let progress;
      const options = { scope: createFileOperationScope(() => [uid, spaceId]), getItem: id => items.get(id), analyze: async (id, revision) => (await api.act(id, 'analyze', revision)).item, onItem: item => items.set(item.id, item), onProgress: value => { progress = value; } };
      const before = extracts;
      unusable.set(entries[0].documentId, type === 'family' ? 'schema' : 'size');
      assert.equal(await prepareImportDrafts(entries, options), 'completed');
      assert.equal(extracts, before + 2, 'an unusable first response never starves the second original or retries within the run');
      assert.deepEqual(progress.map(item => item.status), ['failed', 'ready']);
      assert.equal(items.get(entries[0].inboxItemId).analysis.errorStatus, type === 'family' ? 422 : 413);
      assert.equal((await db.collection(`families/${spaceId}/assets`).get()).size, 0);
      unusable.delete(entries[0].documentId);
      await prepareImportDrafts(entries, options);
      assert.equal(extracts, before + 3, 'an explicit retry spends only on the failed original');
      assert.ok(progress.every(item => item.status === 'ready'));
      assert.deepEqual([...items.values()].map(item => item.proposal.kind).sort(), ['asset', 'document']);
      assert.ok([...items.values()].every(item => item.status === 'pending' && item.analysis.evidenceQuotes.length === 1));
      assert.equal((await db.collection(`families/${spaceId}/assets`).get()).size, 0, 'preparation never applies a record');
      await prepareImportDrafts(entries, options); assert.equal(extracts, before + 3, 'successful drafts are not analyzed again');
      const first = [...items.values()][0];
      await assert.rejects(api.act(first.id, 'apply', first.revision), error => error.status === 403);
      uid = 'admin';
      for (const item of items.values()) {
        const review = (await api.patch(item.id, item.proposal, item.revision)).item;
        const applied = (await api.act(item.id, 'apply', review.revision)).item;
        assert.equal(applied.status, 'applied'); assert.equal(applied.reviewedBy, 'admin');
      }
      const docs = (await db.doc(`families/${spaceId}/reference/documents`).get()).data().docs;
      assert.equal((await db.collection(`families/${spaceId}/assets`).get()).size, 1);
      assert.ok(docs.some(doc => doc.name === 'Synthetic founding minutes' && doc.category === 'Legal'));
      for (const source of sources) {
        const saved = docs.find(doc => doc.id === source.id); assert.deepEqual(objects.get(saved.storagePath), source.bytes);
        assert.equal(saved.connectorSource.sourceId, saved.fileName.replace('.txt', '')); assert.equal(saved.connectorSource.representation, 'original');
      }
      const grant = (await db.doc(`connector_grants/${grantId}`).get()).data();
      assert.deepEqual(grant.scopes, ['inbox:write']); assert.deepEqual(grant.documentIds, [], 'the workflow never broadens saved-document read permission');
    }
    console.log('Verified four exact originals, per-file schema/size failures without starvation, exact retry call counts, four categorized pending drafts, explicit admin filing and unchanged scoped grants; model and object storage are synthetic adapters.');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const space of spaces) await db.recursiveDelete(db.doc(`families/${space}`));
    for (const grant of grants) await db.doc(`connector_grants/${grant}`).delete();
    await deleteApp(app);
  }
});
