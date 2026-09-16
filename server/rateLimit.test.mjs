import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, keyedRateLimited, ipRateLimited, _resetRateLimits } from './rateLimit.mjs';

const reqWith = (xff, remote = '10.0.0.9') => ({ headers: xff === null ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });

test('clientIp takes the entry Cloud Run added, not the one the client chose', () => {
  // The honest shape: client, then Google's load balancer.
  assert.equal(clientIp(reqWith('203.0.113.7, 35.191.0.1')), '203.0.113.7');
  // A client that sends its own X-Forwarded-For has it PREPENDED. Trusting the
  // leftmost here would hand an attacker a fresh identity on every request.
  assert.equal(clientIp(reqWith('9.9.9.9, 203.0.113.7, 35.191.0.1')), '203.0.113.7');
  // Nothing in front of us at all (direct hit, local run).
  assert.equal(clientIp(reqWith(null)), '10.0.0.9');
  assert.equal(clientIp(reqWith('203.0.113.7')), '203.0.113.7');
});

test('a forged chain cannot mint a new identity per request', () => {
  _resetRateLimits();
  let limited = 0;
  for (let i = 0; i < 12; i++) {
    const req = reqWith(`1.2.3.${i}, 203.0.113.7, 35.191.0.1`); // different forged head each time
    if (ipRateLimited('probe', req, 5, 60_000)) limited += 1;
  }
  assert.equal(limited, 7, 'all twelve land in the same bucket; the 6th onward are refused');
});

test('the window slides', () => {
  _resetRateLimits();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(keyedRateLimited('k', 5, 60_000, t0 + i), false);
  assert.equal(keyedRateLimited('k', 5, 60_000, t0 + 10), true, 'the sixth in the window is over');
  assert.equal(keyedRateLimited('k', 5, 60_000, t0 + 60_001), false, 'a minute later the slate is clean');
});

test('buckets and keys do not bleed into each other', () => {
  _resetRateLimits();
  const req = reqWith('203.0.113.7, 35.191.0.1');
  for (let i = 0; i < 6; i++) ipRateLimited('carer', req, 5, 60_000);
  assert.equal(ipRateLimited('carer', req, 5, 60_000), true, 'the carer bucket is spent');
  assert.equal(ipRateLimited('cal', req, 5, 60_000), false, 'the calendar bucket is untouched');
  assert.equal(keyedRateLimited('join-uid|somebody', 5, 60_000), false, 'a uid key is untouched');
});

// The limiter is only worth anything if it is actually ON the endpoints that
// need it. These three are the ones where a guess is the attack: two
// unauthenticated secret-bearing URLs, and the invite code that admits someone
// to a family vault.
test('the guessable endpoints are wired to a limiter', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(src, /app\.get\('\/carer\/:token'[\s\S]{0,900}?ipRateLimited\('carer'/, '/carer/:token');
  assert.match(src, /app\.get\('\/cal\/:token'[\s\S]{0,2000}?ipRateLimited\('cal'/, '/cal/:token');
  assert.match(src, /app\.post\('\/api\/join-family'[\s\S]{0,1500}?keyedRateLimited\(`join-uid/, 'join-family, per account');
  assert.match(src, /app\.post\('\/api\/join-family'[\s\S]{0,1500}?ipRateLimited\('join'/, 'join-family, per IP');
  // A CSP that nothing reports on teaches nobody anything.
  assert.match(src, /Content-Security-Policy-Report-Only/, 'the policy ships report-only for now');
  assert.match(src, /report-uri \/api\/csp-report/, 'and points at an endpoint that exists');
  assert.match(src, /app\.post\(\s*'\/api\/csp-report'/, 'which is mounted');
});
