// ---------------------------------------------------------------------------
// Seed ONE sample recipe into a family's Recipe Book, by email.
//
// WHY THIS EXISTS
// Rory asked for "that sample recipe book" — the Recipe Book feature is
// built and live (see server.js's "recipe" AiEdit kind and RecipeBook.tsx)
// but his family's book was still empty, and demoing an AI-chat-driven photo
// scan isn't a one-shot ask. This writes one clearly-tagged sample recipe
// directly to families/{familyId}/reference/recipes, the exact shape
// saveRecipes()/loadRecipes() (src/utils/db.ts) read and write — recipes are
// NOT encrypted at rest (saveReferenceDoc called with no protect/reveal), so
// this is a plain Admin SDK write, same trust level as grant-tester-plan.mjs.
//
// USAGE
//   node scripts/seed-sample-recipe.mjs rory@example.com
//   node scripts/seed-sample-recipe.mjs rory@example.com --space <id>
//   node scripts/seed-sample-recipe.mjs rory@example.com --apply
//
// Dry run (no --apply) prints what it WOULD add and changes nothing — same
// safety pattern as grant-tester-plan.mjs / backfill-member-roles.mjs.
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
const email = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
const spaceFlagIdx = args.indexOf('--space');
const SPACE_OVERRIDE = spaceFlagIdx >= 0 ? args[spaceFlagIdx + 1] : null;

function die(msg) {
  console.error(`\nAborted: ${msg}\n`);
  process.exit(1);
}

if (!email || !email.includes('@')) {
  die('usage: node scripts/seed-sample-recipe.mjs <email> [--space <id>] [--apply]');
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(admin.app(), DB_ID);

// Same shape src/types.ts's Recipe interface expects, and the same field set
// server.js's "recipe" AiEdit kind fills in from a photographed card. Tagged
// "Sample" (not a real family recipe) so it reads obviously as a placeholder
// in the UI, and Rory can edit/delete it like any other entry once he adds
// his own via chat or "+ Add".
const SAMPLE_RECIPE = {
  id: `sample-${Date.now()}`,
  title: "Oma's Apple Strudel (sample — edit or delete me)",
  ingredients: [
    '4 large apples, peeled and thinly sliced',
    '50g raisins',
    '60g breadcrumbs',
    '80g sugar, plus extra for dusting',
    '1 tsp cinnamon',
    'Zest of 1 lemon',
    '1 sheet strudel or filo pastry',
    '60g butter, melted',
    'Icing sugar, to finish',
  ],
  steps: [
    'Toss the sliced apples with raisins, sugar, cinnamon and lemon zest.',
    'Lay the pastry flat and brush lightly with melted butter.',
    'Scatter the breadcrumbs evenly over two-thirds of the pastry — they soak up the juice so the strudel stays crisp.',
    'Spoon the apple mixture over the breadcrumbs in an even line.',
    'Using the pastry cloth (or paper) to help, roll the strudel up from the filled end, tucking in the sides as you go.',
    'Place seam-side down on a lined baking tray and brush all over with the remaining butter.',
    'Bake at 190°C for 30–35 minutes until deep golden.',
    'Cool slightly, dust with icing sugar, and serve warm.',
  ],
  tags: ['Sample'],
  createdAt: new Date().toISOString().slice(0, 10),
};

async function main() {
  console.log(`project=${PROJECT_ID} db=${DB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);

  const usersSnap = await db.collection('users').where('email', '==', email).get();
  if (usersSnap.empty) {
    die(`no users/{uid} doc has email "${email}" — have they signed in at least once?`);
  }
  if (usersSnap.size > 1) {
    die(`${usersSnap.size} accounts share email "${email}" — resolve by uid instead, this script can't guess.`);
  }

  const userDoc = usersSnap.docs[0];
  const user = userDoc.data();
  const spaces = Array.isArray(user.spaces) && user.spaces.length ? user.spaces : (
    user.familyId ? [{ id: user.familyId, role: user.role || 'member', type: 'family' }] : []
  );
  if (!spaces.length) die(`account ${userDoc.id} (${email}) has no space on record.`);

  const targetId = SPACE_OVERRIDE || user.familyId || spaces[0].id;
  if (spaces.length > 1 && !SPACE_OVERRIDE) {
    console.log(`Note: this account belongs to ${spaces.length} spaces — seeding the active one.`);
    for (const s of spaces) console.log(`    ${s.id}  (${s.type || 'family'}${s.id === targetId ? ', ACTIVE — this is the default' : ''})`);
  }

  const infoRef = db.doc(`families/${targetId}/info/info`);
  const infoSnap = await infoRef.get();
  if (!infoSnap.exists) die(`families/${targetId}/info/info does not exist — bad space id?`);
  const info = infoSnap.data();

  const recipesRef = db.doc(`families/${targetId}/reference/recipes`);
  const recipesSnap = await recipesRef.get();
  const existing = (recipesSnap.exists ? recipesSnap.data() : {})?.recipes || [];

  console.log(`Target: families/${targetId}/reference/recipes  (space: "${info.name || '?'}")`);
  console.log(`  currently: ${existing.length} recipe(s) on file`);
  console.log(`  adding:    "${SAMPLE_RECIPE.title}" (tags: ${SAMPLE_RECIPE.tags.join(', ')})`);

  if (existing.some((r) => r.title === SAMPLE_RECIPE.title)) {
    console.log('\nA recipe with this exact title is already on file — not adding a duplicate.');
    return;
  }

  if (!APPLY) {
    console.log('\nDry run only — nothing written. Re-run with --apply to actually add it.');
    return;
  }

  await recipesRef.set({ recipes: [...existing, SAMPLE_RECIPE] }, { merge: true });
  console.log('\nDone — sample recipe added.');
}

main().catch((e) => die(e.stack || String(e)));
