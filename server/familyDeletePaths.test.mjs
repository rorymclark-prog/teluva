// Unit tests for the family-delete path-scoping helpers. Pure logic, no
// Firestore/Storage/network involved — safe to run anywhere, anytime,
// including against this repo's real Firebase project, because nothing here
// touches a live SDK.
//
// Run with:  node --test server/familyDeletePaths.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidFamilyId, familyStoragePrefix, familyFirestorePath } from './familyDeletePaths.mjs';

// ---------------------------------------------------------------------------
// Happy path — the two real shapes of familyId this app ever mints.
// ---------------------------------------------------------------------------

test('accepts a UUID-shaped familyId (crypto.randomUUID() output)', () => {
  const id = 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789';
  assert.equal(familyStoragePrefix(id), `families/${id}/`);
  assert.equal(familyFirestorePath(id), `families/${id}`);
});

test('accepts the legacy literal id "household"', () => {
  assert.equal(familyStoragePrefix('household'), 'families/household/');
  assert.equal(familyFirestorePath('household'), 'families/household');
});

test('the returned prefix always starts with "families/" and ends with "/"', () => {
  const p = familyStoragePrefix('some-valid-id_123');
  assert.match(p, /^families\/.+\/$/);
});

// ---------------------------------------------------------------------------
// The dangerous cases: every one of these MUST throw, never return a value.
// If any of these ever returns instead of throwing, the resulting prefix
// could delete every family's files (empty/near-empty prefix) or hand back
// something a caller might use to escape the families/{id}/ sandbox.
// ---------------------------------------------------------------------------

const MALICIOUS_OR_MALFORMED_IDS = [
  '',                          // empty string
  '   ',                       // whitespace only
  ' abc',                      // leading whitespace
  'abc ',                      // trailing whitespace
  '/',                         // bare slash
  '..',                        // parent-dir traversal
  '../other-family',           // traversal out of families/
  'a/../../etc',               // nested traversal
  'a/b',                       // second path segment (would target a's SUBFOLDER "b" — still wrong: caller only owns "a")
  'families/',                 // slash-bearing — rejected on charset, even though "families" alone is a fine (if confusing) id
  '*',                         // shell/glob-looking wildcard
  '**',
  'a*',
];

test('rejects path-traversal / empty / whitespace / slash-bearing familyIds', () => {
  for (const bad of MALICIOUS_OR_MALFORMED_IDS) {
    assert.throws(() => assertValidFamilyId(bad), undefined, `assertValidFamilyId should reject ${JSON.stringify(bad)}`);
    assert.throws(() => familyStoragePrefix(bad), undefined, `familyStoragePrefix should reject ${JSON.stringify(bad)}`);
    assert.throws(() => familyFirestorePath(bad), undefined, `familyFirestorePath should reject ${JSON.stringify(bad)}`);
  }
});

test('the literal string "families" is charset-valid and safely scoped (not a collision with the collection root)', () => {
  // "families" contains no path separators, so it is just an ordinary
  // (if confusing) id — it round-trips to families/families/ and is exactly
  // as isolated from every other family as any other id.
  assert.equal(familyStoragePrefix('families'), 'families/families/');
});

test('the literal string "null" is charset-valid (not a type-confusion bug) and round-trips normally', () => {
  // Distinguishing this from JS `null` (rejected below) is the point: a
  // family whose id happens to be the string "null" is not itself dangerous
  // as long as it round-trips to families/null/ and nowhere else.
  assert.equal(familyStoragePrefix('null'), 'families/null/');
});

test('rejects non-string types (type confusion / undefined body fields)', () => {
  const badTypes = [null, undefined, 0, 1, false, true, {}, [], ['x'], { familyId: 'x' }];
  for (const bad of badTypes) {
    assert.throws(() => assertValidFamilyId(bad), undefined, `should reject type-confused value ${JSON.stringify(bad)}`);
    assert.throws(() => familyStoragePrefix(bad));
  }
});

test('rejects control characters and non-ASCII/unicode look-alikes', () => {
  const nul = String.fromCharCode(0);
  const zeroWidthSpace = String.fromCharCode(0x200b);
  const fullwidthF = String.fromCharCode(0xff26); // "Ｆ" fullwidth Latin F
  const tricky = [
    `a${nul}b`,             // NUL byte
    'a\nb',                 // newline
    'a\tb',                 // tab
    `family${zeroWidthSpace}Id`, // zero-width space
    `${fullwidthF}amily`,   // fullwidth unicode look-alike, not plain ASCII "F"
  ];
  for (const bad of tricky) {
    assert.throws(() => assertValidFamilyId(bad), undefined, `should reject ${JSON.stringify(bad)}`);
  }
});

test('every malformed id in the combined fuzz list produces NO usable prefix at all', () => {
  const all = [...MALICIOUS_OR_MALFORMED_IDS, null, undefined, {}, []];
  for (const bad of all) {
    let threw = false;
    let result;
    try {
      result = familyStoragePrefix(bad);
    } catch {
      threw = true;
    }
    assert.equal(threw, true, `familyStoragePrefix(${JSON.stringify(bad)}) should throw, got ${JSON.stringify(result)}`);
  }
});

// ---------------------------------------------------------------------------
// Cross-family isolation: two distinct valid ids must never produce
// overlapping or prefix-of-each-other paths that could cause one family's
// delete to reach into another's files.
// ---------------------------------------------------------------------------

test('two different valid familyIds never produce a prefix that is a prefix of the other', () => {
  const a = familyStoragePrefix('family-one');
  const b = familyStoragePrefix('family-one-2'); // shares "family-one" as a literal substring
  assert.notEqual(a, b);
  // Both prefixes end in "/", so a's directory boundary ("family-one/") is
  // NOT a string-prefix of b's ("family-one-2/") — assert that directly, so
  // a getFiles({prefix: a}) call could never also match files under b.
  assert.equal(b.startsWith(a), false, 'family-one-2/ must not be matched by a getFiles({prefix: "families/family-one/"}) call');
});

test('familyStoragePrefix output always has a non-empty id segment (never "families//")', () => {
  const p = familyStoragePrefix('x');
  assert.notEqual(p, 'families//');
  assert.ok(p.length > 'families/'.length + 1, 'prefix must contain at least one id character between the slashes');
});
