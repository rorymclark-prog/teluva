import assert from 'node:assert/strict';
import { rankPulseDecisions } from './FamilyPulse';

const ranked = rankPulseDecisions([
  { id: 'passport-nine-months', dueInDays: 270 },
  { id: 'appointment-tomorrow', dueInDays: 1 },
  { id: 'expired-id', dueInDays: -1 },
  { id: 'school-next-week', dueInDays: 7 },
]);

assert.deepEqual(
  ranked.map(item => item.id),
  ['expired-id', 'appointment-tomorrow', 'school-next-week'],
  'the three decision slots should be chronological across record types',
);
assert.equal(ranked.length, 3);

console.log('FamilyPulse.test.ts: all assertions passed');
