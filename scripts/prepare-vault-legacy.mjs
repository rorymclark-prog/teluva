#!/usr/bin/env node
// Trusted release inventory for old ciphertext, especially enc:1 which has no
// authenticated tenant identity. Default dry-run. Output contains counts only.
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { collectLegacySharedValues, collectLegacyCredentialValues, legacyFingerprint } from '../server/vault.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';
const databaseId = process.env.FIRESTORE_DB_ID || 'teluva-prod';
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported; default mode is a read-only dry run.');
admin.initializeApp({ projectId });
const db = getFirestore(admin.app(), databaseId);
const counts = { spaces: 0, sharedFingerprints: 0, privateFingerprints: 0, unboundShared: 0, unboundPrivate: 0, deniedSharedSkipped: 0 };
const writeFingerprints = async (family, collectionName, values) => {
  if (!apply) return;
  const ids = [...values].map(legacyFingerprint);
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = db.batch();
    for (const id of ids.slice(offset, offset + 400)) batch.set(family.collection(collectionName).doc(id), {
      inventoriedAt: new Date().toISOString(), source: 'trusted-release-inventory',
    }, { merge: true });
    await batch.commit();
  }
};

for (const family of await db.collection('families').listDocuments()) {
  counts.spaces++;
  const [members, household, finances, passwords] = await Promise.all([
    family.collection('family_members').get(), family.collection('reference').doc('household').get(),
    family.collection('reference').doc('finances').get(), family.collection('passwords').get(),
  ]);
  const snapshot = {
    members: members.docs.map(doc => doc.data()), household: household.exists ? household.data() : undefined,
    finances: finances.exists ? finances.data() : undefined, passwords: passwords.docs.map(doc => doc.data()),
  };
  const privateValues = collectLegacyCredentialValues(snapshot);
  const sharedValues = collectLegacySharedValues(snapshot);
  const sharedList = [...sharedValues];
  if (sharedList.length) {
    const denied = await db.getAll(...sharedList.map(value => family.collection('vaultLegacyPrivate').doc(legacyFingerprint(value))));
    denied.forEach((doc, index) => { if (doc.exists) { sharedValues.delete(sharedList[index]); counts.deniedSharedSkipped++; } });
  }
  counts.sharedFingerprints += sharedValues.size;
  counts.privateFingerprints += privateValues.size;
  counts.unboundShared += [...sharedValues].filter(value => value.startsWith('enc:1:')).length;
  counts.unboundPrivate += [...privateValues].filter(value => value.startsWith('enc:1:')).length;
  // Private first; an interrupted apply can never leave a private value approved.
  await writeFingerprints(family, 'vaultLegacyPrivate', privateValues);
  await writeFingerprints(family, 'vaultLegacyShared', sharedValues);
}
console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', projectId, databaseId, ...counts }));
