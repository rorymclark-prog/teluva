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
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// fileURLToPath, never url.pathname — a path containing a space arrives
// percent-encoded through .pathname and the read silently fails.
const here = dirname(fileURLToPath(import.meta.url));
const RULES = resolve(here, 'firestore.rules');
const FAM = 'household';

const env = await initializeTestEnvironment({
  projectId: 'rules-probe',
  firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
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

console.log('\n── the carve-out must not break every OTHER reference doc ──');
await allowed('a member reads household',             getDoc(house(mem)));
await allowed('a member writes household',            setDoc(house(mem), { address: 'Elsewhere' }));
await allowed('a child reads household',              getDoc(house(kid)));
await refused('a child writes household',             setDoc(house(kid), { address: 'Nope' }));

await env.cleanup();
console.log(`\nfirestore-rules.test.mjs: ${n} assertions passed against the real rules engine.`);
