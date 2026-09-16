// Standalone assertion test — no test runner is configured in this project:
//   npx tsx src/utils/accountChooser.test.ts
// Exits non-zero on failure.
//
// "I SIGNED OUT AND IT SIGNED ME BACK INTO THE SAME ACCOUNT."
//
// Signing out of Teluva does not sign the browser out of Google. With a single
// Google session live, Google reuses it silently — so a family sharing a
// tablet cannot hand it over: whoever signs in gets the account the last
// person left behind, with no chooser and nothing to click. There is no error,
// no failed state, and the screen looks completely normal. It is simply a
// dead end.
//
// `select_account` is the ONLY prompt value that shows the account list.
// `consent` re-approves the same account AND re-runs the full permissions
// screen — the exact behaviour utils/firebase.ts deliberately removed — so a
// well-meaning swap to 'consent' would look like a fix and be a regression in
// two directions at once.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${(err as Error)?.message || err}`); }
}

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const lib = read('src/lib/firebase.ts');
const dashboard = read('src/components/Dashboard.tsx');

const login = lib.match(/export const loginWithGoogle = async \([\s\S]*?\n\};/);

console.log('the chooser exists and asks for the right thing');

check('loginWithGoogle takes a chooseAccount option', () => {
  assert.ok(login, 'loginWithGoogle has gone or changed shape');
  assert.match(login[0], /chooseAccount\?: boolean/,
    'loginWithGoogle no longer accepts chooseAccount — the sign-in screen has no way to ask for the account list.');
});

check("it sends prompt:'select_account', not 'consent'", () => {
  assert.match(login[0], /prompt: 'select_account'/,
    "the chooser no longer sends select_account. 'consent' re-approves the SAME account and re-runs the whole permissions screen.");
  assert.doesNotMatch(login[0], /prompt: 'consent'/,
    "'consent' is back: it does not show the account list, and it reintroduces the full consent screen on every sign-in.");
});

console.log('the ordinary sign-in stays fast');

check('the chooser is opt-in, not forced on everyone', () => {
  // Forcing select_account unconditionally costs a tap for the majority who
  // have one Google account and just want in.
  assert.match(login[0], /options\?\.chooseAccount \? \{ prompt: 'select_account' \} : \{\}/,
    'the prompt is no longer conditional — either the chooser never appears, or it appears for everybody on every sign-in.');
});

check('the parameter is written on every call, not once at module scope', () => {
  // A provider left holding select_account from a previous press would put
  // the chooser in front of every subsequent sign-in.
  assert.match(login[0], /provider\.setCustomParameters\(/,
    'setCustomParameters no longer runs inside loginWithGoogle — a previous "use another account" press would leak into later sign-ins.');
});

console.log('and there is something to press');

check('the sign-in screen offers the control', () => {
  assert.match(dashboard, /Use a different Google account/,
    'the control has gone from the sign-in screen — the option exists in code and is unreachable.');
  assert.match(dashboard, /loginWithGoogle\(\{ chooseAccount: true \}\)/,
    'the control no longer passes chooseAccount, so it behaves identically to the ordinary sign-in button.');
});

check('it is a real labelled control, not a hidden gesture', () => {
  // The people who need it are exactly the ones stuck on this screen.
  const idx = dashboard.indexOf('Use a different Google account');
  const block = dashboard.slice(Math.max(0, idx - 700), idx);
  assert.match(block, /<button/, 'the control is no longer a button');
  assert.match(block, /disabled=\{signingIn\}/, 'the control can be pressed mid-sign-in, firing two popups at once');
});

if (failures) {
  console.error(`\naccountChooser.test.ts: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\naccountChooser.test.ts: all assertions passed');
