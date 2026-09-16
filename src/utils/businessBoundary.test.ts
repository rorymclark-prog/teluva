/**
 * THE BUSINESS BOUNDARY.
 *
 * A business space reuses the family's collections, its rules and most of its
 * screens. That reuse is deliberate and was audited and kept — but it means one
 * sentence in firestore.rules has to give two different answers, and every
 * guard here exists because the family answer is catastrophic in a business.
 *
 * These are STRUCTURAL guards, run on every `npm test`. They notice a carve-out
 * deleted while tidying. What actually happens is asserted against the real
 * rules engine in firestore-rules.test.mjs (`npm run test:rules`), which is
 * where the boundary is proven — see that file's header for why both exist.
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BUSINESS_ROLE_PRESETS } from './businessRoles';

let n = 0;
const check = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

const root = join(import.meta.dirname ?? __dirname, '..', '..');
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
const db = readFileSync(join(root, 'src/utils/db.ts'), 'utf8');
const dash = readFileSync(join(root, 'src/components/Dashboard.tsx'), 'utf8');
const emulator = readFileSync(join(root, 'firestore-rules.test.mjs'), 'utf8');
const serverJs = readFileSync(join(root, 'server.js'), 'utf8');

/* ── the rule that gives two answers ─────────────────────────────────────── */

const memberRule = rules.slice(
  rules.indexOf('match /family_members/{memberId}'),
  rules.indexOf('match /metadata/{docId}'),
);
check('there is a business branch on the member rule at all',
  /isBusinessSpace\(familyId\)/.test(memberRule));
