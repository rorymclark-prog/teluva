import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  feedHiddenPeople,
  hideFromFeed,
  safeOwnerUid,
  remindersHiddenPeople,
  celebrationIsHidden,
  hiddenKey,
} from './hiddenPeople.mjs';
import { buildFeedOccasions, applyDivisionSettings } from './calendarOccasions.mjs';
import { buildPublishedIcs, selectPublishableEvents } from './calendarPublish.mjs';

/**
 * "Hide <Name>'s dates" on the server: the published .ics feed and the daily
 * reminders. The rules themselves are pinned to the app's by
 * src/utils/hiddenPeopleParity.test.ts; this file proves the two server paths
 * actually run them, end to end through the real feed builders.
 */

const NOW = new Date('2026-09-14T12:00:00Z');
const hid = (id, name) => ({ id, name, hiddenAt: '2026-09-01T00:00:00Z' });

const family = {
  members: [
    { id: 'mama', name: 'Mama', birthdate: '1984-03-02' },
    { id: 'papa', name: 'Papa', birthdate: '1982-10-05' },
    { id: 'nora', name: 'Nora', birthdate: '1985-09-20' },
  ],
  extendedBirthdays: [
    { id: 'eb-klara', name: 'Aunt Klara', date: '09-26', originalYear: 1968 },
  ],
  anniversaries: [
    { id: 'an-1', title: 'Papa & Nora wedding anniversary', kind: 'Wedding', date: '06-12', memberIds: ['papa', 'nora'] },
    { id: 'an-2', title: 'Mama & Papa met', kind: 'Other', date: '04-01', memberIds: ['mama', 'papa'] },
  ],
};
const typed = [
  { id: 'e-bday', title: "Nora's birthday", date: '2026-09-20', category: 'Milestone' },
  { id: 'e-dinner', title: 'Dinner with Nora', date: '2026-09-18', category: 'Social' },
  { id: 'e-dentist', title: 'Dentist', date: '2026-09-16', category: 'Appointment' },
];

/** The /cal/:token route, minus Firestore: the same calls in the same order. */
function feedFor(lists) {
  const all = applyDivisionSettings(family, null);
  const { events, occasionSources } = hideFromFeed(
    { events: typed, occasionSources: all },
    feedHiddenPeople(lists, all),
  );
  return buildPublishedIcs(selectPublishableEvents(events, NOW), {
    calendarName: 'Test',
    now: NOW,
    occasions: buildFeedOccasions(occasionSources, NOW),
  });
}

// --------------------------------------------------------------------------
// The feed
// --------------------------------------------------------------------------

