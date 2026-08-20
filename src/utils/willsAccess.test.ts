// Standalone assertion test — same convention as familyDates.test.ts:
//   npx tsx src/utils/willsAccess.test.ts
// Exits non-zero on failure.
//
// Two halves, and the second is the one that matters.
//
// 1. The predicates in willsAccess.ts, which decide what the APP shows.
// 2. A guard on firestore.rules itself, which decides what the SERVER allows.
//
// The guard exists because of how Firestore evaluates rules: every `match`
// whose path matches the request is evaluated, and access is granted if ANY of
// them allows it. So adding a strict `match /reference/willsEstate` block does
// NOT tighten anything on its own — the permissive `match /reference/{docId}`
// wildcard above it still matches the same path and still says yes. The
// wildcard must explicitly exclude the protected names, and if someone ever
// deletes that exclusion while tidying up, this file is what notices.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { canReadWills, canWriteWills, shouldPurgeLocalWills, grantableMembers, withReader, staleReaders } from './willsAccess';
import type { FamilyMemberRole, WillsAccessDoc } from '../types';

const access = (readerUids: string[]): WillsAccessDoc => ({ readerUids });

// ── canReadWills ──────────────────────────────────────────────────────────
// An admin always, list or no list.
assert.strictEqual(canReadWills('admin', 'u-admin', null), true);
assert.strictEqual(canReadWills('admin', 'u-admin', access([])), true);

// A plain member: only if named.
assert.strictEqual(canReadWills('member', 'u-mem', null), false, 'no list means admins only');
assert.strictEqual(canReadWills('member', 'u-mem', access([])), false);
assert.strictEqual(canReadWills('member', 'u-mem', access(['u-other'])), false);
assert.strictEqual(canReadWills('member', 'u-mem', access(['u-mem'])), true);

// A child never — even if a uid somehow ended up on the list. This is the
// whole reason the feature exists ("i don't want the kids going through it"),
// so an accidental grant must not be the thing that undoes it.
assert.strictEqual(canReadWills('child', 'u-kid', access(['u-kid'])), false);

// Not signed in / not resolved yet: fail closed.
assert.strictEqual(canReadWills(null, null, access(['u-mem'])), false);
assert.strictEqual(canReadWills('member', null, access(['u-mem'])), false);
assert.strictEqual(canReadWills(null, 'u-mem', access(['u-mem'])), false);

// ── canWriteWills ─────────────────────────────────────────────────────────
// Writing is admins only, and a named reader is exactly that — a READER.
assert.strictEqual(canWriteWills('admin'), true);
assert.strictEqual(canWriteWills('member'), false);
assert.strictEqual(canWriteWills('child'), false);
assert.strictEqual(canWriteWills(null), false);

// ── shouldPurgeLocalWills ─────────────────────────────────────────────────
// The cached plaintext copy on a device that may no longer read the will.
// Purge it for a KNOWN denied person...
assert.strictEqual(shouldPurgeLocalWills('member', 'u-mem', null), true);
assert.strictEqual(shouldPurgeLocalWills('member', 'u-mem', access(['u-other'])), true);
assert.strictEqual(shouldPurgeLocalWills('child', 'u-kid', access(['u-kid'])), true);
// ...never for someone who may read it...
assert.strictEqual(shouldPurgeLocalWills('admin', 'u-admin', null), false);
assert.strictEqual(shouldPurgeLocalWills('member', 'u-mem', access(['u-mem'])), false);
// ...and NEVER on an unresolved or signed-out identity. This is the dangerous
// case: those states occur on an ADMIN's own device (auth still resolving,
// or signed out), and the purge also clears the dirty flag — so firing here
// would discard an edit they made offline and hadn't synced yet.
assert.strictEqual(shouldPurgeLocalWills(null, null, null), false, 'signed out is not "denied"');
assert.strictEqual(shouldPurgeLocalWills(null, 'u-admin', null), false, 'role not resolved yet');
assert.strictEqual(shouldPurgeLocalWills('admin', null, null), false, 'uid not resolved yet');

// ── grantableMembers ──────────────────────────────────────────────────────
const roles: Record<string, FamilyMemberRole> = {
  'u-admin': { role: 'admin', displayName: 'Rory', email: 'rory@example.com' },
  'u-zoe':   { role: 'member', displayName: 'Zoe', email: 'zoe@example.com' },
  'u-alan':  { role: 'member', displayName: 'Alan', email: 'alan@example.com' },
  'u-kid':   { role: 'child', displayName: 'Shyam', email: 'kid@example.com' },
  // displayName is required on FamilyMemberRole but can be empty in practice
  // (a Google account with no name set) — the label must fall back, not blank.
  'u-blank': { role: 'member', displayName: '', email: 'noname@example.com' },
};

const grantable = grantableMembers(roles);
assert.deepStrictEqual(
  grantable.map(g => g.uid),
  ['u-alan', 'u-blank', 'u-zoe'],
  'members only, sorted by label — no admins (they already have it), no children',
);
assert.strictEqual(grantable[1].label, 'noname@example.com', 'falls back to email when there is no display name');

