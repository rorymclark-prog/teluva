// Standalone assertion tests for the "All ID numbers" overview screen's
// gathering logic. No test runner is configured in this project, so run it
// directly:
//   npx tsx src/utils/idOverview.test.ts
// It exits non-zero on failure.
import assert from 'node:assert/strict';
import { buildIdOverview, countIdOverviewItems } from './idOverview';
import { buildRevealIndex } from './aiReveal';
import { REDACTED_IDENTITY_KEYS } from './aiRedact';

// One member carrying every category this screen has an opinion about,
// including an expired passport, a soon-expiring residence permit, an empty
// field, and a still-encrypted one (both of which must never appear).
const mia: any = {
  id: 'm-mia',
  name: 'Mia',
  identity: {
    svNumber: '1234 010190',
    nationalIdNumber: '9001015800086',
    residencePermitNumber: 'AT-RWR-88213',
    residencePermitExpiry: '2027-04-30',
    driversLicenseNumber: 'DL-EM98334',
    driversLicenseExpiry: '2020-01-01', // long expired
    eCardNumber: '',                    // empty → not on file
    taxNumber: 'enc:2:aa:bb:cc',        // ciphertext → not revealable
  },
  passports: [
    { id: 'p-za', country: 'South Africa', number: 'A01234567', expiryDate: '2029-01-01' },
    { id: 'p-at', country: 'Austria', number: 'U9876543', expiryDate: '2020-06-30' }, // expired
  ],
  travel: {
    visas: [{ id: 'v-pt', country: 'Portugal', number: 'PT-55512', permitType: 'D7', expiryDate: '2028-01-01' }],
  },
  identifiers: { ssn: '078-05-1120', taxId: 'TX-9', notes: 'from the old system' },
  financialAccounts: [{ id: 'fa1', bankName: 'Erste', accountNumber: '00110022', routingNumber: '20111' }],
};

const nobody: any = { id: 'm-nobody', name: 'Nobody', identity: {}, passports: [] };

// ── grouping ─────────────────────────────────────────────────────────────

{
  const groups = buildIdOverview(mia, true);
  const kinds = groups.map(g => g.kind);
  assert.deepEqual(kinds, ['identity', 'passport', 'visa', 'other'],
    'groups appear in a fixed order and only when non-empty');

  const identity = groups.find(g => g.kind === 'identity')!;
  assert.ok(identity.items.some(i => i.value === '1234 010190'), 'SV number is listed');
  assert.ok(identity.items.some(i => i.value === '9001015800086'), 'national ID is listed');
  assert.ok(!identity.items.some(i => i.value.startsWith('enc:')),
    'ciphertext must never reach the screen — same rule as aiReveal.isRevealable');
  assert.ok(!identity.items.some(i => i.value === ''), 'an empty field is not "on file"');

  const passports = groups.find(g => g.kind === 'passport')!;
  assert.equal(passports.items.length, 2, 'both passports are listed');

  const visas = groups.find(g => g.kind === 'visa')!;
  assert.equal(visas.items.length, 1);
  assert.ok(visas.items[0].label.includes('South Africa') === false, 'sanity: label is the visa field, not a passport one');

  const other = groups.find(g => g.kind === 'other')!;
  assert.ok(other.items.some(i => i.value === '078-05-1120'), 'admin sees the national identifiers');

  // Money never appears, on this screen either — same boundary aiReveal.ts draws.
  const allValues = groups.flatMap(g => g.items.map(i => i.value));
  assert.ok(!allValues.includes('00110022') && !allValues.includes('20111'),
    'account/routing numbers are not identity documents and must not appear');
}

// ── admin gate ───────────────────────────────────────────────────────────

{
  const groups = buildIdOverview(mia, false);
  assert.ok(!groups.some(g => g.kind === 'other'),
    'a non-admin gets no "other identifiers" group at all — it must not render, not render empty');
  assert.ok(groups.some(g => g.kind === 'passport'),
    'passports are not admin-gated — a non-admin adult still sees them');
  const flatValues = groups.flatMap(g => g.items.map(i => i.value));
  assert.ok(!flatValues.includes('078-05-1120'), 'the SSN value itself must not leak through any other group');
}

