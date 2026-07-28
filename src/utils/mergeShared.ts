// Three-way merge for the shared single-document reference stores
// (families/{FAMILY_ID}/reference/{key} — shopping, recipes, documents, slips,
// household, finances, wills, in-memory, …).
//
// WHY THIS EXISTS
// ---------------
// Every one of those features stores a WHOLE array inside ONE Firestore
// document, and every view loads that array once into React state. Two family
// members on two phones therefore both hold a private copy of the same array,
// and whoever saved last used to win outright:
//
//   Mama loads ["Milk"] · Papa loads ["Milk"]
//   Mama saves ["Milk","Eggs"] · Papa saves ["Milk","Bread"]  → "Eggs" is gone.
//
// A Firestore transaction ALONE does not fix that. A transaction only promises
// that the document did not change between the transaction's own read and its
// commit — a window of milliseconds. Papa's array is minutes stale, and the
// transaction would happily write his stale array over the fresh document
// because nothing in it disagrees with what the transaction just read. The
// missing ingredient is not atomicity, it is INTENT: we have to know which
// items Papa actually touched, and apply only those to the server's copy.
//
// So every write is a three-way merge against a BASE — the value this client
// last saw (its last load / last applied live snapshot / last successful save):
//
//   base   = what the writer's screen was built from
//   local  = what the writer is trying to save
//   server = what is in Firestore right now (read inside the transaction)
//
//   local vs base  → the writer's intent (added / edited / deleted)
//   that intent    → applied on top of `server`, not instead of it
//
// CONFLICT POLICY — this vault holds passports and children's medical records,
// so every ambiguous case resolves toward KEEPING data:
//   * add        → always kept
//   * field edit → merged field-by-field, so two people editing different
//                  fields of the same record both survive
//   * delete     → honoured ONLY when the server's copy of that item is still
//                  byte-identical to the base copy the deleter was looking at.
//                  If someone else changed it in the meantime, the deleter was
//                  acting on stale information, so the item is KEPT.
// The cost of that policy is that an occasional delete has to be repeated. The
// alternative — silently destroying a record someone else just edited — is not
// an acceptable trade in a family vault.
//
// This module is pure (no Firebase import) so it can be unit-tested directly:
//   npx tsx src/utils/mergeShared.test.ts

export type Json = unknown;

/** Plain `{}` object — not an array, not null, not a Date/class instance. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

/**
 * An array we can merge item-by-item: every element is a plain object carrying a
 * string `id`. Every list in this app satisfies this (ShoppingItem, Recipe,
 * VaultDocument, Vehicle, InsurancePolicy, EstateRecord, …).
 *
 * An EMPTY array passes vacuously, which is what we want — an empty local list
 * still has to merge item-wise against a populated server list. Arrays of
 * primitives (Recipe.ingredients: string[], coveredMemberIds: string[]) do not
 * pass, and fall through to whole-value replacement, which is correct: those
 * are edited as a unit in the UI, never element-wise by two people.
 */
export function isIdArray(v: unknown): v is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(v)
    && v.every(e => isPlainObject(e) && typeof (e as { id?: unknown }).id === 'string');
}

/** Structural equality, good enough for JSON-shaped Firestore data. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    // Firestore never stores `undefined` (the client is configured with
    // ignoreUndefinedProperties), so an explicitly-undefined key and an absent
    // key are the same thing and must compare equal.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (a[k] === undefined && b[k] === undefined) continue;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

function byId(list: unknown): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>();
  if (!isIdArray(list)) return m;
  for (const item of list) m.set(item.id, item);
  return m;
}

/**
 * Merge one value. `base` may be undefined (this client never saw a previous
 * value) — that is treated as "everything local is new", which can never delete
 * anything, the safe direction.
 */
export function mergeValue(base: Json, local: Json, server: Json): Json {
  // Nothing on the server yet (brand-new document / brand-new field): the
  // writer's value IS the truth, there is nothing to lose.
  if (server === undefined) return local;

  // Already agreed — nothing to decide.
  if (deepEqual(local, server)) return local;

  if (isIdArray(local) && isIdArray(server)) return mergeIdArray(base, local, server);
  if (isPlainObject(local) && isPlainObject(server)) return mergeObject(base, local, server);

  // Anything else (scalar, string[], mismatched shapes, an item that changed
  // type): the writer only wins if the writer actually changed it. If local
  // still equals base, this client never touched the value and the server's
  // newer one must survive.
  return deepEqual(local, base) ? server : local;
}

