// Behavioural test of firestore.rules, run against the REAL rules engine in
// the Firestore emulator. Not part of `npm test` — it needs Java and a
// downloaded emulator, which the plain test chain deliberately doesn't
// assume. Run it before any change to firestore.rules:
//
//   npm run test:rules
//
// It exits non-zero on failure.
//
// WHY THIS EXISTS, and why the regex guard in src/utils/willsAccess.test.ts
// is not enough on its own: when the v230 will lock was written, the rules
// text read correctly, the app-side predicates were correct, and the regex
// guard passed — and this probe still found a live hole. isNamedWillReader()
// used isMemberOf(), so a CHILD whose uid was on the access list could read
// the will at the server, even though utils/willsAccess.ts refused it in the
// UI. Nothing that reads the rules as text would have caught that; only
// asking the engine did.
//
// The two tests are complements. The regex guard runs on every `npm test` and
// notices structural damage (a carve-out deleted while tidying up). This one
// asks what actually happens.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// fileURLToPath, never url.pathname — a path containing a space arrives
// percent-encoded through .pathname and the read silently fails.
const here = dirname(fileURLToPath(import.meta.url));
const RULES = resolve(here, 'firestore.rules');
const [EMU_HOST, EMU_PORT] = (() => {
  const raw = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const i = raw.lastIndexOf(':');
  return [raw.slice(0, i) || '127.0.0.1', Number(raw.slice(i + 1))];
})();

const FAM = 'household';
const BIZ = 'carework';        // a BUSINESS space — info/info.type === 'business'

const env = await initializeTestEnvironment({
  projectId: 'rules-probe',
  // Where the emulator actually is, from the variable emulators:exec exports.
  // Hardcoding 8080 here meant this probe and firebase.json could disagree,
  // and that a sibling project's emulator holding the default port failed the
  // deploy with "port taken" rather than anything to do with the rules.
  firestore: { rules: readFileSync(RULES, 'utf8'), host: EMU_HOST, port: EMU_PORT },
});

// Seed roles and documents with the rules switched off — this is the fixture,
// not part of what's under test.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `families/${FAM}/roles/u-admin`), { role: 'admin' });
  await setDoc(doc(db, `families/${FAM}/roles/u-mem`),   { role: 'member' });
  await setDoc(doc(db, `families/${FAM}/roles/u-mem2`),  { role: 'member' });
  await setDoc(doc(db, `families/${FAM}/roles/u-kid`),   { role: 'child' });
  await setDoc(doc(db, `families/${FAM}/reference/willsEstate`), { records: [{ id: 'e1', kind: 'Will' }] });
  await setDoc(doc(db, `families/${FAM}/reference/household`),   { address: 'Somewhere' });
  await setDoc(doc(db, `families/${FAM}/reference/finances`),    { banks: [{ id: 'b1', name: 'Bank' }] });

  /* ── A BUSINESS space, for the employee-access tests ────────────────────
   * Same collections, same roles, one different field on info/info. The two
   * spaces are seeded side by side on purpose: the point of these tests is
   * that ONE rule gives two answers, so both answers must be asserted from
   * the same rules file in the same run. */
  await setDoc(doc(db, `families/${BIZ}/info/info`), { type: 'business', name: 'Care Work' });
  await setDoc(doc(db, `families/${BIZ}/roles/u-owner`), { role: 'admin' });
  await setDoc(doc(db, `families/${BIZ}/roles/u-emp`),   { role: 'member' });
  await setDoc(doc(db, `families/${BIZ}/roles/u-emp2`),  { role: 'member' });
  await setDoc(doc(db, `families/${BIZ}/roles/u-intern`), { role: 'child' });
  // A colleague's record, with the fields an employee must never reach.
  await setDoc(doc(db, `families/${BIZ}/family_members/m-colleague`), {
    id: 'm-colleague', name: 'Anna', email: 'anna@example.com',
    medical: { conditions: 'epilepsy' }, address: 'Home address', dob: '1988-04-02',
  });
  // The employee's OWN record, matched by email — the fallback path.
  await setDoc(doc(db, `families/${BIZ}/family_members/m-emp`), {
    id: 'm-emp', name: 'Employee', email: 'emp@example.com',
  });
  // And one matched by the explicit link an admin sets.
  await setDoc(doc(db, `families/${BIZ}/family_members/m-emp2`), {
    id: 'm-emp2', name: 'Employee Two', linkedUid: 'u-emp2',
  });
  // Three activity entries, one per visibility tier.
  await setDoc(doc(db, `families/${FAM}/activity/a-all`),
    { id: 'a-all', at: '2026-08-29T10:00:00Z', actorUid: 'u-admin', actorName: 'Admin', kind: 'assets', action: 'added', visibility: 'all' });
  await setDoc(doc(db, `families/${FAM}/activity/a-adults`),
    { id: 'a-adults', at: '2026-08-29T11:00:00Z', actorUid: 'u-admin', actorName: 'Admin', kind: 'finances', action: 'updated', visibility: 'adults' });
  await setDoc(doc(db, `families/${FAM}/activity/a-admin`),
    { id: 'a-admin', at: '2026-08-29T12:00:00Z', actorUid: 'u-admin', actorName: 'Admin', kind: 'willsEstate', action: 'updated', visibility: 'admin' });
  // The company's banking, which an employee must not read.
  await setDoc(doc(db, `families/${BIZ}/reference/finances`), { banks: [{ id: 'b1', name: 'Company Bank', iban: 'AT61...' }] });
  // And a business household doc, to prove the finances answer is specific to
  // finances rather than a business space losing every shared document.
  await setDoc(doc(db, `families/${BIZ}/reference/household`), { address: 'Office' });
  // The family space gets a member record too, to prove nothing changed there.
  await setDoc(doc(db, `families/${FAM}/family_members/m-kid`), {
    id: 'm-kid', name: 'Child', medical: { conditions: 'asthma' },
  });
});

