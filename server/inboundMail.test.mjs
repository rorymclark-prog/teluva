/* Tests for the inbound-mail filing logic (server/inboundMail.mjs).
 *
 * This module is the whole security boundary for a feature that lets a
 * message from the open internet write a file into someone's vault, so the
 * tests that matter most here are the REFUSALS, and every one of them gets a
 * CONTROL proving it can actually fail — a boundary with no failing case
 * next to it is just an assertion nobody checked.
 *
 * Run with:  node server/inboundMail.test.mjs
 */
import {
  familyAddressToken,
  resolveFamilyToken,
  verifyInboundRequest,
  parseInboundAddress,
  senderAllowed,
  senderDisplay,
  pickAttachments,
  describeInbound,
  parseMultipartFormData,
  MAX_ATTACHMENT_BYTES,
} from './inboundMail.mjs';

let failures = 0;
function check(cond, what) {
  if (!cond) failures++;
  console.log(`${cond ? '  ok' : 'FAIL'}  ${what}`);
}
const eq = (a, b, what) => check(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`}`);

const SECRET = 'shh-this-is-the-server-secret';

// ---------------------------------------------------------------------------
console.log('familyAddressToken — the per-family inbound address');
// ---------------------------------------------------------------------------
{
  const t1 = familyAddressToken('fam-alice', SECRET);
  const t2 = familyAddressToken('fam-alice', SECRET);
  eq(t1, t2, 'deterministic — same familyId/secret always gives the same token');
  check(/^[0-9a-f]{16}$/.test(t1), `16 lowercase hex chars, got ${t1}`);
  check(familyAddressToken('fam-bob', SECRET) !== t1, 'a different family gets a different token');
  check(familyAddressToken('fam-alice', 'a-different-secret') !== t1, 'a different secret gets a different token');
}
check((() => { try { familyAddressToken('', SECRET); return false; } catch { return true; } })(), 'throws on an empty familyId');
check((() => { try { familyAddressToken('fam-alice', ''); return false; } catch { return true; } })(), 'throws on an empty secret');

// ---------------------------------------------------------------------------
console.log('\nresolveFamilyToken — the boundary a guessed URL runs into');
// ---------------------------------------------------------------------------
{
  const families = ['fam-alice', 'fam-bob', 'fam-carol'];
  const tokenForAlice = familyAddressToken('fam-alice', SECRET);
  eq(resolveFamilyToken(tokenForAlice, families, SECRET), 'fam-alice', 'resolves the token to its own family');

  // THE CONTROL: a token minted for one family must never resolve to another.
  const tokenForBob = familyAddressToken('fam-bob', SECRET);
  check(resolveFamilyToken(tokenForBob, families, SECRET) !== 'fam-alice', "family B's token does not resolve to family A");
  eq(resolveFamilyToken(tokenForBob, families, SECRET), 'fam-bob', "...it resolves to its OWN family instead");

  eq(resolveFamilyToken('0000000000000000', families, SECRET), null, 'an unrecognised token resolves to nobody');
  eq(resolveFamilyToken(tokenForAlice, families, 'wrong-secret'), null, 'the right token under the wrong secret resolves to nobody');
  eq(resolveFamilyToken(tokenForAlice, [], SECRET), null, 'no candidate families at all resolves to nobody');
  eq(resolveFamilyToken('', families, SECRET), null, 'an empty token resolves to nobody');
  eq(resolveFamilyToken(null, families, SECRET), null, 'a null token resolves to nobody, not a crash');
  // Case tolerance — mail headers get lower/upper-cased by different clients.
  eq(resolveFamilyToken(tokenForAlice.toUpperCase(), families, SECRET), 'fam-alice', 'the token match is case-insensitive');
}

// ---------------------------------------------------------------------------
console.log('\nverifyInboundRequest — the webhook URL secret');
// ---------------------------------------------------------------------------
check(verifyInboundRequest({ secretFromUrl: 'abc123', expectedSecret: 'abc123' }), 'matching secret verifies');
check(!verifyInboundRequest({ secretFromUrl: 'abc124', expectedSecret: 'abc123' }), 'a near-miss secret is refused');
check(!verifyInboundRequest({ secretFromUrl: 'abc123', expectedSecret: 'ABC123' }), 'the compare is case-sensitive');
// THE CONTROL: an unset/blank expected secret must deny, never behave as "no check".
check(!verifyInboundRequest({ secretFromUrl: 'abc123', expectedSecret: '' }), 'an EMPTY configured secret denies, even a matching-looking one');
check(!verifyInboundRequest({ secretFromUrl: '', expectedSecret: '' }), 'two empty strings still deny — not a free pass');
check(!verifyInboundRequest({ secretFromUrl: undefined, expectedSecret: 'abc123' }), 'a missing URL secret is refused');

