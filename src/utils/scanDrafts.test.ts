import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import JSZip from 'jszip';
import { ScanDraftStore, ScanDraftSession, scanDraftBackup, emptyScan } from './scanDrafts';

const factory = new IDBFactory(), store = new ScanDraftStore(factory);
const scope = { uid: 'synthetic-adult', spaceId: 'synthetic-family' };
const image = (n: number) => 'data:image/png;base64,' + Buffer.from('synthetic original ' + n).toString('base64');
const snapshots = [];
for (let doc = 0; doc < 3; doc++) {
  const session = new ScanDraftSession(scope, `Synthetic document ${doc + 1}`, store);
  for (let page = 0; page < 3; page++) {
    const original = image(doc * 3 + page);
    await session.change({ originalCapture: original, originalName: `page-${page}.png`, pristinePhoto: original, capturedPhoto: original });
    if (page < 2) await session.change({ pages: [...session.getSnapshot().snapshot.pages, { id: page, original, image: original }], originalCapture: null, pristinePhoto: null, capturedPhoto: null });
  }
  snapshots.push({ id: session.id, snapshot: session.getSnapshot().snapshot });
}
assert.equal((await store.list(scope)).length, 3);
// New store/session instances simulate losing ALL React and module state.
const reopened = new ScanDraftStore(factory);
for (const saved of snapshots) {
  const recovered = new ScanDraftSession(scope, 'Recovered', reopened);
  await recovered.restore(saved.id);
  assert.deepEqual(recovered.getSnapshot().snapshot, saved.snapshot, 'all pages and originals survive reopening');
}
assert.deepEqual(await reopened.list({ ...scope, uid: 'another-account' }), []);
assert.deepEqual(await reopened.list({ ...scope, spaceId: 'another-space' }), []);
assert.equal(await reopened.read({ ...scope, uid: 'another-account' }, snapshots[0].id), null);
await assert.rejects(new ScanDraftSession({ ...scope, uid: 'another-account' }, 'Other', reopened).restore(snapshots[0].id));

// An interrupted handoff or upload retains both ready output and original pages.
const a = new ScanDraftSession(scope, 'Ready', store);
await a.restore(snapshots[0].id);
const file = { data: 'data:application/pdf;base64,c3ludGhldGlj', name: 'synthetic.pdf', type: 'application/pdf', size: 9 };
await a.change({ file });
try { throw Error('Synthetic offline upload'); } catch { /* app restarted before completion */ }
const b = new ScanDraftSession(scope, 'Resume', reopened); await b.restore(a.id);
assert.deepEqual(b.getSnapshot().snapshot.file, file);
assert.equal(b.getSnapshot().snapshot.pages.length, 2);

// A stale window cannot overwrite a resumed draft or revive an explicit discard.
await assert.rejects(a.change({ turns: 1 }), /another window/);
await b.discard();
await assert.rejects(a.retry(), /discarded/);
assert.equal(await store.read(scope, a.id), null);

// Pending writes are ordered; page movement and removal are durable.
const ordered = new ScanDraftSession(scope, 'Ordered', store);
const pages = [0, 1, 2].map(id => ({ id, image: image(id), original: image(id) }));
void ordered.change({ pages });
void ordered.change({ pages: [pages[2], pages[0], pages[1]] });
await ordered.change({ pages: [pages[2], pages[1]] });
assert.deepEqual((await store.read(scope, ordered.id))!.pages.map(p => p.id), [2, 1]);
const zip = await JSZip.loadAsync(await (await scanDraftBackup(ordered.getSnapshot().snapshot)).arrayBuffer());
assert.equal(await zip.file('original-01-capture.png')!.async('string'), 'synthetic original 2');
assert.equal(await zip.file('original-02-capture.png')!.async('string'), 'synthetic original 1');

// Quota/unavailable storage is visible, preserves RAM, and supports a real retry.
class FailingStore extends ScanDraftStore {
  fail = true;
  override async write(...args: Parameters<ScanDraftStore['write']>) { if (this.fail) throw new DOMException('Synthetic quota', 'QuotaExceededError'); return super.write(...args); }
}
const failing = new FailingStore(new IDBFactory()), quota = new ScanDraftSession(scope, 'Quota', failing);
await assert.rejects(quota.change({ originalCapture: image(99) }));
assert.equal(quota.getSnapshot().status, 'error');
assert.match(quota.getSnapshot().error, /Keep this window open/);
assert.equal(quota.getSnapshot().snapshot.originalCapture, image(99));
failing.fail = false; await quota.retry(); assert.equal(quota.getSnapshot().status, 'saved');
await assert.rejects(new ScanDraftStore(undefined).list(scope));

// Transaction failure after a request succeeds must never report a saved draft.
const aborted = new ScanDraftSession(scope, 'Abort', new ScanDraftStore(new IDBFactory()));
const originalPut = FakeObjectStore.prototype.put;
FakeObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
  const request = originalPut.apply(this, args);
  if (this.name === 'summaries') request.addEventListener('success', () => this.transaction.abort());
  return request;
};
try { await assert.rejects(aborted.change({ originalCapture: image(66) })); assert.equal(aborted.getSnapshot().status, 'error'); }
finally { FakeObjectStore.prototype.put = originalPut; }
// Test an explicit discard while writes are queued: no late recreation.
const pending = new ScanDraftSession(scope, 'Discard pending', store);
void pending.change({ originalCapture: image(77) });
await pending.discard();
assert.equal(await store.read(scope, pending.id), null);
await assert.rejects(pending.change({ originalCapture: image(88) }));
assert.deepEqual(emptyScan().pages, []);
console.log('scanDrafts: three-document restart recovery, exact originals/order, failed uploads, account/space isolation, stale writers, quota retry and pending-write discard verified');
