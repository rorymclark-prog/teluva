// ---------------------------------------------------------------------------
// Grant a beta tester paid-tier limits for N months, by email.
//
// WHY THIS EXISTS
// There is no billing UI yet (see server.js's plan-limits comment block) —
// "paid" is a hand-set Firestore field. Beta testers get 6 months of paid
// limits for free as a thank-you for testing. This script is the "by hand"
// part made repeatable and safe, instead of hunting for a familyId in the
// Firestore console and typo-ing a field on a doc that plan-limits security
// depends on.
//
// USAGE
//   node scripts/grant-tester-plan.mjs rory@example.com
//   node scripts/grant-tester-plan.mjs rory@example.com --months 3
//   node scripts/grant-tester-plan.mjs rory@example.com --apply
//
// Dry run (no --apply) prints what it WOULD grant and changes nothing — same
// safety pattern as backfill-member-roles.mjs. Always dry-run first.
//
// WHICH SPACE GETS THE GRANT
// A person can belong to more than one space (users/{uid}.spaces[]). This
// grants their ACTIVE space (users/{uid}.familyId) by default — the one
// they'll actually be testing in — not every space they belong to. Pass
// --space <id> to target a specific one instead (see the printed list if
// they have more than one).
//
// Requires Application Default Credentials with Firestore access to the
// project (e.g. `gcloud auth application-default login`).
// ---------------------------------------------------------------------------
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0384516171';
const DB_ID = process.env.FIRESTORE_DB_ID || 'teluva-prod';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
// Email is always the first positional (non-flag) argument.
const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
const monthsFlagIdx = args.indexOf('--months');
const MONTHS = monthsFlagIdx >= 0 ? Number(args[monthsFlagIdx + 1]) : 6;
const spaceFlagIdx = args.indexOf('--space');
const SPACE_OVERRIDE = spaceFlagIdx >= 0 ? args[spaceFlagIdx + 1] : null;

function die(msg) {
  console.error(`\nAborted: ${msg}\n`);
  process.exit(1);
}

if (!email || !email.includes('@')) {
  die('usage: node scripts/grant-tester-plan.mjs <email> [--months N] [--space <id>] [--apply]');
}
if (!Number.isFinite(MONTHS) || MONTHS <= 0) {
  die(`--months must be a positive number, got: ${args[monthsFlagIdx + 1]}`);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(admin.app(), DB_ID);

function expiryIso(months, from = new Date()) {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

async function main() {
  console.log(`project=${PROJECT_ID} db=${DB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);

  const usersSnap = await db.collection('users').where('email', '==', email).get();
  if (usersSnap.empty) {
    die(`no users/{uid} doc has email "${email}" — have they signed in at least once?`);
  }
  if (usersSnap.size > 1) {
    // Shouldn't happen (uid is the doc id, email isn't unique-indexed) but
    // fail loud rather than silently picking one if it ever does.
    die(`${usersSnap.size} accounts share email "${email}" — resolve by uid instead, this script can't guess.`);
  }

  const userDoc = usersSnap.docs[0];
  const user = userDoc.data();
  const spaces = Array.isArray(user.spaces) && user.spaces.length ? user.spaces : (
    user.familyId ? [{ id: user.familyId, role: user.role || 'member', type: 'family' }] : []
  );
  if (!spaces.length) {
    die(`account ${userDoc.id} (${email}) has no space on record.`);
  }

  const targetId = SPACE_OVERRIDE || user.familyId || spaces[0].id;
  if (spaces.length > 1 && !SPACE_OVERRIDE) {
    console.log(`Note: this account belongs to ${spaces.length} spaces — granting the active one.`);
    console.log(`  Pass --space <id> to target a different one instead:`);
    for (const s of spaces) console.log(`    ${s.id}  (${s.type || 'family'}${s.id === targetId ? ', ACTIVE — this is the default' : ''})`);
  }

  const infoRef = db.doc(`families/${targetId}/info/info`);
  const infoSnap = await infoRef.get();
  if (!infoSnap.exists) die(`families/${targetId}/info/info does not exist — bad space id?`);
  const info = infoSnap.data();

  const newExpiry = expiryIso(MONTHS);
  console.log(`Target: families/${targetId}/info/info  (name: "${info.name || '?'}", type: ${info.type || 'family'})`);
  console.log(`  current plan: ${info.plan || 'free (default)'}${info.planExpiresAt ? `, expires ${info.planExpiresAt}` : ''}`);
  console.log(`  granting:     paid, expires ${newExpiry}  (${MONTHS} month${MONTHS === 1 ? '' : 's'} from now)`);

  if (!APPLY) {
    console.log('\nDry run only — nothing written. Re-run with --apply to actually grant it.');
    return;
  }

  await infoRef.set({ plan: 'paid', planExpiresAt: newExpiry }, { merge: true });
  console.log('\nGranted.');
}

main().catch((e) => die(e.message || String(e)));
