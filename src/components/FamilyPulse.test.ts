import assert from 'node:assert/strict';
import { pulseSpaceCopy, rankPulseDecisions } from './FamilyPulse';

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

const family = pulseSpaceCopy(false);
const business = pulseSpaceCopy(true);
assert.equal(family.emptyTitle, 'Start your family story.');
assert.equal(business.emptyTitle, 'Build your team.');
assert.equal(business.emptyAction, 'Add your first team member');
assert.ok(!JSON.stringify(business).toLowerCase().includes('family'), 'business Pulse copy must not leak family language');

console.log('FamilyPulse.test.ts: all assertions passed');
