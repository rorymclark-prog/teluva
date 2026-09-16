// Standalone assertion test — no test runner is configured in this project:
//   npx tsx src/utils/calendarConsentNotice.test.ts
// Exits non-zero on failure.
//
// THE WARNING BEFORE GOOGLE'S WARNING.
//
// `calendar.events` is a Google "sensitive" scope and Teluva has not been
// through OAuth verification, so Connect Google Calendar opens on a red
// interstitial that reads "Google hasn't verified this app … you shouldn't use
// it", with the only way forward hidden behind an "Advanced" disclosure and
// labelled "(unsafe)".
//
// This is not a bug and there is no code fix for it — the fix is telling the
// person a moment BEFORE they press the button, because the same explanation
// afterwards is reassurance nobody believes. What is worth pinning is
// therefore ORDER and GATE, neither of which any rendering test would catch:
//
//   1. The notice must be reachable while still DISCONNECTED. Gated on
//      `!needsAuth` it would only ever appear to people who already got
//      through, which is precisely nobody who needs it.
//   2. It must say the two words the person has to act on — "Advanced" and
//      the "(unsafe)" link. A notice that says "you may see a warning" and
//      stops is what leaves them stuck on Google's screen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${(err as Error)?.message || err}`); }
}

const src = fs.readFileSync(path.join(process.cwd(), 'src/components/FamilyCalendar.tsx'), 'utf8');
const NOTICE = 'Google shows a warning first';
const noticeAt = src.indexOf(NOTICE);
const buttonAt = src.indexOf('Connect Google Calendar');

console.log('the notice exists and is actionable');

check('the notice is present', () => {
  assert.ok(noticeAt > -1, 'the pre-consent notice has gone — people meet Google\'s red screen cold again.');
});

check('it quotes what Google actually says, so the screen is recognisable', () => {
  assert.match(src, /Google hasn’t verified this app/,
    "the notice no longer quotes Google's own wording — the person cannot tell it is the screen being described.");
});

check('it names both steps needed to get through', () => {
  const block = src.slice(noticeAt, noticeAt + 1600);
  assert.match(block, /\bAdvanced\b/, 'the notice does not tell them to tap Advanced — the continue link stays hidden.');
  assert.match(block, /\(unsafe\)/, 'the notice does not name the "(unsafe)" link, which is the only way forward.');
});

check('it states the scope actually being granted', () => {
  const block = src.slice(noticeAt, noticeAt + 1600);
  assert.match(block, /calendar events/i, 'the notice no longer says what permission is being given.');
  // The reassurance has to be specific to be worth anything. "It's safe"
  // is not a claim anyone can check; "not your Gmail or contacts" is.
  assert.match(block, /Gmail/, 'the notice dropped the concrete limit on what is NOT granted.');
});

console.log('placement — the part a rendering test would miss');

check('it appears BEFORE the connect button in the source', () => {
  assert.ok(buttonAt > -1, 'the Connect Google Calendar button has gone');
  assert.ok(noticeAt < buttonAt,
    'the notice now renders after the connect button — the warning arrives once the person is already on Google\'s screen.');
});

check('it is gated on being DISCONNECTED, not connected', () => {
  // The failure this catches: `!needsAuth &&`, which shows the explanation
  // exclusively to people who no longer need it.
  const before = src.slice(0, noticeAt);
  const lastGate = before.lastIndexOf('needsAuth &&');
  assert.ok(lastGate > -1, 'the notice is not inside a needsAuth gate at all');
  assert.notEqual(before[lastGate - 1], '!',
    'the notice is gated on !needsAuth — it would only ever be shown to members who are already connected.');
});

if (failures) {
  console.error(`\ncalendarConsentNotice.test.ts: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\ncalendarConsentNotice.test.ts: all assertions passed');
