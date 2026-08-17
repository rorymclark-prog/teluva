// Standalone assertion test for eventRelevance.ts — same convention as
// calendarWindow.test.ts / eventMemberMatch.test.ts:
//   npx tsx src/utils/eventRelevance.test.ts
// It exits non-zero on failure.
//
// Covers Rory's 2026-08-17 Calendar-view feedback: birthdays, passport/visa
// renewals, and medical appointments should surface before generic
// Google-imported personal/work entries. Category alone can't tell a
// hand-typed dentist appointment apart from an imported work meeting — both
// are category 'Appointment' — so the tier must fall back to the 'gcal-' id
// prefix (the same signal isGoogleOriginEventId already uses) to tell them
// apart.
import assert from 'node:assert';
import { eventRelevanceTier, sortByRelevance, RELEVANCE_TIER } from './eventRelevance';

// ── tier assignment ─────────────────────────────────────────────────────────
{
  assert.strictEqual(
    eventRelevanceTier({ id: 'ev-1', category: 'Milestone' }),
    RELEVANCE_TIER.MILESTONE_OR_TRAVEL,
    'a birthday must rank in the top tier',
  );
  assert.strictEqual(
    eventRelevanceTier({ id: 'ev-2', category: 'Travel' }),
    RELEVANCE_TIER.MILESTONE_OR_TRAVEL,
    'a passport/visa expiry must rank in the top tier',
  );
  // The actual bug this fixes: a Google-imported work meeting and a
  // hand-typed medical appointment are BOTH category 'Appointment' — origin
  // (the id prefix), not category, has to be what separates them.
  assert.strictEqual(
    eventRelevanceTier({ id: 'ev-3', category: 'Appointment' }),
    RELEVANCE_TIER.FAMILY_NATIVE,
    "a hand-typed 'Appointment' (e.g. a dentist visit filed via AI chat) must rank above imports",
  );
  assert.strictEqual(
    eventRelevanceTier({ id: 'gcal-abc123', category: 'Appointment' }),
    RELEVANCE_TIER.IMPORTED,
    "a Google-imported 'Appointment' (e.g. a work meeting) must rank in the bottom tier despite the identical category",
  );
  assert.strictEqual(
    eventRelevanceTier({ id: 'ev-4', category: 'School' }),
    RELEVANCE_TIER.FAMILY_NATIVE,
    'School events (never produced by the Google-import path) rank as family-native',
  );
  assert.strictEqual(
    eventRelevanceTier({ id: 'gcal-xyz', category: 'Other' }),
    RELEVANCE_TIER.IMPORTED,
    "an imported 'Other' event still ranks bottom-tier — the gcal- prefix wins regardless of category",
  );
}

// ── sortByRelevance: tier first, chronological within a tier ───────────────
{
  const events = [
    { id: 'gcal-early-meeting', category: 'Appointment' as const, time: '08:00' },
    { id: 'ev-dentist', category: 'Appointment' as const, time: '14:00' },
    { id: 'ev-birthday', category: 'Milestone' as const, time: '18:00' },
    { id: 'gcal-late-meeting', category: 'Other' as const, time: '20:00' },
  ];
  const sorted = sortByRelevance(events, (e) => e.time).map((e) => e.id);
  assert.deepStrictEqual(
    sorted,
    ['ev-birthday', 'ev-dentist', 'gcal-early-meeting', 'gcal-late-meeting'],
    'an 18:00 birthday must outrank an 08:00 imported meeting — relevance beats clock time',
  );
}

// ── sortByRelevance: chronological order preserved within a tier ───────────
{
  const events = [
    { id: 'ev-b', category: 'Milestone' as const, date: '2026-08-20' },
    { id: 'ev-a', category: 'Travel' as const, date: '2026-08-18' },
    { id: 'gcal-b', category: 'Appointment' as const, date: '2026-08-17' },
    { id: 'gcal-a', category: 'Appointment' as const, date: '2026-08-16' },
  ];
  const sorted = sortByRelevance(events, (e) => e.date).map((e) => e.id);
  assert.deepStrictEqual(
    sorted,
    ['ev-a', 'ev-b', 'gcal-a', 'gcal-b'],
    'within each tier, earlier dates must still come first',
  );
}

// ── sortByRelevance: does not mutate the input array ────────────────────────
{
  const events = [
    { id: 'gcal-x', category: 'Appointment' as const, date: '2026-08-16' },
    { id: 'ev-y', category: 'Milestone' as const, date: '2026-08-20' },
  ];
  const original = [...events];
  sortByRelevance(events, (e) => e.date);
  assert.deepStrictEqual(events, original, 'sortByRelevance must not mutate its input');
}

console.log('eventRelevance.test.ts: all checks passed.');
