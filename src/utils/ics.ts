// iCalendar (.ics) reading and writing — the answer to "what about people on
// Apple or Outlook calendars?"
//
// Google is the only calendar this app talks to over an API, and adding a
// second one means a second OAuth app, a second verification, a second set of
// scopes to justify. ICS needs none of that: it is the one format every
// calendar on earth can both export and import — Apple Calendar, Outlook,
// Thunderbird, Proton, Fastmail, and Google itself. One parser covers all of
// them, and it works offline.
//
// What this deliberately is NOT: a live two-way sync. An .ics file is a
// snapshot. Someone who moves an appointment in Outlook after exporting has to
// export again. That is worth saying plainly in the UI rather than implying a
// connection that doesn't exist.
//
// Spec: RFC 5545. This implements the parts a family calendar actually uses.
// Where it doesn't understand something it keeps the event and records a
// warning, because dropping an appointment silently is the worst thing a
// calendar importer can do.

import { CalendarEvent, FamilyMember } from '../types';
import { resolveEventMembers } from './eventMemberMatch';
// Shared with the birth chart — see utils/timeZone.ts for why this is one
// implementation rather than two.
import { wallTimeToInstant } from './timeZone';

export interface IcsParseResult {
  events: CalendarEvent[];
  /** Human-readable notes about anything approximated or skipped. */
  warnings: string[];
  /** VEVENTs seen, including ones that produced several dated events. */
  sourceCount: number;
}

// How far a repeating event is expanded. An unbounded RRULE ("every week
// forever") would otherwise generate rows until the heat death of the
// universe; a family calendar only needs the window it can actually see.
const EXPAND_BACK_DAYS = 400;
const EXPAND_FORWARD_DAYS = 800;
/** Hard ceiling per rule, so a malformed INTERVAL can't hang the browser. */
const MAX_OCCURRENCES = 400;

// ---------------------------------------------------------------------------
// Lexing
// ---------------------------------------------------------------------------

/**
 * Undo RFC 5545 line folding. Long lines are split with CRLF followed by a
 * single space or tab, and that continuation character is NOT part of the
 * value. Producers in the wild fold with bare LF too, so both are accepted.
 */
export function unfoldIcs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((l) => l.length > 0);
}

export interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Split one content line into name, parameters and value.
 * The value may itself contain colons ("mailto:x", a URL), so the split is at
 * the first colon that is not inside a quoted parameter value.
 */
export function parseIcsLine(line: string): IcsProperty | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) { colon = i; break; }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segments: string[] = [];
  let cur = '';
  inQuotes = false;
  for (const c of head) {
    if (c === '"') { inQuotes = !inQuotes; cur += c; }
    else if (c === ';' && !inQuotes) { segments.push(cur); cur = ''; }
    else cur += c;
  }
  segments.push(cur);

  const name = (segments.shift() || '').trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const seg of segments) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    const k = seg.slice(0, eq).trim().toUpperCase();
    const v = seg.slice(eq + 1).trim().replace(/^"|"$/g, '');
    params[k] = v;
  }
  return { name, params, value };
}

/** Undo TEXT escaping: \n \N \, \; \\ */
export function unescapeIcsText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Apply TEXT escaping for output. Backslash first, or it escapes its own output. */
export function escapeIcsText(v: string): string {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export interface IcsInstant {
  date: string;        // YYYY-MM-DD, in the viewer's local time
  time?: string;       // HH:MM, absent for all-day events
  allDay: boolean;
  /** True when a named zone was given but couldn't be resolved. */
  zoneUnknown?: boolean;
}

/**
 * A date/time exactly as the file wrote it, before any conversion.
 *
 * Recurrence MUST be expanded on these, not on converted local dates. "every
 * Thursday" means Thursday in the event's own zone; converting first and then
 * expanding asks the wrong calendar. Read from Samoa, an 08:00Z Thursday event
 * is 21:00 on WEDNESDAY locally — so a BYDAY=TH rule expanded against local
 * dates generates a set of days that the event never actually falls on, and an
 * EXDATE for a cancelled occurrence then matches nothing. That is not a
 * hypothetical: it is what these tests caught in UTC-11.
 */
interface IcsRaw {
  y: number; mo: number; d: number;
  h: number; mi: number; s: number;
  allDay: boolean;
  /** 'utc', 'floating', or an IANA zone name. */
  zone: string;
  zoneUnknown?: boolean;
}

const rawDateKey = (r: IcsRaw) => `${r.y}-${pad(r.mo)}-${pad(r.d)}`;

/** Parse a value into its written components, doing no conversion at all. */
export function parseIcsRaw(value: string, params: Record<string, string> = {}): IcsRaw | null {
  const v = (value || '').trim();

  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || params.VALUE === 'DATE') {
    const m = dateOnly || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0, allDay: true, zone: 'floating' };
  }

  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!dt) return null;
  const [, ys, mos, ds, hs, mis, ss, z] = dt;
  return {
    y: +ys, mo: +mos, d: +ds, h: +hs, mi: +mis, s: ss ? +ss : 0,
    allDay: false,
    zone: z ? 'utc' : (params.TZID || 'floating'),
  };
}

