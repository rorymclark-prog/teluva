#!/usr/bin/env node
// Read-only unless --apply. Counts only; no names, paths, URLs, tokens or bytes.
// Run after deploying the authenticated gateway/frontend and deny SDK rules.
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { fileTarget } from '../server/files.mjs';
import { fileRetirementPlan } from '../server/fileMigration.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';
const databaseId = process.env.FIRESTORE_DB_ID || 'teluva-prod';
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'gen-lang-client-0384516171-vault';
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported; default mode is a metadata-only dry run.');
admin.initializeApp({ projectId });
const db = getFirestore(admin.app(), databaseId);
const bucket = admin.storage().bucket(bucketName);
const snapshots = new Map();
const snapshotFor = async familyId => {
  if (!snapshots.has(familyId)) snapshots.set(familyId, (async () => {
    const family = db.collection('families').doc(familyId);
    const [members, info, estate, documents] = await Promise.all([
      family.collection('family_members').get(), family.collection('info').doc('info').get(),
      family.collection('reference').doc('willsEstate').get(), family.collection('reference').doc('documents').get(),
    ]);
    return { members: members.docs.map(snap => ({ id: snap.id, ...snap.data() })), spaceInfo: info.exists ? info.data() : {},
      estate: estate.exists ? estate.data() : null, documents: documents.exists ? documents.data() : null };
  })());
  return snapshots.get(familyId);
};
const counts = { objects: 0, tokenObjects: 0, estateObjects: 0, profileBoundObjects: 0, ambiguousBusinessObjects: 0, unknownBusinessObjects: 0, unknownBusinessByNamespace: {}, publicAclObjects: 0, updated: 0, errors: 0 };
const [files] = await bucket.getFiles({ prefix: 'families/' });
for (const file of files) {
  counts.objects++;
  try {
    const target = fileTarget(file.name);
    const [info] = await file.getMetadata();
    const plan = fileRetirementPlan(target.path, info, await snapshotFor(target.familyId), bucketName);
    if (plan.hasDownloadTokens) counts.tokenObjects++;
    if (plan.estate) counts.estateObjects++;
    if (plan.profileBound) counts.profileBoundObjects++;
    if (plan.ambiguousBusiness) counts.ambiguousBusinessObjects++;
    if (plan.unknownBusiness) {
      counts.unknownBusinessObjects++;
      const namespace = target.path.split('/')[2];
      counts.unknownBusinessByNamespace[namespace] = (counts.unknownBusinessByNamespace[namespace] || 0) + 1;
    }
    if (plan.publicAcl) { counts.publicAclObjects++; continue; }
    if (apply) { await file.setMetadata(plan.metadata, plan.preconditions); counts.updated++; }
  } catch { counts.errors++; }
}
console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', projectId, databaseId, bucketName, ...counts }));
if (counts.errors || counts.publicAclObjects) process.exitCode = 1;
