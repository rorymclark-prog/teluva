/* Tests for the Gmail bridge logic (server/gmailBridge.mjs).
 *
 * A bridge token is a write capability into one family's document vault, so
 * — same rule as inboundMail.test.mjs — the tests that matter most here are
 * the REFUSALS, and every one of them gets a CONTROL proving it can actually
 * fail. A guard nobody has watched fail is just an assertion nobody checked.
 *
 * Run with:  node server/gmailBridge.test.mjs
 */
import {
  BRIDGE_TOKEN_BYTES,
  MAX_FILED_KEYS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  mintBridgeToken,
  hashBridgeToken,
  verifyBridgeToken,
  parseBearerToken,
  deliveryKey,
  appendFiledKeys,
  pickGmailAttachments,
  describeGmailSource,
} from './gmailBridge.mjs';

let failures = 0;
let assertions = 0;
function check(cond, what) {
  assertions++;
  if (!cond) failures++;
  console.log(`${cond ? '  ok' : 'FAIL'}  ${what}`);
}
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`}`);

// ---------------------------------------------------------------------------
console.log('mintBridgeToken — the raw token, shown once, never stored');
// ---------------------------------------------------------------------------
{
  const t1 = mintBridgeToken();
  const t2 = mintBridgeToken();
  check(typeof t1 === 'string' && t1.length > 0, 'mints a non-empty string');
  check(t1 !== t2, 'two mints are different tokens');
  check(!/[+/=]/.test(t1), 'no base64 characters that need URL/header escaping (+, /, =)');
  check(!/\s/.test(t1), 'no whitespace — safe to paste into a Script Property or a header value');
  check(!/["']/.test(t1), 'no quote characters');
  // base64url of BRIDGE_TOKEN_BYTES bytes, no padding: ceil(bytes*4/3) chars.
  const expectedLength = Math.ceil((BRIDGE_TOKEN_BYTES * 4) / 3);
  eq(t1.length, expectedLength, `length matches ${BRIDGE_TOKEN_BYTES} raw bytes base64url-encoded`);
}

// ---------------------------------------------------------------------------
console.log('\nhashBridgeToken — what actually gets persisted');
// ---------------------------------------------------------------------------
{
  const token = mintBridgeToken();
  const h1 = hashBridgeToken(token);
  const h2 = hashBridgeToken(token);
  check(/^[0-9a-f]{64}$/.test(h1), 'lowercase 64-char hex (SHA-256)');
  eq(h1, h2, 'deterministic — the same token always hashes the same');
  check(hashBridgeToken(mintBridgeToken()) !== h1, 'a different token hashes differently');
  eq(hashBridgeToken(''), null, 'empty string hashes to null, not a hash of ""');
  eq(hashBridgeToken(null), null, 'null input does not throw');
  eq(hashBridgeToken(undefined), null, 'undefined input does not throw');
  eq(hashBridgeToken(12345), null, 'a non-string input does not throw');
}

// ---------------------------------------------------------------------------
console.log('\nverifyBridgeToken — the timing-safe compare at the door');
// ---------------------------------------------------------------------------
{
  const token = mintBridgeToken();
  const hash = hashBridgeToken(token);
  check(verifyBridgeToken(token, hash), 'the right token against its own hash verifies');
  check(!verifyBridgeToken(token, hashBridgeToken(mintBridgeToken())), 'the right token against a DIFFERENT token\'s hash is refused');

  // THE CONTROL: both blank must not accidentally look like "no check".
  check(!verifyBridgeToken('', ''), 'CONTROL: an empty presented token against an empty stored hash does NOT verify');
  check(!verifyBridgeToken('', hash), 'an empty presented token against a real hash is refused');
  check(!verifyBridgeToken(token, ''), 'a real token against an empty stored hash is refused (family never minted one)');
  check(!verifyBridgeToken(null, hash), 'a null presented token is refused, not a crash');
  check(!verifyBridgeToken(token, null), 'a null stored hash is refused, not a crash');
  check(!verifyBridgeToken(undefined, undefined), 'both undefined is refused, not a crash');

  // THE CONTROL: a one-character difference must not verify.
  const almost = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
  check(!verifyBridgeToken(almost, hash), 'CONTROL: a token differing by ONE character does not verify');

  // A malformed stored hash (not 64 hex chars) must deny outright, not be
  // handed to timingSafeEqual (which throws on mismatched lengths).
  check(!verifyBridgeToken(token, 'not-a-real-hash'), 'a malformed stored hash denies rather than throwing');
  check(!verifyBridgeToken(token, hash.toUpperCase()), 'an uppercase-hex stored hash denies (hashBridgeToken only ever produces lowercase)');
  check(!verifyBridgeToken(token, hash.slice(0, 63)), 'a truncated stored hash denies');
}

// ---------------------------------------------------------------------------
console.log('\nparseBearerToken — the Authorization header');
// ---------------------------------------------------------------------------
eq(parseBearerToken('Bearer abc123'), 'abc123', 'plain bearer header');
eq(parseBearerToken('bearer abc123'), 'abc123', 'scheme is case-insensitive');
eq(parseBearerToken('  Bearer   abc123  '), 'abc123', 'tolerates stray surrounding/inner whitespace');
eq(parseBearerToken('Basic abc123'), null, 'the wrong scheme is refused');
eq(parseBearerToken('abc123'), null, 'no scheme at all is refused');
eq(parseBearerToken(''), null, 'empty header is refused');
eq(parseBearerToken(undefined), null, 'missing header does not throw');
eq(parseBearerToken(null), null, 'null header does not throw');
// THE CONTROL: "Bearer " with nothing after it must be null, not ''.
eq(parseBearerToken('Bearer '), null, 'CONTROL: "Bearer " with nothing after it is null, not the empty-string token');
eq(parseBearerToken('Bearer    '), null, 'CONTROL: "Bearer" followed by only whitespace is also null');

// ---------------------------------------------------------------------------
console.log('\ndeliveryKey — the hashed id used to detect a re-delivery');
// ---------------------------------------------------------------------------
{
  const k1 = deliveryKey({ gmailMessageId: 'msg-1', filename: 'lease.pdf' });
  const k2 = deliveryKey({ gmailMessageId: 'msg-1', filename: 'lease.pdf' });
  eq(k1, k2, 'deterministic — same inputs always give the same key');
  check(deliveryKey({ gmailMessageId: 'msg-2', filename: 'lease.pdf' }) !== k1, 'a different message id changes the key');
  check(deliveryKey({ gmailMessageId: 'msg-1', filename: 'other.pdf' }) !== k1, 'a different filename changes the key');
  check(!/lease|msg-1/i.test(k1), 'the key does not leak the filename or message id in the clear (it is hashed)');
  check(typeof deliveryKey({}) === 'string' && deliveryKey({}).length > 0, 'missing fields do not throw — still produces a key');
  check(typeof deliveryKey(undefined) === 'string', 'no argument at all does not throw');
}

// ---------------------------------------------------------------------------
console.log('\nappendFiledKeys — the capped, de-duplicated, most-recent-last list');
// ---------------------------------------------------------------------------
{
  const existing = ['a', 'b', 'c'];
  const result = appendFiledKeys(existing, ['d', 'e']);
  eq(result, ['a', 'b', 'c', 'd', 'e'], 'new keys append after the existing ones');
  eq(existing, ['a', 'b', 'c'], 'the existing array passed in is not mutated');
}
{
  eq(appendFiledKeys(['a', 'b'], ['b', 'c']), ['a', 'b', 'c'], 'a re-delivered key already in the list is de-duplicated, not repeated');
  eq(appendFiledKeys(['a', 'b'], ['a']), ['b', 'a'], 'a re-appearing key moves to the most-recent end rather than staying put');
}
{
  // CONTROL: truncation drops from the FRONT (oldest), keeping the newest.
  const existing = Array.from({ length: 5 }, (_, i) => `k${i}`); // k0..k4
  const result = appendFiledKeys(existing, ['k5', 'k6'], 5);
  eq(result, ['k2', 'k3', 'k4', 'k5', 'k6'], 'CONTROL: truncating at the cap drops the OLDEST keys (k0, k1), keeping the newest 5');

  // Real consequence of the cap, stated as a control: a re-delivery of a key
  // still within the cap is caught; one that has aged out past the front is
  // NOT — this is appendFiledKeys's documented limitation, not a bug.
  const withinCap = appendFiledKeys(result, ['k4'], 5); // k4 is still in `result`
  eq(withinCap, ['k2', 'k3', 'k5', 'k6', 'k4'], 'a re-delivery of a key still in the capped list is detected (moves to the end, not duplicated)');
  const agedOut = appendFiledKeys(result, ['k0'], 5); // k0 fell off the front long ago
  check(agedOut.filter((k) => k === 'k0').length === 1 && agedOut[agedOut.length - 1] === 'k0',
    'a re-delivery of a key that already aged OUT of the capped list is filed again as "new" — the documented limitation of a capped list, not de-dupe forever');
}
eq(appendFiledKeys(undefined, ['a']), ['a'], 'a missing existing list starts fresh rather than throwing');
eq(appendFiledKeys(['a'], undefined), ['a'], 'a missing new-keys list is a no-op');
eq(appendFiledKeys(['a', '', null, 42], ['b']), ['a', 'b'], 'junk entries in the existing list are dropped');

// ---------------------------------------------------------------------------
console.log('\npickGmailAttachments — what gets filed and what does not');
// ---------------------------------------------------------------------------
{
  const pdfB64 = Buffer.from('%PDF-1.4 fake pdf bytes').toString('base64');
  const imgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
  const attachments = [
    { filename: 'lease.pdf', mimeType: 'application/pdf', dataBase64: pdfB64 },
    { filename: 'photo.jpg', mimeType: 'image/jpeg', dataBase64: imgB64 },
    // CONTROL: a naive `startsWith('image')` check (no slash) would let this
    // through — it must NOT be treated as an image mime type.
    { filename: 'trick.bin', mimeType: 'image-not-really/x', dataBase64: imgB64 },
    // CONTROL: a Gmail signature footer rendered as an HTML part.
    { filename: 'sig.html', mimeType: 'text/html', dataBase64: Buffer.from('<b>hi</b>').toString('base64') },
  ];
  const picked = pickGmailAttachments(attachments);
  eq(picked.map((p) => p.filename), ['lease.pdf', 'photo.jpg'], 'only the real pdf and image are kept; the mime-type impostor and the html footer are dropped');
  check(Buffer.isBuffer(picked[0].data) && picked[0].bytes === picked[0].data.length, 'data is a decoded Buffer with a matching byte count');
}
{
  const dataB64 = Buffer.from('x'.repeat(100)).toString('base64');
  const over = { filename: 'big.pdf', mimeType: 'application/pdf', dataBase64: dataB64 };
  eq(pickGmailAttachments([over], { maxBytes: 50 }), [], 'an attachment over the byte cap is dropped, not truncated');
}
{
  const dataB64 = Buffer.from('ok').toString('base64');
  const many = Array.from({ length: 15 }, (_, i) => ({ filename: `f${i}.pdf`, mimeType: 'application/pdf', dataBase64: dataB64 }));
  eq(pickGmailAttachments(many, { maxCount: 3 }).length, 3, 'maxCount is enforced');
}
{
  // CONTROL: malformed base64 is skipped, not thrown.
  const attachments = [
    { filename: 'bad.pdf', mimeType: 'application/pdf', dataBase64: '!!!not-base64-at-all!!! ' },
    { filename: 'good.pdf', mimeType: 'application/pdf', dataBase64: Buffer.from('fine').toString('base64') },
  ];
  const picked = pickGmailAttachments(attachments);
  eq(picked.map((p) => p.filename), ['good.pdf'], 'CONTROL: a malformed base64 payload is skipped, the rest of the delivery still files');
}
eq(pickGmailAttachments([{ filename: 'empty.pdf', mimeType: 'application/pdf', dataBase64: '' }]), [], 'an empty base64 payload is dropped');
eq(pickGmailAttachments(undefined), [], 'a missing attachments list is an empty result, not a crash');
eq(pickGmailAttachments([null, undefined, 'garbage', 42]), [], 'junk entries in the attachments list are skipped, not thrown on');
eq(
  pickGmailAttachments([{ filename: '   ', mimeType: 'application/pdf', dataBase64: Buffer.from('x').toString('base64') }])[0].filename,
  'Emailed attachment',
  'a blank/missing filename falls back to a non-empty placeholder rather than an empty document name',
);

// Sanity check the module's caps line up with the ones documented in the spec.
check(MAX_ATTACHMENT_BYTES === 20 * 1024 * 1024, 'MAX_ATTACHMENT_BYTES matches the 20MB vault-upload ceiling');
check(MAX_ATTACHMENT_COUNT === 10, 'MAX_ATTACHMENT_COUNT is 10');
check(MAX_FILED_KEYS === 500, 'MAX_FILED_KEYS is 500');
check(BRIDGE_TOKEN_BYTES === 32, 'BRIDGE_TOKEN_BYTES is 32');

// ---------------------------------------------------------------------------
console.log('\ndescribeGmailSource — the uploadedBy provenance string');
// ---------------------------------------------------------------------------
eq(describeGmailSource({ subject: 'Wasser Rechnung', from: 'Erika <erika@example.com>' }), 'From Gmail — erika@example.com', 'prefers the parsed address, same phrasing as the SMTP path');
eq(describeGmailSource({ subject: '', from: '' }), 'From Gmail — an unknown sender', 'a genuinely empty From header still returns something honest');
eq(describeGmailSource({}), 'From Gmail — an unknown sender', 'called with nothing at all still returns a non-empty string');
check(typeof describeGmailSource(undefined) === 'string' && describeGmailSource(undefined).length > 0, 'no argument at all does not throw, and is never empty');

if (failures > 0) {
  console.log(`\n${failures} of ${assertions} gmailBridge assertion(s) FAILED.`);
  process.exit(1);
}
console.log(`gmailBridge.test.mjs: ${assertions} assertions passed.`);
