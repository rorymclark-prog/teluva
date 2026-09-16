import assert from 'node:assert/strict';
import { pulseSpaceCopy, rankPulseDecisions, tripBannerCopy } from './FamilyPulse';
import type { FamilyMember } from '../types';
import type { Trip } from '../utils/trip';

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

// --- Travel banner ---------------------------------------------------------
//
// The banner speaks to two different people off the same trip. Getting the
// perspective backwards is the failure that matters: it would offer a parent
// at home a "your travel papers" button for a trip they are not on.

const ben = { id: 'ben', name: 'Ben Clark' } as FamilyMember;
const sibling = { id: 'sib', name: 'Ana Clark' } as FamilyMember;
const parent = { id: 'rory', name: 'Rory Clark' } as FamilyMember;
const roster = [ben, sibling, parent];

const trip = (over: Partial<Trip>): Trip => ({
  id: 't', title: 'Lisbon', startDate: '2026-09-04', endDate: '2026-09-15',
  destination: 'Lisbon, Portugal', memberIds: ['ben'], docs: [], hiddenDocIds: [],
  status: 'active', daysUntilStart: -2, daysUntilEnd: 6, lengthDays: 12, ...over,
});

{
  const mine = tripBannerCopy(trip({}), ben, roster);
  assert.equal(mine.viewerIsTravelling, true);
  assert.equal(mine.headline, 'You are in Lisbon, Portugal — home in 6 days.');
  assert.equal(mine.action, 'Your travel papers');
}

{
  const theirs = tripBannerCopy(trip({}), parent, roster);
  assert.equal(theirs.viewerIsTravelling, false, 'a parent not tagged on the trip is not travelling');
  assert.equal(theirs.headline, 'Ben is in Lisbon, Portugal — home in 6 days.',
    "someone else's trip leads with their name, not with 'you'");
  assert.equal(theirs.action, 'Open the travel pack');
}

{
  // An untagged trip belongs to everyone, so any viewer is on it.
  const shared = tripBannerCopy(trip({ memberIds: [] }), parent, roster);
  assert.equal(shared.viewerIsTravelling, true, 'a trip with nobody tagged is everyone\'s');
}

{
  // Nobody signed in / unresolvable profile — must not crash, must not say "you".
  const anon = tripBannerCopy(trip({}), null, roster);
  assert.equal(anon.viewerIsTravelling, false);
  assert.ok(anon.headline.startsWith('Ben'), 'with no resolved viewer, lead with the traveller');
}

{
  const two = tripBannerCopy(trip({ memberIds: ['ben', 'sib'] }), parent, roster);
  assert.equal(two.headline, 'Ben and Ana are in Lisbon, Portugal — home in 6 days.',
    'two travellers read as a pair and take a plural verb');
}

{
  const three = tripBannerCopy(trip({ memberIds: ['ben', 'sib', 'rory'] }), null, roster);
  assert.ok(three.headline.startsWith('Ben, Ana and Rory are'), 'three or more use a serial list');
}

// Day-boundary wording — these are the strings read on the days that matter.
assert.equal(tripBannerCopy(trip({ daysUntilEnd: 0 }), ben, roster).headline,
  'You are in Lisbon, Portugal — home today.');
assert.equal(tripBannerCopy(trip({ daysUntilEnd: 1 }), ben, roster).headline,
  'You are in Lisbon, Portugal — home tomorrow.');
// "leave FOR Lisbon" before departure, "are IN Lisbon" once there. Reusing one
// preposition for both read as though they had already arrived.
assert.equal(tripBannerCopy(trip({ status: 'upcoming', daysUntilStart: 0 }), ben, roster).headline,
  'You leave for Lisbon, Portugal today.');
assert.equal(tripBannerCopy(trip({ status: 'upcoming', daysUntilStart: 1 }), parent, roster).headline,
  'Ben leaves for Lisbon, Portugal tomorrow.');
assert.equal(tripBannerCopy(trip({ status: 'upcoming', daysUntilStart: 5, destination: undefined }), parent, roster).headline,
  'Ben leaves in 5 days.', 'no destination must not leave a dangling preposition');

// No destination must not produce a dangling "in ".
{
  const nowhere = tripBannerCopy(trip({ destination: undefined }), ben, roster);
  assert.equal(nowhere.headline, 'You are away — home in 6 days.');
  assert.ok(!nowhere.headline.includes('in  '), 'no double space where the destination would be');
}

console.log('FamilyPulse.test.ts: all assertions passed');
