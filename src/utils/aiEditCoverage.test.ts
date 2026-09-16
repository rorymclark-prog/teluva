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
  ...extractArrayFields(extractInterfaceBody(typesSrc, 'EducationDetails')).map(f => `education.${f}`),
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
//
// 'FamilyInfo' added 2026-08-20. It is the OLDEST shared doc in the app —
// contacts, numbers and providers — and it was never on this list, which is
// exactly why `vendors` sat unreachable by the assistant for as long as it did
// while newer docs were caught within a day. The guard was blind to the
// document the bug class started in.
//
// 'HouseholdInfo' added 2026-08-20 while giving the house a service log. Its
// absence is the same shape of hole as FamilyInfo's: vehicles, pets and
// utilities have had AI kinds for a long time, but nothing was checking, so
// the next collection added to the household document — homeServiceLog, in
// this case — could have shipped unreachable by the assistant and no test
// would have said a word. Adding it also forces `locations` to declare itself,
// which is how the known_gap below got written down instead of forgotten.
//
// 'Pet' added 2026-08-20 while giving pets a medical history. It is not itself
// a shared document — it is a ROW inside HouseholdInfo.pets — and that is the
// point: scanning HouseholdInfo only proves the pets LIST is AI-writable, and
// says nothing about the fields inside a pet. A collection one level down is
// exactly as invisible to the assistant as a top-level one, and the scan had
// no way to see it. `Vehicle.serviceLog` sat in that same blind spot until it
// was given the 'service_record' kind for unrelated reasons; nothing was
// checking. Both are declared below now.
//
// 'FamilyTreeDoc' added 2026-08-21 with the family tree. Listed on the day the
// document was created rather than months later, precisely because the two
// entries above are both records of a blind spot that was found by accident.
//
// 'FamilyTimeline' added 2026-09-13 with the timeline import: its one list
// (`entries`) is written by list_add "timeline", and the fields INSIDE a
// TimelineEntry are held to account one by one in their own block below.
const SHARED_DOC_INTERFACES = ['WillsEstateDoc', 'HubSettings', 'FamilyWordsDoc', 'RecipeBookDoc', 'AnniversariesDoc', 'ExtendedBirthdaysDoc', 'FamilyInfo', 'HouseholdInfo', 'Pet', 'Vehicle', 'FamilyTreeDoc', 'FamilyTimeline'];

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

// --- Step 2c: link fields on service entries -------------------------------
// Added 2026-09-12 with receipts on service entries (Rory: "i just had a
// bicycle service for example where does the receiot and document of the
// service live?"). ServiceRecord.docIds, HomeServiceRecord.docIds and
// HomeServiceRecord.assetId are plain `string` / `string[]` POINTERS, which
// step 2b's PascalCase regex can never see — so without this pass they would
// be neither covered nor declared, just invisible. Every `…Id` / `…Ids` field
// on these rows must now say whether the assistant can write it, and why not.
const LINK_FIELD_INTERFACES = ['ServiceRecord', 'HomeServiceRecord'];
function extractLinkFields(body: string): string[] {
  const out: string[] = [];
  const re = /^\s*(\w+Ids?)\??:\s*string(\[\])?;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}
const linkFields = LINK_FIELD_INTERFACES.flatMap((name) =>
  extractLinkFields(extractInterfaceBody(typesSrc, name)).map((f) => `${name}.${f}`),
);
// CONTROL: the pass must find the fields it was written for. If a reflow of
// types.ts stopped the regex matching, the map entries below would go stale
// and fail — but assert it directly too, so the reason is obvious.
assert.ok(linkFields.includes('HomeServiceRecord.assetId') && linkFields.includes('ServiceRecord.docIds'),
  `step 2c found ${JSON.stringify(linkFields)} — expected at least ServiceRecord.docIds and HomeServiceRecord.assetId`);
// CONTROL the other way: a plain text field is NOT a link.
assert.ok(!linkFields.includes('HomeServiceRecord.work') && !linkFields.includes('HomeServiceRecord.id'),
  'step 2c must only pick up …Id/…Ids link fields, not every string');

