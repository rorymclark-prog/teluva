// Validation for user-supplied calendar feed URLs.
//
// WHY THIS IS THE MOST DANGEROUS CODE IN THE APP
// A calendar subscription means the user hands us a URL and the SERVER fetches
// it. That is a server-side request forgery primitive handed over on a plate:
// whatever the user types, our Cloud Run instance will go and ask for, from
// inside Google's network, with our identity.
//
// The specific thing that must never be reachable is the GCP metadata server at
// 169.254.169.254, which will hand out an access token for this service's
// account — the account with read/write on the whole family vault. A user (or
// anyone who can get a URL in front of one) typing that address must be stopped
// here, not by hoping the endpoint requires a header.
//
// The rules, in order:
//   1. http/https only. No file:, no gopher:, no data:.
//   2. No embedded credentials (http://user:pass@host) — those get logged.
//   3. Default ports only. Feeds live on 80/443; anything else is a scan.
//   4. The hostname must resolve ONLY to public addresses. Every private,
//      loopback, link-local, CGNAT and unique-local range is refused, on both
//      IPv4 and IPv6, including the IPv4-mapped-into-IPv6 forms that are the
//      usual way people get past a naive check (::ffff:169.254.169.254).
//   5. Redirects are re-validated, every hop. A public URL that 302s to
//      169.254.169.254 defeats a check that only looks at what was typed.
//
// webcal:// is accepted as a convenience and rewritten to https:// — Apple
// hands out webcal: links and a user should not have to know they are the same
// thing.

import dns from 'node:dns/promises';
import net from 'node:net';

export class FeedUrlError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** How much of a feed we will read. A calendar is text; anything huge is not. */
export const MAX_FEED_BYTES = 5 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 3;

/**
 * Parse and shape-check a URL, without touching the network.
 * Returns the normalised URL string, or throws FeedUrlError.
 */
export function normalizeFeedUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new FeedUrlError('Paste the calendar link first.', 'empty');
  if (text.length > 2000) throw new FeedUrlError('That link is too long to be a calendar address.', 'too-long');

  let url;
  try {
    // Apple and many others hand out webcal:// — the same thing over https.
    url = new URL(text.replace(/^webcal:\/\//i, 'https://'));
  } catch {
    throw new FeedUrlError('That doesn’t look like a web address.', 'unparseable');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FeedUrlError('A calendar link has to start with https://', 'scheme');
  }
  if (url.username || url.password) {
    // A URL carrying a password would end up in our logs and in Firestore.
    throw new FeedUrlError('Use a calendar link without a username or password in it.', 'credentials');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new FeedUrlError('That link points at an unusual port — use the standard calendar address.', 'port');
  }
  if (!url.hostname || url.hostname.endsWith('.')) {
    url.hostname = (url.hostname || '').replace(/\.$/, '');
  }
  if (!url.hostname) throw new FeedUrlError('That doesn’t look like a web address.', 'no-host');

  return url.toString();
}

/**
 * Is this a literal IP address we must never connect to?
 * Covers loopback, private, link-local (the metadata server lives at
 * 169.254.169.254), CGNAT, broadcast, multicast and reserved space.
 */
export function isBlockedAddress(address) {
  const type = net.isIP(address);
  if (type === 4) return isBlockedIPv4(address);
  if (type === 6) return isBlockedIPv6(address);
  return true; // not an IP at all — caller shouldn't have got here
}

function isBlockedIPv4(address) {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                        // "this network"
  if (a === 10) return true;                       // private
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local — GCP metadata
  if (a === 172 && b >= 16 && b <= 31) return true;// private
  if (a === 192 && b === 168) return true;         // private
  if (a === 192 && b === 0) return true;           // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true;    // carrier-grade NAT
  if (a >= 224) return true;                       // multicast + reserved + broadcast
  return false;
}

function isBlockedIPv6(address) {
  const lower = address.toLowerCase();
  // IPv4-mapped and IPv4-compatible forms: ::ffff:169.254.169.254 reaches the
  // metadata server just as well as the bare v4 address does.
  const mapped = /^::(?:ffff:(?:0{1,4}:)?)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedIPv4(mapped[1]);

  if (lower === '::' || lower === '::1') return true;   // unspecified, loopback
  if (lower.startsWith('fe80')) return true;            // link-local
  if (/^f[cd]/.test(lower)) return true;                // unique local
  if (lower.startsWith('ff')) return true;              // multicast
  if (lower.startsWith('2002:')) return true;           // 6to4, can wrap a v4 target
  if (lower.startsWith('64:ff9b')) return true;         // NAT64
  return false;
}

/**
 * Resolve a hostname and refuse it if ANY address it answers with is one we
 * must not reach. All of them, not just the first: a host that returns both a
 * public and a private address would otherwise be a coin toss.
 *
 * `lookup` is injectable so the tests can exercise this without DNS.
 */
export async function assertHostIsPublic(hostname, lookup = defaultLookup) {
  // A bare IP needs no DNS, and must be checked directly.
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new FeedUrlError('That address isn’t reachable as a calendar feed.', 'blocked-address');
    }
    return [hostname];
  }

  let addresses;
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new FeedUrlError('Couldn’t find that address — check the link and try again.', 'dns');
  }
  if (!addresses?.length) {
    throw new FeedUrlError('Couldn’t find that address — check the link and try again.', 'dns');
  }
  for (const a of addresses) {
    if (isBlockedAddress(a)) {
      throw new FeedUrlError('That address isn’t reachable as a calendar feed.', 'blocked-address');
    }
  }
  return addresses;
}

