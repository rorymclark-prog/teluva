// Source-text guards for the life timeline's wiring: things a type check can't
// see, because each one is a call that still compiles when it goes wrong.
//
// Each guard runs its checker once on the real source and once on a mutated
// copy (the CONTROL), so a reflow that stops a pattern matching fails the test
// instead of silently passing it.
//
// Run: npx tsx src/utils/timelineWiring.test.ts
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(src, rel), 'utf8');

const timelineView = read('components/TimelineView.tsx');
const dashboard = read('components/Dashboard.tsx');
const destructive = read('utils/aiDestructive.ts');

// 1. Every save of the timeline passes the version it started from, so the
//    shared-doc store can three-way merge: a moment someone else added in the
//    meantime survives, and a delete only lands if nobody touched that moment
//    since. Restoring a backup is the one deliberate whole-document replace.
const BASELESS_ALLOWED = ['saveTimeline(backupData.timeline)'];
function baselessSaves(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    for (const m of text.matchAll(/saveTimeline\(/g)) {
      // Walk to the matching paren; a comma at depth 1 means a base was passed.
      let depth = 0;
      let i = m.index! + 'saveTimeline'.length;
      let comma = false;
      for (; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) break; }
        else if (c === ',' && depth === 1) comma = true;
      }
      const call = text.slice(m.index!, i + 1);
      if (!comma && !BASELESS_ALLOWED.includes(call)) out.push(`${name}: ${call}`);
    }
  }
  return out;
}
const callers = {
  'components/Dashboard.tsx': dashboard,
  'components/TimelineView.tsx': timelineView,
  'utils/aiDestructive.ts': destructive,
};
const totalCalls = Object.values(callers).reduce((n, t) => n + (t.match(/saveTimeline\(/g) || []).length, 0);
assert.ok(totalCalls >= 5, `expected at least five saveTimeline calls (view, AI apply, AI undo, AI update/delete, backup), found ${totalCalls}`);
assert.deepStrictEqual(baselessSaves(callers), [], 'a saveTimeline call drops the merge base');
assert.deepStrictEqual(
  baselessSaves({ mutated: 'await saveTimeline({ ...t, entries: arr });' }),
  ['mutated: saveTimeline({ ...t, entries: arr })'],
  'CONTROL: the base guard must catch a call without a base',
);
assert.deepStrictEqual(baselessSaves({ ok: 'await saveTimeline({ ...t, entries: arr }, t);' }), [],
  'CONTROL: a call WITH a base is not flagged');

// 2. Editing a moment rebuilds it from the form, and the form only knows the
//    fields it shows. The stored entry must be spread FIRST, so source,
//    importBatchId (and anything added later) survive an edit — a key missing
//    from a rebuilt entry is a DELETE of that key.
const saveMomentBody = (text: string) => /const saveMoment = async[\s\S]*?\n {2}\};\n/.exec(text)?.[0] ?? '';
const spreadsExistingFirst = (body: string) => {
  const ex = body.search(/\.\.\.\(existing \|\|/);
  const dr = body.indexOf('...draft');
  return ex !== -1 && dr !== -1 && ex < dr;
};
assert.ok(saveMomentBody(timelineView), 'could not find saveMoment in TimelineView.tsx');
assert.ok(spreadsExistingFirst(saveMomentBody(timelineView)), 'saveMoment must spread the stored entry before the form draft');
assert.ok(!spreadsExistingFirst(saveMomentBody(timelineView).replace(/\.\.\.\(existing \|\|[^)]*\),/, '')),
  'CONTROL: the spread guard must catch a rebuilt entry that drops the stored one');

// 3. Undo removes exactly that import's rows, through the merge-safe save.
const undoBody = (text: string) => /const undoImport = async[\s\S]*?\n {2}\};\n/.exec(text)?.[0] ?? '';
const undoIsExact = (body: string) =>
  /\.filter\(\(e\) => e\.importBatchId !== lastImport\.batchId\)/.test(body) && /persist\([^;]*, current\)/.test(body);
assert.ok(undoBody(timelineView), 'could not find undoImport in TimelineView.tsx');
assert.ok(undoIsExact(undoBody(timelineView)), 'undoImport must filter by importBatchId and save with its base');
assert.ok(!undoIsExact(undoBody(timelineView).replace('e.importBatchId !== lastImport.batchId', "e.source !== 'import'")),
  'CONTROL: the undo guard must catch an undo that removes every imported row, not just this batch');

// 4. "Build my timeline" is offered only to someone who can write, never on the
//    business timeline, and sits next to "Add moment" in the header row that
//    the ember, classic and person views all share.
const CAN_IMPORT = /const canImport = canEdit && !isBusinessSpace;/;
assert.ok(CAN_IMPORT.test(timelineView), 'canImport must be canEdit && !isBusinessSpace');
assert.ok(!CAN_IMPORT.test(timelineView.replace(CAN_IMPORT, 'const canImport = canEdit;')),
  'CONTROL: the gate guard must catch an import offered in the business space');
const importNextToAdd = (text: string) => {
  const btn = text.indexOf('{canImport && (\n');
  const label = text.indexOf('Build my timeline', btn);
  const add = text.indexOf('Add moment', label);
  return btn !== -1 && label - btn < 400 && add - label < 400;
};
assert.ok(importNextToAdd(timelineView), 'the Build my timeline button must sit behind canImport, next to Add moment');
assert.ok(!importNextToAdd(timelineView.replace('{canImport && (\n', '{true && (\n')),
  'CONTROL: the placement guard must catch an ungated Build my timeline button');
const modalGated = (text: string) => /\{canImport && \(\s*<TimelineImportModal\b/.test(text);
assert.ok(modalGated(timelineView), 'the import modal must only mount behind canImport');
assert.ok(!modalGated(timelineView.replace(/\{canImport && \(\s*<TimelineImportModal/, '{(\n<TimelineImportModal')),
  'CONTROL: the modal guard must catch an ungated modal');

// 5. The person's timeline preselects that person on imported rows.
const prefills = (text: string) => /<TimelineImportModal[\s\S]*?defaultMemberId=\{person\?\.id\}[\s\S]*?\/>/.test(text);
assert.ok(prefills(timelineView), 'the import modal must preselect the person whose timeline this is');
assert.ok(!prefills(timelineView.replace('defaultMemberId={person?.id}', '')), 'CONTROL: the prefill guard must catch a missing defaultMemberId');

console.log('timelineWiring.test.ts: all assertions passed');

const cvSource = fs.readFileSync(new URL('../components/MemberCV.tsx', import.meta.url), 'utf8');
assert.ok(cvSource.includes('(isDemoMode() || isBusinessSpace) ?'), 'business CV uploads retain record-level access instead of moving to the shared bucket');
assert.ok(cvSource.includes('isBusinessSpace ? 700*1024'), 'inline business CVs retain the existing Firestore size limit');
