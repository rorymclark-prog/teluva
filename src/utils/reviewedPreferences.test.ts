import assert from 'node:assert/strict';
import { applyReviewedPreferences, PREFERENCE_OVERRIDE_KEY } from './reviewedPreferences';
import { PREFERENCE_LANGUAGES } from './importInboxClient';
import { LOCALES } from '../i18n/locales';

const storage = new Map<string, string>(), events: CustomEvent[] = [];
Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) || null }, window: { dispatchEvent: (event: CustomEvent) => { events.push(event); return true; } },
  CustomEvent: class { constructor(public type: string, public options: { detail: unknown }) {} get detail() { return this.options.detail; } } });
const stamp = '2026-11-03T12:00:00Z';
assert.equal(applyReviewedPreferences({ language: 'de', theme: 'dark' }), false, 'an unapproved suggestion has no review timestamp');
assert.equal(applyReviewedPreferences({ language: 'de', theme: 'dark' }, stamp), true);
assert.deepEqual(events[0].detail, { language: 'de', theme: 'dark' });
storage.set(PREFERENCE_OVERRIDE_KEY, String(Date.parse(stamp) + 1000));
assert.equal(applyReviewedPreferences({ theme: 'light' }, stamp), false, 'a later manual device choice wins');
assert.equal(events.length, 1);
assert.deepEqual([...PREFERENCE_LANGUAGES].sort(), Object.keys(LOCALES).sort(), 'every supported app language is offered');
assert.equal(applyReviewedPreferences({ language: 'invented', theme: 'invented' } as any, '2026-11-03T12:01:00Z'), false);
console.log('reviewedPreferences: explicit approval, supported languages and later manual choices pass');
