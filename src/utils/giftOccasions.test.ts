// Standalone assertion test — no test runner is configured in this project,
// so run it directly:  npx tsx src/utils/giftOccasions.test.ts
// Exits non-zero on failure. Mirrors nameDay.test.ts's style (plain assert,
// not assert/strict) since this module is nameDay's direct sibling and
// consumer.
//
// What is actually worth testing here:
//   * each member gets exactly ONE occasion — the soonest of birthday /
//     stored name day / Christmas — never all three, never a suggested
//     (unconfirmed) name day;
//   * the year-wrap and leap-year collapse are inherited correctly from
//     nameDay.ts's own daysUntilNameDay, not reimplemented and drifted;
//   * wishlist items are scoped per member and never dropped (bought or not).
import assert from 'node:assert';
import { buildGiftOccasions } from './giftOccasions';
import { daysUntilNameDay } from './nameDay';
import { FamilyMember, FavoriteItem } from '../types';

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1', name: 'Test Person', role: 'Parent',
    avatarColor: 'bg-clay-500', clothingSizes: {}, documents: [],
    ...overrides,
  };
}

function fav(overrides: Partial<FavoriteItem> & { id: string; title: string }): FavoriteItem {
  return {
    category: 'Toy',
    imageUrl: '',
    addedAt: '2026-01-01',
    ...overrides,
  };
}

function findMember(result: ReturnType<typeof buildGiftOccasions>, kind: string, memberId: string) {
  const group = result.groups.find((g) => g.kind === kind);
  return group?.members.find((m) => m.memberId === memberId);
}

/* ---------------- 1: soonest-occasion selection, birthday wins ---------------- */
{
  const now = new Date(2026, 7, 15); // 15 Aug 2026
  const m = member({
    birthdate: '1990-08-20', // 5 days out
    nameDay: '12-04', nameDayFeast: 'Hl. Barbara', // far out
  });
  const result = buildGiftOccasions({ members: [m], now });

  const hit = findMember(result, 'birthday', 'm1');
  assert.ok(hit, 'must land in the birthday group');
  assert.strictEqual(hit!.daysUntil, 5);
  assert.strictEqual(findMember(result, 'nameDay', 'm1'), undefined, 'must not also appear in nameDay');
  assert.strictEqual(findMember(result, 'christmas', 'm1'), undefined, 'must not also appear in christmas');
}

/* ---------------- 2: soonest-occasion selection, name day wins ---------------- */
{
  const now = new Date(2026, 7, 15); // 15 Aug 2026
  const m = member({
    birthdate: '1990-05-01', // far in the future month-day relative to now
    nameDay: '08-18', nameDayFeast: 'Hl. Helena', // 3 days out
  });
  const result = buildGiftOccasions({ members: [m], now });

  const hit = findMember(result, 'nameDay', 'm1');
  assert.ok(hit, 'must land in the nameDay group');
  assert.strictEqual(hit!.daysUntil, 3);
  assert.strictEqual(hit!.feast, 'Hl. Helena', 'feast must be carried through');
}

/* ---------------- 3: soonest-occasion selection, Christmas wins ---------------- */
{
  const now = new Date(2026, 11, 20); // 20 Dec 2026 — close to Christmas
  const m = member({
    birthdate: '1990-02-10', // Feb — far later than 25 Dec relative to now
    nameDay: '02-15', nameDayFeast: 'Hl. Faustina', // Feb — also far later
  });
  const result = buildGiftOccasions({ members: [m], now });

  const hit = findMember(result, 'christmas', 'm1');
  assert.ok(hit, 'must land in the christmas group');
  assert.strictEqual(hit!.daysUntil, 5);
}

