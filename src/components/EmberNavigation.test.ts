import assert from 'node:assert/strict';
import { emberDestinationFor } from './EmberNavigation';

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

console.log('EmberNavigation.test.ts: all assertions passed');