const ctxFor = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const wills = (db) => doc(db, `families/${FAM}/reference/willsEstate`);
const acl   = (db) => doc(db, `families/${FAM}/reference/willsAccess`);
const house = (db) => doc(db, `families/${FAM}/reference/household`);

const admin = ctxFor('u-admin');
const mem = ctxFor('u-mem');
const mem2 = ctxFor('u-mem2');
const kid = ctxFor('u-kid');
const stranger = ctxFor('u-nobody');                       // signed in, not in this family
const anon = env.unauthenticatedContext().firestore();

let n = 0;
const allowed = async (label, p) => { await assertSucceeds(p); console.log(`  ok      ${label}`); n++; };
const refused = async (label, p) => { await assertFails(p);    console.log(`  refused ${label}`); n++; };

console.log('\n── willsEstate, no access list yet: admins only ──');
await allowed('admin reads it',                       getDoc(wills(admin)));
await refused('a member reads it',                    getDoc(wills(mem)));
await refused('a child reads it',                     getDoc(wills(kid)));
await refused('someone outside the family reads it',  getDoc(wills(stranger)));
await refused('a signed-out client reads it',         getDoc(wills(anon)));

console.log('\n── writing willsEstate: admins only, always ──');
await allowed('admin writes it',                      setDoc(wills(admin), { records: [] }));
await refused('a member writes it',                   setDoc(wills(mem), { records: [] }));
await refused('a child writes it',                    setDoc(wills(kid), { records: [] }));

console.log('\n── the access list itself ──');
await refused('a member adds THEMSELF to the list',   setDoc(acl(mem), { readerUids: ['u-mem'] }));
await allowed('a member reads the list',              getDoc(acl(mem)));
await allowed('an admin writes the list',             setDoc(acl(admin), { readerUids: ['u-mem'] }));

console.log('\n── once named ──');
await allowed('the named member reads the will',      getDoc(wills(mem)));
await refused('the named member WRITES the will',     setDoc(wills(mem), { records: [] }));
await refused('a different member still reads it',    getDoc(wills(mem2)));

console.log('\n── a child on the list is still refused ──');
// The realistic path to this state: granted while on a `member` role, later
// moved to `child`. The grant survives the demotion; the rule must not.
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `families/${FAM}/reference/willsAccess`), { readerUids: ['u-mem', 'u-kid'] });
});
await refused('a child named on the list reads it',   getDoc(wills(kid)));
await allowed('the named member is unaffected',       getDoc(wills(mem)));

