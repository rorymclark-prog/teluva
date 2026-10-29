// Real Storage rules engine probe. Direct SDK access must fail for every client;
// the server gateway supplies the current-role authorization tested separately.
// Fixture-only emulator: npm run test:storage-rules.
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'rules-probe',
  storage: { rules: readFileSync(new URL('./storage.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9199 },
});
const path = 'families/household/documents/fixture/file.pdf';
const bytes = new Uint8Array([70, 73, 88, 84, 85, 82, 69]);
await env.withSecurityRulesDisabled(async context => { await uploadBytes(ref(context.storage(), path), bytes); });
const identities = [
  ['admin with current claims', 'u-admin', { email_verified: true, familyId: 'household', familyIds: ['household'], role: 'admin' }],
  ['member with current claims', 'u-member', { email_verified: true, familyId: 'household', familyIds: ['household'], role: 'member' }],
  ['child with current claims', 'u-child', { email_verified: true, familyId: 'household', familyIds: ['household'], role: 'child' }],
  ['removed member with stale admin claims', 'u-removed', { email_verified: true, familyId: 'household', familyIds: ['household'], role: 'admin' }],
  ['original household identity without claims', 'P22E4pEZTiOJyMXRWCOprWj9ifo2', { email_verified: true }],
  ['cross-space identity', 'u-other', { email_verified: true, familyId: 'other', familyIds: ['other'] }],
];
let assertions = 0;
try {
  for (const [label, uid, claims] of identities) {
    const storage = env.authenticatedContext(uid, claims).storage();
    for (const [operation, action] of [
      ['read bytes', () => getBytes(ref(storage, path))],
      ['mint a permanent download URL', () => getDownloadURL(ref(storage, path))],
      ['overwrite', () => uploadBytes(ref(storage, path), bytes)],
      ['create', () => uploadBytes(ref(storage, 'families/household/documents/new/new.pdf'), bytes)],
      ['delete', () => deleteObject(ref(storage, path))],
      ['list', () => listAll(ref(storage, 'families/household'))],
    ]) {
      await assertFails(action()); assertions++;
      console.log(`refused ${label}: ${operation}`);
    }
  }
  const anonymous = env.unauthenticatedContext().storage();
  await assertFails(getBytes(ref(anonymous, path))); assertions++;
  await assertFails(uploadBytes(ref(anonymous, 'outside-family/file'), bytes)); assertions++;
  console.log(`storage-rules.test.mjs: ${assertions} assertions passed against the real rules engine.`);
} finally { await env.cleanup(); }
