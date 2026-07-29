// Tests for calendar-feed URL validation.
//
// The important assertions here are the REFUSALS. This code decides what our
// own server will go and fetch on a stranger's instruction, from inside Google's
// network, holding a service account that can read the entire family vault. The
// single address that must never be reachable is 169.254.169.254 — ask it
// nicely and it hands out an access token for that account.
//
// Everything is injectable, so none of this touches DNS or the network.
//
// Run with:  node --test server/feedUrl.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFeedUrl, isBlockedAddress, assertHostIsPublic, fetchFeed, FeedUrlError,
} from './feedUrl.mjs';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20260815T150000Z\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR';

const resp = (body = ICS, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

const publicLookup = async () => ['93.184.216.34'];

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test('accepts an ordinary https calendar link', () => {
  assert.equal(
    normalizeFeedUrl('https://calendar.google.com/calendar/ical/abc/private-xyz/basic.ics'),
    'https://calendar.google.com/calendar/ical/abc/private-xyz/basic.ics',
  );
});

test('rewrites webcal:// to https://', () => {
  // Apple hands out webcal: links; a user should not have to know it's the same.
  assert.match(normalizeFeedUrl('webcal://p12-caldav.icloud.com/published/2/abc'), /^https:\/\/p12-caldav\.icloud\.com/);
  assert.match(normalizeFeedUrl('WEBCAL://example.com/x.ics'), /^https:\/\//);
});

test('refuses schemes that are not the web', () => {
  for (const bad of ['file:///etc/passwd', 'gopher://x/', 'data:text/calendar,BEGIN', 'ftp://x/y.ics']) {
    assert.throws(() => normalizeFeedUrl(bad), FeedUrlError, bad);
  }
});

test('refuses a URL carrying credentials', () => {
  // These end up in logs and in Firestore.
  assert.throws(() => normalizeFeedUrl('https://user:hunter2@example.com/a.ics'), /username or password/);
});

test('refuses non-standard ports', () => {
  assert.throws(() => normalizeFeedUrl('https://example.com:8080/a.ics'), /unusual port/);
  assert.throws(() => normalizeFeedUrl('http://example.com:22/a.ics'), /unusual port/);
  assert.doesNotThrow(() => normalizeFeedUrl('https://example.com:443/a.ics'));
});

test('refuses empty and unparseable input', () => {
  assert.throws(() => normalizeFeedUrl(''), /Paste the calendar link/);
  assert.throws(() => normalizeFeedUrl('   '), /Paste the calendar link/);
  assert.throws(() => normalizeFeedUrl('not a url'), FeedUrlError);
  assert.throws(() => normalizeFeedUrl('https://' + 'a'.repeat(3000)), /too long/);
  for (const junk of [null, undefined, 42, {}, []]) {
    assert.throws(() => normalizeFeedUrl(junk), FeedUrlError, String(junk));
  }
});

// ---------------------------------------------------------------------------
// Addresses. The list that matters.
// ---------------------------------------------------------------------------

test('blocks the cloud metadata server', () => {
  // The whole reason this file exists.
  assert.equal(isBlockedAddress('169.254.169.254'), true);
  assert.equal(isBlockedAddress('169.254.0.1'), true);
});

test('blocks loopback, private and reserved IPv4', () => {
  for (const ip of [
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.1.1',
    '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '192.0.0.1',
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} must be blocked`);
  }
});

test('allows ordinary public IPv4', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '192.167.0.1']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test('blocks IPv6 loopback, link-local and unique-local', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd00::abcd', 'ff02::1', '2002:c0a8:0101::1', '64:ff9b::1']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} must be blocked`);
  }
});

test('blocks IPv4-mapped IPv6 forms of the metadata server', () => {
  // The classic bypass: a v4 blocklist that never looks inside ::ffff:.
  for (const ip of ['::ffff:169.254.169.254', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::169.254.169.254']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} must be blocked`);
  }
});

test('allows public IPv6', () => {
  assert.equal(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
  assert.equal(isBlockedAddress('::ffff:93.184.216.34'), false, 'a mapped PUBLIC v4 is still fine');
});

test('anything that is not an IP is blocked by isBlockedAddress', () => {
  assert.equal(isBlockedAddress('example.com'), true);
  assert.equal(isBlockedAddress(''), true);
});

// ---------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------

test('a hostname resolving to a private address is refused', async () => {
  // The standard trick: a public name with a private A record.
  await assert.rejects(
    assertHostIsPublic('evil.example.com', async () => ['169.254.169.254']),
    /isn’t reachable/,
  );
});

test('EVERY resolved address must be public, not just the first', async () => {
  // A host answering with one public and one private address would otherwise
  // be a coin toss decided by resolver ordering.
  await assert.rejects(
    assertHostIsPublic('mixed.example.com', async () => ['93.184.216.34', '127.0.0.1']),
    /isn’t reachable/,
  );
});

test('a bare private IP as the hostname is refused without DNS', async () => {
  await assert.rejects(assertHostIsPublic('169.254.169.254'), /isn’t reachable/);
  await assert.rejects(assertHostIsPublic('127.0.0.1'), /isn’t reachable/);
});

test('a public host resolves fine', async () => {
  assert.deepEqual(await assertHostIsPublic('example.com', publicLookup), ['93.184.216.34']);
});

test('a hostname that does not resolve is a friendly error, not a crash', async () => {
  await assert.rejects(
    assertHostIsPublic('nope.invalid', async () => { throw new Error('ENOTFOUND'); }),
    /Couldn’t find that address/,
  );
  await assert.rejects(assertHostIsPublic('empty.invalid', async () => []), /Couldn’t find that address/);
});

// ---------------------------------------------------------------------------
// Fetching, including the redirect hop that a naive version skips.
// ---------------------------------------------------------------------------

test('fetches a calendar', async () => {
  const text = await fetchFeed('https://example.com/a.ics', {
    lookup: publicLookup,
    fetch: async () => resp(ICS),
  });
  assert.match(text, /BEGIN:VCALENDAR/);
});

test('a redirect to the metadata server is caught at the hop', async () => {
  // This is the attack a "validate the URL the user typed" check misses
  // entirely: the typed URL is perfectly public.
  let called = 0;
  await assert.rejects(
    fetchFeed('https://example.com/a.ics', {
      lookup: async (host) => (host === 'example.com' ? ['93.184.216.34'] : ['169.254.169.254']),
      fetch: async () => {
        called++;
        return called === 1
          ? resp('', 302, { location: 'http://metadata.google.internal/computeMetadata/v1/' })
          : resp(ICS);
      },
    }),
    /isn’t reachable/,
  );
  assert.equal(called, 1, 'and the second request is never made');
});

test('a redirect to a literal private address is caught too', async () => {
  await assert.rejects(
    fetchFeed('https://example.com/a.ics', {
      lookup: publicLookup,
      fetch: async () => resp('', 301, { location: 'http://169.254.169.254/latest/meta-data/' }),
    }),
    /isn’t reachable/,
  );
});

test('an ordinary redirect between public hosts is followed', async () => {
  let n = 0;
  const text = await fetchFeed('https://example.com/a.ics', {
    lookup: publicLookup,
    fetch: async () => (++n === 1 ? resp('', 302, { location: 'https://cdn.example.com/a.ics' }) : resp(ICS)),
  });
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.equal(n, 2);
});

test('a redirect loop terminates', async () => {
  await assert.rejects(
    fetchFeed('https://example.com/a.ics', {
      lookup: publicLookup,
      fetch: async () => resp('', 302, { location: 'https://example.com/a.ics' }),
    }),
    /redirects too many times/,
  );
});

test('relative redirects resolve against the current URL', async () => {
  let seen = [];
  const text = await fetchFeed('https://example.com/cal/a.ics', {
    lookup: publicLookup,
    fetch: async (u) => {
      seen.push(u);
      return seen.length === 1 ? resp('', 302, { location: '/other/b.ics' }) : resp(ICS);
    },
  });
  assert.equal(seen[1], 'https://example.com/other/b.ics');
  assert.match(text, /BEGIN:VCALENDAR/);
});

test('a page that is not a calendar is rejected with a useful message', async () => {
  await assert.rejects(
    fetchFeed('https://example.com/', { lookup: publicLookup, fetch: async () => resp('<html>hello</html>') }),
    /isn’t a calendar feed/,
  );
});

test('an auth-required feed says what to do about it', async () => {
  await assert.rejects(
    fetchFeed('https://example.com/a.ics', { lookup: publicLookup, fetch: async () => resp('', 403) }),
    /secret\/private link/,
  );
});

test('an oversized feed is refused rather than swallowed', async () => {
  await assert.rejects(
    fetchFeed('https://example.com/a.ics', {
      lookup: publicLookup,
      maxBytes: 100,
      fetch: async () => resp('x'.repeat(500)),
    }),
    /too large/,
  );
  // Also when the server lies about content-length and just streams.
  await assert.rejects(
    fetchFeed('https://example.com/a.ics', {
      lookup: publicLookup,
      maxBytes: 100,
      fetch: async () => ({
        ok: true, status: 200,
        headers: { get: () => null },
        text: async () => 'y'.repeat(500),
      }),
    }),
    /too large/,
  );
});

test('a network failure is a friendly error', async () => {
  await assert.rejects(
    fetchFeed('https://example.com/a.ics', {
      lookup: publicLookup,
      fetch: async () => { throw new Error('ECONNREFUSED'); },
    }),
    /Couldn’t reach that calendar link/,
  );
});
