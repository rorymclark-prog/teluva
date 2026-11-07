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
const componentSource = readFileSync(resolve(root, 'src/components/TextDocumentPreview.tsx'), 'utf8');
async function compilePreview(contents = componentSource) {
return build({ stdin: { contents, resolveDir: resolve(root, 'src/components'), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false,
  plugins: [{ name: 'synthetic-identity', setup(api) {
    api.onResolve({ filter: /(?:\/lib\/firebase|\/contexts\/FamilyContext|\/utils\/db$)/ }, () => ({ path: 'identity', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const auth = { get currentUser(){ return globalThis.__fixture.user; } };export const FAMILY_ID='example';export const useFamilyCtx=()=>globalThis.__fixture.ctx;` }));
  } }],
});
}
const bundle = await compilePreview();
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

type Transition = 'account' | 'role' | 'loading' | 'source' | 'version';
type Phase = 'token' | 'body' | 'displayed';
interface TokenCall { uid: string; value: string; released: boolean; release: () => void }
interface BodyCall { url: string; authorization: string; signal: AbortSignal; cancelled: boolean; controller?: ReadableStreamDefaultController<Uint8Array>; denied: boolean }
async function timingFixture(compiled = bundle) {
  const tokens: TokenCall[] = [], requests: BodyCall[] = [];
  const makeUser = (uid: string) => ({ uid, getIdToken: () => new Promise<string>(resolve => {
    const call: TokenCall = { uid, value: `synthetic-${uid}-${tokens.length}`, released: false, release: () => { call.released = true; resolve(call.value); } };
    tokens.push(call);
  }) });
  const state = { user: makeUser('first-account'), ctx: { uid: 'first-account', familyId: 'example', role: 'admin', loading: false } };
  const context = { require, module: { exports: {} as Record<string, any> }, exports: {} as Record<string, any>, console, __fixture: state, setTimeout, clearTimeout, AbortController, TextDecoder, TextEncoder, URL,
    fetch: async (url: string, options: RequestInit) => {
      const denied = state.ctx.role === 'member'; // This synthetic file is admin-only. The endpoint decides access.
      const call: BodyCall = { url, authorization: (options.headers as Record<string, string>).Authorization, signal: options.signal as AbortSignal, cancelled: false, denied };
      requests.push(call);
      if (denied) return new Response('Fixture private denial details must not render', { status: 403 });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { call.controller = controller; controller.enqueue(new TextEncoder().encode(call.authorization === `Bearer ${tokens[0].value}` ? 'STALE PRIVATE PARTIAL\n' : 'Current partial\n')); },
        cancel() { call.cancelled = true; },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/plain' } });
    },
  };
  context.exports = context.module.exports; runInNewContext(compiled.outputFiles[0].text, context);
  const Component = context.module.exports.default; let renderer: any;
  const initialProps = { ...props, version: 'first-version' };
  await act(async () => { renderer = create(React.createElement(Component, initialProps)); });
  const render = async (next: typeof initialProps) => { await act(async () => renderer.update(React.createElement(Component, next))); };
  const finishToken = async (index: number) => { assert.ok(tokens[index], `token ${index} exists`); await act(async () => tokens[index].release()); };
  const finishBody = async (index: number, value: string) => {
    const call = requests[index]; assert.ok(call?.controller, `stream ${index} exists`);
    await act(async () => {
      try { call.controller!.enqueue(new TextEncoder().encode(value)); call.controller!.close(); }
      catch (error) { if (!call.cancelled) throw error; } // Deliberately attempt a late write to the cancelled old stream.
    });
  };
  const pre = () => renderer.root.findAllByType('pre').map((node: any) => node.children.join(''));
  const dispose = async () => {
    await act(async () => { renderer.unmount(); tokens.filter(token => !token.released).forEach(token => token.release()); });
    // Also release deliberately broken in-memory mutation controls; no dangling
    // body readers or 15-second timers survive an expected assertion failure.
    await act(async () => { for (const request of requests) { try { request.controller?.error(new Error('Synthetic fixture cleanup')); } catch { /* already closed */ } } });
  };
  return { state, tokens, requests, initialProps, makeUser, render, finishToken, finishBody, pre, dispose, rendered: () => JSON.stringify(renderer.toJSON()) };
}

async function transitionCase(transition: Transition, phase: Phase, compiled = bundle) {
  const f = await timingFixture(compiled), label = `${transition}/${phase}`;
  try {
    assert.equal(f.tokens.length, 1);
    if (phase !== 'token') {
      await f.finishToken(0);
      assert.equal(f.requests.length, 1);
      if (phase === 'displayed') {
        await f.finishBody(0, 'OLD COMPLETE');
        assert.match(f.pre()[0], /OLD COMPLETE/, 'control: a completed file is visible before its scope changes');
      } else assert.deepEqual(f.pre(), [], `${label}: a partial old body must not render`);
    }
    let next = { ...f.initialProps };
    if (transition === 'account') { f.state.user = f.makeUser('second-account'); f.state.ctx = { ...f.state.ctx, uid: 'second-account' }; }
    if (transition === 'role') f.state.ctx = { ...f.state.ctx, role: 'member' };
    if (transition === 'loading') f.state.ctx = { ...f.state.ctx, loading: true };
    if (transition === 'source') next.source = '/api/files/content?path=families%2Fexample%2Fdocuments%2Fnew-source.txt';
    if (transition === 'version') next.version = 'second-version';
    await f.render(next);
    assert.deepEqual(f.pre(), [], `${label}: old text must be hidden immediately after transition`);
    if (phase === 'body') {
      assert.ok(f.requests[0].signal.aborted, `${label}: transition aborts the old body request`);
      assert.ok(f.requests[0].cancelled, `${label}: transition cancels the stream reader`);
      await f.finishBody(0, 'STALE PRIVATE FINAL');
    } else if (phase === 'token') {
      await f.finishToken(0);
      assert.equal(f.requests.length, 0, `${label}: an old token may not authorize a request`);
    }
    assert.deepEqual(f.pre(), [], `${label}: late old bytes never render`);
    if (transition === 'loading') {
      assert.equal(f.tokens.length, 1, `${label}: loading state may not request a token`);
      assert.equal(f.requests.length, phase === 'token' ? 0 : 1, `${label}: loading state may not fetch`);
      f.state.ctx = { ...f.state.ctx, loading: false }; await f.render(next);
    }
    assert.equal(f.tokens.length, 2, `${label}: the new view obtains its own token`);
    assert.equal(f.tokens[1].uid, transition === 'account' ? 'second-account' : 'first-account');
    await f.finishToken(1);
    const currentIndex = phase === 'token' ? 0 : 1;
    assert.equal(f.requests.length, currentIndex + 1, `${label}: exactly one current-view request`);
    const current = f.requests[currentIndex];
    assert.equal(current.authorization, `Bearer ${f.tokens[1].value}`, `${label}: current request uses current token`);
    assert.equal(current.url, next.source, `${label}: current request uses selected source`);
    assert.deepEqual(f.pre(), []);
    if (transition === 'role') {
      assert.ok(current.denied, 'the new role is re-authorized by the endpoint');
      assert.match(f.rendered(), /unavailable or you no longer have permission/);
      assert.doesNotMatch(f.rendered(), /Fixture private denial details|STALE PRIVATE/);
    } else {
      await f.finishBody(currentIndex, `CURRENT ${label}`);
      assert.equal(f.pre().length, 1);
      assert.match(f.pre()[0], /CURRENT/);
      assert.match(f.pre()[0], new RegExp(`CURRENT ${label}`));
    }
    assert.doesNotMatch(f.rendered(), /STALE PRIVATE/, `${label}: no old body in the current UI`);
  } finally { await f.dispose(); }
}

for (const transition of ['account', 'role', 'loading', 'source', 'version'] as const) {
  for (const phase of ['token', 'body', 'displayed'] as const) await transitionCase(transition, phase);
}

// Negative controls edit only an in-memory compiled copy, never product files.
// Removing cancellation must be caught by both the delayed-token and body tests.
const brokenCancellation = componentSource.replace('active = false; controller.abort();', 'active = false;');
assert.notEqual(brokenCancellation, componentSource);
const brokenBundle = await compilePreview(brokenCancellation);
await assert.rejects(transitionCase('version', 'token', brokenBundle), /old token may not authorize a request/);
await assert.rejects(transitionCase('version', 'body', brokenBundle), /transition aborts the old body request/);
console.log('TextDocumentPreview.test.ts: original escaping/close/space checks plus 10 delayed-token/body and 5 displayed-text account, role, loading, source and version transitions pass; two in-memory cancellation mutations fail as expected');
