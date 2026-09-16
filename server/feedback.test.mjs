// Standalone assertions for server/feedback.mjs — run by `npm run test:server`.
//
// The feedback box is the only place in Teluva where a family member's words
// deliberately LEAVE their own space, so the two things worth pinning are the
// ones that would be expensive to get wrong and invisible when wrong:
//
//   1. IDENTITY IS NOT CLIENT-SUPPLIED. Feedback is read later as evidence
//      about a real person's experience of the app. If the browser could name
//      the sender, any signed-in account could file a complaint under someone
//      else's name and nothing downstream would ever know.
//   2. A MESSAGE IS NEVER LOST TO ITS OWN METADATA. Odd or missing screen
//      info must degrade, never reject — and an over-long message must be
//      refused out loud rather than silently truncated, because the part that
//      gets cut is the end, and the end is usually the point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedback, buildFeedbackDoc, MAX_FEEDBACK_CHARS } from './feedback.mjs';

const CALLER = { uid: 'u-real', email: 'someone@example.com', familyId: 'fam-1', role: 'member' };


test('an ordinary message passes and is trimmed', () => {
  const r = validateFeedback({ message: '  the scanner button is hard to find  ', screen: 'vault' });
  assert.equal(r.ok, true);
  assert.equal(r.message, 'the scanner button is hard to find');
  assert.equal(r.screen, 'vault');
});

test('an empty or whitespace-only message is refused', () => {
  for (const message of ['', '   ', '\n\t ', undefined, null, 42, {}]) {
    const r = validateFeedback({ message });
    assert.equal(r.ok, false, `"${String(message)}" was accepted as a message`);
    assert.ok(r.error, 'a refusal with no error text tells the person nothing');
  }
});

test('an over-long message is REFUSED, not truncated', () => {
  const r = validateFeedback({ message: 'x'.repeat(MAX_FEEDBACK_CHARS + 1) });
  assert.equal(r.ok, false);
  // The distinction that matters: a truncating implementation would return
  // ok:true with a shortened message and the person would never know the end
  // of what they wrote was thrown away.
  assert.equal(r.message, undefined);
  assert.match(r.error, /shorten/i);
});

test('exactly at the limit is still fine', () => {
  const r = validateFeedback({ message: 'x'.repeat(MAX_FEEDBACK_CHARS) });
  assert.equal(r.ok, true);
  assert.equal(r.message.length, MAX_FEEDBACK_CHARS);
});


test('a missing, wrong-typed or absurd screen degrades to unknown', () => {
  for (const screen of [undefined, null, 123, {}, '   ', 'z'.repeat(500)]) {
    const r = validateFeedback({ message: 'something is broken', screen });
    assert.equal(r.ok, true, `screen ${JSON.stringify(screen)} caused the MESSAGE to be rejected`);
    assert.equal(r.screen, 'unknown');
    assert.equal(r.message, 'something is broken');
  }
});


test('a body claiming someone else\'s identity cannot override the caller', () => {
  const hostile = validateFeedback({
    message: 'this app is terrible',
    screen: 'home',
    // All of these are ignored by construction — buildFeedbackDoc only ever
    // reads the validated {message, screen}, never the raw body.
    uid: 'u-victim',
    email: 'victim@example.com',
    familyId: 'someone-elses-family',
    role: 'admin',
  });
  assert.equal(hostile.ok, true);
  const doc = buildFeedbackDoc(hostile, CALLER);
  assert.equal(doc.uid, 'u-real');
  assert.equal(doc.email, 'someone@example.com');
  assert.equal(doc.familyId, 'fam-1');
  assert.equal(doc.role, 'member');
});

test('the screen is recorded — feedback without "where" is half a report', () => {
  const doc = buildFeedbackDoc(validateFeedback({ message: 'stuck', screen: 'calendar' }), CALLER);
  assert.equal(doc.screen, 'calendar');
  assert.equal(doc.message, 'stuck');
});

test('a caller missing optional fields yields nulls, not undefined', () => {
  // undefined is not a storable Firestore value and throws on write; a
  // brand-new member mid-join legitimately has no role yet.
  const doc = buildFeedbackDoc(validateFeedback({ message: 'hi' }), { uid: 'u-new' });
  assert.equal(doc.email, null);
  assert.equal(doc.familyId, null);
  assert.equal(doc.role, null);
  for (const [k, v] of Object.entries(doc)) {
    assert.notEqual(v, undefined, `${k} is undefined — Firestore rejects the whole write`);
  }
});

test('unbounded meta is clipped so one report cannot bloat the collection', () => {
  const doc = buildFeedbackDoc(validateFeedback({ message: 'hi' }), CALLER, {
    userAgent: 'u'.repeat(5000),
    appVersion: 'v'.repeat(500),
  });
  assert.ok(doc.userAgent.length <= 300);
  assert.ok(doc.appVersion.length <= 40);
});

test('new feedback starts unhandled', () => {
  assert.equal(buildFeedbackDoc(validateFeedback({ message: 'hi' }), CALLER).handled, false);
});
