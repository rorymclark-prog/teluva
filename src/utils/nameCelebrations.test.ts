// Standalone assertion test — no test runner is configured in this project,
// so run it directly:  npx tsx src/utils/nameCelebrations.test.ts
// Exits non-zero on failure.
//
// What matters here is the honesty of the matching, not the table (nameDay's
// own test covers the table):
//   * the hierarchy runs in order AND each match says what it is — a second
//     name match must never look like the first name's own day;
//   * names outside the calendar get NOTHING locally, however tempting a
//     near-miss looks;
//   * a movable date is only ever read from its per-year cache — a missing
//     year is reported, never guessed around.
import assert from 'node:assert';
import { NameCelebration } from '../types';
import {
  resolveCelebrations,
  suggestLocal,
  celebrationDateInYear,
  daysUntilCelebration,
  LEGACY_NAME_DAY_ID,
} from './nameCelebrations';

const celebration = (overrides: Partial<NameCelebration>): NameCelebration => ({
  id: 'c1',
  kind: 'name_celebration',
  title: 'Test celebration',
  celebrationOf: 'Test',
  matchType: 'cultural',
  explanation: 'test fixture',
  dateType: 'fixed',
  date: '06-16',
  confirmed: true,
  primary: false,
  notify: false,
  ...overrides,
});

// --- hierarchy order + labelling ---

// Step 1: a first name the calendar knows is an exact match, nothing else.
const josef = suggestLocal({ name: 'Josef Huber' });
assert.strictEqual(josef?.matchType, 'exact');
assert.strictEqual(josef?.token, 'Josef');
assert.strictEqual(josef?.matchedName, 'Josef');
assert.strictEqual(josef?.date, '03-19');
assert.strictEqual(josef?.viaAlias, false);
assert.strictEqual(josef?.kind, 'name_day');
assert.strictEqual(josef?.tradition, 'Austrian Namenskalender');

// Step 2: a first name that only matches through the alias table is a VARIANT
// and must carry the catalogued name so the UI can explain the mapping.
const sepp = suggestLocal({ name: 'Sepp Huber' });
assert.strictEqual(sepp?.matchType, 'variant');
assert.strictEqual(sepp?.token, 'Sepp');
assert.strictEqual(sepp?.matchedName, 'Josef');
assert.strictEqual(sepp?.viaAlias, true);

// Step 3, THE case the spec names: Rory Michael. Rory has no day and must not
// be converted into one — the suggestion is Michael's day, labelled as the
// second name's, with the token carried so the UI can say so.
const rory = suggestLocal({ name: 'Rory Michael' });
assert.ok(rory, 'Rory Michael must get a second-name suggestion');
assert.strictEqual(rory?.matchType, 'second_name', 'must NOT be presented as an exact match');
assert.strictEqual(rory?.token, 'Michael');
assert.strictEqual(rory?.matchedName, 'Michael');
assert.strictEqual(rory?.date, '09-29');
assert.strictEqual(rory?.viaAlias, false);
assert.ok(rory?.explanation.includes('Michael'), 'the explanation must name the second name');
assert.ok(rory?.explanation.includes('Rory'), 'the explanation must say the first name has no day');

// A second name that itself needed an alias still labels as second_name but
// says the alias was used.
const mike = suggestLocal({ name: 'Rory Mike Clark' });
assert.strictEqual(mike?.matchType, 'second_name');
assert.strictEqual(mike?.token, 'Mike');
assert.strictEqual(mike?.matchedName, 'Michael');
assert.strictEqual(mike?.viaAlias, true);

// Order: an exact or variant first-name match beats any later token.
assert.strictEqual(suggestLocal({ name: 'Josef Michael' })?.matchType, 'exact');
assert.strictEqual(suggestLocal({ name: 'Josef Michael' })?.token, 'Josef');
assert.strictEqual(suggestLocal({ name: 'Sepp Michael' })?.matchType, 'variant');
assert.strictEqual(suggestLocal({ name: 'Sepp Michael' })?.token, 'Sepp');

// Nickname is the last resort and surfaces as a variant — but a given-name
// token still outranks it.
const mia = suggestLocal({ name: 'Shyam Clark', nickname: 'Mia' });
assert.strictEqual(mia?.matchType, 'variant');
assert.strictEqual(mia?.token, 'Mia');
assert.strictEqual(mia?.matchedName, 'Maria');
assert.strictEqual(mia?.viaNickname, true);
assert.strictEqual(suggestLocal({ name: 'Rory Michael', nickname: 'Mia' })?.token, 'Michael');

// --- no invention: the ordinary case for most of the world's names ---

for (const name of ['Shyam', 'Nomvula', 'Kayla', 'Ganga', 'Rory', 'Thandiwe']) {
  assert.strictEqual(suggestLocal({ name }), null, `${name} must get no local suggestion`);
}
assert.strictEqual(suggestLocal({ name: 'Shyam Clark' }), null);
assert.strictEqual(suggestLocal({}), null);
assert.strictEqual(suggestLocal({ name: '   ' }), null);