// ---------------------------------------------------------------------------
console.log('\nparseInboundAddress — the recipient header');
// ---------------------------------------------------------------------------
eq(parseInboundAddress('a1b2c3d4e5f6a7b8@mail.example.com'), { token: 'a1b2c3d4e5f6a7b8', domain: 'mail.example.com' }, 'bare address');
eq(parseInboundAddress('Family Vault <a1b2c3d4e5f6a7b8@mail.example.com>'), { token: 'a1b2c3d4e5f6a7b8', domain: 'mail.example.com' }, 'display name + angle brackets');
eq(parseInboundAddress('A1B2C3D4E5F6A7B8@MAIL.EXAMPLE.COM'), { token: 'a1b2c3d4e5f6a7b8', domain: 'mail.example.com' }, 'case-folded');
eq(parseInboundAddress('a1b2c3d4e5f6a7b8+forwarded@mail.example.com'), { token: 'a1b2c3d4e5f6a7b8', domain: 'mail.example.com' }, 'a +tag some providers append is stripped');
eq(parseInboundAddress('"Family Vault" <a1b2c3d4e5f6a7b8@mail.example.com>, other@else.com'), { token: 'a1b2c3d4e5f6a7b8', domain: 'mail.example.com' }, 'multiple recipients — the bracketed one wins');
eq(parseInboundAddress('not an address'), null, 'no @ at all');
eq(parseInboundAddress('@mail.example.com'), null, 'empty local part');
eq(parseInboundAddress('token@'), null, 'empty domain');
eq(parseInboundAddress(''), null, 'empty input');
eq(parseInboundAddress(null), null, 'null input does not throw');

// ---------------------------------------------------------------------------
console.log('\nsenderAllowed — the boundary that stops a guessed address writing into the wrong vault');
// ---------------------------------------------------------------------------
check(senderAllowed('Erika <erika@example.com>', ['erika@example.com']), 'a listed member, display-name form, is allowed');
check(senderAllowed('ERIKA@EXAMPLE.COM', ['erika@example.com']), 'case-insensitive match');
check(!senderAllowed('stranger@example.com', ['erika@example.com']), 'someone not on the list is refused');
// THE CONTROL: an empty or missing allow-list must DENY, never allow-all.
check(!senderAllowed('erika@example.com', []), 'an EMPTY allow-list denies — even the family\'s own member');
check(!senderAllowed('erika@example.com', undefined), 'a MISSING allow-list denies, not "everyone"');
check(!senderAllowed('erika@example.com', null), 'a null allow-list denies');
check(!senderAllowed('not an address', ['erika@example.com']), 'an unparsable From: header is refused, not skipped');
check(!senderAllowed('erika@example.com', ['', '   ', 42, null]), 'junk allow-list entries never accidentally match');

console.log('\nsenderDisplay — provenance text, never empty');
eq(senderDisplay('Erika <erika@example.com>'), 'erika@example.com', 'prefers the parsed address');
eq(senderDisplay('not really an address'), 'not really an address', 'falls back to the raw header rather than "unknown"');
eq(senderDisplay(''), 'an unknown sender', 'a genuinely empty header still returns something to show');
eq(senderDisplay(undefined), 'an unknown sender', 'undefined does not throw');

