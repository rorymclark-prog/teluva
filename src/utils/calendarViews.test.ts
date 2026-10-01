import assert from 'node:assert/strict';
import { calendarViewDates, navigateCalendarDate } from './calendarViews';
assert.deepEqual(calendarViewDates('2026-10-01', 'day'), ['2026-10-01']);
assert.deepEqual(calendarViewDates('2026-10-01', 'week'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
assert.equal(navigateCalendarDate('2026-12-31', 'day', 1), '2027-01-01');
assert.equal(navigateCalendarDate('2026-10-25', 'week', 1), '2026-11-01');
assert.equal(navigateCalendarDate('2026-01-31', 'month', 1), '2026-02-01');
assert.equal(navigateCalendarDate('2026-10-01', 'week', -1), '2026-09-24');
console.log('calendarViews: day/week navigation, month and year boundaries OK');
