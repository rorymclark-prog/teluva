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
const bundle = await build({ entryPoints: [resolve(root, 'src/components/LifeAtlasView.tsx')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false,
  plugins: [{ name: 'synthetic-atlas-boundaries', setup(api) {
    api.onResolve({ filter: /(?:\/contexts\/FamilyContext|\/lib\/firebase|\/utils\/db$|\/hooks\/useSharedDoc$|\/utils\/atlasCover$|\/utils\/photosAuthorization$|\/utils\/googlePhotosPicker$|^\.\/(?:LifeAtlasMap|ImageLightbox)$)/ }, () => ({ path: 'boundaries', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root, contents: `
      import React from 'react';
      const state = () => globalThis.__fixture;
      export const useFamilyCtx = () => state().ctx;
      export const auth = { get currentUser() { return { uid: state().ctx.uid }; } };
      export const FAMILY_ID = 'synthetic-family';
      export const loadTravelTimeline = async () => { state().loads++; return state().doc; };
      export const saveTravelTimeline = async (next, base) => { state().saves.push({ next, base }); if (!state().saveOK) return false; state().doc = next; return true; };
      export const uploadTravelPhoto = async (_, id, options) => { options.scope.check(); state().uploads++; await state().uploadWait; options.scope.check(); return { storagePath: 'fixture/' + id, downloadUrl: '/fixture-cover.jpg' }; };
      export const useSharedDoc = () => false;
      export const createAtlasCover = async () => { state().coverOrder.push('cover'); return 'data:image/jpeg;base64,Zml4dHVyZQ=='; };
      export const preparePhotosAuthorization = async () => true;
      export const authorizePhotos = async () => 'synthetic-token';
      export const pickGooglePhotos = async options => { state().google++; await state().googleWait; options.scope.check(); return [{ file: new File(['synthetic'], 'Holiday.jpg', { type: 'image/jpeg' }), captureTime: '2020-02-03T12:00:00Z' }]; };
      export default function Boundary(props) { return React.createElement('section', { 'data-map': true }, props.onPlacePin ? React.createElement('button', { onClick: () => props.onPlacePin(48.2,16.37) }, 'Synthetic map pin') : null); }
    ` }));
  } }],
});
const text = (value: any): string => typeof value === 'string' ? value : (value?.children || []).map(text).join('');
async function fixture(role = 'admin', business = false) {
  const state = { ctx: { uid: 'synthetic-user', familyId: 'synthetic-family', role, canWrite: role === 'admin', loading: false, spaces: [{ id: 'synthetic-family', type: business ? 'business' : 'family' }] },
    doc: { entries: [{ id: 'legacy', country: 'Austria', place: 'First home', date: '2010-01-01', source: 'manual', memberIds: ['child'] }] }, saves: [] as any[], coverOrder: [] as string[], uploads: 0, loads: 0, google: 0, saveOK: true, uploadWait: undefined as any, googleWait: undefined as any };
  const context = { __fixture: state, require, module: { exports: {} as any }, exports: {} as any, console, process, setTimeout, clearTimeout, crypto: { randomUUID }, structuredClone, AbortController, URLSearchParams, File, Uint8Array, window: {} };
  context.exports = context.module.exports; runInNewContext(bundle.outputFiles[0].text, context);
  const Panel = context.module.exports.default; let renderer: any;
  await act(async () => { renderer = create(React.createElement(Panel, { members: [{ id: 'child', name: 'Fixture Child' }] })); });
  const button = (label: string) => renderer.root.findAllByType('button').find((value: any) => text(value) === label);
  const click = async (label: string) => { const target = button(label); assert.ok(target, label); assert.ok(!target.props.disabled, label + ' is enabled'); await act(async () => { target.props.onClick(); }); };
  const change = async (label: string, value: string) => { const parent = renderer.root.findAllByType('label').find((node: any) => text(node).startsWith(label)); assert.ok(parent, label); const input = parent.findAllByType('input')[0]; await act(async () => input.props.onChange({ target: { value } })); };
  const close = async () => act(async () => renderer.unmount());
  return { state, renderer, button, click, change, close, Panel };
}
{
  const f = await fixture();
  assert.equal(f.state.saves.length, 0); assert.match(text(f.renderer.toJSON()), /First home/);
  await f.click('Add a place'); await f.change('Memory title', 'A family holiday');
  await f.click('Choose a pin on the map above'); await f.click('Synthetic map pin');
  await f.click('Save memory');
  assert.equal(f.state.saves.length, 1); const call = f.state.saves[0];
  assert.equal(call.base.entries.length, 1, 'explicit original merge base is passed');
  assert.equal(call.next.entries.length, 2); const saved = call.next.entries[1];
  assert.equal(saved.title, 'A family holiday'); assert.equal(saved.date, '', 'unknown dates are not today'); assert.equal(saved.lat, 48.2);
  await f.close();
}
{
  const f = await fixture(); await f.click('Connect Google Photos');
  assert.equal(f.state.google, 1); assert.equal(f.state.uploads, 0); assert.equal(f.state.saves.length, 0, 'Google selection only prepares a review');
  assert.match(text(f.renderer.toJSON()), /Choose the memories to keep/);
  f.state.saveOK = false; await f.click('Save 1 selected memory');
  assert.equal(f.state.uploads, 1); assert.match(text(f.renderer.toJSON()), /Cloud saving was not confirmed/);
  assert.match(text(f.renderer.toJSON()), /Choose the memories to keep/, 'keep the review on a failed save');
  f.state.saveOK = true; await f.click('Save 1 selected memory');
  assert.equal(f.state.uploads, 1, 'retry reuses its successfully protected cover');
  const saved = f.state.doc.entries.find((entry: any) => entry.id !== 'legacy') as any;
  assert.equal(saved.date, '2020-02-03'); assert.equal(saved.lat, undefined); assert.equal(saved.country, '', 'Google imports never invent GPS/country');
  assert.doesNotMatch(text(f.renderer.toJSON()), /Choose the memories to keep/);
  await f.close();
}
{
  const f = await fixture('child');
  assert.equal(f.button('Add a place'), undefined); assert.equal(f.button('Connect Google Photos'), undefined); assert.equal(f.state.saves.length, 0);
  await f.close();
}
{
  const f = await fixture('admin', true);
  assert.match(text(f.renderer.toJSON()), /Open your family space/); assert.equal(f.state.loads, 0); assert.equal(f.state.google, 0);
  await f.close();
}
{
  const f = await fixture(); let finish!: () => void;
  f.state.googleWait = new Promise<void>(resolve => { finish = resolve; }); await f.click('Connect Google Photos');
  f.state.ctx = { ...f.state.ctx, uid: 'different-user' };
  await act(async () => f.renderer.update(React.createElement(f.Panel, { members: [] })));
  await act(async () => finish());
  assert.equal(f.state.uploads, 0); assert.equal(f.state.saves.length, 0); assert.doesNotMatch(text(f.renderer.toJSON()), /Choose the memories to keep/);
  await f.close();
}
console.log('LifeAtlasInteraction: actual review handlers, explicit save, failed-save retry, permissions and account switch passed');

{
  const f = await fixture(); await f.click('Add a place'); await f.change('Memory title', 'An older family memory'); await f.change('Start / capture date', '2000-01-02');
  await f.click('Choose a cover photo');
  const file = new File(['synthetic original'], 'cover.jpg', { type: 'image/jpeg' });
  const read = file.arrayBuffer.bind(file); file.arrayBuffer = async () => { f.state.coverOrder.push('metadata'); return read(); };
  const input = f.renderer.root.findAllByType('input').find((node: any) => node.props.type === 'file' && !node.props.multiple);
  await act(async () => input.props.onChange({ target: { files: [file], value: '' } }));
  assert.deepEqual(f.state.coverOrder, ['metadata', 'cover']); assert.equal(f.state.uploads, 0); assert.equal(f.state.saves.length, 0, 'choosing a cover does not save or create a second memory');
  await f.click('Save memory'); const saved = f.state.doc.entries.find((entry: any) => entry.id !== 'legacy') as any;
  assert.equal(saved.title, 'An older family memory'); assert.equal(saved.date, '2000-01-02'); assert.equal(saved.photoUrl, '/fixture-cover.jpg'); assert.equal(f.state.doc.entries.length, 2);
  await f.close();
}

{
  const f = await fixture(); await f.click('Individuals');
  assert.doesNotMatch(text(f.renderer.toJSON()), /First home/, 'no selected people does not silently show the whole family');
  const label = f.renderer.root.findAllByType('label').find((node: any) => text(node) === 'Fixture Child');
  await act(async () => label.findByType('input').props.onChange({ target: { checked: true } }));
  assert.match(text(f.renderer.toJSON()), /First home/);
  await f.click('Whole family'); assert.match(text(f.renderer.toJSON()), /First home/);
  assert.equal(f.state.saves.length, 0, 'view toggles never rewrite people or memories'); await f.close();
}
