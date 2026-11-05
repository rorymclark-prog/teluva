import assert from 'node:assert/strict';
import { canPrepareImport, prepareImportDrafts, type DraftPreparationProgress } from './importPreparation';
import { InboxRequestError, type ImportBatchEntry, type ImportInboxItem } from './importInboxClient';
import { createFileOperationScope } from './fileOperationScope';

const now = Date.parse('2026-11-05T12:00:00Z');
const draft = (id: string): ImportInboxItem => ({ id, spaceId: 'synthetic-family', createdBy: 'customer', status: 'pending', source: { documentId: `original-${id}` }, revision: 3, createdAt: '', updatedAt: '', analysis: { status: 'idle' } });
const queued = (id: string): ImportBatchEntry => ({ id, inboxItemId: id, documentId: `original-${id}`, name: `${id}.pdf`, requestId: `request-${id}`, status: 'done' });
const ready = (item: ImportInboxItem): ImportInboxItem => ({ ...item, revision: item.revision + 2, analysis: { status: 'ready', evidenceQuotes: [{ quote: 'Synthetic receipt' }] }, proposal: { kind: 'asset', asset: { name: 'Evidence-backed laptop', category: 'Electronics' } } });
function fixture(ids = ['one', 'two']) {
  let identity = 'synthetic-family';
  const items = new Map(ids.map(id => [id, draft(id)])), calls: string[] = [], revisions: number[] = [], adopted: ImportInboxItem[] = [];
  let progress: DraftPreparationProgress[] = [];
  const options = {
    scope: createFileOperationScope(() => [identity]), getItem: (id: string) => items.get(id), now: () => now,
    analyze: async (id: string, revision: number) => { calls.push(id); revisions.push(revision); return ready(items.get(id)!); },
    onItem: (item: ImportInboxItem) => { items.set(item.id, item); adopted.push(item); },
    onProgress: (value: DraftPreparationProgress[]) => { progress = value; },
  };
  return { items, calls, revisions, adopted, options, entries: ids.map(queued), progress: () => progress, switchSpace: () => { identity = 'other-space'; } };
}

{
  const f = fixture(); let active = 0, maxActive = 0;
  const originalAnalyze = f.options.analyze;
  await prepareImportDrafts(f.entries, { ...f.options, analyze: async (id, revision) => { active++; maxActive = Math.max(maxActive, active); const result = await originalAnalyze(id, revision); active--; return result; } });
  assert.equal(maxActive, 1); assert.deepEqual(f.calls, ['one', 'two']); assert.deepEqual(f.revisions, [3, 3]);
  assert.ok(f.adopted.every(item => item.status === 'pending' && item.source.documentId === `original-${item.id}`));
  assert.ok(f.progress().every(item => item.status === 'ready'));
  await prepareImportDrafts(f.entries, f.options);
  assert.equal(f.calls.length, 2, 'retry never spends allowance on successful drafts');
}
{
  const f = fixture(); let fail = true;
  const analyze = async (id: string) => { f.calls.push(id); if (id === 'one' && fail) { fail = false; return { ...f.items.get(id)!, revision: 5, analysis: { status: 'failed' as const, error: 'Scan could not be read', errorStatus: 422 } }; } return ready(f.items.get(id)!); };
  await prepareImportDrafts(f.entries, { ...f.options, analyze });
  assert.deepEqual(f.progress().map(item => item.status), ['failed', 'ready']);
  await prepareImportDrafts(f.entries, { ...f.options, analyze });
  assert.deepEqual(f.calls, ['one', 'two', 'one'], 'explicit retry prepares only the failed source');
}
for (const errorStatus of [402, 403, 429, 503, undefined]) {
  const f = fixture();
  await prepareImportDrafts(f.entries, { ...f.options, analyze: async id => { f.calls.push(id); return { ...f.items.get(id)!, analysis: { status: 'failed', error: 'Check allowance or service availability', errorStatus } }; } });
  assert.deepEqual(f.calls, ['one']); assert.deepEqual(f.progress().map(item => item.status), ['failed', 'stopped']);
}
{
  const f = fixture();
  await prepareImportDrafts(f.entries, { ...f.options, analyze: async () => { throw new InboxRequestError('Refresh this draft', 409, 'REVISION_CONFLICT'); } });
  assert.equal(f.adopted.length, 0); assert.ok(f.progress().every(item => item.status === 'failed'));
}
{
  const f = fixture(); let stop = false;
  await prepareImportDrafts(f.entries, { ...f.options, stopRequested: () => stop, analyze: async id => { f.calls.push(id); stop = true; return ready(f.items.get(id)!); } });
  assert.deepEqual(f.calls, ['one']); assert.deepEqual(f.progress().map(item => item.status), ['ready', 'stopped']);
}
{
  const f = fixture();
  await assert.rejects(prepareImportDrafts(f.entries, { ...f.options, analyze: async id => { f.calls.push(id); f.switchSpace(); return ready(f.items.get(id)!); } }), /account, space or upload panel changed/);
  assert.deepEqual(f.calls, ['one']); assert.equal(f.adopted.length, 0, 'a late result never enters another account/space');
}
{
  const f = fixture();
  await prepareImportDrafts(f.entries, { ...f.options, analyze: async id => { f.calls.push(id); f.items.set('two', ready(f.items.get('two')!)); return ready(f.items.get(id)!); } });
  assert.deepEqual(f.calls, ['one'], 'a review made while an earlier source was analyzed is preserved');
}
{
  const f = fixture();
  await prepareImportDrafts([f.entries[0], f.entries[0]], f.options);
  assert.deepEqual(f.calls, ['one'], 'duplicate selection cannot spend allowance twice');
  await assert.rejects(prepareImportDrafts(Array.from({ length: 21 }, () => f.entries[0]), f.options), /up to 20/);
}
{
  const f = fixture();
  await prepareImportDrafts(f.entries, { ...f.options, analyze: async () => ({ ...ready(draft('unrelated')), spaceId: 'other-space' }) });
  assert.equal(f.adopted.length, 0); assert.deepEqual(f.progress().map(item => item.status), ['failed', 'stopped']);
}
{
  const e = queued('one'), item = draft('one');
  assert.equal(canPrepareImport(e, { ...item, status: 'applied' }), false);
  assert.equal(canPrepareImport(e, { ...item, source: { sourceText: 'Unselected reference' } }), false);
  assert.equal(canPrepareImport(e, { ...item, analysis: { status: 'running', leaseUntil: new Date(now + 1).toISOString() } }, now), false);
  assert.equal(canPrepareImport(e, { ...item, analysis: { status: 'running', leaseUntil: new Date(now - 1).toISOString() } }, now), true);
  assert.equal(canPrepareImport(e, { ...item, analysis: { status: 'running' } }, now), false);
  assert.equal(canPrepareImport(e, ready(item)), false);
}
console.log('importPreparation.test.ts: selected-original preparation, partial retry, allowance stops, revision and scope fences pass');
