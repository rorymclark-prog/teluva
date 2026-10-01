// The automatic phone alarm — the server half.
//
// THE PROBLEM THIS SOLVES
// -----------------------
// The "Alarm" button (src/utils/appointmentAlarm.ts) only helps if somebody
// remembers to press it, and the appointment that gets overlooked is exactly
// the one nobody thought to press it for. So the phone asks instead. A Shortcuts
// "Time of Day" automation on the iPhone runs every morning, fetches this feed,
// and turns each time in it into a Clock alarm — loud through silent mode,
// ringing until Stop is tapped. Set up once, it carries on every day.
//
// WHY THE FEED IS SHAPED THE WAY IT IS
// ------------------------------------
// * TIMES ONLY. No title, no place, no member. A Shortcuts automation cannot
//   sign in, so (like the calendar feed) the URL is the credential; the least
//   it can leak is a list of clock times. The alarm reads "Alarm" and the phone
//   owner opens Teluva to see why — an acceptable price for a link that cannot
//   disclose "Oncology follow-up".
// * THE PHONE SENDS ITS OWN CLOCK (?now=yyyyMMddHHmm). Events are stored as
//   wall-clock date + time with no zone, and a Clock alarm is a wall-clock time
//   of day too. So all the arithmetic here is on "naive" local time, with the
//   phone as the authority on what local time is. That makes travel (Vienna ↔
//   South Africa) and a phone in the wrong zone a non-issue: nothing on the
//   server has to guess a time zone, and nothing can be stored stale.
// * ONLY ALARMS LESS THAN 24 HOURS AWAY. A Clock alarm has a time of day, not a
//   date, and rings at the next occurrence of that time. An alarm for Friday
//   10:00 created on Tuesday would ring Wednesday 10:00 — the wrong day, set on
//   purpose, so nobody would question it. A daily run covers exactly the next
//   24 hours, so nothing is lost by the limit. MAX_AHEAD_MS mirrors the client.
//
// Pure functions only — no firebase-admin import — so this is `node --test`ed
// without credentials or network, like calendarPublish.mjs.

import { isImportantEvent } from './importantEvents.mjs';

/** Same edge as src/utils/appointmentAlarm.ts: one minute inside 24 h. */
export const MAX_AHEAD_MS = 24 * 60 * 60 * 1000 - 60 * 1000;
/** An alarm is minute-granular; "now" would ring at this minute's :00, already gone. */
export const MIN_AHEAD_MS = 60 * 1000;

/** Lead times a feed can be created with (minutes before the appointment). */
export const ALARM_LEAD_MINUTES = [0, 15, 30, 60, 120];
export const DEFAULT_LEAD_MINUTES = 60;

/** 'important' = what Teluva already treats as important; 'all' = every timed event. */
export const ALARM_SCOPES = ['important', 'all'];

/** A day has a handful of real appointments; more than this means something is wrong. */
export const MAX_ALARMS = 20;

/** How far the phone's clock may be from ours before we refuse it. Zones span ±14 h. */
const MAX_CLOCK_SKEW_MS = 15 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

/**
 * "202610010530" -> a Date whose UTC fields ARE the phone's wall clock.
 * Naive on purpose: it is only ever compared with other naive times built the
 * same way, so no zone or DST rule can enter. Returns null for anything that
 * is not a real minute (13th month, 30 February, 25:00…).
 */
export function parseLocalStamp(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, 0, 0));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d
    || t.getUTCHours() !== h || t.getUTCMinutes() !== mi) return null;
  return t;
}

/**
 * The phone's stated wall clock, or null if it cannot be right. A clock more
 * than 15 hours from ours cannot be a real time zone; accepting it would let a
 * broken Shortcut create alarms for the wrong day with no sign anything is off.
 */
export function trustedPhoneNow(stamp, serverNow = new Date()) {
  const t = parseLocalStamp(stamp);
  if (!t) return null;
  if (Math.abs(t.getTime() - serverNow.getTime()) > MAX_CLOCK_SKEW_MS) return null;
  return t;
}

/** An event's own moment as a naive Date (UTC fields = wall clock), or null when it has no usable time. */
export function eventInstant(ev) {
  if (!ev || typeof ev.date !== 'string' || typeof ev.time !== 'string') return null;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ev.date);
  const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(ev.time.trim());
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const at = new Date(Date.UTC(y, mo - 1, da, Number(t[1]), Number(t[2]), 0, 0));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== da) return null;
  return at;
}

/** The text "Get Dates from Input" understands — the same shape the button sends. */
export function formatAlarmTime(at) {
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

/**
 * The alarms to create right now, as "YYYY-MM-DD HH:MM" strings, soonest first.
 *
 * Only events with a real time can have one: an all-day event has no "an hour
 * before", and inventing a time would wake someone for a moment nobody chose.
 * Imported events (Google, Apple, .ics) count — the appointment that gets
 * overlooked is very often one that arrived from the calendar app that failed
 * to alert in the first place; there is no echo to guard against because this
 * feed is not a calendar.
 *
 * @param {Array<object>} events
 * @param {Date} phoneNow  naive wall clock from trustedPhoneNow()
 * @param {{ leadMinutes?: number, scope?: string, business?: boolean }} [opts]
 */
export function alarmsFor(events, phoneNow, opts = {}) {
  const lead = ALARM_LEAD_MINUTES.includes(opts.leadMinutes) ? opts.leadMinutes : DEFAULT_LEAD_MINUTES;
  const all = opts.scope === 'all';
  const nowMs = phoneNow.getTime();
  const seen = new Set();
  const out = [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (!all && !isImportantEvent(ev, { business: !!opts.business })) continue;
    const start = eventInstant(ev);
    if (!start) continue;
    const at = new Date(start.getTime() - lead * 60 * 1000);
    const ahead = at.getTime() - nowMs;
    if (ahead <= MIN_AHEAD_MS || ahead >= MAX_AHEAD_MS) continue;
    const text = formatAlarmTime(at);
    if (seen.has(text)) continue;        // two appointments at once want one alarm, not two
    seen.add(text);
    out.push(text);
  }
  return out.sort().slice(0, MAX_ALARMS);
}

/** Same lifecycle as a calendar link: revoked, expired, or missing all read as "not there". */
export function alarmFeedState(record, now = new Date()) {
  if (!record || typeof record !== 'object') return 'missing';
  if (record.revoked) return 'revoked';
  if (record.expiresAt) {
    const t = Date.parse(record.expiresAt);
    if (!Number.isFinite(t)) return 'revoked';
    if (t < now.getTime()) return 'expired';
  }
  if (typeof record.familyId !== 'string' || !record.familyId) return 'missing';
  return 'active';
}
