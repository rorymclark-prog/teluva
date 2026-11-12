import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
const require = createRequire(import.meta.url), { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [resolve(import.meta.dirname, 'LifeAtlasMap.tsx')], bundle: true, platform: 'node', packages: 'external', format: 'cjs', jsx: 'automatic', write: false, loader: { '.css': 'empty' } });
const win = new EventTarget();
const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
const context: any = { require, module: { exports: {} }, console, process, window: win, requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: (id: number) => frames.delete(id) };
context.exports = context.module.exports; runInNewContext(bundle.outputFiles[0].text, context);
const Panel = context.module.exports.default;
// A real SVGPoint exposes x/y through prototype accessors. Object spread
// must NOT be used to copy it: it yields {}, causing the first orbit to be NaN.
const svgPoint = (x: number, y: number) => Object.create({ get x() { return x; }, get y() { return y; } });
assert.deepEqual({ ...svgPoint(10, 20) }, {}, 'fixture reproduces the DOM accessor behaviour');
const surface = { getScreenCTM: () => ({ a: 1, b: 0, inverse: () => ({}) }), createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return svgPoint(this.x, this.y); } }), setPointerCapture: () => { throw new Error('Synthetic unavailable capture'); } };
let renderer: any; const pins: [number, number][] = [];
await act(async () => { renderer = create(React.createElement(Panel, { entries: [], onSelect() {} }), { createNodeMock: (element: any) => element.type === 'svg' ? surface : null }); });
const globe = () => renderer.root.findAllByType('svg').find((node: any) => node.props['data-atlas-longitude'] !== undefined);
const down = async (id: number, x: number, y: number) => act(async () => globe().props.onPointerDown({ button: 0, pointerId: id, clientX: x, clientY: y, target: { closest: () => null }, currentTarget: surface, preventDefault() {} }));
const emit = async (type: string, id: number, x: number, y: number) => act(async () => {
  const event = new Event(type, { cancelable: true }); Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y }); win.dispatchEvent(event);
  for (const [key, callback] of [...frames]) { frames.delete(key); callback(0); }
});
await down(1, 100, 100); await emit('pointermove', 1, 140, 120); await emit('pointerup', 1, 140, 120);
assert.equal(globe().props['data-atlas-longitude'], 5);
assert.equal(globe().props['data-atlas-latitude'], 17);
await down(2, 100, 100); await emit('pointermove', 3, 500, 500);
assert.equal(globe().props['data-atlas-longitude'], 5, 'another finger cannot take over the orbit');
await emit('pointermove', 2, 155, 90); await emit('pointerup', 2, 155, 90);
assert.equal(globe().props['data-atlas-longitude'], -8.75);
assert.ok(Number.isFinite(globe().props['data-atlas-latitude']));
await act(async () => renderer.update(React.createElement(Panel, { entries: [], onSelect() {}, onPlacePin: (lat: number, lng: number) => pins.push([lat, lng]) })));
await down(4, 480, 280); await emit('pointerup', 4, 480, 280);
assert.equal(pins.length, 1); assert.ok(pins[0].every(Number.isFinite), 'a tap places a valid pin');
await down(5, 480, 280); await emit('pointermove', 5, 520, 300); await emit('pointerup', 5, 520, 300);
assert.equal(pins.length, 1, 'a drag never accidentally places a pin');
await act(async () => renderer.unmount());
assert.equal(frames.size, 0);
console.log('LifeAtlasMapInteraction: SVGPoint accessor regression, repeated touch-style orbit, missing capture, second-pointer exclusion, tap/drag placement and cleanup verified');