/** Convert written components to the viewer's local date and time. */
export function rawToLocal(raw: IcsRaw): IcsInstant {
  if (raw.allDay) return { date: rawDateKey(raw), allDay: true };

  if (raw.zone === 'utc') {
    const inst = new Date(Date.UTC(raw.y, raw.mo - 1, raw.d, raw.h, raw.mi, raw.s));
    return { date: localDate(inst), time: localTime(inst), allDay: false };
  }
  if (raw.zone !== 'floating') {
    const inst = wallTimeToInstant(raw.y, raw.mo, raw.d, raw.h, raw.mi, raw.s, raw.zone);
    if (inst) return { date: localDate(inst), time: localTime(inst), allDay: false };
    // Unknown zone: keep the wall time rather than lose the event, and say so.
    return { date: rawDateKey(raw), time: `${pad(raw.h)}:${pad(raw.mi)}`, allDay: false, zoneUnknown: true };
  }
  return { date: rawDateKey(raw), time: `${pad(raw.h)}:${pad(raw.mi)}`, allDay: false };
}

/**
 * Read a DTSTART/DTEND/EXDATE value into a local date (and time).
 *
 * The three shapes that matter, and why they are not interchangeable:
 *   20260815          — a date, no time. An all-day event.
 *   20260815T150000Z  — an absolute instant in UTC. MUST be converted, or a
 *                       15:00 Vienna appointment displays as 13:00.
 *   20260815T150000   — wall-clock time. With TZID it belongs to that zone and
 *                       is converted; without one it is "floating" and means
 *                       15:00 wherever you happen to be, so it is taken as-is.
 */
