// ---------------------------------------------------------------------------
// Reconcile users/{uid} (the mirror) against families/{id}/roles/{uid} (the
// authoritative membership record).
//
// WHY THIS EXISTS
// requireMember in server.js used to authorize from the users/{uid} mirror. It
// now authorizes from families/{familyId}/roles/{uid}, which is what makes
// removing a member actually take effect. The failure mode of that change is
// the opposite one: a REAL, current member who somehow has a mirror entry but
// no roles doc would be locked out of their own vault.
//
// Every code path that writes users/{uid} also writes the roles doc
// (grantMembership does both in ONE transaction), so this should find nothing.
// "Should" is not "did" — run this first and let the live data say so.
//
// USAGE — dry run first, ALWAYS. It reads only and changes nothing:
//     cd projects/family-info-organizer
//     node scripts/backfill-member-roles.mjs
//
//   Then, ONLY if it reports missing roles docs and you have looked at the list
//   and agree every one of them is a legitimate current member:
//     node scripts/backfill-member-roles.mjs --apply
//
// Requires Application Default Credentials with Firestore access to the
// project (e.g. `gcloud auth application-default login`).
//
// SAFETY: --apply only ever CREATES a missing roles doc from what the mirror
// already says. It never deletes, never downgrades, and never touches a roles
// doc that already exists — so it cannot resurrect someone who was properly
// removed (a proper removal via /api/remove-member strips the space from the
// mirror too, so they have nothing here to backfill FROM).
// ---------------------------------------------------------------------------
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';
const DB_ID = process.env.FIRESTORE_DB_ID || 'ai-studio-393d7146-0d1a-431e-bd58-b2a1478b5ff5';
const APPLY = process.argv.includes('--apply');

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(admin.app(), DB_ID);

// Every space a mirror claims: its active pointer plus each spaces[] entry.
function claimedSpaces(uid, data) {
  const out = new Map(); // spaceId -> {role, source}
  if (Array.isArray(data.spaces)) {
    for (const s of data.spaces) {
      if (s && typeof s.id === 'string' && s.id) out.set(s.id, { role: s.role || 'member', source: 'spaces[]' });
    }
  }
  if (typeof data.familyId === 'string' && data.familyId && !out.has(data.familyId)) {
    out.set(data.familyId, { role: data.role || 'member', source: 'familyId (pre-spaces[] account)' });
  }
  return out;
}

async function main() {
  console.log(`project=${PROJECT_ID} db=${DB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);

  const users = await db.collection('users').get();
  console.log(`Scanned ${users.size} user profile(s).\n`);

  const missing = [];
  for (const userDoc of users.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    for (const [spaceId, { role, source }] of claimedSpaces(uid, data)) {
      const roleRef = db.doc(`families/${spaceId}/roles/${uid}`);
      const roleSnap = await roleRef.get();
      if (roleSnap.exists) continue;
      missing.push({
        uid, spaceId, role, source,
        email: data.email || '(no email on mirror)',
        displayName: data.displayName || '',
        isActiveSpace: data.familyId === spaceId,
      });
    }
  }

  if (missing.length === 0) {
    console.log('✓ Every space claimed by a user profile has a matching roles doc.');
    console.log('  No member will be locked out by the requireMember change.');
    return;
  }

  console.log(`⚠ ${missing.length} mirror entr(ies) have NO roles doc.`);
  console.log('  Each of these accounts would be DENIED by the new requireMember:\n');
  for (const m of missing) {
    console.log(`  uid=${m.uid}  space=${m.spaceId}  role=${m.role}`);
    console.log(`     ${m.email} ${m.displayName}`.trimEnd());
    console.log(`     from ${m.source}${m.isActiveSpace ? '  [THIS IS THEIR ACTIVE SPACE]' : ''}\n`);
  }

  if (!APPLY) {
    console.log('DRY RUN — nothing was written.');
    console.log('Review the list above. If every entry is a legitimate current member, re-run with --apply.');
    console.log('If any of them is someone who SHOULD no longer have access, do NOT apply — leave them denied.');
    return;
  }

  for (const m of missing) {
    await db.doc(`families/${m.spaceId}/roles/${m.uid}`).set({
      role: m.role,
      email: m.email,
      displayName: m.displayName,
      backfilledAt: new Date().toISOString(),
    });
    console.log(`  created families/${m.spaceId}/roles/${m.uid} (role=${m.role})`);
  }
  console.log(`\n✓ Backfilled ${missing.length} roles doc(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
