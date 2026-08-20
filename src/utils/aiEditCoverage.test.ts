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

// --- Step 2b: family-level shared documents --------------------------------
// The same bug class does not stop at FamilyMember. A shared reference doc
// (families/{id}/reference/{key}) grows new sections exactly the same way, and
// they are just as invisible to the assistant when nobody adds an edit kind —
// `successor` and `instructions` on WillsEstateDoc shipped that way on
// 2026-07-29 and had to be wired afterwards.
//
// These docs hold single structured records as often as they hold arrays
// (WillsEstateDoc.successor is one object, not a list), so unlike step 1 this
// pass also picks up fields typed by a PascalCase interface of our own — while
// deliberately ignoring scalars (string/number/boolean) and Record<> maps,
// which are settings rather than the accumulating sections this bug hits.
// Add a doc name here when it grows the kind of section a user would expect to
// fill by talking to the assistant.
//
// 'HubSettings' added 2026-07-30 after a full-app audit found the SIXTH
// instance of this exact bug class: HubSettings.status (the one-line "fridge
// whiteboard") shipped with a dedicated UI (FamilyStatus.tsx) a day earlier
// but was never wired into the AI edit pipeline, and this test's coverage
// scan never looked at HubSettings at all — so nothing caught it. Scanning
// HubSettings now closes that blind spot for every future field on it, not
// just this one.
//
// 'FamilyWordsDoc' and 'RecipeBookDoc' added 2026-08-18: both already have a
// dedicated AiEdit kind ('family_word', 'recipe') and have had one since they
// shipped, but neither doc was ever added to this list — so this guard was
// blind to both the whole time, a gap of exactly the kind this test exists to
// close. Found while wiring recipes/family words/wills & estate/shopping into
// AIChatbot.tsx's buildContext() (they were missing from the AI's read
// context even though write support already existed). RecipeBookDoc's
// interface body had to move off a single line for extractInterfaceBody's
// regex to find it — see types.ts.
//
// 'ExtendedBirthdaysDoc' added 2026-08-20, one day after the doc shipped
// without an edit kind. Its absence from this list is why nothing caught
// that: the assistant had no way to write an extended birthday, so its
// system prompt sent non-family birthdays to a contact's `birthdate`
// instead — a different store, read by different screens, so an AI-filed
// "Granny's birthday" never reached the Birthdays panel or the calendar
// export. Scanning the doc now means the next field added to it has to
// declare itself either AI-fileable or deliberately manual.
const SHARED_DOC_INTERFACES = ['WillsEstateDoc', 'HubSettings', 'FamilyWordsDoc', 'RecipeBookDoc', 'AnniversariesDoc', 'ExtendedBirthdaysDoc'];

