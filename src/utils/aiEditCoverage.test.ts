// Standalone assertion test — no test runner is configured in this project
// (package.json has only vite/tsc scripts), so run it directly:
//   npx tsx src/utils/aiEditCoverage.test.ts
// It exits non-zero on failure. Mirrors the style of planLimits.test.ts.
//
// WHAT THIS GUARDS AGAINST
// -------------------------------------------------------------------------
// The AI assistant can only file scanned/extracted data into a fixed set of
// "edit kinds" — the `AiEdit` union in src/components/AIChatbot.tsx, applied
// in src/utils/aiApply.ts and described to the model in server.js's system
// prompt. When a new list-shaped section is added to FamilyMember (or one of
// its nested records, e.g. MedicalRecord) WITHOUT also adding a matching edit
// kind, the assistant is physically unable to write to it: a user scans a
// document, the chat says it filed, and the new section silently stays empty
// forever. Nothing else catches this. It has already shipped twice — once as
// `referrals`, once as `vaccinations` (see git history around 2026-07-29).
//
// APPROACH
// -------------------------------------------------------------------------
// Real TypeScript type information isn't available at plain `node`/`tsx`
// runtime, so this test does NOT try to parse types.ts as TypeScript. Instead
// it reads types.ts and AIChatbot.tsx as plain TEXT and regexes the field/kind
// names out — pragmatic, and deliberately readable over clever:
//
//   1. Regex every `name?: SomeInterface[];` line out of the FamilyMember
//      interface body. Those are exactly the "collections a user accumulates
//      over time" this bug class hits (documents, sayings, careSchedule, …).
//   2. Do the same, one level deep, for MedicalRecord and TravelInfo — the two
//      nested records that hold the same kind of scan-and-file collections
//      (medical.vaccinations, travel.transitPasses, travel.visas). `cv` is
//      added by hand alongside them (see MANUALLY_INCLUDED_FIELDS below) —
//      it's a structured record with its own dedicated edit kind, but it's a
//      single object rather than an array, so the array-only regex can't find
//      it automatically.
//   3. Regex every `kind: 'xxx'` literal out of the `AiEdit` union in
//      AIChatbot.tsx.
//   4. Every field found in step 1/2 must appear in COVERAGE_MAP below, either
//      mapped to an AiEdit kind that step 3 actually found (covered), or
//      carrying a substantive explanation of why it's deliberately excluded
//      (manual-only, or a tracked known gap). A field with NEITHER — the bug
//      this test exists to catch — fails loudly and says exactly what to do.
//   5. The reverse is checked too (COVERAGE_MAP entries that no longer
//      correspond to a real field), so the map can't quietly rot out of date.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const typesSrc = fs.readFileSync(path.join(repoRoot, 'src/types.ts'), 'utf8');
const chatbotSrc = fs.readFileSync(path.join(repoRoot, 'src/components/AIChatbot.tsx'), 'utf8');

// --- Step 1/2: pull array-typed fields out of an interface body -----------

