import crypto from 'node:crypto';
import {
  HOUSEHOLD_SECRET_KEYS, BANK_SECRET_KEYS, NATIONAL_ID_SECRET_KEYS,
  FINANCIAL_ACCOUNT_SECRET_KEYS, IDENTITY_SECRET_KEYS,
} from './vaultSharedFields.mjs';

export class VaultError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function vaultSpaceId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new VaultError(400, 'VAULT_SPACE_REQUIRED', 'Choose the space whose records you are opening.');
  }
  return value;
}

export function resolveVaultMembership(spaceId, roleDoc) {
  vaultSpaceId(spaceId);
  if (!roleDoc || !['admin', 'member', 'child'].includes(roleDoc.role)) {
    throw new VaultError(403, 'VAULT_ACCESS_DENIED', 'You no longer have access to that space.');
  }
  return { familyId: spaceId, role: roleDoc.role };
}

const legacy = value => typeof value === 'string' && /^enc:[12]:/.test(value);
export const legacyFingerprint = value => crypto.createHash('sha256').update(value).digest('hex');

export function collectLegacyCredentialValues({ members = [], passwords = [] }) {
  const credentials = new Set();
  for (const member of members) {
    for (const account of member.digitalAccounts || []) if (legacy(account?.passwordPlain)) credentials.add(account.passwordPlain);
  }
  for (const password of passwords) if (legacy(password?.password)) credentials.add(password.password);
  return credentials;
}

/** Only an admin's server-verified, stored shared fields can approve old blobs.
 * A credential copied into a shared field is excluded while its source exists.
 * New ciphertext carries its purpose cryptographically and never needs this. */
export function collectLegacySharedValues({ members = [], household, finances, passwords = [] }) {
  const shared = new Set();
  const credentials = collectLegacyCredentialValues({ members, passwords });
  const add = (record, keys, target = shared) => {
    for (const key of keys) if (legacy(record?.[key])) target.add(record[key]);
  };
  for (const member of members) {
    add(member.identity, IDENTITY_SECRET_KEYS);
    add(member.identifiers, NATIONAL_ID_SECRET_KEYS);
    for (const passport of member.passports || []) add(passport, ['number']);
    for (const visa of member.travel?.visas || []) add(visa, ['number']);
    for (const account of member.financialAccounts || []) add(account, FINANCIAL_ACCOUNT_SECRET_KEYS);
  }
  add(household, HOUSEHOLD_SECRET_KEYS);
  for (const bank of finances?.banks || []) add(bank, BANK_SECRET_KEYS);
  for (const value of credentials) shared.delete(value);
  return shared;
}

export function createVaultCipher(key) {
  const requireKey = () => {
    if (!key) throw new VaultError(503, 'VAULT_UNAVAILABLE', 'Secret encryption is unavailable. Try again shortly.');
  };
  const aad = (spaceId, purpose) => Buffer.from(JSON.stringify(['teluva-vault-v3', spaceId, purpose]));
  const decrypt = (value, spaceId, purpose, allowLegacy = false) => {
    requireKey();
    if (typeof value !== 'string') throw new VaultError(400, 'VAULT_INVALID_VALUES', 'Secret values must be text.');
    if (!value.startsWith('enc:')) return value;
    const parts = value.split(':');
    let iv, tag, ciphertext, additionalData;
    if (parts[1] === '3' && parts.length === 6 && parts[2] === purpose) {
      [, , , iv, tag, ciphertext] = parts;
      additionalData = aad(spaceId, purpose);
    } else if (allowLegacy && ['1', '2'].includes(parts[1]) && parts.length === 5) {
      [, , iv, tag, ciphertext] = parts;
      if (parts[1] === '2') additionalData = Buffer.from(spaceId);
    } else {
      throw new VaultError(403, 'VAULT_PURPOSE_DENIED', 'This protected value cannot be opened as a shared record.');
    }
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      if (additionalData) decipher.setAAD(additionalData);
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new VaultError(422, 'VAULT_CANNOT_OPEN', 'A protected value could not be opened in this space. Your saved record has been kept.');
    }
  };
  const encrypt = (value, spaceId, purpose) => {
    requireKey();
    if (typeof value !== 'string') throw new VaultError(400, 'VAULT_INVALID_VALUES', 'Secret values must be text.');
    if (value === '') return value;
    // Do not silently carry an unknown or wrong-purpose blob into another field.
    if (value.startsWith('enc:')) {
      decrypt(value, spaceId, purpose);
      return value;
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(spaceId, purpose));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `enc:3:${purpose}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ciphertext.toString('base64')}`;
  };
  return { encrypt, decrypt };
}

/** Dependency-injected route implementation: tests use real crypto and fake
 * membership/storage, with no production Firebase access or live records. */