const discoveredFields = [
  ...topLevelCollections,
  ...nestedCollections,
  ...sharedDocCollections,
  ...linkFields,
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
  addressHistory: manual('Previous addresses are entered in the Addresses tab with dates confirmed by the user; automatic address-history filing is not enabled.'),
  'education.schoolYears': manual('School years and reports are entered in Education; users select the academic year and attach existing scans. Automatic report extraction is a later feature.'),
  'education.qualifications': manual('Family qualifications are entered in Education and linked to saved certificates; the business CV assistant does not populate this separate family record.'),
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
  nameMeanings: manual(
    "Same boundary as nameCelebrations above, for the same reason one step over. " +
    "Every entry carries a REQUIRED confidence ('established' | 'likely' | " +
    "'contested') that the research endpoint refuses to default (see " +
    "sanitizeNameMeaning in server.js), because a derivation stated flat with no " +
    "hedge is the app asserting folk etymology as fact about someone's own name. " +
    "An AiEdit kind would let a chat message store a meaning with no confidence, " +
    "no origin and no provenance — the one outcome this feature exists to prevent. " +
    "Confirmed only through NameMeaningModal.tsx. The assistant CAN read kept " +
    "meanings (server.js exposes them as read-only recall, same as celebrations)."
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
  // The family tree (2026-08-21). A DELIBERATE gap, not an oversight: a kin
  // link is a claim about two people, and the two failure modes — filing a
  // relationship against the wrong person of the same name, and a reversed
  // parent link, which makes someone their own ancestor — are both silent and
  // both hard to spot once saved. kinLinkProblem() refuses the reversal, but
  // nothing can refuse "wrong Maria". Six taps in the tree screen is cheap;
  // an assistant confidently rewriting who someone's mother is, is not.
  'FamilyTreeDoc.links': knownGap(
    'Kin links are entered by hand only. Matching a person by name is exactly the ambiguity a family tree cannot absorb, and a wrong parent edge is silent once saved.',
  ),

  'FamilyWordsDoc.words': covered('family_word'),
  'RecipeBookDoc.recipes': covered('recipe'),

  // AnniversariesDoc added 2026-08-18 alongside the 'anniversary' AiEdit kind
  // from day one — unlike FamilyWordsDoc/RecipeBookDoc above, there was never
  // a gap here to close, this is just the normal step-2b entry.
  'AnniversariesDoc.anniversaries': covered('anniversary'),

  // The family-name half of nameMeanings (see its entry above for the full
  // reasoning). Lives on the SHARED document rather than the member because a
  // surname is one etymology however many people carry it — so an AI write
  // here would not just store an unhedged derivation, it would store it for
  // everyone with that name at once.
  'FamilyInfo.surnameMeanings': manual(
    "The shared half of nameMeanings — human-confirmed in NameMeaningModal.tsx, " +
    "with the same required-confidence rule. Writing it from chat would assert a " +
    "contested derivation as fact for every member carrying that family name."
  ),

  // ExtendedBirthdaysDoc shipped 2026-08-19 WITHOUT an edit kind, and it is the
  // clearest example yet of what this guard is for. The assistant couldn't
  // write here, so its system prompt pointed it at a contact's `birthdate`
  // instead — a field that only fed two home-screen cards. The result was a
  // promise ("an ongoing yearly nudge like a family member's birthday") that
  // no code kept, and AI-filed birthdays that never reached the family's
  // calendar. Closed by the 'extended_birthday' kind in v228.
  'ExtendedBirthdaysDoc.extendedBirthdays': covered('extended_birthday'),

  // FamilyInfo — the oldest shared doc, added to the scan 2026-08-20. The first
  // three were AI-fileable from the beginning; `vendors` was not, and said so
  // out loud in aiApply.ts ("no edit kind writes it") for as long as it took
  // somebody to read that line. The nearest kinds genuinely did not fit:
  // provider's `type` is a closed enum of medical and financial professionals,
  // and a contact is a person to phone with no trade, no account reference and
  // no out-of-hours number. Closed by the 'vendor' kind in v236.
  'FamilyInfo.numbers': covered('number'),
  'FamilyInfo.contacts': covered('contact'),
  'FamilyInfo.providers': covered('provider'),
  'FamilyInfo.vendors': covered('vendor'),

  // The household document. utilities/vehicles/pets are written by
  // household's list_add; the two service histories have their own kinds
  // because both APPEND onto an existing parent rather than creating a row.
  'HouseholdInfo.utilities': covered('list_add', 'list "utilities"'),
  'HouseholdInfo.vehicles': covered('list_add', 'list "vehicles"'),
  'HouseholdInfo.pets': covered('list_add', 'list "pets"'),
  'HouseholdInfo.homeServiceLog': covered('home_service'),

  // Collections INSIDE a household row, one level below the lists above. Both
  // are append-onto-an-existing-parent, which is why neither could be a
  // list_add: the edit has to say WHICH pet or WHICH vehicle, and matching is
  // by name (pets) or plate/VIN (vehicles). See applyPetHealthEdits for why an
  // unmatched pet is reported rather than filed against whichever animal comes
  // first — a vet bill on the wrong dog is worse than one that didn't save,
  // because nobody goes looking for it.
  // The life timeline's own moments. Which fields of a moment the assistant
  // may write — and that source/importBatchId are never the model's to set —
  // is asserted field by field in the TimelineEntry block below.
  'FamilyTimeline.entries': covered('list_add', 'list "timeline"; update_record/delete_record targetKind "timeline"'),
  'Pet.healthLog': covered('pet_health'),
  'Vehicle.serviceLog': covered('service_record'),
  // Rory, 2026-09-12: "can we add scooters, bicycles etc". Written by the
  // vehicles list_add (item.kind, normalised by aiApply) and corrected by
  // update_record (UPDATE_FIELDS.vehicle.kind, normalised by buildPatch).
  // Both halves and the prompt are asserted by name further down.
  'Vehicle.kind': covered('list_add', 'list "vehicles" item.kind; update_record vehicle fields.kind'),

  // Service-entry links (step 2c). All three are POINTERS to things the
  // assistant has no id for at the moment it files an entry.
  'ServiceRecord.docIds': manual(
    'A receipt is linked by the person filing it (Scan / Choose a file / From the vault on the ' +
    'service entry). The model never holds a VaultDocument id for a file it has only just read, ' +
    'and guessing one would pin the wrong invoice to a service with no visible sign it happened.',
  ),
  'HomeServiceRecord.docIds': manual(
    'Same boundary as ServiceRecord.docIds: attached by hand on the house work log entry, where the ' +
    'person can see which file they are pinning. The document itself is still AI-fileable via the ' +
    "'document' kind — only the link is manual.",
  ),
  'HomeServiceRecord.assetId': manual(
    'The "Which appliance or item?" picker on the house work log. The assistant does not see asset ids ' +
    'for this, and two "Dishwasher" rows (old and new) is exactly the ambiguity a name match gets wrong. ' +
    'The prompt tells it to name the appliance in "area" instead, which the entry shows as text.',
  ),
  'HomeServiceRecord.vendorId': manual(
    'Never emitted by the model: aiApply links it by matching the entry\'s "by" against the vendor ' +
    'directory (home_service), and UPDATE_FIELDS.home_service deliberately leaves it out.',
  ),
  'HouseholdInfo.locations': knownGap(
    'Business-space only: the extra premises of a multi-site business, shown '
    + 'in HouseholdView behind isBusinessSpace. The assistant has no business-'
    + 'space vocabulary for it — household list_add writes utilities, vehicles '
    + 'and pets only — so "add our Cape Town branch at 5 Long Street" lands '
    + 'nowhere today. Small, real, and deliberately left until the business '
    + 'bundle is a product rather than a family vault wearing a different hat '
    + '(see project_teluva_business_bundle).',
  ),

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

  // Whose dates the family has chosen not to see. The AI can SEE the choice
  // (buildContext() marks hidden people's dates `datesHidden`, so it stops
  // volunteering them) but deliberately cannot make it: hiding an ex-partner's
  // birthday for the whole family is a decision a person makes on the Hide
  // sheet, with the scope in front of them, not something to infer from a
  // passing remark in chat.
  'HubSettings.hiddenDatePeople': manual(
    "Hiding someone's dates for the whole family is a deliberate choice made on " +
    "the Hide sheet (HideDatesSheet.tsx), where the scope is shown. The assistant " +
    "reads it (datesHidden in buildContext()) so it stops volunteering those dates, " +
    "but must never set it from a passing remark."
  ),
  // v355 "Choose who": the same decision, narrowed to chosen accounts — and
  // more sensitive, not less: it hides a date from one named person (often
  // another parent) and not the rest. Inferring that from chat would be the
  // assistant quietly taking a side in a family.
  'HubSettings.hiddenDatePeopleFor': manual(
    "Hiding someone's dates from chosen accounts is an admin's deliberate choice " +
    "made on the Hide sheet's \"Choose who\" checklist (HiddenPeopleContext.tsx), " +
    "with every account named in front of them. The assistant only reads the " +
    "result (the asking account's datesHidden) and must never set it."
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

// --- A referral's APPOINTMENT, end to end (2026-09-13) ----------------------
//
// Rory: an orthopaedic-surgeon and a psychiatry appointment, both on paper,
// neither on the calendar nor known to the chat. A scanned letter that said
// "Termin am 22.09. um 10:30" filed as an 'open' referral with no appointment,
// because no layer had anywhere to put that date. The date now travels
// through five places, and dropping it from any ONE of them is silent: the
// model can still say it, and it lands nowhere. So all five are named here.
{
  const serverSrc = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
  const destructiveSrc = fs.readFileSync(path.join(repoRoot, 'src/utils/aiDestructive.ts'), 'utf8');

  function appointmentWiringGaps(src: { chatbot: string; server: string; destructive: string; types: string }): string[] {
    const gaps: string[] = [];
    const union = src.chatbot.slice(src.chatbot.indexOf('export type AiEdit ='), src.chatbot.indexOf('\ninterface Attachment'));
    const docStart = union.indexOf("{ kind: 'document'");
    const docVariant = docStart < 0 ? '' : union.slice(docStart, union.indexOf('\n  | {', docStart + 1));
    const schemaLine = src.server.split('\n').find((l) => l.startsWith('- {"kind":"document"')) || '';
    const scanStart = src.chatbot.indexOf('if (e.referralKind) {');
    const scanApply = scanStart < 0 ? '' : src.chatbot.slice(scanStart, src.chatbot.indexOf('onAddReferral(', scanStart));
    const referralBody = (/export interface ReferralRecord \{\n([\s\S]*?)\n\}\n/.exec(src.types) || [])[1] || '';
    const updateRow = (/^\s*referral: \{ kind: 'kind'.*$/m.exec(src.destructive) || [])[0] || '';
    for (const f of ['appointmentDate', 'appointmentTime']) {
      if (!new RegExp(`\\b${f}\\?:`).test(docVariant)) gaps.push(`AIChatbot AiEdit 'document' variant lacks ${f}`);
      if (!schemaLine.includes(`"${f}"`)) gaps.push(`server.js document schema line lacks "${f}"`);
      if (!scanApply.includes(`e.${f}`)) gaps.push(`AIChatbot fileScans referral apply never reads e.${f}`);
      if (!new RegExp(`^\\s*${f}\\?:`, 'm').test(referralBody)) gaps.push(`types.ts ReferralRecord lacks ${f}`);
      if (!updateRow.includes(`${f}: '${f}'`)) gaps.push(`aiDestructive UPDATE_FIELDS.referral lacks ${f}`);
    }
    if (!scanApply.includes('referralStatusForAppointment(')) gaps.push('fileScans files a dated referral without the booked-status rule');
    if (!/\.\.\.patchForRecord\(e\.targetKind, r, patch\)/.test(src.destructive)) gaps.push('aiDestructive merges a referral patch without the booked-status rule');
    return gaps;
  }

  const real = { chatbot: chatbotSrc, server: serverSrc, destructive: destructiveSrc, types: typesSrc };
  assert.deepStrictEqual(appointmentWiringGaps(real), [],
    "a referral's appointment date/time is no longer wired end to end — a scanned letter's appointment would land nowhere");

  // CONTROL: every check must be able to fail. Break ONE source at a time and
  // the guard has to name exactly that gap.
  const strip = (text: string, what: string) => text.split(what).join('xxxx');
  const cases: [string, typeof real][] = [
    ["'document' variant lacks appointmentTime", { ...real, chatbot: chatbotSrc.replace('appointmentDate?: string; appointmentTime?: string }', 'appointmentDate?: string }') }],
    ['document schema line lacks "appointmentTime"', { ...real, server: serverSrc.replace(',"appointmentTime":"<HH:MM of that appointment, only when stated>"', '') }],
    ['never reads e.appointmentDate', { ...real, chatbot: strip(chatbotSrc, 'e.appointmentDate') }],
    ['ReferralRecord lacks appointmentTime', { ...real, types: typesSrc.replace('appointmentTime?: string;', '') }],
    ['UPDATE_FIELDS.referral lacks appointmentTime', { ...real, destructive: destructiveSrc.replace("appointmentTime: 'appointmentTime', ", '') }],
    ['fileScans files a dated referral without', { ...real, chatbot: strip(chatbotSrc, 'referralStatusForAppointment(') }],
    ['aiDestructive merges', { ...real, destructive: strip(destructiveSrc, '...patchForRecord(') }],
  ];
  for (const [expect, broken] of cases) {
    const gaps = appointmentWiringGaps(broken);
    assert.ok(gaps.some((g) => g.includes(expect)), `CONTROL: breaking "${expect}" must be reported, got ${JSON.stringify(gaps)}`);
  }
  console.log(`  referral appointment date/time: wired through 5 layers (${cases.length} controls fail as they should)`);
}

// manual/known_gap entries must carry a real explanation, not a placeholder.
for (const [field, entry] of Object.entries(COVERAGE_MAP)) {
  if (entry.status === 'covered') continue;
  assert.ok(entry.reason.trim().length >= 20,
    `COVERAGE_MAP entry for "${field}" (${entry.status}) needs a real explanation, not a stub.`);
}

// --- household_set: the field union and the runtime Set must agree ---------
//
// Same bug class as everything above, one level down. `household_set` doesn't
// name a collection — it names a FIELD, and that name is written twice: as a
// string-literal union in AIChatbot.tsx (compile time) and as
// HOUSEHOLD_SET_FIELDS in aiApply.ts (runtime). A name in only the union is a
// type that lies; a name in only the Set is an edit the model can emit,
// applyHouseholdEdits will happily write, and TypeScript believes impossible.
// Neither shows up as a failure anywhere — the edit just quietly doesn't land,
// or the type quietly stops describing reality.
{
  const applySrc = fs.readFileSync(path.join(repoRoot, 'src/utils/aiApply.ts'), 'utf8');

  const unionBlock = /kind: 'household_set';\s*\n?\s*field:([\s\S]*?);/.exec(chatbotSrc);
  assert.ok(unionBlock, "couldn't find the household_set field union in AIChatbot.tsx");
  const unionFields = [...unionBlock[1].matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]).sort();

  const setBlock = /const HOUSEHOLD_SET_FIELDS = new Set\(\[([\s\S]*?)\]\)/.exec(applySrc);
  assert.ok(setBlock, "couldn't find HOUSEHOLD_SET_FIELDS in aiApply.ts");
  const setFields = [...setBlock[1].matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]).sort();

  assert.ok(unionFields.length > 0 && setFields.length > 0, 'both lists must be non-empty');
  assert.deepStrictEqual(
    unionFields, setFields,
    'the household_set field union (AIChatbot.tsx) and HOUSEHOLD_SET_FIELDS (aiApply.ts) have drifted apart',
  );

  // And every one of them must be a real field on HouseholdInfo — a typo in
  // either list writes a key nothing ever reads.
  const householdBody = extractInterfaceBody(typesSrc, 'HouseholdInfo');
  const householdKeys = new Set([...householdBody.matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map(m => m[1]));
  for (const f of setFields) {
    assert.ok(householdKeys.has(f), `household_set field '${f}' does not exist on HouseholdInfo`);
  }
  console.log(`  household_set fields (${setFields.length}): ${setFields.join(', ')}`);
}

// --- Flat member fields: the map and the prompt must name the same keys -----
//
// A scalar member field is AI-writable only if BOTH agree: MEMBER_FIELD_MAP in
// aiApply.ts has a setter for the key, and server.js's "Canonical member field
// keys" block offers it to the model. Either one alone fails silently, in
// opposite directions:
//
//   in the map, not in the prompt  → the model never emits the key, so the
//                                    field is invisible to the assistant and
//                                    nobody can tell it apart from a field the
//                                    AI is simply bad at filling.
//   in the prompt, not in the map  → the model emits it, the Apply card shows
//                                    it, the user taps Apply, and MEMBER_FIELD_MAP
//                                    has no setter — the exact "rejected write
//                                    that reports success" aiApply.ts:48 was
//                                    written to stop.
//
// Neither shows up in the coverage map above, which tracks list-shaped
// sections rather than scalars.
{
  const applySrc = fs.readFileSync(path.join(repoRoot, 'src/utils/aiApply.ts'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

  const mapBlock = /const MEMBER_FIELD_MAP[\s\S]*?\n\};/.exec(applySrc);
  assert.ok(mapBlock, "couldn't find MEMBER_FIELD_MAP in aiApply.ts");
  const mapKeys = new Set(
    [...mapBlock[0].matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*\(m,/gm)].map((m) => m[1]),
  );

  // The prompt block runs from its heading to the blank line after the last
  // category. Sub-notes are indented prose, so only the "category: a, b, c"
  // lines count.
  const at = serverSrc.indexOf('Canonical member field keys (use ONLY these):');
  assert.ok(at > 0, "couldn't find the canonical member field key block in server.js");
  const promptBlock = serverSrc.slice(at, serverSrc.indexOf('\n\n', at));
  const promptKeys = new Set<string>();
  for (const line of promptBlock.split('\n').slice(1)) {
    if (/^\s/.test(line)) continue;                       // an indented sub-note, not a category line
    const rhs = line.slice(line.indexOf(':') + 1);
    for (const k of rhs.split(',')) {
      const t = k.trim();
      if (/^[a-z][a-z0-9_]*$/.test(t)) promptKeys.add(t);
    }
  }

  assert.ok(mapKeys.size > 20 && promptKeys.size > 20, 'both lists must be non-empty and plausibly complete');

  const onlyInMap = [...mapKeys].filter((k) => !promptKeys.has(k)).sort();
  const onlyInPrompt = [...promptKeys].filter((k) => !mapKeys.has(k)).sort();
  assert.deepStrictEqual(onlyInMap, [],
    `these member fields have a setter but are never offered to the model, so the AI can never write them: ${onlyInMap.join(', ')}`);
  assert.deepStrictEqual(onlyInPrompt, [],
    `the model is told it may write these, but MEMBER_FIELD_MAP has no setter — Apply would silently do nothing: ${onlyInPrompt.join(', ')}`);

  // `spouse` names a living person and is the newest of these; keeping it
  // asserted by name means the parity check above cannot pass by both lists
  // being empty.
  assert.ok(mapKeys.has('spouse') && promptKeys.has('spouse'), 'spouse must be AI-writable on both sides');
  console.log(`  member field keys (${mapKeys.size}): map and prompt agree`);
}

// --- Vehicle.kind: the type, the prompt, and both write paths agree ---------
//
// 'Vehicle.kind' is marked covered above via list_add. That is only true if
// (1) the prompt offers every VehicleKind value, (2) the list_add path
// normalises it and (3) update_record can change it. Checked by name, so the
// covered() line cannot be true on paper only.
{
  const applySrc = fs.readFileSync(path.join(repoRoot, 'src/utils/aiApply.ts'), 'utf8');
  const destructiveSrc = fs.readFileSync(path.join(repoRoot, 'src/utils/aiDestructive.ts'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');

  const typeMatch = /export type VehicleKind =([^;]+);/.exec(typesSrc);
  assert.ok(typeMatch, "couldn't find `export type VehicleKind` in types.ts");
  const typeKinds = [...typeMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

  const promptMatch = /vehicles \(fields: kind \[one of ([a-z_|]+)/.exec(serverSrc);
  assert.ok(promptMatch, "server.js's vehicles list_add no longer offers `kind [one of …]`");
  const promptKinds = promptMatch[1].split('|').sort();
  assert.deepStrictEqual(promptKinds, typeKinds, 'the prompt\'s vehicle kinds and VehicleKind have drifted apart');
  // CONTROL: the parity above cannot pass by both sides being empty.
  assert.ok(typeKinds.includes('bicycle') && typeKinds.length >= 5, 'VehicleKind must include bicycle');

  assert.ok(/list === 'vehicles'[\s\S]{0,400}normalizeVehicleKind/.test(applySrc),
    "aiApply's vehicles list_add must normalise item.kind with normalizeVehicleKind");
  const vehFields = /\n\s*vehicle: \{([\s\S]*?)\},\n/.exec(destructiveSrc);
  assert.ok(vehFields, "couldn't find UPDATE_FIELDS.vehicle in aiDestructive.ts");
  assert.ok(/\bkind: 'kind'/.test(vehFields[1]), 'UPDATE_FIELDS.vehicle must accept kind');
  // CONTROL: the same regex over a neighbour that has no kind must NOT match,
  // or the check above proves nothing.
  const petFields = /\n\s*pet: \{([\s\S]*?)\},\n/.exec(destructiveSrc);
  assert.ok(petFields && !/\bkind: 'kind'/.test(petFields[1]), 'control: UPDATE_FIELDS.pet has no kind');
  console.log(`  vehicle kinds (${typeKinds.length}): type, prompt, list_add and update_record agree`);
}

// --- TimelineEntry: every field is the assistant's to write, or says why not --
//
// FamilyTimeline.entries is covered above, but "the list is writable" says
// nothing about the fields inside a moment. Two go wrong in opposite
// directions: a field the model is offered but aiApply never copies (the Apply
// card says done, nothing lands), and a field the MODEL could set that only
// the app should — `source` and `importBatchId`. An import's Undo removes
// every row carrying its batch id; a model that could write one could make a
// family's Undo take its own moments with it. So every key of TimelineEntry
// is named here as model-written (with the prompt's key for it) or app-only
// (with the reason), and both halves are checked against the prompt, the
// update whitelist and a real run of applyTimelineEdits.
{
  const serverSrc = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
  const destructiveSrc = fs.readFileSync(path.join(repoRoot, 'src/utils/aiDestructive.ts'), 'utf8');

  // entry field → the item key the prompt offers for it.
  const MODEL_WRITES: Record<string, string> = {
    title: 'title', date: 'date', category: 'category', memberIds: 'members',
    place: 'place', endDate: 'endDate', note: 'note',
  };
  const APP_ONLY: Record<string, string> = {
    id: 'Generated by applyTimelineEdits; the model never chooses an id.',
    datePrecision: 'Derived from the shape of "date" (YYYY or YYYY-MM); an explicit value may only make a date coarser.',
    type: 'The legacy kind, read through categoryOfEntry() and never written by anything new.',
    photos: 'Uploaded from the moment form into Storage; the model never holds image bytes or a Storage path.',
    docIds: 'Linked by hand on the moment form, where the person can see which paper they are pinning.',
    source: 'Set by the app: always "assistant" on this path, "import" from the dates import, "manual" from the form.',
    importBatchId: 'Set only by the dates import, so its Undo removes exactly that batch; never the model\'s to claim.',
  };

  function timelineFieldGaps(src: { types: string; server: string; destructive: string }): string[] {
    const gaps: string[] = [];
    const body = (/export interface TimelineEntry \{\n([\s\S]*?)\n\}\n/.exec(src.types) || [])[1] || '';
    const keys = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
    if (!keys.length) gaps.push('could not read TimelineEntry from types.ts');
    for (const k of keys) {
      if (!(k in MODEL_WRITES) && !(k in APP_ONLY)) gaps.push(`TimelineEntry.${k} is neither model-written nor app-only`);
    }
    for (const k of [...Object.keys(MODEL_WRITES), ...Object.keys(APP_ONLY)]) {
      if (!keys.includes(k)) gaps.push(`map names TimelineEntry.${k}, which no longer exists`);
    }
    const at = src.server.indexOf('life timeline → list="timeline" (');
    const prompt = at < 0 ? '' : src.server.slice(at, src.server.indexOf(');', at));
    if (!prompt) gaps.push('server.js no longer describes list="timeline"');
    for (const [field, itemKey] of Object.entries(MODEL_WRITES)) {
      if (!new RegExp(`[(,] ?${itemKey}\\b`).test(prompt)) gaps.push(`the timeline prompt never offers "${itemKey}" (for ${field})`);
    }
    for (const k of ['source', 'importBatchId', 'photos', 'docIds', 'id']) {
      if (new RegExp(`[(,] ?${k}\\b`).test(prompt)) gaps.push(`the timeline prompt offers app-only "${k}"`);
    }
    const row = (/^\s*timeline: \{([^}]*)\},?$/m.exec(src.destructive) || [])[1] || '';
    if (!row) gaps.push('could not read UPDATE_FIELDS.timeline from aiDestructive.ts');
    for (const k of ['source', 'importBatchId', 'photos', 'docIds', 'id']) {
      if (new RegExp(`\\b${k}:`).test(row)) gaps.push(`UPDATE_FIELDS.timeline lets the model patch app-only "${k}"`);
    }
    return gaps;
  }

  const real = { types: typesSrc, server: serverSrc, destructive: destructiveSrc };
  assert.deepStrictEqual(timelineFieldGaps(real), [], 'TimelineEntry fields and the assistant\'s timeline paths have drifted apart');

  // CONTROL: every check must be able to fail.
  const cases: [string, typeof real][] = [
    ['TimelineEntry.mood is neither', { ...real, types: typesSrc.replace('export interface TimelineEntry {\n', 'export interface TimelineEntry {\n  mood?: string;\n') }],
    ['never offers "place"', { ...real, server: serverSrc.replace('], place, endDate [', '], endDate [') }],
    ['prompt offers app-only "importBatchId"', { ...real, server: serverSrc.replace('], place, endDate [', '], place, importBatchId, endDate [') }],
    ['patch app-only "source"', { ...real, destructive: destructiveSrc.replace("timeline: { date: 'date',", "timeline: { source: 'source', date: 'date',") }],
    ['map names TimelineEntry.importBatchId', { ...real, types: typesSrc.replace(/\n\s*importBatchId\?: string;[^\n]*/, '') }],
  ];
  for (const [expect, broken] of cases) {
    const gaps = timelineFieldGaps(broken);
    assert.ok(gaps.some((g) => g.includes(expect)), `CONTROL: breaking "${expect}" must be reported, got ${JSON.stringify(gaps)}`);
  }

  // And a real run: what the model sends beyond the whitelist never lands,
  // and the row says it came from the assistant.
  const { applyTimelineEdits } = await import('./aiApply');
  const item: Record<string, string> = {
    title: 'Moved house', date: '2019-06-14', category: 'home', members: '', place: 'Graz',
    endDate: '2019-06-20', note: 'Rainy', source: 'import', importBatchId: 'batch-x', id: 'tl-x', docIds: 'd1', photos: 'p',
  };
  const { timeline } = applyTimelineEdits({ entries: [] }, [{ kind: 'list_add', list: 'timeline', item }], []);
  const row = timeline.entries[0] as unknown as Record<string, unknown>;
  assert.equal(row.source, 'assistant', 'an assistant row is marked source "assistant", whatever the model sent');
  assert.equal('importBatchId' in row, false, 'the model can never put a row into an import batch');
  assert.notEqual(row.id, 'tl-x', 'the model never chooses the id');
  for (const k of Object.keys(row)) {
    assert.ok(k in MODEL_WRITES || k === 'id' || k === 'source' || k === 'datePrecision', `applyTimelineEdits wrote unexpected key "${k}"`);
  }
  for (const k of ['title', 'date', 'category', 'place', 'endDate', 'note']) {
    assert.ok(k in row, `CONTROL: a full item must reach the store with "${k}" — the whitelist check above proves nothing on an empty row`);
  }
  console.log(`  TimelineEntry fields: ${Object.keys(MODEL_WRITES).length} model-written, ${Object.keys(APP_ONLY).length} app-only (${cases.length} controls fail as they should)`);
}

// --- Report -----------------------------------------------------------------

const coveredFields = Object.entries(COVERAGE_MAP).filter(([, e]) => e.status === 'covered').map(([f]) => f).sort();
const manualFields = Object.entries(COVERAGE_MAP).filter(([, e]) => e.status === 'manual').map(([f]) => f).sort();
const gapFields = Object.entries(COVERAGE_MAP).filter(([, e]) => e.status === 'known_gap').map(([f]) => f).sort();

console.log('aiEditCoverage.test.ts: all assertions passed');
console.log(`  covered (${coveredFields.length}): ${coveredFields.join(', ')}`);
console.log(`  manual-only (${manualFields.length}): ${manualFields.join(', ')}`);
if (gapFields.length) console.log(`  known gaps (${gapFields.length}, tracked deliberately): ${gapFields.join(', ')}`);