console.log('\n── estate invites: the pending list is admin-writable only (v233) ──');
// pendingReaders rides on the SAME document, and it is a grant in waiting: the
// uid that redeems the invite behind a row is added to readerUids by the
// server. So every write path to it has to be an admin's, including the two
// array operations the app itself uses (cancel = arrayRemove from the admin
// panel). A member who could append a row could name themselves an heir.
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `families/${FAM}/reference/willsAccess`), {
    readerUids: ['u-mem'],
    pendingReaders: [{ id: 'p1', name: 'Carl', invitedAt: '2026-08-20T00:00:00.000Z' }],
  });
});
await refused('a member appends a pending invite',    updateDoc(acl(mem), { pendingReaders: arrayUnion({ id: 'p2', name: 'Me', invitedAt: 'x' }) }));
await refused('a member withdraws an invite',         updateDoc(acl(mem), { pendingReaders: arrayRemove({ id: 'p1', name: 'Carl', invitedAt: '2026-08-20T00:00:00.000Z' }) }));
await refused('a child appends a pending invite',     updateDoc(acl(kid), { pendingReaders: arrayUnion({ id: 'p3', name: 'Kid', invitedAt: 'x' }) }));
await allowed('an admin withdraws an invite',         updateDoc(acl(admin), { pendingReaders: arrayRemove({ id: 'p1', name: 'Carl', invitedAt: '2026-08-20T00:00:00.000Z' }) }));

console.log('\n── finances: adults only (role matrix, 2026-08-24) ──');
// Children get NO access to the finances document — not read-only, none.
// The Dashboard nav has hidden 'finances' from child accounts since it
// shipped; until now that was a UI courtesy the server never backed up.
const fin = (db) => doc(db, `families/${FAM}/reference/finances`);
await allowed('admin reads finances',                 getDoc(fin(admin)));
await allowed('a member reads finances',              getDoc(fin(mem)));
await allowed('a member writes finances',             setDoc(fin(mem), { banks: [] }));
await refused('a child reads finances',               getDoc(fin(kid)));
await refused('a child writes finances',              setDoc(fin(kid), { banks: [] }));
await refused('someone outside the family reads it',  getDoc(fin(stranger)));
await refused('a signed-out client reads it',         getDoc(fin(anon)));

console.log('\n── the carve-out must not break every OTHER reference doc ──');
await allowed('a member reads household',             getDoc(house(mem)));
await allowed('a member writes household',            setDoc(house(mem), { address: 'Elsewhere' }));
await allowed('a child reads household',              getDoc(house(kid)));
await refused('a child writes household',             setDoc(house(kid), { address: 'Nope' }));

console.log('\n\u2500\u2500 linked families: the whole collection is server-only \u2500\u2500');
// familyLinks/{id} carries the two household ids and each side's share list.
// No client ever touches it: the /api/family-link/* endpoints read and write it
// with admin credentials, and every profile that crosses a link is projected
// through server/familyLink.mjs's allowlist first. If a rule is ever added here
// by mistake, these four lines are what catches it.
const flink = (db) => doc(db, 'familyLinks/link-1');
await refused('an admin reads a family link',         getDoc(flink(admin)));
await refused('an admin writes a family link',        setDoc(flink(admin), { aId: FAM, bId: 'other' }));
await refused('a member reads a family link',         getDoc(flink(mem)));
await refused('a signed-out client reads one',        getDoc(flink(anon)));

console.log('\n\u2500\u2500 BUSINESS spaces: a colleague record is an HR file, not a profile \u2500\u2500');
/* The finding this closes: business spaces reused the family's flat model, so
 * one rule said "any member reads every member". In a household that is the
 * whole point. In a business it means every employee may open every
 * colleague's medical history, home address and date of birth — and the
 * Owner/Manager/Employee presets that look like permissions are text on a
 * profile field, granting and gating nothing. */
const bizOwner  = env.authenticatedContext('u-owner',  { email_verified: true, email: 'owner@example.com' }).firestore();
const bizEmp    = env.authenticatedContext('u-emp',    { email_verified: true, email: 'emp@example.com' }).firestore();
const bizEmp2   = env.authenticatedContext('u-emp2',   { email_verified: true, email: 'two@example.com' }).firestore();
const bizIntern = env.authenticatedContext('u-intern', { email_verified: true, email: 'intern@example.com' }).firestore();
const bizStranger = ctxFor('u-nobody');

const colleague = (db) => doc(db, `families/${BIZ}/family_members/m-colleague`);
const ownRec    = (db) => doc(db, `families/${BIZ}/family_members/m-emp`);
const linkedRec = (db) => doc(db, `families/${BIZ}/family_members/m-emp2`);

