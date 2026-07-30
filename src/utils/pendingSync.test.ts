// Standalone assertion test — no test runner is configured in this project,
// so run it directly:  npx tsx src/utils/pendingSync.test.ts
// Exits non-zero on failure.
import assert from 'node:assert';
import { markDirty, clearDirty, isDirty } from './pendingSync';

// Minimal in-memory shim — same pattern as installPrompt.test.ts.
(globalThis as any).localStorage = {
  _store: new Map<string, string>(),
  getItem(k: string) { return this._store.has(k) ? this._store.get(k) : null; },
  setItem(k: string, v: string) { this._store.set(k, v); },
  removeItem(k: string) { this._store.delete(k); },
};

// --- a key with no history is clean --------------------------------------
assert.strictEqual(isDirty('members', 'fam-a'), false, 'never-touched key is not dirty');

// --- marking sets it, clearing unsets it ----------------------------------
markDirty('members', 'fam-a');
assert.strictEqual(isDirty('members', 'fam-a'), true, 'markDirty makes it dirty');
clearDirty('members', 'fam-a');
assert.strictEqual(isDirty('members', 'fam-a'), false, 'clearDirty makes it clean again');

// --- scoped independently by docKey ---------------------------------------
markDirty('members', 'fam-a');
assert.strictEqual(isDirty('calendar', 'fam-a'), false, 'a different docKey in the same family is untouched');
clearDirty('members', 'fam-a');

// --- scoped independently by familyId — the exact bug this exists to avoid:
// a Business Hub user with the SAME device moving between two spaces must
// never have one space's pending edit block, or falsely clear, another's. ---
markDirty('members', 'fam-a');
assert.strictEqual(isDirty('members', 'fam-b'), false, 'a different family is never dirty from this');
clearDirty('members', 'fam-b'); // no-op, key never set — must not throw
assert.strictEqual(isDirty('members', 'fam-a'), true, 'clearing an unrelated family did not touch fam-a');
clearDirty('members', 'fam-a');

// --- idempotent: clearing twice, or a key that was never set, is a no-op --
clearDirty('never-set', 'fam-a');
assert.strictEqual(isDirty('never-set', 'fam-a'), false);

// --- a private-mode / storage-disabled environment fails safe, not loud ---
{
  const realStorage = (globalThis as any).localStorage;
  (globalThis as any).localStorage = {
    getItem() { throw new Error('storage disabled'); },
    setItem() { throw new Error('storage disabled'); },
    removeItem() { throw new Error('storage disabled'); },
  };
  assert.doesNotThrow(() => markDirty('members', 'fam-a'));
  assert.doesNotThrow(() => clearDirty('members', 'fam-a'));
  assert.strictEqual(isDirty('members', 'fam-a'), false, 'storage errors read as "not dirty", never crash the caller');
  (globalThis as any).localStorage = realStorage;
}

console.log('pendingSync.test.ts: all assertions passed');