export function createVaultHandlers({ key, authorize, loadLegacyShared, loadApprovedLegacy, approveLegacy, loadDeniedLegacy, rememberPrivateLegacy }) {
  const cipher = createVaultCipher(key);
  const legacyAllowed = async (values, caller) => {
    const candidates = [...new Set(values.filter(legacy))];
    if (!candidates.length) return;
    let storedShared;
    if (caller.role === 'admin') {
      const snapshot = await loadLegacyShared(caller.familyId);
      storedShared = snapshot.shared;
      // The private classification is permanent: deleting its source later
      // cannot turn a previously private ciphertext into a shared value.
      const tenantBoundPrivate = [...snapshot.credentials].filter(value => !value.startsWith('enc:1:'));
      if (tenantBoundPrivate.length) await rememberPrivateLegacy(caller.familyId, tenantBoundPrivate.map(legacyFingerprint));
    }
    const denied = await loadDeniedLegacy(caller.familyId, candidates.map(legacyFingerprint));
    if (candidates.some(value => denied.has(legacyFingerprint(value)))) {
      throw new VaultError(403, 'VAULT_PURPOSE_DENIED', 'This protected value was classified as a personal credential.');
    }
    const approved = await loadApprovedLegacy(caller.familyId, candidates.map(legacyFingerprint));
    const missing = candidates.filter(value => !approved.has(legacyFingerprint(value)));
    if (!missing.length) return;
    // v1 has no tenant binding. A writable source field is not proof: an
    // admin of another space could paste a stolen v1 blob into their own one.
    // Only the trusted release inventory may authorize those old values.
    if (missing.some(value => value.startsWith('enc:1:'))) {
      throw new VaultError(409, 'VAULT_LEGACY_INVENTORY_REQUIRED', 'Older protected records need the server inventory refresh. Your saved values have been kept.');
    }
    if (caller.role !== 'admin') {
      throw new VaultError(409, 'VAULT_ADMIN_REFRESH_REQUIRED', 'An admin needs to open these shared records once before this account can read them.');
    }
    if (missing.some(value => !storedShared.has(value))) {
      throw new VaultError(403, 'VAULT_PURPOSE_DENIED', 'This protected value is not a stored shared record.');
    }
    // Validate before approving: corrupt or cross-space blobs never get a grant.
    missing.forEach(value => cipher.decrypt(value, caller.familyId, 'shared', true));
    await approveLegacy(caller.familyId, missing.map(legacyFingerprint), caller.uid);
  };
  const handler = (purpose, operation) => async req => {
    try {
      const caller = await authorize(req);
      if (caller.error) return { status: caller.status, body: { error: caller.error, code: 'VAULT_ACCESS_DENIED' } };
      if (purpose === 'credentials' && caller.role !== 'admin') {
        throw new VaultError(403, 'VAULT_ACCESS_DENIED', 'Only admins can open or save personal credentials.');
      }
      if (purpose === 'shared' && caller.role === 'child') {
        throw new VaultError(403, 'VAULT_ACCESS_DENIED', 'Saved ID numbers and codes are not available on child accounts.');
      }
      if (operation === 'protect' && caller.role === 'child') {
        throw new VaultError(403, 'VAULT_ACCESS_DENIED', 'Only adults can save shared records.');
      }
      const values = req.body?.values;
      if (!Array.isArray(values) || values.length > 400 || values.some(value => typeof value !== 'string' || value.length > 100_000)) {
        throw new VaultError(400, 'VAULT_INVALID_VALUES', 'Send a list of text values.');
      }
      if (purpose === 'shared') await legacyAllowed(values, caller);
      else {
        const privateLegacy = [...new Set(values.filter(legacy))];
        const unbound = privateLegacy.filter(value => value.startsWith('enc:1:'));
        if (unbound.length) {
          const inventoried = await loadDeniedLegacy(caller.familyId, unbound.map(legacyFingerprint));
          if (unbound.some(value => !inventoried.has(legacyFingerprint(value)))) {
            throw new VaultError(403, 'VAULT_PURPOSE_DENIED', 'This older credential has no verified source in this space.');
          }
        }
        if (privateLegacy.length) await rememberPrivateLegacy(caller.familyId, privateLegacy.map(legacyFingerprint));
      }
      const output = values.map(value => {
        if (operation === 'reveal') return cipher.decrypt(value, caller.familyId, purpose, legacy(value));
        const plain = legacy(value) ? cipher.decrypt(value, caller.familyId, purpose, true) : value;
        return cipher.encrypt(plain, caller.familyId, purpose);
      });
      return { status: 200, body: { values: output } };
    } catch (error) {
      if (error instanceof VaultError) return { status: error.status, body: { error: error.message, code: error.code } };
      // Do not log request values or decrypted secrets.
      console.error('[vault] operation failed', error?.code || error?.name || 'unknown');
      return { status: 503, body: { error: 'Could not open the protected records. Try again shortly.', code: 'VAULT_UNAVAILABLE' } };
    }
  };
  return {
    protect: handler('credentials', 'protect'),
    reveal: handler('credentials', 'reveal'),
    protectShared: handler('shared', 'protect'),
    revealShared: handler('shared', 'reveal'),
  };
}
