/* "Set alarm" — the 24-hour rule is the whole correctness story, so it is what
   is tested hardest. A Clock alarm has a time of day, not a date: asking for one
   more than a day out rings at the wrong moment and looks like it worked. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALARM_LEADS, ALARM_SHORTCUT_NAME, MAX_AHEAD_MS, alarmAvailability, alarmInstant, describeAlarmTime,
  eventStart, shortcutInput, shortcutUrl, testAlarmTime,
} from './appointmentAlarm';

let n = 0;
const ok = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); n++; };
const lead = (id: string) => ALARM_LEADS.find((l) => l.id === id)!;
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

// --- reading the appointment ------------------------------------------------
ok('date + time become a local moment', eventStart({ date: '2026-10-02', time: '14:00' })!.getTime() === at(2026, 10, 2, 14).getTime());
ok('single-digit hour is accepted', eventStart({ date: '2026-10-02', time: '9:05' })!.getTime() === at(2026, 10, 2, 9, 5).getTime());
ok('no time = no start (never a guessed hour)', eventStart({ date: '2026-10-02' }) === null);
ok('garbage time = no start', eventStart({ date: '2026-10-02', time: '25:99' }) === null);
ok('garbage date = no start', eventStart({ date: 'tomorrow', time: '10:00' }) === null);

// --- the leads ---------------------------------------------------------------
const dentist = { date: '2026-10-02', time: '14:00' };
ok('1 hour before is 13:00', alarmInstant(dentist, lead('60'))!.getTime() === at(2026, 10, 2, 13).getTime());
ok('at the time is the start itself', alarmInstant(dentist, lead('at'))!.getTime() === at(2026, 10, 2, 14).getTime());
ok('the morning option is 07:00 on the day', alarmInstant(dentist, lead('morning'))!.getTime() === at(2026, 10, 2, 7).getTime());
ok('an all-day event still gets a morning alarm', alarmInstant({ date: '2026-10-02' }, lead('morning'))!.getTime() === at(2026, 10, 2, 7).getTime());
ok('but no "15 minutes before" — there is no time to count back from', alarmInstant({ date: '2026-10-02' }, lead('15')) === null);

// --- THE 24 HOUR RULE ----------------------------------------------------------
const now = at(2026, 10, 2, 9, 0);
ok('an alarm a few hours ahead is allowed', alarmAvailability(dentist, lead('60'), now).status === 'ok');
ok('an alarm 30 s away has effectively passed (minute-granular)',
  alarmAvailability(dentist, lead('at'), new Date(at(2026, 10, 2, 14).getTime() - 30_000)).status === 'past');
ok('an alarm already gone is "past"', alarmAvailability(dentist, lead('60'), at(2026, 10, 2, 13, 30)).status === 'past');

const farNow = at(2026, 9, 30, 9, 0);
const far = alarmAvailability(dentist, lead('60'), farNow);
ok('two days out is refused, not quietly set for the wrong day', far.status === 'too-far');
ok('and says when it opens: exactly the window before the alarm',
  far.status === 'too-far' && far.opensAt.getTime() === at(2026, 10, 2, 13).getTime() - MAX_AHEAD_MS);
ok('the window is under a full day', MAX_AHEAD_MS < 24 * 60 * 60 * 1000);
ok('exactly 24 h ahead is refused — "the next 14:00" is ambiguous there',
  alarmAvailability(dentist, lead('at'), new Date(at(2026, 10, 2, 14).getTime() - 24 * 3600 * 1000)).status === 'too-far');
ok('23 h 58 min ahead is allowed',
  alarmAvailability(dentist, lead('at'), new Date(at(2026, 10, 2, 14).getTime() - (24 * 3600 - 120) * 1000)).status === 'ok');
ok('a needs-a-time row is reported, not hidden', alarmAvailability({ date: '2026-10-02' }, lead('30'), now).status === 'no-time');

// The property that matters: whenever it says ok, the Clock's "next occurrence of
// this time of day" IS the moment we meant.
for (let mins = 2; mins < 24 * 60; mins += 37) {
  const nowX = new Date(at(2026, 10, 2, 14).getTime() - mins * 60_000);
  const a = alarmAvailability(dentist, lead('at'), nowX);
  if (a.status !== 'ok') continue;
  let next = new Date(nowX.getFullYear(), nowX.getMonth(), nowX.getDate(), a.at.getHours(), a.at.getMinutes());
  if (next.getTime() <= nowX.getTime()) next = new Date(next.getTime() + 24 * 3600 * 1000);
  assert.equal(next.getTime(), a.at.getTime(), `Clock would ring at the wrong time when ${mins} min ahead`);
}
n++;

// --- what is handed to Shortcuts -------------------------------------------------
ok('input is local wall-clock, zero-padded', shortcutInput(at(2026, 3, 4, 7, 5)) === '2026-03-04 07:05');
const url = shortcutUrl(at(2026, 10, 2, 13, 0));
ok('the address runs the named shortcut', url.startsWith('shortcuts://run-shortcut?name=Teluva%20Alarm&input=text&text='));
ok('the time is URL-encoded (space and colon)', url.endsWith('2026-10-02%2013%3A00'));
ok('the shortcut name is the one the setup text tells people to type', ALARM_SHORTCUT_NAME === 'Teluva Alarm');
const t = testAlarmTime(new Date(2026, 9, 2, 9, 0, 59, 500));
ok('the test alarm is at least two FULL minutes out', t.getTime() - new Date(2026, 9, 2, 9, 0, 59, 500).getTime() >= 2 * 60_000);
ok('and lands on a whole minute', t.getSeconds() === 0 && t.getMilliseconds() === 0);

ok('times read plainly', describeAlarmTime(at(2026, 10, 2, 13), at(2026, 10, 2, 9)) === '13:00 today');
ok('tomorrow reads as tomorrow', describeAlarmTime(at(2026, 10, 3, 6, 30), at(2026, 10, 2, 22)) === '06:30 tomorrow');

// --- wiring -------------------------------------------------------------------------
const comp = readFileSync('src/components/AppointmentAlarm.tsx', 'utf8');
const cal = readFileSync('src/components/FamilyCalendar.tsx', 'utf8');
const member = readFileSync('src/components/MemberAppointments.tsx', 'utf8');
ok('the calendar card carries the button', /<AppointmentAlarm event=\{ev\} today=\{realTodayStr\} \/>/.test(cal));
ok('the Check-ups list carries it, for upcoming rows only', /\{!dim && <AppointmentAlarm event=\{ev\} today=\{today\} \/>\}/.test(member));
ok('the button is iPhone/iPad only — no dead button on a desktop', /!isAppleTouch\(\)/.test(comp));
ok('past events get no button', /event\.date < today\) return null/.test(comp));
ok('the alarm link is the shortcut address, and only a tap follows it',
  /href=\{shortcutUrl\(/.test(comp) && !/location\.(href|assign|replace)/.test(comp));
ok('the sheet is portalled to <body> (backdrop-filter ancestors trap fixed overlays)',
  /createPortal\(/.test(comp) && /document\.body,\s*\n\s*\)/.test(comp));
ok('it explains the 24-hour limit in words', /only be set up to 24 hours ahead/.test(comp));
ok('it never claims success it cannot see — it says to check the Clock app', /Open the <b>Clock<\/b> app/.test(comp));
ok('setup is remembered per device, not in the family data', /localStorage/.test(readFileSync('src/utils/appointmentAlarm.ts', 'utf8')));

console.log(`appointmentAlarm.test.ts: ${n} assertions passed.`);
