// Converting a wall-clock time in a named zone to a real instant.
//
// Shared by the calendar-file importer (a 15:00 appointment written in
// Europe/Vienna) and the birth chart (a birth time written in whatever zone
// the hospital clock was on). Both need the same thing and getting it subtly
// different in two places is how one of them ends up an hour out for half the
// year.
//
// No timezone database is bundled. Intl already has one — the same tzdb the
// operating system ships — and it knows the historical rules, which matters
// here: Austria's DST changed in 1980, South Africa ran DST in the 1940s, and
// a birth chart is precisely the thing that cares.

/**
 * How far ahead of UTC is `timeZone` at this instant, in milliseconds?
 * Obtained by asking Intl to render the instant in that zone and reading the
 * difference back, which is the only way to get DST-aware historical offsets
 * without shipping tzdb.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  // Intl renders midnight as hour "24" in some locale/zone combinations.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    hour, Number(p.minute), Number(p.second),
  );
  return asIfUtc - instant.getTime();
}

/**
 * A wall-clock time in a named zone, as a real instant. Null if the zone is
 * not one this device knows.
 *
 * Two passes: guess that the offset is whatever applies at the naive
 * timestamp, then re-evaluate at the corrected instant. The second pass is
 * what gets times near a DST changeover right — with one pass, 02:30 on a
 * spring-forward morning lands an hour out.
 */
export function wallTimeToInstant(
  y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string,
): Date | null {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    let ts = naive;
    for (let i = 0; i < 2; i++) ts = naive - zoneOffsetMs(new Date(ts), timeZone);
    return new Date(ts);
  } catch {
    return null;
  }
}

/** Is this a time zone this device recognises? */
export function isKnownTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every zone this device knows, for a picker. Falls back to a short list on
 * the rare engine without supportedValuesOf, so the field is never empty.
 */
export function listTimeZones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const all = anyIntl.supportedValuesOf?.('timeZone');
    if (all?.length) return all;
  } catch { /* fall through */ }
  return [
    'Africa/Johannesburg', 'Europe/Vienna', 'Europe/London', 'Europe/Berlin',
    'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Australia/Sydney', 'UTC',
  ];
}

/** The zone this device is currently set to — a sensible default, not a fact. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