// ── expiry attachment ────────────────────────────────────────────────────

{
  const groups = buildIdOverview(mia, true);
  const identity = groups.find(g => g.kind === 'identity')!;
  const permit = identity.items.find(i => i.value === 'AT-RWR-88213')!;
  assert.equal(permit.expiry, '2027-04-30', 'residence permit number carries its own expiry');
  const licence = identity.items.find(i => i.value === 'DL-EM98334')!;
  assert.equal(licence.expiry, '2020-01-01', "driver's licence carries its own expiry");
  const svNumber = identity.items.find(i => i.value === '1234 010190')!;
  assert.equal(svNumber.expiry, undefined, 'an SV number has no expiry field and must not inherit one');

  const passports = groups.find(g => g.kind === 'passport')!;
  const za = passports.items.find(i => i.value === 'A01234567')!;
  assert.equal(za.expiry, '2029-01-01', "a passport's expiry is matched back from PassportRecord");
  const at = passports.items.find(i => i.value === 'U9876543')!;
  assert.equal(at.expiry, '2020-06-30');

  const visas = groups.find(g => g.kind === 'visa')!;
  assert.equal(visas.items[0].expiry, '2028-01-01', "a visa's expiry is matched back from VisaRecord");
}

// ── empty state ──────────────────────────────────────────────────────────

{
  const groups = buildIdOverview(nobody, true);
  assert.equal(countIdOverviewItems(groups), 0, 'a member with nothing on file gets an empty list, not a scaffold');
  assert.equal(groups.length, 0, 'no groups at all — nothing to render an empty section for');
}

// ── PARITY: this screen can never show more than aiReveal.ts's catalogue ───
//
// The whole point of building this on top of buildRevealIndex() rather than
// a second hand-written field list is that the two CANNOT drift. Assert that
// directly: every id this screen's groups can produce must be a key
// buildRevealIndex() also produced for the same member/isAdmin pair, for
// both roles, and every REDACTED_IDENTITY_KEYS entry that resolves to a
// value must be reachable through this screen exactly as it is through the
// chat's reveal card.
for (const isAdmin of [true, false]) {
  const groups = buildIdOverview(mia, isAdmin);
  const overviewIds = new Set(groups.flatMap(g => g.items.map(i => i.id)));
  const index = buildRevealIndex([mia], { isAdmin });
  const revealIds = new Set((index.handlesByMember.get('m-mia') || []).map(h => h.id));

  for (const id of overviewIds) {
    assert.ok(revealIds.has(id),
      `PARITY BROKEN (isAdmin=${isAdmin}): the overview screen shows "${id}" but aiReveal.ts's `
      + 'catalogue does not know about it — the two lists have drifted.');
  }
  // And the reverse: nothing aiReveal offers is silently dropped by grouping.
  for (const id of revealIds) {
    assert.ok(overviewIds.has(id),
      `PARITY BROKEN (isAdmin=${isAdmin}): aiReveal.ts offers "${id}" but the overview screen `
      + 'drops it — kindOf() likely does not recognise its slot prefix.');
  }
}

// Every REDACTED_IDENTITY_KEYS field, when present, is reachable through this
// screen — mirrors aiReveal.test.ts's own "every redacted identity key stays
// reachable" assertion, one level up.
{
  const allFields: any = { id: 'm-all', name: 'All', identity: {} };
  for (const k of REDACTED_IDENTITY_KEYS) allFields.identity[k] = `val-${k}`;
  const groups = buildIdOverview(allFields, true);
  const identity = groups.find(g => g.kind === 'identity')!;
  assert.equal(identity.items.length, REDACTED_IDENTITY_KEYS.length,
    'every redacted identity key with a value on file must produce exactly one row');
  for (const k of REDACTED_IDENTITY_KEYS) {
    assert.ok(identity.items.some(i => i.value === `val-${k}`), `${k} is missing from the overview screen`);
  }
}

console.log('idOverview.test.ts — all assertions passed');
