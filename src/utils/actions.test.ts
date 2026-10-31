import assert from 'node:assert/strict';
import type { FamilyAction, FamilyMember } from '../types';
import {
  actionCounts, actionDateISO, actionDaysUntil, actionOwnerFilterPeople, actionOwnerName, actionPeople, actionSourceAvailable, buildActionSuggestions,
  createActionFromSuggestion, filterActions, isFamilyActionsDoc, setActionStatus, sortActions,
} from './actions';
import { mergeShared } from './mergeShared';
import { demoActions } from './demoActions';
import { DEMO_BUSINESS_MEMBERS, DEMO_MEMBERS } from './demoData';

const now = new Date(2026, 9, 29, 18, 30);
const stamp = now.toISOString();
const action = (id: string, values: Partial<FamilyAction> = {}): FamilyAction => ({
  id, title: id, status: 'open', createdAt: stamp, updatedAt: stamp, ...values,
});

assert.equal(actionDateISO(now), '2026-10-29');
assert.equal(actionDaysUntil('2026-10-29', now), 0, 'time of day cannot make today overdue');
assert.equal(actionDaysUntil('2026-10-28', now), -1);
assert.equal(actionDaysUntil('2026-11-05', now), 7);
assert.equal(actionDaysUntil('2026-02-31', now), null, 'impossible dates never normalize into a confident deadline');
assert.equal(actionDaysUntil('2026-1-2', now), null);
assert.equal(actionDaysUntil('2026-10-29T12:00:00Z', now), null);
assert.equal(actionDaysUntil(undefined, now), null);
assert.equal(actionDaysUntil('2028-02-29', new Date(2028, 1, 28)), 1);
assert.equal(actionDaysUntil('2027-02-29', now), null);

