/* ---------------------------------------------------------------------------
 * Inbound email → vault filing. Pure logic only — no Express, no Firebase.
 * server.js wires this into POST /api/inbound-mail; that route (and only that
 * route) is DORMANT until INBOUND_MAIL_SECRET and INBOUND_MAIL_DOMAIN are both
 * set, because the app runs on *.run.app today and a shared Google domain can
 * never carry an MX record. See docs/INBOUND-MAIL.md for what switches it on.
 *
 * THE THREAT MODEL, IN ORDER
 * ---------------------------
 * 1. Someone finds or guesses the webhook URL. verifyInboundRequest is the
 *    gate: the URL carries a shared secret as a query param, compared in
 *    constant time. This is the ONLY thing that may reject a request with a
 *    non-2xx status — everything after it must return 200 no matter what it
 *    decides, because a 4xx/5xx tells the mail provider to retry or bounce
 *    the message back at whoever sent it (see server.js for that logic).
 * 2. Someone who has the URL guesses (or is emailed) a family's inbound
 *    address. familyAddressToken/resolveFamilyToken close this: the local
 *    part is an HMAC of the familyId under a server-only secret, not the
 *    familyId itself and not sequential, so there is nothing to enumerate.
 * 3. Someone who KNOWS a family's real inbound address forges a From: header
 *    to write into that family's vault. senderAllowed is the last gate: the
 *    allow-list is that family's own member emails, resolved server-side —
 *    never anything the message itself claims. An empty allow-list must DENY
 *    outright, not fall open, because "no members loaded yet" and "anyone may
 *    post" must never look the same to this function.
 * 4. A legitimate sender's mail client (or their employer's) tacks on a
 *    footer logo. pickAttachments drops inline, cid-bearing images so a
 *    signature graphic doesn't get filed as a document next to the PDF that
 *    was the actual point of the email.
 * ------------------------------------------------------------------------- */

import crypto from 'node:crypto';

// How much of one HMAC digest becomes the address token. 16 hex chars is 64
// bits — far past what anyone could grind through a rate-limited endpoint —
// while staying short enough to type or read aloud from a UI screen.
export const TOKEN_LENGTH = 16;

// Matches the client's own 20MB single-file vault-upload ceiling (see
// DocumentVault.tsx) — an inbound email should not get a bigger allowance
// than someone uploading by hand.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;

/**
 * The stable, unguessable local-part for one family's inbound address —
 * `<token>@INBOUND_MAIL_DOMAIN`. An HMAC, not a lookup: the same familyId and
 * secret always produce the same token, so a UI screen can show the address
 * and the receiving webhook can re-derive it from a candidate familyId
 * without either of them ever having stored the mapping anywhere.
 */
export function familyAddressToken(familyId, secret) {
  if (typeof familyId !== 'string' || !familyId) {
    throw new Error('familyAddressToken requires a non-empty familyId string');
  }
  if (typeof secret !== 'string' || !secret) {
    throw new Error('familyAddressToken requires a non-empty secret string');
  }
  return crypto.createHmac('sha256', secret).update(familyId).digest('hex').slice(0, TOKEN_LENGTH);
}

