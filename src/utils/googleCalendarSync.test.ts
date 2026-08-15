// Standalone assertion tests for outbound Google Calendar sync — same
// convention as aiRedact.test.ts. Run directly:
//   npx tsx src/utils/googleCalendarSync.test.ts
// It exits non-zero on failure.
//
// This is the highest-stakes file in the calendar integration: a bug here
// means either a family's private events get silently mirrored into their
// Google account when they never asked for it, or an imported event gets
// pushed back to Google and starts duplicating on every sync. Both failure
// modes are pure-logic (no network involved) and cheap to pin down here.
import assert from 'node:assert';
import { CalendarEvent } from '../types';
import { isGoogleOriginEventId, isEligibleForGooglePush, isEligibleForAutoSync, buildGoogleCalendarEventBody } from './googleCalendarSync';

const base: CalendarEvent = {
  id: 'ev-1',
  title: 'Dentist',
  date: '2026-08-01',
  time: '09:30',
  category: 'Appointment',
  remindMe: true,
};

// ── isGoogleOriginEventId ───────────────────────────────────────────────────

assert.strictEqual(isGoogleOriginEventId('gcal-abc123'), true, 'a "gcal-" id is Google-origin');
assert.strictEqual(isGoogleOriginEventId('ev-1'), false, 'a Teluva-minted "ev-" id is not Google-origin');
assert.strictEqual(isGoogleOriginEventId('scan-99'), false, 'a notice-scan id is not Google-origin');

// ── isEligibleForGooglePush — the gate every push path (manual button, bulk
//    export, and the automatic per-new-event effect) shares ─────────────────

assert.strictEqual(isEligibleForGooglePush(base), true, 'a fresh Teluva event is eligible');
assert.strictEqual(
  isEligibleForGooglePush({ ...base, id: 'gcal-xyz' }),
  false,
  'an imported (Google-origin) event must NEVER be eligible — this is the export/import loop guard'
);
assert.strictEqual(
  isEligibleForGooglePush({ ...base, googleSynced: true }),
  false,
  'an event already pushed once must not be pushed again'
);
assert.strictEqual(
  isEligibleForGooglePush({ ...base, id: 'gcal-xyz', googleSynced: true }),
  false,
  'belt and braces: both guards true at once is still ineligible'
);

// ── isEligibleForAutoSync — the STRICTER rule the automatic path uses on top
//    of isEligibleForGooglePush: also excludes anything present in the
//    persisted opt-in baseline. This is what replaced the old React-ref
//    "seen since mount" tracking (broken because FamilyCalendar only mounts
//    while the Calendar tab is open — see the file header) with a snapshot
//    that survives reload, remounts, and the user being on any other tab. ──

// The headline scenario this whole fix exists for: the owner has 555
// pre-existing events (the app's real numbers). They opt in to auto-sync —
// Dashboard.tsx's onToggleAutoSync captures every id that exists AT THAT
// MOMENT as the baseline. Turning the switch on must not treat any of that
// history as "new."
{
  const preExisting: CalendarEvent[] = Array.from({ length: 555 }, (_, i) => ({
    id: `ev-${i}`,
    title: `Pre-existing event ${i}`,
    date: '2026-01-01',
    category: 'Other',
    remindMe: false,
  }));
  const baselineAtOptIn = new Set(preExisting.map(e => e.id));

  const stillNoneEligible = preExisting.filter(e => isEligibleForAutoSync(e, baselineAtOptIn));
  assert.strictEqual(
    stillNoneEligible.length,
    0,
    'flipping auto-sync on must not make ANY of the 555 pre-existing events eligible — this is the "never bulk-push history" guarantee'
  );

  // Now simulate exactly the bug report this feature exists to fix: the
  // owner is on a completely different screen (Profiles, not Calendar) and
  // asks the AI chat to add an appointment. Nothing about isEligibleForAutoSync
  // has any notion of "was a component mounted to see this happen" — the
  // event simply appears in the array, the same as it would from any other
  // creation path, and the function is re-evaluated fresh with no memory of
  // prior calls. That absence of any "did I witness this" state IS the fix:
  // the old React-ref version could only ever detect events created while
  // FamilyCalendar happened to be mounted.
  const newAppointment: CalendarEvent = {
    id: 'ev-new-from-ai-chat',
    title: "Mia's dentist",
    date: '2026-08-10',
    category: 'Appointment',
    remindMe: true,
  };
  const afterAiChatAddedIt = [...preExisting, newAppointment];
  const eligibleNow = afterAiChatAddedIt.filter(e => isEligibleForAutoSync(e, baselineAtOptIn));
  assert.strictEqual(eligibleNow.length, 1, 'exactly the one event created after opt-in is eligible — not zero (the old bug) and not all 556');
  assert.strictEqual(eligibleNow[0].id, 'ev-new-from-ai-chat');

  // Once it's pushed, the caller sets googleSynced true and persists that —
  // re-evaluating with the SAME baseline (nothing about the baseline itself
  // changes on a push) must now exclude it, so a later run (another effect
  // fire, a reload, whatever) never sends it twice.
  const afterSync = afterAiChatAddedIt.map(e => (e.id === 'ev-new-from-ai-chat' ? { ...e, googleSynced: true } : e));
  const eligibleAfterSync = afterSync.filter(e => isEligibleForAutoSync(e, baselineAtOptIn));
  assert.strictEqual(eligibleAfterSync.length, 0, 'a synced event must not be eligible again, even against the same baseline');
}

