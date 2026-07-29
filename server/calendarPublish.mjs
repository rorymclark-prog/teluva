// Outbound calendar publishing — the other half of two-way sync.
//
// A subscription (server/feedUrl.mjs) pulls someone else's calendar INTO
// Teluva. This module pushes Teluva's own events OUT, as an .ics feed that
// Apple Calendar, Outlook, Google or anything else can subscribe to, so the
// family's appointments appear inside the calendar app they already use.
//
// THE SECURITY SHAPE, stated plainly because it is unusual for this app:
// a calendar app cannot sign in. There is no OAuth, no password prompt, no
// cookie — it fetches one URL on a timer, forever, from an unpredictable IP.
// So the URL itself IS the credential: anyone holding it can read whatever
// this module chooses to put in the feed, with no account and no trace.
//
// Everything here is written to make that trade explicit and small:
//   * the token is 32 random bytes, so the URL cannot be found by guessing;
//   * the feed carries ONLY calendar events — never members, documents,
//     medical records, IDs or anything else in the vault;
//   * 'busy' mode strips every title and note, so a shared link can show
//     when the family is busy without saying why;
//   * publishing is opt-in per family, revocable, and optionally expiring.
//
// Pure functions only — no firebase-admin import — so this file can be
// `node --test`ed without credentials or network.

// How far either side of today the feed reaches. Bounded because a feed is
// re-fetched forever by every subscriber: unbounded history would grow without
// limit and be re-downloaded every refresh, for events nobody is looking at.
export const PUBLISH_BACK_DAYS = 400;
export const PUBLISH_FORWARD_DAYS = 800;
export const MAX_PUBLISHED_EVENTS = 2000;

