import assert from 'node:assert/strict';
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

console.log('EmberNavigation.test.ts: all assertions passed');
