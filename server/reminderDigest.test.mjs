import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  memberDeadlines,
  tomorrowsEvents,
  digestText,
  splitDigests,
  daysUntil,
} from './reminderDigest.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/* Vienna "today" for every case below. daysUntil works in whole UTC days, so
 * the fixtures are simply offsets from this. */
const TODAY = Date.UTC(2026, 7, 29); // 2026-08-29
const inDays = (n) => new Date(TODAY + n * 86400000).toISOString().slice(0, 10);

/* An employee's record, holding one of each kind of deadline at a threshold
 * the job actually fires on. Every one of these labels names them. */
const EMPLOYEE = {
  name: 'Katharina Moser',
  passports: [{ country: 'Austrian', expiryDate: inDays(7) }],
  travel: { visas: [{ permitType: 'Rot-Weiss-Rot card', country: 'Austria', expiryDate: inDays(30) }] },
  careSchedule: [{ kind: 'Dental check-up', nextDue: inDays(0) }],
  cv: { qualifications: [{ name: 'First aid certificate', issuer: 'Rotes Kreuz', expiryDate: inDays(90) }] },
};

// --- 1. every member-derived deadline is marked personal --------------------
test('memberDeadlines marks everything it returns as personal', () => {
  const out = memberDeadlines(EMPLOYEE, TODAY);
  assert.equal(out.length, 4, 'expected one item per deadline kind on the fixture');
  for (const item of out) {
    assert.equal(
      item.personal, true,
      `"${item.label}" is not marked personal — it names a person and will be pushed to the whole company.`,
    );
    assert.ok(
      item.label.startsWith('Katharina Moser'),
      'a member deadline that does not name the member has changed shape; re-check the personal contract.',
    );
  }
});

// --- 2. certificates off the CV tab actually reach the digest ---------------
test('a lapsing certificate is a deadline', () => {
  const labels = memberDeadlines(EMPLOYEE, TODAY).map((d) => d.label);
  assert.ok(
    labels.some((l) => l.includes('First aid certificate') && l.includes('in 90 days')),
    'cv.qualifications expiry dates are not read — the CV tab draws an "Expires soon" chip and the AI offers ' +
      'reminders, but nothing sends. Certificates are the most business-shaped deadline in the app.',
  );
});

// --- 3. only the listed rungs fire -----------------------------------------
test('a deadline between thresholds sends nothing', () => {
  const mem = { name: 'X', passports: [{ country: 'SA', expiryDate: inDays(45) }] };
  assert.equal(memberDeadlines(mem, TODAY).length, 0, '45 days is not a threshold — this would push daily.');
  assert.equal(daysUntil('not-a-date', TODAY), null, 'an unparseable date must not become a day count');
});

// --- 4. calendar entries are shared, not personal ---------------------------
test('tomorrows events are shared', () => {
  const events = [{ date: inDays(1), title: 'Site inspection' }, { date: inDays(3), title: 'Later' }];
  const out = tomorrowsEvents(events, TODAY);
  assert.equal(out.length, 1, 'only tomorrow');
  assert.equal(out[0].personal, false, 'a shared calendar entry must not be withheld from the team');
});

// --- 5. THE BOUNDARY: a business space splits the digest --------------------
test('a business space sends personal deadlines to admins only', () => {
  const due = [...memberDeadlines(EMPLOYEE, TODAY), ...tomorrowsEvents([{ date: inDays(1), title: 'Site inspection' }], TODAY)];
  const groups = splitDigests(due, { isBusiness: true });

  const everyone = groups.filter((g) => g.audience === 'everyone').flatMap((g) => g.items);
  for (const item of everyone) {
    assert.ok(
      !item.personal,
      `"${item.label}" would be pushed to every phone in the company. Member deadlines are HR-file facts — ` +
        'v330 made the record admin-only in the rules and v333 routed personal celebrations to admins.',
    );
    assert.ok(
      !item.label.includes('Katharina Moser'),
      'a colleague is named in the team-wide digest',
    );
  }

  const admins = groups.filter((g) => g.audience === 'admins').flatMap((g) => g.items);
  assert.equal(admins.length, 4, 'all four personal deadlines must still be delivered — to admins');
  assert.equal(everyone.length, 1, 'the shared calendar entry must still reach the team');
});

// --- 6. the two business digests must not overwrite each other -------------
test('the split digests carry different tags', () => {
  const due = [
    { label: "A's passport expires today", days: 0, personal: true },
    { label: 'Tomorrow: Site inspection', days: 1, personal: false },
  ];
  const tags = splitDigests(due, { isBusiness: true }).map((g) => g.tagSuffix);
  assert.equal(new Set(tags).size, tags.length,
    'both business digests share a notification tag — a tag is a REPLACEMENT key, so one silently ' +
    'overwrites the other on the phone. Same trap the celebrations loop hit with two same-day birthdays.');
});

// --- 7. a family space is untouched ----------------------------------------
test('a family space still gets exactly one digest of everything', () => {
  const due = [...memberDeadlines(EMPLOYEE, TODAY), ...tomorrowsEvents([{ date: inDays(1), title: 'Dentist' }], TODAY)];
  const groups = splitDigests(due, { isBusiness: false });
  assert.equal(groups.length, 1, 'a household must not be split — hiding a child\'s check-up from a parent helps nobody');
  assert.equal(groups[0].audience, 'everyone');
  assert.equal(groups[0].items.length, 5);
  assert.equal(groups[0].tagSuffix, '', 'the family tag must not change — an existing notification would stack');
});

// --- 8. nobody gets a digest of nothing ------------------------------------
test('empty groups are dropped', () => {
  assert.deepEqual(splitDigests([], { isBusiness: true }), []);
  assert.deepEqual(splitDigests([], { isBusiness: false }), []);
  const onlyShared = splitDigests([{ label: 'Tomorrow: X', days: 1, personal: false }], { isBusiness: true });
  assert.equal(onlyShared.length, 1, 'a business with no personal deadlines must not send an empty admin digest');
  assert.equal(onlyShared[0].audience, 'everyone');
});

// --- 9. the body leads with the most urgent --------------------------------
test('digestText sorts and truncates', () => {
  const { title, body } = digestText([
    { label: 'in 90', days: 90 }, { label: 'today', days: 0 }, { label: 'in 7', days: 7 },
  ]);
  assert.equal(title, '3 things need attention');
  assert.equal(body, 'today\nin 7\n…and 1 more');
  assert.equal(digestText([{ label: 'one', days: 0 }]).title, 'Teluva reminder');
});

// --- 10. server.js must actually route through the split -------------------
test('the cron honours the split', () => {
  const server = readFileSync(resolve(here, '..', 'server.js'), 'utf8');
  const block = server.match(/if \(due\.length === 0\) continue;[\s\S]*?\n {2}\}\n/);
  assert.ok(block, 'the digest block moved — re-point this guard');
  assert.match(
    block[0],
    /splitDigests\(due, \{ isBusiness: spaceIsBusiness \}\)/,
    'the nightly digest no longer asks who may hear it. Before v337 this was a single sendToFamily, which ' +
      'pushed "<employee>\'s residence permit expires in 7 days" to every phone in the company.',
  );
  assert.match(block[0], /group\.audience === 'admins' \? sendToAdmins : sendToFamily/,
    'the admin group is not routed to sendToAdmins');
  assert.ok(
    !/notificationsSent \+= await sendToFamily\(familyRef, \{\s*title,/.test(block[0]),
    'a direct family-wide send is back in the digest block',
  );
});
