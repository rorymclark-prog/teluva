import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timeline = readFileSync('src/components/TimelineView.tsx', 'utf8');
const memory = readFileSync('src/components/InMemoryView.tsx', 'utf8');
const emergency = readFileSync('src/components/EmergencyView.tsx', 'utf8');
const dashboard = readFileSync('src/components/Dashboard.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

assert.match(timeline, /emberMode && \(idx === 0/, 'year chapter markup must be gated by Ember mode');
assert.match(memory, /emberMode \? 'ember-memory-grid' : ''/, 'data-bearing memory layout must be gated by Ember mode');
assert.doesNotMatch(css, /^\.ember-story-chapter\s*\{/m, 'Story chapter CSS must not be global');
assert.doesNotMatch(css, /^\.ember-memory-grid\s*\{/m, 'In Memory grid CSS must not be global');
assert.match(css, /^\[data-interface="ember"\] \.ember-story-chapter/m);
assert.match(css, /^\[data-interface="ember"\] \.ember-memory-grid/m);
assert.match(emergency, /\(emberMode \|\| packMode\) && members\.length > 0/, 'Emergency actions must not leak into Classic');
assert.match(emergency, /!emberMode && !packMode && <div className="card p-5 sm:p-6">/, 'Classic Emergency must retain its original header');
assert.match(dashboard, /const emergencyFocus = emberInterface && mainView === 'emergency'/, 'full-screen Emergency must remain Ember-only');

console.log('ClassicRollback.test.ts: all assertions passed');
