// ---------------------------------------------------------------------------
// One-time migration: encrypt existing PLAINTEXT identity numbers, passport
// numbers, household codes, and bank IBAN/BIC — everything the app now
// protects at rest going forward (see src/utils/vaultFields.ts, and
// server.js's /api/vault/protect + /api/vault/reveal-shared). New writes are
// already encrypted by the app itself; this only touches data that predates
// that change.
//
// Uses the EXACT SAME algorithm as server.js's encryptSecret (AES-256-GCM,
// random 12-byte IV, tag bound to the family via AAD, 'enc:2:iv:tag:ct'
// format) so anything this script writes decrypts correctly through the
// app's existing /api/vault/reveal-shared without any special-casing.
//
// The field lists below are a deliberate COPY of
// REDACTED_IDENTITY_KEYS / REDACTED_HOUSEHOLD_KEYS / REDACTED_BANK_KEYS from
// src/utils/aiRedact.ts — kept in sync by hand, same as every other
// standalone .mjs script here, which cannot import a .ts file directly. If
// that list changes, this one must too.
//
// USAGE — dry run first, ALWAYS. It reads only and changes nothing:
//     cd projects/family-info-organizer
//     VAULT_ENC_KEY="$(gcloud secrets versions access latest --secret=vault-encryption-key --project=gen-lang-client-0384516171)" \
//       node scripts/encrypt-sensitive-fields.mjs
//
//   Then, once the dry-run summary looks right:
//     VAULT_ENC_KEY="$(gcloud secrets versions access latest --secret=vault-encryption-key --project=gen-lang-client-0384516171)" \
//       node scripts/encrypt-sensitive-fields.mjs --apply
//
// Requires Application Default Credentials with Firestore access (same as
// backfill-member-roles.mjs) PLUS Secret Manager access to read the vault
// key. The key is held only in this process's environment for the run — it
// is never written to disk or printed, and neither are any of the plaintext
// or ciphertext VALUES this script touches (only field names and counts).
//
// SAFETY: only ever touches a field that is a non-empty string NOT already
// starting with 'enc:' — already-encrypted values (from a save the app made
// itself after this shipped) and empty/unset fields are left untouched. Safe
// to re-run any time; a second run finds nothing left to do.
// ---------------------------------------------------------------------------
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';
const DB_ID = process.env.FIRESTORE_DB_ID || 'ai-studio-393d7146-0d1a-431e-bd58-b2a1478b5ff5';
const APPLY = process.argv.includes('--apply');

const REDACTED_IDENTITY_KEYS = [
  'eCardNumber', 'svNumber', 'taxNumber', 'studentNumber', 'schoolRegNumber',
  'residencePermitNumber', 'nationalIdNumber', 'birthCertNumber',
  'medicalAidNumber', 'insuranceGroupNumber', 'citizenshipCertNumber', 'driversLicenseNumber',
];
const REDACTED_HOUSEHOLD_KEYS = ['doorCode', 'garageCode', 'wifiPassword', 'alarmCode'];
const REDACTED_BANK_KEYS = ['iban', 'bic'];

const rawKey = process.env.VAULT_ENC_KEY || '';
if (!rawKey) {
  console.error('VAULT_ENC_KEY is not set. See the usage comment at the top of this script.');
  process.exit(1);
}
const VAULT_KEY = (() => {
  const buf = Buffer.from(rawKey, 'base64');
  return buf.length === 32 ? buf : crypto.createHash('sha256').update(rawKey).digest();
})();

// Identical to server.js's encryptSecret — deliberately duplicated rather
// than imported, since server.js is not a module this script can require
// without pulling in Express/Firebase-client/the whole app.
function encryptSecret(plain, familyId) {
  if (typeof plain !== 'string' || plain === '' || plain.startsWith('enc:')) return null; // nothing to do
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  cipher.setAAD(Buffer.from(familyId, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:2:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(admin.app(), DB_ID);

async function migrateMembers(familyId) {
  const members = await db.collection(`families/${familyId}/family_members`).get();
  let touched = 0, fields = 0;
  for (const memberDoc of members.docs) {
    const data = memberDoc.data();
    const update = {};
    let changedHere = false;

    const identity = data.identity;
    if (identity && typeof identity === 'object') {
      for (const key of REDACTED_IDENTITY_KEYS) {
        const enc = encryptSecret(identity[key], familyId);
        if (enc) { update[`identity.${key}`] = enc; changedHere = true; fields++; }
      }
    }

    if (Array.isArray(data.passports) && data.passports.length) {
      const newPassports = data.passports.map((p) => {
        const enc = p && typeof p === 'object' ? encryptSecret(p.number, familyId) : null;
        if (!enc) return p;
        changedHere = true; fields++;
        return { ...p, number: enc };
      });
      if (changedHere) update.passports = newPassports; // whole array — Firestore has no per-index dot-path here
    }

    if (changedHere) {
      touched++;
      console.log(`  ${APPLY ? 'encrypting' : 'would encrypt'} families/${familyId}/family_members/${memberDoc.id} (${data.name || 'unnamed'})`);
      if (APPLY) await memberDoc.ref.update(update);
    }
  }
  return { touched, fields };
}

async function migrateReferenceDoc(familyId, key, keysToCheck, isBankArray) {
  const ref = db.doc(`families/${familyId}/reference/${key}`);
  const snap = await ref.get();
  if (!snap.exists) return { touched: 0, fields: 0 };
  const data = snap.data();
  let fields = 0;
  let changed = false;
  let update = {};

  if (isBankArray) {
    if (!Array.isArray(data.banks) || !data.banks.length) return { touched: 0, fields: 0 };
    const banks = data.banks.map((b) => {
      if (!b || typeof b !== 'object') return b;
      const next = { ...b };
      for (const k of keysToCheck) {
        const enc = encryptSecret(b[k], familyId);
        if (enc) { next[k] = enc; changed = true; fields++; }
      }
      return next;
    });
    if (changed) update = { banks };
  } else {
    for (const k of keysToCheck) {
      const enc = encryptSecret(data[k], familyId);
      if (enc) { update[k] = enc; changed = true; fields++; }
    }
  }

  if (changed) {
    console.log(`  ${APPLY ? 'encrypting' : 'would encrypt'} families/${familyId}/reference/${key}`);
    if (APPLY) await ref.set(update, { merge: true });
  }
  return { touched: changed ? 1 : 0, fields };
}

async function main() {
  console.log(`project=${PROJECT_ID} db=${DB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);

  const families = await db.collection('families').listDocuments();
  console.log(`Found ${families.length} family/business space(s): ${families.map(f => f.id).join(', ')}\n`);

  let totalTouched = 0, totalFields = 0;
  for (const fam of families) {
    console.log(`— ${fam.id} —`);
    const m = await migrateMembers(fam.id);
    const h = await migrateReferenceDoc(fam.id, 'household', REDACTED_HOUSEHOLD_KEYS, false);
    const f = await migrateReferenceDoc(fam.id, 'finances', REDACTED_BANK_KEYS, true);
    const subtotalDocs = m.touched + h.touched + f.touched;
    const subtotalFields = m.fields + h.fields + f.fields;
    totalTouched += subtotalDocs;
    totalFields += subtotalFields;
    console.log(subtotalDocs ? `  ${subtotalDocs} document(s), ${subtotalFields} field(s)\n` : '  nothing to do\n');
  }

  console.log(`${APPLY ? 'Encrypted' : 'Would encrypt'} ${totalFields} field(s) across ${totalTouched} document(s).`);
  if (!APPLY) console.log('DRY RUN — nothing was written. Re-run with --apply to actually encrypt.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