// A "gcal-" event must be excluded from auto-sync even if, hypothetically,
// it were somehow missing from the baseline (belt and braces — isEligibleForGooglePush
// already guarantees this, isEligibleForAutoSync must not weaken it).
assert.strictEqual(
  isEligibleForAutoSync({ ...base, id: 'gcal-abc' }, new Set()),
  false,
  'a Google-origin event stays excluded from auto-sync regardless of the baseline'
);

// An event NOT in an empty baseline (auto-sync turned on when the calendar
// was empty, or a device that never captured one) is otherwise eligible —
// proves the baseline is additive-only (it can only EXCLUDE ids explicitly
// in it), never a default-deny that blocks everything absent a snapshot.
assert.strictEqual(isEligibleForAutoSync(base, new Set()), true, 'an empty baseline excludes nothing');

// Re-enabling after a period OFF must re-baseline to whatever exists at
// THAT moment, per the original spec: "turning it off and on again always
// re-baselines rather than replaying whatever accumulated while it was
// off." So an event that arrived while the toggle was off is folded into
// the NEW baseline on re-enable and is correctly NOT auto-pushed — it's
// exactly the kind of "accumulated while off" backlog re-enabling must not
// dump on Google. (A user who does want it sent has the manual per-event
// cloud button, or "Export all events," for exactly this case.)
{
  const arrivedWhileOff: CalendarEvent = { id: 'ev-arrived-while-off', title: 'X', date: '2026-01-01', category: 'Other', remindMe: false };
  const staleBaselineFromFirstEnable = new Set(['ev-1', 'ev-2']); // captured before this event ever existed
  const freshBaselineOnReEnable = new Set(['ev-1', 'ev-2', 'ev-arrived-while-off']); // captured NOW, per onToggleAutoSync

  assert.strictEqual(
    isEligibleForAutoSync(arrivedWhileOff, staleBaselineFromFirstEnable),
    true,
    'sanity check: against a baseline that predates it, the event would look eligible'
  );
  assert.strictEqual(
    isEligibleForAutoSync(arrivedWhileOff, freshBaselineOnReEnable),
    false,
    'against the FRESH baseline onToggleAutoSync actually captures on re-enable, backlog accumulated while off is correctly excluded, not bulk-pushed'
  );
}

// ── buildGoogleCalendarEventBody ────────────────────────────────────────────

const body = buildGoogleCalendarEventBody(base);
assert.strictEqual(body.summary, '[Family Hub] Dentist', 'the "[Family Hub]" prefix is what lets the importer recognise and skip our own pushed events');
assert.strictEqual(body.start.timeZone, 'Europe/Vienna');
assert.strictEqual(body.end.timeZone, 'Europe/Vienna');
assert.strictEqual(body.start.dateTime, '2026-08-01T09:30:00');
assert.strictEqual(body.end.dateTime, '2026-08-01T10:30:00', 'defaults to a 1-hour block when the event has no explicit end time');

// An event with no time is a real ALL-DAY event, not a 9am appointment.
// This used to fall back to a fake 09:00-10:00 dateTime window — which put a
// birthday or a passport-expiry reminder in the middle of the day like a
// meeting instead of the all-day banner, on every calendar that read it. The
// correct Google shape is `date` (not `dateTime`), no timeZone, and an
// EXCLUSIVE end of the following day.
const untimed = buildGoogleCalendarEventBody({ ...base, time: undefined });
assert.strictEqual((untimed.start as any).date, '2026-08-01');
assert.strictEqual((untimed.end as any).date, '2026-08-02', 'end is exclusive: the day AFTER, not the same day');
assert.strictEqual((untimed.start as any).dateTime, undefined, 'must not be a timed event');
assert.strictEqual((untimed.start as any).timeZone, undefined, 'all-day events carry no timeZone');

// Crossing midnight rolls the END DATE too — (h+1)%24 on the same date used to
// put 23:30's end before its own start, which Google's API rejects outright.
const lateNight = buildGoogleCalendarEventBody({ ...base, time: '23:30' });
assert.strictEqual(lateNight.start.dateTime, '2026-08-01T23:30:00');
assert.strictEqual(lateNight.end.dateTime, '2026-08-02T00:30:00', 'end rolls into the next calendar day');

console.log('googleCalendarSync.test.ts: all assertions passed');
