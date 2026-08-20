import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedOccasions, applyDivisionSettings, anchorIso, isLeapYear } from './calendarOccasions.mjs';
import { buildPublishedIcs, yearlyRrule } from './calendarPublish.mjs';

const NOW = new Date('2026-08-20T12:00:00Z');

// --------------------------------------------------------------------------
// Anchoring — DTSTART must describe a day that exists
// --------------------------------------------------------------------------

test('a series anchors on the origin year when there is one', () => {
  assert.equal(anchorIso('03-03', 2019), '2019-03-03');
});

test('29 February steps back to a year that HAS a 29 February', () => {
  // Anchoring a leap-day birthday on 2026-02-29 would describe a date that
  // does not exist, and clients differ wildly on what they do with one.
  assert.equal(anchorIso('02-29', 2026), '2024-02-29');
  assert.equal(anchorIso('02-29', 2024), '2024-02-29');
  assert.ok(isLeapYear(2024) && !isLeapYear(2026));
});

test('a month-day that is not a real date is refused, never coerced', () => {
  assert.equal(anchorIso('02-30', 2026), null);
  assert.equal(anchorIso('13-01', 2026), null);
  assert.equal(anchorIso('4-1', 2026), null);
  assert.equal(anchorIso('', 2026), null);
  assert.equal(anchorIso(null, 2026), null);
});

// --------------------------------------------------------------------------
// Birthdays — the gap this closes
// --------------------------------------------------------------------------

test('a member with a birthdate becomes a yearly series', () => {
  const [b] = buildFeedOccasions({
    members: [{ id: 'm1', name: 'Lena', birthdate: '2019-03-03' }],
  }, NOW);
  assert.equal(b.id, 'virtual-birthday-m1');
  assert.equal(b.title, "Lena's birthday");
  assert.equal(b.date, '2019-03-03');
  assert.equal(b.repeat, 'yearly');
  assert.equal(b.category, 'Birthday');
  assert.match(b.description, /Born 2019/);
});

test('a member with no birthdate, no name or a broken date contributes nothing', () => {
  assert.deepEqual(buildFeedOccasions({
    members: [
      { id: 'm1', name: 'Lena' },
      { id: 'm2', name: '', birthdate: '2019-03-03' },
      { id: 'm3', name: 'Broken', birthdate: '2019-02-30' },
      { id: 'm4', name: 'Alsobroken', birthdate: 'sometime in March' },
      null,
    ],
  }, NOW), []);
});

// --------------------------------------------------------------------------
// Extended birthdays and anniversaries
// --------------------------------------------------------------------------

test('an extended birthday carries the relationship and, when known, the year', () => {
  const out = buildFeedOccasions({
    extendedBirthdays: [
      { id: 'eb1', name: 'Grandma Sue', relationship: 'Grandmother', date: '09-14', originalYear: 1946 },
      { id: 'eb2', name: 'Tom', date: '09-20' },
    ],
  }, NOW);
  assert.equal(out.length, 2);
  const sue = out.find((o) => o.id === 'virtual-extendedBirthday-eb1');
  assert.equal(sue.date, '1946-09-14');
  assert.match(sue.description, /Grandmother/);
  assert.match(sue.description, /Born 1946/);

  const tom = out.find((o) => o.id === 'virtual-extendedBirthday-eb2');
  assert.equal(tom.date, '2026-09-20', 'no birth year anchors on today, never on year zero');
  assert.ok(!/Born/.test(tom.description), 'and claims no year it does not have');
});

test('an anniversary counts from its origin year, or from today when it has none', () => {
  const out = buildFeedOccasions({
    anniversaries: [
      { id: 'a1', title: 'Rory & Maria', date: '07-12', originalYear: 2012 },
      { id: 'a2', title: "Valentine's Day", date: '02-14' },
      { id: 'a3', title: '', date: '05-05' },
    ],
  }, NOW);
  assert.equal(out.length, 2, 'an untitled anniversary is not exportable');
  assert.equal(out.find((o) => o.id === 'virtual-anniversary-a1').date, '2012-07-12');
  assert.equal(out.find((o) => o.id === 'virtual-anniversary-a2').date, '2026-02-14');
});

test('a bogus originalYear is ignored rather than trusted', () => {
  const [a] = buildFeedOccasions({
    anniversaries: [{ id: 'a1', title: 'X', date: '07-12', originalYear: 'nineteen ninety' }],
  }, NOW);
  assert.equal(a.date, '2026-07-12');
});

test('results are ordered by day of the year, not by document order', () => {
  const out = buildFeedOccasions({
    members: [
      { id: 'm1', name: 'Zoe', birthdate: '2021-11-10' },
      { id: 'm2', name: 'Ann', birthdate: '2015-01-02' },
    ],
  }, NOW);
  assert.deepEqual(out.map((o) => o.title), ["Ann's birthday", "Zoe's birthday"]);
});

