/* One-off: lift already-filed referral/imaging/lab-result scans out of a member's
 * Documents and ALSO record them in Referrals & Results.
 *
 * Why this exists: until v145 the assistant had no `referral` edit kind, so a
 * photographed referral could only become a generic document. The scans are
 * real and correctly filed — they are just missing from the section built for
 * them. This copies, it never moves: the document stays exactly where it is,
 * and the referral record points at the SAME Storage object.
 *
 * Idempotent: skips any document whose file is already referenced by an
 * existing referral, so re-running changes nothing.
 *
 *   node scripts/migrate-referrals.mjs            # dry run, writes nothing
 *   node scripts/migrate-referrals.mjs --apply
 */
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
admin.initializeApp({ projectId: 'gen-lang-client-0384516171' });
const db = getFirestore(admin.app(), process.env.FIRESTORE_DB_ID || 'teluva-prod');
const FAMILY = process.env.FAMILY_ID || 'household';

// Only things a doctor hands you. Deliberately narrow — a false positive here
// puts a random document into someone's medical history.
const CLASSIFY = [
  [/\b(x-?ray|mri|ultrasound|sonar|ct scan|scan request|imaging)\b/i, 'Imaging'],
  [/\b(lab|blood|bloods|pathology|urine|test results?)\b/i,           'Lab result'],
  [/\b(sick note|medical certificate|krankenstand)\b/i,               'Sick note'],
  [/\b(specialist letter|consultation letter|befund)\b/i,             'Specialist letter'],
  [/\b(referral|überweisung|zuweisung)\b/i,                           'Referral'],
];
const classify = (name) => (CLASSIFY.find(([re]) => re.test(name || '')) || [])[1] || null;

const members = await db.collection('families').doc(FAMILY).collection('family_members').get();
// Vault copies carry storagePath (needed for deletion); the profile copy does not.
const vaultSnap = await db.collection('families').doc(FAMILY).collection('reference').doc('documents').get();
const vault = (vaultSnap.data()?.docs) || [];

let planned = 0;
for (const doc of members.docs) {
  const m = doc.data();
  const docs = m.documents || [];
  const existing = m.referrals || [];
  const seen = new Set(existing.map((r) => r.downloadUrl).filter(Boolean));
  const additions = [];

  for (const d of docs) {
    const kind = classify(d.name);
    if (!kind) continue;
    const url = d.fileData;
    if (!url || seen.has(url)) continue;                 // already recorded — idempotent
    const v = vault.find((x) => (d.contentHash && x.contentHash === d.contentHash) || x.name === d.name);
    additions.push({
      id: 'refmig-' + (d.id || Math.random().toString(36).slice(2)),
      kind,
      reason: d.name,
      status: 'open',
      fileName: d.fileName || d.name,
      fileType: d.fileType || 'image/jpeg',
      fileSize: d.fileSize || 0,
      storagePath: v?.storagePath || '',                  // '' => app must not offer delete-file
      downloadUrl: url,
      contentHash: d.contentHash || undefined,
      addedAt: d.uploadedAt ? new Date(d.uploadedAt).toISOString() : new Date().toISOString(),
      migratedFromDocumentId: d.id || undefined,
    });
    seen.add(url);
  }

  if (!additions.length) continue;
  planned += additions.length;
  console.log(`\n${m.name}: +${additions.length} (already had ${existing.length})`);
  additions.forEach((r) => console.log(`   [${r.kind}] ${r.reason}  storagePath=${r.storagePath ? 'found' : 'MISSING'}`));

  if (APPLY) {
    await doc.ref.update({ referrals: [...existing, ...additions] });
    console.log('   written');
  }
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${planned} referral record(s)${APPLY ? ' written' : ' would be created'}.`);
process.exit(0);