/* ---------------- 4: year-wrap when an occasion already passed ---------------- */
{
  // now deliberately near year-end (mirrors nameDay.test.ts's own wrap case,
  // daysUntilNameDay('01-02', new Date(2026, 11, 31))) rather than Aug: with
  // an Aug "now", a January birthday wraps to ~148 days out, which is FURTHER
  // than the always-present Christmas candidate (~132 days) and Christmas
  // would win instead — this "now" keeps the wrapped birthday (10 days)
  // genuinely closer than the next Christmas (359 days, since this year's
  // has also just passed), so it actually exercises the wrap path.
  const now = new Date(2026, 11, 31); // 31 Dec 2026
  const m = member({ birthdate: '1990-01-10' }); // already passed this year
  const result = buildGiftOccasions({ members: [m], now });

  const hit = findMember(result, 'birthday', 'm1');
  assert.ok(hit, 'must land in the birthday group, wrapped to next year');
  // 31 Dec 2026 -> 10 Jan 2027: 10 days
  assert.strictEqual(hit!.daysUntil, 10);
  assert.ok(hit!.daysUntil >= 0, 'must never be negative');
}

/* ---------------- 5: no birthdate, no stored name day -> Christmas-only ---------------- */
{
  const now = new Date(2026, 7, 15);
  const m = member({ name: 'Nomvula' }); // no birthdate, no nameDay, and not in the calendar
  const result = buildGiftOccasions({ members: [m], now });

  assert.ok(findMember(result, 'christmas', 'm1'), 'must appear in christmas');
  assert.strictEqual(findMember(result, 'birthday', 'm1'), undefined);
  assert.strictEqual(findMember(result, 'nameDay', 'm1'), undefined);
}

/* ---------------- 6: the 'suggested' name-day branch is excluded ---------------- */
{
  const now = new Date(2026, 7, 15);
  // No nameDay/nameDayFeast stored, but 'Josef' matches nameDay.ts's calendar —
  // resolveNameDay would return {source: 'suggested', ...}. That must NOT
  // produce a nameDay candidate here.
  const m = member({ name: 'Josef Huber' });
  const result = buildGiftOccasions({ members: [m], now });

  assert.strictEqual(findMember(result, 'nameDay', 'm1'), undefined, 'a suggested (unconfirmed) name day must never create a candidate');
  assert.ok(findMember(result, 'christmas', 'm1'), 'falls back to christmas (no birthdate set)');
}

/* ---------------- 7: malformed stored nameDay still falls back correctly ---------------- */
{
  const now = new Date(2026, 7, 15);
  // Mirrors nameDay.test.ts's `rubbish` case: resolveNameDay returns
  // {source: 'suggested'} for this (Josef is in the calendar, so the malformed
  // stored value falls back to a suggestion, not null) — per case 6's rule
  // this member must not get a nameDay candidate either.
  const m = member({ name: 'Josef', nameDay: 'not-a-date' });
  const result = buildGiftOccasions({ members: [m], now });

  assert.strictEqual(findMember(result, 'nameDay', 'm1'), undefined);
  assert.ok(findMember(result, 'christmas', 'm1'));
}

/* ---------------- 8: wishlist items grouping is correctly scoped per member ---------------- */
{
  const now = new Date(2026, 7, 15);
  const a = member({
    id: 'a', name: 'Alice',
    favorites: [
      fav({ id: 'a1', title: 'Alice wishlist item', isWishlist: true }),
      fav({ id: 'a2', title: 'Alice owned item', isWishlist: false }),
    ],
  });
  const b = member({
    id: 'b', name: 'Bob',
    favorites: [
      fav({ id: 'b1', title: 'Bob wishlist item', isWishlist: true }),
      fav({ id: 'b2', title: 'Bob unflagged item' }), // isWishlist undefined
    ],
  });
  const result = buildGiftOccasions({ members: [a, b], now });

  const aHit = findMember(result, 'christmas', 'a');
  const bHit = findMember(result, 'christmas', 'b');
  assert.ok(aHit && bHit);
  assert.strictEqual(aHit!.wishlistItems.length, 1);
  assert.strictEqual(aHit!.wishlistItems[0].id, 'a1');
  assert.strictEqual(bHit!.wishlistItems.length, 1);
  assert.strictEqual(bHit!.wishlistItems[0].id, 'b1');
}

/* ---------------- 9: valid occasion, zero wishlist items still appears ---------------- */
{
  const now = new Date(2026, 7, 15);
  const m = member({ id: 'c', name: 'Cara', favorites: [] });
  const result = buildGiftOccasions({ members: [m], now });

  const hit = findMember(result, 'christmas', 'c');
  assert.ok(hit, 'member with no wishlist items must still appear');
  assert.deepStrictEqual(hit!.wishlistItems, []);
}