function mergeObject(base: Json, local: Record<string, unknown>, server: Record<string, unknown>): Record<string, unknown> {
  const baseObj = isPlainObject(base) ? base : undefined;
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(server), ...Object.keys(local)]);
  for (const k of keys) {
    const merged = mergeValue(baseObj?.[k], local[k], server[k]);
    // Drop undefined rather than writing it: Firestore rejects undefined, and
    // an absent key is how this data models "not set".
    if (merged !== undefined) out[k] = merged;
  }
  return out;
}

function mergeIdArray(
  base: Json,
  local: Array<Record<string, unknown> & { id: string }>,
  server: Array<Record<string, unknown> & { id: string }>,
): Array<Record<string, unknown>> {
  const baseById = byId(base);
  const localById = byId(local);
  const serverById = byId(server);

  const out: Array<Record<string, unknown>> = [];

  // 1. Everything the writer is holding, in the writer's own order.
  for (const item of local) {
    const s = serverById.get(item.id);
    if (s === undefined) {
      const b = baseById.get(item.id);
      // Was on our base, gone from the server → somebody else deleted it.
      // Honour that delete only if WE did not edit it since; an edit means the
      // record still matters to this user, so keep it (preservation policy).
      if (b !== undefined && deepEqual(b, item)) continue;
      out.push(item);            // a genuine local add, or a local edit that outranks a remote delete
      continue;
    }
    out.push(mergeValue(baseById.get(item.id), item, s) as Record<string, unknown>);
  }

  // 2. Everything only the server has.
  for (const item of server) {
    if (localById.has(item.id)) continue;
    const b = baseById.get(item.id);
    if (b === undefined) {
      out.push(item);            // added remotely after our base — we never saw it, keep it
      continue;
    }
    // The writer deleted it. Honour that ONLY if the server's copy is still
    // exactly what the writer was looking at. Otherwise someone edited it in
    // the meantime and the delete was made on stale information → keep it.
    if (!deepEqual(b, item)) out.push(item);
  }

  return out;
}

/**
 * Three-way merge of a plain list of ids — the `metadata/members` and
 * `metadata/events` index documents.
 *
 * Those two collections DO store one Firestore document per item (the pattern
 * the reference docs should have used), but the list of which ids are still
 * active lives in a single `{ ids: [...] }` document that was written with a
 * whole-array `set`. That reintroduces the very lost-update it was meant to
 * avoid one level up: Papa adds a member, Mama's stale device rewrites `ids`
 * without it, and Papa's member document is still there but no longer listed —
 * so it silently disappears from everyone's app.
 *
 * Same policy as the item merge: an id is dropped only when this writer
 * knowingly removed it (it was in their base and is not in their list).
 */
export function mergeIdList(base: string[] | undefined, local: string[], server: string[]): string[] {
  const baseSet = new Set(base ?? []);
  const localSet = new Set(local);
  const serverSet = new Set(server);

  const out: string[] = [];
  for (const id of local) {
    // In our base but gone from the server → deleted elsewhere. We did not
    // re-add it (it is unchanged from base), so honour that.
    if (!serverSet.has(id) && baseSet.has(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  for (const id of server) {
    if (localSet.has(id)) continue;
    if (baseSet.has(id)) continue;      // we deliberately removed it
    if (!out.includes(id)) out.push(id); // added elsewhere since our base
  }
  return out;
}

/**
 * Three-way merge of a whole reference document.
 *
 * @param base   what this client last saw (undefined ⇒ treat everything local as new)
 * @param local  what this client wants to save
 * @param server what Firestore holds right now (undefined ⇒ document does not exist)
 */
export function mergeShared<T>(base: T | undefined, local: T, server: T | undefined): T {
  if (server === undefined) return local;
  return mergeValue(base, local, server) as T;
}
