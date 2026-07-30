// Standalone assertion test — no test runner is configured in this project,
// so run it directly:  npx tsx src/utils/aiStatusEdit.test.ts
// Exits non-zero on failure.
//
// Covers applyStatusEdit/hasStatusEdits — the fix for the sixth instance of
// this codebase's "invisible to the AI" bug class (HubSettings.status).
import assert from 'node:assert';
import { hasStatusEdits, applyStatusEdit } from './aiApply';
import type { AiEdit } from '../components/AIChatbot';

const edit = (text: string): AiEdit => ({ kind: 'hub_status', text });

// --- detection --------------------------------------------------------------
assert.strictEqual(hasStatusEdits([edit('Away until Sunday')]), true);
assert.strictEqual(hasStatusEdits([{ kind: 'household_set', field: 'address', value: 'x' } as any]), false);
assert.strictEqual(hasStatusEdits([]), false);

// --- setting a fresh status ---------------------------------------------------
{
  const next = applyStatusEdit(undefined, [edit('Everyone at Oma\'s until Sunday')], 'Mama');
  assert.deepStrictEqual(next && { text: next.text, by: next.by }, { text: "Everyone at Oma's until Sunday", by: 'Mama' });
  assert.ok(next?.at && !Number.isNaN(Date.parse(next.at)), 'at must be a real ISO timestamp');
}

// --- REPLACES, never appends (unlike designated_successor's field-preserving merge) ---
{
  const current = { text: 'Old status', by: 'Papa', at: '2026-01-01T00:00:00.000Z' };
  const next = applyStatusEdit(current, [edit('New status')], 'Mama');
  assert.strictEqual(next?.text, 'New status');
  assert.strictEqual(next?.by, 'Mama', 'attribution moves to whoever set the NEW status');
  assert.notStrictEqual(next?.at, current.at, 'timestamp must restamp on every real change');
}

// --- an edit with no real text is a no-op, not a clear -----------------------
// (clear_field is the dedicated "remove this" path elsewhere in the pipeline;
// a blank hub_status reads as a malformed edit, not intent to clear.)
{
  const current = { text: 'Still here', by: 'Papa', at: '2026-01-01T00:00:00.000Z' };
  assert.deepStrictEqual(applyStatusEdit(current, [edit('   ')], 'Mama'), current);
  assert.deepStrictEqual(applyStatusEdit(current, [edit('')], 'Mama'), current);
}

// --- undefined current + no valid edits stays undefined -----------------------
assert.strictEqual(applyStatusEdit(undefined, [edit('')], 'Mama'), undefined);
assert.strictEqual(applyStatusEdit(undefined, [], 'Mama'), undefined);

// --- only the LAST hub_status edit in a batch wins (mirrors household_set) ---
{
  const next = applyStatusEdit(undefined, [edit('First'), edit('Second'), edit('Third')], 'Mama');
  assert.strictEqual(next?.text, 'Third');
}

// --- other edit kinds in the same batch are ignored, not mistaken for status --
{
  const mixed: AiEdit[] = [{ kind: 'household_set', field: 'address', value: 'x' } as any, edit('Only this counts')];
  const next = applyStatusEdit(undefined, mixed, 'Mama');
  assert.strictEqual(next?.text, 'Only this counts');
}

console.log('aiStatusEdit.test.ts: all assertions passed');
