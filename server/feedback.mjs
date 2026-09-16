// Shaping and validation for in-app feedback. Pure — no Firestore, no express —
// so the rules that matter can be tested without a server (see feedback.test.mjs).
//
// WHY THIS IS A SERVER ROUTE AND NOT A CLIENT WRITE
// -------------------------------------------------
// Feedback has to reach RORY, and every other collection in this app is scoped
// to one family: firestore.rules opens with `match /{document=**} { allow read,
// write: if false }` and only ever grants access inside `families/{familyId}`
// to that family's own members. There is deliberately no place a client can
// write that the app's author can read. Rather than punch a hole in that — a
// top-level collection any signed-in account could write to is an open spam
// funnel that rules cannot rate-limit — the Admin SDK writes it server-side,
// where the identity is a VERIFIED token and the rate limit is real code.
//
// So `feedback/` stays unreachable from every browser. That is the point.

/** Longer than anyone types in a feedback box; short enough not to be a payload. */
export const MAX_FEEDBACK_CHARS = 4000;

/** Per person, per hour. Generous for a human, useless for a loop. */
export const FEEDBACK_PER_HOUR = 5;

/** Screens we render a feedback entry point from. 'unknown' is always allowed. */
const SCREEN_MAX = 60;

/**
 * Validate what the browser sent.
 *
 * Rejects rather than repairs, with ONE exception: a missing or malformed
 * screen degrades to 'unknown'. Losing someone's message because the metadata
 * was odd would be the worst possible trade — the message is the thing.
 *
 * @returns {{ok: true, message: string, screen: string} | {ok: false, error: string}}
 */
export function validateFeedback(body) {
  const raw = body && typeof body.message === 'string' ? body.message : '';
  const message = raw.trim();

  if (!message) return { ok: false, error: 'Please write something first.' };

  // Reject over-length rather than truncate. Silently cutting the end off is
  // how you lose the sentence that actually said what was wrong.
  if (message.length > MAX_FEEDBACK_CHARS) {
    return { ok: false, error: `That's longer than ${MAX_FEEDBACK_CHARS} characters — please shorten it a little.` };
  }

  const rawScreen = body && typeof body.screen === 'string' ? body.screen.trim() : '';
  const screen = rawScreen && rawScreen.length <= SCREEN_MAX ? rawScreen : 'unknown';

  return { ok: true, message, screen };
}

/**
 * Build the stored document.
 *
 * IDENTITY COMES FROM THE VERIFIED TOKEN, NEVER FROM THE BODY. The browser
 * supplies the message and the screen; who sent it is decided here from what
 * requireMember() already proved. A uid or email read off the request body
 * would let any signed-in account file feedback under someone else's name,
 * and feedback is read later as evidence about a real person's experience.
 */
export function buildFeedbackDoc({ message, screen }, caller, meta = {}) {
  return {
    message,
    screen,
    uid: caller.uid,
    email: caller.email || null,
    familyId: caller.familyId || null,
    role: caller.role || null,
    appVersion: typeof meta.appVersion === 'string' ? meta.appVersion.slice(0, 40) : null,
    userAgent: typeof meta.userAgent === 'string' ? meta.userAgent.slice(0, 300) : null,
    createdAt: meta.now || null,
    handled: false,
  };
}
