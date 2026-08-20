// The cron's two gates: who gets a push, and whose date is worth a model call.
//
//   node --test server/nameCelebrations.test.mjs
//
// resolveCelebrations itself is covered by src/utils/nameCelebrationsParity.test.ts,
// which runs it against the client's copy. This file covers the two functions
// that only the cron needs, and the rule that separates them.
import test from 'node:test';
import assert from 'node:assert';
import { notifiableCelebrations, resolvableCelebrations, LEGACY_NAME_DAY_ID } from './nameCelebrations.mjs';

const ids = (list) => list.map((c) => c.id);

const fixed = (over) => ({
  id: 'c1', kind: 'name_day', title: 'Hl. Josef', celebrationOf: 'Josef',
  matchType: 'exact', tradition: 'Austrian Namenskalender', explanation: 'Because.',
  dateType: 'fixed', date: '03-19', confirmed: true, primary: false, notify: true, ...over,
});

const movable = (over) => fixed({
  kind: 'name_celebration', title: 'Nityananda Trayodashi', dateType: 'movable',
  date: undefined, movableRule: 'Magha Shukla Trayodashi', ...over,
});

// --------------------------------------------------------------------------
// notifiableCelebrations — who actually gets a push
// --------------------------------------------------------------------------

test('the legacy Namenstag notifies on its own', () => {
  const out = notifiableCelebrations({ name: 'Josef', nameDay: '03-19', nameDayFeast: 'Hl. Josef' });
  assert.deepEqual(ids(out), [LEGACY_NAME_DAY_ID]);
});

test('an explicit confirmed primary demotes the legacy Namenstag', () => {
  // A family that chose a different primary did not also opt into a second
  // annual push. This is how the Namenstag is silenced without deleting it.
  const out = notifiableCelebrations({
    name: 'Josef', nameDay: '03-19',
    nameCelebrations: [fixed({ id: 'chosen', date: '05-01', primary: true })],
  });
  assert.deepEqual(ids(out), ['chosen']);
});

test('a NOTIFYING same-date name_day replaces the legacy one even when it is not primary', () => {
  // The cron's own rule, stricter than resolveCelebrations: the calendar shows
  // both rows honestly, but two pushes for one day is congratulating a
  // migrated member twice.
  const out = notifiableCelebrations({
    name: 'Josef', nameDay: '03-19',
    nameCelebrations: [fixed({ id: 'dupe', date: '03-19', primary: false, notify: true })],
  });
  assert.deepEqual(ids(out), ['dupe']);
});

test('...but a SILENT same-date entry does not replace it — that would lose the day entirely', () => {
  const out = notifiableCelebrations({
    name: 'Josef', nameDay: '03-19',
    nameCelebrations: [fixed({ id: 'quiet', date: '03-19', primary: false, notify: false })],
  });
  assert.deepEqual(ids(out), [LEGACY_NAME_DAY_ID]);
});

test('a migrated member is notified once, by the explicit entry', () => {
  const out = notifiableCelebrations({
    name: 'Josef', nameDay: '03-19',
    nameCelebrations: [fixed({ id: 'migrated', date: '03-19', primary: true })],
  });
  assert.deepEqual(ids(out), ['migrated']);
});

test('unconfirmed proposals and silenced entries never push', () => {
  assert.deepEqual(notifiableCelebrations({ nameCelebrations: [fixed({ id: 'p', confirmed: false, primary: true })] }), []);
  assert.deepEqual(notifiableCelebrations({ nameCelebrations: [fixed({ id: 'q', notify: false, primary: true })] }), []);
  assert.deepEqual(notifiableCelebrations({ name: 'Nobody' }), []);
  assert.deepEqual(notifiableCelebrations(null), []);
});

test('an additional confirmed celebration pushes alongside the primary when it opted in', () => {
  const out = notifiableCelebrations({
    nameCelebrations: [fixed({ id: 'a', primary: true }), fixed({ id: 'b', date: '11-24', notify: true })],
  });
  assert.deepEqual(ids(out), ['a', 'b']);
});

// --------------------------------------------------------------------------
// resolvableCelebrations — whose date is worth a model call
// --------------------------------------------------------------------------

test('REGRESSION: a confirmed movable celebration is resolvable even when it never notifies', () => {
  // This is the bug this split exists for. The cron used to gate resolution on
  // notify, so an "additional" celebration a family chose to SEE but not be
  // pinged about kept only the two years resolved at confirm time and then
  // went dark — in the published feed and the app's countdown both, with no
  // error anywhere to show for it.
  const out = resolvableCelebrations({
    nameCelebrations: [movable({ id: 'quiet', primary: true, notify: false })],
  });
  assert.deepEqual(ids(out), ['quiet'], 'a silent celebration still needs a date to exist on');
});

test('both notifying and quiet movables come back, so the caller can order them', () => {
  const out = resolvableCelebrations({
    nameCelebrations: [movable({ id: 'loud', primary: true, notify: true }), movable({ id: 'quiet', notify: false })],
  });
  assert.deepEqual(ids(out), ['loud', 'quiet']);
  assert.deepEqual(ids(out.filter((c) => c.notify)), ['loud']);
  assert.deepEqual(ids(out.filter((c) => !c.notify)), ['quiet'], 'server.js spends budget on loud first');
});

test('nothing unconfirmed, nothing fixed, nothing without a rule', () => {
  assert.deepEqual(resolvableCelebrations({ nameCelebrations: [movable({ id: 'p', confirmed: false, primary: true })] }), []);
  assert.deepEqual(resolvableCelebrations({ name: 'Josef', nameDay: '03-19' }), [], 'the legacy Namenstag is a fixed date');
  assert.deepEqual(resolvableCelebrations({ nameCelebrations: [fixed({ id: 'f', primary: true })] }), []);
  assert.deepEqual(
    resolvableCelebrations({ nameCelebrations: [movable({ id: 'norule', primary: true, movableRule: '' })] }),
    [],
    'a movable entry with no rule is unresolvable, not a model call',
  );
  assert.deepEqual(resolvableCelebrations(null), []);
});

// --------------------------------------------------------------------------
// The property that matters when a gate is rewritten: nothing that used to be
// covered has quietly stopped being covered.
// --------------------------------------------------------------------------

test('PROPERTY: every confirmed movable entry on the member is resolvable, across every flag combination', () => {
  // The old cron resolved straight off mem.nameCelebrations. This one goes
  // through the merge first, so a merge that silently dropped an entry would
  // stop resolving a date nobody would notice was missing until a countdown
  // went blank months later.
  const bools = [true, false];
  let shapes = 0;
  for (const confirmed of bools) for (const primary of bools) for (const notify of bools) {
    for (const other of [[], [fixed({ id: 'other', primary: true })], [movable({ id: 'other2', primary: true })]]) {
      for (const nameDay of ['03-19', undefined]) {
        const entry = movable({ id: 'subject', confirmed, primary, notify });
        const member = { name: 'Josef', nameCelebrations: [entry, ...other] };
        if (nameDay) member.nameDay = nameDay;
        const resolvable = ids(resolvableCelebrations(member));
        assert.equal(
          resolvable.includes('subject'),
          confirmed,
          `a confirmed movable entry must be resolvable regardless of primary/notify (confirmed=${confirmed}, primary=${primary}, notify=${notify})`,
        );
        shapes += 1;
      }
    }
  }
  assert.ok(shapes >= 48, `the property swept too few shapes to mean anything (${shapes})`);
});
