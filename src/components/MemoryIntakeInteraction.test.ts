import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import React from 'react';
const require = createRequire(import.meta.url), { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const root = resolve(import.meta.dirname, '../..');
const bundle = await build({ entryPoints: [resolve(root, 'src/components/MemoryIntake.tsx')], bundle: true, platform: 'node', packages: 'external', format: 'cjs', jsx: 'automatic', write: false,
  plugins: [{ name: 'synthetic-memory-boundaries', setup(api) {
    api.onResolve({ filter: /(?:\/contexts\/FamilyContext|\/lib\/firebase|\/utils\/db$)/ }, () => ({ path: 'state', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const useFamilyCtx=()=>globalThis.__fixture.ctx;export const auth={get currentUser(){return {uid:globalThis.__fixture.ctx.uid,getIdToken:async()=> 'synthetic-only'};}};export const FAMILY_ID='fixture-family';` }));
  } }],
});
const text = (value: any): string => typeof value === 'string' ? value : (value?.children || []).map(text).join('');
async function fixture(consent = true) {
  const state = { ctx: { uid: 'fixture-user', familyId: 'fixture-family', role: 'admin', canWrite: true, aiConsent: consent, loading: false }, creates: [] as any[], requests: 0, pending: null as null | (() => void), defer: false, failAt: 0, adopted: [] as any[] };
  const context = { __fixture: state, require, module: { exports: {} as any }, exports: {} as any, console, process, setTimeout, clearTimeout, crypto: { randomUUID }, AbortSignal, Error, File, TextDecoder, Uint8Array, window: {},
    fetch: async (url: string, options: any) => {
      state.requests++; assert.match(url, /spaceId=fixture-family/); const body = JSON.parse(options.body);
      assert.equal(body.memoryReview, true); assert.equal(body.document, true);
      const response = () => new Response(JSON.stringify({ spaceId: 'fixture-family', rows: [
        { date: '', title: 'A first step', category: 'milestone', sourceText: 'Today Jamie took a first step!', memberIds: ['jamie'] },
        { date: '', title: 'Invented', category: 'memory', sourceText: 'Words not in the source' },
      ] }));
      return state.defer ? new Promise<Response>(resolve => { state.pending = () => resolve(response()); }) : response();
    },
  };
  context.exports = context.module.exports; runInNewContext(bundle.outputFiles[0].text, context);
  const Panel = context.module.exports.default;
  const props = { members: [{ id: 'jamie', name: 'Jamie' }], api: { create: async (input: any) => { state.creates.push(structuredClone(input)); if (state.failAt === state.creates.length) throw Error('Synthetic interruption'); return { item: { id: 'draft-one', proposal: input.proposal, status: 'pending' } }; } }, onItem: (item: any) => state.adopted.push(item) };
  let renderer: any; await act(async () => { renderer = create(React.createElement(Panel, props)); });
  const changeSource = async () => { const name = renderer.root.findAllByType('input').find((node: any) => node.props.placeholder === 'Maria WhatsApp export, or family email'); await act(async () => { name.props.onChange({ target: { value: 'Synthetic family chat' } }); renderer.root.findByType('textarea').props.onChange({ target: { value: '[03/02/2020] Today Jamie took a first step!' } }); }); };
  const button = () => renderer.root.findAllByType('button').find((node: any) => /Prepare up to 5|Retry remaining/.test(text(node)));
  const prepare = async () => { assert.equal(button().props.disabled, false); await act(async () => button().props.onClick()); };
  const close = async () => act(async () => renderer.unmount());
  return { state, renderer, changeSource, prepare, button, close, update: async () => act(async () => renderer.update(React.createElement(Panel, props))) };
}
{
  const f = await fixture(); await f.changeSource(); await f.prepare();
  assert.equal(f.state.requests, 1); assert.equal(f.state.creates.length, 1, 'an unsupported evidence excerpt is not queued');
  assert.equal(f.state.creates[0].proposal.kind, 'memory'); assert.equal(f.state.creates[0].proposal.memory.date, '');
  assert.equal(f.state.adopted[0].status, 'pending'); assert.match(text(f.renderer.toJSON()), /No timeline or Atlas record was saved/);
  await f.prepare(); assert.equal(f.state.creates.length, 1, 'a finished preparation is not resubmitted'); await f.close();
}
{
  const f = await fixture(); await f.changeSource(); f.state.failAt = 1; await f.prepare();
  assert.match(text(f.renderer.toJSON()), /Synthetic interruption/); f.state.failAt = 0; await f.prepare();
  assert.equal(f.state.requests, 1, 'retry does not invoke AI again'); assert.equal(f.state.creates[0].requestId, f.state.creates[1].requestId); await f.close();
}
{
  const f = await fixture(); await f.changeSource(); f.state.defer = true; await f.prepare();
  f.state.ctx = { ...f.state.ctx, uid: 'other-user' }; await f.update(); await act(async () => f.state.pending!());
  assert.equal(f.state.creates.length, 0, 'a late model response cannot write to another account'); await f.close();
}
{
  const f = await fixture(false); await f.changeSource(); assert.equal(f.button().props.disabled, true); assert.equal(f.state.requests, 0); await f.close();
}
console.log('MemoryIntakeInteraction: actual source/AI/review handlers preserve evidence, pending-only writes, retry keys and account/consent fences');
