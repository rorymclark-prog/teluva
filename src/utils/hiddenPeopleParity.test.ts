// Parity test: the app's hidden-people filter and the server's must agree.
//
//   npx tsx src/utils/hiddenPeopleParity.test.ts
//
// WHY. The app hides a person's dates with src/utils/hiddenPeople.ts. The
// published .ics feed and the daily reminders run on the server, which cannot
// import a .ts module and carries a port (server/hiddenPeople.mjs). If the two
// drift, somebody hides Nora in the app and her birthday still arrives on
// their phone — the exact thing they asked to stop. So the keyword lists must
// be identical, and every fixture below runs through BOTH with the same answer.
import assert from 'node:assert';
import * as client from './hiddenPeople';
import { BIRTHDAY_KEYWORDS as clientBirthday, ANNIVERSARY_KEYWORDS as clientAnniversary } from './eventKeywordFlags';
import * as server from '../../server/hiddenPeople.mjs';

assert.deepStrictEqual([...server.BIRTHDAY_KEYWORDS], [...clientBirthday], 'server BIRTHDAY_KEYWORDS must match eventKeywordFlags.ts exactly');
assert.deepStrictEqual([...server.ANNIVERSARY_KEYWORDS], [...clientAnniversary], 'server ANNIVERSARY_KEYWORDS must match eventKeywordFlags.ts exactly');

const at = '2026-09-14T10:00:00.000Z';
const LISTS = [
  [[{ id: 'member:m-nora', name: 'Nora', hiddenAt: at }]],
  [[{ id: 'extended:eb-klara', name: 'Aunt Klara', hiddenAt: at }], [{ id: 'member:m-papa', name: 'Papa', hiddenAt: at }]],
  [[{ id: 'extended:eb-may', name: 'May', hiddenAt: at }]],
  [[], undefined],
];
const CURRENT = { members: [{ id: 'm-nora', name: 'Nora Berg' }, { id: 'm-papa', name: 'Papa' }], extendedBirthdays: [{ id: 'eb-klara', name: 'Aunt Klára' }] };

const EVENTS = [
  { title: "Nora's birthday" }, { title: 'Dinner with Nora' }, { title: 'Nora Berg bday' },
  { title: 'Klaras Geburtstag' }, { title: "Aunt Mira's birthday" }, { title: 'Klarabella birthday' },
  { title: 'Birthday lunch', memberIds: ['m-nora'] }, { title: 'Birthday lunch', memberIds: ['m-nora', 'm-mama'] },
  { title: 'Wedding anniversary', memberIds: ['m-mama', 'm-papa'] }, { title: 'Hochzeitstag Papa' },
  { title: "May's birthday" }, { title: 'Birthday party in May' }, { title: 'Namenstag Nora' },
  { title: '' }, {},
];
const ANNIVERSARIES = [
  { title: 'Wedding', memberIds: ['m-papa', 'm-nora'] }, { title: 'Papa & Nora engaged' }, { title: 'Wedding', memberIds: ['m-mama'] },
];
const PEOPLE = [{ id: 'm-nora', name: 'Nora' }, { id: 'm-papa', name: 'Papa' }, { id: 'm-mama', name: 'Mama' }];
const EXTENDED = [{ id: 'eb-klara', name: 'Aunt Klara' }, { id: 'eb-may', name: 'May' }, { id: 'eb-oma', name: 'Oma' }];

let checked = 0;
for (const lists of LISTS) {
  const c = client.buildHiddenPeople(lists as never, CURRENT);
  const s = server.buildHiddenPeople(lists, CURRENT);
  assert.deepStrictEqual([...s.keys].sort(), [...c.keys].sort(), `keys differ for ${JSON.stringify(lists)}`);
  assert.deepStrictEqual([...s.names], [...c.names], `names differ for ${JSON.stringify(lists)}`);
  for (const ev of EVENTS) {
    assert.strictEqual(server.eventIsHiddenDate(ev, s), client.eventIsHiddenDate(ev, c), `eventIsHiddenDate disagrees on ${JSON.stringify(ev)} with ${JSON.stringify(lists)}`);
    checked++;
  }
  for (const a of ANNIVERSARIES) {
    assert.strictEqual(server.anniversaryIsHidden(a, s), client.anniversaryIsHidden(a, c), `anniversaryIsHidden disagrees on ${JSON.stringify(a)}`);
    checked++;
  }
  assert.deepStrictEqual(server.visibleDateMembers(PEOPLE, s), client.visibleDateMembers(PEOPLE, c), 'visibleDateMembers disagrees');
  assert.deepStrictEqual(server.visibleExtendedBirthdays(EXTENDED, s), client.visibleExtendedBirthdays(EXTENDED, c), 'visibleExtendedBirthdays disagrees');
  checked += 2;
}

