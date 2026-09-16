// Standalone assertion test — no test runner is configured in this project:
//   npx tsx src/utils/feedbackWiring.test.ts
// Exits non-zero on failure.
//
// server/feedback.test.mjs owns the validation and identity rules. What is left
// to protect is the part a later tidy-up could quietly remove without breaking
// a single one of those assertions:
//
//   THE DISCLOSURE. Every other word typed into Teluva stays inside the
//   family. A feedback message does not — it goes to the person who builds
//   the app, with the sender's name on it. Someone about to describe a problem
//   involving their family's documents has to be told that BEFORE they type.
//   Deleting that paragraph leaves a working feature that silently takes
//   private words out of a private space, and nothing else in the suite would
//   notice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${(err as Error)?.message || err}`); }
}

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
const modal = read('components/FeedbackModal.tsx');
const dashboard = read('components/Dashboard.tsx');

console.log('the feedback box tells people where their words go');

check('it says the message leaves the family, and who receives it', () => {
  assert.match(
    modal,
    /goes to the person who builds Teluva/,
    'the disclosure is gone: the box now sends a family member\'s words outside their space without saying so.',
  );
});

check('it names what travels with the message', () => {
  // Naming the payload beats "some diagnostic information" — there is no
  // version of that phrasing that reads better than the plain list.
  assert.match(modal, /your name and which\s*\n?\s*screen you were on/, 'the box no longer says what is attached.');
});

check('it warns against pasting documents rather than staying silent', () => {
  assert.match(modal, /describe it rather than pasting it/);
});

console.log('the entry point is reachable and is not next to a destructive row');

check('the account menu has a labelled Send feedback row', () => {
  assert.match(dashboard, /Send feedback</, 'the menu row is gone — the feature is unreachable.');
  assert.match(dashboard, /setIsFeedbackOpen\(true\)/);
});

check('the row sits ABOVE the divider that precedes Leave / Sign out', () => {
  // Scoped to the menu itself: handleLeaveFamily is DEFINED hundreds of lines
  // earlier, so comparing positions across the whole file compares the wrong
  // two things and fails on correct code.
  const menu = dashboard.match(/const accountMenuItems = [\s\S]*?\n  \) : null;/);
  assert.ok(menu, 'the account menu block has gone');
  const row = menu[0].indexOf('Send feedback<');
  const leave = menu[0].indexOf('onClick={handleLeaveFamily}');
  assert.ok(row > 0, 'Send feedback is not in the account menu');
  assert.ok(leave > 0, 'Leave-family is not in the account menu');
  assert.ok(
    row < leave,
    'Send feedback moved below Leave this family — reporting a problem must never sit a mis-tap away from leaving.',
  );
});

console.log('the report carries the screen it came from');

check('Dashboard passes the live view, not a constant', () => {
  assert.match(
    dashboard,
    /screen=\{mainView\}/,
    'the screen is no longer the current view — feedback without "where" is half a report.',
  );
});

if (failures) {
  console.error(`\nfeedbackWiring.test.ts: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nfeedbackWiring.test.ts: all assertions passed');
