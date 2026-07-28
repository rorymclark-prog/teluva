// Standalone assertion tests for the shared-document three-way merge.
// Same convention as speechLocale.test.ts — no test runner is configured, so:
//   npx tsx src/utils/mergeShared.test.ts    (or: npm run test:merge)
// Exits non-zero on the first failed assertion.
import assert from 'node:assert';
import { mergeShared, mergeIdList, deepEqual, isIdArray } from './mergeShared';

type Item = { id: string; name?: string; checked?: boolean; note?: string };
const names = (list: { id: string }[]) => list.map(i => (i as Item).name ?? i.id).sort();

let checks = 0;
function check(label: string, fn: () => void) {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
}

console.log('\nmergeShared — concurrent writers must not lose data\n');

// ─────────────────────────────────────────────────────────────────────────────
// THE BUG FROM THE AUDIT, END TO END.
// Mama and Papa both load ["Milk"]. Mama adds Eggs. Papa — whose tab never
// re-fetched — adds Bread from his stale array. Before this merge existed,
// Papa's plain setDoc wrote ["Milk","Bread"] and Eggs was silently destroyed.
// ─────────────────────────────────────────────────────────────────────────────
check('two stale writers: neither loses the other\'s item', () => {
  const shared = { items: [{ id: '1', name: 'Milk', checked: false }] };

  // Both devices load the same document.
  const mamaBase = structuredClone(shared);
  const papaBase = structuredClone(shared);
  let server = structuredClone(shared);

  // 1. Mama adds Eggs. Her merge sees an unchanged server.
  const mamaLocal = { items: [...mamaBase.items, { id: '2', name: 'Eggs', checked: false }] };
  server = mergeShared(mamaBase, mamaLocal, server);
  assert.deepStrictEqual(names(server.items), ['Eggs', 'Milk']);

  // 2. Papa adds Bread from his MINUTES-OLD array — he has never seen Eggs.
  const papaLocal = { items: [...papaBase.items, { id: '3', name: 'Bread', checked: false }] };
  server = mergeShared(papaBase, papaLocal, server);

  // Both survive. This is the assertion the whole change exists for.
  assert.deepStrictEqual(names(server.items), ['Bread', 'Eggs', 'Milk']);
});

check('control: the old write path (and a bare transaction) DOES lose it', () => {
  // The shipped bug, and equally what a runTransaction that reads the document
  // and then writes `local` anyway would do: the committed value is simply the
  // writer's stale array. A transaction makes that overwrite ATOMIC, not
  // CORRECT — it is only ever safe to write `local` when `local` was derived
  // from the value being replaced, which is exactly what goes wrong here.
  const server = { items: [{ id: '1', name: 'Milk' }, { id: '2', name: 'Eggs' }] };
  const papaStale = { items: [{ id: '1', name: 'Milk' }, { id: '3', name: 'Bread' }] };

  const oldWritePath = papaStale;                       // setDoc(ref, local) — no merge at all
  assert.deepStrictEqual(names(oldWritePath.items), ['Bread', 'Milk']);   // Eggs destroyed

  // Same inputs through the merge, given the base Papa actually loaded:
  const merged = mergeShared({ items: [{ id: '1', name: 'Milk' }] }, papaStale, server);
  assert.deepStrictEqual(names(merged.items), ['Bread', 'Eggs', 'Milk']); // Eggs survives
});

// ── deletes ─────────────────────────────────────────────────────────────────
check('a delete is honoured when nobody else touched the item', () => {
  const base = { items: [{ id: '1', name: 'Milk' }, { id: '2', name: 'Eggs' }] };
  const server = structuredClone(base);
  const local = { items: [{ id: '1', name: 'Milk' }] };          // Eggs deleted
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(names(out.items), ['Milk']);
});

check('a delete does NOT clobber a concurrent edit of the same item', () => {
  const base = { items: [{ id: '1', name: 'Milk' }, { id: '2', name: 'Eggs', note: '' }] };
  // Someone else edited Eggs while our deleter was looking at the old copy.
  const server = { items: [{ id: '1', name: 'Milk' }, { id: '2', name: 'Eggs', note: 'get the free-range ones' }] };
  const local = { items: [{ id: '1', name: 'Milk' }] };          // stale delete
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(names(out.items), ['Eggs', 'Milk']);
  assert.strictEqual((out.items.find(i => i.id === '2') as Item).note, 'get the free-range ones');
});

check('a remote delete is honoured by a writer who did not touch that item', () => {
  const base = { items: [{ id: '1', name: 'Milk' }, { id: '2', name: 'Eggs' }] };
  const server = { items: [{ id: '1', name: 'Milk' }] };          // Eggs deleted remotely
  const local = { items: [...base.items, { id: '3', name: 'Bread' }] };
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(names(out.items), ['Bread', 'Milk']);
});

