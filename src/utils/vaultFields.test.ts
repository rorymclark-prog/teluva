// Standalone assertion tests — same convention as mergeShared.test.ts /
// aiRedact.test.ts:
//   npx tsx src/utils/vaultFields.test.ts
// It exits non-zero on failure.
import assert from 'node:assert';
import {
  protectIdentity, revealIdentity, protectHousehold, revealHousehold,
  protectFinances, revealFinances, protectPassports, revealPassports,
  protectVisas, revealVisas, protectIdentifiers, revealIdentifiers,
  protectFinancialAccounts, revealFinancialAccounts, revealCached, VaultTransform,
} from './vaultFields';
import { mergeShared } from './mergeShared';

// A reversible fake crypto round-trip, standing in for the real server call
// (AES-256-GCM with a random IV) — this file has no network access. What
// matters for these tests is only that protect() is NOT the identity
// function (so a bug that skips it is visible) and that reveal(protect(x))
// === x.
const fakeProtect: VaultTransform = async (values) => values.map(v => `enc:fake:${Buffer.from(v).toString('base64')}`);
const fakeReveal: VaultTransform = async (values) => values.map(v =>
  v.startsWith('enc:fake:') ? Buffer.from(v.slice('enc:fake:'.length), 'base64').toString('utf8') : v);

// ── identity ────────────────────────────────────────────────────────────────

{
  const identity = { svNumber: '1234 010190', eCardNumber: '6799-291212', residencePermitExpiry: '2027-01-31', notes: 'kept as-is' };
  const protectedIdentity = await protectIdentity(identity, fakeProtect) as any;

  assert.notStrictEqual(protectedIdentity.svNumber, identity.svNumber, 'svNumber must actually be transformed');
  assert.ok(protectedIdentity.svNumber.startsWith('enc:'), 'protected value is ciphertext-shaped');
  assert.strictEqual(protectedIdentity.residencePermitExpiry, '2027-01-31', 'expiry dates are not in the redaction list — must pass through untouched');
  assert.strictEqual(protectedIdentity.notes, 'kept as-is');
  assert.strictEqual(identity.svNumber, '1234 010190', 'protect must not mutate its input');

  const revealed = await revealIdentity(protectedIdentity, fakeReveal) as any;
  assert.strictEqual(revealed.svNumber, '1234 010190', 'round-trip must restore the original value');
  assert.strictEqual(revealed.eCardNumber, '6799-291212');
  assert.strictEqual(revealed.residencePermitExpiry, '2027-01-31');

  assert.strictEqual(await protectIdentity(undefined, fakeProtect), undefined);
  assert.deepStrictEqual(await protectIdentity({}, fakeProtect), {}, 'no sensitive fields set is a no-op');
}

// ── household ───────────────────────────────────────────────────────────────

{
  const household = { address: 'Hauptstrasse 1, 1010 Wien', doorCode: '4821#', wifiName: 'Clark-Home-5G', wifiPassword: 'correct-horse' };
  const p = await protectHousehold(household, fakeProtect) as any;
  assert.notStrictEqual(p.doorCode, household.doorCode);
  assert.notStrictEqual(p.wifiPassword, household.wifiPassword);
  assert.strictEqual(p.address, household.address, 'address is not sensitive — untouched');
  assert.strictEqual(p.wifiName, household.wifiName, 'network name is not sensitive — untouched');

  const r = await revealHousehold(p, fakeReveal) as any;
  assert.strictEqual(r.doorCode, '4821#');
  assert.strictEqual(r.wifiPassword, 'correct-horse');
}

// ── finances (per-bank-record fields inside an array) ─────────────────────

{
  const finances = {
    banks: [
      { id: 'b1', bankName: 'Erste Bank', iban: 'AT61 1904 3002 3457 3201', bic: 'GIBAATWWXXX' },
      { id: 'b2', bankName: 'Revolut' }, // no iban/bic set
    ],
  };
  const p = await protectFinances(finances, fakeProtect) as any;
  assert.notStrictEqual(p.banks[0].iban, finances.banks[0].iban);
  assert.notStrictEqual(p.banks[0].bic, finances.banks[0].bic);
  assert.strictEqual(p.banks[0].bankName, 'Erste Bank');
  assert.deepStrictEqual(p.banks[1], { id: 'b2', bankName: 'Revolut' }, 'a bank with nothing sensitive set is untouched');

  const r = await revealFinances(p, fakeReveal) as any;
  assert.strictEqual(r.banks[0].iban, 'AT61 1904 3002 3457 3201');
  assert.strictEqual(r.banks[0].bic, 'GIBAATWWXXX');

  assert.strictEqual(await protectFinances(undefined, fakeProtect), undefined);
  assert.deepStrictEqual(await protectFinances({ banks: [] }, fakeProtect), { banks: [] });
}

