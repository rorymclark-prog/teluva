// Tests for aiNoOp — dropping edits that would change nothing.
//
// The property under test throughout is asymmetric, and the asymmetry is the
// whole point: it is FINE to keep a no-op (the user reads one dull row), and
// NEVER fine to drop a real change (the user is told something was already
// saved when it was not). So most of these cases push on the second direction.

// Fixture data only — invented numbers, never anyone's real documents.
import { deepEqual, mergeChangesNothing, pruneUnchangedEdits, NoOpLookups } from './aiNoOp';

let passed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else fails.push(name);
}

// --- deepEqual --------------------------------------------------------------

check('identical primitives', deepEqual('B01234567', 'B01234567'));
check('different case is NOT equal', !deepEqual('b01234567', 'B01234567'));
check('trailing space is NOT equal', !deepEqual('B01234567 ', 'B01234567'));
check('undefined and null both count as blank', deepEqual(undefined, null));
check('blank vs empty string is a change', !deepEqual(undefined, ''));
check('absent key equals undefined key', deepEqual({ a: 1 }, { a: 1, b: undefined }));
check('nested objects compare structurally', deepEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } }));
check('array order matters', !deepEqual([1, 2], [2, 1]));
check('array length matters', !deepEqual([1], [1, 1]));
check('object vs array is not equal', !deepEqual({ 0: 1 }, [1]));
check('number vs numeric string is a change', !deepEqual(12, '12'));

// --- mergeChangesNothing ----------------------------------------------------

const passport = { id: 'p1', country: 'South Africa', number: 'B01234567', expiryDate: '2031-04-02' };

check('same value merged in changes nothing', mergeChangesNothing(passport, { number: 'B01234567' }));
check('different value is a change', !mergeChangesNothing(passport, { number: 'B07654321' }));
check('filling a blank field is a change', !mergeChangesNothing(passport, { notes: 'in the safe' }));
check('empty patch is never treated as a no-op', !mergeChangesNothing(passport, {}));
check('non-record target is never a no-op', !mergeChangesNothing(null, { number: 'x' }));
check(
  'a patch that repeats several fields verbatim changes nothing',
  mergeChangesNothing(passport, { country: 'South Africa', number: 'B01234567', expiryDate: '2031-04-02' }),
);
check(
  'ONE changed field among many unchanged ones still counts as a change',
  !mergeChangesNothing(passport, { country: 'South Africa', number: 'B01234567', expiryDate: '2032-04-02' }),
);

// --- pruneUnchangedEdits ----------------------------------------------------

const member: Record<string, any> = {
  id: 'm1',
  name: 'Sam Fixture',
  nationalIdNumber: '',
  passports: [{ ...passport }],
};

// Stands in for aiApply's MEMBER_FIELD_MAP: the same writer the real apply
// would run, so the comparison is against the actual outcome, not a guess.
const lookups: NoOpLookups = {
  resolveMember: (name) => (name === 'Sam Fixture' ? member : null),
  applyMemberField: (m, field, value) => {
    if (field === 'national_id_number') return { ...m, nationalIdNumber: value };
    if (field === 'nickname') return { ...m, nickname: value };
    return null; // unknown field
  },
  resolveUpdate: (targetKind, id, fields) => {
    if (targetKind !== 'passport' || id !== 'p1') return null;
    const patch: Record<string, unknown> = {};
    // Mirrors buildPatch's whitelist: `expiry` is renamed, `colour` is unknown.
    if (fields?.number !== undefined) patch.number = fields.number;
    if (fields?.expiry !== undefined) patch.expiryDate = fields.expiry;
    return { record: member.passports[0], patch, phrase: 'South Africa passport B01234567' };
  },
};

const prune = (edits: any[]) => pruneUnchangedEdits(edits, lookups);

// The reported case: a consent letter restates a passport number already held.
{
  const r = prune([{ kind: 'update_record', targetKind: 'passport', id: 'p1', fields: { number: 'B01234567' } }]);
  check('unchanged passport rewrite is dropped', r.edits.length === 0 && r.skipped.length === 1);
  check('the drop is explained', /already saved/.test(r.skipped[0].reason));
}

// The case that must survive: the number on the document really is different.
{
  const r = prune([{ kind: 'update_record', targetKind: 'passport', id: 'p1', fields: { number: 'B07654321' } }]);
  check('a genuinely new passport number is kept', r.edits.length === 1 && r.skipped.length === 0);
}

// A changed flight date is exactly the "sometimes it must do that" case.
{
  const r = prune([{ kind: 'update_record', targetKind: 'passport', id: 'p1', fields: { expiry: '2033-01-01' } }]);
  check('a changed date is kept', r.edits.length === 1);
}

// Unresolvable targets must never be quietly dropped — apply has its own
// "couldn't find it" note, and that note is the honest outcome.
{
  const r = prune([{ kind: 'update_record', targetKind: 'passport', id: 'gone', fields: { number: 'B01234567' } }]);
  check('an unfindable record keeps its edit', r.edits.length === 1);
}
{
  const r = prune([{ kind: 'update_record', targetKind: 'saying', id: 'p1', fields: { text: 'hi' } }]);
  check('an unknown target kind keeps its edit', r.edits.length === 1);
}
// All fields unrecognised → empty patch. Apply reports that as "changed
// nothing, here's why"; suppressing it here would hide a model mistake.
{
  const r = prune([{ kind: 'update_record', targetKind: 'passport', id: 'p1', fields: { colour: 'green' } }]);
  check('an all-unknown-fields patch keeps its edit', r.edits.length === 1);
}