test('CONTROL: with nobody hidden, Nora\'s birthday is in the feed twice over', () => {
  const ics = feedFor({ familyList: [], ownerList: [] });
  assert.match(ics, /SUMMARY:Nora's birthday/);
  assert.ok(ics.includes('virtual-birthday-nora'), 'the derived birthday is exported');
  assert.ok(ics.includes('Papa & Nora wedding anniversary'), 'the anniversary is exported');
});

test('a person on the FAMILY list is absent from the feed: derived birthday, typed birthday, anniversary', () => {
  const ics = feedFor({ familyList: [hid(hiddenKey.member('nora'), 'Nora')], ownerList: [] });
  assert.ok(!ics.includes('virtual-birthday-nora'), 'derived birthday still exported');
  assert.doesNotMatch(ics, /SUMMARY:Nora's birthday/, 'typed birthday still exported');
  assert.ok(!ics.includes('Papa & Nora wedding anniversary'), 'an anniversary involving her still exported');
});

test('hiding a person never hides their plans: "Dinner with Nora" stays, and so does everyone else', () => {
  const ics = feedFor({ familyList: [hid(hiddenKey.member('nora'), 'Nora')], ownerList: [] });
  assert.match(ics, /SUMMARY:Dinner with Nora/);
  assert.match(ics, /SUMMARY:Dentist/);
  assert.ok(ics.includes('virtual-birthday-papa'));
  assert.ok(ics.includes('Mama & Papa met'));
  assert.ok(ics.includes("Aunt Klara's birthday"));
});

test('the LINK OWNER\'s own list counts for their link', () => {
  const ics = feedFor({ familyList: [], ownerList: [hid(hiddenKey.extended('eb-klara'), 'Aunt Klara')] });
  assert.ok(!ics.includes("Aunt Klara's birthday"));
  assert.ok(ics.includes('virtual-birthday-nora'), 'only the person on the list is hidden');
});

// --- Hidden from chosen accounts (settings.hiddenDatePeopleFor) -------------
// "Hide Nora from Papa, leave her for the boys." A link is its creator's own
// calendar, so an entry counts for a feed exactly when it names the creator.
const noraFromPapa = [{ ...hid(hiddenKey.member('nora'), 'Nora'), forUids: ['u-papa'] }];

test('an entry that names the link\'s creator hides the person from that link', () => {
  const ics = feedFor({ familyList: [], ownerList: [], forList: noraFromPapa, ownerUid: 'u-papa' });
  assert.ok(!ics.includes('virtual-birthday-nora'), 'derived birthday still exported');
  assert.doesNotMatch(ics, /SUMMARY:Nora's birthday/, 'typed birthday still exported');
  assert.ok(!ics.includes('Papa & Nora wedding anniversary'), 'her anniversary still exported');
  assert.match(ics, /SUMMARY:Dinner with Nora/, 'her plans are not her dates');
});

test('CONTROL: the same entry on a link made by somebody it does not name hides nothing', () => {
  const ics = feedFor({ familyList: [], ownerList: [], forList: noraFromPapa, ownerUid: 'u-ben' });
  assert.ok(ics.includes('virtual-birthday-nora'));
  assert.match(ics, /SUMMARY:Nora's birthday/);
});

test('with no usable creator uid the chosen-accounts entries count for nobody', () => {
  const ics = feedFor({ familyList: [], ownerList: [], forList: noraFromPapa, ownerUid: null });
  assert.ok(ics.includes('virtual-birthday-nora'));
});

test('a missing or malformed chosen-accounts list shows the dates (fails open, never wide)', () => {
  for (const forList of [undefined, null, 'member:nora', [{ id: 'member:nora', name: 'Nora', forUids: 'u-papa' }], [null]]) {
    const ics = feedFor({ familyList: [], ownerList: [], forList, ownerUid: 'u-papa' });
    assert.ok(ics.includes('virtual-birthday-nora'), JSON.stringify(forList));
  }
});

test('a feed without birthdays still drops the typed birthday of a hidden person', () => {
  const { events, occasionSources } = hideFromFeed(
    { events: typed, occasionSources: null },
    feedHiddenPeople({ familyList: [hid(hiddenKey.member('nora'), 'Nora')], ownerList: [] }, null),
  );
  assert.equal(occasionSources, null);
  assert.deepEqual(events.map((e) => e.id), ['e-dinner', 'e-dentist']);
});

test('the owner uid is only ever one clean path segment', () => {
  assert.equal(safeOwnerUid('Ab3_x-9'), 'Ab3_x-9');
  for (const bad of ['', 'a/b', '../settings', null, undefined, 42, 'x'.repeat(129)]) {
    assert.equal(safeOwnerUid(bad), null, String(bad));
  }
});

// --------------------------------------------------------------------------
// Daily reminders
// --------------------------------------------------------------------------

test('each kind of celebration maps back to its person', () => {
  const hp = remindersHiddenPeople({
    familyList: [
      hid(hiddenKey.member('nora'), 'Nora'),
      hid(hiddenKey.extended('eb-klara'), 'Aunt Klara'),
      hid(hiddenKey.extended('contact-c7'), 'Oma'),
    ],
    members: family.members,
    extendedBirthdays: family.extendedBirthdays,
  }).family;
  const anns = family.anniversaries;
  assert.equal(celebrationIsHidden({ key: 'bday-nora', memberId: 'nora' }, hp, anns), true);
  assert.equal(celebrationIsHidden({ key: 'namecel-nora-x-1', memberId: 'nora' }, hp, anns), true);
  assert.equal(celebrationIsHidden({ key: 'extbday-eb-klara' }, hp, anns), true);
  assert.equal(celebrationIsHidden({ key: 'contactbday-c7' }, hp, anns), true);
  assert.equal(celebrationIsHidden({ key: 'annivrec-an-1' }, hp, anns), true);
  // CONTROLS — the same shapes for people nobody hid.
  assert.equal(celebrationIsHidden({ key: 'bday-papa', memberId: 'papa' }, hp, anns), false);
  assert.equal(celebrationIsHidden({ key: 'annivrec-an-2' }, hp, anns), false);
  assert.equal(celebrationIsHidden({ key: 'extbday-eb-other' }, hp, anns), false);
  assert.equal(celebrationIsHidden({ key: 'anniversary' }, hp, anns), false, 'a business anniversary belongs to nobody');
});

test('personal lists are kept per account, and an empty one is not kept at all', () => {
  const { family: fam, byUid } = remindersHiddenPeople({
    familyList: [],
    prefs: [
      { uid: 'u-mama', hiddenDatePeople: [hid(hiddenKey.member('nora'), 'Nora')] },
      { uid: 'u-papa', hiddenDatePeople: [] },
    ],
    members: family.members,
  });
  assert.equal(fam.keys.size, 0);
  assert.deepEqual([...byUid.keys()], ['u-mama']);
  assert.equal(celebrationIsHidden({ key: 'bday-nora', memberId: 'nora' }, byUid.get('u-mama')), true);
  assert.equal(celebrationIsHidden({ key: 'bday-nora', memberId: 'nora' }, byUid.get('u-papa')), false);
});

test('a chosen-accounts entry skips ONLY the ticked accounts — the birthday is still sent', () => {
  const { family: fam, byUid } = remindersHiddenPeople({
    familyList: [],
    forList: [
      { ...hid(hiddenKey.member('nora'), 'Nora'), forUids: ['u-papa', 'u-mama'] },
      { ...hid(hiddenKey.extended('eb-klara'), 'Aunt Klara'), forUids: [] },
    ],
    prefs: [{ uid: 'u-mama', hiddenDatePeople: [hid(hiddenKey.extended('eb-klara'), 'Aunt Klara')] }],
    members: family.members,
    extendedBirthdays: family.extendedBirthdays,
  });
  const bday = { key: 'bday-nora', memberId: 'nora' };
  // The family set decides whether anything is sent at all — Nora is not on it.
  assert.equal(celebrationIsHidden(bday, fam), false, 'a chosen-accounts entry reached the family set');
  assert.equal(celebrationIsHidden(bday, byUid.get('u-papa')), true, 'Papa was ticked');
  assert.equal(celebrationIsHidden(bday, byUid.get('u-mama')), true, 'Mama was ticked');
  // CONTROL — an account nobody ticked still gets it.
  assert.equal(byUid.has('u-ben'), false);
  assert.equal(celebrationIsHidden(bday, byUid.get('u-ben')), false);
  // Mama's own list still counts alongside the entry that names her.
  assert.equal(celebrationIsHidden({ key: 'extbday-eb-klara' }, byUid.get('u-mama')), true);
  // An entry with nobody on it hides nothing for anyone.
  assert.equal(celebrationIsHidden({ key: 'extbday-eb-klara' }, byUid.get('u-papa')), false);
});

test('a malformed chosen-accounts list is ignored, not thrown on', () => {
  for (const forList of [undefined, null, 'x', [null], [{ id: 'member:nora', forUids: 'u-papa' }]]) {
    const { family: fam, byUid } = remindersHiddenPeople({ familyList: [], forList, members: family.members });
    assert.equal(fam.keys.size, 0);
    assert.equal(celebrationIsHidden({ key: 'bday-nora', memberId: 'nora' }, byUid.get('u-papa')), false, JSON.stringify(forList));
  }
});

// --------------------------------------------------------------------------
// Wiring — the functions above are only worth anything if server.js calls them.
// --------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const serverJs = readFileSync(join(here, '..', 'server.js'), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const block = (src, start, end) => {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `could not find ${start}`);
  return src.slice(a, b);
};

const feedWired = (src) => {
  const route = strip(block(src, "app.get('/cal/:token'", "app.get('/carer/:token'"));
  const hide = route.indexOf('hideFromFeed(');
  const build = route.indexOf('buildPublishedIcs(');
  return hide > 0 && build > hide
    && /readFeedHiddenLists\(record\.familyId, record\.createdBy\)/.test(route)
    && /feedHiddenPeople\(hiddenLists, allOccasionSources\)/.test(route)
    && /buildPublishedIcs\(selectPublishableEvents\(events\)/.test(route)
    && /buildFeedOccasions\(occasionSources\)/.test(route);
};

test('the /cal feed filters before it builds, with the owner\'s list', () => {
  assert.ok(feedWired(serverJs));
});

test('CONTROL: the feed guard fails on a route that skips the filter', () => {
  const broken = serverJs.replace(
    /const \{ events, occasionSources \} = hideFromFeed\([\s\S]*?\);/,
    'const events = storedEvents; const occasionSources = allOccasionSources;',
  );
  assert.notEqual(broken, serverJs, 'the mutation did not apply — update this control');
  assert.equal(feedWired(broken), false);
});

test('the owner\'s list is read from prefs/{createdBy}, through safeOwnerUid', () => {
  const fn = strip(block(serverJs, 'async function readFeedHiddenLists', "app.post('/api/calendar-publish/create'"));
  assert.match(fn, /safeOwnerUid\(createdBy\)/);
  assert.match(fn, /families\/\$\{familyId\}\/prefs\/\$\{owner\}/);
  assert.match(fn, /reference\/settings/);
  assert.doesNotMatch(fn, /\.catch\(/, 'a failed read must reach the route\'s 503, not serve the hidden dates');
});

const feedReadsChosen = (src) => {
  const fn = strip(block(src, 'async function readFeedHiddenLists', "app.post('/api/calendar-publish/create'"));
  return /forList: settings\.hiddenDatePeopleFor \|\| \[\]/.test(fn) && /ownerUid: owner,/.test(fn);
};

test('the feed also reads the chosen-accounts list, and hands over the owner uid that picks from it', () => {
  assert.ok(feedReadsChosen(serverJs));
});

test('CONTROL: the chosen-accounts guard fails when the owner uid is not passed on', () => {
  const broken = serverJs.replace('ownerUid: owner,', 'ownerUid: null,');
  assert.notEqual(broken, serverJs, 'the mutation did not apply — update this control');
  assert.equal(feedReadsChosen(broken), false);
});

const cronWired = (src) => {
  const cron = strip(block(src, 'async function runDailyCelebrations', 'async function pruneActivity'));
  return /const toSend = celebrations\.filter\(\(c\) => !celebrationIsHidden\(c, hiddenNow\.family, anniversaryRecords\)\)/.test(cron)
    && /for \(const c of toSend\)/.test(cron)
    && /skipUid: \(uid\) => celebrationIsHidden\(c, hiddenNow\.byUid\.get\(uid\), anniversaryRecords\)/.test(cron)
    && /remindersHiddenPeople\(\{\s*familyList: spaceSettings\.hiddenDatePeople,\s*forList: spaceSettings\.hiddenDatePeopleFor,/.test(cron)
    && (cron.match(/memberId: mDoc\.id/g) || []).length === 3;
};

test('the daily reminders drop the family\'s hidden people and skip each account\'s own', () => {
  assert.ok(cronWired(serverJs));
});

test('CONTROL: the cron guard fails when the loop sends the unfiltered list', () => {
  const broken = serverJs.replace('for (const c of toSend)', 'for (const c of celebrations)');
  assert.notEqual(broken, serverJs);
  assert.equal(cronWired(broken), false);
});

test('CONTROL: the cron guard fails when the chosen-accounts list is not passed in', () => {
  const broken = serverJs.replace('forList: spaceSettings.hiddenDatePeopleFor,', '');
  assert.notEqual(broken, serverJs, 'the mutation did not apply — update this control');
  assert.equal(cronWired(broken), false);
});

test('both senders honour skipUid', () => {
  const admins = strip(block(serverJs, 'async function sendToAdmins', 'async function sendToFamily'));
  const fam = strip(block(serverJs, 'async function sendToFamily', '\n}\n'));
  assert.match(admins, /if \(skipUid && skipUid\(sub\.uid\)\) continue;/);
  assert.match(fam, /if \(skipUid && s\.uid && skipUid\(s\.uid\)\) continue;/);
});

test('the assistant is told not to volunteer hidden dates', () => {
  assert.match(serverJs, /- HIDDEN DATES: [^\n]*"datesHidden":true[^\n]*Never bring those dates up yourself[^\n]*answer it plainly/);
});
