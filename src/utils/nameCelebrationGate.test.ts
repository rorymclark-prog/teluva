import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The family-wide "don't suggest religious celebrations" switch, as reached
// from inside the name-celebration modal.
//
// Two things about that path are subtle enough to be re-broken by someone
// tidying the code, and both fail SILENTLY — the button still renders, still
// saves, and still comes back with nothing:
//
//  1. runResearch closes over the suppressReligiousSuggestions PROP. Right
//     after an admin switches religious suggestions back on, that prop is
//     still the old `true` for the remainder of the tick. The server ORs the
//     posted flag with the family's stored one, so posting the stale `true`
//     suppresses the very search the button exists to unblock. The handler
//     must pass the override explicitly.
//
//  2. /api/set-suggestion-prefs is admin-only (403 otherwise). The callback is
//     therefore handed down ONLY for an admin — its absence is what makes the
//     modal draw "an admin can turn them back on" instead of a button that
//     cannot work.
// ---------------------------------------------------------------------------

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

const modal = read('components/NameCelebrationModal.tsx');
const editor = read('components/EditMemberModal.tsx');
const server = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');

// --- 1. the re-search after switching must not post the stale flag ---------
{
  assert.match(
    modal,
    /suppressReligious: suppressOverride \?\? suppressReligiousSuggestions,/,
    'runResearch no longer honours a suppress override — the search fired right after an admin turns religious ' +
      'suggestions on will post the stale prop and come back suppressed.',
  );
  const handler = modal.match(/async function handleAllowReligious\(\)[\s\S]*?\n {2}\}/);
  assert.ok(handler, 'handleAllowReligious has gone — the modal no longer offers a way past the switch.');
  assert.match(
    handler[0],
    /await onChangeSuppressReligious\(false\);/,
    'handleAllowReligious must AWAIT the save: the server re-reads the family flag on every research call, ' +
      'so a fire-and-forget save races it.',
  );
  assert.match(
    handler[0],
    /runResearch\(rejectedTitles, false\)/,
    'handleAllowReligious must pass the explicit false override to runResearch (see the note at the top of this file).',
  );
  // The declined titles are the family's own answers and survive the switch.
  assert.doesNotMatch(
    handler[0],
    /setRejectedTitles\(\[\]\)/,
    'handleAllowReligious must not clear rejectedTitles — those are proposals the family actually saw and declined, ' +
      'and "never repeat a declined title" holds regardless of why the last search came back empty.',
  );
}

// --- 2. the control is admin-only, and the server is the real enforcer -----
{
  assert.match(
    editor,
    /onChangeSuppressReligious=\{isAdmin \? handleChangeSuppressReligious : undefined\}/,
    'EditMemberModal must hand the switch callback to admins only — /api/set-suggestion-prefs 403s for everyone else, ' +
      'so a non-admin would get a button that always fails.',
  );
  assert.match(
    server,
    /set-suggestion-prefs[\s\S]{0,600}?caller\.role !== 'admin'/,
    'server.js no longer admin-gates /api/set-suggestion-prefs. The client gate above is cosmetic — this is the real one.',
  );
  // A non-admin must still be told who can change it, not left at a dead end.
  assert.match(
    modal,
    /An admin can turn them back on/,
    'the non-admin copy no longer names who can change the setting, which puts them back at the dead end this fixed.',
  );
}

// --- 3. writes still go through the server, never straight to Firestore ----
{
  assert.match(
    editor,
    /saveSuppressReligiousSuggestions/,
    'EditMemberModal must write this preference through utils/db\'s server-backed helper.',
  );
  assert.doesNotMatch(
    editor,
    /setDoc\(|updateDoc\(/,
    'EditMemberModal must not write Firestore directly — the space info doc has server-only writers.',
  );
}

console.log('nameCelebrationGate.test.ts: all assertions passed');