// ── passports ───────────────────────────────────────────────────────────────

{
  const passports = [
    { id: 'p1', country: 'Austria', number: 'P1234567', expiryDate: '2030-05-01' },
    { id: 'p2', country: 'South Africa', number: '' },
  ];
  const p = await protectPassports(passports, fakeProtect) as any;
  assert.notStrictEqual(p[0].number, passports[0].number);
  assert.strictEqual(p[0].expiryDate, '2030-05-01');
  assert.deepStrictEqual(p[1], { id: 'p2', country: 'South Africa', number: '' });

  const r = await revealPassports(p, fakeReveal) as any;
  assert.strictEqual(r[0].number, 'P1234567');
}

// ── visas — same shape as passports above, found stored in plaintext right
//    next to an already-encrypted passports array (2026-08-15 audit) ──────

{
  const visas = [
    { id: 'v1', country: 'Austria', number: 'AT-VISA-9988', expiryDate: '2028-03-01' },
    { id: 'v2', country: 'United Kingdom', number: '' },
  ];
  const p = await protectVisas(visas, fakeProtect) as any;
  assert.notStrictEqual(p[0].number, visas[0].number);
  assert.strictEqual(p[0].expiryDate, '2028-03-01');
  assert.deepStrictEqual(p[1], { id: 'v2', country: 'United Kingdom', number: '' });

  const r = await revealVisas(p, fakeReveal) as any;
  assert.strictEqual(r[0].number, 'AT-VISA-9988');
}

// ── identifiers (SecureSecrets.tsx: SSN, driver's licence, tax ID, insurance
//    number) — found with NO protect/reveal call anywhere, not even a missed
//    field on an otherwise-covered record like visas above (2026-08-15 audit) ─

{
  const identifiers = { ssn: '123-45-6789', nationalId: '', driversLicenseNo: 'DL-EM98334', taxId: 'TX-EMILY-44', insuranceNo: 'BCBS-84221A', notes: 'cards in the safe' };
  const p = await protectIdentifiers(identifiers, fakeProtect) as any;
  assert.notStrictEqual(p.ssn, identifiers.ssn);
  assert.notStrictEqual(p.driversLicenseNo, identifiers.driversLicenseNo);
  assert.notStrictEqual(p.taxId, identifiers.taxId);
  assert.notStrictEqual(p.insuranceNo, identifiers.insuranceNo);
  assert.strictEqual(p.notes, 'cards in the safe', 'notes are not a credential — untouched');
  assert.strictEqual(p.nationalId, '', 'an empty field is left alone, not encrypted into "enc:fake:"');

  const r = await revealIdentifiers(p, fakeReveal) as any;
  assert.strictEqual(r.ssn, '123-45-6789');
  assert.strictEqual(r.driversLicenseNo, 'DL-EM98334');
  assert.strictEqual(r.taxId, 'TX-EMILY-44');
  assert.strictEqual(r.insuranceNo, 'BCBS-84221A');

  assert.strictEqual(await protectIdentifiers(undefined, fakeProtect), undefined);
}

// ── financialAccounts (SecureSecrets.tsx: bank account/routing number) —
//    same finding, same session, one field group deeper than identifiers ──

{
  const accounts = [
    { id: 'bank-1', bankName: 'Chase Bank', accountType: 'Checking', accountNumber: '982245104', routingNumber: 'RT-021000021', notes: 'Both parents hold signatures.' },
    { id: 'bank-2', bankName: 'PG&E', accountType: 'Utility', accountNumber: '' },
  ];
  const p = await protectFinancialAccounts(accounts, fakeProtect) as any;
  assert.notStrictEqual(p[0].accountNumber, accounts[0].accountNumber);
  assert.notStrictEqual(p[0].routingNumber, accounts[0].routingNumber);
  assert.strictEqual(p[0].bankName, 'Chase Bank', 'bank name is not a credential — untouched');
  assert.strictEqual(p[0].accountType, 'Checking');
  assert.deepStrictEqual(p[1], accounts[1], 'a record with nothing sensitive set is untouched');

  const r = await revealFinancialAccounts(p, fakeReveal) as any;
  assert.strictEqual(r[0].accountNumber, '982245104');
  assert.strictEqual(r[0].routingNumber, 'RT-021000021');

  assert.strictEqual(await protectFinancialAccounts(undefined, fakeProtect), undefined);
}

