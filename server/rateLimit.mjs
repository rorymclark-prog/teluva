// Sliding-window rate limiting for the endpoints where the thing being spent is
// ATTEMPTS rather than money: a secret-bearing URL, an invite code that only has
// to be guessed once. (The AI endpoints have their own per-UID limiter in
// server.js — those cost money per call and are tuned differently.)
//
// In-memory and therefore PER CLOUD RUN INSTANCE. That is a real limit, not an
// oversight: with N instances an attacker gets N× the budget. It still turns
// "grind an 8-character invite code" from a background job into something that
// needs a fleet, and it costs nothing per request. If a shared counter is ever
// needed, this is the seam to put it behind.

const hits = new Map(); // key -> timestamps (ms)

/**
 * The real client IP behind Cloud Run.
 *
 * Cloud Run appends the connecting address to X-Forwarded-For and then adds its
 * own load balancer, so the chain reads `<client>, <lb>` — and anything the
 * client sends in that header itself is PREPENDED to it. So the second-from-last
 * entry is the only one an attacker cannot choose. Taking the leftmost (what
 * Express's `trust proxy: true` does) would let one machine mint a fresh
 * "IP" per request and walk past every limit here.
 */
export function clientIp(req) {
  const chain = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (chain.length >= 2) return chain[chain.length - 2];
  return chain[0] || req?.socket?.remoteAddress || 'unknown';
}

/** True once the caller has gone OVER `max` in the trailing `windowMs`. */
export function keyedRateLimited(key, max, windowMs, now = Date.now()) {
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 20000) { // bound memory: drop every key whose window has emptied
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return arr.length > max;
}

export function ipRateLimited(bucket, req, max, windowMs, now = Date.now()) {
  return keyedRateLimited(`${bucket}|${clientIp(req)}`, max, windowMs, now);
}

/** Test seam only — the process never needs this. */
export function _resetRateLimits() {
  hits.clear();
}