test('nothing at all is safe', () => {
  assert.deepEqual(buildFeedOccasions({}, NOW), []);
  assert.deepEqual(buildFeedOccasions(undefined, NOW), []);
  assert.deepEqual(buildFeedOccasions({ members: 'not an array' }, NOW), []);
});

// --------------------------------------------------------------------------
// Name days & name celebrations — the division the feed used to be missing
// --------------------------------------------------------------------------

const Shyam = {
  id: 'm-shyam',
  name: 'Shyam',
  nameCelebrations: [{
    id: 'celeb-nit', kind: 'name_celebration', title: 'Nityananda Trayodashi',
    celebrationOf: 'Shyam', matchType: 'exact', tradition: 'Gaudiya Vaishnava',
    explanation: 'Confirmed by the family.', dateType: 'movable',
    movableRule: 'Magha Shukla Trayodashi', confirmed: true, primary: true,
  }],
  nameCelebrationResolvedDates: { 'celeb-nit': { 2026: '2026-02-09', 2027: '2027-01-30' } },
};

test('a legacy Namenstag reaches the feed as a yearly rule', () => {
  const out = buildFeedOccasions({
    nameCelebrationMembers: [{ id: 'm1', name: 'Josef Huber', nameDay: '03-19', nameDayFeast: 'Hl. Josef' }],
  }, NOW);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    id: 'virtual-nameDay-m1-legacy-name-day',
    title: 'Hl. Josef',
    date: '2026-03-19',
    repeat: 'yearly',
    description: 'Josef Huber · From Teluva',
    category: 'Name day',
  });
});

test('an UNCONFIRMED proposal never leaves the app', () => {
  // It is a question Teluva is still asking the family. Publishing it to
  // somebody else's phone would answer it for them.
  const out = buildFeedOccasions({
    nameCelebrationMembers: [{
      id: 'm1', name: 'Ganga',
      nameCelebrations: [{ id: 'celeb-p', kind: 'name_day', title: 'Proposed', dateType: 'fixed', date: '05-01', confirmed: false, primary: true }],
    }],
  }, NOW);
  assert.deepEqual(out, []);
});

test('a movable celebration is published as the resolved dates only, with NO rule', () => {
  // FREQ=YEARLY on a lunar date would have the subscribing calendar inventing
  // every future occurrence on the wrong day.
  const out = buildFeedOccasions({ nameCelebrationMembers: [Shyam] }, NOW);
  assert.deepEqual(out.map((o) => [o.id, o.date, o.repeat]), [
    ['virtual-nameDay-m-shyam-celeb-nit-2027-01-30', '2027-01-30', 'once'],
    ['virtual-nameDay-m-shyam-celeb-nit-2026-02-09', '2026-02-09', 'once'],
  ]);
  assert.ok(out.every((o) => o.repeat === 'once'), 'a movable date must never carry a yearly rule');
});

test('a movable celebration with nothing resolved yet publishes nothing rather than a guess', () => {
  const unresolved = { ...Shyam, nameCelebrationResolvedDates: {} };
  assert.deepEqual(buildFeedOccasions({ nameCelebrationMembers: [unresolved] }, NOW), []);
});

test('primary and confirmed extras both go, in that order', () => {
  const out = buildFeedOccasions({
    nameCelebrationMembers: [{
      id: 'm1', name: 'Anna',
      nameCelebrations: [
        { id: 'celeb-a', kind: 'name_day', title: 'Hl. Anna', dateType: 'fixed', date: '07-26', confirmed: true, primary: true },
        { id: 'celeb-b', kind: 'name_celebration', title: 'Extra', dateType: 'fixed', date: '01-05', confirmed: true, primary: false },
      ],
    }],
  }, NOW);
  assert.deepEqual(out.map((o) => o.title), ['Extra', 'Hl. Anna'], 'sorted by day of year like everything else');
});

test('the UID matches the one the .ics DOWNLOAD writes for the same celebration', () => {
  // buildOccasionSeries in src/utils/virtualEvents.ts builds
  // `virtual-nameDay-${memberId}-${celebrationId}`. A family that saved the
  // file AND subscribed to the feed must end up with one entry, not two.
  const out = buildFeedOccasions({
    nameCelebrationMembers: [{ id: 'm1', name: 'Josef', nameDay: '03-19', nameDayFeast: 'Hl. Josef' }],
  }, NOW);
  const ics = buildPublishedIcs([], { now: NOW, occasions: out });
  assert.match(ics, /UID:virtual-nameDay-m1-legacy-name-day@teluva\.app/);
  assert.match(ics, /RRULE:FREQ=YEARLY/);
  assert.match(ics, /CATEGORIES:Name day/);
});

test('a member with no celebrations at all contributes nothing', () => {
  assert.deepEqual(buildFeedOccasions({ nameCelebrationMembers: [{ id: 'm1', name: 'Nomvula' }] }, NOW), []);
  assert.deepEqual(buildFeedOccasions({ nameCelebrationMembers: [null, {}, 'junk'] }, NOW), []);
});

// --------------------------------------------------------------------------
// Division settings — the feed must not show what the app hides
// --------------------------------------------------------------------------