/** Constant-time string compare, immune to a length-based timing tell. */
function constantTimeEqual(a, b) {
  const bufA = crypto.createHash('sha256').update(String(a)).digest();
  const bufB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Which family (if any) a received token belongs to, given the candidate
 * familyIds to check against. There is no reverse index — see the header —
 * so this recomputes familyAddressToken for each candidate and compares in
 * constant time. O(number of families); fine at this app's scale, and the
 * seam to revisit first if that ever stops being true.
 *
 * Returns the matching familyId, or null. Deliberately never "the first
 * near-match" — every candidate either matches exactly or is skipped, so a
 * token minted for one family can never resolve to a different one.
 */
export function resolveFamilyToken(token, familyIds, secret) {
  if (typeof token !== 'string' || !token) return null;
  if (!Array.isArray(familyIds) || typeof secret !== 'string' || !secret) return null;
  const want = token.trim().toLowerCase();
  let found = null;
  for (const familyId of familyIds) {
    if (typeof familyId !== 'string' || !familyId) continue;
    const candidate = familyAddressToken(familyId, secret);
    // Keep scanning every candidate rather than returning on first hit, so
    // resolution time does not itself leak which position in the list matched.
    if (constantTimeEqual(candidate, want) && found === null) found = familyId;
  }
  return found;
}

/**
 * Constant-time compare of the webhook URL's secret query param against the
 * configured one. `expectedSecret` empty/missing always denies — a blank
 * secret must never behave like "no check", which is exactly the shape of
 * bug that turns a disabled feature into an open one.
 */
export function verifyInboundRequest({ secretFromUrl, expectedSecret }) {
  const expected = typeof expectedSecret === 'string' ? expectedSecret : '';
  if (!expected) return false;
  const provided = typeof secretFromUrl === 'string' ? secretFromUrl : '';
  return constantTimeEqual(provided, expected);
}

/** Pull `local@domain` out of `"Display Name" <local@domain>` or a bare address. */
function extractEmailAddress(headerValue) {
  const text = String(headerValue ?? '').trim();
  if (!text) return null;
  const angle = text.match(/<([^<>]+)>/);
  const candidate = (angle ? angle[1] : text.split(',')[0]).trim();
  const at = candidate.lastIndexOf('@');
  if (at <= 0 || at === candidate.length - 1) return null;
  const local = candidate.slice(0, at).trim();
  const domain = candidate.slice(at + 1).trim().replace(/[.,;]+$/, '');
  if (!local || !domain || /\s/.test(local) || /\s/.test(domain)) return null;
  return `${local}@${domain}`.toLowerCase();
}

/**
 * A human-readable "who this came from" string for provenance fields —
 * `uploadedBy` and describeInbound's `notes`. Falls back to the raw header
 * text (trimmed) rather than "unknown sender": an unparsed From: header is
 * still evidence worth keeping next to the filed document.
 */
export function senderDisplay(fromHeader) {
  return extractEmailAddress(fromHeader) || String(fromHeader ?? '').trim() || 'an unknown sender';
}

/**
 * The recipient token and domain out of a `To:`-shaped header — tolerates
 * `<...>` wrapping, a display name in front, and a `+tag` on the local part
 * (some providers echo the exact address a form was submitted to, `+tag` and
 * all). Returns null rather than guessing when nothing resembling an address
 * is present.
 */
export function parseInboundAddress(recipient) {
  const text = String(recipient ?? '').trim();
  if (!text) return null;
  const angle = text.match(/<([^<>]+)>/);
  const candidate = (angle ? angle[1] : text.split(',')[0]).trim();
  const at = candidate.lastIndexOf('@');
  if (at <= 0 || at === candidate.length - 1) return null;
  let local = candidate.slice(0, at).trim();
  const domain = candidate.slice(at + 1).trim().toLowerCase().replace(/[.,;]+$/, '');
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);
  local = local.trim().toLowerCase();
  if (!local || !domain) return null;
  if (!/^[a-z0-9._-]+$/.test(local)) return null; // not a shape familyAddressToken ever produces
  return { token: local, domain };
}

/**
 * Does `fromHeader` belong to a member of the family the mail claims to be
 * for? `allowedEmails` must be THAT family's own member emails, resolved
 * server-side — never anything from the message. An empty or missing list
 * denies everything: this is the boundary that stops a guessed address from
 * writing into a vault whose member list happened not to load, so "deny" is
 * the only safe reading of "we don't know who may post here".
 */
export function senderAllowed(fromHeader, allowedEmails) {
  if (!Array.isArray(allowedEmails) || allowedEmails.length === 0) return false;
  const from = extractEmailAddress(fromHeader);
  if (!from) return false;
  const allowSet = new Set(
    allowedEmails.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim().toLowerCase()),
  );
  return allowSet.has(from);
}

function typeMatches(contentType, pattern) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
  return type === pattern;
}

/**
 * Which of a message's attachment parts get filed, and which get dropped —
 * the boundary between "a scan someone emailed in" and everything else a
 * mail client attaches without being asked (an inline footer logo, an
 * oversized video, a fortieth photo past the point a vault entry is useful).
 *
 * `parts` is already-parsed attachment metadata: `{ filename, contentType,
 * disposition, cid, size }` per part (`disposition`/`cid` are how an inline
 * signature image is told apart from a real attachment). Order is preserved
 * and used as priority — the first N that fit are kept; once the running
 * total would exceed `maxBytes`, filing stops rather than skipping ahead to
 * find something smaller, so what gets filed matches the order the sender
 * attached things in.
 */