// --- suggestion suppression ---

// "No name celebration" was a deliberate answer: stop asking.
assert.strictEqual(suggestLocal({ name: 'Josef', nameCelebrationDismissed: true }), null);

// A member who already has an answer needs no suggestion — stored legacy day
// or any confirmed celebration.
assert.strictEqual(suggestLocal({ name: 'Josef', nameDay: '03-19' }), null);
assert.strictEqual(
  suggestLocal({ name: 'Josef', nameCelebrations: [celebration({})] }),
  null,
);
// ...but an UNconfirmed proposal does not count as an answer.
assert.strictEqual(
  suggestLocal({ name: 'Josef', nameCelebrations: [celebration({ confirmed: false })] })?.matchType,
  'exact',
);

// suppressReligiousSuggestions silences the local table too — the
// Namenskalender is a church calendar, so its suggestions are religious.
assert.strictEqual(suggestLocal({ name: 'Josef' }, { suppressReligiousSuggestions: true }), null);
assert.strictEqual(suggestLocal({ name: 'Rory Michael' }, { suppressReligiousSuggestions: true }), null);

// ...while non-religious paths stay intact: celebrations the family already
// confirmed (including religious ones — they are facts now, not suggestions)
// and custom dates keep resolving exactly as before.
const suppressed = resolveCelebrations({
  name: 'Shyam Clark',
  nameCelebrations: [
    celebration({ id: 'custom', matchType: 'custom', kind: 'name_celebration', primary: true, date: '06-16' }),
  ],
});
assert.strictEqual(suppressed.primary?.id, 'custom');
assert.strictEqual(daysUntilCelebration(suppressed.primary!, new Date(2026, 5, 16)).days, 0);

// --- legacy merge ---

const legacy = resolveCelebrations({ name: 'Josef Huber', nameDay: '03-19', nameDayFeast: 'Hl. Josef' });
assert.strictEqual(legacy.primary?.id, LEGACY_NAME_DAY_ID);
assert.strictEqual(legacy.primary?.kind, 'name_day');
assert.strictEqual(legacy.primary?.matchType, 'exact');
assert.strictEqual(legacy.primary?.tradition, 'Austrian Namenskalender');
assert.strictEqual(legacy.primary?.confirmed, true);
assert.strictEqual(legacy.primary?.dateType, 'fixed');
assert.strictEqual(legacy.primary?.date, '03-19');
assert.strictEqual(legacy.primary?.celebrationOf, 'Josef');
assert.ok(legacy.primary?.explanation.includes('Hl. Josef'), 'the feast makes the date checkable');
assert.strictEqual(legacy.additional.length, 0);

// A malformed legacy value contributes nothing rather than a broken entry.
assert.strictEqual(resolveCelebrations({ name: 'Josef', nameDay: 'not-a-date' }).all.length, 0);
assert.deepStrictEqual(resolveCelebrations({ name: 'Nomvula' }), { primary: null, additional: [], all: [] });

// The legacy pair, while it IS the effective primary, notifies — a family
// that never touched the new model keeps its Namenstag push.
assert.strictEqual(legacy.primary?.primary, true);
assert.strictEqual(legacy.primary?.notify, true);

// An explicit confirmed primary wins over the legacy pair; the legacy day is
// still kept, demoted to additional — and a demoted legacy day also stops
// notifying: only the primary notifies by default, or a family choosing a new
// primary would silently gain a second annual push.
const mixed = resolveCelebrations({
  name: 'Josef',
  nameDay: '03-19',
  nameCelebrations: [celebration({ id: 'new-primary', primary: true, date: '06-16' })],
});
assert.strictEqual(mixed.primary?.id, 'new-primary');
assert.strictEqual(mixed.additional.length, 1);
assert.strictEqual(mixed.additional[0].id, LEGACY_NAME_DAY_ID);
assert.strictEqual(mixed.additional[0].primary, false);
assert.strictEqual(mixed.additional[0].notify, false);

// A member migrated to the new model must not celebrate the same day twice:
// an explicit confirmed PRIMARY name_day on the same date replaces the
// implicit entry.
const migrated = resolveCelebrations({
  name: 'Josef',
  nameDay: '03-19',
  nameCelebrations: [celebration({ id: 'migrated', kind: 'name_day', matchType: 'exact', primary: true, date: '03-19' })],
});
assert.strictEqual(migrated.all.length, 1);
assert.strictEqual(migrated.primary?.id, 'migrated');

// ...but a NON-primary same-date duplicate must not displace the legacy
// entry: dropping it then would leave the member with no primary at all, and
// the long-standing name day would vanish from every primary-reading surface.
const nonPrimaryDupe = resolveCelebrations({
  name: 'Josef',
  nameDay: '03-19',
  nameCelebrations: [celebration({ id: 'dupe', kind: 'name_day', matchType: 'exact', primary: false, date: '03-19' })],
});
assert.strictEqual(nonPrimaryDupe.all.length, 2);
assert.strictEqual(nonPrimaryDupe.primary?.id, LEGACY_NAME_DAY_ID);

