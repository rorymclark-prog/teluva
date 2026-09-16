import assert from 'node:assert/strict';
import { buildLifeTimeline, filterLifeTimeline } from './lifeTimeline';
import { buildHealthTimeline } from './healthTimeline';
import { buildFamilyTimeline } from './familyTimeline';
import { memberAppointments } from './memberAppointments';
import { googleEventsToCalendarEvents } from './googleCalendarImport';
import { isMedicalCalendarEvent } from './medicalCalendarEvent';
import { fitTimelineChapters, lifeTimelineChapters, timelineChapters, timelineYears } from './visualTimeline';
import type { CalendarEvent, FamilyMember } from '../types';
import type { FamilyTimelineItem } from './familyTimeline';
const now = new Date(2026, 8, 16);
const adult: FamilyMember = { id: 'adult', name: 'Alex Example', birthdate: '1975-03-12', role: 'Parent', avatarColor: '', clothingSizes: {}, documents: [] };
const child: FamilyMember = { ...adult, id: 'child', name: 'Sam Example', birthdate: '2015-06-01', role: 'Child' };
const members = [adult, child];
const names = ['Big shopping: Alex', 'Alex picks up Sam', 'Dinner with Alex', 'Parents evening', 'Dentist — Alex', 'Alex Orthopädie', 'Dr Steiner — Alex'];
const events: CalendarEvent[] = names.map((title, index) => ({ id: `gcal-${index}`, title, date: `2026-09-${String(index + 1).padStart(2, '0')}`, category: 'Appointment', memberIds: ['adult'], remindMe: false }));
const before = JSON.stringify(events);
const result = buildLifeTimeline({ members, events, entries: [], now });
const all = (r: typeof result) => [...r.upcoming, ...r.years.flatMap(y => y.items), ...r.undated];
const medical = all(filterLifeTimeline(result, { category: 'medical' }));
assert.deepEqual(medical.map(i => i.title).sort(), names.slice(4).sort(), 'legacy shopping/pickup imports never become clinical history');
assert.equal(memberAppointments(events, adult.id, '2026-01-01', members).upcoming.length, 3, 'profile and life timeline agree');
const health = buildHealthTimeline({ member: adult, members, events, now });
assert.equal(health.counts.total, 3);
assert.equal(health.years.flatMap(y => y.items).length, 3);
const family = buildFamilyTimeline({ members, events, now });
assert.ok(family.some(i => i.title === names[0] && i.category === 'calendar'), 'ordinary imported events remain in the calendar projection');
assert.equal(JSON.stringify(events), before, 'correcting the projection never rewrites source data');
const fresh = googleEventsToCalendarEvents(names.map((summary, index) => ({ id: `new-${index}`, summary, start: { date: '2026-09-20' } })), [], members);
assert.deepEqual(fresh.map(e => e.category), names.map((_, i) => i < 4 ? 'Other' : 'Appointment'), 'new imports do not repeat the blanket classification');
assert.ok(isMedicalCalendarEvent({ ...events[0], id: 'native-appointment', title: 'Annual visit' }), 'an explicitly created native appointment retains its category');
assert.ok(!isMedicalCalendarEvent({ ...events[4], category: 'Other' }), 'a user category override is respected');
assert.ok(isMedicalCalendarEvent({ ...events[0], description: 'Appointment with the dentist' }), 'medical context in an imported description is retained');

const project = (items: ReturnType<typeof all>): FamilyTimelineItem[] => items.map(i => ({ id: i.id, date: i.date, title: i.title, category: 'memories', memberIds: i.memberIds, sourceLabel: 'Test' }));
for (const person of [undefined, adult, child]) {
  const scoped = filterLifeTimeline(result, { member: person, includeFamily: true });
  const domain = timelineYears(project(all(scoped)));
  assert.equal(domain[0], person === child ? 2015 : 1975, 'domain follows person, before category filtering');
  for (const category of ['medical', 'milestone', 'school', 'home'] as const) {
    const visible = project(all(filterLifeTimeline(scoped, { category })));
    for (const slots of [1, 2, 5, 10, 52]) {
      const fitted = lifeTimelineChapters(visible, slots, 2026, domain[0]);
      assert.deepEqual(fitted.flatMap(c => c.items.map(i => i.id)).sort(), visible.filter(i => i.date).map(i => i.id).sort(), 'every matching record remains reachable');
      assert.ok(fitted.every(c => c.index >= 0 && c.index < slots));
      if (category === 'medical' && visible.length && slots > 1) assert.equal(fitted[0].index, slots - 1, 'recent care stays near the end of the lifetime after birth is filtered away');
    }
  }
}
const dense: FamilyTimelineItem[] = Array.from({ length: 366 }, (_, day) => ({ id: `d${day}`, title: `Day ${day}`, date: new Date(Date.UTC(2024, 0, day + 1)).toISOString().slice(0, 10), category: 'memories', memberIds: [], sourceLabel: 'Test' }));
for (const scale of ['year', 'month'] as const) {
  const chapters = timelineChapters(dense, 2024, 1, scale);
  const periods = scale === 'year' ? 12 : 29;
  for (const slots of [2, 3, 5, periods]) {
    const fit = fitTimelineChapters(chapters, periods, slots);
    assert.equal(new Set(fit.flatMap(c => c.items.map(i => i.id))).size, scale === 'year' ? 366 : 29, 'fitting a dense year or leap-month loses no events');
    assert.ok(fit.length <= slots);
    assert.ok(fit.every(c => c.index >= 0 && c.index < slots));
  }
}
assert.equal(lifeTimelineChapters([], 2, 2026, 1975).length, 0, 'empty search is a valid empty projection');
console.log('timelineRegressions: legacy/new imports, ownership, source preservation, person/category/width matrix and dense fit coverage passed');

const everyYear = Array.from({ length: 52 }, (_, index) => ({ ...dense[0], id: `year${index}`, date: `${1975 + index}-01-01` }));
assert.equal(lifeTimelineChapters(everyYear, 52, 2026, 1975).length, 52, 'scroll mode keeps all 52 year buckets distinct, without floating-point collisions');
