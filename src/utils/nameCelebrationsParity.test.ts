// Parity test: the client's resolveCelebrations and the server's must agree.
//
//   npx tsx src/utils/nameCelebrationsParity.test.ts
//
// WHY. "What does this person actually celebrate" is not one field — it is the
// legacy nameDay/nameDayFeast pair, the nameCelebrations[] array that replaced
// it, and the cron's per-year cache for movable rules, merged. The client owns
// that merge (src/utils/nameCelebrations.ts). The published .ics feed runs on
// the server, cannot import a .ts module, and therefore carries a port of it
// (server/nameCelebrations.mjs).
//
// Two copies of a merge this fiddly WILL drift, and the drift would be silent
// and horrible in a specific way: a family looks at the app, sees 19 March,
// subscribes their phone to the feed, and gets a different day — or nothing.
// So every fixture below runs through BOTH implementations and the results
// must be deep-equal. Change one side without the other and this fails.
//
// The fixtures are deliberately the awkward cases: they exist because each one
// was a decision in the original module, and a port is exactly where a
// decision gets quietly dropped.
import assert from 'node:assert';
import { resolveCelebrations as client } from './nameCelebrations';
import { resolveCelebrations as server } from '../../server/nameCelebrations.mjs';
import type { CelebrationsMember } from './nameCelebrations';
import type { NameCelebration } from '../types';

const celebration = (over: Partial<NameCelebration> & { id: string }): NameCelebration => ({
  kind: 'name_day',
  title: 'Hl. Josef',
  celebrationOf: 'Josef',
  matchType: 'exact',
  tradition: 'Austrian Namenskalender',
  explanation: 'Because.',
  dateType: 'fixed',
  date: '03-19',
  confirmed: true,
  primary: false,
  notify: true,
  ...over,
});

const movable = (over: Partial<NameCelebration> & { id: string }): NameCelebration => celebration({
  kind: 'name_celebration',
  title: 'Nityananda Trayodashi',
  celebrationOf: 'Shyam',
  matchType: 'exact',
  tradition: 'Gaudiya Vaishnava',
  dateType: 'movable',
  date: undefined,
  movableRule: 'Magha Shukla Trayodashi',
  ...over,
});

