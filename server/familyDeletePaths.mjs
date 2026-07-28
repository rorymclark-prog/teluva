// Pure, dependency-free path-scoping helpers for the family-delete endpoint
// (server.js /api/delete-family). Kept in their own module — with no
// firebase-admin import — so this file can be `node --test`ed directly
// without touching Firestore, Storage, or any live credentials.
//
// THIS IS THE MOST DANGEROUS PART OF THE APPLICATION: it builds the exact
// Cloud Storage prefix that gets bulk-deleted for a family. A wrong or
// under-validated prefix here can delete every family's files (an empty or
// wildcard-ish prefix) or a DIFFERENT family's files (a familyId that isn't
// what the caller actually owns). Every function below fails CLOSED (throws)
// on anything it isn't certain about — callers must never catch-and-ignore
// these errors before a delete.
//
// Storage layout (see storage.rules + src/utils/db.ts storagePath templates):
// every object for a family lives under `families/{familyId}/...` — nothing
// else is ever written outside that prefix per-family. So the ONLY safe
// bulk-delete prefix is `families/{familyId}/` with a non-empty, validated id.

// Matches every familyId this app actually mints: crypto.randomUUID() (server.js
// create-family/create-space) and the one legacy literal id 'household' (the
// original seeded family, see FamilyContext.tsx BOOTSTRAP_EMAILS). Deliberately
// a tight allowlist charset — no '/', no '.', no whitespace, no unicode
// look-alikes — rather than a denylist of "bad" characters, which is much
// easier to bypass.
const SAFE_FAMILY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Throws unless `familyId` is a non-empty string made ONLY of safe
 * "path segment" characters (letters, digits, `-`, `_`). In particular this
 * rejects: undefined/null/non-strings, the empty string, whitespace-only
 * strings, and anything containing `/`, `..`, or other path-traversal-shaped
 * content — so a caller can never smuggle a second path segment (e.g.
 * `"a/../b"` or `"a/b"`) into what should be a single, opaque id.
 */
export function assertValidFamilyId(familyId) {
  if (typeof familyId !== 'string') {
    throw new Error(`familyId must be a string, got ${typeof familyId}`);
  }
  const trimmed = familyId.trim();
  if (trimmed.length === 0) {
    throw new Error('familyId must not be empty');
  }
  if (trimmed !== familyId) {
    throw new Error('familyId must not have leading/trailing whitespace');
  }
  if (!SAFE_FAMILY_ID_RE.test(familyId)) {
    throw new Error(`familyId contains characters outside the safe allowlist: ${JSON.stringify(familyId)}`);
  }
  return familyId;
}

/**
 * Builds the Cloud Storage prefix that scopes every object belonging to one
 * family — `families/{familyId}/` — for use with bucket.getFiles({ prefix })
 * / bucket.deleteFiles({ prefix }). Throws (never returns a bad prefix) if
 * familyId fails assertValidFamilyId, and re-asserts the shape of the
 * resulting prefix itself as a second, independent check before returning —
 * belt and suspenders against a future edit to this function accidentally
 * loosening the first check.
 */
export function familyStoragePrefix(familyId) {
  assertValidFamilyId(familyId);
  const prefix = `families/${familyId}/`;

  // Re-derive the id segment from the built prefix and compare, instead of
  // just trusting the input we already validated — this catches a bug in
  // THIS function (e.g. a future edit that changes the template) as well as
  // a bug in the caller.
  const match = /^families\/([^/]+)\/$/.exec(prefix);
  if (!match || match[1].length === 0) {
    throw new Error(`Refusing to use malformed storage prefix: ${JSON.stringify(prefix)}`);
  }
  if (match[1] !== familyId) {
    throw new Error('Refusing to use a storage prefix whose id does not round-trip the input familyId');
  }
  if (!prefix.startsWith('families/')) {
    throw new Error('Refusing to use a storage prefix outside families/');
  }
  if (prefix === 'families/' || prefix === 'families//' || prefix.includes('..') || prefix.includes('//')) {
    throw new Error(`Refusing to use an unsafe/empty storage prefix: ${JSON.stringify(prefix)}`);
  }

  return prefix;
}

/**
 * Builds the Firestore document path for a family's root document —
 * `families/{familyId}` — for use with adminDb.doc(...) ahead of a
 * recursiveDelete(). Same validation as familyStoragePrefix; kept separate
 * (rather than deriving one from the other) so a bug in one path template
 * can never silently propagate into the other.
 */
export function familyFirestorePath(familyId) {
  assertValidFamilyId(familyId);
  return `families/${familyId}`;
}
