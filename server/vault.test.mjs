import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  createVaultCipher, createVaultHandlers, collectLegacySharedValues,
  legacyFingerprint, resolveVaultMembership, vaultSpaceId,
} from './vault.mjs';

const key = Buffer.alloc(32, 19);
const oldEncrypt = (plain, familyId, version = 2) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (version === 2) cipher.setAAD(Buffer.from(familyId));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return `enc:${version}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
};

function fixture({ shared = new Set(), privateSources = new Set(), activeSpace = 'other-space', encryptionKey = key } = {}) {
  const approvals = new Map();
  const denials = new Map();
  const roles = new Map([
    ['space-a:admin', 'admin'], ['space-a:member', 'member'], ['space-a:child', 'child'],
    ['space-b:admin', 'admin'], ['space-b:member', 'member'],
  ]);
  const writes = [];
  const handlers = createVaultHandlers({
    key: encryptionKey,
    authorize: async req => {
      // This account-wide pointer deliberately points elsewhere, as with two tabs.
      assert.equal(activeSpace, 'other-space');
      const spaceId = vaultSpaceId(req.body?.spaceId);
      const role = roles.get(`${spaceId}:${req.uid}`);
      return { uid: req.uid, ...resolveVaultMembership(spaceId, role ? { role } : null) };
    },
    loadLegacyShared: async () => ({ shared, credentials: privateSources }),
    loadApprovedLegacy: async (spaceId, fingerprints) => new Set(fingerprints.filter(id => approvals.has(`${spaceId}:${id}`))),
    approveLegacy: async (spaceId, fingerprints, uid) => {
      writes.push({ spaceId, fingerprints, uid });
      fingerprints.forEach(id => approvals.set(`${spaceId}:${id}`, true));
    },
    loadDeniedLegacy: async (spaceId, fingerprints) => new Set(fingerprints.filter(id => denials.has(`${spaceId}:${id}`))),
    rememberPrivateLegacy: async (spaceId, fingerprints) => {
      fingerprints.forEach(id => denials.set(`${spaceId}:${id}`, true));
    },
  });
  const request = (handler, uid, values, spaceId = 'space-a', extra = {}) => handlers[handler]({ uid, body: { values, spaceId, ...extra } });
  return { handlers, request, approvals, writes, denials };
}

test('shared APIs cannot reveal personal credentials to members or children', async () => {
  const { request } = fixture();
  const protectedResult = await request('protect', 'admin', ['private-bank-password']);
  assert.equal(protectedResult.status, 200);
  const [credential] = protectedResult.body.values;
  assert.ok(credential.startsWith('enc:3:credentials:'));
  for (const uid of ['member', 'child']) {
    const bypass = await request('revealShared', uid, [credential], 'space-a', { purpose: 'shared', isAdmin: true });
    assert.equal(bypass.status, 403);
    assert.equal(bypass.body.code, uid === 'child' ? 'VAULT_ACCESS_DENIED' : 'VAULT_PURPOSE_DENIED');
    assert.equal(bypass.body.values, undefined);
    assert.equal((await request('reveal', uid, [credential])).status, 403);
    assert.equal((await request('protect', uid, ['another-password'])).status, 403);
  }
  assert.deepEqual((await request('reveal', 'admin', [credential])).body.values, ['private-bank-password']);
});

test('legitimate shared secrets remain readable by adults; children cannot reveal or write', async () => {
  const { request } = fixture();
  const result = await request('protectShared', 'member', ['wifi-password', '']);
  assert.equal(result.status, 200);
  const [shared] = result.body.values;
  assert.ok(shared.startsWith('enc:3:shared:'));
  for (const uid of ['admin', 'member']) {
    assert.deepEqual((await request('revealShared', uid, [shared, 'legacy plain', ''])).body.values, ['wifi-password', 'legacy plain', '']);
  }
  assert.equal((await request('protectShared', 'child', ['change-it'])).status, 403);
  assert.equal((await request('revealShared', 'child', [shared])).status, 403);
  assert.deepEqual((await request('protectShared', 'member', [shared])).body.values, [shared], 'unchanged current ciphertext is safe to carry through');
});

test('purpose and space are authenticated, including header tampering and copied ciphertext', async () => {
  const cipher = createVaultCipher(key);
  const credential = cipher.encrypt('private', 'space-a', 'credentials');
  assert.throws(() => cipher.decrypt(credential.replace(':credentials:', ':shared:'), 'space-a', 'shared'), /could not be opened/);
  assert.throws(() => cipher.encrypt(credential, 'space-a', 'shared'), /cannot be opened as a shared/);
  const { request } = fixture();
  const [shared] = (await request('protectShared', 'member', ['keep-this-in-a'])).body.values;
  const wrongSpace = await request('revealShared', 'member', [shared], 'space-b');
  assert.equal(wrongSpace.status, 422);
  assert.equal(wrongSpace.body.values, undefined, 'a failed decrypt never returns a destructive empty field');
  assert.equal((await request('revealShared', 'member', [shared], 'not-a-membership')).status, 403);
});

test('explicit space survives an account-wide pointer change in another tab', async () => {
  const { request } = fixture();
  const a = await request('protectShared', 'member', ['value-for-a'], 'space-a');
  const b = await request('protectShared', 'member', ['value-for-b'], 'space-b');
  assert.deepEqual((await request('revealShared', 'member', a.body.values, 'space-a')).body.values, ['value-for-a']);
  assert.deepEqual((await request('revealShared', 'member', b.body.values, 'space-b')).body.values, ['value-for-b']);
  assert.equal((await request('revealShared', 'member', a.body.values, 'space-b')).status, 422);
});

test('legacy shared values need a server-owned admin approval and preserve existing data', async () => {
  for (const version of [1, 2]) {
    const value = oldEncrypt('existing-wifi-password', 'space-a', version);
    const { request, writes, approvals } = fixture({ shared: new Set([value]) });
    const before = await request('revealShared', 'member', [value], 'space-a', { approved: true });
    assert.equal(before.status, 409);
    assert.equal(before.body.code, version === 1 ? 'VAULT_LEGACY_INVENTORY_REQUIRED' : 'VAULT_ADMIN_REFRESH_REQUIRED');
    assert.equal(before.body.values, undefined);
    if (version === 1) approvals.set(`space-a:${legacyFingerprint(value)}`, true); // trusted release inventory, not client source fields
    const adminRead = await request('revealShared', 'admin', [value]);
    assert.deepEqual(adminRead.body.values, ['existing-wifi-password']);
    assert.deepEqual(writes, version === 1 ? [] : [{ spaceId: 'space-a', fingerprints: [legacyFingerprint(value)], uid: 'admin' }]);
    assert.ok(!JSON.stringify(writes).includes('existing-wifi-password'));
    for (const uid of ['member']) assert.deepEqual((await request('revealShared', uid, [value])).body.values, ['existing-wifi-password']);
    const upgraded = await request('protectShared', 'member', [value]);
    assert.ok(upgraded.body.values[0].startsWith('enc:3:shared:'));
    assert.deepEqual((await request('revealShared', 'member', upgraded.body.values)).body.values, ['existing-wifi-password']);
    assert.equal((await request('revealShared', 'member', [value], 'space-b')).status, 409, 'legacy approvals cannot cross spaces');
  }
});

test('admin cannot accidentally register an arbitrary legacy credential as a shared record', async () => {
  const credential = oldEncrypt('personal-mail-password', 'space-a');
  const allowed = collectLegacySharedValues({ members: [{ identity: { svNumber: credential }, digitalAccounts: [{ passwordPlain: credential }] }] });
  assert.equal(allowed.has(credential), false, 'copying the known private source into a shared field does not make it shareable');
  const { request, writes } = fixture({ shared: allowed });
  assert.equal((await request('revealShared', 'admin', [credential])).status, 403);
  assert.equal((await request('protectShared', 'member', [credential])).status, 409);
  assert.equal(writes.length, 0);
  assert.deepEqual((await request('reveal', 'admin', [credential])).body.values, ['personal-mail-password'], 'admin access to historical credentials survives');
  const upgraded = await request('protect', 'admin', [credential]);
  assert.ok(upgraded.body.values[0].startsWith('enc:3:credentials:'));
});

test('legacy allowlist covers every supported shared field and excludes arbitrary strings', () => {
  const values = Array.from({ length: 7 }, (_, i) => oldEncrypt(`shared-${i}`, 'space-a'));
  const privateValue = oldEncrypt('private', 'space-a');
  const allowed = collectLegacySharedValues({
    members: [{
      identity: { nationalIdNumber: values[0] }, identifiers: { ssn: values[1] },
      passports: [{ number: values[2] }], travel: { visas: [{ number: values[3] }] },
      financialAccounts: [{ accountNumber: values[4] }], notes: privateValue,
    }],
    household: { wifiPassword: values[5], notes: privateValue },
    finances: { banks: [{ iban: values[6] }] },
  });
  assert.deepEqual(allowed, new Set(values));
  assert.equal(allowed.has(privateValue), false);
});

test('private legacy inventory survives source deletion and outranks a shared approval forever', async () => {
  const credential = oldEncrypt('old-private-credential', 'space-a');
  const legitimateShared = oldEncrypt('wifi', 'space-a');
  const privateSources = new Set([credential]);
  const { request, denials, approvals } = fixture({ shared: new Set([legitimateShared, credential]), privateSources });
  // Opening an unrelated legitimate shared field inventories all stored old
  // private sources, including sources not requested in this batch.
  assert.equal((await request('revealShared', 'admin', [legitimateShared])).status, 200);
  assert.equal(denials.has(`space-a:${legacyFingerprint(credential)}`), true);
  privateSources.delete(credential); // an admin later legitimately removes it
  approvals.set(`space-a:${legacyFingerprint(credential)}`, true); // even a stale approval cannot override the deny
  for (const uid of ['admin', 'member']) {
    const result = await request('revealShared', uid, [credential]);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'VAULT_PURPOSE_DENIED');
    assert.equal(result.body.values, undefined);
  }
  assert.equal((await request('protectShared', 'member', [credential])).status, 403);
  assert.ok(!JSON.stringify([...denials.keys()]).includes('old-private-credential'));
  assert.deepEqual((await request('reveal', 'admin', [credential])).body.values, ['old-private-credential'], 'private inventory does not revoke legitimate admin credential access');
});

test('private legacy reveal and protect both inventory a credential before its source disappears', async () => {
  for (const operation of ['reveal', 'protect']) {
    const credential = oldEncrypt(`private-${operation}`, 'space-a');
    const { request, denials } = fixture({ shared: new Set([credential]) });
    assert.equal((await request(operation, 'admin', [credential])).status, 200);
    assert.equal(denials.has(`space-a:${legacyFingerprint(credential)}`), true);
    assert.equal((await request('revealShared', 'admin', [credential])).status, 403);
    assert.equal((await request('revealShared', 'member', [credential])).status, 403);
  }
});

test('unbound v1 ciphertext cannot acquire a new tenant merely by being pasted into a writable source', async () => {
  const credential = oldEncrypt('pre-aad-private', 'space-a', 1);
  const { request, denials, approvals } = fixture({ shared: new Set([credential]), privateSources: new Set([credential]) });
  assert.equal((await request('reveal', 'admin', [credential], 'space-b')).status, 403);
  assert.equal((await request('protect', 'admin', [credential], 'space-b')).status, 403);
  assert.equal((await request('revealShared', 'admin', [credential], 'space-b')).status, 409);
  assert.equal(denials.has(`space-b:${legacyFingerprint(credential)}`), false, 'runtime source lookup cannot certify an unbound ciphertext');
  denials.set(`space-a:${legacyFingerprint(credential)}`, true); // root-owned inventory from the original source space
  assert.deepEqual((await request('reveal', 'admin', [credential], 'space-a')).body.values, ['pre-aad-private']);
  assert.equal((await request('reveal', 'admin', [credential], 'space-b')).status, 403);
  approvals.set(`space-b:${legacyFingerprint(credential)}`, true);
  assert.equal((await request('reveal', 'admin', [credential], 'space-b')).status, 403, 'shared inventory cannot authorize a private legacy reveal');
});

test('missing keys, corrupt ciphertext and malformed requests fail without empty values', async () => {
  const { request, handlers } = fixture();
  assert.equal((await handlers.revealShared({ uid: 'member', body: { values: [] } })).status, 400);
  for (const id of ['', '../space', 'space/path', null, 42]) assert.throws(() => vaultSpaceId(id));
  const encrypted = createVaultCipher(key).encrypt('saved', 'space-a', 'shared');
  const broken = encrypted.slice(0, -4) + 'AAAA';
  assert.equal((await request('revealShared', 'member', [broken])).status, 422);
  assert.equal((await request('protectShared', 'member', [undefined])).status, 400);
  assert.equal((await fixture({ encryptionKey: null }).request('revealShared', 'member', [encrypted])).status, 503);
});

test('the live routes use the tested handlers and the legacy registry is client-inaccessible', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  for (const method of ['protect', 'reveal', 'protectShared', 'revealShared']) assert.ok(server.includes(`vaultHandlers.${method}`));
  assert.ok(server.includes('resolveVaultMembership(spaceId, roleSnap.exists ? roleSnap.data() : null)'));
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/vaultLegacyShared\/\{fingerprint\}\s*\{\s*allow read, write: if false;/);
  assert.match(rules, /match \/vaultLegacyPrivate\/\{fingerprint\}\s*\{\s*allow read, write: if false;/);
  const db = fs.readFileSync(new URL('../src/utils/db.ts', import.meta.url), 'utf8');
  for (const field of ['Identity', 'Passports', 'Visas', 'Identifiers', 'FinancialAccounts', 'Household', 'Finances']) {
    assert.ok(db.includes(`protect${field}`));
    assert.ok(!new RegExp(`protect${field}\\([^\\n]*, protectSecrets\\)`).test(db), `shared ${field} must not use the private credential purpose`);
  }
  assert.ok(db.includes('JSON.stringify({ values, spaceId })'));
});