/* ---------------- 10: bought items are still included, not filtered out ---------------- */
{
  const now = new Date(2026, 7, 15);
  const m = member({
    id: 'd', name: 'Dora',
    favorites: [fav({ id: 'd1', title: 'Already bought', isWishlist: true, bought: true })],
  });
  const result = buildGiftOccasions({ members: [m], now });

  const hit = findMember(result, 'christmas', 'd');
  assert.strictEqual(hit!.wishlistItems.length, 1);
  assert.strictEqual(hit!.wishlistItems[0].bought, true);
}

/* ---------------- 11: tie-break ordering ---------------- */
{
  const now = new Date(2026, 7, 15);
  const zack = member({ id: 'z', name: 'Zack' }); // christmas-only
  const amy = member({ id: 'y', name: 'Amy' });   // christmas-only, same daysUntil
  const result = buildGiftOccasions({ members: [zack, amy], now });

  const group = result.groups.find((g) => g.kind === 'christmas')!;
  assert.strictEqual(group.members.length, 2);
  assert.strictEqual(group.members[0].daysUntil, group.members[1].daysUntil, 'both must tie on daysUntil for this to test the tie-break');
  assert.strictEqual(group.members[0].memberName, 'Amy', 'Amy sorts before Zack alphabetically');
  assert.strictEqual(group.members[1].memberName, 'Zack');
}

/* ---------------- 12: groups sorted soonest-first overall; members within a group sorted soonest-first ---------------- */
{
  const now = new Date(2026, 7, 15); // 15 Aug 2026
  const soonBirthday = member({ id: 'p1', name: 'Pia', birthdate: '1990-08-17' }); // 2 days out
  const laterBirthday = member({ id: 'p2', name: 'Leo', birthdate: '1990-08-20' }); // 5 days out
  const nameDayOnly = member({ id: 'p3', name: 'Nadia', nameDay: '09-01', nameDayFeast: 'Hl. Verena' }); // well over 5 days out
  const result = buildGiftOccasions({ members: [soonBirthday, laterBirthday, nameDayOnly], now });

  assert.strictEqual(result.groups[0].kind, 'birthday', 'the group with the overall-soonest occasion must be first');
  const birthdayGroup = result.groups.find((g) => g.kind === 'birthday')!;
  assert.strictEqual(birthdayGroup.members.length, 2);
  assert.ok(birthdayGroup.members[0].daysUntil <= birthdayGroup.members[1].daysUntil, 'members within a group are soonest-first');
  assert.strictEqual(birthdayGroup.members[0].memberId, 'p1');
}

/* ---------------- 13: leap-year birthdate doesn't crash ---------------- */
{
  const now = new Date(2027, 1, 28); // 28 Feb 2027 — not a leap year
  const m = member({ birthdate: '2000-02-29' }); // 2000 was a leap year
  const result = buildGiftOccasions({ members: [m], now });

  const hit = findMember(result, 'birthday', 'm1');
  assert.ok(hit, 'must not crash, and must land in birthday (collapsed 29 Feb -> 28 Feb)');
  assert.strictEqual(hit!.daysUntil, 0);
}

/* ---------------- 14: zero-state ---------------- */
{
  const result = buildGiftOccasions({ members: [], now: new Date(2026, 7, 15) });
  assert.strictEqual(result.groups.length, 0);
  assert.strictEqual(result.isEmpty, true);
}

/* ---------------- 15: Christmas date arithmetic sanity (cross-check against nameDay.ts's own math) ---------------- */
{
  const now = new Date(2026, 7, 15);
  const m = member({ id: 'x', name: 'Xavier' }); // christmas-only
  const result = buildGiftOccasions({ members: [m], now });
  const hit = findMember(result, 'christmas', 'x');

  // Reuse the exact same daysUntilNameDay utility this module delegates to,
  // rather than a hardcoded number, so this test can't silently drift from
  // nameDay.ts's own math.
  assert.strictEqual(hit!.daysUntil, daysUntilNameDay('12-25', now));
}

console.log('giftOccasions.test.ts: all assertions passed');
