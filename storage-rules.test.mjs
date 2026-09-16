// Behavioural test of storage.rules, run against the REAL rules engine in the
// Storage emulator. Not part of `npm test` — it needs Java and a downloaded
// emulator, which the plain test chain deliberately doesn't assume. Run it
// before any change to storage.rules:
//
//   npm run test:storage-rules
//
// It exits non-zero on failure.
//
// WHY THIS EXISTS
// ---------------
// Every vault document, every scan, every family photo lives behind these
// rules, and until now they were only ever REASONED about — the Firestore
// rules had an engine probe (firestore-rules.test.mjs) and found a live hole
// the text and the app-side predicates both looked right about. The same
// class of hole here would be worse: a Storage object URL is a capability
// that outlives the session that made it.
//
// The cases below are the ones the rules text makes non-obvious claims about:
// the familyIds ARRAY claim (Business Hub members hold several spaces at once
// and only one is "active"), the size cap applying to uploads but NOT to
// deletes (gating delete on request.resource.size denied every delete and
// orphaned the files), and the catch-all deny outside families/.
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// fileURLToPath, never url.pathname — a path containing a space arrives
// percent-encoded through .pathname and the read silently fails.
const here = dirname(fileURLToPath(import.meta.url));
const RULES = resolve(here, 'storage.rules');
const FAM = 'household';
const OTHER = 'other-family';

const env = await initializeTestEnvironment({
  projectId: 'rules-probe',
  storage: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 9199 },
});

const bytes = (n = 8) => new Uint8Array(n).fill(65);

// Seed one file per family with the rules switched off — the fixture, not
// part of what is under test.
await env.withSecurityRulesDisabled(async (ctx) => {
  const s = ctx.storage();
  await uploadBytes(ref(s, `families/${FAM}/vault/passport.pdf`), bytes());
  await uploadBytes(ref(s, `families/${FAM}/vault/deleteme.pdf`), bytes());
  await uploadBytes(ref(s, `families/${OTHER}/vault/secret.pdf`), bytes());
  await uploadBytes(ref(s, 'stray/loose.pdf'), bytes());
});

/** A signed-in, verified member whose ACTIVE space is `familyId`. */
const memberOf = (uid, familyId, extra = {}) =>
  env.authenticatedContext(uid, { email_verified: true, familyId, ...extra }).storage();

const member = memberOf('u-mem', FAM);
const outsider = memberOf('u-out', OTHER);
const unverified = env.authenticatedContext('u-raw', { email_verified: false, familyId: FAM }).storage();
const claimless = env.authenticatedContext('u-none', { email_verified: true }).storage();
const anon = env.unauthenticatedContext().storage();
// Business Hub: active space is OTHER, but they really are a member of FAM too.
const multiSpace = memberOf('u-multi', OTHER, { familyIds: [OTHER, FAM] });
// A token carrying ONLY the array claim — no single "active" familyId at all.
// The leave-space path already mints `{ familyId: null, familyIds: [...] }`,
// and a null claim is dropped from the ID token entirely. Reading
// request.auth.token.familyId then RAISES rather than returning null, and
// inFamily() reads it first — this passes only because rules-engine `||`
// absorbs an erroring operand when the other side is true. That is a real
// language guarantee, not a coincidence, but it is invisible in the rules
// text and the emulator logs the raised exception as a warning while
// allowing the request. Pinned here so a reorder of those two clauses (which
// would lock every multi-space account out of its own files) fails loudly.
const arrayOnly = env.authenticatedContext('u-array', { email_verified: true, familyIds: [FAM] }).storage();

const file = (s, path = `families/${FAM}/vault/passport.pdf`) => ref(s, path);

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${err?.message || err}`); }
}

console.log('storage.rules — read');
await check('a member reads their family\'s file', () => assertSucceeds(getBytes(file(member))));
await check('a member of another family cannot', () => assertFails(getBytes(file(outsider))));
await check('an unverified email cannot', () => assertFails(getBytes(file(unverified))));
await check('a signed-in user with no family claim cannot', () => assertFails(getBytes(file(claimless))));
await check('an anonymous visitor cannot', () => assertFails(getBytes(file(anon))));
await check(
  'the familyIds ARRAY admits a member whose ACTIVE space is a different one',
  () => assertSucceeds(getBytes(file(multiSpace))),
);
await check(
  'the familyIds ARRAY admits a member with NO single familyId claim at all',
  () => assertSucceeds(getBytes(file(arrayOnly))),
);

console.log('storage.rules — write');
await check(
  'a member uploads into their family',
  () => assertSucceeds(uploadBytes(ref(member, `families/${FAM}/vault/new.pdf`), bytes())),
);
await check(
  'an outsider cannot upload into someone else\'s family',
  () => assertFails(uploadBytes(ref(outsider, `families/${FAM}/vault/evil.pdf`), bytes())),
);
await check(
  'an upload over the 20MB cap is refused',
  () => assertFails(uploadBytes(ref(member, `families/${FAM}/vault/huge.pdf`), bytes(21 * 1024 * 1024))),
);
await check(
  'a member can DELETE — request.resource is null on delete, and gating the '
  + 'size check on it once denied every delete',
  () => assertSucceeds(deleteObject(ref(member, `families/${FAM}/vault/deleteme.pdf`))),
);
await check(
  'an outsider cannot delete',
  () => assertFails(deleteObject(ref(outsider, `families/${FAM}/vault/passport.pdf`))),
);

console.log('storage.rules — everything outside families/ is locked');
await check('no read', () => assertFails(getBytes(ref(member, 'stray/loose.pdf'))));
await check('no write', () => assertFails(uploadBytes(ref(member, 'stray/new.pdf'), bytes())));

await env.cleanup();

if (failures) {
  console.error(`\nstorage-rules.test.mjs: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nstorage-rules.test.mjs: all assertions passed');