await refused('an employee reads a colleague record',   getDoc(colleague(bizEmp)));
await refused('an employee EDITS a colleague record',   updateDoc(colleague(bizEmp), { name: 'Renamed' }));
await refused('an intern reads a colleague record',     getDoc(colleague(bizIntern)));
await refused('somebody outside the business reads it', getDoc(colleague(bizStranger)));
await allowed('the owner still reads every record',     getDoc(colleague(bizOwner)));
await allowed('the owner still edits every record',     updateDoc(colleague(bizOwner), { name: 'Anna' }));

await allowed('an employee reads their OWN record (matched by email)', getDoc(ownRec(bizEmp)));
await allowed('an employee edits their OWN record',      updateDoc(ownRec(bizEmp), { name: 'Employee' }));
await allowed('and linkedUid works as well as email',    getDoc(linkedRec(bizEmp2)));
await refused('one employee cannot read another\u2019s',    getDoc(linkedRec(bizEmp)));

/* Claiming a colleague's record by writing your own email onto it is the
 * obvious way round this, so it is asserted rather than assumed: the update
 * rule tests the EXISTING document, not the one being written. */
await refused('an employee cannot claim a colleague record by writing their own email onto it',
  updateDoc(colleague(bizEmp), { email: 'emp@example.com' }));

/* A record with neither field is nobody's, and must not become everybody's. */
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), `families/${BIZ}/family_members/m-orphan`), { id: 'm-orphan', name: 'Unlinked' });
});
await refused('an unlinked record is nobody\u2019s, not everybody\u2019s',
  getDoc(doc(bizEmp, `families/${BIZ}/family_members/m-orphan`)));

/* LISTING THE COLLECTION, which is a different question from reading a doc.
 *
 * Firestore evaluates a list against every document it would return and fails
 * the WHOLE query if one of them fails, so a per-document rule like this one
 * makes `getDocs(collection(...family_members))` refuse for an employee — not
 * return a filtered subset. That is the correct answer, and the client is
 * already built for it: db.ts fetches members one getDoc at a time from an
 * index of ids (see the allSettled in loadMembers). businessBoundary.test.ts
 * holds that shape in place on every `npm test`.
 *
 * This pair is here because the tempting "optimisation" — collapse N reads
 * into one query — would break the app for every employee, and the failure
 * would look like a rules bug rather than a client one. */
/* THE COMPANY'S MONEY. The adults-only finances rule was written for a
 * household, where every adult genuinely shares the bank accounts. The same
 * words in a business space mean every employee reads the company's IBANs,
 * insurance policies and benefit arrangements — the identical mistake v330
 * fixed one collection over. */
const bizFin = (db) => doc(db, `families/${BIZ}/reference/finances`);
await refused('an employee reads the company finances',  getDoc(bizFin(bizEmp)));
await refused('an employee writes them',                 setDoc(bizFin(bizEmp), { banks: [] }));
await refused('an intern reads them',                    getDoc(bizFin(bizIntern)));
await allowed('the owner still reads them',              getDoc(bizFin(bizOwner)));
await allowed('and still writes them',                   setDoc(bizFin(bizOwner), { banks: [] }));
/* Specific to finances — a business space must not lose every shared doc. */
await allowed('an employee still reads the shared household doc',
  getDoc(doc(bizEmp, `families/${BIZ}/reference/household`)));

await refused('an employee cannot LIST the member collection',
  getDocs(collection(bizEmp, `families/${BIZ}/family_members`)));
await allowed('an owner still can',
  getDocs(collection(bizOwner, `families/${BIZ}/family_members`)));
/* And in a household a list is fine, which is why this cannot simply be
 * forbidden outright for everyone. */
await allowed('a family member can list theirs',
  getDocs(collection(mem, `families/${FAM}/family_members`)));

console.log('\n\u2500\u2500 the activity trail: three tiers, and the list contract \u2500\u2500');
const act = (db, id) => doc(db, `families/${FAM}/activity/${id}`);