export function parseIcsDate(value: string, params: Record<string, string> = {}): IcsInstant | null {
  const raw = parseIcsRaw(value, params);
  return raw ? rawToLocal(raw) : null;
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface Rrule {
  freq: string;
  interval: number;
  count?: number;
  until?: Date;
  byDay?: number[];
  /** Parts we don't implement — the caller warns rather than pretending. */
  unsupported: string[];
}

export function parseRrule(value: string): Rrule | null {
  const parts: Record<string, string> = {};
  for (const kv of (value || '').split(';')) {
    const eq = kv.indexOf('=');
    if (eq === -1) continue;
    parts[kv.slice(0, eq).trim().toUpperCase()] = kv.slice(eq + 1).trim();
  }
  const freq = (parts.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  const unsupported = Object.keys(parts).filter(
    (k) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'].includes(k),
  );

  let until: Date | undefined;
  if (parts.UNTIL) {
    const inst = parseIcsDate(parts.UNTIL);
    if (inst) {
      const [y, m, d] = inst.date.split('-').map(Number);
      until = new Date(y, m - 1, d, 23, 59, 59);
    }
  }

  // BYDAY is honoured for WEEKLY only. On MONTHLY/YEARLY it means things like
  // "the third Tuesday", which needs positional handling this doesn't do — so
  // it is reported as unsupported rather than silently misapplied.
  let byDay: number[] | undefined;
  if (parts.BYDAY) {
    if (freq === 'WEEKLY') {
      byDay = parts.BYDAY.split(',')
        .map((d) => WEEKDAY_INDEX[d.trim().slice(-2).toUpperCase()])
        .filter((n) => n !== undefined);
      if (!byDay.length) byDay = undefined;
    } else {
      unsupported.push('BYDAY');
    }
  }

  const interval = Math.max(1, parseInt(parts.INTERVAL || '1', 10) || 1);
  const count = parts.COUNT ? Math.max(1, parseInt(parts.COUNT, 10) || 1) : undefined;
  return { freq, interval, count, until, byDay, unsupported };
}

/**
 * Expand a rule into local YYYY-MM-DD dates inside the display window.
 * Returns the start date alone if the rule is unusable — an event that repeats
 * is still an event, and showing its first date beats showing nothing.
 */
export function expandRecurrence(startDate: string, rule: Rrule | null, today = new Date()): string[] {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  if (!rule) return [startDate];

  const windowStart = new Date(today); windowStart.setDate(windowStart.getDate() - EXPAND_BACK_DAYS);
  const windowEnd = new Date(today); windowEnd.setDate(windowEnd.getDate() + EXPAND_FORWARD_DAYS);

  const out: string[] = [];
  let emitted = 0;

  const push = (d: Date) => {
    if (rule.until && d > rule.until) return false;
    if (d >= windowStart && d <= windowEnd) out.push(localDate(d));
    emitted++;
    if (rule.count && emitted >= rule.count) return false;
    return d <= windowEnd && out.length < MAX_OCCURRENCES;
  };

  if (rule.freq === 'WEEKLY' && rule.byDay?.length) {
    // Walk week by week from the start's week, emitting each selected weekday.
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    for (let w = 0; w < MAX_OCCURRENCES; w++) {
      const base = new Date(weekStart);
      base.setDate(base.getDate() + w * 7 * rule.interval);
      if (base > windowEnd) break;
      let ok = true;
      for (const wd of [...rule.byDay].sort((a, b) => a - b)) {
        const d = new Date(base);
        d.setDate(d.getDate() + wd);
        if (d < start) continue;      // never before the event itself
        if (!push(d)) { ok = false; break; }
      }
      if (!ok) break;
    }
    return out.length ? out : [startDate];
  }

  const step = (d: Date, n: number) => {
    const next = new Date(d);
    if (rule.freq === 'DAILY') next.setDate(next.getDate() + n);
    else if (rule.freq === 'WEEKLY') next.setDate(next.getDate() + n * 7);
    else if (rule.freq === 'MONTHLY') next.setMonth(next.getMonth() + n);
    else next.setFullYear(next.getFullYear() + n);
    return next;
  };

  let cur = new Date(start);
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    if (cur > windowEnd) break;
    if (!push(cur)) break;
    cur = step(cur, rule.interval);
  }
  return out.length ? out : [startDate];
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** A stable id, so importing the same file twice doesn't duplicate anything. */
function icsEventId(uid: string, date: string, index: number): string {
  const clean = uid.replace(/[^A-Za-z0-9._@-]/g, '').slice(0, 80) || `noUid${index}`;
  return `ics-${clean}-${date}`;
}

export function parseIcs(
  text: string,
  members: readonly Pick<FamilyMember, 'id' | 'name'>[] = [],
  today = new Date(),
): IcsParseResult {
  const lines = unfoldIcs(text || '');
  const events: CalendarEvent[] = [];
  const warnings: string[] = [];
  let sourceCount = 0;

  let inEvent = false;
  let cur: {
    uid?: string; summary?: string; description?: string; location?: string;
    start?: IcsRaw; rrule?: string;
    /** Source-zone dates, so they compare against expanded occurrences. */
    exdates: Set<string>; status?: string;
  } | null = null;

  let unknownZone = 0;
  let partialRules = 0;
  let noStart = 0;
  let cancelled = 0;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      cur = { exdates: new Set() };
      continue;
    }
    if (upper.startsWith('END:VEVENT')) {
      if (cur) {
        sourceCount++;
        // A cancelled event is a real instruction from the source calendar —
        // importing it would put an appointment back that someone called off.
        if ((cur.status || '').toUpperCase() === 'CANCELLED') {
          cancelled++;
        } else if (!cur.start) {
          noStart++;
        } else {
          const rule = cur.rrule ? parseRrule(cur.rrule) : null;
          if (cur.rrule && (!rule || rule.unsupported.length)) partialRules++;

          // Expand in the event's OWN zone, exclude EXDATEs there, and only
          // then convert each surviving occurrence to local. Doing it the
          // other way round misplaces BYDAY and stops EXDATE matching — see
          // the note on IcsRaw.
          const sourceDates = cur.rrule
            ? expandRecurrence(rawDateKey(cur.start), rule, today).filter((d) => !cur!.exdates.has(d))
            : [rawDateKey(cur.start)];

          const title = (cur.summary || '').trim() || 'Untitled appointment';
          const descBits = [cur.description?.trim(), cur.location?.trim() ? `Location: ${cur.location.trim()}` : '']
            .filter(Boolean);
          const memberIds = resolveEventMembers({ title, memberIds: [] }, members).memberIds;
          let sawUnknownZone = false;

          sourceDates.forEach((srcDate, i) => {
            const [y, mo, d] = srcDate.split('-').map(Number);
            const local = rawToLocal({ ...cur!.start!, y, mo, d });
            if (local.zoneUnknown) sawUnknownZone = true;
            events.push({
              // The id is keyed on the SOURCE date, so re-importing the file
              // produces the same ids no matter where it is opened.
              id: icsEventId(cur!.uid || title, srcDate, i),
              title,
              date: local.date,
              // All-day events get no time. Google's importer defaults to
              // 12:00 for these; here an all-day event genuinely has no time
              // and the calendar renders it as such.
              ...(local.allDay ? {} : { time: local.time }),
              description: descBits.join('\n') || 'Imported from a calendar file',
              category: 'Appointment',
              remindMe: true,
              // Same rule as the Google importer: a calendar file has no idea
              // who lives in this house, so read the person out of the title.
              // See utils/eventMemberMatch.ts.
              memberIds,
            });
          });
          if (sawUnknownZone) unknownZone++;
        }
      }
      inEvent = false;
      cur = null;
      continue;
    }
    if (!inEvent || !cur) continue;

    const prop = parseIcsLine(line);
    if (!prop) continue;
    switch (prop.name) {
      case 'UID': cur.uid = prop.value.trim(); break;
      case 'SUMMARY': cur.summary = unescapeIcsText(prop.value); break;
      case 'DESCRIPTION': cur.description = unescapeIcsText(prop.value); break;
      case 'LOCATION': cur.location = unescapeIcsText(prop.value); break;
      case 'STATUS': cur.status = prop.value.trim(); break;
      case 'RRULE': cur.rrule = prop.value.trim(); break;
      case 'DTSTART':
        cur.start = parseIcsRaw(prop.value, prop.params) || undefined;
        break;
      case 'EXDATE':
        // May carry several comma-separated dates on one line. Stored as
        // SOURCE dates so they line up with the expanded occurrences.
        for (const piece of prop.value.split(',')) {
          const raw = parseIcsRaw(piece, prop.params);
          if (raw) cur.exdates.add(rawDateKey(raw));
        }
        break;
      default: break;
    }
  }

  if (noStart) warnings.push(`${noStart} ${noStart === 1 ? 'entry had' : 'entries had'} no start date and could not be imported.`);
  if (cancelled) warnings.push(`${cancelled} cancelled ${cancelled === 1 ? 'event was' : 'events were'} left out.`);
  if (unknownZone) warnings.push(`${unknownZone} ${unknownZone === 1 ? 'event uses' : 'events use'} a time zone this device doesn’t recognise — the times were kept exactly as written.`);
  if (partialRules) warnings.push(`${partialRules} repeating ${partialRules === 1 ? 'event has' : 'events have'} a repeat pattern too complex to read fully — check those dates.`);

  return { events, warnings, sourceCount };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Fold a content line at 75 octets, as the spec requires. */
/* RFC 5545 folds at 75 OCTETS, not 75 JavaScript characters — and the two are
 * different for exactly the text a family calendar is full of. A German umlaut
 * is two bytes; an emoji is four bytes AND two JS characters, so slicing by
 * index can cut a surrogate pair in half and produce a lone surrogate that no
 * calendar can decode. "🎂 Shyam's Birthday" is the ordinary case here, not a
 * contrived one — this app writes that title itself.
 *
 * Identical implementation to server/calendarPublish.mjs's foldLine (the
 * subscribable feed), so a title exported to a file and the same title served
 * over the feed fold the same way. */
const utf8Len = (s: string): number => new TextEncoder().encode(s).length;

function foldLine(line: string): string {
  if (utf8Len(line) <= 75) return line;
  const out: string[] = [];
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

const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

/**
 * Write Teluva events as an .ics file, for importing into Apple Calendar,
 * Outlook or anything else.
 *
 * Times are written as FLOATING (no zone, no Z) because that is what they
 * actually are here: the app stores "15:00 on this date" with no zone attached,
 * and stamping a zone onto it would be inventing information. A floating time
 * shows as 15:00 in whatever calendar reads it, which is what the user typed.
 */
export function buildIcs(events: readonly CalendarEvent[], calendarName = 'Teluva', now = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Teluva//Family Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const ev of events) {
    if (!ev?.date) continue;
    const ymd = ev.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${(ev.id || ymd).replace(/[^A-Za-z0-9._@-]/g, '')}@teluva`);
    lines.push(`DTSTAMP:${stamp(now)}`);
    if (ev.time && /^\d{2}:\d{2}$/.test(ev.time)) {
      const [h, m] = ev.time.split(':');
      lines.push(`DTSTART:${ymd}T${h}${m}00`);
      // One hour is a guess, but an event with no end at all is rendered as a
      // zero-length sliver in some calendars and dropped by others.
      const end = new Date(2000, 0, 1, Number(h), Number(m));
      end.setHours(end.getHours() + 1);
      const sameDay = end.getDate() === 1;
      const endYmd = sameDay ? ymd : nextDay(ev.date);
      lines.push(`DTEND:${endYmd}T${pad(end.getHours())}${pad(end.getMinutes())}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(ev.date)}`);
    }
    lines.push(foldLine(`SUMMARY:${escapeIcsText(ev.title || 'Appointment')}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(ev.description)}`));
    lines.push(`CATEGORIES:${escapeIcsText(ev.category || 'Other')}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}