check('a remote delete loses to a local edit of the same item (keep the data)', () => {
  const base: { items: Item[] } = { items: [{ id: '2', name: 'Eggs', note: '' }] };
  const server: { items: Item[] } = { items: [] };                       // deleted remotely
  const local: { items: Item[] } = { items: [{ id: '2', name: 'Eggs', note: 'a dozen' }] };  // edited locally
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(names(out.items), ['Eggs']);
});

// ── field-level merging ─────────────────────────────────────────────────────
check('two people editing different fields of one record both survive', () => {
  const base = { records: [{ id: 'w1', heldBy: 'the notary', notes: '', executor: '' }] };
  const server = { records: [{ id: 'w1', heldBy: 'the notary', notes: '', executor: 'Anna' }] };
  const local = { records: [{ id: 'w1', heldBy: 'Raiffeisen safe', notes: '', executor: '' }] };
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(out.records[0], { id: 'w1', heldBy: 'Raiffeisen safe', notes: '', executor: 'Anna' });
});

check('an untouched field keeps the server value, not the stale local one', () => {
  const base = { hubName: 'Home', country: 'AT' };
  const server = { hubName: 'The Clarks', country: 'AT' };   // renamed elsewhere
  const local = { hubName: 'Home', country: 'ZA' };          // we only changed country
  assert.deepStrictEqual(mergeShared(base, local, server), { hubName: 'The Clarks', country: 'ZA' });
});

check('toggling a checkbox does not revert someone else\'s new item', () => {
  const base = { items: [{ id: '1', name: 'Milk', checked: false }] };
  const server = { items: [{ id: '1', name: 'Milk', checked: false }, { id: '9', name: 'Rice', checked: false }] };
  const local = { items: [{ id: '1', name: 'Milk', checked: true }] };
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(names(out.items), ['Milk', 'Rice']);
  assert.strictEqual((out.items.find(i => i.id === '1') as Item).checked, true);
});

// ── nested structures (the multi-list docs: household / finances / info) ────
check('nested id-arrays inside one document merge independently', () => {
  const base = {
    address: 'Wien 1010',
    vehicles: [{ id: 'v1', make: 'Skoda' }],
    pets: [{ id: 'p1', name: 'Rex' }],
  };
  const server = {
    address: 'Wien 1010',
    vehicles: [{ id: 'v1', make: 'Skoda' }, { id: 'v2', make: 'Ford' }],   // Papa added a car
    pets: [{ id: 'p1', name: 'Rex' }],
  };
  const local = {
    address: 'Wien 1010',
    vehicles: [{ id: 'v1', make: 'Skoda' }],
    pets: [{ id: 'p1', name: 'Rex' }, { id: 'p2', name: 'Mitzi' }],        // Mama added a cat
  };
  const out = mergeShared(base, local, server) as typeof server & { pets: { id: string }[] };
  assert.deepStrictEqual(out.vehicles.map(v => v.id).sort(), ['v1', 'v2']);
  assert.deepStrictEqual(out.pets.map(p => p.id).sort(), ['p1', 'p2']);
});

check('an id-array nested inside an item merges too (insurance coverage)', () => {
  const base = { insurance: [{ id: 'i1', provider: 'Uniqa', coverage: [{ id: 'c1', name: 'Fire' }] }] };
  const server = { insurance: [{ id: 'i1', provider: 'Uniqa', coverage: [{ id: 'c1', name: 'Fire' }, { id: 'c2', name: 'Water' }] }] };
  const local = { insurance: [{ id: 'i1', provider: 'Uniqa', coverage: [{ id: 'c1', name: 'Fire' }, { id: 'c3', name: 'Theft' }] }] };
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(out.insurance[0].coverage.map(c => c.id).sort(), ['c1', 'c2', 'c3']);
});

// ── back-compat / degenerate inputs ─────────────────────────────────────────
check('no server document yet: local is written as-is', () => {
  const local = { items: [{ id: '1', name: 'Milk' }] };
  assert.deepStrictEqual(mergeShared(undefined, local, undefined), local);
});

check('no base (first save of the session): nothing is ever deleted', () => {
  const server = { items: [{ id: '1', name: 'Milk' }, { id: '2', name: 'Eggs' }] };
  const local = { items: [{ id: '3', name: 'Bread' }] };
  const out = mergeShared(undefined, local, server);
  assert.deepStrictEqual(names(out.items), ['Bread', 'Eggs', 'Milk']);
});

check('existing documents with legacy/unknown extra fields are preserved', () => {
  const base = { items: [{ id: '1', name: 'Milk' }], legacyFlag: true };
  const server = { items: [{ id: '1', name: 'Milk' }], legacyFlag: true, addedByOldVersion: 'x' };
  const local = { items: [{ id: '1', name: 'Milk' }, { id: '2', name: 'Eggs' }], legacyFlag: true };
  const out = mergeShared(base, local, server) as Record<string, unknown>;
  assert.strictEqual(out.legacyFlag, true);
  assert.strictEqual(out.addedByOldVersion, 'x');
});

