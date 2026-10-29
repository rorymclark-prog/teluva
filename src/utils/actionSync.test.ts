import assert from 'node:assert/strict';
import type { FamilyAction, FamilyActionsDoc } from '../types';
import { createActionSync } from './actionSync';
import { mergeShared } from './mergeShared';

const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const action = (id: string, patch: Partial<FamilyAction> = {}): FamilyAction => ({
  id, title: id, status: 'open', createdAt: '2026-10-29T12:00:00Z', updatedAt: '2026-10-29T12:00:00Z', ...patch,
});
const doc = (...items: FamilyAction[]): FamilyActionsDoc => ({ items });
const first = doc(action('first'));

function harness(options: { enabled: boolean; demoDoc?: FamilyActionsDoc; pending?: boolean } = { enabled: true }) {
  const loads: ReturnType<typeof deferred<FamilyActionsDoc | null>>[] = [];
  const saves: { doc: FamilyActionsDoc; base: FamilyActionsDoc; result: ReturnType<typeof deferred<boolean>> }[] = [];
  let receive!: (value: FamilyActionsDoc | null, commit: () => void) => void;
  let commits = 0, unsubscribed = false;
  const store = createActionSync({
    load: () => { const request = deferred<FamilyActionsDoc | null>(); loads.push(request); return request.promise; },
    save: (value, base) => { const result = deferred<boolean>(); saves.push({ doc: value, base, result }); return result.promise; },
    subscribe: callback => { receive = callback; return () => { unsubscribed = true; }; },
    hasPendingLocal: () => !!options.pending,
  }, options);
  const stop = store.start();
  return { store, loads, saves, stop, get commits() { return commits; }, get unsubscribed() { return unsubscribed; },
    receive: (value: FamilyActionsDoc) => receive(value, () => { commits += 1; }) };
}

// A delayed first read must not replace a more recent subscription snapshot.
{
  const h = harness();
  assert.equal(await h.store.persist([action('too-early')]), false);
  const recent = doc(action('remote'));
  h.receive(recent);
  assert.equal(h.commits, 0, 'initial snapshots cannot overwrite a dirty cache before it has been loaded');
  h.loads[0].resolve(first);
  await tick();
  assert.deepEqual(h.store.getSnapshot().doc, recent);
  assert.equal(h.commits, 1);
  h.stop();
}

// Reopening while offline must retain a previous device save, even if the
// server subscription responds first and continues to update afterwards.
{
  const h = harness({ enabled: true, pending: true });
  h.receive(first);
  const pending = doc(action('first', { status: 'done' }), action('local-only'));
  h.loads[0].resolve(pending); await tick();
  assert.equal(h.store.getSnapshot().doc.items[0].status, 'done');
  h.receive(doc(action('first', { notes: 'Remote change' }), action('remote-only')));
  const visible = h.store.getSnapshot().doc;
  assert.equal(visible.items.find(item => item.id === 'first')?.status, 'done');
  assert.equal(visible.items.find(item => item.id === 'first')?.notes, 'Remote change');
  assert.ok(visible.items.some(item => item.id === 'local-only'));
  assert.ok(visible.items.some(item => item.id === 'remote-only'));
  assert.equal(h.commits, 0, 'neither initial nor later server snapshots replace the unsynced cache');
  h.stop();
}

// Keep the exact editor baseline until save; read-back supersedes older held
// snapshots, while snapshots that arrive during read-back supersede its result.
for (const newerDuringReadback of [false, true]) {
  const h = harness();
  h.loads[0].resolve(first); await tick();
  h.store.hold(true);
  h.receive(doc(action('first', { notes: 'Other parent note' })));
  assert.deepEqual(h.store.getSnapshot().doc, first);
  assert.equal(h.commits, 0, 'held values are not promoted to the shared baseline/cache');
  const local = doc(action('first', { status: 'done' }));
  const saving = h.store.persist(local.items);
  assert.deepEqual(h.saves[0].base, first, 'save diffs against the screen that opened the editor');
  assert.equal(await h.store.persist(local.items), false, 'double-submit cannot begin another write');
  h.saves[0].result.resolve(true); await tick();
  const merged = mergeShared(first, local, doc(action('first', { notes: 'Other parent note' })));
  const newest = doc(...merged.items, action('remote-added-after-save'));
  if (newerDuringReadback) h.receive(newest);
  h.loads[1].resolve(merged);
  assert.equal(await saving, true);
  h.store.hold(false); h.store.flush();
  assert.deepEqual(h.store.getSnapshot().doc, newerDuringReadback ? newest : merged);
  assert.equal(h.store.getSnapshot().pendingRemote, false);
  assert.equal(h.commits, newerDuringReadback ? 1 : 0, 'only the adopted newest snapshot may commit');
  h.stop();
}