// CONTROL: the comparison above can fail — two different hidden sets give
// different answers on the same fixture, so "they agree" is not vacuous.
{
  const c = client.buildHiddenPeople(LISTS[0] as never, CURRENT);
  const s = server.buildHiddenPeople(LISTS[2], CURRENT);
  assert.notStrictEqual(server.eventIsHiddenDate({ title: "Nora's birthday" }, s), client.eventIsHiddenDate({ title: "Nora's birthday" }, c));
}

// HIDDEN FROM CHOSEN ACCOUNTS (v355). The app works out "what this account
// no longer sees" from three lists; the feed and the reminders work it out on
// the server from the same three. The per-account answer must be identical for
// every account — a ticked one, an unticked one, one on the list twice, a
// malformed entry — or an admin hides Nora from Papa in the app and her
// birthday still lands in his calendar subscription.
const FOR_SOME = [
  { id: 'member:m-nora', name: 'Nora', hiddenAt: at, forUids: ['u-papa', 'u-mama', 'u-papa'] },
  { id: 'extended:eb-klara', name: 'Aunt Klara', hiddenAt: at, forUids: ['u-ben'] },
  { id: 'extended:eb-may', name: 'May', hiddenAt: at, forUids: [] },
  { id: 'extended:eb-oma', name: 'Oma', hiddenAt: at, forUids: 'u-papa' },
  { id: 'member:m-papa', name: 'Papa', hiddenAt: at, forUids: [42, '', 'u-mia'] },
];
const PERSONAL = { 'u-papa': [{ id: 'extended:eb-klara', name: 'Aunt Klara', hiddenAt: at }], 'u-mama': undefined, 'u-mia': [], 'u-ben': null, 'u-none': undefined } as const;
const FAMILY = [[], [{ id: 'extended:eb-oma', name: 'Oma', hiddenAt: at }], undefined];
let accountsChecked = 0;
for (const family of FAMILY) {
  for (const uid of [...Object.keys(PERSONAL), null]) {
    const personal = uid ? PERSONAL[uid as keyof typeof PERSONAL] : undefined;
    assert.deepStrictEqual(server.hiddenForAccount(FOR_SOME, uid), client.hiddenForAccount(FOR_SOME as never, uid), `hiddenForAccount disagrees for ${uid}`);
    const cl = client.accountHiddenLists({ personal: personal as never, family: family as never, forSome: FOR_SOME as never, uid });
    const sl = server.accountHiddenLists({ personal, family, forSome: FOR_SOME, uid });
    assert.deepStrictEqual(sl, cl, `accountHiddenLists disagrees for ${uid}`);
    const c = client.buildHiddenPeople(cl, CURRENT);
    const s = server.buildHiddenPeople(sl, CURRENT);
    assert.deepStrictEqual([...s.keys].sort(), [...c.keys].sort(), `effective keys differ for ${uid}`);
    assert.deepStrictEqual([...s.names], [...c.names], `effective names differ for ${uid}`);
    for (const ev of EVENTS) {
      assert.strictEqual(server.eventIsHiddenDate(ev, s), client.eventIsHiddenDate(ev, c), `eventIsHiddenDate disagrees on ${JSON.stringify(ev)} for ${uid}`);
      checked++;
    }
    accountsChecked++;
  }
}
// What the fixtures mean, so "they agree" is agreement on the RIGHT answer.
{
  const keysFor = (uid: string | null) => [...client.buildHiddenPeople(client.accountHiddenLists({ personal: undefined, family: [], forSome: FOR_SOME as never, uid }), CURRENT).keys].sort();
  assert.deepStrictEqual(keysFor('u-papa'), ['member:m-nora'], 'Papa was ticked for Nora only (Oma\'s malformed forUids names nobody)');
  assert.deepStrictEqual(keysFor('u-mia'), ['member:m-papa'], 'the good uid in a messy list still counts');
  assert.deepStrictEqual(keysFor('u-none'), [], 'CONTROL: an account nobody ticked keeps every date');
  assert.deepStrictEqual(keysFor(null), [], 'signed out: nothing from the chosen-accounts list');
  // CONTROL: the per-account answers really differ, so the loop above is not
  // comparing two empty sets.
  const papaServer = server.buildHiddenPeople(server.accountHiddenLists({ personal: undefined, family: [], forSome: FOR_SOME, uid: 'u-papa' }), CURRENT);
  const benClient = client.buildHiddenPeople(client.accountHiddenLists({ personal: undefined, family: [], forSome: FOR_SOME as never, uid: 'u-ben' }), CURRENT);
  assert.notStrictEqual(server.eventIsHiddenDate({ title: "Nora's birthday" }, papaServer), client.eventIsHiddenDate({ title: "Nora's birthday" }, benClient));
}

console.log(`hiddenPeopleParity.test.ts: ${checked} fixtures agree (${accountsChecked} per-account sets), ${clientBirthday.length} + ${clientAnniversary.length} keywords identical`);
