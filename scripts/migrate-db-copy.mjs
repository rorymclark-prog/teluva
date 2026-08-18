#!/usr/bin/env node
/**
 * migrate-db-copy.mjs — copy every document from one named Firestore database
 * to another in the same project, then verify the copy doc-by-doc.
 *
 * WHY THIS EXISTS (2026-08-18): production accidentally ran on an AI-Studio-
 * auto-provisioned database (ai-studio-393d7146-…) that is permanently
 * freeTierLimited — it hit its daily read cap and took the whole app down for
 * ~14 hours (see .claude-context, teluva_2026_08_18_quota_outage_v217). The
 * replacement is teluva-prod, a deliberately provisioned standard database.
 *
 * gcloud's managed export/import was tried first and REJECTED the data:
 * the import path enforces Firestore's 1500-byte indexed-value limit against
 * base64 photo fields even when the destination has single-field exemptions
 * for exactly those fields (verified: a direct Admin-SDK write of the same
 * oversized value succeeds). Hence this script: a plain read-and-write copy,
 * which goes through the normal write path where the exemptions work.
 *
 * Usage:
 *   node scripts/migrate-db-copy.mjs           # copy (default: DRY RUN)
 *   node scripts/migrate-db-copy.mjs --apply   # actually write
 *   node scripts/migrate-db-copy.mjs --verify  # compare src vs dst, no writes
 *
 * The copy walks listCollections() recursively — it does not rely on a
 * hand-maintained collection list, so nothing can be silently missed.
 */
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'gen-lang-client-0384516171';
const SRC_DB = process.env.SRC_DB || 'ai-studio-393d7146-0d1a-431e-bd58-b2a1478b5ff5';
const DST_DB = process.env.DST_DB || 'teluva-prod';
const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');

admin.initializeApp({ projectId: PROJECT_ID });
const src = getFirestore(admin.app(), SRC_DB);
const dst = getFirestore(admin.app(), DST_DB);

// Canonical JSON for comparison: stable key order, Firestore types flattened
// to comparable primitives. Timestamps → millis, Bytes → base64, GeoPoint →
// lat/lng, DocumentReference → path (also counted, since a reference copied
// verbatim would still point at the OLD database and must be flagged).
let refCount = 0;
function canon(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof admin.firestore.Timestamp) return { __ts: v.toMillis() };
  if (v instanceof admin.firestore.GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (v instanceof Buffer) return { __bytes: v.toString('base64') };
  if (v instanceof admin.firestore.DocumentReference) { refCount++; return { __ref: v.path }; }
  if (Array.isArray(v)) return v.map(canon);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
  return out;
}
const canonStr = (data) => JSON.stringify(canon(data));

/** Recursively yield every document snapshot under a database root/doc. */
async function* walk(parent) {
  const cols = await parent.listCollections();
  for (const col of cols) {
    // .get() on the collection returns only docs that EXIST; a doc that exists
    // purely as a subcollection anchor (deleted parent) is invisible to it, so
    // also walk listDocuments() for anchors with children.
    const docRefs = await col.listDocuments();
    for (const ref of docRefs) {
      const snap = await ref.get();
      if (snap.exists) yield snap;
      yield* walk(ref);
    }
  }
}

async function copy() {
  let copied = 0;
  const perCol = new Map();
  const writer = APPLY ? dst.bulkWriter() : null;
  for await (const snap of walk(src)) {
    const path = snap.ref.path;
    const colKey = path.split('/').slice(0, -1).join('/');
    perCol.set(colKey, (perCol.get(colKey) || 0) + 1);
    canonStr(snap.data()); // runs the DocumentReference counter either way
    if (APPLY) writer.set(dst.doc(path), snap.data());
    copied++;
  }
  if (APPLY) await writer.close();
  console.log(`\n${APPLY ? 'COPIED' : 'WOULD COPY (dry run)'} ${copied} documents:`);
  for (const [col, n] of [...perCol.entries()].sort()) console.log(`  ${String(n).padStart(4)}  ${col}`);
  if (refCount > 0) {
    console.log(`\n⚠ ${refCount} DocumentReference value(s) found — these still point at the OLD database and need manual attention.`);
  } else {
    console.log('\nNo DocumentReference values anywhere — nothing points back at the old database.');
  }
}

async function verify() {
  const srcDocs = new Map();
  for await (const snap of walk(src)) srcDocs.set(snap.ref.path, canonStr(snap.data()));
  const dstDocs = new Map();
  for await (const snap of walk(dst)) dstDocs.set(snap.ref.path, canonStr(snap.data()));

  const missing = [...srcDocs.keys()].filter((p) => !dstDocs.has(p));
  const extra = [...dstDocs.keys()].filter((p) => !srcDocs.has(p));
  const differ = [...srcDocs.keys()].filter((p) => dstDocs.has(p) && dstDocs.get(p) !== srcDocs.get(p));

  console.log(`source: ${srcDocs.size} docs, destination: ${dstDocs.size} docs`);
  console.log(`missing in destination: ${missing.length}`);
  missing.forEach((p) => console.log(`  MISSING ${p}`));
  console.log(`extra in destination: ${extra.length}`);
  extra.forEach((p) => console.log(`  EXTRA   ${p}`));
  console.log(`differing content: ${differ.length}`);
  differ.forEach((p) => console.log(`  DIFFERS ${p}`));
  if (!missing.length && !differ.length) console.log('\n✓ every source document exists in the destination with identical content');
  process.exitCode = missing.length || differ.length ? 1 : 0;
}

console.log(`project=${PROJECT_ID}\nsrc=${SRC_DB}\ndst=${DST_DB}\nmode=${VERIFY ? 'VERIFY' : APPLY ? 'APPLY' : 'DRY RUN'}\n`);
await (VERIFY ? verify() : copy());
