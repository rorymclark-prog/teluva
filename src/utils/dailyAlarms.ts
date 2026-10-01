/* Automatic daily alarms — the client half (server half: server/alarmFeed.mjs).
 *
 * A Shortcuts "Time of Day" automation on the iPhone fetches a private Teluva
 * link every morning and turns each time in it into a Clock alarm. The person
 * builds the Shortcut once (Apple gives a web page no way to install one), so
 * most of this file is the recipe, kept as data so the copy and the tests
 * agree on it, and the honest description of whether the automation is running.
 *
 * WHY "LAST RAN" IS THE FEATURE
 * -----------------------------
 * Nobody signs in to a Shortcut, and iOS shows nothing when an automation
 * silently stops (phone off at that hour, Shortcut deleted, iOS update reset
 * it). The only evidence it works is the server seeing the fetch, so the setup
 * screen shows when it last ran — and says so when it is overdue, because a
 * safety net that has quietly stopped is worse than none: it is still trusted.
 */

export const DAILY_SHORTCUT_NAME = 'Teluva Daily Alarms';
/** Recommended run time. Any alarm in the next 24 h is covered, so early is best. */
export const AUTOMATION_TIME = '05:00';
/** Text the alarms carry. The feed sends times only, so the label cannot name the appointment. */
export const ALARM_LABEL = 'Teluva appointment';

export interface LeadOption { minutes: 0 | 15 | 30 | 60 | 120; label: string }
export const DAILY_LEADS: readonly LeadOption[] = [
  { minutes: 0, label: 'At the time' },
  { minutes: 15, label: '15 min before' },
  { minutes: 30, label: '30 min before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
];
export const DEFAULT_DAILY_LEAD = 60;

export type DailyScope = 'important' | 'all';
export const DAILY_SCOPES: readonly { id: DailyScope; label: string; hint: string }[] = [
  { id: 'important', label: 'Important ones', hint: 'Medical appointments, and anything you have marked important.' },
  { id: 'all', label: 'Every appointment with a time', hint: 'Anything on the calendar that has a time. All-day events never ring.' },
];

/** What /api/alarm-feed/list returns per link. */
export interface AlarmLink {
  token: string;
  path: string;
  leadMinutes: number;
  scope: DailyScope;
  createdAt: string;
  lastFetchedAt: string | null;
  fetchCount: number;
  lastAlarmCount: number | null;
}

/** The address the Shortcut fetches. `now` is appended by the Shortcut itself. */
export function alarmFeedUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`;
}

/** The text typed after the link in the Shortcut's URL field. */
export const NOW_QUERY = '?now=';
/** The Format Date string that produces what the server reads as the phone's clock. */
export const NOW_FORMAT = 'yyyyMMddHHmm';

export const SHORTCUT_STEPS: readonly string[] = [
  `Open the Shortcuts app, tap +, and name it ${DAILY_SHORTCUT_NAME}.`,
  'Add the action Current Date.',
  `Add Format Date. Set Date Format to Custom, and Format String to ${NOW_FORMAT}.`,
  `Add Get Contents of URL. Paste the link, then type ${NOW_QUERY} straight after it and tap the Formatted Date variable.`,
  'Add Get Dictionary from Input.',
  'Add Get Dictionary Value. Get Value for alarms in Dictionary.',
  'Add Repeat with Each, and give it the Dictionary Value.',
  `Inside the repeat, add Get Dates from Input (input: Repeat Item), then Create Alarm. Set its time to Dates, Repeat off, and the label to ${ALARM_LABEL}.`,
  'Tap Done.',
];

export const AUTOMATION_STEPS: readonly string[] = [
  'In Shortcuts, open the Automation tab and tap +.',
  `Choose Time of Day, set ${AUTOMATION_TIME}, and choose Daily.`,
  `Choose Run Shortcut → ${DAILY_SHORTCUT_NAME}.`,
  'Turn on Run Immediately (so it needs no tap), and turn Notify When Run off.',
];

/** Opens Shortcuts and runs the daily shortcut once, for the first test. */
export function runDailyShortcutUrl(): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(DAILY_SHORTCUT_NAME)}`;
}

export type RunHealth = 'never' | 'ok' | 'overdue';

/** A daily run is "overdue" once more than 36 h have passed: a missed morning, not a slow one. */
export const OVERDUE_MS = 36 * 60 * 60 * 1000;

export function runHealth(lastFetchedAt: string | null, now: Date = new Date()): RunHealth {
  if (!lastFetchedAt) return 'never';
  const t = Date.parse(lastFetchedAt);
  if (!Number.isFinite(t)) return 'never';
  return now.getTime() - t > OVERDUE_MS ? 'overdue' : 'ok';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "today at 05:02 — set 2 alarms", "yesterday at 05:01 — nothing to set", … */
export function describeLastRun(
  lastFetchedAt: string | null,
  alarmCount: number | null,
  now: Date = new Date(),
): string {
  const health = runHealth(lastFetchedAt, now);
  if (health === 'never' || !lastFetchedAt) return "It hasn't run yet.";
  const t = new Date(lastFetchedAt);
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((dayOf(now) - dayOf(t)) / 86_400_000);
  const when = diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : `${diff} days ago`;
  const did = alarmCount == null ? '' : alarmCount === 0 ? ' — nothing to set' : ` — set ${alarmCount} alarm${alarmCount === 1 ? '' : 's'}`;
  return `Last ran ${when} at ${pad(t.getHours())}:${pad(t.getMinutes())}${did}.`;
}

export function leadLabel(minutes: number): string {
  return DAILY_LEADS.find((l) => l.minutes === minutes)?.label ?? `${minutes} min before`;
}
