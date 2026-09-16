import assert from 'node:assert/strict';
import { isMe, resolveMe } from './me';
import type { FamilyMember } from '../types';

const m = (over: Partial<FamilyMember> & { id: string }): FamilyMember =>
  ({ name: over.id, role: 'Child', avatarColor: 'sage', ...over }) as FamilyMember;

const ben = m({ id: 'ben', email: 'Ben@Example.com ', linkedUid: 'uid-ben' });
const rory = m({ id: 'rory', email: 'rory@example.com' });
const noContact = m({ id: 'nobody' });

// linkedUid wins outright.
assert.deepEqual(resolveMe([ben, rory], 'uid-ben', 'rory@example.com'), { member: ben, via: 'linked' },
  'an explicit link beats a conflicting email');

// Email fallback, case-insensitive and trimmed, for families predating linkedUid.
assert.deepEqual(resolveMe([ben, rory], 'unknown-uid', '  BEN@example.com'), { member: ben, via: 'email' },
  'email match is trimmed and case-insensitive');

// Ambiguity resolves to nobody, never to a guess.
{
  const twinA = m({ id: 'a', email: 'shared@example.com' });
  const twinB = m({ id: 'b', email: 'shared@example.com' });
  assert.deepEqual(resolveMe([twinA, twinB], null, 'shared@example.com'), { member: null, via: 'none' },
    'a shared email matches nobody — a wrong "you" is worse than no "you"');
}

{
  const dupA = m({ id: 'a', linkedUid: 'same' });
  const dupB = m({ id: 'b', linkedUid: 'same' });
  assert.deepEqual(resolveMe([dupA, dupB], 'same', undefined), { member: null, via: 'none' },
    'two profiles claiming one uid is a data error, not a tie to break');
}

// Nothing to go on.
assert.deepEqual(resolveMe([ben, rory], null, null), { member: null, via: 'none' });
assert.deepEqual(resolveMe([], 'uid-ben', 'ben@example.com'), { member: null, via: 'none' });
assert.deepEqual(resolveMe([noContact], 'uid-x', 'x@example.com'), { member: null, via: 'none' },
  'a profile with neither link nor email is never matched');

// An empty-string email must not match a profile with no email.
assert.deepEqual(resolveMe([noContact], null, '   '), { member: null, via: 'none' });

// isMe
assert.equal(isMe(ben, ben), true);
assert.equal(isMe(rory, ben), false);
assert.equal(isMe(ben, null), false);

console.log('me.test.ts: all assertions passed');