await allowed('an admin reads an admin-tier entry',   getDoc(act(admin, 'a-admin')));
await allowed('a member reads an adults-tier entry',  getDoc(act(mem, 'a-adults')));
await refused('a member reads an ADMIN-tier entry',   getDoc(act(mem, 'a-admin')));
await allowed('a child reads an all-tier entry',      getDoc(act(kid, 'a-all')));
await refused('a child reads an adults-tier entry',   getDoc(act(kid, 'a-adults')));
await refused('a stranger reads any of it',           getDoc(act(stranger, 'a-all')));

/* An entry saying "the will was updated" tells a locked-out reader that a will
 * exists and when it was last touched — the exact leak the wills lock exists to
 * stop, which is why the admin tier is asserted from BOTH directions. */
await refused('a child cannot reach the will entry either', getDoc(act(kid, 'a-admin')));

/* THE LIST CONTRACT. A per-document rule fails a whole query when one returned
 * doc fails, so an unfiltered list is refused for everyone but an admin. The
 * client asks with where('visibility','in', <its tier list>), and THAT
 * succeeds — this pair is the contract loadActivity depends on. */
await refused('a member listing the trail unfiltered is refused everything',
  getDocs(collection(mem, `families/${FAM}/activity`)));
await allowed('but the tier-filtered query a member actually sends succeeds',
  getDocs(query(collection(mem, `families/${FAM}/activity`), where('visibility', 'in', ['all', 'adults']))));
await allowed('and a child\u2019s narrower one does too',
  getDocs(query(collection(kid, `families/${FAM}/activity`), where('visibility', 'in', ['all']))));
await refused('a child asking for the adults tier is refused',
  getDocs(query(collection(kid, `families/${FAM}/activity`), where('visibility', 'in', ['all', 'adults']))));
await allowed('an admin lists the whole trail',
  getDocs(collection(admin, `families/${FAM}/activity`)));

/* The entry cannot lie about who made it, and cannot be rewritten afterwards.
 * That is the whole integrity claim — omission by a modified client is still
 * possible, which is why the screen says "changes made in the app". */
await refused('an entry cannot be written under somebody else\u2019s uid',
  setDoc(act(mem, 'a-forged'), { id: 'a-forged', at: '2026-08-29T13:00:00Z', actorUid: 'u-admin', actorName: 'Admin', kind: 'assets', action: 'added', visibility: 'all' }));
await allowed('but a member may write their own',
  setDoc(act(mem, 'a-mine'), { id: 'a-mine', at: '2026-08-29T13:00:00Z', actorUid: 'u-mem', actorName: 'Member', kind: 'assets', action: 'added', visibility: 'all' }));
await refused('and cannot edit it afterwards',
  updateDoc(act(mem, 'a-mine'), { kind: 'recipes' }));
await refused('nor can an admin edit one',
  updateDoc(act(admin, 'a-mine'), { kind: 'recipes' }));
await refused('a child cannot write one at all',
  setDoc(act(kid, 'a-kid'), { id: 'a-kid', at: '2026-08-29T13:00:00Z', actorUid: 'u-kid', actorName: 'Kid', kind: 'assets', action: 'added', visibility: 'all' }));
await refused('an unknown tier is refused rather than stored',
  setDoc(act(mem, 'a-bad'), { id: 'a-bad', at: '2026-08-29T13:00:00Z', actorUid: 'u-mem', actorName: 'Member', kind: 'assets', action: 'added', visibility: 'everyone' }));
/* THE TIER FLOOR. The kind→tier map lives on the phone, so without this the
 * cheapest attack on the whole trail is a modified client writing
 * {kind:'passwords', visibility:'all'} — "Saved passwords were updated", in
 * front of a child. Narrower than the floor is fine; wider is refused. */
const ent = (id, extra) => ({ id, at: '2026-08-29T13:00:00Z', actorUid: 'u-mem',
  actorName: 'Member', action: 'updated', ...extra });
await refused('a passwords entry cannot be labelled readable by everyone',
  setDoc(act(mem, 'a-pw-wide'), ent('a-pw-wide', { kind: 'passwords', visibility: 'all' })));
await refused('nor readable by adults',
  setDoc(act(mem, 'a-pw-adults'), ent('a-pw-adults', { kind: 'passwords', visibility: 'adults' })));
await allowed('at admin tier it is accepted',
  setDoc(act(mem, 'a-pw-ok'), ent('a-pw-ok', { kind: 'passwords', visibility: 'admin' })));
