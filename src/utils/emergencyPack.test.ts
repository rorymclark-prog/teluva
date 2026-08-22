import assert from 'node:assert/strict';
import {
  activateEmergencyPackScope,
  buildEmergencyPack,
  isEmergencyPackOfflineReady,
  loadEmergencyPack,
  saveEmergencyPack,
} from './emergencyPack';
import type { FamilyMember } from '../types';

const member = {
  id: 'm1',
  name: 'Ben',
  nickname: 'B',
  role: 'Child',
  avatarColor: 'sage',
  avatarUrl: 'https://example.test/private-photo.jpg',
  birthdate: '2019-01-01',
  medical: {
    bloodGroup: 'O+', allergies: 'Peanuts', medications: 'EpiPen', conditions: 'Asthma',
    emergencyMedication: 'Blue inhaler', organDonor: false,
    vaccinations: [{ id: 'v1', name: 'Hidden' }], surgeries: 'Hidden', familyHistory: 'Hidden',
    preferredPharmacy: 'Hidden', notes: 'Hidden',
  },
  identity: {
    svNumber: 'shown-sv', eCardNumber: 'shown-ecard', taxNumber: 'Hidden', studentNumber: 'Hidden',
    schoolRegNumber: 'Hidden', residencePermitNumber: 'Hidden', residencePermitExpiry: 'Hidden',
    nationalIdNumber: 'Hidden', idDocumentType: 'Hidden', birthCertNumber: 'Hidden',
    medicalAidNumber: 'Hidden', medicalAidScheme: 'Hidden', medicalAidPlanOption: 'Hidden',
    medicalAidDependantCode: 'Hidden', insuranceGroupNumber: 'Hidden', registeredGpPractice: 'Hidden',
    citizenshipCertNumber: 'Hidden', driversLicenseNumber: 'Hidden', driversLicenseExpiry: 'Hidden', notes: 'Hidden',
  },
  documents: [{ id: 'secret-document' }],
  clothingSizes: { shoe: 'Hidden' },
} as unknown as FamilyMember;

const scope = { ownerUid: 'account-a', spaceId: 'family-a', spaceName: 'Clark family' };
const pack = buildEmergencyPack([member], 'AT', scope, '2026-08-22T12:00:00.000Z');
assert.equal(pack.version, 2);
assert.equal(pack.savedAt, '2026-08-22T12:00:00.000Z');
assert.deepEqual(
  JSON.parse(JSON.stringify(pack.members[0].medical)),
  { bloodGroup: 'O+', allergies: 'Peanuts', medications: 'EpiPen', conditions: 'Asthma', emergencyMedication: 'Blue inhaler', organDonor: false },
  'only medical facts rendered on the Emergency card may be persisted',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(pack.members[0].identity)),
  { svNumber: 'shown-sv', eCardNumber: 'shown-ecard' },
  'only identity facts rendered on the Emergency card may be persisted',
);
assert.equal(pack.members[0].nickname, undefined);
assert.equal(pack.members[0].avatarUrl, undefined, 'remote photos are not promised offline');
assert.deepEqual(pack.members[0].documents, [], 'the emergency pack excludes unrelated documents');
assert.deepEqual(pack.members[0].clothingSizes, {}, 'the emergency pack excludes unrelated clothing data');
assert.equal(pack.ownerUid, scope.ownerUid);
assert.equal(pack.spaceId, scope.spaceId);
assert.equal(pack.spaceName, scope.spaceName);
assert.equal(isEmergencyPackOfflineReady(pack), false, 'saved data alone must not claim cold-offline readiness');
assert.equal(isEmergencyPackOfflineReady({ ...pack, shellVerifiedAt: '2026-08-22T12:01:00.000Z', shellVersion: 'v253' }), true);
assert.equal(isEmergencyPackOfflineReady({ ...pack, shellVerifiedAt: '2026-08-22T12:01:00.000Z', shellVersion: 'old' }), false);

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  },
});
saveEmergencyPack([member], 'AT', scope);
assert.equal(loadEmergencyPack(scope)?.members[0].name, 'Ben');
const otherSpace = { ownerUid: 'account-a', spaceId: 'family-b', spaceName: 'Other family' };
assert.equal(loadEmergencyPack(otherSpace), null, 'one family space must never read another space\'s pack');
const otherAccount = { ownerUid: 'account-b', spaceId: 'family-a', spaceName: 'Clark family' };
assert.equal(loadEmergencyPack(otherAccount), null, 'one account must never read another account\'s pack');
activateEmergencyPackScope(otherSpace);
assert.equal(loadEmergencyPack(), null, 'the device route follows the active account/space, not the last pack saved');

console.log('emergencyPack.test.ts: all assertions passed');
