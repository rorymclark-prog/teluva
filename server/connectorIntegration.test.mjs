import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectorIntegration } from './connectorIntegration.mjs';
import { importDocumentVersion } from './importInbox.mjs';

function fixture() {
  const records = new Map([
    ['users/owner', { email: 'forged-profile@example.invalid', aiConsent: { granted: true, version: 1 } }],
    ['families/family/roles/owner', { role: 'admin' }], ['families/family/info/info', { name: 'Example family' }],
    ['families/family/reference/documents', { docs: [
      { id: 'receipt', name: 'TV receipt', category: 'Financial', storagePath: 'families/family/documents/receipt/original.pdf', fileType: 'application/pdf', contentHash: 'original-hash' },
      { id: 'private', name: 'Private record', storagePath: 'families/family/documents/private/record.txt', fileType: 'text/plain' },
      { id: 'foreign', name: 'Wrong space', storagePath: 'families/other/documents/foreign/record.txt' },
    ] }],
  ]);
  const reads = [], calls = [], policies = [], usage = [], drafts = [];
  const snapshot = path => ({ exists: records.has(path), data: () => records.get(path) });
  const db = { doc: path => ({ path, get: async () => { reads.push(path); return snapshot(path); } }),
    collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: drafts.map(value => ({ data: () => value })) }) }) }) }) };
  const bucket = { name: 'example-bucket', file: name => ({ name, getMetadata: async () => [{ size: 16, generation: '1', contentType: name.endsWith('.txt') ? 'text/plain' : 'application/pdf' }], download: async () => [Buffer.from('Synthetic receipt')] }) };
  const integration = createConnectorIntegration({ db, bucket, getUserIdentity: async uid => ({ uid, email: 'verified@example.invalid', emailVerified: true }),
    getPolicy: async (space, path, metadata, caller) => { policies.push(caller); return { ownerAllowed: !path.includes('/private/') }; },
    generateContent: async body => { calls.push(body); return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ proposal: { kind: 'asset', asset: { name: 'TV', category: 'Electronics' } }, extractedText: 'Synthetic receipt', evidenceQuotes: ['Synthetic receipt'] }) }] } }] }); },
    checkAiUsage: async () => null, recordAiUsage: async space => usage.push(space), aiRateLimited: () => false });
  return { integration, records, reads, calls, policies, usage, db, snapshot, drafts, bucket };
}

test('membership uses current roles and verified identity, with transaction-aware reads', async () => {
  const f = fixture();
  const txReads = [];
  const result = await f.integration.resolveMembership({ uid: 'owner' }, 'family', { transaction: { get: async ref => { txReads.push(ref.path); return f.snapshot(ref.path); } } });
  assert.equal(result.role, 'admin'); assert.equal(result.email, 'verified@example.invalid');
  assert.equal(txReads.length, 3); assert.equal(f.reads.length, 0);
  f.records.delete('families/family/roles/owner');
  assert.equal(await f.integration.resolveMembership({ uid: 'owner', spaceId: 'family' }), null);
});

test('selected document authority follows bytes policy and never trusts another space', async () => {
  const f = fixture();
  assert.equal(await f.integration.canReadDocument({ uid: 'owner', spaceId: 'family', documentId: 'receipt' }), true);
  assert.equal(f.policies[0].email, 'verified@example.invalid', 'profile email cannot impersonate a byte owner');
  assert.equal(await f.integration.canReadDocument({ uid: 'owner' }, 'family', 'private'), false);
  assert.equal(await f.integration.canReadDocument({ uid: 'owner' }, 'family', 'foreign'), false);
  await assert.rejects(f.integration.fetchDocument({ uid: 'owner', spaceId: 'family', documentIds: [] }, 'receipt'), /not selected/);
});

test('AI extraction preserves one selected original and returns a draft without canonical writes', async () => {
  const f = fixture();
  const result = await f.integration.extractDocument({ uid: 'owner' }, 'family', { document: { id: 'receipt' } });
  assert.equal(result.proposal.asset.name, 'TV');
  assert.equal(f.calls.length, 1); assert.deepEqual(f.usage, ['family']);
  const data = f.calls[0].contents[0].parts.find(part => part.inlineData)?.inlineData;
  assert.equal(data.mimeType, 'application/pdf');
  assert.equal(Buffer.from(data.data, 'base64').toString(), 'Synthetic receipt');
  assert.equal(f.records.has('families/family/assets/TV'), false);
});

test('AI opt-out and child role block processing before sending any bytes', async () => {
  for (const kind of ['consent', 'child']) {
    const f = fixture();
    if (kind === 'consent') f.records.set('users/owner', { aiConsent: { granted: false, version: 1 } });
    else f.records.set('families/family/roles/owner', { role: 'child' });
    await assert.rejects(f.integration.extractDocument({ uid: 'owner' }, 'family', { sourceText: 'Receipt' }));
    assert.equal(f.calls.length, 0); assert.equal(f.usage.length, 0);
  }
});

test('MCP search hides selected files whose byte access is unavailable', async () => {
  const f = fixture();
  const result = await f.integration.searchDocuments({ uid: 'owner', spaceId: 'family', documentIds: ['receipt', 'private', 'foreign'] }, '');
  assert.deepEqual(result.results.map(item => item.id), ['receipt']);
  const fetch = await f.integration.fetchDocument({ uid: 'owner', spaceId: 'family', documentIds: ['receipt'] }, 'receipt');
  assert.match(fetch.text, /text has not been prepared/);
  assert.equal(JSON.stringify(fetch).includes('storagePath'), false);
});

test('prepared text is tied to the original version even when legacy hashes are absent', async () => {
  const f = fixture();
  const document = f.records.get('families/family/reference/documents').docs[0];
  delete document.contentHash;
  f.drafts.push({ source: { documentId: document.id, contentHash: null, documentVersion: importDocumentVersion(document) }, analysis: { extractedText: 'Prepared television receipt' }, updatedAt: '2026-11-01' });
  const actor = { uid: 'owner', spaceId: 'family', documentIds: ['receipt'] };
  const prepared = await f.integration.fetchDocument(actor, 'receipt');
  assert.equal(prepared.text, 'Prepared television receipt');
  assert.match(prepared.metadata.textOrigin, /may be incomplete/);
  document.storagePath = 'families/family/documents/receipt/replacement.pdf';
  const replaced = await f.integration.fetchDocument(actor, 'receipt');
  assert.equal(replaced.metadata.textPrepared, false);
  assert.match(replaced.text, /not been prepared/);
});

test('text fetching pins authorized bytes and rechecks access after download', async () => {
  for (const revoke of [false, true]) {
    const f = fixture(), selected = [];
    f.bucket.file = (name, options) => ({ name,
      getMetadata: async () => [{ contentType: 'text/plain', size: 16, generation: 'authorized-generation' }],
      download: async () => { selected.push(options?.generation); if (revoke) f.records.delete('families/family/roles/owner'); return [Buffer.from('Original text')]; },
    });
    const fetch = f.integration.fetchDocument({ uid: 'owner', spaceId: 'family', documentIds: ['receipt'] }, 'receipt');
    if (revoke) await assert.rejects(fetch, /unavailable/);
    else assert.equal((await fetch).text, 'Original text');
    assert.deepEqual(selected, ['authorized-generation']);
  }
});
