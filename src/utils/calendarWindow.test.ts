// Standalone assertion test for calendarWindow.ts — same convention as
// funeralCover.test.ts / aiRedact.test.ts:
//   npx tsx src/utils/calendarWindow.test.ts
// It exits non-zero on failure.
//
// Covers the 2026-08-15 chat-function audit finding: boundCalendar sorted by
// date DESCENDING and sliced to CAL_MAX, which on a calendar with more than
// CAL_MAX events inside the window kept the FURTHEST-FUTURE ones and silently
// dropped THIS WEEK — the one thing "what's on this week" and the
// duplicate-event check both actually need.
import assert from 'node:assert';
import { boundCalendar, CAL_PAST_DAYS, CAL_FUTURE_DAYS, CAL_MAX } from './calendarWindow';

const NOW = new Date('2026-08-15T12:00:00');
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const addDays = (base: Date, n: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};
const dateAt = (n: number) => iso(addDays(NOW, n)); // n days from NOW, +future/-past

// ── window filtering ────────────────────────────────────────────────────────
{
  const events = [
    { id: 'too-far-past', date: dateAt(-(CAL_PAST_DAYS + 5)) },
    { id: 'floor', date: dateAt(-CAL_PAST_DAYS) },
    { id: 'today', date: dateAt(0) },
    { id: 'ceil', date: dateAt(CAL_FUTURE_DAYS) },
    { id: 'too-far-future', date: dateAt(CAL_FUTURE_DAYS + 5) },
    { id: 'undated' }, // no date at all
  ];
  const kept = boundCalendar(events, NOW).map((e) => e.id);
  assert.ok(kept.includes('floor'), 'the past boundary day itself must be kept (inclusive)');
  assert.ok(kept.includes('today'), "today's events must be kept");
  assert.ok(kept.includes('ceil'), 'the future boundary day itself must be kept (inclusive)');
  assert.ok(kept.includes('undated'), 'undated entries must be kept, not guessed at and dropped');
  assert.ok(!kept.includes('too-far-past'), 'events before the past floor must be dropped');
  assert.ok(!kept.includes('too-far-future'), 'events after the future ceiling must be dropped');
}

// ── the #165 regression: NEAREST survives, not "newest" ────────────────────
// Build a calendar with more than CAL_MAX dated events inside the window,
// weighted toward the far future, plus a handful of "this week" events. The
// old descending-date-then-slice bug would keep the furthest-future block and
// drop this week entirely; the fix must keep this week.
{
  const thisWeek = Array.from({ length: 5 }, (_, i) => ({ id: `week-${i}`, date: dateAt(i) }));
  const farFuture = Array.from({ length: CAL_MAX + 20 }, (_, i) => ({
    id: `far-${i}`,
    date: dateAt(CAL_FUTURE_DAYS - i), // counts down from the ceiling, so still descending-date-biggest-first
  }));
  const events = [...farFuture, ...thisWeek];
  const kept = boundCalendar(events, NOW);
  assert.strictEqual(kept.length, CAL_MAX, `must cap at CAL_MAX (${CAL_MAX})`);
  const keptIds = new Set(kept.map((e) => e.id));
  for (const w of thisWeek) {
    assert.ok(keptIds.has(w.id), `this-week event ${w.id} must survive the cap — it is nearest to today`);
  }
}

// ── ordering: nearest-to-today first, past and future interleaved by distance ──
{
  const events = [
    { id: 'plus10', date: dateAt(10) },
    { id: 'minus3', date: dateAt(-3) },
    { id: 'plus1', date: dateAt(1) },
    { id: 'minus20', date: dateAt(-20) },
  ];
  const order = boundCalendar(events, NOW).map((e) => e.id);
  assert.deepStrictEqual(order, ['plus1', 'minus3', 'plus10', 'minus20'], 'events must sort by absolute distance from today, ascending');
}

// ── undated entries sort to the end, not ahead of dated ones ───────────────
{
  const events = [
    { id: 'undated-a' },
    { id: 'dated', date: dateAt(300) },
    { id: 'undated-b' },
  ];
  const order = boundCalendar(events, NOW).map((e) => e.id);
  assert.strictEqual(order[0], 'dated', 'a dated event must come before undated ones regardless of how far out it is');
  assert.deepStrictEqual(new Set(order.slice(1)), new Set(['undated-a', 'undated-b']));
}

console.log('calendarWindow.test.ts: all assertions passed');
