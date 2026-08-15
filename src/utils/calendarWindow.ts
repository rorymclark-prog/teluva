// Bounds the calendar sent to the AI chat prompt — pure, no React, so it can
// be unit-tested directly (see calendarWindow.test.ts). Extracted out of
// AIChatbot.tsx's buildContext during the 2026-08-15 chat-function audit.
//
// Every event ever synced used to go to the model on every single message. On
// the live account that is 554 entries and 88% of the entire payload — enough
// to blow the server's context cap on its own, which silently truncated the
// JSON and took the authoritative expiry data with it. An imported Google
// Calendar only makes this worse over time, and it is the one input a user
// can grow without limit without meaning to.
//
// A window instead. Chat needs the calendar to answer "what's on this week"
// and to avoid creating a duplicate event; neither needs a year of history.
// Recent past is kept because "when was that appointment?" is a real
// question, and undated entries are kept rather than guessed at.
// Nearest-to-today-first, capped, so a pathological calendar cannot dominate
// what the assistant sees about people.
//
// NEAREST, not "newest" (found 2026-08-15, chat-function audit): the original
// version sorted by date DESCENDING and sliced, which kept the CAL_MAX
// FURTHEST-FUTURE events in the window — on a calendar with more than
// CAL_MAX entries within [-CAL_PAST_DAYS, +CAL_FUTURE_DAYS] days, that
// silently dropped THIS WEEK (the one thing "what's on this week" and the
// duplicate-event check both actually need) in favour of events almost a
// year out. Sorting by distance from today, ascending, keeps whatever is
// closest — past or future — and only drops the far edges of the window once
// CAL_MAX is exceeded.
export const CAL_PAST_DAYS = 60;
export const CAL_FUTURE_DAYS = 365;
export const CAL_MAX = 150;

export function boundCalendar<T extends { date?: string }>(events: T[], now: Date = new Date()): T[] {
  const floor = new Date(now); floor.setDate(floor.getDate() - CAL_PAST_DAYS);
  const ceil = new Date(now); ceil.setDate(ceil.getDate() + CAL_FUTURE_DAYS);
  const iso = (d: Date) => d.toLocaleDateString('en-CA');
  const from = iso(floor), to = iso(ceil);
  const todayISOStr = iso(now);
  const distance = (d: string) => Math.abs(new Date(d).getTime() - new Date(todayISOStr).getTime());
  return (events || [])
    .filter((e) => {
      const d = String(e?.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;   // undated: keep, don't guess
      return d >= from && d <= to;
    })
    .sort((a, b) => {
      const da = String(a?.date || ''), db = String(b?.date || '');
      // Undated entries have no distance to sort by — keep them out of the
      // way at the end rather than winning ties against every dated one.
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return distance(da) - distance(db);
    })
    .slice(0, CAL_MAX);
}
