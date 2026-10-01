/* "Set alarm" for an appointment — a real iPhone Clock alarm, not a notification.
 *
 * WHY A CLOCK ALARM
 * -----------------
 * Rory: "an alarm that sounds and forces me to check the phone to turn off …
 * an appointment that may be urgent and I overlooked". A web app on iOS cannot
 * do that itself: Web Push is one banner that silent mode and Focus can swallow,
 * it cannot loop a sound, and Apple's Critical Alerts need a native app plus an
 * entitlement Apple grants case by case. The Clock app's alarms ARE that
 * behaviour — loud through the silent switch, ringing until Stop is tapped — so
 * Teluva hands the time to the Clock app through the one door iOS leaves open:
 * a Shortcut the person creates once ("Teluva Alarm": Get Dates from Input →
 * Create Alarm) and Teluva runs through the shortcuts:// address.
 *
 * THE LIMIT THAT SHAPES EVERYTHING BELOW
 * --------------------------------------
 * A Clock alarm has a TIME OF DAY, not a date. It rings at the next occurrence
 * of that time within 24 hours. Ask for an alarm at 10:00 on Friday while it is
 * Tuesday and the Clock app rings at 10:00 tomorrow — the wrong day, for a
 * "reminder" nobody will question because it was set on purpose. So this only
 * offers an alarm whose moment is less than 24 hours away, says why when it is
 * further, and says when it will become available. Anything else would look
 * like it worked.
 */

export const ALARM_SHORTCUT_NAME = 'Teluva Alarm';

// One minute inside the 24 h edge. At exactly 24 h "the next 10:00" is
// ambiguous between now-ish and a full day away.
export const MAX_AHEAD_MS = 24 * 60 * 60 * 1000 - 60 * 1000;

/** When no time is given (an all-day event), the "morning of" alarm. */
export const MORNING_HOUR = 7;

export type AlarmLead =
  | { id: 'at'; label: string; minutes: 0 }
  | { id: '15' | '30' | '60' | '120'; label: string; minutes: number }
  | { id: 'morning'; label: string; minutes: null };

export const ALARM_LEADS: readonly AlarmLead[] = [
  { id: 'at', label: 'At the time', minutes: 0 },
  { id: '15', label: '15 minutes before', minutes: 15 },
  { id: '30', label: '30 minutes before', minutes: 30 },
  { id: '60', label: '1 hour before', minutes: 60 },
  { id: '120', label: '2 hours before', minutes: 120 },
  { id: 'morning', label: `${MORNING_HOUR}:00 that morning`, minutes: null },
];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** The appointment's own moment in the device's local time, or null if it has no usable time. */
export function eventStart(ev: { date: string; time?: string }): Date | null {
  const d = DATE_RE.exec(ev.date || '');
  const t = TIME_RE.exec((ev.time || '').trim());
  if (!d || !t) return null;
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The moment the alarm would ring for this lead, or null when it can't be worked out. */
export function alarmInstant(ev: { date: string; time?: string }, lead: AlarmLead): Date | null {
  if (lead.id === 'morning') {
    const d = DATE_RE.exec(ev.date || '');
    if (!d) return null;
    const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), MORNING_HOUR, 0, 0, 0);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  const start = eventStart(ev);
  // An all-day event has no "15 minutes before". Refusing is honest; guessing an
  // hour would set an alarm for a moment nobody chose.
  if (!start) return null;
  return new Date(start.getTime() - lead.minutes * 60 * 1000);
}

export type AlarmAvailability =
  | { status: 'ok'; at: Date }
  | { status: 'past'; at: Date }
  | { status: 'too-far'; at: Date; opensAt: Date }
  | { status: 'no-time' };

export function alarmAvailability(
  ev: { date: string; time?: string },
  lead: AlarmLead,
  now: Date = new Date(),
): AlarmAvailability {
  const at = alarmInstant(ev, lead);
  if (!at) return { status: 'no-time' };
  // Strictly after now, with a minute of slack: an alarm is minute-granular, so
  // "now" would ring at this minute's :00 — already gone.
  if (at.getTime() <= now.getTime() + 60 * 1000) return { status: 'past', at };
  if (at.getTime() - now.getTime() >= MAX_AHEAD_MS) {
    return { status: 'too-far', at, opensAt: new Date(at.getTime() - MAX_AHEAD_MS) };
  }
  return { status: 'ok', at };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** What the shortcut receives: local wall-clock, unambiguous to "Get Dates from Input". */
export function shortcutInput(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The address that opens Shortcuts and runs "Teluva Alarm" with the time as its input. */
export function shortcutUrl(at: Date, name: string = ALARM_SHORTCUT_NAME): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(shortcutInput(at))}`;
}

/**
 * A moment for the setup test: at least two FULL minutes out. Alarms are minute
 * granular, so rounding up to the next minute and adding two guarantees there
 * is time to switch to the Clock app and see it listed before it rings.
 */
export function testAlarmTime(now: Date = new Date()): Date {
  const t = new Date(now.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 3);
  return t;
}

/** "13:30 today" / "13:30 tomorrow" / "Fri 13:30" — how the alarm time reads on a button. */
export function describeAlarmTime(at: Date, now: Date = new Date()): string {
  const hhmm = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dayOf(at) - dayOf(now)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return `${hhmm} today`;
  if (diffDays === 1) return `${hhmm} tomorrow`;
  return `${at.toLocaleDateString('en-GB', { weekday: 'short' })} ${hhmm}`;
}

/* ---- per-device memory ------------------------------------------------- */
// localStorage on purpose: whether THIS phone has the shortcut is a fact about
// this phone, and nothing about it belongs in the family's shared data.
const READY_KEY = 'teluva:alarmShortcutReady';
const LEAD_KEY = 'teluva:alarmLead';

export function alarmSetupDone(): boolean {
  try { return localStorage.getItem(READY_KEY) === '1'; } catch { return false; }
}
export function setAlarmSetupDone(done: boolean) {
  try { localStorage.setItem(READY_KEY, done ? '1' : '0'); } catch { /* private mode — asks again next time */ }
}
export function rememberedLead(): AlarmLead {
  try {
    const id = localStorage.getItem(LEAD_KEY);
    return ALARM_LEADS.find((l) => l.id === id) ?? ALARM_LEADS[3];
  } catch { return ALARM_LEADS[3]; }
}
export function rememberLead(lead: AlarmLead) {
  try { localStorage.setItem(LEAD_KEY, lead.id); } catch { /* ignore */ }
}