function extractRecordFields(body: string): string[] {
  const out: string[] = [];
  // `name?: Thing[];` or `name?: Thing;` where Thing is one of our interfaces
  // (PascalCase). Lowercase primitives and `Record<...>` don't match.
  const re = /^\s*(\w+)\??:\s*([A-Z]\w*)(\[\])?;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

const sharedDocCollections = SHARED_DOC_INTERFACES.flatMap((docName) =>
  extractRecordFields(extractInterfaceBody(typesSrc, docName)).map((f) => `${docName}.${f}`),
);

const discoveredFields = [
  ...topLevelCollections,
  ...nestedCollections,
  ...sharedDocCollections,
  ...MANUALLY_INCLUDED_FIELDS,
];

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
  // nonResidentGuardians: CONTACT FIELDS ONLY are covered by the 'guardian'
  // kind (name/relationship/phone/email/address/notes) — the AI can propose
  // filing a non-resident parent/guardian's contact details from a chat
  // message or a scanned custody letter. The nested `documents` array on each
  // guardian record (ID copies, custody/guardianship papers) is deliberately
  // NOT reachable by any AiEdit kind: it is manual-upload-only through
  // MemberGuardians.tsx's own upload button, the same boundary avatarUrl
  // draws — a legal document shouldn't get auto-filed onto a specific
  // guardian record from a photo without a person explicitly choosing which
  // record it belongs to. This scanner only discovers top-level FamilyMember
  // array fields (see step 1 above), so it never looks inside
  // NonResidentGuardian itself — nothing here to add for `documents`.
  nonResidentGuardians: covered('guardian'),

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
  nameCelebrations: manual(
    "Every celebration must be human-confirmed in NameCelebrationModal.tsx before " +
    "anything is celebrated — the spec's core safety rules (never assume religion " +
    "from a name, never silently rename someone, cultural matches need the 'does " +
    "this match your name's story?' question answered by a person) are enforced by " +
    "the confirmed flag that only that UI sets. An AI write path would let a chat " +
    "message create an unconfirmed religious association, which is exactly what the " +
    "spec forbids. The assistant CAN read resolved celebrations — server.js exposes " +
    "them as read-only recall alongside expiries/gaps — only writing is excluded."
  ),

  // Was the third instance of the AI-invisible-section bug, and the first one
  // this test caught rather than a user. Wired up the same day it was found.
  'travel.visas': covered('visa'),

  // --- Family-level shared documents (step 2b) ---------------------------
  'WillsEstateDoc.records': covered('estate_record'),
  // successor and instructions were the fourth and fifth instances of this bug
  // class: both shipped as UI-only fields, so a user could type them into Wills
  // & Estate but the assistant could not file a word of it. Wired 2026-07-29,
  // which is also why step 2b exists at all.
  'WillsEstateDoc.successor': covered('designated_successor'),
  'WillsEstateDoc.instructions': covered('emergency_instructions'),

  // The sixth instance of this bug class (see SHARED_DOC_INTERFACES comment
  // above) — wired up the same day the audit found it.
  'HubSettings.status': covered('hub_status'),

  // FamilyWordsDoc and RecipeBookDoc (see SHARED_DOC_INTERFACES comment
  // above): both already had a dedicated AiEdit kind, so nothing needed wiring
  // here — this just closes the blind spot in the GUARD itself, so a future
  // field added to either doc without an edit kind gets caught the same way
  // travel.visas was.
  'FamilyWordsDoc.words': covered('family_word'),
  'RecipeBookDoc.recipes': covered('recipe'),

  // AnniversariesDoc added 2026-08-18 alongside the 'anniversary' AiEdit kind
  // from day one — unlike FamilyWordsDoc/RecipeBookDoc above, there was never
  // a gap here to close, this is just the normal step-2b entry.
  'AnniversariesDoc.anniversaries': covered('anniversary'),

  // ExtendedBirthdaysDoc shipped 2026-08-19 WITHOUT an edit kind, and it is the
  // clearest example yet of what this guard is for. The assistant couldn't
  // write here, so its system prompt pointed it at a contact's `birthdate`
  // instead — a field that only fed two home-screen cards. The result was a
  // promise ("an ongoing yearly nudge like a family member's birthday") that
  // no code kept, and AI-filed birthdays that never reached the family's
  // calendar. Closed by the 'extended_birthday' kind in v228.
  'ExtendedBirthdaysDoc.extendedBirthdays': covered('extended_birthday'),

  // calendarFeeds is intentionally read-only to the AI, not covered by a
  // write kind. Subscribing to a feed means pasting in another calendar's
  // private URL, and it already has its own dedicated, reviewed UI
  // (FamilyCalendar.tsx's subscription panel) — closer in kind to
  // digitalAccounts (a credential a human types) than to a section the AI
  // should be able to file into from a scan or a chat message. The context
  // GAP (the assistant couldn't even see what someone was subscribed to,
  // separately from not being able to edit it) was real and is fixed in
  // AIChatbot.tsx's buildContext() (the "calendarSync" field).
  'HubSettings.calendarFeeds': manual(
    "Subscribing is pasting in another calendar's private URL — a credential-like " +
    "action with its own dedicated UI (FamilyCalendar.tsx), not something to file " +
    "from a scan or a passing chat message. The AI CAN read a summary of what's " +
    "subscribed (buildContext()'s calendarSync field) — only writing is excluded."
  ),

  // A display-setting scalar (which country's ID field set to render), not a
  // collection anyone accumulates by scanning documents — never the shape
  // this bug class hits, and there is no plausible "file this by chat" flow
  // for a family's own country. FamilySettings.tsx is the correct, deliberate
  // place to change it.
  'HubSettings.country': manual(
    "A single display-setting value (which country's ID/passport field set to " +
    "show), changed in FamilySettings.tsx. Not a collection a user accumulates by " +
    "scanning documents, and there is no sensible 'file this from a document' flow " +
    "for a family's own country — it is chosen once, by hand, not extracted."
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