const cases: { label: string; member: CelebrationsMember }[] = [
  { label: 'nothing at all', member: { name: 'Nomvula' } },
  { label: 'no name either', member: {} },

  // The legacy pair on its own — becomes an implicit confirmed primary.
  { label: 'legacy pair only', member: { name: 'Josef Huber', nameDay: '03-19', nameDayFeast: 'Hl. Josef' } },
  { label: 'legacy day with no feast name', member: { name: 'Josef', nameDay: '03-19' } },
  { label: 'legacy day that is not a real date', member: { name: 'Josef', nameDay: 'not-a-date' } },
  { label: 'legacy 29 February', member: { name: 'Josef', nameDay: '02-29', nameDayFeast: 'Leap feast' } },
  // celebrationOf falls back to the nickname when there is no given name.
  { label: 'nickname only', member: { nickname: 'Sepp', nameDay: '03-19' } },
  { label: 'hyphenated first name', member: { name: 'Anna-Maria Gruber', nameDay: '07-26' } },

  // The migration case: an explicit confirmed PRIMARY name_day on the same
  // fixed date IS the migrated Namenstag, so the implicit one is dropped.
  {
    label: 'migrated — explicit confirmed primary on the same date',
    member: { name: 'Josef', nameDay: '03-19', nameCelebrations: [celebration({ id: 'migrated', primary: true })] },
  },
  // ...but a NON-primary duplicate must not displace it, or the member is left
  // with no primary at all and their name day vanishes from every surface.
  {
    label: 'same date but not primary — the legacy entry survives',
    member: { name: 'Josef', nameDay: '03-19', nameCelebrations: [celebration({ id: 'dupe', primary: false })] },
  },
  // An explicit primary on a DIFFERENT date demotes the legacy entry (which is
  // how a family silences the Namenstag push without deleting the field).
  {
    label: 'explicit primary elsewhere demotes the legacy entry',
    member: { name: 'Josef', nameDay: '03-19', nameCelebrations: [celebration({ id: 'other', date: '05-01', primary: true })] },
  },
  {
    label: 'explicit primary is unconfirmed — legacy keeps primary',
    member: { name: 'Josef', nameDay: '03-19', nameCelebrations: [celebration({ id: 'proposed', date: '05-01', primary: true, confirmed: false })] },
  },
  {
    label: 'two confirmed primaries — first in merge order wins',
    member: { nameCelebrations: [celebration({ id: 'a', primary: true }), celebration({ id: 'b', date: '05-01', primary: true })] },
  },
  {
    label: 'confirmed but nothing primary',
    member: { nameCelebrations: [celebration({ id: 'a' }), celebration({ id: 'b', date: '05-01' })] },
  },
  {
    label: 'only unconfirmed proposals',
    member: { name: 'Ganga', nameCelebrations: [celebration({ id: 'p1', confirmed: false, primary: true })] },
  },

  // The cron's sibling cache folds in, and confirm-time resolutions win.
  {
    label: 'movable with cron-resolved years',
    member: {
      name: 'Shyam',
      nameCelebrations: [movable({ id: 'nit', confirmed: true, primary: true })],
      nameCelebrationResolvedDates: { nit: { '2026': '2026-02-09', '2027': '2027-01-30' } },
    },
  },
  {
    label: 'confirm-time resolution beats the cron cache for the same year',
    member: {
      nameCelebrations: [movable({ id: 'nit', confirmed: true, primary: true, resolvedDates: { '2026': '2026-02-08' } })],
      nameCelebrationResolvedDates: { nit: { '2026': '2026-02-09', '2027': '2027-01-30' } },
    },
  },
  {
    label: 'cron cache for a celebration that no longer exists',
    member: { nameCelebrations: [celebration({ id: 'a', primary: true })], nameCelebrationResolvedDates: { deleted: { '2026': '2026-02-09' } } },
  },
  {
    label: 'movable with nothing resolved yet',
    member: { nameCelebrations: [movable({ id: 'nit', confirmed: true, primary: true })] },
  },
  {
    label: 'legacy pair alongside a confirmed movable extra',
    member: {
      name: 'Shyam Josef',
      nameDay: '03-19',
      nameDayFeast: 'Hl. Josef',
      nameCelebrations: [movable({ id: 'nit', confirmed: true, primary: false })],
      nameCelebrationResolvedDates: { nit: { '2026': '2026-02-09' } },
    },
  },
  {
    label: 'dismissed flag does not affect the resolved view',
    member: { name: 'Josef', nameDay: '03-19', nameCelebrationDismissed: true },
  },
  { label: 'nameCelebrations is an empty array', member: { name: 'Josef', nameCelebrations: [] } },
];

let checked = 0;
for (const { label, member } of cases) {
  const a = client(member);
  const b = server(member);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(b)),
    JSON.parse(JSON.stringify(a)),
    `resolveCelebrations disagrees between src/utils/nameCelebrations.ts and server/nameCelebrations.mjs for "${label}" — the app and the published feed would show different days`,
  );
  // Guard against a fixture table that proves nothing because both sides
  // return empty for everything.
  checked += a.all.length;
}

assert.ok(checked > 0, 'the parity fixtures resolved nothing at all — they cannot be proving agreement');

// The server copy is additionally hardened against junk the client's types
// make impossible but a Firestore document does not. Asserted only on the
// server side, since the client would throw.
assert.deepStrictEqual(
  server({ nameCelebrations: [null, 'nonsense', celebration({ id: 'real', primary: true })] }).all.map((c: NameCelebration) => c.id),
  ['real'],
  'the server merge must skip malformed array entries rather than throw mid-feed',
);
assert.deepStrictEqual(server(null).all, [], 'a missing member document is not a crash');
assert.deepStrictEqual(
  server({ nameDay: '03-19', nameCelebrationResolvedDates: 'nonsense' }).all.length,
  1,
  'a malformed cron cache must not take the legacy name day down with it',
);

console.log(`nameCelebrationsParity.test.ts — ${cases.length} fixtures agree across both implementations`);
