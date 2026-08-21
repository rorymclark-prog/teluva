import assert from 'node:assert/strict';
import { buildEmergencyPack } from './emergencyPack';
import type { FamilyMember } from '../types';

const member = {
  id: 'm1',
  name: 'Ben',
  role: 'Child',
  avatarColor: 'sage',
  avatarUrl: 'https://example.test/private-photo.jpg',
  birthdate: '2019-01-01',
  medical: { allergies: 'Peanuts', bloodGroup: 'O+' },
  documents: [{ id: 'secret-document' }],
} as FamilyMember;

const pack = buildEmergencyPack([member], 'AT', '2026-08-22T12:00:00.000Z');
assert.equal(pack.version, 1);
assert.equal(pack.savedAt, '2026-08-22T12:00:00.000Z');
assert.equal(pack.members[0].medical?.allergies, 'Peanuts');
assert.equal(pack.members[0].avatarUrl, undefined, 'remote photos are not promised offline');
assert.deepEqual(pack.members[0].documents, [], 'the emergency pack excludes unrelated documents');

console.log('emergencyPack.test.ts: all assertions passed');