// ── withReader ────────────────────────────────────────────────────────────
assert.deepStrictEqual(withReader(null, 'u-zoe', true), ['u-zoe']);
assert.deepStrictEqual(withReader(access(['u-zoe']), 'u-alan', true), ['u-zoe', 'u-alan']);
// Idempotent in both directions — a double-tap must not duplicate or throw.
assert.deepStrictEqual(withReader(access(['u-zoe']), 'u-zoe', true), ['u-zoe']);
assert.deepStrictEqual(withReader(access(['u-zoe']), 'u-zoe', false), []);
assert.deepStrictEqual(withReader(access(['u-zoe']), 'u-alan', false), ['u-zoe']);
assert.deepStrictEqual(withReader(null, 'u-zoe', false), []);
// Does not mutate its input.
const before = access(['u-zoe']);
withReader(before, 'u-alan', true);
assert.deepStrictEqual(before.readerUids, ['u-zoe']);

// ── staleReaders ──────────────────────────────────────────────────────────
// A grant outlives the person it was for. Someone removed from the space, or
// promoted to admin, leaves a uid on the list that no toggle in the UI can
// reach — and which would silently re-grant access if they were ever re-added
// as a member.
assert.deepStrictEqual(staleReaders(access(['u-zoe']), roles), []);
assert.deepStrictEqual(staleReaders(access(['u-gone']), roles), ['u-gone'], 'no longer in the space');
assert.deepStrictEqual(staleReaders(access(['u-admin']), roles), ['u-admin'], 'promoted to admin');
assert.deepStrictEqual(staleReaders(access(['u-kid']), roles), ['u-kid'], 'demoted to child');
assert.deepStrictEqual(staleReaders(null, roles), []);

// ── firestore.rules: the carve-out is what makes any of this real ─────────
const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(here, '../../firestore.rules'), 'utf8');

// The protected list, and every name on it.
const protectedFn = /function isProtectedReferenceDoc\(docId\)\s*\{([^}]*)\}/.exec(rules);
assert.ok(protectedFn, 'firestore.rules must define isProtectedReferenceDoc()');
const protectedDocs = [...protectedFn[1].matchAll(/docId == '([^']+)'/g)].map(m => m[1]);
assert.ok(protectedDocs.includes('willsEstate'), 'willsEstate must be a protected reference doc');
assert.ok(protectedDocs.includes('willsAccess'), 'willsAccess must be a protected reference doc');

// The wildcard must exclude them on BOTH verbs. Read is the privacy boundary;
// write matters just as much — without it any adult could overwrite the will,
// or add themselves to the access list and then read it.
const wildcard = /match \/reference\/\{docId\}\s*\{([\s\S]*?)\n {6}\}/.exec(rules);
assert.ok(wildcard, 'firestore.rules must still have the /reference/{docId} wildcard');
const allowLines = wildcard[1].split('\n').filter(l => l.trim().startsWith('allow'));
assert.strictEqual(allowLines.length, 2, 'expected exactly an allow read and an allow write on the wildcard');
for (const line of allowLines) {
  assert.ok(
    line.includes('!isProtectedReferenceDoc(docId)'),
    `the /reference/{docId} wildcard must exclude the protected docs on every verb — this line does not: ${line.trim()}`,
  );
}

// Carving a name out of the wildcard without giving it its own block would
// lock EVERYONE out of it, silently, including the admin who owns it. Every
// protected name needs a real match block.
for (const docId of protectedDocs) {
  assert.ok(
    new RegExp(`match /reference/${docId}\\s*\\{`).test(rules),
    `${docId} is excluded from the wildcard but has no match block of its own — nobody could read or write it`,
  );
}

// And the block itself must say what willsAccess.ts says it says.
const estateBlock = /match \/reference\/willsEstate\s*\{([\s\S]*?)\n {6}\}/.exec(rules);
assert.ok(estateBlock, 'expected a match /reference/willsEstate block');
assert.match(
  estateBlock[1],
  /allow read:\s*if isAdminOf\(familyId\) \|\| isNamedWillReader\(familyId\)/,
  'willsEstate read must be admins OR a named reader — keep canReadWills() in step',
);
assert.match(
  estateBlock[1],
  /allow write:\s*if isAdminOf\(familyId\)\s*;/,
  'willsEstate write must be admins only — keep canWriteWills() in step',
);

// The access list: readable by members (so a granted person's app can tell
// them), writable by admins only. A list you can add yourself to is not an
// access list, and that mistake would be invisible from the UI.
const accessBlock = /match \/reference\/willsAccess\s*\{([\s\S]*?)\n {6}\}/.exec(rules);
assert.ok(accessBlock, 'expected a match /reference/willsAccess block');
assert.match(accessBlock[1], /allow write:\s*if isAdminOf\(familyId\)\s*;/, 'willsAccess write must be admins only');

console.log('willsAccess.test.ts — all assertions passed');
