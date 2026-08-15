// ---------------------------------------------------------------------------
// Encrypt-at-rest for the shared family records already flagged sensitive by
// aiRedact.ts (identity numbers, household codes, bank IBAN/BIC) plus
// passport numbers. Reuses the exact AES-256-GCM round-trip already proven in
// production for saved passwords (protectSecrets/revealSharedSecrets in
// db.ts) — this file is the object-shape-aware layer on top: which keys to
// touch inside FamilyMember.identity / HouseholdInfo / FinancesInfo, and how
// to keep working offline once a value has been seen.
//
// PURE ON PURPOSE: no Firebase/network imports here, so this is unit-testable
// without a browser (see vaultFields.test.ts) — same convention as
// mergeShared.ts and aiRedact.ts. The actual crypto round-trip is passed in
// as a function (protectFn/revealFn), not imported, which is also what keeps
// this file decoupled from db.ts instead of forming an import cycle with it.
//
// WHY THE KEY LISTS ARE REUSED FROM aiRedact.ts, NOT REDEFINED HERE: "too
// sensitive for a third-party AI's prompt" and "too sensitive to sit in
// plaintext in the database" are, in this app, the same judgement call. One
// canonical list for both purposes means they can never quietly drift apart.
//
// CALLER RESPONSIBILITY — this is the one thing that must never be gotten
// wrong: db.ts's saveReferenceDoc runs a real three-way plaintext diff
// (mergeShared) between what this device last saw, what it wants to save,
// and what the server holds. protect* must only ever be applied to the FINAL
// value on its way into a Firestore write, and reveal* only to a value that
// just came OUT of Firestore — never to anything that will be compared inside
// mergeShared, or the diff sees ciphertext (which never equals anything,
// including itself before/after a no-op re-encrypt) and treats every
// untouched field as a fresh edit.
// ---------------------------------------------------------------------------

import { IdentityRecord, HouseholdInfo, FinancesInfo, BankAccount, PassportRecord, VisaRecord, NationalIdentifiers, FinancialAccount } from '../types';
import { REDACTED_IDENTITY_KEYS, REDACTED_HOUSEHOLD_KEYS, REDACTED_BANK_KEYS, REDACTED_NATIONAL_ID_KEYS, REDACTED_FINANCIAL_ACCOUNT_KEYS } from './aiRedact';

/** A round-trip call to the server's encrypt or decrypt endpoint, batched. */
export type VaultTransform = (values: string[]) => Promise<string[]>;

const ENC_PREFIX = 'enc:';
const looksEncrypted = (v: unknown): v is string => typeof v === 'string' && v.startsWith(ENC_PREFIX);

// --- offline-friendly reveal cache: ciphertext -> plaintext -------------
//
// Keyed by the ciphertext itself (not by field/member id): every encryption
// uses a fresh random IV, so editing a value always produces new ciphertext
// and a fresh cache entry. There is no staleness risk to manage — only cache
// hits and misses. This is what lets a screen like Emergency essentials keep
// showing a real SV number offline, once it has been viewed at least once
// while online, exactly like every other offline-cached field in this app.
const REVEAL_CACHE_KEY = 'vault_reveal_cache_v1';
const REVEAL_CACHE_MAX = 400;

function readRevealCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(REVEAL_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRevealCache(cache: Record<string, string>): void {
  try {
    const keys = Object.keys(cache);
    if (keys.length > REVEAL_CACHE_MAX) {
      // Simple oldest-first eviction (insertion order) — plenty for a single
      // family's data volume, no need for real LRU bookkeeping.
      for (const k of keys.slice(0, keys.length - REVEAL_CACHE_MAX)) delete cache[k];
    }
    localStorage.setItem(REVEAL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private-mode / quota — the cache just won't persist this round. Not
    // fatal: values still decrypt fine whenever there's a connection.
  }
}

/**
 * Reveal a batch of possibly-encrypted values. Already-plaintext values
 * (legacy data, or encryption not configured) pass straight through. Values
 * this device has decrypted before come back instantly from the local cache,
 * with no network call — so this works offline for anything previously seen.
 * A genuinely new ciphertext with no connection resolves to '' rather than
 * leaking the raw ciphertext string into the UI.
 */
export async function revealCached(values: (string | undefined)[], revealFn: VaultTransform): Promise<string[]> {
  const clean = values.map(v => v ?? '');
  const cache = readRevealCache();
  const misses: string[] = [];
  clean.forEach((v) => {
    if (looksEncrypted(v) && !(v in cache) && !misses.includes(v)) misses.push(v);
  });

  if (misses.length) {
    try {
      const revealed = await revealFn(misses);
      if (revealed.length === misses.length) {
        misses.forEach((ct, i) => { cache[ct] = revealed[i]; });
        writeRevealCache(cache);
      }
    } catch {
      // Offline / server error — fall through with whatever the cache already has.
    }
  }

  return clean.map(v => (looksEncrypted(v) ? (cache[v] ?? '') : v));
}

// --- generic key-walkers, shared by identity/household/finances ---------

function protectFields<T extends object>(
  obj: T | undefined, keys: readonly string[], protectFn: VaultTransform,
): Promise<T | undefined> {
  return (async () => {
    if (!obj) return obj;
    const src = obj as Record<string, unknown>;
    const entries = keys
      .filter(k => typeof src[k] === 'string' && src[k] !== '')
      .map(k => ({ key: k, value: src[k] as string }));
    if (!entries.length) return obj;
    const protectedValues = await protectFn(entries.map(e => e.value));
    const out: Record<string, unknown> = { ...src };
    entries.forEach((e, i) => { out[e.key] = protectedValues[i]; });
    return out as T;
  })();
}

function revealFields<T extends object>(
  obj: T | undefined, keys: readonly string[], revealFn: VaultTransform,
): Promise<T | undefined> {
  return (async () => {
    if (!obj) return obj;
    const src = obj as Record<string, unknown>;
    const entries = keys
      .filter(k => typeof src[k] === 'string' && src[k] !== '')
      .map(k => ({ key: k, value: src[k] as string }));
    if (!entries.length) return obj;
    const revealed = await revealCached(entries.map(e => e.value), revealFn);
    const out: Record<string, unknown> = { ...src };
    entries.forEach((e, i) => { out[e.key] = revealed[i]; });
    return out as T;
  })();
}

function protectArrayFields<T extends object>(
  arr: T[] | undefined, keys: readonly string[], protectFn: VaultTransform,
): Promise<T[] | undefined> {
  return (async () => {
    if (!Array.isArray(arr) || !arr.length) return arr;
    const entries: { i: number; key: string; value: string }[] = [];
    arr.forEach((item, i) => {
      const src = item as Record<string, unknown>;
      for (const key of keys) {
        const v = src[key];
        if (typeof v === 'string' && v !== '') entries.push({ i, key, value: v });
      }
    });
    if (!entries.length) return arr;
    const protectedValues = await protectFn(entries.map(e => e.value));
    const out = arr.map(item => ({ ...item }));
    entries.forEach((e, i) => { (out[e.i] as Record<string, unknown>)[e.key] = protectedValues[i]; });
    return out;
  })();
}

function revealArrayFields<T extends object>(
  arr: T[] | undefined, keys: readonly string[], revealFn: VaultTransform,
): Promise<T[] | undefined> {
  return (async () => {
    if (!Array.isArray(arr) || !arr.length) return arr;
    const entries: { i: number; key: string; value: string }[] = [];
    arr.forEach((item, i) => {
      const src = item as Record<string, unknown>;
      for (const key of keys) {
        const v = src[key];
        if (typeof v === 'string' && v !== '') entries.push({ i, key, value: v });
      }
    });
    if (!entries.length) return arr;
    const revealed = await revealCached(entries.map(e => e.value), revealFn);
    const out = arr.map(item => ({ ...item }));
    entries.forEach((e, i) => { (out[e.i] as Record<string, unknown>)[e.key] = revealed[i]; });
    return out;
  })();
}

// --- typed, named entry points --------------------------------------------

export const protectIdentity = (identity: IdentityRecord | undefined, fn: VaultTransform) =>
  protectFields(identity, REDACTED_IDENTITY_KEYS, fn);
export const revealIdentity = (identity: IdentityRecord | undefined, fn: VaultTransform) =>
  revealFields(identity, REDACTED_IDENTITY_KEYS, fn);

export const protectHousehold = (h: HouseholdInfo | undefined, fn: VaultTransform) =>
  protectFields(h, REDACTED_HOUSEHOLD_KEYS, fn);
export const revealHousehold = (h: HouseholdInfo | undefined, fn: VaultTransform) =>
  revealFields(h, REDACTED_HOUSEHOLD_KEYS, fn);

export async function protectFinances(f: FinancesInfo | undefined, fn: VaultTransform): Promise<FinancesInfo | undefined> {
  if (!f || !Array.isArray(f.banks) || !f.banks.length) return f;
  const banks = await protectArrayFields<BankAccount>(f.banks, REDACTED_BANK_KEYS, fn);
  return { ...f, banks: banks || f.banks };
}
export async function revealFinances(f: FinancesInfo | undefined, fn: VaultTransform): Promise<FinancesInfo | undefined> {
  if (!f || !Array.isArray(f.banks) || !f.banks.length) return f;
  const banks = await revealArrayFields<BankAccount>(f.banks, REDACTED_BANK_KEYS, fn);
  return { ...f, banks: banks || f.banks };
}

const PASSPORT_NUMBER_KEYS = ['number'] as const;
export const protectPassports = (passports: PassportRecord[] | undefined, fn: VaultTransform) =>
  protectArrayFields<PassportRecord>(passports, PASSPORT_NUMBER_KEYS, fn);
export const revealPassports = (passports: PassportRecord[] | undefined, fn: VaultTransform) =>
  revealArrayFields<PassportRecord>(passports, PASSPORT_NUMBER_KEYS, fn);

// Same government-ID class as a passport number (see aiRedact.ts's note on
// members[].visas[].number) — found stored in plaintext, right next to an
// already-encrypted passports array on the same member doc, in the
// 2026-08-15 chat-function audit.
const VISA_NUMBER_KEYS = ['number'] as const;
export const protectVisas = (visas: VisaRecord[] | undefined, fn: VaultTransform) =>
  protectArrayFields<VisaRecord>(visas, VISA_NUMBER_KEYS, fn);
export const revealVisas = (visas: VisaRecord[] | undefined, fn: VaultTransform) =>
  revealArrayFields<VisaRecord>(visas, VISA_NUMBER_KEYS, fn);

// members[].identifiers (SSN, national ID, driver's licence, tax ID,
// insurance number) and members[].financialAccounts (bank account/routing
// number). Both were already stripped from AI context by
// REDACTED_MEMBER_KEYS in aiRedact.ts — but that only stops them reaching
// Gemini; nothing stopped them reaching Firestore in plaintext. Found in the
// SecureSecrets.tsx panel, which is manual-write-only (no AI edit path exists
// for either field — confirmed by aiEditCoverage.test.ts listing
// financialAccounts as manual-only) and is literally titled "National ID &
// SSN credentials" / "Financial reference & utilities" under a lock icon —
// the strongest implied promise of protection anywhere in the app, on
// exactly the fields (a Social Security Number, a bank account number) that
// had none. 2026-08-15 chat-function audit, same session as the visas gap
// above; same root cause, one field group deeper.
export const protectIdentifiers = (identifiers: NationalIdentifiers | undefined, fn: VaultTransform) =>
  protectFields(identifiers, REDACTED_NATIONAL_ID_KEYS, fn);
export const revealIdentifiers = (identifiers: NationalIdentifiers | undefined, fn: VaultTransform) =>
  revealFields(identifiers, REDACTED_NATIONAL_ID_KEYS, fn);

export const protectFinancialAccounts = (accounts: FinancialAccount[] | undefined, fn: VaultTransform) =>
  protectArrayFields<FinancialAccount>(accounts, REDACTED_FINANCIAL_ACCOUNT_KEYS, fn);
export const revealFinancialAccounts = (accounts: FinancialAccount[] | undefined, fn: VaultTransform) =>
  revealArrayFields<FinancialAccount>(accounts, REDACTED_FINANCIAL_ACCOUNT_KEYS, fn);