export function pickAttachments(parts, { maxBytes = MAX_ATTACHMENT_BYTES, maxCount = MAX_ATTACHMENT_COUNT, allowedTypes = ['image/*', 'application/pdf'] } = {}) {
  const out = [];
  let totalBytes = 0;
  for (const part of Array.isArray(parts) ? parts : []) {
    if (out.length >= maxCount) break;
    if (!part || typeof part !== 'object') continue;

    // A corporate footer logo is inline AND carries a content-id (the <img
    // src="cid:...">  the HTML body references) — a real attachment the
    // sender meant to send is neither, or is inline without a cid (a photo
    // pasted into the body of the email, which people do mean to file).
    const disposition = String(part.disposition || '').toLowerCase();
    if (disposition.includes('inline') && part.cid) continue;

    if (!allowedTypes.some((pattern) => typeMatches(part.contentType, pattern))) continue;

    const size = Number.isFinite(part.size) ? part.size : 0;
    if (size <= 0) continue;
    if (totalBytes + size > maxBytes) break;

    totalBytes += size;
    out.push(part);
  }
  return out;
}

/**
 * The document `name` and `notes` one filed attachment gets, from what the
 * email carried. The subject line is almost always the better label a human
 * chose ("Wasser Rechnung 2026", "Emma's vaccination record") — the filename
 * is usually a scanner's or a phone's default and is only used when there is
 * no subject at all. Either way `name` is never empty: a document with no
 * name is not filed, it's lost.
 */
export function describeInbound({ subject, from, filename } = {}) {
  const cleanSubject = String(subject ?? '').trim();
  const cleanFilename = String(filename ?? '').trim();
  const name = cleanSubject || cleanFilename || 'Emailed document';
  const notes = `Emailed in by ${senderDisplay(from)}`;
  return { name, notes };
}

// ---------------------------------------------------------------------------
// A minimal multipart/form-data reader for the SendGrid Inbound Parse POST
// body. Kept here (pure, no Express) rather than pulling in a parsing library
// for one route — the format this webhook actually sends is plain RFC 2388
// with no exotic features (no nested multipart, no chunked part transfer).
// ---------------------------------------------------------------------------

/**
 * Split a `multipart/form-data` body into its parts. `body` is the RAW
 * request bytes (a Buffer) and `boundary` is the value from the request's
 * Content-Type header, WITHOUT the leading `--`. Returns `[]` — never
 * throws — for a boundary that is not found, so a malformed or truncated
 * post is just "no parts" to every caller rather than a crash.
 *
 * Each returned part is `{ name, filename, contentType, disposition, data }`
 * — `data` is a Buffer holding that part's raw bytes, `filename`/`disposition`
 * are undefined for an ordinary form field.
 */
export function parseMultipartFormData(body, boundary) {
  if (!Buffer.isBuffer(body) || typeof boundary !== 'string' || !boundary) return [];
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];

  let cursor = body.indexOf(delimiter);
  if (cursor === -1) return [];
  cursor += delimiter.length;

  while (true) {
    // The terminating boundary is followed by `--`; anything else is followed
    // by CRLF and another part.
    if (body.slice(cursor, cursor + 2).toString('latin1') === '--') break;
    if (body.slice(cursor, cursor + 2).toString('latin1') === '\r\n') cursor += 2;

    const next = body.indexOf(delimiter, cursor);
    if (next === -1) break; // truncated body — stop at the last complete part
    // Strip the CRLF that always precedes the next boundary marker.
    let partEnd = next;
    if (body.slice(partEnd - 2, partEnd).toString('latin1') === '\r\n') partEnd -= 2;

    const raw = body.slice(cursor, partEnd);
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = raw.slice(0, headerEnd).toString('utf8');
      const data = raw.slice(headerEnd + 4);
      const headers = {};
      for (const line of headerText.split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
      const disposition = headers['content-disposition'] || '';
      const nameMatch = /name="([^"]*)"/.exec(disposition);
      const filenameMatch = /filename="([^"]*)"/.exec(disposition);
      parts.push({
        name: nameMatch ? nameMatch[1] : '',
        filename: filenameMatch ? filenameMatch[1] : undefined,
        contentType: headers['content-type'] || 'text/plain',
        disposition,
        data,
      });
    }

    cursor = next + delimiter.length;
  }

  return parts;
}
