import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url), { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const root = resolve(import.meta.dirname, '../..');
const bundle = await build({ stdin: { contents: readFileSync(resolve(root, 'src/components/TextDocumentPreview.tsx'), 'utf8'), resolveDir: resolve(root, 'src/components'), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false,
  plugins: [{ name: 'synthetic-identity', setup(api) {
    api.onResolve({ filter: /(?:\/lib\/firebase|\/contexts\/FamilyContext|\/utils\/db$)/ }, () => ({ path: 'identity', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const auth = { get currentUser(){ return globalThis.__fixture.user; } };export const FAMILY_ID='example';export const useFamilyCtx=()=>globalThis.__fixture.ctx;` }));
  } }],
});
const raw = '<script>window.unwanted=true</script>\n<img onerror="alert(1)">\nSynthetic receipt €49';
const props = { source: '/api/files/content?path=families%2Fexample%2Fdocuments%2Freceipt.txt', name: 'Synthetic receipt', size: 100 };
async function fixture(deferred = false) {
  const state = { user: { uid: 'synthetic', getIdToken: async () => 'synthetic-token' }, ctx: { uid: 'synthetic', familyId: 'example', role: 'admin', loading: false } };
  let signal: AbortSignal | undefined, release: (() => void) | undefined;
  const context = { require, module: { exports: {} as Record<string, any> }, exports: {} as Record<string, any>, console, __fixture: state, setTimeout, clearTimeout, AbortController, TextDecoder, TextEncoder, URL,
    fetch: async (_url: string, options: RequestInit) => { signal = options.signal as AbortSignal; if (deferred) await new Promise<void>(resolve => { release = resolve; }); return new Response(raw, { headers: { 'Content-Type': 'text/plain' } }); },
  };
  context.exports = context.module.exports; runInNewContext(bundle.outputFiles[0].text, context);
  const Component = context.module.exports.default; let renderer: any;
  await act(async () => { renderer = create(React.createElement(Component, props)); });
  return { renderer, Component, state, signal: () => signal, release: () => release?.() };
}
{
  const f = await fixture();
  const pre = f.renderer.root.findByType('pre'); assert.equal(pre.children.join(''), raw);
  assert.equal(f.renderer.root.findAllByType('script').length, 0); assert.equal(f.renderer.root.findAllByType('img').length, 0);
  const html = renderToStaticMarkup(React.createElement('pre', pre.props));
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<img/);
  await act(async () => f.renderer.unmount());
}
{
  const f = await fixture(true);
  assert.equal(f.renderer.root.findAllByType('pre').length, 0);
  f.state.ctx = { ...f.state.ctx, familyId: 'other' };
  await act(async () => f.renderer.update(React.createElement(f.Component, props)));
  assert.ok(f.signal()?.aborted, 'scope cleanup aborts the old protected read');
  await act(async () => f.release());
  assert.equal(f.renderer.root.findAllByType('pre').length, 0, 'late previous-space text never renders');
  await act(async () => f.renderer.unmount());
}
{
  const f = await fixture(true);
  await act(async () => f.renderer.unmount());
  assert.ok(f.signal()?.aborted, 'closing the viewer cancels the read');
  await act(async () => f.release());
}
console.log('TextDocumentPreview.test.ts: actual hooks render markup as inert escaped text, cancel on close/scope change and never render a late prior-space result');
