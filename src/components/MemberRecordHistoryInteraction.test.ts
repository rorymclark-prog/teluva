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
const bundle = await build({ entryPoints: [resolve(root, 'src/components/MemberRecordHistory.tsx')], bundle: true, platform: 'node', packages: 'external', format: 'cjs', jsx: 'automatic', write: false,
  plugins: [{ name: 'history-context', setup(api) { api.onResolve({ filter: /\/contexts\/FamilyContext/ }, () => ({ path: 'ctx', namespace: 'fixture' })); api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useFamilyCtx=()=>globalThis.__fixture.ctx;' })); } }],
});
const text = (value: any): string => typeof value === 'string' ? value : (value?.children || []).map(text).join('');
async function fixture(editable = true) {
  const state = { ctx: { uid: 'user-a', familyId: 'family-a', role: 'admin' }, updates: [] as any[], pending: null as null | ((text: string) => void), fail: false };
  const context: any = { __fixture: state, require, module: { exports: {} }, console, process, setTimeout, clearTimeout, crypto: { randomUUID }, TextEncoder, URL, Error };
  context.exports = context.module.exports; runInNewContext(bundle.outputFiles[0].text, context);
  const Panel = context.module.exports.default;
  const member = { id: 'jamie', name: 'Jamie Example', phone: 'keep-current', identity: { medicalAidNumber: 'keep-current-aid' }, recordHistory: [] };
  const props = { member, canEdit: editable, onUpdate: async (patch: any) => { state.updates.push(patch); if (state.fail) throw Error('Synthetic cloud failure'); } };
  let renderer: any; await act(async () => { renderer = create(React.createElement(Panel, props)); });
  const fileInput = () => renderer.root.findAllByType('input').find((node: any) => node.props.type === 'file');
  const json = JSON.stringify({ version: 1, personName: member.name, records: [{ kind: 'phone', value: 'synthetic-1234', status: 'previous', sourceName: 'Synthetic export', evidenceQuote: 'Phone synthetic-1234' }] });
  const choose = async (deferred = false) => act(async () => fileInput().props.onChange({ target: { files: [{ size: json.length, text: () => deferred ? new Promise<string>(resolve => { state.pending = resolve; }) : Promise.resolve(json) }], value: 'chosen' } }));
  const save = async () => act(async () => renderer.root.findAllByType('button').find((node: any) => text(node) === 'Save reviewed history').props.onClick());
  return { state, renderer, member, props, choose, json, save, close: async () => act(async () => renderer.unmount()), update: async () => act(async () => renderer.update(React.createElement(Panel, props))) };
}
{
  const f = await fixture(); await f.choose(); assert.equal(f.state.updates.length, 0, 'choosing a file never saves'); await f.save();
  assert.equal(Object.keys(f.state.updates[0]).join(), 'recordHistory', 'history import cannot overwrite current phone or insurance'); assert.equal(f.state.updates[0].recordHistory.length, 1); await f.close();
}
{
  const f = await fixture(); await f.choose(); f.state.fail = true; await f.save(); assert.match(text(f.renderer.toJSON()), /Synthetic cloud failure/); assert.match(text(f.renderer.toJSON()), /Save reviewed history/); f.state.fail = false; await f.save(); assert.equal(f.state.updates[0].recordHistory[0].id, f.state.updates[1].recordHistory[0].id, 'retry keeps the reviewed identifiers'); await f.close();
}
{
  const f = await fixture(); await f.choose(true); f.state.ctx = { ...f.state.ctx, familyId: 'family-b' }; await f.update(); await act(async () => f.state.pending!(f.json)); assert.equal(f.state.updates.length, 0); assert.doesNotMatch(text(f.renderer.toJSON()), /Review 1 suggested/); await f.close();
}
{
  const f = await fixture(false); assert.doesNotMatch(text(f.renderer.toJSON()), /Add previous record|Review connector records/); await f.close();
}
console.log('MemberRecordHistoryInteraction: review-only intake, current-field preservation, failed-save retry and space-change fencing verified');
