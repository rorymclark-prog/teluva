import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emberDestinationFor, emberDestinationLabel } from './EmberNavigation';
import { emberViewCopy } from './EmberViewHeader';

const cases = {
  pulse: 'pulse',
  profiles: 'profiles',
  timeline: 'profiles',
  emergency: 'profiles',
  calendar: 'calendar',
  recipes: 'calendar',
  travelTimeline: 'calendar',
  household: 'household',
  pets: 'household',
  vault: 'vault',
  finances: 'vault',
  willsEstate: 'vault',
} as const;

for (const [view, destination] of Object.entries(cases)) {
  assert.equal(emberDestinationFor(view), destination, `${view} should keep ${destination} selected`);
}

assert.equal(emberDestinationLabel('profiles', true), 'Team');
assert.equal(emberDestinationLabel('household', true), 'Operations');
assert.equal(emberDestinationLabel('household', false), 'House');
assert.equal(emberViewCopy('profiles', true).title, 'The team, at a glance.');
assert.ok(!JSON.stringify(emberViewCopy('calendar', true)).toLowerCase().includes('family'));
assert.ok(!JSON.stringify(emberViewCopy('timeline', true)).toLowerCase().includes('family'), 'the business timeline is the business story, not a family one');

// --- phone shell decisions (v292) ------------------------------------------
const nav = readFileSync('src/components/EmberNavigation.tsx', 'utf8');
const header = readFileSync('src/components/EmberViewHeader.tsx', 'utf8');
const dashboard = readFileSync('src/components/Dashboard.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

// The phone corner holds Capture and the assistant. Appearance is a set-once
// preference and lives in the hub menu instead.
assert.doesNotMatch(nav, /ember-appearance-mobile/, 'no floating Appearance pill');
assert.match(nav, /ember-sidebar-appearance/, 'desktop keeps Appearance in the sidebar');
assert.match(dashboard, /onClick=\{\(e\) => e\.stopPropagation\(\)\}>\n\s*<p className="mb-2 text-\[10px\] font-bold uppercase tracking-\[0\.14em\] text-ink-400">Appearance/,
  'picking a palette must not close the hub menu — it is now the only way in on a phone');

// The hero collapses on scroll rather than being shortened.
assert.match(header, /window\.addEventListener\('scroll', onScroll, \{ passive: true \}\)/);
assert.match(header, /t \? window\.scrollY > 48 : window\.scrollY > 120/, 'asymmetric thresholds stop it flapping');
assert.match(header, /\$\{tight \? ' is-tight' : ''\}/);
assert.match(css, /\.ember-view-heading \{\s*position: sticky;/, 'the collapsed hero pins under the top bar');
assert.match(css, /\.ember-view-heading\.is-tight \{[^}]*min-height: 0;/);
assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.ember-view-heading,/);

console.log('EmberNavigation.test.ts: all assertions passed');