await refused('a will entry cannot be widened either',
  setDoc(act(mem, 'a-will-wide'), ent('a-will-wide', { kind: 'willsEstate', visibility: 'all' })));
await refused('and neither can who-can-open-the-will',
  setDoc(act(mem, 'a-wa-wide'), ent('a-wa-wide', { kind: 'willsAccess', visibility: 'adults' })));
await refused('finances cannot be dropped to the children’s tier',
  setDoc(act(mem, 'a-fin-wide'), ent('a-fin-wide', { kind: 'finances', visibility: 'all' })));
await allowed('but adults is its floor, and is accepted',
  setDoc(act(mem, 'a-fin-ok'), ent('a-fin-ok', { kind: 'finances', visibility: 'adults' })));
await refused('the document vault is held to the same floor',
  setDoc(act(mem, 'a-doc-wide'), ent('a-doc-wide', { kind: 'documents', visibility: 'all' })));
/* Narrowing is always allowed — hiding the shopping list from a child is
 * nobody's problem, and refusing it would make the floor a straitjacket. */
await allowed('an ordinary kind may be labelled NARROWER than its tier',
  setDoc(act(mem, 'a-shop-narrow'), ent('a-shop-narrow', { kind: 'shopping', visibility: 'admin' })));
/* An unknown kind has no floor and lands on the generic checks. That is the
 * right answer: the client fails such a kind closed to 'admin' before it ever
 * gets here, and a rule listing kinds it has never heard of cannot be written. */
await allowed('a kind the rules do not know is left to the client’s fail-closed default',
  setDoc(act(mem, 'a-unknown'), ent('a-unknown', { kind: 'somethingNew', visibility: 'admin' })));

await refused('a member cannot delete an entry',  deleteDoc(act(mem, 'a-mine')));
await allowed('an admin can',                     deleteDoc(act(admin, 'a-mine')));

console.log('\n\u2500\u2500 and the FAMILY side is untouched \u2500\u2500');
/* The same rule, the other answer. A household genuinely shares these records
 * and every adult reading every other IS the feature — if these four lines ever
 * start failing, the business fix has been applied to families by mistake. */
const kidRec = (db) => doc(db, `families/${FAM}/family_members/m-kid`);
await allowed('a parent reads a family member record',  getDoc(kidRec(mem)));
await allowed('another adult reads it too',             getDoc(kidRec(mem2)));
await allowed('an adult edits it',                      updateDoc(kidRec(mem), { name: 'Child' }));
await allowed('a child reads a family member record',   getDoc(kidRec(kid)));
await refused('a child still cannot edit one',          updateDoc(kidRec(kid), { name: 'Nope' }));
await refused('a stranger reads a family member record', getDoc(kidRec(stranger)));

console.log('\n\u2500\u2500 the Gmail bridge token is server-only \u2500\u2500');
/* A bridge token is a WRITE CAPABILITY into this family's vault: whoever holds
 * one can push documents in. The server stores only its hash, and the two
 * places that hash lives must be unreachable from every client — including a
 * member of the family it belongs to, and including the admin who minted it.
 *
 * Both paths are covered today by the top-level deny-all rather than by a rule
 * of their own, which is exactly why this probe is here: "denied because
 * nothing matches it" is a property that disappears the moment somebody adds a
 * broad `match /families/{id}/{document=**}` for an unrelated reason, and no
 * test that reads the rules as text would notice. */
const bridgeDoc = (db) => doc(db, `families/${FAM}/private/gmailBridge`);
const bridgeIndex = (db) => doc(db, 'gmailBridgeTokens/somehash');

await refused('an admin cannot read the stored bridge token hash', getDoc(bridgeDoc(admin)));
await refused('nor can an ordinary member',                        getDoc(bridgeDoc(mem)));
await refused('nor a child',                                       getDoc(bridgeDoc(kid)));
await refused('nor a stranger',                                    getDoc(bridgeDoc(stranger)));
await refused('and nobody can write one, which would forge a token',
  setDoc(bridgeDoc(admin), { tokenHash: 'deadbeef' }));
await refused('the reverse lookup index is unreadable',  getDoc(bridgeIndex(admin)));
await refused('and unwritable — writing it points a token at your own family',
  setDoc(bridgeIndex(stranger), { familyId: FAM }));