// ── revealCached: offline-friendly cache ───────────────────────────────────

{
  // Isolated, fake localStorage — no browser/jsdom in this test runner.
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };

  let calls = 0;
  const countingReveal: VaultTransform = async (values) => { calls++; return fakeReveal(values); };

  const ct = (await fakeProtect(['1234 010190']))[0];
  const first = await revealCached([ct], countingReveal);
  assert.deepStrictEqual(first, ['1234 010190']);
  assert.strictEqual(calls, 1, 'first reveal is a real network call');

  const second = await revealCached([ct], countingReveal);
  assert.deepStrictEqual(second, ['1234 010190']);
  assert.strictEqual(calls, 1, 'second reveal of the SAME ciphertext must come from cache, not another call');

  // Offline: revealFn throws. A previously-cached value must still resolve —
  // this is the exact mechanism that keeps Emergency essentials readable
  // without signal.
  const throwingReveal: VaultTransform = async () => { throw new Error('offline'); };
  const offline = await revealCached([ct], throwingReveal);
  assert.deepStrictEqual(offline, ['1234 010190'], 'cached value survives a failed network call');

  // A ciphertext never seen before, offline, has nothing to fall back to.
  const neverSeen = (await fakeProtect(['9999 999999']))[0];
  const offlineMiss = await revealCached([neverSeen], throwingReveal);
  assert.deepStrictEqual(offlineMiss, [''], 'an unresolvable value returns empty, never raw ciphertext');

  // Plaintext (never encrypted / legacy data) passes straight through with no call.
  const plainCalls0 = calls;
  const plain = await revealCached(['already plaintext', undefined, ''], countingReveal);
  assert.deepStrictEqual(plain, ['already plaintext', '', '']);
  assert.strictEqual(calls, plainCalls0, 'plaintext values never touch the network');
}

// ── the correctness-critical one: merge must operate on PLAINTEXT ─────────
//
// Simulates exactly what saveReferenceDoc does: decrypt what's on the
// server, run the real three-way merge on plaintext, encrypt only the final
// value for the write. Two "devices" edit DIFFERENT fields of the same
// household record between syncs — both edits must survive, which is only
// possible if mergeShared is comparing plaintext, not ciphertext.
{
  type H = { address?: string; doorCode?: string; wifiPassword?: string };

  const original: H = { address: 'Hauptstrasse 1, 1010 Wien', doorCode: '4821#', wifiPassword: 'old-pass' };
  const serverCiphertext = await protectHousehold(original, fakeProtect) as H; // "what's in Firestore"

  // Device A: last synced at `original`, changes only the door code.
  const deviceABase = original;
  const deviceALocal: H = { ...original, doorCode: '9999#' };

  // Simulate saveReferenceDoc's sequence for device A's save:
  const decryptedServerForA = await revealHousehold(serverCiphertext, fakeReveal) as H;
  const mergedA = mergeShared<H>(deviceABase, deviceALocal, decryptedServerForA);
  assert.strictEqual(mergedA.doorCode, '9999#', "device A's own edit must win");
  assert.strictEqual(mergedA.wifiPassword, 'old-pass', "field device A didn't touch must survive from the (decrypted) server");
  const reEncryptedA = await protectHousehold(mergedA, fakeProtect) as H;
  assert.notStrictEqual(reEncryptedA.doorCode, '9999#', 'the value written back to Firestore must be ciphertext, not plaintext');

  // Device B synced at the SAME original base, but writes AFTER device A —
  // simulate the server now holding A's write — and changes a different field.
  const deviceBBase = original;
  const deviceBLocal: H = { ...original, wifiPassword: 'new-pass' };
  const decryptedServerForB = await revealHousehold(reEncryptedA, fakeReveal) as H; // server now has A's change
  const mergedB = mergeShared<H>(deviceBBase, deviceBLocal, decryptedServerForB);

  assert.strictEqual(mergedB.doorCode, '9999#', "device A's edit, made after B's base, must NOT be lost");
  assert.strictEqual(mergedB.wifiPassword, 'new-pass', "device B's own edit must win");
  assert.strictEqual(mergedB.address, 'Hauptstrasse 1, 1010 Wien', 'untouched field survives from either side');
}

console.log('vaultFields.test.ts: all assertions passed');