// Cron-resolved years live on the member (nameCelebrationResolvedDates),
// outside the family-edited array; the resolved view folds them back into
// each entry's cache, with the celebration's own confirm-time entries winning
// on a year both carry.
const folded = resolveCelebrations({
  name: 'Shyam',
  nameCelebrations: [celebration({
    id: 'mov', dateType: 'movable', date: undefined, primary: true,
    movableRule: 'Kartik Purnima', resolvedDates: { '2026': '2026-11-24' },
  })],
  nameCelebrationResolvedDates: { mov: { '2026': '2026-01-01', '2027': '2027-11-13' } },
});
assert.deepStrictEqual(folded.primary?.resolvedDates, { '2026': '2026-11-24', '2027': '2027-11-13' });

// Unconfirmed proposals are visible in `all` but never celebrated.
const pending = resolveCelebrations({
  name: 'Shyam',
  nameCelebrations: [celebration({ id: 'proposal', confirmed: false, primary: true })],
});
assert.strictEqual(pending.primary, null);
assert.strictEqual(pending.additional.length, 0);
assert.strictEqual(pending.all.length, 1);

// --- date resolution per year ---

const fixed = celebration({ date: '03-19' });
assert.deepStrictEqual(celebrationDateInYear(fixed, 2026), { date: '2026-03-19', needsResolution: false });

// Feb-29 keeps the shared convention: the slot exists every year and lands on
// the 28th when there is no 29th.
const leapSlot = celebration({ date: '02-29' });
assert.deepStrictEqual(celebrationDateInYear(leapSlot, 2027), { date: '2027-02-28', needsResolution: false });
assert.deepStrictEqual(celebrationDateInYear(leapSlot, 2028), { date: '2028-02-29', needsResolution: false });

// A movable date comes ONLY from its per-year cache.
const movable = celebration({
  dateType: 'movable',
  date: undefined,
  movableRule: 'Kartik Purnima',
  resolvedDates: { '2026': '2026-11-24' },
});
assert.deepStrictEqual(celebrationDateInYear(movable, 2026), { date: '2026-11-24', needsResolution: false });
// A missing year is a question for the resolver, never a guess.
assert.deepStrictEqual(celebrationDateInYear(movable, 2027), { date: null, needsResolution: true });
// A cache entry that is not a real date in the asked-for year is as good as
// missing — trusting it would celebrate on a wrong day.
const wrongYear = celebration({ dateType: 'movable', date: undefined, resolvedDates: { '2026': '2025-11-24' } });
assert.deepStrictEqual(celebrationDateInYear(wrongYear, 2026), { date: null, needsResolution: true });
const rubbish = celebration({ dateType: 'movable', date: undefined, resolvedDates: { '2026': '2026-13-40' } });
assert.deepStrictEqual(celebrationDateInYear(rubbish, 2026), { date: null, needsResolution: true });

// Fixed with a malformed stored date: null, but nothing to resolve.
assert.deepStrictEqual(celebrationDateInYear(celebration({ date: 'nonsense' }), 2026), { date: null, needsResolution: false });

// --- days until ---

// Fixed dates behave exactly like nameDay's countdown, rollover included.
assert.strictEqual(daysUntilCelebration(fixed, new Date(2026, 2, 19)).days, 0);
assert.strictEqual(daysUntilCelebration(fixed, new Date(2026, 2, 20)).days, 364);
assert.strictEqual(daysUntilCelebration(leapSlot, new Date(2027, 1, 28)).days, 0);

// Movable: this year's resolution when still ahead...
assert.deepStrictEqual(daysUntilCelebration(movable, new Date(2026, 7, 18)), { days: 98, needsResolution: false });
assert.deepStrictEqual(daysUntilCelebration(movable, new Date(2026, 10, 24)), { days: 0, needsResolution: false });
// ...next year's once it has passed...
const movableBothYears = celebration({
  dateType: 'movable',
  date: undefined,
  resolvedDates: { '2026': '2026-11-24', '2027': '2027-11-13' },
});
assert.deepStrictEqual(daysUntilCelebration(movableBothYears, new Date(2026, 11, 1)), { days: 347, needsResolution: false });
// ...and a cache without the needed year says so instead of going quiet.
assert.deepStrictEqual(daysUntilCelebration(movable, new Date(2026, 11, 1)), { days: null, needsResolution: true });
assert.deepStrictEqual(daysUntilCelebration(movable, new Date(2027, 3, 1)), { days: null, needsResolution: true });
// A cached NEXT-year date with the current year unresolved still counts down —
// to the known occurrence — while needsResolution keeps saying the current
// year might yet hold a sooner one.
const nextYearOnly = celebration({
  dateType: 'movable',
  date: undefined,
  resolvedDates: { '2027': '2027-11-13' },
});
assert.deepStrictEqual(daysUntilCelebration(nextYearOnly, new Date(2026, 11, 1)), { days: 347, needsResolution: true });

console.log('nameCelebrations.test.ts: all assertions passed');