function extractInterfaceBody(text: string, name: string): string {
  const re = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}\\n`);
  const m = text.match(re);
  assert.ok(m, `Could not find "export interface ${name} {" in src/types.ts — has it been renamed or reformatted? Update the regex in aiEditCoverage.test.ts.`);
  return m![1];
}

// Matches lines like `  favoriteQuotes?: FavoriteQuote[]; // comment`
function extractArrayFields(body: string): string[] {
  const out: string[] = [];
  const re = /^\s*(\w+)\??:\s*[A-Za-z]\w*\[\];/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

const familyMemberBody = extractInterfaceBody(typesSrc, 'FamilyMember');
const topLevelCollections = extractArrayFields(familyMemberBody);

const medicalRecordBody = extractInterfaceBody(typesSrc, 'MedicalRecord');
const travelInfoBody = extractInterfaceBody(typesSrc, 'TravelInfo');
const nestedCollections = [
  ...extractArrayFields(medicalRecordBody).map((f) => `medical.${f}`),
  ...extractArrayFields(travelInfoBody).map((f) => `travel.${f}`),
];

// See step 2 above: `cv` (MemberCv) is a structured, per-member record with its
// own dedicated AiEdit kind ('cv'), exactly like the array-typed collections,
// but it isn't itself an array field on FamilyMember — it's `cv?: MemberCv;` —
// so the array-only regex can't discover it. Listed by hand rather than
// special-casing the regex for one field.
const MANUALLY_INCLUDED_FIELDS = ['cv'];

const discoveredFields = [...topLevelCollections, ...nestedCollections, ...MANUALLY_INCLUDED_FIELDS];

// --- Step 3: pull `kind: '...'` literals out of the AiEdit union ----------

const unionStart = chatbotSrc.indexOf('export type AiEdit =');
const unionEnd = chatbotSrc.indexOf('\ninterface Attachment', unionStart);
assert.ok(unionStart !== -1 && unionEnd !== -1 && unionEnd > unionStart,
  'Could not locate the `export type AiEdit = ... ` union (up to `interface Attachment`) in AIChatbot.tsx — has the file been restructured? Update the markers in aiEditCoverage.test.ts.');
const aiEditUnionText = chatbotSrc.slice(unionStart, unionEnd);

const aiEditKinds = new Set<string>();
{
  const re = /kind:\s*'([a-zA-Z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(aiEditUnionText))) aiEditKinds.add(m[1]);
}

// --- Step 4: the coverage map ----------------------------------------------

type Coverage =
  | { status: 'covered'; kind: string; note?: string }
  | { status: 'manual'; reason: string }
  | { status: 'known_gap'; reason: string };

function covered(kind: string, note?: string): Coverage { return { status: 'covered', kind, note }; }
function manual(reason: string): Coverage { return { status: 'manual', reason }; }
function knownGap(reason: string): Coverage { return { status: 'known_gap', reason }; }

const COVERAGE_MAP: Record<string, Coverage> = {
  // --- Has a dedicated AiEdit kind --------------------------------------
  passports: covered('passport'),
  documents: covered('document'),
  careSchedule: covered('care_schedule'),
  sayings: covered('saying'),
  favoriteQuotes: covered('favorite_quote'),
  cv: covered('cv'),
  'travel.transitPasses': covered('transit_pass'),
  'medical.vaccinations': covered('vaccination'), // fixed 2026-07-29 — this was the second occurrence of the bug this test now guards against.
  // referrals deliberately does NOT get its own kind literal — it rides on the
  // 'document' kind's extra referral* fields (see the big comment on the
  // 'document' AiEdit variant in AIChatbot.tsx). Checked below via the
  // referralKind marker in addition to the normal kind-exists check.
  referrals: covered('document', 'rides on document\'s referral* fields, not its own kind'),

  // --- Deliberately manual-only ------------------------------------------
  digitalAccounts: manual(
    "Stores plaintext passwords (DigitalAccount.passwordPlain). Never sent to or " +
    "from the AI — slimMembers() in AIChatbot.tsx strips passwordPlain before the " +
    "member list reaches the model, the same redaction pattern aiRedact.ts uses " +
    "for the household wifi password. A credential must be typed by a human."
  ),
  financialAccounts: manual(
    "Bank account + routing numbers. Explicitly stripped from the AI's context by " +
    "REDACTED_MEMBER_KEYS in src/utils/aiRedact.ts — the model never even sees " +
    "this field, so it cannot possibly file into it."
  ),
  growthHistory: manual(
    "Height/weight entries are logged directly off a scale/tape measure via the " +
    "GrowthTracker.tsx UI — there is no 'scan a growth chart' flow this needs to serve."
  ),
  favorites: manual(
    "Wishlist/toy items are curated by hand (a photo + category picked in " +
    "MemberFavorites.tsx). server.js's system prompt explicitly frames gift/wishlist " +
    "ideas as conversational suggestions only, deliberately kept out of the auto-file pipeline."
  ),
  birthdayPhotos: manual(
    "One photo per year, captured live through the timelapse camera flow — a " +
    "deliberate one-at-a-time ritual, not something a document scan produces."
  ),

  // --- Known gap: genuinely missing, tracked on purpose -------------------
  'travel.visas': knownGap(
    "NOT YET WIRED. Found during the 2026-07-29 audit that added this test — the " +
    "same bug pattern this test exists to catch (VisaRecord has its own manual add " +
    "form in MemberTravel.tsx, but no AiEdit kind, so a scanned visa/residence-permit " +
    "sticker can't be filed by the assistant). To fix: (1) add a 'visa' kind to the " +
    "AiEdit union in src/components/AIChatbot.tsx, (2) handle it in " +
    "src/utils/aiApply.ts's applyMemberEdits + hasMemberEdits, (3) document it in the " +
    "server.js system prompt, (4) add it to aiDestructive.ts's MEMBER_ARRAY/UPDATE_FIELDS " +
    "so delete/update-by-voice work too. Then move this entry up to the covered section."
  ),
};

// timelapseGuide is NOT a collection (TimelapseGuide is a single fixed-shape
// object, not an array of records — {eyeLineY, centerX} camera calibration set
// once and reused), so the array-only discovery in step 1 never finds it and it
// deliberately has no COVERAGE_MAP entry. Noted here (rather than silently
// omitted) because it's the other example the app's own docs use alongside
// birthdayPhotos for "things a user sets by hand, not by scanning".

// --- Step 4 continued: every discovered field must be classified ----------

const undocumented = discoveredFields.filter((f) => !(f in COVERAGE_MAP));
assert.deepStrictEqual(undocumented, [], `
${undocumented.length} FamilyMember collection field(s) have NO AiEdit coverage and are not
in the allow-list — this is exactly the "physically cannot write to it" bug class
that has already shipped twice (referrals, vaccinations). For each of:
  ${undocumented.join(', ')}
either:
  (a) it should be AI-fileable — wire it up in all 4 places:
      1. Add a 'kind' variant to the AiEdit union in src/components/AIChatbot.tsx
      2. Handle that kind in src/utils/aiApply.ts (the apply function that owns
         FamilyMember edits, e.g. applyMemberEdits) AND in whatever counts/detects
         "are there any pending edits" (e.g. hasMemberEdits)
      3. Document the new "kind" in the system prompt in server.js so the model
         knows to emit it
      4. If delete/update-by-voice should work on it too, add it to
         src/utils/aiDestructive.ts's MEMBER_ARRAY / UPDATE_FIELDS maps
      then add \`fieldName: covered('the_new_kind')\` to COVERAGE_MAP in this file.
  (b) it is deliberately manual-only (e.g. security-sensitive, or a hand-curated
      UI-only flow) — add \`fieldName: manual('why')\` to COVERAGE_MAP in this file,
      with a real reason, not a placeholder.
`);

const staleAllowlistEntries = Object.keys(COVERAGE_MAP).filter((f) => !discoveredFields.includes(f));
assert.deepStrictEqual(staleAllowlistEntries, [], `
COVERAGE_MAP in aiEditCoverage.test.ts has entries that no longer correspond to a
real FamilyMember/MedicalRecord/TravelInfo array field (or the manually-included
'cv'): ${staleAllowlistEntries.join(', ')}. The field was probably renamed or
removed — update or delete the matching COVERAGE_MAP entry.
`);

// Every 'covered' entry must reference a kind that genuinely exists in the
// AiEdit union right now (not a kind that was renamed/removed since).
for (const [field, entry] of Object.entries(COVERAGE_MAP)) {
  if (entry.status !== 'covered') continue;
  assert.ok(aiEditKinds.has(entry.kind),
    `COVERAGE_MAP says "${field}" is covered by AiEdit kind '${entry.kind}', but no ` +
    `such kind exists in the AiEdit union in AIChatbot.tsx any more. Either the kind ` +
    `was renamed (update COVERAGE_MAP to match) or genuinely removed (this field is ` +
    `broken again — re-wire it, see the undocumented-field message above for the 4 steps).`);
}

// referrals is a special case (documented above): it doesn't get its own kind,
// it rides on 'document's extra referral* fields. Confirm those fields are
// still actually present in the union, so this doesn't silently rot if the
// 'document' variant is ever simplified.
assert.ok(aiEditUnionText.includes('referralKind'),
  "COVERAGE_MAP says 'referrals' is covered via the 'document' kind's referral* " +
  "fields, but 'referralKind' no longer appears on the 'document' AiEdit variant in " +
  "AIChatbot.tsx. Referrals filing is broken again — see PROBLEM at the top of this file.");

// manual/known_gap entries must carry a real explanation, not a placeholder.
for (const [field, entry] of Object.entries(COVERAGE_MAP)) {
  if (entry.status === 'covered') continue;
  assert.ok(entry.reason.trim().length >= 20,
    `COVERAGE_MAP entry for "${field}" (${entry.status}) needs a real explanation, not a stub.`);
}

// --- Report -----------------------------------------------------------------

const coveredFields = Object.entries(COVERAGE_MAP).filter(([, e]) => e.status === 'covered').map(([f]) => f).sort();
const manualFields = Object.entries(COVERAGE_MAP).filter(([, e]) => e.status === 'manual').map(([f]) => f).sort();
const gapFields = Object.entries(COVERAGE_MAP).filter(([, e]) => e.status === 'known_gap').map(([f]) => f).sort();

console.log('aiEditCoverage.test.ts: all assertions passed');
console.log(`  covered (${coveredFields.length}): ${coveredFields.join(', ')}`);
console.log(`  manual-only (${manualFields.length}): ${manualFields.join(', ')}`);
if (gapFields.length) console.log(`  known gaps (${gapFields.length}, tracked deliberately): ${gapFields.join(', ')}`);
