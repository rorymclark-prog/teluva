/* Automatic daily alarms — the recipe must match what the server reads, and the
   "is it running?" message must never say healthy about a stopped automation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTOMATION_STEPS, DAILY_LEADS, DAILY_SCOPES, DAILY_SHORTCUT_NAME, DEFAULT_DAILY_LEAD, NOW_FORMAT, NOW_QUERY,
  OVERDUE_MS, SHORTCUT_STEPS, alarmFeedUrl, describeLastRun, leadLabel, runDailyShortcutUrl, runHealth,
} from './dailyAlarms';

let n = 0;
const ok = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };

// --- the client and server must agree ---------------------------------------
const server = readFileSync(new URL('../../server/alarmFeed.mjs', import.meta.url), 'utf8');
const serverLeads = /ALARM_LEAD_MINUTES = \[([^\]]*)\]/.exec(server)![1].split(',').map((s) => Number(s.trim()));
ok('the lead choices are exactly the server\'s', JSON.stringify(DAILY_LEADS.map((l) => l.minutes)) === JSON.stringify(serverLeads));
ok('the default lead is one the server accepts', serverLeads.includes(DEFAULT_DAILY_LEAD));
const serverScopes = /ALARM_SCOPES = \[([^\]]*)\]/.exec(server)![1].split(',').map((s) => s.trim().replace(/'/g, ''));
ok('the scopes are exactly the server\'s', JSON.stringify(DAILY_SCOPES.map((s) => s.id)) === JSON.stringify(serverScopes));
ok('the clock format is the 12-digit stamp the server parses', NOW_FORMAT === 'yyyyMMddHHmm' && NOW_FORMAT.length === 12 && /\(\\d\{4\}\)\(\\d\{2\}\)\(\\d\{2\}\)\(\\d\{2\}\)\(\\d\{2\}\)/.test(server));
ok('the query name is the one the route reads', NOW_QUERY === '?now=' && server.includes('req.query.now') === false /* read in server.js */);
const serverJs = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
ok('server.js reads req.query.now for /alarms', /app\.get\('\/alarms\/:token'[\s\S]*?trustedPhoneNow\(req\.query\.now\)/.test(serverJs));
ok('the feed is read as {alarms: [...]}, the key the recipe names', /res\.json\(\{ status: 'ok', alarms \}\)/.test(serverJs)
  && SHORTCUT_STEPS.some((s) => s.includes('alarms in Dictionary')));

// --- the recipe --------------------------------------------------------------
ok('the recipe names the shortcut the automation runs', SHORTCUT_STEPS[0].includes(DAILY_SHORTCUT_NAME)
  && AUTOMATION_STEPS.some((s) => s.includes(DAILY_SHORTCUT_NAME)));
ok('the recipe tells the person to turn Run Immediately on', AUTOMATION_STEPS.some((s) => s.includes('Run Immediately')));
ok('the recipe sets Repeat off (a repeating alarm would ring every day)', SHORTCUT_STEPS.some((s) => s.includes('Repeat off')));
ok('the run URL targets the daily shortcut by name', runDailyShortcutUrl() === 'shortcuts://run-shortcut?name=Teluva%20Daily%20Alarms');

// --- the address -------------------------------------------------------------
ok('the link joins origin and path', alarmFeedUrl('https://teluva.example', '/alarms/abc') === 'https://teluva.example/alarms/abc');
ok('a trailing slash on the origin does not double up', alarmFeedUrl('https://teluva.example/', '/alarms/abc') === 'https://teluva.example/alarms/abc');

// --- is it running? ----------------------------------------------------------
const now = new Date(2026, 9, 2, 9, 0);          // 2 Oct 2026, 09:00 local
const iso = (d: Date) => d.toISOString();
ok('never fetched reads as never', runHealth(null, now) === 'never');
ok('garbage reads as never', runHealth('nonsense', now) === 'never');
ok('this morning is ok', runHealth(iso(new Date(2026, 9, 2, 5, 2)), now) === 'ok');
ok('yesterday morning is still ok (today\'s run may not have happened yet)', runHealth(iso(new Date(2026, 9, 1, 5, 2)), now) === 'ok');
ok('two mornings ago is overdue', runHealth(iso(new Date(now.getTime() - OVERDUE_MS - 60_000)), now) === 'overdue');
ok('the overdue line is exactly 36 h', OVERDUE_MS === 36 * 3600 * 1000);

ok('never-run text is honest', describeLastRun(null, null, now) === "It hasn't run yet.");
ok('today with alarms', describeLastRun(iso(new Date(2026, 9, 2, 5, 2)), 2, now) === 'Last ran today at 05:02 — set 2 alarms.');
ok('singular', describeLastRun(iso(new Date(2026, 9, 2, 5, 2)), 1, now) === 'Last ran today at 05:02 — set 1 alarm.');
ok('nothing to set', describeLastRun(iso(new Date(2026, 9, 1, 5, 1)), 0, now) === 'Last ran yesterday at 05:01 — nothing to set.');
ok('older run says how long ago', describeLastRun(iso(new Date(2026, 8, 29, 5, 0)), 3, now).startsWith('Last ran 3 days ago at 05:00'));
ok('unknown count says nothing about alarms', describeLastRun(iso(new Date(2026, 9, 2, 5, 2)), null, now) === 'Last ran today at 05:02.');
ok('lead labels come from the table', leadLabel(60) === '1 hour before' && leadLabel(0) === 'At the time' && leadLabel(45) === '45 min before');

console.log(`dailyAlarms.test.ts: ${n} assertions passed.`);