console.log('\n── personal prefs (hidden dates "just for me") are the owner\'s alone ──');
/* families/{id}/prefs/{uid} holds whose dates this person has chosen not to
 * see. That choice can be about someone in the same family — which is exactly
 * why no one else may read it, admins included. */
const prefs = (db, uid) => doc(db, `families/${FAM}/prefs/${uid}`);
const hideNora = { hiddenDatePeople: [{ id: 'member:m-nora', name: 'Nora', hiddenAt: '2026-09-14T10:00:00.000Z' }] };

await allowed('a member writes their own prefs',            setDoc(prefs(mem, 'u-mem'), hideNora));
await allowed('and reads them back',                        getDoc(prefs(mem, 'u-mem')));
await allowed('a child keeps their own list too',           setDoc(prefs(kid, 'u-kid'), hideNora));
await allowed('an admin writes their own',                  setDoc(prefs(admin, 'u-admin'), { hiddenDatePeople: [] }));
await refused('another member cannot read them',            getDoc(prefs(mem2, 'u-mem')));
await refused('an admin cannot read a member\'s',           getDoc(prefs(admin, 'u-mem')));
await refused('an admin cannot overwrite a member\'s',      setDoc(prefs(admin, 'u-mem'), { hiddenDatePeople: [] }));
await refused('a stranger cannot write a doc under their own uid here', setDoc(prefs(stranger, 'u-nobody'), hideNora));
await refused('a signed-out client reads nothing',          getDoc(prefs(anon, 'u-mem')));
await refused('only the hidden list may be stored there',   setDoc(prefs(mem, 'u-mem'), { ...hideNora, role: 'admin' }));
await refused('and it must be a list',                      setDoc(prefs(mem, 'u-mem'), { hiddenDatePeople: 'member:m-nora' }));
await allowed('the owner can clear it',                     deleteDoc(prefs(mem, 'u-mem')));

console.log('\n── the family\'s hidden-dates list lives on reference/settings ──');
const settingsDoc = (db) => doc(db, `families/${FAM}/reference/settings`);
const famHidden = { hiddenDatePeople: [{ id: 'extended:eb-klara', name: 'Aunt Klara', hiddenAt: '2026-09-14T10:00:00.000Z', by: 'u-mem' }] };
await allowed('a member can hide someone for everyone',     setDoc(settingsDoc(mem), famHidden));
await allowed('every member can read the family list',      getDoc(settingsDoc(mem2)));
await allowed('a child can read it (their screen honours it)', getDoc(settingsDoc(kid)));
await refused('a child cannot change it for everyone',      setDoc(settingsDoc(kid), { hiddenDatePeople: [] }));
await refused('a stranger cannot read it',                  getDoc(settingsDoc(stranger)));

console.log('\n── "Choose who" (hiddenDatePeopleFor) rides on reference/settings, unchanged rules ──');
/* v355 needs NO rules change, and these lines pin down why. reference/settings
 * has no key allowlist — any account that may write the family's settings
 * (canWriteIn: admin or member) may write any key on it, this one included —
 * and every member must be able to READ the entry, because the ticked
 * account's own app is what hides the date from it. "Admins only" is what the
 * app offers (Dashboard canHideForSome), not what the rules refuse; that is
 * asserted below so nobody mistakes it for a security boundary. */
const forPapa = { hiddenDatePeopleFor: [{ id: 'member:m-nora', name: 'Nora', hiddenAt: '2026-09-14T10:00:00.000Z', by: 'u-admin', forUids: ['u-mem2'] }] };
await allowed('an admin can hide someone from chosen accounts', setDoc(settingsDoc(admin), forPapa, { merge: true }));
await allowed('the ticked account can read the entry (its app hides the date)', getDoc(settingsDoc(mem2)));
await allowed('a child account can read it too',             getDoc(settingsDoc(kid)));
await allowed('a member could write it — admins-only is app policy, not a rule', setDoc(settingsDoc(mem), forPapa, { merge: true }));
// CONTROL: the exact write the admin just made is refused to an account that
// can't write settings — so "allowed" above is the rules deciding, not a
// fixture that accepts everything.
await refused('CONTROL: a child cannot write the same entry', setDoc(settingsDoc(kid), forPapa, { merge: true }));
await refused('a stranger cannot read it',                   getDoc(settingsDoc(stranger)));

await env.cleanup();
console.log(`\nfirestore-rules.test.mjs: ${n} assertions passed against the real rules engine.`);
