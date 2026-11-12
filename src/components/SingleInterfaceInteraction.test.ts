import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import React from 'react';

const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const root = resolve(import.meta.dirname, '../..');
const boot = /<script>([\s\S]*?)<\/script>/.exec(readFileSync(resolve(root, 'index.html'), 'utf8'))![1];
const bundle = await build({
  stdin: { contents: `export * from './src/contexts/AppearanceContext'; export {default as Controls} from './src/components/AppearanceControls';`, resolveDir: root },
  bundle: true, platform: 'node', packages: 'external', format: 'cjs', jsx: 'automatic', write: false,
});

async function fixture({ blocked = false, systemDark = false, theme = 'dark', compact = false } = {}) {
  const saved = new Map<string, string>([
    ['teluva.interface', 'classic'], ['teluva.theme', theme],
    ['teluva.firstJob', 'vault'], ['unrelated', 'keep'],
  ]);
  const storage = {
    getItem(key: string) { if (blocked) throw Error('Storage unavailable'); return saved.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw Error('Storage unavailable'); saved.set(key, value); },
    removeItem(key: string) { if (blocked) throw Error('Storage unavailable'); saved.delete(key); },
  };
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = systemDark;
  const win = new EventTarget() as any;
  win.location = new URL('https://example.test/?ui=classic&open=inbox&connector_space=household#review');
  win.matchMedia = () => media;
  const document = { documentElement: { dataset: {} as any, style: {} as any }, querySelector: () => null };
  const context: any = { require, module: { exports: {} }, console, process, setTimeout, clearTimeout, window: win, document, localStorage: storage, URL, URLSearchParams };
  context.exports = context.module.exports;
  runInNewContext(boot, context);
  assert.equal(document.documentElement.dataset.interface, 'ember', 'former Classic preference and link use the new interface before React paints');
  assert.equal(win.location.searchParams.get('open'), 'inbox', 'connector review deep links remain intact');
  assert.equal(win.location.searchParams.get('connector_space'), 'household');
  assert.equal(win.location.hash, '#review');
  if (!blocked) {
    assert.equal(saved.has('teluva.interface'), false, 'retire the old preference');
    assert.equal(saved.get('teluva.theme'), theme, 'migration preserves the selected theme');
    assert.equal(saved.get('teluva.firstJob'), 'vault', 'migration preserves onboarding destination');
    assert.equal(saved.get('unrelated'), 'keep');
  }
  runInNewContext(bundle.outputFiles[0].text, context);
  const { AppearanceProvider, Controls, useAppearance } = context.module.exports;
  let appearance: any;
  const Probe = () => { appearance = useAppearance(); return React.createElement(Controls, { compact }); };
  let renderer: any;
  await act(async () => { renderer = create(React.createElement(AppearanceProvider, null, React.createElement(Probe))); });
  assert.equal(document.documentElement.dataset.interface, 'ember', 'React keeps the same interface');
  assert.equal(renderer.root.findAllByType('button').length, 3, 'Appearance offers just System, Light and Dark');
  const choose = async (title: string) => act(async () => renderer.root.findAllByType('button').find((n: any) => n.props.title === title).props.onClick());
  return { saved, win, media, document, choose, appearance: () => appearance, close: async () => act(async () => renderer.unmount()) };
}

for (const compact of [false, true]) {
  const f = await fixture({ compact });
  assert.equal(f.document.documentElement.dataset.theme, 'dark');
  await f.choose('Light');
  assert.equal(f.document.documentElement.dataset.theme, 'light');
  assert.equal(f.saved.get('teluva.theme'), 'light');
  await f.choose('System');
  await act(async () => { f.media.matches = true; f.media.dispatchEvent(new Event('change')); });
  assert.equal(f.document.documentElement.dataset.theme, 'dark', 'System follows operating-system changes');
  const reviewed = new Event('teluva-reviewed-preferences');
  Object.assign(reviewed, { detail: { theme: 'light' } });
  await act(async () => f.win.dispatchEvent(reviewed));
  assert.equal(f.appearance().theme, 'light', 'approved connector theme changes still apply');
  assert.equal(f.document.documentElement.dataset.interface, 'ember');
  await f.close();
}
{
  const f = await fixture({ blocked: true, systemDark: true });
  await f.choose('Light');
  assert.equal(f.document.documentElement.dataset.theme, 'light', 'theme controls work without storage');
  assert.equal(f.document.documentElement.dataset.interface, 'ember');
  await f.close();
}
console.log('SingleInterfaceInteraction: legacy preference/link migration, deep links, both theme controls, system changes and restricted storage verified');
