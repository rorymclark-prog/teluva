// Standalone assertion tests for the AI-context redaction. No test runner is
// configured in this project, so run it directly — same convention as
// speechLocale.test.ts:
//   npx tsx src/utils/aiRedact.test.ts
// It exits non-zero on failure.
import assert from 'node:assert';
import { redactHousehold, redactFinances, redactMember } from './aiRedact';

// ── household ───────────────────────────────────────────────────────────────

const household = {
  address: 'Hauptstrasse 1, 1010 Wien',
  doorCode: '4821#',
  garageCode: '9090',
  wifiName: 'Clark-Home-5G',
  wifiPassword: 'correct-horse-battery',
  vehicles: [{ id: 'v1', name: 'Golf' }],
  pets: [{ id: 'p1', name: 'Mishka' }],
};
const rh = redactHousehold(household) as any;

// The credentials are GONE — not blanked, not masked, absent.
assert.ok(!('doorCode' in rh), 'doorCode must not be sent to the AI');
assert.ok(!('garageCode' in rh), 'garageCode must not be sent to the AI');
assert.ok(!('wifiPassword' in rh), 'wifiPassword must not be sent to the AI');
// Everything the assistant legitimately answers from survives.
assert.strictEqual(rh.address, 'Hauptstrasse 1, 1010 Wien');
assert.strictEqual(rh.wifiName, 'Clark-Home-5G', 'the network NAME is not a secret and stays');
assert.deepStrictEqual(rh.vehicles, [{ id: 'v1', name: 'Golf' }]);
assert.deepStrictEqual(rh.pets, [{ id: 'p1', name: 'Mishka' }]);

// The input is not mutated — the UI keeps the full record.
assert.strictEqual(household.doorCode, '4821#', 'redaction must not mutate its input');

// Total on the null/undefined that the loaders can return.
assert.strictEqual(redactHousehold(null), null);
assert.strictEqual(redactHousehold(undefined), undefined);

// ── finances ────────────────────────────────────────────────────────────────

const finances = {
  banks: [
    { id: 'b1', bankName: 'Erste Bank', accountHolder: 'R Clark', iban: 'AT61 1904 3002 3457 3201', bic: 'GIBAATWWXXX', notes: 'joint' },
    { id: 'b2', bankName: 'Revolut' },
  ],
  insurance: [{ id: 'i1', provider: 'Wiener Städtische', policyNumber: 'POL-1' }],
  benefits: [{ id: 'x1', name: 'Familienbeihilfe' }],
};
const rf = redactFinances(finances) as any;

assert.ok(!('iban' in rf.banks[0]), 'iban must not be sent to the AI');
assert.ok(!('bic' in rf.banks[0]), 'bic must not be sent to the AI');
// "which banks do we have?" still answerable.
assert.strictEqual(rf.banks[0].bankName, 'Erste Bank');
assert.strictEqual(rf.banks[0].accountHolder, 'R Clark');
assert.strictEqual(rf.banks[0].notes, 'joint');
assert.deepStrictEqual(rf.banks[1], { id: 'b2', bankName: 'Revolut' }, 'a bank with no iban is untouched');
// Insurance/benefits deliberately pass through (see aiRedact.ts note).
assert.deepStrictEqual(rf.insurance, finances.insurance);
assert.deepStrictEqual(rf.benefits, finances.benefits);
assert.strictEqual(finances.banks[0].iban, 'AT61 1904 3002 3457 3201', 'redaction must not mutate its input');

assert.strictEqual(redactFinances(null), null);
assert.deepStrictEqual(redactFinances({ benefits: [] }), { benefits: [] }, 'no banks array is fine');

// ── members ─────────────────────────────────────────────────────────────────

const member = {
  id: 'm1',
  name: 'Mia',
  birthdate: '2015-04-02',
  identifiers: { ssn: '1234 010115', nationalId: 'AT-99', driversLicenseNo: 'DL-1', taxId: 'TX-1', insuranceNo: 'INS-1' },
  financialAccounts: [{ id: 'f1', bankName: 'Erste', accountType: 'Savings', accountNumber: '00112233', routingNumber: '20111' }],
  identity: { residencePermitExpiry: '2027-01-31', svNumber: '1234 010115' },
  medical: { bloodGroup: 'O+' },
};
const rm = redactMember(member) as any;

assert.ok(!('identifiers' in rm), 'national identifiers must not be sent to the AI');
assert.ok(!('financialAccounts' in rm), 'account/routing numbers must not be sent to the AI');
// The rest of the profile is untouched.
assert.strictEqual(rm.name, 'Mia');
assert.strictEqual(rm.birthdate, '2015-04-02');
assert.deepStrictEqual(rm.medical, { bloodGroup: 'O+' });
// DOCUMENTED, DELIBERATE GAP: `identity` still carries ID numbers, because
// stripping it would break the shipped "when does my residence permit expire?"
// / "answer questions about IDs" behaviour. Flagged for the owner, not silently
// changed — this assertion exists so that decision is visible, not accidental.
assert.deepStrictEqual(rm.identity, { residencePermitExpiry: '2027-01-31', svNumber: '1234 010115' });

assert.ok(member.identifiers, 'redaction must not mutate its input');
assert.strictEqual(redactMember(null), null);
assert.deepStrictEqual(redactMember({ name: 'Solo' }), { name: 'Solo' });

console.log('aiRedact.test.ts: all assertions passed');