test('a division switched off in the app is switched off in the feed', () => {
  const sources = {
    members: [{ id: 'm1', name: 'Lena', birthdate: '2019-03-03' }],
    extendedBirthdays: [{ id: 'eb1', name: 'Sue', date: '09-14' }],
    anniversaries: [{ id: 'a1', title: 'Wedding', date: '07-12' }],
  };
  const only = applyDivisionSettings(sources, { birthdays: false, anniversaries: false });
  assert.deepEqual(only.members, []);
  assert.deepEqual(only.anniversaries, []);
  assert.equal(only.extendedBirthdays.length, 1, 'a division left unset stays ON');

  // No settings document at all must not silently hide everything.
  const none = applyDivisionSettings(sources, null);
  assert.equal(none.members.length, 1);
});

test('birthdays and name celebrations are separate toggles over the same members', () => {
  // They read the same documents, so one source key for both would make
  // hiding birthdays silently take the Namenstag with it.
  const sources = { members: [{ id: 'm1', name: 'Josef', birthdate: '1980-03-03', nameDay: '03-19' }] };

  const noBirthdays = applyDivisionSettings(sources, { birthdays: false });
  assert.deepEqual(noBirthdays.members, []);
  assert.equal(noBirthdays.nameCelebrationMembers.length, 1, 'the name day stays');
  assert.deepEqual(buildFeedOccasions(noBirthdays, NOW).map((o) => o.category), ['Name day']);

  const noNameDays = applyDivisionSettings(sources, { nameCelebrations: false });
  assert.equal(noNameDays.members.length, 1);
  assert.deepEqual(noNameDays.nameCelebrationMembers, []);
  assert.deepEqual(buildFeedOccasions(noNameDays, NOW).map((o) => o.category), ['Birthday']);

  const both = applyDivisionSettings(sources, null);
  assert.deepEqual(buildFeedOccasions(both, NOW).map((o) => o.category), ['Birthday', 'Name day']);
});

// --------------------------------------------------------------------------
// Serialization
// --------------------------------------------------------------------------

test('an occasion is written as a rule, with a UID that never moves', () => {
  const ics = buildPublishedIcs([], {
    now: NOW,
    occasions: buildFeedOccasions({ members: [{ id: 'm1', name: 'Lena', birthdate: '2019-03-03' }] }, NOW),
  });
  assert.match(ics, /UID:virtual-birthday-m1@teluva\.app/);
  assert.match(ics, /DTSTART;VALUE=DATE:20190303/);
  assert.match(ics, /DTEND;VALUE=DATE:20190304/);
  assert.match(ics, /RRULE:FREQ=YEARLY/);
  assert.match(ics, /SUMMARY:Lena's birthday/);
  // A birthday must not read as "unavailable" to anyone scheduling around it.
  assert.match(ics, /TRANSP:TRANSPARENT/);
});

test('the same UID as the .ics download, so the two paths do not double up', () => {
  // src/utils/ics.ts writes exactly this for the same occasion. A family that
  // both imports the file and subscribes to the feed must end up with ONE
  // birthday per person, which only happens if the identities match.
  const ics = buildPublishedIcs([], {
    now: NOW,
    occasions: [{ id: 'virtual-anniversary-a1', title: 'X', date: '2012-07-12', repeat: 'yearly', category: 'Anniversary' }],
  });
  assert.match(ics, /UID:virtual-anniversary-a1@teluva\.app/);
});

test('29 February gets the fallback rule, not the literal one', () => {
  assert.equal(yearlyRrule('2024-02-29'), 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1');
  assert.equal(yearlyRrule('2019-03-03'), 'RRULE:FREQ=YEARLY');
});

test('a one-off occasion gets no rule at all', () => {
  const ics = buildPublishedIcs([], {
    now: NOW,
    occasions: [{ id: 'virtual-nameDay-x-2026-11-24', title: 'Kartik Purnima', date: '2026-11-24', repeat: 'once', category: 'Name day' }],
  });
  assert.ok(!ics.includes('RRULE'));
});

test('busy mode never carries occasions, whatever the caller passes', () => {
  // The last line of defence: busy mode exists so a link can go outside the
  // family without saying why a slot is taken. "Lena's birthday" would undo
  // that in one line, so the serializer refuses even if the caller slips.
  const ics = buildPublishedIcs([], {
    mode: 'busy',
    now: NOW,
    occasions: buildFeedOccasions({ members: [{ id: 'm1', name: 'Lena', birthdate: '2019-03-03' }] }, NOW),
  });
  assert.ok(!ics.includes('Lena'));
  assert.ok(!ics.includes('RRULE'));
});

test('a malformed occasion is dropped without taking the feed down', () => {
  const ics = buildPublishedIcs([], {
    now: NOW,
    occasions: [null, { id: 'x' }, { id: 'y', date: 'nope' }, { id: 'z', date: '2020-01-01', title: 'Kept', repeat: 'yearly' }],
  });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics, /SUMMARY:Kept/);
});