// ---------------------------------------------------------------------------
console.log('\npickAttachments — what gets filed and what does not');
// ---------------------------------------------------------------------------
{
  const parts = [
    { filename: 'lease.pdf', contentType: 'application/pdf', disposition: 'attachment', size: 1000 },
    { filename: 'logo.png', contentType: 'image/png', disposition: 'inline', cid: 'sig-logo-1', size: 5000 },
    { filename: 'photo.jpg', contentType: 'image/jpeg', disposition: 'inline', size: 2000 }, // pasted into the body, no cid
    { filename: 'notes.txt', contentType: 'text/plain', disposition: 'attachment', size: 100 },
  ];
  const picked = pickAttachments(parts, { maxBytes: MAX_ATTACHMENT_BYTES, maxCount: 10 });
  eq(picked.map((p) => p.filename), ['lease.pdf', 'photo.jpg'], 'pdf and an inline-but-no-cid photo are kept; the cid signature logo and the .txt are dropped');
}
{
  const parts = Array.from({ length: 5 }, (_, i) => ({ filename: `p${i}.pdf`, contentType: 'application/pdf', size: 10 }));
  eq(pickAttachments(parts, { maxCount: 2 }).length, 2, 'maxCount is enforced');
  eq(pickAttachments(parts, { maxCount: 2 }).map((p) => p.filename), ['p0.pdf', 'p1.pdf'], 'the FIRST N in message order are kept');
}
{
  const parts = [
    { filename: 'a.pdf', contentType: 'application/pdf', size: 40 },
    { filename: 'b.pdf', contentType: 'application/pdf', size: 40 },
    { filename: 'c.pdf', contentType: 'application/pdf', size: 40 },
  ];
  eq(pickAttachments(parts, { maxBytes: 70, maxCount: 10 }).map((p) => p.filename), ['a.pdf'],
    'the byte cap stops filing once the NEXT attachment would exceed it, rather than skipping ahead to a smaller one');
}
eq(pickAttachments([{ filename: 'x.pdf', contentType: 'application/pdf', size: 0 }]), [], 'a zero/unknown-size part is dropped');
eq(pickAttachments(undefined), [], 'a missing parts list is an empty result, not a crash');
eq(pickAttachments([null, undefined, 'garbage']), [], 'junk entries in the parts list are skipped, not thrown on');

// ---------------------------------------------------------------------------
console.log('\ndescribeInbound — the name and notes a filed document gets');
// ---------------------------------------------------------------------------
eq(
  describeInbound({ subject: 'Wasser Rechnung 2026', from: 'erika@example.com', filename: 'scan0004.pdf' }),
  { name: 'Wasser Rechnung 2026', notes: 'Emailed in by erika@example.com' },
  'the subject is preferred as the name',
);
eq(
  describeInbound({ subject: '', from: 'erika@example.com', filename: 'scan0004.pdf' }),
  { name: 'scan0004.pdf', notes: 'Emailed in by erika@example.com' },
  'no subject falls back to the filename',
);
eq(
  describeInbound({ subject: '   ', from: '', filename: '' }).name,
  'Emailed document',
  'neither subject nor filename — the name is NEVER empty',
);
check(describeInbound({}).name.length > 0, 'even called with nothing at all, name is non-empty');

// ---------------------------------------------------------------------------
console.log('\nparseMultipartFormData — the SendGrid Inbound Parse body');
// ---------------------------------------------------------------------------
{
  const boundary = 'xYzZY-boundary-123';
  const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0x00, 0xff, 0x10, 0x0d, 0x0a]); // has CRLF bytes INSIDE the "file"
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="subject"\r\n\r\n'),
    Buffer.from('Wasser Rechnung 2026\r\n'),
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="attachment1"; filename="bill.pdf"\r\nContent-Type: application/pdf\r\n\r\n'),
    binary,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const parts = parseMultipartFormData(body, boundary);
  eq(parts.length, 2, 'two parts found');
  eq(parts[0], { name: 'subject', filename: undefined, contentType: 'text/plain', disposition: 'form-data; name="subject"', data: Buffer.from('Wasser Rechnung 2026') }, 'the text field, verbatim');
  check(parts[1].filename === 'bill.pdf' && parts[1].contentType === 'application/pdf', 'the file field carries filename + content-type');
  check(Buffer.compare(parts[1].data, binary) === 0, 'binary attachment bytes — including embedded CRLF — round-trip exactly');
}
eq(parseMultipartFormData(Buffer.from('nothing here'), 'no-such-boundary'), [], 'a boundary that never appears yields no parts, not a throw');
eq(parseMultipartFormData(Buffer.from('x'), ''), [], 'an empty boundary is refused outright');
eq(parseMultipartFormData(null, 'b'), [], 'a non-Buffer body is refused outright');

console.log(failures === 0 ? '\ninboundMail.test.mjs: all assertions passed' : `\n${failures} inboundMail test(s) FAILED.`);
if (failures > 0) process.exit(1);
