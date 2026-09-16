// Standalone assertion test — no test runner is configured in this project:
//   npx tsx src/utils/googleDisconnect.test.ts
// Exits non-zero on failure.
//
// A DISCONNECT THAT UNDOES ITSELF.
//
// Clearing the cached access token is not a disconnect. The GRANT still exists
// at Google, so the next silent mint — an automatic sync, a reload, initAuth's
// own call — brings the connection straight back. The person presses
// Disconnect, sees "Offline", reopens the app and finds it Connected: worse
// than no button, because it reads as the app overruling them.
//
// The same shape of bug sits behind "use a different account": a silent mint,
// or `prompt: 'consent'`, hands back the account ALREADY attached — the exact
// one they are trying to leave. Only `select_account` shows the list.
//
// Neither failure throws, neither shows an error, and both look correct in any
// screenshot taken within the same second. So what is pinned here is the small
// set of facts that make the difference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${(err as Error)?.message || err}`); }
}

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const firebase = read('src/utils/firebase.ts');
const token = read('src/utils/googleToken.ts');
const calendar = read('src/components/FamilyCalendar.tsx');

console.log('the disconnect survives a reload');

check('disconnecting persists a flag, not just an in-memory clear', () => {
  assert.match(firebase, /export const disconnectGoogleAccess/,
    'disconnectGoogleAccess has gone — the connected state has no way out again.');
  const fn = firebase.match(/export const disconnectGoogleAccess = \(\) => \{[\s\S]*?\n\};/);
  assert.ok(fn, 'disconnectGoogleAccess is no longer a plain function — check it still persists the choice');
  assert.match(fn[0], /writeDisconnected\([^)]*true\)/,
    'disconnect no longer records the choice, so the next silent token request reconnects it.');
  assert.match(fn[0], /setToken\(null, null\)/, 'disconnect leaves the current token live');
});

check('the silent path refuses to mint while disconnected', () => {
  const fn = firebase.match(/async function trySilentToken\(\)[\s\S]*?\n\}/);
  assert.ok(fn, 'trySilentToken has gone');
  assert.match(fn[0], /readDisconnected/,
    'trySilentToken no longer checks the disconnect flag — the connection re-establishes itself on the next reload.');
});

check('the flag is per-user, not global', () => {
  // A shared laptop: one member disconnecting must not disconnect the other.
  assert.match(firebase, /DISCONNECT_KEY\}\.\$\{uid\}/,
    'the disconnect flag is no longer keyed by uid — one member disconnecting would disconnect everyone on that device.');
});

check('storage refusal does not abort the disconnect', () => {
  // Private-mode browsers throw on setItem. Losing the preference across a
  // reload is acceptable; failing to disconnect at all is not.
  const fn = firebase.match(/function writeDisconnected[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /catch/, 'writeDisconnected can now throw, which would abort the disconnect it was called for.');
});

console.log('pressing Connect is what reverses it');

check('connect clears the flag before attempting a silent mint', () => {
  const fn = firebase.match(/export const connectGoogleAccess = async \([\s\S]*?\n\};/);
  assert.ok(fn, 'connectGoogleAccess has gone');
  // Match the CALL, not the word: the comment above it names trySilentToken
  // too, and an indexOf on the bare name finds the prose first.
  const clearAt = fn[0].indexOf('writeDisconnected(');
  const silentAt = fn[0].indexOf('await trySilentToken()');
  assert.ok(clearAt > -1, 'connect no longer clears the disconnect flag — the Connect button would do nothing at all.');
  assert.ok(silentAt > -1 && clearAt < silentAt,
    'the flag is cleared after the silent attempt, which the flag itself suppresses — Connect would always fall through to a popup.');
});

console.log('switching account actually offers a choice');

check('a chooser request exists and uses select_account', () => {
  assert.match(token, /export async function chooseAccountAccessToken/,
    'chooseAccountAccessToken has gone');
  const fn = token.match(/export async function chooseAccountAccessToken[\s\S]*?\n\}/);
  assert.ok(fn);
  assert.match(fn[0], /'select_account'/,
    "the chooser no longer sends prompt:'select_account' — 'consent' re-approves the SAME account, which is the one being switched away from.");
});

check('switching skips the silent path', () => {
  const fn = firebase.match(/export const connectGoogleAccess = async \([\s\S]*?\n\};/);
  assert.ok(fn);
  assert.match(fn[0], /if \(!options\?\.chooseAccount\)/,
    'the silent mint is no longer skipped when choosing an account — it would return the already-attached account and no chooser would appear.');
});

console.log('the controls are on screen');

check('the connected state offers both Disconnect and a different account', () => {
  assert.match(calendar, /<span>Disconnect<\/span>/, 'the Disconnect control has gone from the calendar screen.');
  assert.match(calendar, /<span>Use a different account<\/span>/, 'the account-switch control has gone.');
});

check('the v300 notice\'s promise is now true', () => {
  // The notice tells people they can disconnect from this screen. It shipped
  // before the control existed; this asserts the pair stays together.
  assert.match(calendar, /can disconnect it again from this screen/,
    'the consent notice no longer makes the promise — if that was deliberate, delete this assertion too.');
  assert.match(calendar, /handleDisconnectGoogle/,
    'the notice promises a disconnect this screen cannot perform.');
});

if (failures) {
  console.error(`\ngoogleDisconnect.test.ts: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\ngoogleDisconnect.test.ts: all assertions passed');
