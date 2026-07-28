// Standalone assertion test — no test runner is configured in this project,
// so run it directly:  npx tsx src/utils/installPrompt.test.ts
// Exits non-zero on failure.
import assert from 'node:assert';
import { detectPlatform, shouldPrompt, MAX_DECLINES, type InstallPromptState } from './installPrompt';

// shouldPrompt reads localStorage and checks isInstalled() unless we pass state
// in; give it a minimal browser-ish global so it can run under node.
(globalThis as any).window = {
  matchMedia: () => ({ matches: false }),
  navigator: { standalone: false },
};
// Node 26 exposes `navigator` as a getter-only global, so it can't be assigned.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', maxTouchPoints: 0 },
  configurable: true,
});
(globalThis as any).localStorage = {
  _v: null as string | null,
  getItem() { return this._v; },
  setItem(_k: string, v: string) { this._v = v; },
};

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1';
const IPHONE_WHATSAPP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 WhatsApp/2.23';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

// --- platform detection ---
assert.strictEqual(detectPlatform(false, IPHONE_SAFARI), 'ios-safari', 'iPhone Safari gets the instructions');
assert.strictEqual(detectPlatform(true, ANDROID_CHROME), 'prompt-capable', 'a captured beforeinstallprompt wins');
assert.strictEqual(detectPlatform(false, ANDROID_CHROME), 'unsupported', 'Android without the event: say nothing');
assert.strictEqual(detectPlatform(false, DESKTOP), 'unsupported', 'desktop without the event: say nothing');
// The two that would otherwise send someone hunting for a button that isn't there:
assert.strictEqual(detectPlatform(false, IPHONE_CHROME), 'unsupported', 'Chrome on iOS cannot add to Home Screen');
assert.strictEqual(detectPlatform(false, IPHONE_WHATSAPP), 'unsupported', 'in-app browsers have no Share > Add to Home Screen');

const fresh: InstallPromptState = { declines: 0, lastDeclinedAt: null, installed: false };
const NOW = new Date('2026-07-28T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

// --- when to ask ---
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, state: fresh, now: NOW }), true,
  'iOS Safari, has content, never declined -> ask',
);
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: false, state: fresh, now: NOW }), false,
  'empty vault -> never ask; show value before asking for commitment',
);
assert.strictEqual(
  shouldPrompt({ platform: 'unsupported', hasContent: true, state: fresh, now: NOW }), false,
  'unsupported platform -> never ask',
);
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, now: NOW,
    state: { declines: 0, lastDeclinedAt: null, installed: true } }), false,
  'already installed -> never ask again',
);

// --- backoff: 3 days, then 14, then 30 ---
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, now: NOW,
    state: { declines: 1, lastDeclinedAt: daysAgo(2), installed: false } }), false,
  'declined once, 2 days ago -> still quiet (3-day backoff)',
);
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, now: NOW,
    state: { declines: 1, lastDeclinedAt: daysAgo(4), installed: false } }), true,
  'declined once, 4 days ago -> ask again',
);
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, now: NOW,
    state: { declines: 2, lastDeclinedAt: daysAgo(10), installed: false } }), false,
  'declined twice, 10 days ago -> still quiet (14-day backoff)',
);
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, now: NOW,
    state: { declines: 2, lastDeclinedAt: daysAgo(20), installed: false } }), true,
  'declined twice, 20 days ago -> ask again',
);

// --- the stop rule: three noes means no ---
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, now: NOW,
    state: { declines: MAX_DECLINES, lastDeclinedAt: daysAgo(9999), installed: false } }), false,
  'declined 3 times -> never ask again, however long it has been',
);

// --- a corrupt/garbage timestamp must not unlock the prompt ---
assert.strictEqual(
  shouldPrompt({ platform: 'ios-safari', hasContent: true, now: NOW,
    state: { declines: 1, lastDeclinedAt: 'not-a-date', installed: false } }), false,
  'unparseable lastDeclinedAt -> stay quiet rather than nag',
);

console.log('installPrompt.test.ts: all assertions passed');
