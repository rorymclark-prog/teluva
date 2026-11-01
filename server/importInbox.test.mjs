import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportInbox, createImportInboxRouter, ImportInboxError, IMPORT_LIMITS, sanitizeImportProposal } from './importInbox.mjs';

const assetProposal = patch => ({ kind: 'asset', asset: { name: 'Synthetic laptop', category: 'Electronics', ...patch } });
const documentProposal = patch => ({ kind: 'document', document: { name: 'Reviewed invoice', category: 'Financial', ...patch } });
const actor = uid => ({ uid });
const rejectCode = code => error => error instanceof ImportInboxError && error.code === code;

function fixture(extractor) {
  const records = new Map(Object.entries({
    'families/business/roles/admin': { role: 'admin' }, 'families/business/roles/staff': { role: 'member' },
    'families/business/roles/colleague': { role: 'member' }, 'families/business/roles/child': { role: 'child' },
    'families/other/roles/admin': { role: 'admin' },
    'families/business/reference/documents': { preserved: 'reference metadata', docs: [
      { id: 'invoice', name: 'Original invoice', fileName: 'original.pdf', fileType: 'application/pdf', fileSize: 20, storagePath: 'families/business/documents/invoice/original.pdf', downloadUrl: '/api/files/content?path=private', contentHash: 'hash-one', ownerUid: 'staff', category: 'Other', uploadedAt: '2026-01-01', keyFacts: [{ value: 'retained' }] },
      { id: 'private', name: 'Colleague HR file', ownerUid: 'colleague', contentHash: 'private-hash', category: 'Other' },
    ] },
    'families/other/reference/documents': { docs: [{ id: 'invoice', name: 'Other space secret', ownerUid: 'admin', contentHash: 'other-hash' }] },
  }));
  const versions = new Map(), queryVersions = new Map();
  const writes = [], extracts = [];
  let clock = new Date('2026-11-01T12:00:00Z');
  const snapshot = path => ({ id: path.slice(path.lastIndexOf('/') + 1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const bump = (path, value) => {
    records.set(path, structuredClone(value)); versions.set(path, (versions.get(path) || 0) + 1);
    const collection = path.slice(0, path.lastIndexOf('/')); queryVersions.set(collection, (queryVersions.get(collection) || 0) + 1);
  };
  const querySnapshot = query => {
    let rows = [...records].filter(([path]) => path.startsWith(query.path + '/') && path.split('/').length === query.path.split('/').length + 1);
    for (const [field, op, value] of query.filters) rows = rows.filter(([, data]) => op === '==' && data[field] === value);
    if (query.sort) rows.sort((a, b) => String(a[1][query.sort[0]] || '').localeCompare(String(b[1][query.sort[0]] || '')) * (query.sort[1] === 'desc' ? -1 : 1));
    rows = rows.slice(0, query.cap ?? Infinity);
    const docs = rows.map(([path]) => snapshot(path));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };
  const makeRef = path => ({ path, id: path.slice(path.lastIndexOf('/') + 1), get: async () => snapshot(path) });
  const makeQuery = (path, filters = [], sort, cap) => ({ path, filters, sort, cap, query: true,
    doc: id => makeRef(`${path}/${id}`), where: (field, op, value) => makeQuery(path, [...filters, [field, op, value]], sort, cap),
    orderBy: (field, direction) => makeQuery(path, filters, [field, direction], cap), limit: limit => makeQuery(path, filters, sort, limit), get: async () => querySnapshot({ path, filters, sort, cap }),
  });
  const db = { doc: makeRef, collection: makeQuery,
    runTransaction: async callback => {
      for (let attempt = 0; attempt < 15; attempt++) {
        const reads = new Map(), queries = new Map(), pending = [];
        const result = await callback({
          get: async ref => {
            assert.equal(pending.length, 0, 'every transaction read precedes its writes');
            if (ref.query) { queries.set(ref.path, queryVersions.get(ref.path) || 0); return querySnapshot(ref); }
            reads.set(ref.path, versions.get(ref.path) || 0); return snapshot(ref.path);
          },
          set: (ref, value) => { assert.equal(JSON.stringify(value).includes('undefined'), false); pending.push([ref.path, structuredClone(value)]); },
        });
        if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version) || [...queries].some(([path, version]) => (queryVersions.get(path) || 0) !== version)) continue;
        for (const [path, value] of pending) { bump(path, value); writes.push(path); }
        return result;
      }
      throw new Error('Synthetic contention limit');
    },
  };
  const resolveMembership = async (who, space, { transaction } = {}) => {
    const ref = makeRef(`families/${space}/roles/${who.uid}`);
    const snap = transaction ? await transaction.get(ref) : await ref.get();
    return { role: snap.data()?.role, type: 'business' };
  };
  const service = createImportInbox({ db, resolveMembership,
    canReadDocument: async (who, space, document) => records.get(`families/${space}/roles/${who.uid}`)?.role === 'admin' || document.ownerUid === who.uid,
    extractDocument: async (...args) => { extracts.push(args); return extractor ? extractor(...args) : { proposal: assetProposal({ serialNumber: 'SN-1', model: 'Model-1' }), extractedText: 'Invoice SN-1', evidenceQuotes: [{ field: 'serialNumber', quote: 'SN-1' }, { quote: 'invented quote' }] }; },
    now: () => clock,
  });
  return { service, records, writes, extracts, bump, db, advance: ms => { clock = new Date(clock.getTime() + ms); } };
}

 test('submissions are durable, own-space scoped, idempotent and never canonical writes', async () => {
  const f = fixture();
  const source = { requestId: 'request-1', documentId: 'invoice' };
  const first = await f.service.create(actor('staff'), 'business', source);
  const second = await f.service.create(actor('staff'), 'business', { documentId: 'invoice', requestId: 'request-1' });
  assert.equal(first.id, second.id);
  assert.equal(first.source.contentHash, 'hash-one');
  assert.equal(first.source.hasOriginalDocument, true);
  assert.equal(first.status, 'pending');
  assert.equal(first.analysis.status, 'idle');
  assert.equal(f.writes.filter(path => path.includes('/importInbox/')).length, 1);
  assert.equal(f.writes.some(path => path.includes('/assets/')), false);
  assert.equal(f.extracts.length, 0, 'creating a pending entry never invokes the model implicitly');
  await assert.rejects(f.service.create(actor('staff'), 'business', { ...source, proposal: assetProposal() }), rejectCode('REQUEST_CONFLICT'));
  assert.equal((await f.service.list(actor('staff'), 'business')).length, 1);
  assert.deepEqual(await f.service.list(actor('colleague'), 'business'), []);
  assert.equal((await f.service.list(actor('admin'), 'business')).length, 1);
  await assert.rejects(f.service.update(actor('colleague'), 'business', first.id, { proposal: assetProposal() }), rejectCode('IMPORT_FORBIDDEN'));
  await assert.rejects(f.service.apply(actor('admin'), 'other', first.id), rejectCode('IMPORT_MISSING'));
});

test('children, outsiders, other employees and body-forged roles cannot obtain original evidence', async () => {
  const f = fixture();
  for (const uid of ['child', 'outsider']) {
    await assert.rejects(f.service.create({ uid, role: 'admin' }, 'business', { requestId: 'x', documentId: 'invoice' }), rejectCode('IMPORT_ADULT_REQUIRED'));
    await assert.rejects(f.service.list({ uid, role: 'admin' }, 'business'), rejectCode('IMPORT_ADULT_REQUIRED'));
  }
  await assert.rejects(f.service.create(actor('staff'), 'business', { requestId: 'private', documentId: 'private' }), rejectCode('SOURCE_FORBIDDEN'));
  const entry = await f.service.create(actor('staff'), 'business', { requestId: 'valid', documentId: 'invoice' });
  const source = f.records.get('families/business/reference/documents');
  source.docs[0].ownerUid = 'colleague'; f.bump('families/business/reference/documents', source);
  assert.deepEqual(await f.service.list(actor('staff'), 'business'), [], 'a cached draft cannot expose a now-forbidden document');
  await assert.rejects(f.service.analyze(actor('staff'), 'business', entry.id), rejectCode('SOURCE_FORBIDDEN'));
  assert.equal(f.extracts.length, 0);
});

test('external text remains explicitly text-only, names its source, and never fabricates receipt files', async () => {
  const f = fixture();
  const proposal = assetProposal({ purchaseDate: '2026-02-01', purchasePrice: '250,00', currency: 'eur' });
  const entry = await f.service.create(actor('staff'), 'business', { requestId: 'text', sourceText: 'https://example.test is plain submitted text, never fetched.', sourceName: 'Reviewed chatbot notes', proposal });
  assert.equal(entry.source.hasOriginalDocument, false);
  assert.equal(entry.source.kind, 'text');
  assert.equal(entry.proposal.asset.currency, 'EUR');
  assert.equal(entry.proposal.asset.warranties, undefined, 'no default legal/commercial warranty is guessed');
  await assert.rejects(f.service.apply(actor('staff'), 'business', entry.id), rejectCode('IMPORT_ADMIN_REQUIRED'));
  const applied = await f.service.apply(actor('admin'), 'business', entry.id);
  const asset = f.records.get(`families/business/assets/${applied.appliedRecordId}`);
  assert.equal(asset.documentIds, undefined);
  assert.equal(asset.receiptDataUrl, undefined);
  assert.equal(asset.importSource.sourceKind, 'submitted-text');
  assert.equal(asset.importSource.hasOriginalDocument, false);
  const metadataOnly = await f.service.create(actor('staff'), 'business', { requestId: 'text-doc', sourceText: 'Invoice text', sourceName: 'Chatbot', proposal: documentProposal() });
  await assert.rejects(f.service.apply(actor('admin'), 'business', metadataOnly.id), rejectCode('ORIGINAL_REQUIRED'));
});

test('analyze drafts only, validates verbatim evidence quotes, and apply is atomic/idempotent under concurrency', async () => {
  const f = fixture();
  const entry = await f.service.create(actor('staff'), 'business', { requestId: 'analysis', documentId: 'invoice' });
  const analyzed = await f.service.analyze(actor('staff'), 'business', entry.id, { expectedRevision: entry.revision });
  assert.equal(analyzed.analysis.status, 'ready');
  assert.deepEqual(analyzed.analysis.evidenceQuotes, [{ field: 'serialNumber', quote: 'SN-1' }]);
  assert.equal(f.extracts[0][2].document.id, 'invoice');
  assert.equal(f.extracts[0][1], 'business');
  assert.equal(f.writes.some(path => path.includes('/assets/')), false);
  const reviewed = await f.service.update(actor('staff'), 'business', entry.id, { proposal: analyzed.proposal, expectedRevision: analyzed.revision });
  assert.equal(reviewed.analysis.extractedText, 'Invoice SN-1', 'review keeps the prepared source available for later authorized fetches');
  assert.deepEqual(reviewed.analysis.evidenceQuotes, analyzed.analysis.evidenceQuotes);
  assert.equal(reviewed.analysis.jobId, undefined, 'review cannot leave a slow model job able to overwrite it');
  const applied = await Promise.all([f.service.apply(actor('admin'), 'business', entry.id), f.service.apply(actor('admin'), 'business', entry.id)]);
  assert.equal(applied[0].appliedRecordId, applied[1].appliedRecordId);
  const assets = [...f.records].filter(([path]) => path.startsWith('families/business/assets/'));
  assert.equal(assets.length, 1);
  assert.equal(f.writes.filter(path => path.startsWith('families/business/assets/')).length, 1);
  assert.deepEqual(assets[0][1].documentIds, ['invoice']);
  assert.equal(assets[0][1].importSource.contentHash, 'hash-one');
  await assert.rejects(f.service.update(actor('admin'), 'business', entry.id, { proposal: assetProposal() }), rejectCode('IMPORT_TERMINAL'));
  await assert.rejects(f.service.analyze(actor('admin'), 'business', entry.id), rejectCode('IMPORT_TERMINAL'));
  await assert.rejects(f.service.dismiss(actor('admin'), 'business', entry.id), rejectCode('IMPORT_TERMINAL'));
});

test('current source version and role are re-read in the apply transaction; exact duplicate assets surface candidates', async () => {
  const f = fixture();
  const entry = await f.service.create(actor('staff'), 'business', { requestId: 'source', documentId: 'invoice', proposal: assetProposal({ serialNumber: 'SN', model: 'X' }) });
  const original = f.records.get('families/business/reference/documents'); original.docs[0].contentHash = 'replaced'; f.bump('families/business/reference/documents', original);
  await assert.rejects(f.service.apply(actor('admin'), 'business', entry.id), rejectCode('SOURCE_CHANGED'));
  await assert.rejects(f.service.update(actor('staff'), 'business', entry.id, { proposal: assetProposal() }), rejectCode('SOURCE_CHANGED'));
  const fresh = await f.service.analyze(actor('staff'), 'business', entry.id);
  assert.equal(fresh.source.contentHash, 'replaced');
  f.bump('families/business/roles/admin', { role: 'member' });
  await assert.rejects(f.service.apply({ uid: 'admin', role: 'admin' }, 'business', entry.id), rejectCode('IMPORT_ADMIN_REQUIRED'));
  f.bump('families/business/roles/admin', { role: 'admin' });
  f.bump('families/business/assets/existing', { id: 'existing', name: 'Already registered', serialNumber: 'SN-1', model: 'Model-1', untouched: true });
  await assert.rejects(f.service.apply(actor('admin'), 'business', entry.id), error => error.code === 'DUPLICATE_ASSET' && error.details.candidates[0].id === 'existing');
  assert.equal(f.records.get('families/business/assets/existing').untouched, true);
  assert.equal(f.records.get(`families/business/importInbox/${entry.id}`).status, 'pending');
});

test('document apply preserves original bytes, unrelated fields and other documents; no original means no new Vault row', async () => {
  const f = fixture();
  const entry = await f.service.create(actor('staff'), 'business', { requestId: 'document', documentId: 'invoice', proposal: documentProposal({ docDate: '2026-02-28', notes: 'Reviewed source' }) });
  const before = structuredClone(f.records.get('families/business/reference/documents'));
  const applied = await f.service.apply(actor('admin'), 'business', entry.id);
  assert.equal(applied.appliedRecordId, 'invoice');
  const after = f.records.get('families/business/reference/documents');
  assert.equal(after.docs.length, before.docs.length);
  for (const key of ['storagePath', 'downloadUrl', 'contentHash', 'keyFacts', 'uploadedAt']) assert.deepEqual(after.docs[0][key], before.docs[0][key]);
  assert.equal(after.preserved, before.preserved);
  assert.deepEqual(after.docs[1], before.docs[1]);
  assert.equal(after.docs[0].name, 'Reviewed invoice');
  assert.equal(after.docs[0].docDate, '2026-02-28');
});

test('failed extraction keeps manual work, preserves safe quota/consent errors, and never leaks raw provider errors', async () => {
  for (const [failure, expected] of [
    [Object.assign(new Error('Enable AI consent in Teluva first.'), { status: 403 }), 'Enable AI consent in Teluva first.'],
    [Object.assign(new Error('Monthly AI allowance reached.'), { status: 429 }), 'Monthly AI allowance reached.'],
    [new Error('https://secret.test/?token=hidden stack trace'), 'Could not analyze'],
  ]) {
    const f = fixture(async () => { throw failure; });
    const entry = await f.service.create(actor('staff'), 'business', { requestId: 'failed', documentId: 'invoice', proposal: assetProposal({ name: 'Typed draft' }) });
    const failed = await f.service.analyze(actor('staff'), 'business', entry.id);
    assert.equal(failed.status, 'pending');
    assert.equal(failed.proposal.asset.name, 'Typed draft');
    assert.equal(failed.analysis.status, 'failed');
    assert.ok(failed.analysis.error.includes(expected));
    assert.equal(JSON.stringify(failed).includes('secret.test'), false);
    await assert.rejects(f.service.apply(actor('admin'), 'business', entry.id), rejectCode('PROPOSAL_REQUIRED'));
    const reviewed = await f.service.update(actor('staff'), 'business', entry.id, { proposal: failed.proposal, expectedRevision: failed.revision });
    assert.equal(reviewed.analysis.status, 'ready');
  }
});

test('slow extraction cannot overwrite an edit/dismissal, and a crashed running lease is retryable', async () => {
  let release, calls = 0;
  const f = fixture(async () => { calls++; if (calls === 1) return new Promise(resolve => { release = resolve; }); return { proposal: assetProposal({ name: 'Retried' }) }; });
  const entry = await f.service.create(actor('staff'), 'business', { requestId: 'slow', documentId: 'invoice', proposal: assetProposal() });
  const slow = f.service.analyze(actor('staff'), 'business', entry.id);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const running = f.records.get(`families/business/importInbox/${entry.id}`);
  assert.equal(running.analysis.leaseUntil, '2026-11-01T12:05:00.000Z');
  await assert.rejects(f.service.analyze(actor('staff'), 'business', entry.id), rejectCode('ANALYSIS_RUNNING'));
  const edited = await f.service.update(actor('staff'), 'business', entry.id, { proposal: assetProposal({ name: 'Human edit wins' }), expectedRevision: running.revision });
  release({ proposal: assetProposal({ name: 'Slow model' }) });
  assert.equal((await slow).proposal.asset.name, 'Human edit wins');
  await assert.rejects(f.service.update(actor('staff'), 'business', entry.id, { proposal: assetProposal(), expectedRevision: entry.revision }), rejectCode('REVISION_CONFLICT'));
  const dismissed = await f.service.dismiss(actor('staff'), 'business', entry.id, { expectedRevision: edited.revision });
  assert.equal(dismissed.status, 'dismissed');
  assert.equal((await f.service.dismiss(actor('staff'), 'business', entry.id)).revision, dismissed.revision);
  await assert.rejects(f.service.update(actor('staff'), 'business', entry.id, { proposal: assetProposal() }), rejectCode('IMPORT_TERMINAL'));
  const retry = await f.service.create(actor('staff'), 'business', { requestId: 'lease', documentId: 'invoice' });
  const stale = f.records.get(`families/business/importInbox/${retry.id}`);
  stale.analysis = { status: 'running', startedAt: '2026-11-01T12:00:00Z', leaseUntil: '2026-11-01T12:05:00Z', jobId: 'dead-process' };
  f.bump(`families/business/importInbox/${retry.id}`, stale);
  f.advance(IMPORT_LIMITS.analysisLeaseMs + 1);
  assert.equal((await f.service.analyze(actor('staff'), 'business', retry.id)).proposal.asset.name, 'Retried');
});

test('fixed-field validation rejects malformed payloads, impossible dates, unsupported enums, and forged file writes', async () => {
  const f = fixture();
  const base = { requestId: 'bad', sourceText: 'Source', sourceName: 'Named source' };
  for (const input of [
    { ...base, sourceName: '' }, { ...base, requestId: '../key' }, { ...base, documentId: 'invoice' },
    { ...base, targetAssetId: 'existing' }, { ...base, sourceText: 'x'.repeat(IMPORT_LIMITS.sourceChars + 1) },
    { ...base, proposal: assetProposal({ category: 'Admin' }) }, { ...base, proposal: assetProposal({ purchaseDate: '2026-02-30' }) },
    { ...base, proposal: assetProposal({ documentIds: ['forged-original'], receiptDataUrl: 'https://evil.test' }) },
    { ...base, proposal: assetProposal({ warranties: [{ kind: 'statutory', endDate: '2028-01-01' }] }) },
    { ...base, proposal: documentProposal({ storagePath: 'families/other/secret' }) },
  ]) await assert.rejects(f.service.create(actor('staff'), 'business', input));
  assert.equal(f.writes.length, 0);
  const clean = sanitizeImportProposal(assetProposal({ name: '  Reviewed  ', notes: ' User notes ', returnByDate: '2026-12-01', warranties: [{ kind: 'manufacturer', provider: 'Recorded supplier' }] }));
  assert.equal(clean.asset.name, 'Reviewed');
  assert.equal(clean.asset.warranties[0].endDate, undefined, 'dates and cover are never inferred');
  assert.equal(clean.asset.warranties[0].id, 'warranty-1');
  assert.equal(typeof createImportInboxRouter({ service: f.service, authenticateFirebase: async () => actor('staff') }), 'function');
});
