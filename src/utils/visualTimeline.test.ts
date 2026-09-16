import assert from 'node:assert/strict';
import type { FamilyTimelineItem } from './familyTimeline';
import { lifeTimelineChapters, preferredTimelineYear, timelineChapters, timelineRange, timelineYears } from './visualTimeline';
const event = (id: string, date: string): FamilyTimelineItem => ({ id, date, title: id, category: 'memories', memberIds: [], sourceLabel: 'Memory' });
const records = [event('leap-day', '2024-02-29'), event('same-day', '2024-02-29'), event('next-month', '2024-03-01'), event('unknown', ''), event('school-year', '2024'), event('old', '1988-06-01')];
const chapters = timelineChapters(records, 2024, 1, 'year');
assert.deepEqual(chapters.map(c => c.items.map(i => i.id)), [['leap-day', 'same-day'], ['next-month']], 'exact dates are grouped chronologically; school years and undated entries never receive invented dates');
assert.deepEqual(timelineChapters(records, 2024, 1, 'month').map(c => [c.index, c.items.length]), [[28, 2]], 'leap-day duplicates remain accessible in one day chapter');
assert.equal(timelineChapters(records, 2025, 1, 'year').length, 0);
assert.equal(preferredTimelineYear(records, new Date(2026, 8, 16)), 2024);
assert.equal(preferredTimelineYear([...records, event('future', '2030-01-01')], new Date(2026, 8, 16)), 2024, 'future reminders must not displace the most recent past year');
assert.deepEqual(timelineYears(records), [1988, 2024]);
const home = { ...event('home', '2020-03-01'), endDate: '2023-08-31' };
assert.deepEqual(timelineRange(home, 2022, 0, 'year'), { start: 0, end: 1 }, 'residences remain visible between move-in and move-out years');
assert.equal(timelineRange(home, 2024, 0, 'year'), null);
assert.equal(timelineRange({ ...home, endDate: undefined }, 2022, 0, 'year'), null, 'missing move-out dates must not imply an ongoing residence');
assert.equal(timelineRange({ ...home, endDate: '2019-01-01' }, 2022, 0, 'year'), null);
assert.equal(timelineRange({ ...home, endDate: '2023-08-31' }, 2023, 8, 'month'), null);
console.log('visualTimeline.test.ts: date precision, dense chapters, leap days, year selection and residence clipping passed');

const life = lifeTimelineChapters(records, 4, 2026);
assert.deepEqual(life.flatMap(chapter => chapter.items.map(item => item.id)).sort(), records.filter(item => item.date).map(item => item.id).sort(), 'life retains every dated record across decades, including year-only records');
assert.ok(life[0].index < life.at(-1)!.index, 'old and recent chapters retain their order across the full span');
assert.equal(lifeTimelineChapters([event('birth', '1988-06-01')], 4, 2026)[0].index, 0, 'a birth-only profile still has a lifespan extending through the present');
assert.equal(lifeTimelineChapters([event('unknown', '')], 4).length, 0);
const dense = Array.from({ length: 120 }, (_, i) => event(String(i), `${1900 + i}-01-01`));
for (const slots of [1, 2, 8]) {
  const grouped = lifeTimelineChapters(dense, slots, 2026);
  assert.ok(grouped.length <= slots);
  assert.equal(new Set(grouped.flatMap(chapter => chapter.items.map(item => item.id))).size, 120, 'responsive grouping must not discard records');
}
const lifetimeBand = timelineRange(home, 2026, 0, 'life', [1988, 2026]);
assert.ok(lifetimeBand && lifetimeBand.start > 0 && lifetimeBand.end < 1 && lifetimeBand.end > lifetimeBand.start, 'life residence bands use the entire lifespan');