const previousTimezone = process.env.TZ;
try {
  process.env.TZ = 'Europe/Vienna';
  assert.equal(actionDaysUntil('2026-03-30', new Date(2026, 2, 28, 23, 50)), 2, 'DST is measured in calendar days');
  process.env.TZ = 'America/Los_Angeles';
  assert.equal(actionDateISO(new Date('2026-10-29T01:00:00Z')), '2026-10-28', 'local dates never use the UTC day');
} finally {
  if (previousTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimezone;
}

const items = [
  action('undated'), action('later', { dueDate: '2026-11-06', ownerMemberId: 'parent' }),
  action('today', { dueDate: '2026-10-29', notes: 'Call office', ownerMemberId: 'parent' }),
  action('overdue', { dueDate: '2026-10-28' }), action('week', { dueDate: '2026-11-05' }),
  action('done', { status: 'done', dueDate: '2026-10-20', completedAt: stamp }),
];
const before = JSON.stringify(items);
assert.deepEqual(actionCounts(items, now), { open: 5, done: 1, overdue: 1, dueSoon: 2, undated: 1 });
assert.deepEqual(sortActions(items).map(item => item.id), ['overdue', 'today', 'week', 'later', 'undated', 'done']);
assert.equal(JSON.stringify(items), before, 'sorting/counting must never mutate the shared snapshot');
assert.deepEqual(filterActions(items, { due: 'soon' }, now).map(item => item.id), ['today', 'week']);
assert.deepEqual(filterActions(items, { due: 'overdue' }, now).map(item => item.id), ['overdue']);
assert.deepEqual(filterActions(items, { ownerMemberId: 'parent', search: ' OFFICE ' }, now).map(item => item.id), ['today']);
assert.equal(filterActions(items, { ownerMemberId: 'unassigned', status: 'open' }, now).length, 3);
assert.equal(filterActions(items, { status: 'done' }, now).length, 1);
assert.equal(filterActions(items, { due: 'undated' }, now)[0].id, 'undated');

const original = action('status', { source: { key: 'source:date', label: 'Passport', memberId: 'child', tab: 'ids' } });
const completed = setActionStatus(original, 'done', new Date('2026-10-30T12:00:00Z'));
assert.equal(completed.completedAt, '2026-10-30T12:00:00.000Z');
assert.equal(completed.createdAt, original.createdAt);
assert.equal(original.status, 'open', 'completion never mutates an existing snapshot');
assert.equal(original.completedAt, undefined);
assert.equal(setActionStatus(completed, 'done', new Date('2026-11-01')).completedAt, completed.completedAt, 'repeat completion preserves its original timestamp');
const reopened = setActionStatus(completed, 'open', now);
assert.equal(reopened.completedAt, undefined);
assert.equal(reopened.source?.key, original.source?.key);

const member: FamilyMember = {
  id: 'child', name: 'Ari', role: 'Child', avatarColor: '', clothingSizes: {}, documents: [],
  passport: { passportNumber: 'SECRET-PASSPORT', fullName: 'Ari', issuingCountry: 'Austria', issueDate: '', dateOfBirth: '', expiryDate: '2026-10-30' },
  passports: [
    { id: 'passport', number: 'SECRET-PASSPORT', country: 'Austria', expiryDate: '2026-10-30' },
    { id: 'ninety', number: 'NINETY-SECRET', country: 'UK', expiryDate: '2027-01-27' },
    { id: 'later', number: 'FUTURE-SECRET', country: 'SA', expiryDate: '2027-01-28' },
    { id: 'bad', number: 'BAD-SECRET', country: '', expiryDate: '2026-11-31' },
  ],
  identity: { residencePermitExpiry: '2026-10-28', residencePermitNumber: 'SECRET-PERMIT', driversLicenseExpiry: '2026-11-20' },
  travel: {
    visas: [{ id: 'visa', country: 'US', number: 'SECRET-VISA', expiryDate: '2026-11-10' }, { id: 'pending', country: 'AT', expiryDate: '2026-10-28', status: 'pending' }],
    transitPasses: [{ id: 'pass', name: 'Rail card', cardNumber: 'SECRET-CARD', validUntil: '2026-12-01' }],
  },
  education: { qualifications: [{ id: 'qualification', name: 'Swimming certificate', expiryDate: '2026-12-02' }] },
  cv: { qualifications: [{ id: 'qualification', name: 'First aid certificate', expiryDate: '2026-12-03' }] },
  referrals: [
    { id: 'ref', kind: 'Referral', date: '2026-10-01', status: 'open', providerName: 'PRIVATE-DOCTOR', reason: 'PRIVATE-CONDITION' },
    { id: 'implicit-open', kind: 'Referral' },
    { id: 'booked', kind: 'Referral', status: 'booked' },
    { id: 'booked-date', kind: 'Referral', status: 'open', appointmentDate: '2026-11-10' },
    { id: 'result', kind: 'Lab result', status: 'open' },
    { id: 'letter', kind: 'Specialist letter', status: 'open' },
    { id: 'note', kind: 'Sick note', status: 'open' },
    { id: 'future', kind: 'Referral', status: 'open', date: '2026-10-30' },
  ] as FamilyMember['referrals'],
};
const memberSnapshot = JSON.stringify(member);
const suggestions = buildActionSuggestions([member], [], now);
assert.equal(suggestions.filter(suggestion => suggestion.source.key.includes(':passport:passport:')).length, 1, 'legacy passport is folded into the multi-passport record');
assert.ok(suggestions.some(suggestion => suggestion.daysUntilDue === 90), '90-day boundary is included');
assert.ok(!suggestions.some(suggestion => suggestion.key.includes(':passport:later:')), '91-day deadline waits');
assert.ok(!suggestions.some(suggestion => suggestion.key.includes(':passport:bad:')), 'invalid deadline is ignored');
assert.ok(!suggestions.some(suggestion => suggestion.key.includes(':visa:pending:')));
assert.ok(suggestions.some(suggestion => suggestion.source.tab === 'education'));
assert.ok(suggestions.some(suggestion => suggestion.source.tab === 'cv'), 'qualification IDs from different stores cannot collide');
assert.equal(new Set(suggestions.map(suggestion => suggestion.key)).size, suggestions.length);
const referrals = suggestions.filter(suggestion => suggestion.source.tab === 'medical');
assert.equal(referrals.length, 2, 'only open records establishing a booking need are suggested');
assert.ok(referrals.every(suggestion => !suggestion.dueDate && suggestion.daysUntilDue === null), 'issue date is never invented as a deadline');
assert.equal(suggestions[0].daysUntilDue, -1, 'most overdue source is shown first');
for (const secret of ['SECRET-PASSPORT', 'NINETY-SECRET', 'SECRET-PERMIT', 'SECRET-VISA', 'SECRET-CARD', 'PRIVATE-DOCTOR', 'PRIVATE-CONDITION']) {
  assert.ok(!JSON.stringify(suggestions).includes(secret), `suggestions must not copy ${secret}`);
}
assert.equal(JSON.stringify(member), memberSnapshot, 'suggestions do not write back to source records');

const passport = suggestions.find(suggestion => suggestion.key.includes(':passport:passport:'))!;
const created = createActionFromSuggestion(passport, { id: 'created', ownerMemberId: 'parent', now });
assert.equal(created.source?.key, passport.key);
assert.equal(created.ownerMemberId, 'parent');
assert.notEqual(created.source, passport.source, 'editable task source does not alias the projection');
assert.ok(!buildActionSuggestions([member], [created], now).some(suggestion => suggestion.key === passport.key), 'an existing open action suppresses duplicate suggestions');
assert.ok(!buildActionSuggestions([member], [setActionStatus(created, 'done', now)], now).some(suggestion => suggestion.key === passport.key), 'a completed action suppresses this same renewal cycle');
const renewed = structuredClone(member);
renewed.passports![0].expiryDate = '2026-12-31';
const nextCycle = buildActionSuggestions([renewed], [setActionStatus(created, 'done', now)], now).find(suggestion => suggestion.key.includes(':passport:passport:'));
assert.ok(nextCycle && nextCycle.key !== passport.key, 'a newly recorded expiry can recur after a previous action was completed');
assert.equal(member.passports![0].expiryDate, '2026-10-30', 'completion cannot renew the actual passport');

const base = { items: [created] };
const local = { items: [setActionStatus(created, 'done', now)] };
const remote = { items: [{ ...created, notes: 'Appointment confirmed by the other parent' }, action('remote-add')] };
const merged = mergeShared(base, local, remote);
assert.equal(merged.items.find(item => item.id === created.id)?.status, 'done');
assert.equal(merged.items.find(item => item.id === created.id)?.notes, 'Appointment confirmed by the other parent');
assert.ok(merged.items.some(item => item.id === 'remote-add'), 'concurrent edits/additions survive task completion');

const sameSuggestionId = `record:${passport.key}`;
const firstPhone = createActionFromSuggestion(passport, { id: sameSuggestionId, ownerMemberId: 'parent', now });
const secondPhone = createActionFromSuggestion(passport, { id: sameSuggestionId, now: new Date(now.getTime() + 1000) });
const together = mergeShared({ items: [] as FamilyAction[] }, { items: [secondPhone] }, { items: [firstPhone] });
assert.equal(together.items.length, 1, 'two phones reviewing the same stable source create one action');
assert.equal(together.items[0].ownerMemberId, 'parent', 'an unassigned concurrent add cannot erase the other phone’s chosen owner');

assert.ok(isFamilyActionsDoc({ items: [created, completed, ...items].filter((item, index, all) => all.findIndex(other => other.id === item.id) === index) }));
assert.ok(isFamilyActionsDoc({ items: [] }), 'an empty worklist is a valid backup');
assert.ok(isFamilyActionsDoc({ items: [action('blank-fields', { ownerMemberId: '', dueDate: '', notes: '' })] }), 'cleared optional form values can round-trip');
assert.equal(isFamilyActionsDoc(null), false);
assert.equal(isFamilyActionsDoc({ items: 'wrong' }), false);
assert.equal(isFamilyActionsDoc({ items: [null] }), false);
assert.equal(isFamilyActionsDoc({ items: [action('duplicate'), action('duplicate')] }), false, 'duplicate IDs cannot be restored into a keyed worklist');
for (const invalid of [
  { title: undefined }, { title: '   ' }, { status: 'pending' }, { updatedAt: 'nonsense' },
  { notes: 2 }, { dueDate: '2026-02-31' }, { completedAt: 'yesterday' },
  { source: { key: 'key' } }, { source: { key: 'key', label: 'Record', memberId: 42 } },
]) {
  assert.equal(isFamilyActionsDoc({ items: [{ ...created, ...invalid }] }), false, `malformed backup rejected: ${JSON.stringify(invalid)}`);
}

console.log('actions.test.ts: dates, filters, lifecycle, source suggestions, privacy, deduplication, concurrent merges and backup validation passed');

// An ordinary employee loads only their OWN confidential profile. Directory
// names still make colleague assignments usable without opening those profiles.
const self = { id: 'self', name: 'Sam', medical: { conditions: 'never pass through' }, email: 'private@example.test' };
const directory = [{ id: 'colleague', name: 'Ada', workPhone: '123' }, { id: 'self', name: 'Sam' }];
const workPeople = actionPeople([self], directory);
assert.deepEqual(workPeople, [{ id: 'colleague', name: 'Ada' }, { id: 'self', name: 'Sam' }], 'owner options include safe colleague names and exclude confidential fields');
const colleagueTask = action('colleague-task', { ownerMemberId: 'colleague', source: { key: 'work', label: 'Work record', memberId: 'colleague', tab: 'cv' } });
assert.equal(actionOwnerName(colleagueTask, workPeople, true), 'Ada', 'a current colleague is not mislabelled as a previous member');
assert.ok(workPeople.some(person => person.id === 'colleague'), 'an employee can choose a colleague for a new assignment');
assert.deepEqual(filterActions([colleagueTask, action('self-task', { ownerMemberId: 'self' })], { ownerMemberId: 'colleague' }).map(item => item.id), ['colleague-task']);
assert.equal(actionSourceAvailable(colleagueTask, [self]), false, 'directory presence never opens the colleague’s confidential source');
assert.equal(actionSourceAvailable(colleagueTask, [{ id: 'colleague' }]), true, 'an admin with the loaded source can still open it');

const offlinePeople = actionPeople([self]);
assert.equal(actionOwnerName(colleagueTask, offlinePeople, true, false), 'Assigned teammate', 'an offline directory never turns a real assignment into Unassigned/Previous member');
assert.deepEqual(actionOwnerFilterPeople(offlinePeople, [colleagueTask], true, false), [{ id: 'colleague', name: 'Assigned teammate' }, { id: 'self', name: 'Sam' }], 'existing colleague assignments remain filterable when names cannot load');
assert.equal(setActionStatus(colleagueTask, 'done', now).ownerMemberId, 'colleague', 'completion preserves an unavailable colleague assignment');
assert.equal(actionOwnerName(colleagueTask, offlinePeople, true, true), 'Previous team member', 'a successfully loaded directory distinguishes a removed colleague');
assert.equal(actionOwnerName(action('unassigned'), workPeople, true), 'Unassigned');
assert.equal(actionOwnerName(colleagueTask, offlinePeople, false), 'Previous member', 'family fallback wording stays unchanged');
assert.deepEqual(self.medical, { conditions: 'never pass through' }, 'directory projection does not mutate the confidential source');
console.log('actions.test.ts: safe business directory assignments, filtering, offline fallback and source privacy passed');

const businessDemo = demoActions(true, now).items[0];
assert.match(businessDemo.title, /team roster/);
assert.equal(actionOwnerName(businessDemo, actionPeople(DEMO_BUSINESS_MEMBERS), true), 'Tomas Lindqvist');
assert.equal(businessDemo.source, undefined, 'work demo does not link to a family school record');
const familyDemo = demoActions(false, now).items[0];
assert.equal(familyDemo.title, 'Send the school form');
assert.equal(actionOwnerName(familyDemo, actionPeople(DEMO_MEMBERS)), 'Papa');
assert.equal(familyDemo.source?.memberId, 'demo-mia');
assert.equal(businessDemo.dueDate, '2026-11-02');
console.log('actions.test.ts: demo worklists use matching business and family owners passed');
