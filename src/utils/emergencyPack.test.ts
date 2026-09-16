import assert from 'node:assert/strict';
import {
  activateEmergencyPackScope,
  buildEmergencyPack,
  isEmergencyPackOfflineReady,
  loadEmergencyPack,
  packAgeDays,
  packExpired,
  packExpiryTime,
  PACK_EXPIRY_DAYS,
  refreshEmergencyPack,
  removeEmergencyPack,
  saveEmergencyPack,
} from './emergencyPack';
import type { EmergencyPack } from './emergencyPack';
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
assert.equal(isEmergencyPackOfflineReady({ ...pack, shellVerifiedAt: '2026-08-22T12:01:00.000Z', shellVersion: 'v254' }), true);
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

// --- Expiry (design-audit P0: the plaintext device copy must not live forever)
const DAY = 24 * 60 * 60 * 1000;
const freshPack = saveEmergencyPack([member], 'AT', scope);
assert.equal(typeof freshPack.expiresAt, 'string', 'every new pack carries an explicit expiry');
assert.equal(
  packExpiryTime(freshPack),
  Date.parse(freshPack.savedAt) + PACK_EXPIRY_DAYS * DAY,
  'expiry is PACK_EXPIRY_DAYS after the save',
);
const justBefore = packExpiryTime(freshPack) - 1;
assert.equal(loadEmergencyPack(scope, justBefore)?.members[0].name, 'Ben', 'one ms before expiry the pack still serves');
assert.equal(loadEmergencyPack(scope, packExpiryTime(freshPack)), null, 'at expiry the pack stops serving');
assert.equal(loadEmergencyPack(scope, justBefore), null, 'expiry DELETED the stored copy — it must not linger unreachable');

// A pack saved before expiry existed (no expiresAt) derives its fuse from savedAt.
const legacy = buildEmergencyPack([member], 'AT', scope, '2026-08-01T00:00:00.000Z');
delete (legacy as Partial<EmergencyPack>).expiresAt;
assert.equal(
  packExpiryTime(legacy),
  Date.parse('2026-08-01T00:00:00.000Z') + PACK_EXPIRY_DAYS * DAY,
  'pre-expiry packs are not immortal — savedAt supplies the fuse',
);
assert.equal(packExpired(legacy, Date.parse('2026-08-01T00:00:00.000Z') + 61 * DAY), true);
assert.equal(packAgeDays(legacy, Date.parse('2026-08-03T12:00:00.000Z')), 2, 'age counts whole days');

// --- Refresh keeps consent-time verification but re-stamps data + expiry.
const again = saveEmergencyPack([member], 'AT', scope);
// Backdate the stored copy a week (as a real device's pack would be) so the
// refresh's forward-moving expiry is observable.
const weekAgo = new Date(Date.now() - 7 * DAY);
const verifiedAgain = {
  ...again,
  savedAt: weekAgo.toISOString(),
  expiresAt: new Date(weekAgo.getTime() + PACK_EXPIRY_DAYS * DAY).toISOString(),
  shellVerifiedAt: '2026-08-22T12:01:00.000Z',
  shellVersion: 'v254',
};
localStorage.setItem(`teluva.emergencyPack.v2:${encodeURIComponent(scope.ownerUid)}:${encodeURIComponent(scope.spaceId)}`, JSON.stringify(verifiedAgain));
const renamed = { ...member, name: 'Benjamin' };
const refreshed = refreshEmergencyPack([renamed], 'AT', scope);
assert.equal(refreshed?.members[0].name, 'Benjamin', 'refresh carries the CURRENT data');
assert.equal(refreshed?.shellVerifiedAt, '2026-08-22T12:01:00.000Z', 'refresh must not drop shell verification');
assert.ok(packExpiryTime(refreshed!) > packExpiryTime(verifiedAgain), 'refresh pushes the expiry out');
removeEmergencyPack(scope);
assert.equal(refreshEmergencyPack([renamed], 'AT', scope), null, 'refresh never CREATES a pack — consent lives at the first save');

console.log('emergencyPack.test.ts: all assertions passed');
