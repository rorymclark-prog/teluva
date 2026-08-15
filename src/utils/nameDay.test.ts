// Standalone assertion test — no test runner is configured in this project,
// so run it directly:  npx tsx src/utils/nameDay.test.ts
// Exits non-zero on failure.
//
// What is actually worth testing here is NOT that the table has the right dates
// (a test written from the same head as the table proves nothing about that).
// It is the two behaviours the product depends on:
//   * a name with no name day gets NOTHING — no nearest match, no rhyme;
//   * a stored name day always wins over the table, because it is the family's
//     own answer and the table is only ever a suggestion.
import assert from 'node:assert';
import {
  suggestNameDay,
  resolveNameDay,
  isValidNameDay,
  formatNameDay,
  daysUntilNameDay,
  NAME_DAY_CATALOG_SIZE,
} from './nameDay';

// --- names with no name day: the ordinary case, and the one that must not guess ---

// These are real names in this app's own family. None of them belongs to the
// Austrian sanctoral calendar, and a suggestion for any of them would be
// invented. If a future edit makes one of these return a date, that edit is
// wrong however plausible its date looks.
for (const name of ['Shyam', 'Nomvula', 'Thandiwe', 'Sipho', 'Ayesha', 'Rory', 'Kayla', 'Bheki']) {
  assert.strictEqual(suggestNameDay(name), null, `${name} must get no name day, not a plausible one`);
}
assert.strictEqual(suggestNameDay(''), null);
assert.strictEqual(suggestNameDay(undefined, undefined), null);
assert.strictEqual(suggestNameDay('   '), null);

// --- the ordinary lookups ---

assert.strictEqual(suggestNameDay('Josef Klarer')?.date, '03-19');
assert.strictEqual(suggestNameDay('Josef')?.feast, 'Hl. Josef');
assert.strictEqual(suggestNameDay('Leopold')?.date, '11-15');
assert.strictEqual(suggestNameDay('Barbara')?.date, '12-04');
assert.strictEqual(suggestNameDay('Martin')?.date, '11-11');

// The first given name wins — a name day belongs to the name you are called by,
// and "Anna Barbara" is congratulated on Anna's day.
assert.strictEqual(suggestNameDay('Anna Barbara Huber')?.matched, 'Anna');

// Nickname is the last resort, not the first: a Sepp on the passport as Josef
// matches Josef, but a Mia recorded ONLY as a nickname still finds Maria.
assert.strictEqual(suggestNameDay('Josef Huber', 'Sepp')?.matched, 'Josef');
assert.strictEqual(suggestNameDay('Shyam Clark', 'Mia')?.matched, 'Maria');

// --- spelling: umlauts typed both ways, case, and hyphenated names ---

assert.strictEqual(suggestNameDay('JOSEF')?.date, '03-19');
assert.strictEqual(suggestNameDay('  josef  ')?.date, '03-19');
assert.strictEqual(suggestNameDay('Jürgen')?.matched, 'Georg', 'ü stripped');
assert.strictEqual(suggestNameDay('Juergen')?.matched, 'Georg', 'ue transliterated');
assert.strictEqual(suggestNameDay('Anna-Maria')?.matched, 'Anna', 'hyphenated double name splits');
assert.strictEqual(suggestNameDay('Matthäus')?.date, '09-21');

// Aliases across languages keep the same saint.
assert.strictEqual(suggestNameDay('John')?.matched, 'Johannes');
assert.strictEqual(suggestNameDay('Giuseppe')?.matched, 'Josef');
assert.strictEqual(suggestNameDay('Katie')?.matched, 'Katharina');

// --- names with two real days: both offered, neither silently chosen ---

const maria = suggestNameDay('Maria');
assert.strictEqual(maria?.date, '09-12', 'Mariä Namen is the name day proper');
assert.strictEqual(maria?.alsoOn?.date, '08-15', 'Mariä Himmelfahrt offered as the alternative');
assert.strictEqual(suggestNameDay('Benedikt')?.alsoOn?.date, '07-11');

// --- stored beats suggested, always ---

const stored = resolveNameDay({ name: 'Maria', nameDay: '08-15', nameDayFeast: 'Mariä Himmelfahrt' });
assert.strictEqual(stored?.source, 'stored');
assert.strictEqual((stored as any).date, '08-15', 'the family chose the 15th; the table must not overrule it');

// A stored day on a name the calendar has never heard of is still honoured —
// that is the whole point of letting a family set one by hand.
const chosen = resolveNameDay({ name: 'Nomvula', nameDay: '06-16' });
assert.strictEqual(chosen?.source, 'stored');
assert.strictEqual((chosen as any).date, '06-16');

// Rubbish in the stored field falls back to the suggestion rather than
// rendering "NaN undefined" on someone's profile.
const rubbish = resolveNameDay({ name: 'Josef', nameDay: 'not-a-date' });
assert.strictEqual(rubbish?.source, 'suggested');
assert.strictEqual(resolveNameDay({ name: 'Nomvula' }), null);

// --- validation + formatting ---

assert.ok(isValidNameDay('03-19'));
assert.ok(isValidNameDay('02-29'), '29 Feb is a real slot in the calendar');
assert.ok(!isValidNameDay('13-01'));
assert.ok(!isValidNameDay('02-30'));
assert.ok(!isValidNameDay('3-19'), 'must be zero-padded');
assert.ok(!isValidNameDay('2026-03-19'), 'a name day has no year');
assert.ok(!isValidNameDay(''));
assert.ok(!isValidNameDay(undefined));

assert.strictEqual(formatNameDay('03-19'), '19 March');
assert.strictEqual(formatNameDay('12-04'), '4 December');
assert.strictEqual(formatNameDay('nonsense'), '', 'never render a half-parsed date');

// --- days until, including the year rollover and the leap-year collapse ---

assert.strictEqual(daysUntilNameDay('03-19', new Date(2026, 2, 19)), 0, 'today');
assert.strictEqual(daysUntilNameDay('03-20', new Date(2026, 2, 19)), 1, 'tomorrow');
assert.strictEqual(daysUntilNameDay('01-02', new Date(2026, 11, 31)), 2, 'crosses into next year');
// 2027 is not a leap year: 29 Feb collapses to the 28th rather than rolling
// into March, which is the same convention OnThisDay uses for birthdays.
assert.strictEqual(daysUntilNameDay('02-29', new Date(2027, 1, 28)), 0);
assert.strictEqual(daysUntilNameDay('02-29', new Date(2028, 1, 28)), 1, 'leap year keeps the 29th');
assert.strictEqual(daysUntilNameDay('rubbish', new Date(2026, 2, 19)), null);

// A truncated table is a silent failure — every family suddenly has no name
// days and nothing errors. Pin a floor.
assert.ok(NAME_DAY_CATALOG_SIZE > 300, `catalog looks truncated: ${NAME_DAY_CATALOG_SIZE} entries`);

console.log('nameDay.test.ts: all assertions passed');