async function defaultLookup(hostname) {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

/**
 * Fetch a calendar feed safely: validate, resolve, fetch, and re-validate on
 * every redirect. Returns the body as text.
 *
 * `deps` is injectable for tests — nothing here should need a live network to
 * be verified.
 */
export async function fetchFeed(rawUrl, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const lookup = deps.lookup || defaultLookup;
  const maxBytes = deps.maxBytes ?? MAX_FEED_BYTES;

  let current = normalizeFeedUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = new URL(current);
    await assertHostIsPublic(url.hostname, lookup);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FEED_TIMEOUT_MS);
    let res;
    try {
      res = await doFetch(current, {
        redirect: 'manual', // we follow them ourselves so each hop is checked
        signal: controller.signal,
        headers: {
          // Nominatim and most feed hosts want to know who is calling.
          'User-Agent': 'Teluva/1.0 (family calendar subscription)',
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
        },
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new FeedUrlError('That calendar took too long to answer.', 'timeout');
      }
      throw new FeedUrlError('Couldn’t reach that calendar link.', 'network');
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new FeedUrlError('That calendar link redirected nowhere.', 'bad-redirect');
      // Resolve relative redirects against the current URL, then start over —
      // including the public-address check. This is the hop that a naive
      // implementation skips, and it is the one that reaches the metadata server.
      current = normalizeFeedUrl(new URL(location, current).toString());
      continue;
    }

    if (!res.ok) {
      throw new FeedUrlError(
        res.status === 401 || res.status === 403
          ? 'That calendar link needs a password, or isn’t shared. Use the secret/private link your calendar gives you.'
          : `That calendar link returned an error (${res.status}).`,
        'http',
      );
    }

    const text = await readCapped(res, maxBytes);
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new FeedUrlError(
        'That link works, but it isn’t a calendar feed. Look for “iCal”, “ICS” or “secret address” where you copied it.',
        'not-a-calendar',
      );
    }
    return text;
  }

  throw new FeedUrlError('That calendar link redirects too many times.', 'too-many-redirects');
}

/**
 * Read a response body but stop at a byte cap, so a hostile or broken endpoint
 * streaming gigabytes can't take the instance down.
 */
async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) {
    throw new FeedUrlError('That calendar is too large to sync.', 'too-large');
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (text.length > maxBytes) throw new FeedUrlError('That calendar is too large to sync.', 'too-large');
    return text;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* already gone */ }
      throw new FeedUrlError('That calendar is too large to sync.', 'too-large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}
