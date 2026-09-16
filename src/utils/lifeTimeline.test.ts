import assert from 'node:assert/strict';
import {
  buildLifeTimeline,
  categoryOfEntry,
  countByCategory,
  filterLifeTimeline,
  holidaySummary,
  lifeDateLabel,
  LifeTimelineResult,
  suggestMemberFromTitle,
} from './lifeTimeline';
import { applyTimelineEdits } from './aiApply';
import { CalendarEvent, FamilyMember, ReferralRecord, VaultDocument } from '../types';

const NOW = new Date(2026, 8, 13); // 13 Sep 2026, local

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return { id: 'm1', name: 'Test Person', role: 'Parent', avatarColor: 'bg-blue-500', clothingSizes: {}, documents: [], ...overrides };
}

function referral(overrides: Partial<ReferralRecord> = {}): ReferralRecord {
  return {
    id: 'r1', kind: 'Specialist letter', date: '2026-08-12', reason: 'Fractured left arm',
    providerName: 'AKH Kinderklinik', status: 'done',
    fileName: 'letter.pdf', fileType: 'application/pdf', fileSize: 1000,
    storagePath: 'families/f/vault/abc.pdf', downloadUrl: 'https://files/abc.pdf',
    addedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

function vaultDoc(overrides: Partial<VaultDocument> = {}): VaultDocument {
  return {
    id: 'd1', name: 'Discharge letter', category: 'Medical',
    fileName: 'letter.pdf', fileType: 'application/pdf', fileSize: 1000,
    storagePath: 'families/f/vault/other.pdf', downloadUrl: 'https://files/other.pdf',
    uploadedAt: '2026-09-01',
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: 'e1', title: 'Event', date: '2026-01-01', category: 'Other', remindMe: false, ...overrides };
}

function allItems(r: LifeTimelineResult) {
  return [...r.upcoming, ...r.years.flatMap((y) => y.items), ...r.undated];
}

function assertReconciles(r: LifeTimelineResult, label: string) {
  const c = r.counts;
  assert.equal(c.total, c.upcoming + c.dated + c.undated + c.merged + c.suppressed, `${label}: counts must reconcile`);
  assert.equal(c.dated, r.years.reduce((n, y) => n + y.items.length, 0), `${label}: dated must equal the rows in years`);
}

// --- Legacy entries keep their meaning ------------------------------------
{
  assert.equal(categoryOfEntry({ type: 'Graduation' }), 'school');
  assert.equal(categoryOfEntry({ type: 'Wedding' }), 'milestone');
  assert.equal(categoryOfEntry({}), 'memory', 'an untyped old entry is a memory, as TimelineView always showed it');
  assert.equal(categoryOfEntry({ type: 'Birth', category: 'medical' }), 'medical', 'a category, once set, wins over the old type');
  assert.equal(categoryOfEntry({ category: 'nonsense' as never, type: 'Memory' }), 'memory', 'an off-list category falls back');
}

// --- Mia's fractured arm: the letter appears once, as her medical row ---
{
  const mia = member({ id: 'mia', name: 'Mia', role: 'Child', birthdate: '2024-07-20', referrals: [referral({ storagePath: 'families/f/vault/arm.pdf' })] });
  // The assistant files the SAME Storage object into the vault as well.
  const vaultCopy = vaultDoc({ id: 'd-arm', memberId: 'mia', docDate: '2026-08-12', storagePath: 'families/f/vault/arm.pdf' });
  const r = buildLifeTimeline({ members: [mia], events: [], entries: [], documents: [vaultCopy], now: NOW });
  const medical = allItems(r).filter((i) => i.category === 'medical');
  assert.equal(medical.length, 1, 'one fact, one row: the vault copy of a referral must not show twice');
  assert.equal(medical[0].source, 'health');
  assert.equal(medical[0].title, 'Fractured left arm');
  assert.deepEqual(medical[0].memberIds, ['mia']);
  assert.equal(medical[0].date, '2026-08-12', 'positioned by the date on the letter, not when it was filed');
  assert.equal(medical[0].fileUrl, 'https://files/abc.pdf', 'the letter can be opened from the row');
  assert.equal(r.counts.suppressed, 1);
  assertReconciles(r, 'fractured arm');

  const onHers = filterLifeTimeline(r, { member: mia, includeFamily: true });
  assert.ok(allItems(onHers).some((i) => i.title === 'Fractured left arm'), 'shows on Mia’s own timeline');
  assert.ok(allItems(filterLifeTimeline(r, { category: 'medical' })).length === 1, 'and under the family’s Medical filter');
  assert.equal(allItems(filterLifeTimeline(r, { member: member({ id: 'ben' }) })).length, 0, 'but not on someone else’s');
}

// --- Documents: placed by the printed date, and only with one --------------
{
  const docs = [
    vaultDoc({ id: 'no-date', docDate: undefined }),
    vaultDoc({ id: 'dated', name: 'Matric certificate', category: 'Education', docDate: '2008-12-31', uploadedAt: '2026-09-01' }),
  ];
  const r = buildLifeTimeline({ members: [], events: [], entries: [], documents: docs, now: NOW });
  const rows = allItems(r);
  assert.equal(rows.length, 1, 'a document with no printed date is not placed — uploadedAt must never stand in for it');
  assert.equal(rows[0].date, '2008-12-31');
  assert.equal(r.years[0].year, 2008, 'filed in 2026, happened in 2008');
  assert.equal(rows[0].category, 'school');
  assertReconciles(r, 'documents');
}

// --- A moment that links a document shows it; the document row steps aside --
{
  const r = buildLifeTimeline({
    members: [],
    events: [],
    entries: [{ id: 't1', date: '2026-08-12', title: 'Broke her arm at the playground', category: 'medical', memberIds: ['mia'], docIds: ['d9'] }],
    documents: [vaultDoc({ id: 'd9', docDate: '2026-08-12' })],
    now: NOW,
  });
  const rows = allItems(r);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'entry');
  assert.deepEqual(rows[0].docIds, ['d9']);
  assert.equal(r.counts.suppressed, 1);
  assertReconciles(r, 'linked document');
}

// --- One appointment for two people is one row with both on it ---------------
{
  const a = member({ id: 'a', name: 'Anna' });
  const b = member({ id: 'b', name: 'Ben' });
  const ev = event({ id: 'ap', title: 'Dentist', date: '2026-03-02', category: 'Appointment', memberIds: ['a', 'b'] });
  const r = buildLifeTimeline({ members: [a, b], events: [ev], entries: [], now: NOW });
  const rows = allItems(r).filter((i) => i.healthKind === 'appointment');
  assert.equal(rows.length, 1, 'the family view must not show the same appointment twice');
  assert.deepEqual([...rows[0].memberIds].sort(), ['a', 'b']);
  assert.equal(r.counts.merged, 1);
  assertReconciles(r, 'shared appointment');
}

// --- Undated history is kept; growth is left to the Growth tab ----------------
{
  const m = member({
    medical: { vaccinations: [{ id: 'v1', name: 'MMR' }] },
    growthHistory: [{ id: 'g1', date: '2026-01-01', heightCm: 80 } as never],
  });
  const r = buildLifeTimeline({ members: [m], events: [], entries: [], now: NOW });
  assert.equal(r.undated.length, 1, 'an undated vaccination is bucketed, never dropped');
  assert.equal(r.undated[0].title, 'MMR');
  assert.ok(!allItems(r).some((i) => i.healthKind === 'growth'), 'growth check-ins are measurements, not moments');
  assertReconciles(r, 'undated');
}

// --- Planned things are "coming up"; a trip under way is not -------------------
{
  const r = buildLifeTimeline({
    members: [],
    events: [
      event({ id: 'lisbon', title: 'Lisbon', date: '2026-10-01', endDate: '2026-10-08', category: 'Travel', destination: 'Lisbon, Portugal' }),
      event({ id: 'now', title: 'Graz', date: '2026-09-10', endDate: '2026-09-15', category: 'Travel' }),
      event({ id: 'school', title: 'Parents evening', date: '2026-02-01', category: 'School' }),
      // What the assistant files for every passport it reads: Travel, one day, nowhere to go.
      event({ id: 'passport', title: "Ben's UK Passport Expires", date: '2027-03-01', category: 'Travel' }),
      event({ id: 'day', title: 'Bratislava', date: '2026-05-02', category: 'Travel', destination: 'Bratislava' }),
    ],
    entries: [{ id: 'fut', date: '2027-01-01', title: 'Big move', category: 'home', datePrecision: 'year' }],
    now: NOW,
  });
  assert.deepEqual(r.upcoming.map((i) => i.sourceId), ['lisbon', 'fut'], 'a passport expiry reminder is not a coming-up holiday');
  assert.ok(allItems(r).some((i) => i.sourceId === 'day'), 'a day trip somewhere is still a trip');
  assert.equal(r.years[0].items[0].sourceId, 'now', 'a trip that has started is placed, not listed as coming up');
  assert.equal(r.upcoming[0].endDate, '2026-10-08');
  assert.ok(!allItems(r).some((i) => i.sourceId === 'school'), 'routine school events are calendar business, not life moments');
  assertReconciles(r, 'upcoming');
}

// --- Business spaces: milestones and work, nothing medical ----------------------
{
  const employee = member({ id: 'e', name: 'Employee', birthdate: '1990-01-01', referrals: [referral()] });
  const r = buildLifeTimeline({
    members: [employee],
    events: [event({ id: 'ap', title: 'Employee physio', date: '2026-02-02', category: 'Appointment', memberIds: ['e'] })],
    entries: [
      // Typed or filed by the assistant: a moment is still health, whoever wrote it.
      { id: 'op', date: '2026-03-03', title: 'Employee knee surgery', category: 'medical', memberIds: ['e'] },
      { id: 'office', date: '2026-04-01', title: 'Moved into the new office', category: 'home' },
    ],
    documents: [vaultDoc({ id: 'sick', docDate: '2026-02-02', memberId: 'e' })],
    milestones: [{ id: 'b1', title: 'First customer', date: '2025-05-05', kind: 'First customer' }],
    isBusinessSpace: true,
    now: NOW,
  });
  const rows = allItems(r);
  assert.ok(!rows.some((i) => i.category === 'medical'), 'an employee’s health must never reach the business timeline');
  assert.ok(!rows.some((i) => i.source === 'birth'), 'nor their birthday');
  assert.deepEqual(rows.map((i) => i.title).sort(), ['First customer', 'Moved into the new office'], 'a typed medical moment is kept off too; other moments stay');
  assert.ok(r.counts.suppressed >= 1, 'the kept-off moment is counted, not lost');
  assert.equal(rows.find((i) => i.title === 'First customer')?.category, 'work');
  assertReconciles(r, 'business');

  const family = buildLifeTimeline({ members: [], events: [], entries: [], milestones: [{ id: 'b1', title: 'First customer', date: '2025-05-05', kind: 'Other' }], now: NOW });
  assert.equal(allItems(family).length, 0, 'business milestones belong to the business space only');
}

// --- A person's timeline: their rows, and family rows from their birth on -------
{
  const mia = member({ id: 'mia', name: 'Mia', birthdate: '2024-07-20' });
  const r = buildLifeTimeline({
    members: [mia],
    events: [],
    entries: [
      { id: 'before', date: '2023-03-27', title: 'First trip to Austria', category: 'holiday' },
      { id: 'after', date: '2025-06-01', title: 'Family holiday', category: 'holiday' },
      { id: 'hers', date: '2025-09-01', title: 'First day at crèche', category: 'school', memberIds: ['mia'] },
      { id: 'dads', date: '2025-10-01', title: 'New job', category: 'work', memberIds: ['ben'] },
    ],
    now: NOW,
  });
  const ids = (res: LifeTimelineResult) => allItems(res).map((i) => i.sourceId).sort();
  assert.deepEqual(ids(filterLifeTimeline(r, { member: mia, includeFamily: true })), ['after', 'hers', 'mia'],
    'a family moment from before she was born is not part of her story');
  assert.deepEqual(ids(filterLifeTimeline(r, { member: mia, includeFamily: false })), ['hers', 'mia']);
  assert.equal(countByCategory(r).holiday, 2);
  assert.equal(countByCategory(r).work, 1);
}

// --- Holidays: countries in the order they were first visited --------------------
{
  const r = buildLifeTimeline({
    members: [],
    events: [event({ id: 't', title: 'Romania', date: '2025-04-01', category: 'Travel', destinationCountry: 'ro' as never })],
    entries: [],
    travel: [
      { id: 'x', country: 'Austria', countryCode: 'AT', date: '2023-03-27', source: 'manual' },
      { id: 'y', country: 'Austria', countryCode: 'AT', place: 'Vienna', date: '2024-02-01', source: 'exif', photoUrl: 'https://p/1.jpg', photoStoragePath: 'p/1.jpg' },
    ],
    now: NOW,
  });
  const h = holidaySummary(r);
  assert.equal(h.trips, 3);
  assert.deepEqual(h.countries, ['AT', 'RO']);
  assert.equal(h.firstYear, 2023);
  const vienna = allItems(r).find((i) => i.sourceId === 'y')!;
  assert.equal(vienna.title, 'Vienna, Austria');
  assert.equal(vienna.photos?.[0].url, 'https://p/1.jpg', 'the travel photo comes along');
}

// --- Births and anniversaries are placed without anyone typing them --------------
{
  const r = buildLifeTimeline({
    members: [member({ id: 's', name: 'Mia', birthdate: '2024-07-20', placeOfBirth: 'Vienna' })],
    events: [],
    entries: [],
    anniversaries: [
      { id: 'w', title: 'Our wedding', kind: 'Wedding', date: '05-18', originalYear: 2019, memberIds: ['r', 'm'], createdAt: '2026-01-01' },
      { id: 'v', title: "Valentine's Day", kind: 'Other', date: '02-14', createdAt: '2026-01-01' },
    ],
    now: NOW,
  });
  const rows = allItems(r);
  assert.ok(rows.some((i) => i.title === 'Mia was born' && i.date === '2024-07-20' && i.detail === 'Vienna'));
  assert.ok(rows.some((i) => i.title === 'Our wedding' && i.date === '2019-05-18'));
  assert.ok(!rows.some((i) => i.title === "Valentine's Day"), 'a yearly date with no first year is not a moment in time');
}

// --- Dates read the way they were given ------------------------------------------
{
  assert.equal(lifeDateLabel({ date: '2024-07-01', precision: 'month' }), 'Jul 2024', 'never "1 Jul" for a month someone remembered');
  assert.equal(lifeDateLabel({ date: '2009-01-01', precision: 'year' }), '2009');
  assert.equal(lifeDateLabel({ date: '2026-08-12', precision: 'day' }), '12 Aug 2026');
  assert.equal(lifeDateLabel({ date: '2026-08-12', endDate: '2026-08-19', precision: 'day' }), '12–19 Aug 2026');
  assert.equal(lifeDateLabel({ date: '2026-07-28', endDate: '2026-08-03', precision: 'day' }), '28 Jul – 3 Aug 2026');
  assert.equal(lifeDateLabel({ date: '2025-12-28', endDate: '2026-01-04', precision: 'day' }), '28 Dec 2025 – 4 Jan 2026');
  assert.equal(lifeDateLabel({ date: '', precision: 'day' }), 'Undated');
}

// --- The assistant adds a moment ---------------------------------------------------
{
  const family = [member({ id: 'mia', name: 'Mia Berger' }), member({ id: 'ben', name: 'Ben Berger' })];
  const add = (item: Record<string, string>) => ({ kind: 'list_add' as const, list: 'timeline' as const, item });
  const { timeline: { entries }, notes } = applyTimelineEdits({ entries: [] }, [
    add({ title: 'Broke her arm', date: '2026-08-12', category: 'medical', members: 'Mia, Nobody', place: 'AKH' }),
    add({ title: 'Moved to Vienna', date: '2019', category: 'home' }),
    add({ title: 'Summer in Romania', date: '2024-07', category: 'Holidays' }),
    add({ title: 'Something', date: 'last spring', category: 'nonsense' }),
    add({ title: '   ', date: '2026-01-01' }),
    add({ title: 'Old-style', date: '2020-02-02', type: 'Graduation' }),
  ], family);

  assert.equal(entries.length, 5, 'a moment with no title is not added');
  const [arm, moved, summer, vague, oldStyle] = entries;
  assert.deepEqual(arm.memberIds, ['mia'], 'names resolve to people; an unknown name is dropped, not guessed');
  assert.equal(arm.category, 'medical');
  assert.equal(arm.place, 'AKH');
  assert.equal(moved.date, '2019-01-01');
  assert.equal(moved.datePrecision, 'year', 'a bare year is stored as a year, not as 1 January');
  assert.equal(moved.memberIds, undefined, 'no names means the whole family');
  assert.equal(summer.datePrecision, 'month');
  assert.equal(summer.category, 'holiday', 'a near-miss category word maps to its kind');
  assert.equal(vague.date, '', 'a date in no recognisable shape is left undated, never invented');
  assert.equal(vague.category, 'other');
  assert.equal(oldStyle.category, 'school', 'an old-style type still lands in the right kind');
  assert.ok(entries.every((e) => e.source === 'assistant'), 'every row the assistant adds says so');
  assert.deepEqual(notes, ['Added “Broke her arm” to the timeline, but couldn\'t tell who Nobody is, so it isn\'t tagged to them.'],
    'an unknown name is reported, not silently dropped');
  const placed = buildLifeTimeline({ entries, members: family, events: [], now: NOW });
  assert.ok(filterLifeTimeline(placed, { member: family[0], category: 'medical' }).years.flatMap((y) => y.items).some((i) => i.title === 'Broke her arm'),
    'what the assistant adds shows on her timeline under Medical');
}

// --- The assistant's moment: only known fields, precision only ever coarser ------
{
  const family = [member({ id: 'mia', name: 'Mia Berger' }), member({ id: 'ben', name: 'Ben Berger' })];
  const add = (item: Record<string, string>) => ({ kind: 'list_add' as const, list: 'timeline' as const, item });
  const { timeline, notes } = applyTimelineEdits({ entries: [] }, [
    add({ title: 'Got the dog', date: '2015-01-01', datePrecision: 'year', category: 'memory', members: 'Mia and Ben' }),
    add({ title: 'Swimming badge', date: '2021-06-14', datePrecision: 'month', category: 'school' }),
    add({ title: 'Moved', date: '2019', datePrecision: 'day', category: 'home' }),
    add({ title: 'Fair', date: '2022-05-07', datePrecision: 'fortnight', category: 'Relocation' }),
    add({ title: 'Smuggled', date: '2020-02-02', id: 'tl-evil', importBatchId: 'x', photos: 'https://evil', source: 'import', docIds: 'd1' }),
  ], family);
  const [dog, badge, moved, fair, smuggled] = timeline.entries;
  assert.equal(dog.date, '2015-01-01');
  assert.equal(dog.datePrecision, 'year', 'an explicit year precision makes "2015-01-01" read as 2015, not 1 Jan');
  assert.deepEqual(dog.memberIds, ['mia', 'ben'], '"Mia and Ben" is two people');
  assert.equal(badge.date, '2021-06-01');
  assert.equal(badge.datePrecision, 'month', 'month precision coarsens the day away rather than keeping a day nobody meant');
  assert.equal(moved.datePrecision, 'year', 'CONTROL: a precision can never make a date FINER than it was given');
  assert.equal(fair.datePrecision, undefined, 'an unknown precision word is dropped');
  assert.equal(fair.date, '2022-05-07');
  assert.equal(fair.category, 'other', 'a category outside the list is "other"');
  assert.notEqual(smuggled.id, 'tl-evil', 'the model never chooses the id');
  assert.deepEqual(Object.keys(smuggled).sort(), ['category', 'date', 'id', 'source', 'title'],
    'nothing outside the whitelist reaches the store');
  assert.equal(smuggled.source, 'assistant', 'the model cannot claim a row was imported');
  assert.deepEqual(notes, [], 'CONTROL: names that all resolve produce no note');
}

// --- "About Mia? Tag" ----------------------------------------------------------------
{
  const family = [member({ id: 'mia', name: 'Mia Lindqvist' }), member({ id: 'ben', name: 'Ben Lindqvist' })];
  assert.equal(suggestMemberFromTitle({ title: 'Mia: first day at school' }, family)?.id, 'mia');
  assert.equal(suggestMemberFromTitle({ title: "Mia's first tooth" }, family)?.id, 'mia');
  assert.equal(suggestMemberFromTitle({ title: 'Ben’s bike', memberIds: [] }, family)?.id, 'ben', 'curly apostrophe too');
  assert.equal(suggestMemberFromTitle({ title: 'mia : swimming badge' }, family)?.id, 'mia', 'case and a space before the colon');
  // CONTROLS — each of these would be a wrong guess.
  assert.equal(suggestMemberFromTitle({ title: 'Miami trip' }, family), null, 'a name inside a longer word is not a name');
  assert.equal(suggestMemberFromTitle({ title: 'Mia and Ben at the lake' }, family), null, 'a name without ":" or "\'s" is not enough');
  assert.equal(suggestMemberFromTitle({ title: "Mia's tooth", memberIds: ['ben'] }, family), null, 'already about someone: nothing to suggest');
  assert.equal(suggestMemberFromTitle({ title: "Mias's tooth" }, family), null);
  assert.equal(suggestMemberFromTitle({ title: 'The lake: Mia' }, family), null, 'the name has to LEAD the title');
  const twoMias = [...family, member({ id: 'mia2', name: 'Mia Poe' })];
  assert.equal(suggestMemberFromTitle({ title: "Mia's tooth" }, twoMias), null, 'two people called Mia: never guess');
  assert.equal(suggestMemberFromTitle({ title: "Mia's tooth", memberIds: ['gone'] }, family)?.id, 'mia',
    'an id left by someone no longer in the family does not count as tagged');
}

console.log('lifeTimeline.test.ts: all assertions passed');

// The visual projection must keep the newer production sources and boundaries
// while bringing in the new profile records.
const learner = member({ education: { schoolYears: [{ id: 'year', label: '2025–26', schoolName: 'School', reports: [{ id: 'report', title: 'Annual report', date: '2026-06-01' }] }] }, addressHistory: [{ id: 'home', address: 'First home', startDate: '2020-01-01', endDate: '2024-01-01' }] });
const learningInput = { members: [learner], events: [], entries: [], travel: [], documents: [], anniversaries: [], milestones: [], now: NOW };
const learning = buildLifeTimeline(learningInput);
assert.ok(allItems(learning).some(item => item.profileTab === 'education' && item.precision === 'year'));
assert.ok(allItems(learning).some(item => item.title === 'Annual report' && item.profileTab === 'education'));
assert.ok(allItems(learning).some(item => item.profileTab === 'addresses' && item.endDate === '2024-01-01'));
assertReconciles(learning, 'education and previous addresses');
assert.ok(!allItems(buildLifeTimeline({ ...learningInput, isBusinessSpace: true })).some(item => item.source === 'profile'), 'family education and residential history must not leak into the business timeline');

// Uploaded education remains discoverable without fabricated award dates.
{
 const doc = { id: 'certificate', name: 'Permaculture certificate', category: 'Education' as const, fileName: 'certificate.pdf', fileType: 'application/pdf', fileSize: 20, uploadedAt: '2026-09-16', fileData: 'https://files/certificate' };
 const owner = member({documents:[doc]});
 const profile = buildLifeTimeline({events:[], entries:[], members:[owner], now:NOW});
 assert.equal(profile.undated.find(i => i.title === doc.name)?.category, 'school');
 const copy = vaultDoc({category:'Education', memberId:owner.id, downloadUrl:doc.fileData});
 const undated = buildLifeTimeline({events:[], entries:[], members:[owner], documents:[copy], now:NOW});
 assert.equal(allItems(undated).filter(i=>i.title === doc.name || i.sourceId === copy.id).length, 1);
 assert.equal(undated.undated.filter(i=>i.category === 'school').length, 1);
 const dated = buildLifeTimeline({events:[], entries:[], members:[owner], documents:[{...copy,docDate:'2012-12-01'}], now:NOW});
 assert.equal(allItems(dated).filter(i=>i.category === 'school').length, 1);
 assert.equal(allItems(dated).find(i=>i.category === 'school')?.date, '2012-12-01');
 const misfiled = buildLifeTimeline({events:[], entries:[], members:[owner], documents:[{...copy,category:'Other'}], now:NOW});
 assert.ok(misfiled.undated.some(i=>i.title === doc.name), 'an undated misfiled vault copy cannot hide the profile certificate');
 const linked = {...owner,education:{qualifications:[{id:'q',name:'Permaculture',documents:[{id:'vault:d1',source:'vault' as const,documentId:'d1'}]}]}};
 const merged = buildLifeTimeline({events:[], entries:[], members:[linked],documents:[{...copy,docDate:'2012-12-01'}],now:NOW});
 assert.equal(allItems(merged).filter(i=>i.category === 'school').length,1, 'linked qualification replaces raw copies');
 assert.equal(allItems(merged).find(i=>i.category === 'school')?.date,'2012-12-01');
 for(const result of [profile,undated,dated,misfiled,merged]) assertReconciles(result,'education uploads');
}

{
 const owner=member({cv:{roles:[{id:'job',title:'Designer',employer:'Example Studio',startDate:'2013',endDate:'2015-06'},{id:'undated',title:'Volunteer'},{id:'current',title:'Director',startDate:'2020-01-01',current:true,endDate:'2024-01-01'}]}});
 const history=buildLifeTimeline({members:[owner],entries:[],events:[],now:NOW});
 const work=allItems(history).filter(i=>i.category==='work');
 assert.equal(work.length,4,'start/end, undated and current roles are represented');
 assert.equal(work.find(i=>i.title==='Designer')?.precision,'year');
 assert.equal(work.find(i=>i.title==='Finished Designer')?.precision,'month');
 assert.ok(history.undated.some(i=>i.title==='Volunteer'));
 assert.ok(!work.some(i=>i.title==='Finished Director'),'current role does not invent an end');
 assertReconciles(history,'work history');
}

{
 const document={id:'cv-file',name:'CV',category:'Other' as const,fileName:'cv.pdf',fileType:'application/pdf',fileSize:20,uploadedAt:'2026-09-16',fileData:'https://files/cv'};
 const owner=member({documents:[document]});
 const input={members:[owner],events:[],entries:[{id:'imported',date:'2013-01-01',title:'Started design work',category:'work' as const,sourceDocument:{memberId:owner.id,documentId:document.id}}],now:NOW};
 assert.equal(allItems(buildLifeTimeline(input))[0].fileUrl,document.fileData,'imported event opens its original profile document');
 assert.equal(allItems(buildLifeTimeline({...input,members:[]}))[0].fileUrl,undefined,'inaccessible or deleted profile files never expose stale URLs');
}
