import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import React from 'react';
import type { ImportInboxItem } from '../utils/importInboxClient';

// A real React renderer runs the actual panel/row hooks and event handlers.
// Only auth, document readers and HTTP responses are synthetic; no browser,
// provider, credentials, real originals or records are accessed.
const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const root = resolve(import.meta.dirname, '../..');
const source = readFileSync(resolve(root, 'src/components/ImportInbox.tsx'), 'utf8')
  .replace('useState<ImportBatchEntry[]>([])', 'useState<ImportBatchEntry[]>(globalThis.__fixture.batch)');
const bundle = await build({ stdin: { contents: source, resolveDir: resolve(root, 'src/components'), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false,
  plugins: [{ name: 'synthetic-boundaries', setup(api) {
    api.onResolve({ filter: /(?:\/contexts\/FamilyContext|\/lib\/firebase|\/utils\/db$|\/utils\/serviceDocUpload|\/utils\/reviewedPreferences$|^\.\/ServiceDocs$)/ }, () => ({ path: 'readers', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root, contents: `
      import React from 'react';
      export const useFamilyCtx = () => globalThis.__fixture.ctx;
      export const FAMILY_ID = 'synthetic-family';
      export const auth = { currentUser: { uid: 'synthetic-customer', getIdToken: async () => 'synthetic-only' } };
      export const useVaultDocs = () => ({ docs: [], adopt: () => {} });
      export const ServiceDocChips = () => React.createElement('p', {}, 'Synthetic original linked');
      export const uploadServiceDocFile = () => { throw Error('Real uploads forbidden in interaction fixture'); };
      export const applyReviewedPreferences = () => { throw Error('No preference writes in fixture'); };
    ` }));
  } }],
});
const text = (node: any): string => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const button = (node: any, label: string) => node.findAllByType('button').find((value: any) => text(value) === label);
const draft = (id: string): ImportInboxItem => ({ id, spaceId: 'synthetic-family', createdBy: 'synthetic-customer', status: 'pending', source: { documentId: `original-${id}` }, analysis: { status: 'idle' }, revision: 1, createdAt: '', updatedAt: '' });
async function fixture() {
  const items = new Map(['one', 'two'].map(id => [id, draft(id)]));
  const calls: { id: string; method: string; action: string }[] = [];
  const pending: { id: string; resolve: (status?: number) => void }[] = [];
  const state = {
    ctx: { uid: 'synthetic-customer', familyId: 'synthetic-family', role: 'admin', isAdmin: true, canWrite: true, loading: false, aiConsent: true, spaces: [{ id: 'synthetic-family', type: 'family', role: 'admin' }] },
    batch: ['one', 'two'].map(id => ({ id, name: `${id}.txt`, requestId: id, inboxItemId: id, documentId: `original-${id}`, status: 'done' })),
  };
  const context = { console, process, setTimeout, clearTimeout, URLSearchParams, require, module: { exports: {} as Record<string, any> }, exports: {} as Record<string, any>, crypto: { randomUUID }, __fixture: state,
    window: { location: { search: '' }, setInterval, clearInterval },
    fetch: async (url: string, options: any) => {
      const path = new URL(url, 'http://fixture.test').pathname.split('/');
      const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      if (options.method === 'GET') return response({ spaceId: state.ctx.familyId, items: [...items.values()], nextCursor: null });
      const id = path[3], item = items.get(id)!;
      calls.push({ id, method: options.method, action: path[4] || 'patch' });
      const body = JSON.parse(options.body);
      assert.equal(body.expectedRevision, item.revision, 'manual edits must not be displaced into a revision conflict');
      return new Promise<Response>(resolve => pending.push({ id, resolve: (status = 200) => {
        if (status !== 200) { resolve(response({ error: 'Synthetic account unavailable' }, status)); return; }
        item.revision += options.method === 'PATCH' ? 1 : 2;
        item.proposal = options.method === 'PATCH' ? body.proposal : { kind: 'asset', asset: { name: `Prepared ${id}`, category: 'Electronics' } };
        item.analysis = { status: 'ready' };
        resolve(response({ spaceId: state.ctx.familyId, item }));
      } }));
    },
  };
  context.exports = context.module.exports;
  runInNewContext(bundle.outputFiles[0].text, context);
  const { default: Panel, ImportRow } = context.module.exports;
  let renderer: any;
  await act(async () => { renderer = create(React.createElement(Panel)); });
  const row = (id: string) => renderer.root.findAllByType(ImportRow).find((value: any) => value.props.item.id === id);
  const click = async (node: any, label: string) => { const target = button(node, label); assert.ok(target, label); assert.ok(!target.props.disabled, `${label} should be enabled`); await act(async () => { target.props.onClick(); }); };
  const finish = async (id: string, status = 200) => { const index = pending.findIndex(value => value.id === id); assert.notEqual(index, -1); await act(async () => { pending.splice(index, 1)[0].resolve(status); }); };
  const close = async () => { await act(async () => renderer.unmount()); assert.equal(pending.length, 0, 'release every test request'); };
  return { renderer, row, click, finish, close, calls, items };
}

{
  const f = await fixture();
  await f.click(f.row('two'), 'Enter an asset');
  await act(async () => f.row('two').findAllByType('input')[0].props.onChange({ target: { value: 'My manual laptop review' } }));
  await f.click(f.renderer.root, 'Prepare 1 draft with AI');
  assert.equal(f.row('two').findByType('fieldset').props.disabled, false, 'held manual row remains editable');
  await f.finish('one');
  assert.deepEqual(f.calls.map(value => value.id), ['one'], 'the manual row spent no model allowance');
  assert.equal(f.row('two').findAllByType('input')[0].props.value, 'My manual laptop review');
  assert.equal(button(f.row('two'), 'Save review').props.disabled, false);
  assert.doesNotMatch(text(f.renderer.toJSON()), /changed elsewhere/);
  assert.ok(f.items.get('one')!.status === 'pending');
  await f.close();
}
{
  const f = await fixture();
  await f.click(f.row('two'), 'Enter an asset');
  await act(async () => f.row('two').findAllByType('input')[0].props.onChange({ target: { value: 'Save in flight' } }));
  await f.click(f.row('two'), 'Save review');
  await f.click(f.renderer.root, 'Prepare 1 draft with AI');
  await f.finish('two'); await f.finish('one');
  assert.deepEqual(f.calls.map(value => [value.id, value.action]), [['two', 'patch'], ['one', 'analyze']]);
  assert.equal(f.items.get('two')!.proposal?.kind, 'asset');
  assert.equal((f.items.get('two')!.proposal as any).asset.name, 'Save in flight');
  await f.close();
}
{
  const f = await fixture();
  const staleEnter = button(f.row('two'), 'Enter an asset').props.onClick;
  const staleDismiss = button(f.row('two'), 'Dismiss draft').props.onClick;
  await f.click(f.renderer.root, 'Prepare 2 drafts with AI');
  assert.ok(button(f.row('two'), 'Enter an asset').props.disabled);
  assert.ok(button(f.row('two'), 'Dismiss draft').props.disabled);
  await act(async () => { staleEnter(); staleDismiss(); });
  assert.equal(f.row('two').findAllByType('fieldset').length, 0, 'synchronous parent lock also fences stale handlers');
  assert.deepEqual(f.calls.map(value => value.action), ['analyze']);
  await f.click(f.renderer.root, 'Stop after this draft'); await f.finish('one');
  assert.match(text(f.renderer.toJSON()), /Preparation stopped/);
  assert.doesNotMatch(text(f.renderer.toJSON()), /Preparation finished/);
  assert.deepEqual(f.calls.map(value => value.id), ['one']);
  await f.click(f.row('two'), 'Enter an asset');
  assert.equal(f.row('two').findByType('fieldset').props.disabled, false, 'stopped rows unlock for review');
  await f.close();
}
{
  const f = await fixture();
  await f.click(f.renderer.root, 'Prepare 2 drafts with AI'); await f.finish('one', 401);
  assert.deepEqual(f.calls.map(value => value.id), ['one'], 'revoked account makes no second request');
  assert.match(text(f.renderer.toJSON()), /Preparation paused after an error/);
  assert.doesNotMatch(text(f.renderer.toJSON()), /Preparation finished/);
  assert.ok(!button(f.row('two'), 'Enter an asset').props.disabled);
  await f.close();
}
console.log('ImportPreparationInteraction.test.ts: actual panel/row events preserve dirty and in-flight reviews, lock queued rows, fence stale handlers, and report stop/auth halt without extra calls');
