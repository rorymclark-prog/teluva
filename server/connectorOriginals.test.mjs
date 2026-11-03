import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createConnectorOriginals, authorizedHostFileUrl, publicFileAddress, downloadHostFile } from './connectorOriginals.mjs';

function fixture() {
  const records = new Map([['connector_grants/grant', { uid: 'owner', spaceId: 'family', scopes: ['inbox:write'], expiresAt: Date.now() + 600000, membershipVersion: 'v1' }],
    ['families/family/roles/owner', { role: 'admin' }]]), objects = new Map(), drafts = new Map();
  const snapshot = path => ({ exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const db = { doc: path => ({ path, get: async () => snapshot(path) }), runTransaction: async callback => {
    const writes = []; const result = await callback({ get: async ref => { assert.equal(writes.length, 0); return snapshot(ref.path); }, set: (ref, data) => writes.push([ref.path, structuredClone(data)]) });
    writes.forEach(([path, data]) => records.set(path, data)); return result;
  } };
  let downloads = 0, saves = 0, onDownload = () => {}, onSave = () => {};
  const bucket = { file: path => ({ save: async (bytes, options) => {
    saves++; if (objects.has(path)) throw Object.assign(new Error('existing'), { code: 412 });
    objects.set(path, { bytes: Buffer.from(bytes), metadata: options.metadata }); onSave();
  }, getMetadata: async () => [{ ...objects.get(path).metadata, size: String(objects.get(path).bytes.length) }] }) };
  const actor = { uid: 'owner', spaceId: 'family', grantId: 'grant', scopes: ['inbox:write'], documentIds: [] };
  const service = createConnectorOriginals({ db, bucket, origin: 'https://teluva.test',
    resolveMembership: async (actor, space, { transaction } = {}) => { const ref = db.doc(`families/${space}/roles/${actor.uid}`), snap = transaction ? await transaction.get(ref) : await ref.get(); return snap.exists ? { role: snap.data().role, membershipVersion: 'v1' } : null; },
    canReadDocument: async (_actor, space, id) => !!records.get(`families/${space}/reference/documents`)?.docs.some(doc => doc.id === id),
    download: async () => { downloads++; await onDownload(); return { bytes: Buffer.from('%PDF-1.7\nSynthetic attachment'), mimeType: 'application/pdf' }; },
    inbox: { create: async (actor, space, input) => {
      const previous = drafts.get(input.requestId); if (previous) { assert.deepEqual(previous.input, input); return previous.item; }
      const item = { id: `draft-${drafts.size}`, status: 'pending', createdBy: actor.uid, spaceId: space, source: { documentId: input.documentId }, proposal: input.proposal };
      drafts.set(input.requestId, { input, item }); return item;
    } },
  });
  const input = { requestId: 'attachment-one', file: { file_id: 'file-original', file_name: 'receipt.pdf', mime_type: 'application/pdf', download_url: 'https://files.oaiusercontent.com/file-original?sig=PRIVATE' },
    source: { provider: 'gmail', sourceId: 'message-one', label: 'Selected receipt attachment', url: 'https://mail.google.com/mail/u/0/#all/message-one', representation: 'original' },
    proposal: { kind: 'document', document: { name: 'Receipt', category: 'Financial' } } };
  return { service, actor, input, records, objects, drafts, counts: () => ({ saves, downloads }), onDownload: fn => { onDownload = fn; }, onSave: fn => { onSave = fn; } };
}

test('original bytes, protected metadata and checksum survive ingestion; retry and byte dedup preserve one draft', async () => {
  const f = fixture();
  const first = await f.service.importOriginal(f.actor, f.input);
  const retry = await f.service.importOriginal(f.actor, { ...f.input, file: { ...f.input.file, download_url: 'https://files.oaiusercontent.com/file-original?sig=REFRESHED' } });
  const duplicate = await f.service.importOriginal(f.actor, { ...f.input, requestId: 'different-request' });
  assert.equal(first.item.id, retry.item.id); assert.equal(first.item.id, duplicate.item.id);
  assert.equal(f.drafts.size, 1); assert.equal(f.objects.size, 1);
  assert.equal(f.counts().downloads, 2, 'same-key retries do not need the expired host link again');
  const object = [...f.objects.values()][0];
  assert.equal(first.original.sha256, createHash('sha256').update(object.bytes).digest('hex'));
  assert.equal(object.metadata.metadata.teluvaOwnerUid, 'owner');
  assert.equal(object.metadata.metadata.teluvaScope, undefined, 'business originals are not silently shared');
  assert.equal(JSON.stringify([...f.records.values()]).includes('sig=PRIVATE'), false);
  assert.equal(first.pendingReviewOnly, true);
  assert.equal([...f.records.keys()].some(path => path.includes('/assets/')), false);
});

test('membership, pinned space and revocation are rechecked across download and storage writes', async () => {
  for (const phase of ['before', 'download', 'save', 'child', 'space']) {
    const f = fixture(), revoke = () => { f.records.get('connector_grants/grant').revokedAt = Date.now(); };
    if (phase === 'before') revoke();
    if (phase === 'download') f.onDownload(revoke);
    if (phase === 'save') f.onSave(revoke);
    if (phase === 'child') f.records.set('families/family/roles/owner', { role: 'child' });
    if (phase === 'space') f.actor.spaceId = 'other';
    await assert.rejects(f.service.importOriginal(f.actor, f.input), error => error.status === 403);
    assert.equal(f.drafts.size, 0); assert.equal(f.records.has('families/family/reference/documents'), false);
  }
});

test('conflicting request IDs, checksums, unsupported bytes and fabricated preference originals fail closed', async () => {
  const f = fixture(); await f.service.importOriginal(f.actor, f.input);
  await assert.rejects(f.service.importOriginal(f.actor, { ...f.input, source: { ...f.input.source, sourceId: 'other' } }), /different original/);
  await assert.rejects(f.service.importOriginal(f.actor, { ...f.input, requestId: 'bad-hash', sha256: '0'.repeat(64) }), error => error.code === 'ORIGINAL_HASH_MISMATCH');
  for (const patch of [{ contentBase64: 'not base64!' }, { contentBase64: Buffer.from('<svg>bad</svg>').toString('base64'), mimeType: 'image/svg+xml' },
    { contentBase64: Buffer.from('Not PDF bytes').toString('base64'), mimeType: 'application/pdf' }, { contentBase64: Buffer.alloc(97000).toString('base64'), mimeType: 'text/plain' }]) {
    await assert.rejects(f.service.importOriginal(f.actor, { ...f.input, file: undefined, requestId: 'bad-file', fileName: 'bad.txt', ...patch }));
  }
  await assert.rejects(f.service.importOriginal(f.actor, { ...f.input, proposal: { kind: 'preferences', preferences: { theme: 'dark' } } }), /explicit named text/);
});

test('exact inline attachments work without a host download; exports keep their representation and source', async () => {
  const f = fixture();
  const value = await f.service.importOriginal(f.actor, { requestId: 'inline', fileName: 'export.txt', mimeType: 'text/plain', contentBase64: Buffer.from('Selected native document export').toString('base64'),
    source: { provider: 'drive', label: 'Selected Google document', representation: 'export', url: 'https://docs.google.com/document/d/synthetic/edit?usp=sharing' } });
  assert.equal(value.original.source.representation, 'export'); assert.equal(value.original.source.url, 'https://docs.google.com/document/d/synthetic/edit');
  assert.equal(f.counts().downloads, 0);
});

test('a reissued host file ID can retry the same source only when the original bytes still match', async () => {
  const f = fixture();
  const first = await f.service.importOriginal(f.actor, f.input);
  const refreshed = await f.service.importOriginal(f.actor, { ...f.input, file: { ...f.input.file, file_id: 'file-reissued-reference' } });
  assert.equal(refreshed.item.id, first.item.id); assert.equal(f.objects.size, 1); assert.equal(f.drafts.size, 1);
  assert.equal(f.counts().downloads, 2);
});

test('bounded concurrent originals protect memory and release capacity after completion', async () => {
  const f = fixture(); let release;
  const gate = new Promise(done => { release = done; }); f.onDownload(() => gate);
  const jobs = [1, 2, 3].map(index => f.service.importOriginal(f.actor, { ...f.input, requestId: `parallel-${index}` }));
  await new Promise(done => setImmediate(done));
  assert.equal(f.counts().downloads, 3);
  await assert.rejects(f.service.importOriginal(f.actor, { ...f.input, requestId: 'fourth' }), error => error.status === 429 && error.code === 'ORIGINAL_IMPORT_BUSY');
  release(); await Promise.all(jobs);
  assert.equal((await f.service.importOriginal(f.actor, { ...f.input, requestId: 'parallel-1' })).pendingReviewOnly, true);
});

test('host downloads reject arbitrary URLs, private DNS, oversized bodies and unsafe redirects', async () => {
  for (const url of ['http://files.oaiusercontent.com/file', 'https://files.oaiusercontent.com.evil.test/file', 'https://localhost/file', 'https://files.oaiusercontent.com:444/file', 'https://user:secret@files.oaiusercontent.com/file']) assert.throws(() => authorizedHostFileUrl(url));
  for (const address of ['127.0.0.1', '169.254.169.254', '10.1.2.3', '100.100.1.1', '192.168.1.1', '::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(publicFileAddress(address), false);
  await assert.rejects(downloadHostFile('https://files.oaiusercontent.com/file', { resolve: async () => [{ address: '127.0.0.1', family: 4 }], request: () => { throw Error('must not connect'); } }), /address is unavailable/);
  const resolve = async () => [{ address: '8.8.8.8', family: 4 }];
  const fake = (statusCode, headers, chunks = []) => (_url, options, callback) => {
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.agent, false);
    options.lookup('ignored', {}, (_err, address) => assert.equal(address, '8.8.8.8'));
    const req = new EventEmitter(); req.setTimeout = () => {}; req.end = () => { const response = Readable.from(chunks); response.statusCode = statusCode; response.headers = headers; callback(response); }; return req;
  };
  await assert.rejects(downloadHostFile('https://files.oaiusercontent.com/file', { resolve, request: fake(302, { location: 'https://evil.test/private' }) }), /supported host/);
  await assert.rejects(downloadHostFile('https://files.oaiusercontent.com/file', { resolve, request: fake(200, { 'content-length': '999999999' }) }), error => error.status === 413);
  const good = await downloadHostFile('https://files.oaiusercontent.com/file', { resolve, request: fake(200, { 'content-type': 'text/plain' }, [Buffer.from('Actual bytes')]) });
  assert.equal(good.bytes.toString(), 'Actual bytes');
});