check('read is gated', /allow read: if isMemberOf\(familyId\)\s*\n\s*&& \(!isBusinessSpace/.test(memberRule));
check('create is gated', /allow create: if canWriteIn\(familyId\)\s*\n\s*&& \(!isBusinessSpace/.test(memberRule));
check('update and delete are gated too — reading and overwriting are the same secret',
  /allow update, delete: if canWriteIn\(familyId\)\s*\n\s*&& \(!isBusinessSpace/.test(memberRule));

/* Create must test the INCOMING document (there is no old one) and update must
   test the EXISTING one (or an employee writes their own email onto a
   colleague's record and owns it). Getting these the same way round is the
   single most likely way to reintroduce the hole. */
const createLine = memberRule.slice(memberRule.indexOf('allow create'), memberRule.indexOf('allow update'));
const updateLine = memberRule.slice(memberRule.indexOf('allow update'));
check('create judges the incoming document', /ownsMemberRecord\(request\.resource\.data\)/.test(createLine));
check('update judges the existing one', /ownsMemberRecord\(resource\.data\)/.test(updateLine)
  && !/ownsMemberRecord\(request\.resource\.data\)/.test(updateLine));

/* Ownership is read off the document being fetched. A version that consulted a
   list, a claim, or anything the caller supplies would be forgeable. */
const owns = rules.slice(rules.indexOf('function ownsMemberRecord'), rules.indexOf('function ownsMemberRecord') + 400);
check('ownership is proven by the document, never by the request body',
  /data\.linkedUid == request\.auth\.uid/.test(owns)
  && /data\.email == request\.auth\.token\.email/.test(owns)
  && !/request\.resource\.data\.linkedUid/.test(owns));
check('both fields are existence-checked before use',
  /'linkedUid' in data/.test(owns) && /'email' in data/.test(owns));

/* The space type comes from a server-written document. If this ever reads
   something a client can write, every employee promotes themselves by editing
   their own space out of business mode. */
const biz = rules.slice(rules.indexOf('function isBusinessSpace'), rules.indexOf('function ownsMemberRecord'));
check('the space type is read from info/info, which only the Admin SDK writes',
  /families\/\$\(familyId\)\/info\/info/.test(biz));
check('and an unknown type defaults to family, not to business',
  /\.get\('type', 'family'\)/.test(biz));

/* ── the app has to survive being refused ────────────────────────────────── */

/* metadata/members still lists everybody — the index is not secret. So an
   employee's load asks for documents it will be refused, and Promise.all would
   take the whole app down with the first one. */
check('member loading tolerates refused documents',
  /Promise\.allSettled\(membersReqs\)/.test(db) && !/Promise\.all\(membersReqs\)/.test(db));
check('and a refusal is filtered out rather than becoming an undefined member',
  /r\.status === 'fulfilled'/.test(db));
check('an employee is told why they see only themselves',
  /isBusinessSpace && !isAdmin/.test(dash) && /nothing is missing or broken/.test(dash));

/* ── THE LANDMINE. Read this before gating any reveal by role. ───────────── */

/* revealCached returns '' for a ciphertext it cannot decrypt, and
   saveFamilyMembers writes the merged result straight back. So any role that is
   refused a decrypt AND can write a member document will silently overwrite
   real ID numbers with empty strings on the next save.
   
   Today exactly one role is short-circuited out of reveals — 'child' — and
   canWriteIn excludes children, which is the only reason this has never fired.
   That is a coincidence of two unrelated rules, not a design. The obvious
   "fix" for business spaces (gate /api/vault/reveal-shared to admins) would
   have armed it immediately: employees would have been refused a decrypt and
   can write their own record. It was not done, and the boundary was put in the
   rules instead, where an employee never obtains a colleague's ciphertext at
   all and their OWN reveals keep working. */
check('only the child role short-circuits reveals',
  /accountRole === 'child'/.test(db)
  && (db.match(/accountRole === '/g) || []).length === 1);
check('and children cannot write, which is what makes that safe',
  /roleIn\(familyId\) != 'child'/.test(rules));
check('the empty-string fallback is still the behaviour this guard is about',
  /cache\[v\] \?\? ''/.test(readFileSync(join(root, 'src/utils/vaultFields.ts'), 'utf8')));

/* ── the presets are labels, and must never be mistaken for permissions ──── */

check('the business role presets are plain strings',
  BUSINESS_ROLE_PRESETS.every((r) => typeof r === 'string') && BUSINESS_ROLE_PRESETS.includes('Intern'));
check('nothing in the rules consults them',
  !BUSINESS_ROLE_PRESETS.some((r) => rules.includes(`'${r}'`)));

/* Hiding a view is cosmetic. It is listed here so nobody mistakes the list for
   a boundary — willsEstate is hidden in business spaces AND locked by rule. */
check('view hiding exists but is not where medical or IDs are protected',
  /HIDDEN_VIEWS_IN_BUSINESS/.test(dash) && !/HIDDEN_VIEWS_IN_BUSINESS.*'medical'/.test(dash));

/* ── the engine test must actually cover both answers ────────────────────── */

check('the emulator suite seeds a business space',
  /type: 'business'/.test(emulator));
check('it asserts an employee is refused a colleague',
  /an employee reads a colleague record/.test(emulator));
check('it asserts the owner is NOT locked out by the same rule',
  /the owner still reads every record/.test(emulator));
check('and it asserts the family side still works — the other answer',
  /a parent reads a family member record/.test(emulator));
check('including the claim-by-writing-your-own-email attack',
  /claim a colleague record by writing their own email/.test(emulator));

check('including the LIST case, which a per-document rule answers differently',
  /cannot LIST the member collection/.test(emulator));

/* ── the client shape the rule depends on ────────────────────────────────── */

/* Firestore fails a whole query when ONE returned document fails the rule, so
   a per-record rule like this one means an employee cannot list the
   collection at all — it does not hand them a filtered subset. The app is
   already built the only way that works: an index of ids, then one getDoc
   each. Collapsing those into a single query is the obvious performance win
   and would lock every employee out of their own space, so it is pinned here
   rather than left as folklore in a comment. */
check('members are fetched one id at a time, never as a collection query',
  /getDoc\(doc\(db, 'families', FAMILY_ID, 'family_members', id\)\)/.test(db)
  && !/getDocs\(collection\(db, 'families', FAMILY_ID, 'family_members'/.test(db));
check('and one refusal does not sink the other members',
  /Promise\.allSettled\(membersReqs\)/.test(db));

/* ── the other side of the boundary: what an employee DOES get ───────────── */

/* A rule that answers "no" to everything is safe and useless. v331 pairs the
   HR-file rule with the small question it does not cover — who works here —
   answered from the server because rules gate DOCUMENTS and this needs a
   field boundary, which is not something rules can express. */
const directory = readFileSync(join(root, 'server/directory.mjs'), 'utf8');
const teamUi = readFileSync(join(root, 'src/components/TeamDirectory.tsx'), 'utf8');

check('there is a directory projection, and it is an allowlist',
  /export const DIRECTORY_FIELDS/.test(directory)
  && /for \(const key of DIRECTORY_FIELDS\)/.test(directory));
check('it never spreads the member document',
  !/\.\.\.member/.test(directory) && !/delete out\[/.test(directory));
check('the HR fields are not on the list',
  !/'medical'/.test(directory) && !/'identifiers'/.test(directory)
  && !/'taxNumber'/.test(directory) && !/'documents'/.test(directory));
check('nor personal contact, which has work-facing equivalents instead',
  !/^\s*'phone',/m.test(directory) && !/^\s*'email',/m.test(directory)
  && !/^\s*'address',/m.test(directory)
  && /'workPhone'/.test(directory) && /'workAddress'/.test(directory));
check('nor the two that need consent in Austria — birthday and face',
  !/'birthdate'/.test(directory) && !/'avatarUrl'/.test(directory));

const dirEndpoint = serverJs.slice(
  serverJs.indexOf("app.post('/api/business/directory'"),
  serverJs.indexOf("app.post('/api/wills-release/state'"),
);
check('the endpoint exists and requires membership', /requireMember\(req\)/.test(dirEndpoint));
check('and refuses to serve a household, which would make it a member reader',
  /type !== 'business'/.test(dirEndpoint));
check('the response is built by the shared projection, never assembled inline',
  /buildDirectory\(/.test(dirEndpoint));

/* A row that opens a screen this account cannot read is worse than a row that
   does nothing, so the directory is deliberately not navigable. */
check('directory rows do not pretend to open a profile',
  !/onGo|onClick=\{\(\) => on/.test(teamUi));
check('and the screen says what it is NOT showing, not only what it is',
  /stay between each person and an owner of this space/.test(teamUi));

/* ── v333: the company's money, and whose birthday is team news ──────────── */

check('the finances doc is admin-only in a business space',
  /match \/reference\/finances \{\s*\n\s*allow read, write: if canWriteIn\(familyId\)\s*\n\s*&& \(!isBusinessSpace\(familyId\) \|\| isAdminOf\(familyId\)\);/.test(rules));
check('and the engine agrees, for reads AND writes',
  /an employee reads the company finances/.test(emulator)
  && /an employee writes them/.test(emulator));
check('while a business space keeps its other shared documents',
  /an employee still reads the shared household doc/.test(emulator));

/* THE CLIENT COMPANION v333 SHIPPED WITHOUT. The rule refuses the read, but
 * the Finances/Insurance tabs stayed visible to a business employee — the
 * child-only gate (`!canWrite`) never learned about the new business/admin
 * one. Clicking in did not error (loadReferenceDoc purges permission-denied
 * to null, same as willsEstate) but rendered an empty screen where a tab
 * simply not being there was the honest answer. Cosmetic, exactly like
 * willsEstate's HIDDEN_VIEWS_IN_BUSINESS entry below — the rule is still the
 * only real boundary — but "an employee should not see Finances" is part of
 * what this feature promises, not just "cannot read the data if they try". */
check('finances/insurance are hidden from a business non-admin, not just from children',
  /\(view\.id === 'finances' \|\| view\.id === 'insurance'\) && isBusinessSpace && !isAdmin/.test(dash));
check('the child-only gate is untouched — a household member still sees finances exactly as before',
  /\(view\.id === 'finances' \|\| view\.id === 'insurance'\) && !canWrite\)/.test(dash));

/* Not a list-query hazard: unlike family_members, reference/finances is a
 * single document fetched with one getDoc — there is no getDocs(collection)
 * over reference/ for a bad doc to sink. Pinned so nobody "optimises" this
 * into a collection query later and reintroduces the family_members failure
 * mode one document over. */
check('reference/finances is read as one document, never listed as a collection',
  /getDoc\(doc\(db, 'families', FAMILY_ID, 'reference', key\)\)/.test(db)
  && !/getDocs\(collection\(db, 'families', FAMILY_ID, 'reference'/.test(db));

/* Two switches the app has honoured for months and the cron never read. A
   panel that writes a setting nothing re-reads is the recurring shape here. */
const cron = serverJs.slice(serverJs.indexOf('THE TWO SWITCHES THIS CRON IGNORED'));
check('the cron reads the per-space celebrations switch',
  /const celebrationsOff = spaceSettings\.celebrationsEnabled === false;/.test(cron));
check('and the per-person "no fuss" opt-out',
  /mem\.noCelebrations === true/.test(cron));
/* A `continue` here would also skip PASS 1, which resolves movable dates for
   the published feed and the in-app countdown. Opting out of being
   congratulated is not opting out of appearing on the calendar. */
check('the opt-out suppresses the push, not the date resolution',
  /const quiet = celebrationsOff \|\| mem\.noCelebrations === true;/.test(cron)
  && !/if \(celebrationsOff \|\| mem\.noCelebrations\) continue;/.test(cron));

check('a personal celebration goes to admins only in a business space',
  /const send = \(spaceIsBusiness && c\.personal\) \? sendToAdmins : sendToFamily;/.test(cron));
check('a birthday is personal',
  /body: `Wish \$\{name\} a happy birthday today\.`,\n\s*personal: true,/.test(cron));
check('the company\u2019s own founding anniversary is NOT, and still goes to everyone',
  /personal: false,/.test(cron));
check('and the withheld-birthday reasoning matches the directory\u2019s',
  /Art\. 6\(1\)\(a\) CONSENT/.test(cron) && /consent/i.test(directory));

/* The justification for a field must be true on the day it ships. startDate
   was included on the claim that the cron already announced work
   anniversaries team-wide; it does not, and they are computed client-side
   from a member list that since v330 excludes colleagues. */
check('startDate is off the directory, and why is written down',
  !/^\s*'startDate',/m.test(directory) && /THAT WAS FALSE/.test(directory));

console.log(`businessBoundary.test.ts: ${n} assertions passed.`);