// Failed cloud writes remain local intent across close/reopen, live updates,
// and another save. Advancing the base to the unsynced local doc loses edits.
{
  const h = harness();
  h.loads[0].resolve(first); await tick();
  h.store.hold(true);
  const local = doc(action('first', { status: 'done' }));
  const saving = h.store.persist(local.items);
  const remote = doc(action('first', { notes: 'Remote note' }), action('remote'));
  h.receive(remote);
  h.saves[0].result.resolve(false);
  assert.equal(await saving, true, 'a device save is accepted with a visible pending notice');
  h.store.hold(false); h.store.flush();
  const pending = h.store.getSnapshot().doc;
  assert.equal(pending.items.find(item => item.id === 'first')?.status, 'done');
  assert.equal(pending.items.find(item => item.id === 'first')?.notes, 'Remote note');
  assert.ok(pending.items.some(item => item.id === 'remote'));
  assert.equal(h.commits, 0, 'remote cache commits cannot overwrite a pending device save');
  const later = doc(action('first', { notes: 'New remote note' }), action('remote'), action('later'));
  h.receive(later);
  assert.equal(h.store.getSnapshot().doc.items[0].status, 'done', 'a live snapshot cannot reopen unsynced completion');
  assert.equal(h.store.getSnapshot().doc.items[0].notes, 'New remote note');
  assert.equal(h.commits, 0);
  const retry = h.store.persist(h.store.getSnapshot().doc.items);
  assert.deepEqual(h.saves[1].base, later, 'retry baseline contains confirmed remote facts, never unsynced completion');
  const merged = mergeShared(h.saves[1].base, h.saves[1].doc, later);
  assert.equal(merged.items.find(item => item.id === 'first')?.status, 'done', 'completion is still a diff on retry');
  h.saves[1].result.resolve(true); await tick();
  h.loads[1].resolve(merged);
  assert.equal(await retry, true);
  assert.equal(h.store.getSnapshot().notice, '');
  h.stop();
}

// A post-save refresh failure is not a failed write or an invitation to resubmit.
{
  const h = harness();
  h.loads[0].resolve(first); await tick();
  const saving = h.store.persist([action('first', { status: 'done' })]);
  h.saves[0].result.resolve(true); await tick();
  h.loads[1].reject(new Error('read-back unavailable'));
  assert.equal(await saving, true);
  assert.equal(h.store.getSnapshot().doc.items[0].status, 'done');
  assert.match(h.store.getSnapshot().notice, /^Saved\./);
  h.stop();
}

// Changing hubs invalidates old reads, writes and subscription callbacks.
{
  const old = harness();
  old.loads[0].resolve(first); await tick();
  const saving = old.store.persist([action('old-hub-write')]);
  old.stop();
  const next = harness();
  assert.equal(next.store.getSnapshot().loading, true);
  assert.deepEqual(next.store.getSnapshot().doc.items, []);
  old.receive(doc(action('stale-snapshot')));
  old.saves[0].result.resolve(true);
  await tick();
  assert.equal(old.loads.length, 1, 'stale writes never launch reads against the next active hub');
  assert.equal(await saving, false);
  assert.equal(old.unsubscribed, true);
  assert.deepEqual(next.store.getSnapshot().doc.items, []);
  next.loads[0].resolve(null); await tick();
  next.stop();
}
{
  const h = harness();
  h.stop(); h.loads[0].resolve(first); await tick();
  assert.deepEqual(h.store.getSnapshot().doc.items, [], 'an old initial load cannot revive a stopped scope');
}
{
  const disabled = harness({ enabled: false });
  assert.equal(disabled.loads.length, 0);
  assert.equal(await disabled.store.persist(first.items), false);
  disabled.stop();
  const demo = harness({ enabled: false, demoDoc: first });
  assert.equal(await demo.store.persist([action('demo')]), true);
  assert.equal(demo.saves.length, 0);
  assert.equal(demo.loads.length, 0);
  assert.equal(demo.store.getSnapshot().doc.items[0].id, 'demo');
  demo.stop();
}
console.log('actionSync.test.ts: held snapshots, read-back ordering, offline intent, retries, duplicate saves and scope invalidation passed');
