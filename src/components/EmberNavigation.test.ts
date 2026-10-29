import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emberDestinationFor, emberDestinationLabel } from './EmberNavigation';
import { emberViewCopy, nextEmberHeaderCollapsed } from './EmberViewHeader';

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
assert.match(header, /window\.addEventListener\('scroll', update, \{ passive: true \}\)/);
assert.match(header, /nextEmberHeaderCollapsed\(window\.scrollY, wasCollapsed\)/, 'asymmetric thresholds stop it flapping');
assert.match(header, /\$\{collapsed \? ' is-collapsed' : ''\}/);
assert.match(css, /\.ember-view-heading \{[^}]*position: sticky;/, 'the collapsed hero pins under the top bar');
assert.match(css, /\.ember-view-heading\.is-collapsed \{[^}]*min-height: 0;/);
assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.ember-view-heading,/);

assert.equal(nextEmberHeaderCollapsed(119, false), false, 'the full hero remains until the collapse threshold');
assert.equal(nextEmberHeaderCollapsed(120, false), true, 'the hero collapses at 120px');
assert.equal(nextEmberHeaderCollapsed(49, true), true, 'the collapsed hero stays stable above the expansion threshold');
assert.equal(nextEmberHeaderCollapsed(48, true), false, 'the hero expands again at 48px');

const navigationSource = readFileSync('src/components/EmberNavigation.tsx', 'utf8');
const dashboardSource = readFileSync('src/components/Dashboard.tsx', 'utf8');
assert.ok(!navigationSource.includes('ember-appearance-mobile'), 'mobile Appearance must not return as a floating control');
assert.match(
  dashboardSource,
  /<div className="px-3 py-2" onClick=\{\(e\) => e\.stopPropagation\(\)\}>[\s\S]*?<AppearanceControls compact \/>/,
  'Appearance changes in the hub menu must not close the menu',
);

console.log('EmberNavigation.test.ts: all assertions passed');
