import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timeline = readFileSync('src/components/TimelineView.tsx', 'utf8');
const memory = readFileSync('src/components/InMemoryView.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

assert.match(timeline, /emberMode && \(idx === 0/, 'year chapter markup must be gated by Ember mode');
assert.match(memory, /emberMode \? 'ember-memory-grid' : ''/, 'data-bearing memory layout must be gated by Ember mode');
assert.doesNotMatch(css, /^\.ember-story-chapter\s*\{/m, 'Story chapter CSS must not be global');
assert.doesNotMatch(css, /^\.ember-memory-grid\s*\{/m, 'In Memory grid CSS must not be global');
assert.match(css, /^\[data-interface="ember"\] \.ember-story-chapter/m);
assert.match(css, /^\[data-interface="ember"\] \.ember-memory-grid/m);

console.log('ClassicRollback.test.ts: all assertions passed');