/** Privacy modes a published feed can be created with. */
export const PUBLISH_MODES = ['details', 'busy'];

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for a Date, in UTC. Feed windows don't need local precision. */
export function ymdUtc(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function shiftDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

/**
 * True when this event ORIGINATED in Teluva, rather than having been brought
 * in from somewhere else.
 *
 * THIS IS THE ECHO GUARD AND IT MATTERS. The natural thing for a family to do
 * is both halves at once: subscribe Teluva to their Apple calendar, and
 * subscribe Apple to Teluva's feed. If the feed republished what it imported,
 * every Apple event would come back to Apple as a second, Teluva-branded copy
 * of itself — and because the two copies have different UIDs, no calendar
 * would ever collapse them. The user would watch their calendar double.
 *
 * So: anything wearing another calendar's fingerprint is excluded.
 *   - `feedId` set  -> came from a subscription
 *   - `gcal-` id    -> imported from Google Calendar
 *   - `ics-` id     -> pasted in from an .ics file (also somebody else's)
 * What is left is what the family actually typed into Teluva.
 */
export function isOwnEvent(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (ev.feedId) return false;
  const id = typeof ev.id === 'string' ? ev.id : '';
  if (id.startsWith('gcal-') || id.startsWith('ics-')) return false;
  return true;
}

/**
 * Pick the events a published feed should contain: Teluva's own, with a real
 * date, inside the window, oldest first, capped.
 */
export function selectPublishableEvents(events, now = new Date()) {
  const from = ymdUtc(shiftDays(now, -PUBLISH_BACK_DAYS));
  const to = ymdUtc(shiftDays(now, PUBLISH_FORWARD_DAYS));
  return (Array.isArray(events) ? events : [])
    .filter((ev) => isOwnEvent(ev)
      && typeof ev.date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(ev.date)
      && ev.date >= from
      && ev.date <= to)
    .sort((a, b) => (a.date === b.date
      ? String(a.id || '').localeCompare(String(b.id || ''))
      : a.date.localeCompare(b.date)))
    .slice(0, MAX_PUBLISHED_EVENTS);
}

/**
 * Apply the feed's privacy mode.
 *
 * 'busy' is not cosmetic — it is the whole reason a link can be shared with
 * someone outside the family. The title and the note are the sensitive part of
 * a family calendar ("Oncology follow-up", "Court date"); the fact that a slot
 * is taken is not. So busy mode drops both, at the source, before the text
 * ever reaches the serializer — not by hiding them in a viewer.
 */
export function redactEvent(ev, mode) {
  if (mode === 'busy') {
    return { id: ev.id, date: ev.date, time: ev.time, title: 'Busy', description: '', category: '' };
  }
  return ev;
}

// --------------------------------------------------------------------------
// ICS serialization
// --------------------------------------------------------------------------

/** RFC 5545 TEXT escaping: backslash first, or it re-escapes its own output. */
export function escapeIcsText(v) {
  return String(v == null ? '' : v)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const utf8Len = (s) => Buffer.byteLength(s, 'utf8');

/**
 * Fold a content line at 75 OCTETS, per RFC 5545 §3.1.
 *
 * Octets, not characters — a family calendar is full of names like "Zoë" and
 * "Müller", and counting those as one unit each puts the fold in the wrong
 * place. Equally the split must land on a code-point boundary: cutting an
 * emoji or an accented letter in half produces bytes that are not valid UTF-8,
 * and some calendar clients drop the whole event rather than the bad character.
 */
export function foldLine(line) {
  if (utf8Len(line) <= 75) return line;
  const out = [];
  let current = '';
  let limit = 75;                       // first line 75, continuations 74 (leading space)
  for (const ch of line) {              // iterates code points, never half a pair
    if (utf8Len(current) + utf8Len(ch) > limit) {
      out.push(current);
      current = ch;
      limit = 74;
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out.map((seg, i) => (i === 0 ? seg : ' ' + seg)).join('\r\n');
}

export function icsStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function nextDayCompact(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

/**
 * A UID must be STABLE for the life of the event.
 *
 * A subscriber matches events across refreshes by UID alone. If the UID moved
 * — because it was derived from the title, or the date, or a timestamp — then
 * editing an appointment would not move it, it would delete it and create a
 * different one. Reminders set on the old copy vanish; attendees are dropped.
 * Teluva's event id never changes, so it is the whole UID.
 */
export function eventUid(ev) {
  const raw = String(ev.id || `${ev.date}-${ev.title || ''}`);
  return `${raw.replace(/[^A-Za-z0-9._-]/g, '-')}@teluva.app`;
}

/**
 * Serialize a published feed.
 *
 * Times are FLOATING (no zone, no trailing Z) because that is honestly what
 * Teluva stores: "15:00 on this date", with no zone attached. Stamping a zone
 * on would be inventing a fact — and inventing the wrong one for any family
 * that travels. Floating shows as 15:00 in whatever calendar reads it, which
 * is what the person typed.
 */
export function buildPublishedIcs(events, options = {}) {
  const {
    calendarName = 'Teluva',
    mode = 'details',
    now = new Date(),
    refreshMinutes = 60,
  } = options;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Teluva//Family Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`),
    // Both spellings: X-PUBLISHED-TTL is what Outlook and Apple honour,
    // REFRESH-INTERVAL is the standardised one (RFC 7986). Without either,
    // clients pick their own interval — Apple's default is a whole day.
    `X-PUBLISHED-TTL:PT${refreshMinutes}M`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshMinutes}M`,
  ];

  const stamp = icsStamp(now);

  for (const source of events) {
    const ev = redactEvent(source, mode);
    const ymd = ev.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${eventUid(ev)}`));
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.time && /^\d{2}:\d{2}$/.test(ev.time)) {
      const [h, m] = ev.time.split(':');
      lines.push(`DTSTART:${ymd}T${h}${m}00`);
      // An hour is a guess, but an event with no end renders as a zero-length
      // sliver in some clients and is dropped outright by others.
      const end = new Date(Date.UTC(2000, 0, 1, Number(h), Number(m)));
      end.setUTCHours(end.getUTCHours() + 1);
      const rolled = end.getUTCDate() !== 1;
      const endYmd = rolled ? nextDayCompact(ev.date) : ymd;
      lines.push(`DTEND:${endYmd}T${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      lines.push(`DTEND;VALUE=DATE:${nextDayCompact(ev.date)}`);
    }
    lines.push(foldLine(`SUMMARY:${escapeIcsText(ev.title || 'Appointment')}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(ev.description)}`));
    if (ev.category) lines.push(foldLine(`CATEGORIES:${escapeIcsText(ev.category)}`));
    // Busy-mode events must still occupy time in the subscriber's free/busy
    // view — that is the entire point of the mode.
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Whether a stored publication record is currently serving.
 * Fails CLOSED: an unreadable or malformed record is treated as revoked.
 */
export function publicationState(record, now = new Date()) {
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