// member field edits
{
  const r = prune([{ kind: 'member', member: 'Sam Fixture', field: 'national_id_number', value: '9001015800086' }]);
  check('setting a blank ID number is a real change', r.edits.length === 1);
}
{
  const withId = { ...member, nationalIdNumber: '9001015800086' };
  const r = pruneUnchangedEdits(
    [{ kind: 'member', member: 'X', field: 'national_id_number', value: '9001015800086' }],
    { ...lookups, resolveMember: () => withId },
  );
  check('re-setting the same ID number is dropped', r.edits.length === 0);
  check('the ID drop names the field readably', /national id number/.test(r.skipped[0].reason));
}
{
  const r = prune([{ kind: 'member', member: 'Sam Fixture', field: 'favourite_colour', value: 'blue' }]);
  check('an unknown member field keeps its edit', r.edits.length === 1);
}
{
  const r = prune([{ kind: 'member', member: 'Nobody At All', field: 'nickname', value: 'K' }]);
  check('an unresolvable member keeps its edit', r.edits.length === 1);
}

// clear_field: clearing something already empty does nothing.
{
  const r = prune([{ kind: 'clear_field', member: 'Sam Fixture', field: 'national_id_number' }]);
  check('clearing an already-empty field is dropped', r.edits.length === 0);
  check('the clear drop says it is already empty', /already empty/.test(r.skipped[0].reason));
}
{
  const withId = { ...member, nationalIdNumber: '9001015800086' };
  const r = pruneUnchangedEdits(
    [{ kind: 'clear_field', member: 'X', field: 'national_id_number' }],
    { ...lookups, resolveMember: () => withId },
  );
  check('clearing a field that HAS a value is kept', r.edits.length === 1);
}

// passport list-adds — aiApply merges on country+number rather than duplicating.
{
  const r = prune([{ kind: 'passport', member: 'Sam Fixture', country: 'South Africa', number: 'B01234567', expiry: '2031-04-02' }]);
  check('re-adding an identical passport is dropped', r.edits.length === 0);
}
{
  // No expiry supplied. aiApply keeps the stored one (`expiry || p.expiryDate`),
  // so this must read as unchanged — NOT as clearing the expiry date.
  const r = prune([{ kind: 'passport', member: 'Sam Fixture', country: 'South Africa', number: 'B01234567' }]);
  check('an omitted expiry does not read as a change', r.edits.length === 0);
}
{
  const r = prune([{ kind: 'passport', member: 'Sam Fixture', country: 'South Africa', number: 'B01234567', expiry: '2035-01-01' }]);
  check('a new expiry on a known passport is kept', r.edits.length === 1);
}
{
  const r = prune([{ kind: 'passport', member: 'Sam Fixture', country: 'Ireland', number: 'X1', expiry: '2030-01-01' }]);
  check('a passport for another country is kept', r.edits.length === 1);
}
{
  // Same number, country typed in another case — aiApply matches
  // case-insensitively on country, so this hits the SAME row and changes
  // nothing but the capitalisation... which IS a change, so it is kept.
  const r = prune([{ kind: 'passport', member: 'Sam Fixture', country: 'south africa', number: 'B01234567', expiry: '2031-04-02' }]);
  check('a country re-spelling is kept as a real change', r.edits.length === 1);
}

// Everything else passes straight through, untouched and in order.
{
  const batch = [
    { kind: 'document', name: 'Consent letter', category: 'Travel' },
    { kind: 'update_record', targetKind: 'passport', id: 'p1', fields: { number: 'B01234567' } },
    { kind: 'delete_record', targetKind: 'calendar_event', id: 'c9' },
    { kind: 'guardian', member: 'Sam Fixture', name: 'Alex Fixture' },
  ];
  const r = prune(batch);
  check('only the no-op is removed', r.edits.length === 3);
  check('a delete_record is NEVER pruned', r.edits.some(e => e.kind === 'delete_record'));
  check('order is preserved', r.edits[0].kind === 'document' && r.edits[2].kind === 'guardian');
  check('the input array is not mutated', batch.length === 4);
}

// A batch that is entirely no-ops must come back empty, not fall back to
// "show it anyway" — "everything in that document is already saved" is a
// genuinely useful answer.
{
  const r = prune([
    { kind: 'update_record', targetKind: 'passport', id: 'p1', fields: { number: 'B01234567' } },
    { kind: 'passport', member: 'Sam Fixture', country: 'South Africa', number: 'B01234567' },
  ]);
  check('an all-no-op batch empties', r.edits.length === 0 && r.skipped.length === 2);
}

if (fails.length) {
  console.error(`aiNoOp: ${fails.length} FAILED of ${passed + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`aiNoOp: ${passed} assertions passed`);