check('arrays of primitives are replaced as a unit, by whoever changed them', () => {
  const base = { recipes: [{ id: 'r1', title: 'Bobotie', ingredients: ['mince'] }] };
  const server = { recipes: [{ id: 'r1', title: 'Bobotie', ingredients: ['mince'] }] };
  const local = { recipes: [{ id: 'r1', title: 'Bobotie', ingredients: ['mince', 'curry powder'] }] };
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(out.recipes[0].ingredients, ['mince', 'curry powder']);
});

check('a clear-all does not wipe items added since our base', () => {
  const base: { items: Item[] } = { items: [{ id: '1', name: 'Milk', checked: true }] };
  const server: { items: Item[] } = { items: [{ id: '1', name: 'Milk', checked: true }, { id: '2', name: 'Eggs', checked: false }] };
  const local: { items: Item[] } = { items: [] };           // "clear done" on a stale list
  const out = mergeShared(base, local, server);
  assert.deepStrictEqual(names(out.items), ['Eggs']);       // ours cleared, theirs kept
});

// ── the members/events id index (metadata/members, metadata/events) ─────────
check('a stale device cannot drop a member somebody else just added', () => {
  let server = ['m1'];
  const mamaBase = ['m1'];
  const papaBase = ['m1'];

  server = mergeIdList(mamaBase, ['m1', 'm2'], server);           // Mama adds m2
  assert.deepStrictEqual(server.sort(), ['m1', 'm2']);

  server = mergeIdList(papaBase, ['m1', 'm3'], server);           // Papa, stale, adds m3
  assert.deepStrictEqual([...server].sort(), ['m1', 'm2', 'm3']); // m2 still listed
});

check('removing a member from the index still works', () => {
  const out = mergeIdList(['m1', 'm2'], ['m1'], ['m1', 'm2']);
  assert.deepStrictEqual(out, ['m1']);
});

check('a member deleted elsewhere is not resurrected by a stale save', () => {
  // base has m2, server no longer does (deleted on another device), and our
  // stale array still lists it — we did not re-add it, so honour the delete.
  const out = mergeIdList(['m1', 'm2'], ['m1', 'm2'], ['m1']);
  assert.deepStrictEqual(out, ['m1']);
});

check('id-index merge keeps the local order and appends remote additions', () => {
  const out = mergeIdList(['a'], ['a', 'b'], ['a', 'z']);
  assert.deepStrictEqual(out, ['a', 'b', 'z']);
});

check('id-index merge with no base never drops anything', () => {
  assert.deepStrictEqual(mergeIdList(undefined, ['b'], ['a']).sort(), ['a', 'b']);
});

// ── helpers ─────────────────────────────────────────────────────────────────
check('isIdArray only accepts arrays of id-bearing objects', () => {
  assert.strictEqual(isIdArray([{ id: 'a' }]), true);
  assert.strictEqual(isIdArray([]), true);
  assert.strictEqual(isIdArray(['a', 'b']), false);
  assert.strictEqual(isIdArray([{ name: 'a' }]), false);
  assert.strictEqual(isIdArray({ id: 'a' }), false);
});

check('deepEqual treats an absent key and an undefined key as equal', () => {
  assert.strictEqual(deepEqual({ a: 1 }, { a: 1, b: undefined }), true);
  assert.strictEqual(deepEqual({ a: 1 }, { a: 1, b: null }), false);
  assert.strictEqual(deepEqual([1, 2], [1, 2]), true);
  assert.strictEqual(deepEqual([1, 2], [2, 1]), false);
});

// ── a longer, randomised soak: many stale writers, nothing may vanish ───────
check('50 interleaved stale writers never lose an added item', () => {
  let server: { items: Item[] } = { items: [] };
  const added = new Set<string>();
  // Each writer captures a base, then saves LATER — after several other writers
  // have already committed. Classic lost-update setup.
  const pending: { base: { items: Item[] }; local: { items: Item[] } }[] = [];
  for (let i = 0; i < 50; i++) {
    const base = structuredClone(server);
    const id = `x${i}`;
    added.add(id);
    pending.push({ base, local: { items: [...base.items, { id, name: id }] } });
    // Commit an older pending write (stale by up to 5 rounds), not the newest.
    if (pending.length >= 5) {
      const w = pending.shift()!;
      server = mergeShared(w.base, w.local, server);
    }
  }
  for (const w of pending) server = mergeShared(w.base, w.local, server);
  assert.strictEqual(server.items.length, 50);
  for (const id of added) assert.ok(server.items.some(i => i.id === id), `${id} was lost`);
});

console.log(`\n${checks} checks passed.\n`);
