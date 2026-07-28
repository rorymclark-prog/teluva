// ---------------------------------------------------------------------------
// Redaction of the AI assistant's FAMILY DATA context.
//
// Everything AIChatbot's buildContext() assembles is POSTed to /api/chat and
// from there to Gemini (Vertex AI, EU). That is a legitimate, consented
// processing path — but "the assistant can answer questions about our records"
// must not mean "every household credential and government ID number is sent to
// a third-party model on every single message, whether or not the question has
// anything to do with them".
//
// These helpers are pure and total (they never throw on odd input) so they can
// be unit-tested without a browser, Firebase or a network — see aiRedact.test.ts.
//
// WHAT IS REMOVED, and why each one is safe to remove:
//
//   household.doorCode / .garageCode / .wifiPassword
//       Physical access credentials to the family's home. The system prompt uses
//       these only as WRITE targets ({"kind":"household_set","field":"doorCode"|
//       "wifiPassword"|"garageCode"}) — extraction reads the value out of the
//       user's message or an attached photo, so it never needs the CURRENT value
//       in context to set a new one. wifiName is KEPT (it is a network name, not
//       a secret, and it is what identifies which network is meant).
//       TENSION, deliberately accepted: the assistant can no longer READ these
//       back ("what's the wifi password?"). They remain visible in the Household
//       view, which is where they were always primarily read from.
//
//   finances.banks[].iban / .bic
//       Payment credentials. bankName/accountHolder/notes are KEPT so "which
//       banks do we have?" still works.
//
//   members[].identifiers  (NationalIdentifiers: ssn, nationalId,
//       driversLicenseNo, taxId, insuranceNo)
//       Government identity numbers. This is the LEGACY identifier block; the
//       actively-used one is members[].identity (IdentityRecord), which is what
//       MemberIDs renders and what the system prompt's canonical "identity"
//       field keys map onto. See the NOTE below.
//
//   members[].financialAccounts  (accountNumber, routingNumber)
//       Bank account + routing numbers on a person's profile.
//
//   members[].identity — the ID NUMBERS only (see REDACTED_IDENTITY_KEYS).
//       Rory's call, 2026-07-28: strip the numbers, keep the dates. The whole
//       block was previously kept because dropping it would break shipped,
//       prompt-documented behaviour — but that turned out to be true only of
//       the DATES. "When does my residence permit expire?" is a starter
//       suggestion and still works; "what is my SV-Nummer?" no longer does,
//       and that is the intended trade. The numbers remain on the ID screen,
//       which is where they were always actually read from.
//
// NOT removed, on purpose — read the note before "tidying" these up:
//   members[].identity expiry dates and scheme names (residencePermitExpiry,
//       driversLicenseExpiry, medicalAidScheme, medicalAidPlanOption,
//       medicalAidDependantCode, idDocumentType, registeredGpPractice,
//       notes). These drive the expiry nudges and the questions people
//       actually ask, and a scheme name is not a credential.
//   insurance[].policyNumber, utilities[].accountNumber — lower sensitivity
//       than a government ID, and genuinely useful to recall ("which policy
//       number do I quote?"). Revisit if the risk appetite changes.
// ---------------------------------------------------------------------------

/** Household credential keys that must never leave the browser in AI context. */
export const REDACTED_HOUSEHOLD_KEYS = ['doorCode', 'garageCode', 'wifiPassword', 'alarmCode'] as const;

/** Bank-record keys that must never leave the browser in AI context. */
export const REDACTED_BANK_KEYS = ['iban', 'bic'] as const;

/** Member-profile keys that must never leave the browser in AI context. */
export const REDACTED_MEMBER_KEYS = ['identifiers', 'financialAccounts'] as const;

/**
 * Government/insurance ID NUMBERS inside members[].identity.
 *
 * Removed rather than the whole `identity` block, because the two halves of
 * that record have very different value-to-risk ratios:
 *
 *   The NUMBERS below are what you would least want sitting in a third-party
 *   prompt log, and are the least useful to an assistant — nobody asks a chat
 *   assistant to read their Sozialversicherungsnummer aloud; they open the
 *   ID screen, where these are all still shown.
 *
 *   The DATES and SCHEME NAMES are kept, because they are what people actually
 *   ask ("when does my residence permit expire?" is a shipped starter
 *   suggestion), they drive the expiry nudges, and a scheme name like
 *   "Discovery Health" is not a credential.
 */
export const REDACTED_IDENTITY_KEYS = [
  'eCardNumber',
  'svNumber',              // Austrian Sozialversicherungsnummer
  'taxNumber',
  'studentNumber',
  'schoolRegNumber',
  'residencePermitNumber', // …Expiry is KEPT — it is what gets asked about
  'nationalIdNumber',      // SA 13-digit ID, and the SSN-equivalent elsewhere
  'birthCertNumber',
  'medicalAidNumber',      // …Scheme/PlanOption/DependantCode are KEPT
  'insuranceGroupNumber',
  'citizenshipCertNumber',
  'driversLicenseNumber',  // …Expiry is KEPT
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function omit<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) delete out[k];
  return out as T;
}

/**
 * Strip door/garage/alarm codes and the Wi-Fi password from the household doc.
 * Null/undefined pass straight through (buildContext's loaders can return null).
 */
export function redactHousehold<T>(household: T): T {
  if (!isPlainObject(household)) return household;
  return omit(household, REDACTED_HOUSEHOLD_KEYS) as T;
}

/**
 * Strip IBAN/BIC from every bank record in the finances doc, leaving the rest
 * (bank name, account holder, insurance, benefits) intact.
 */
export function redactFinances<T>(finances: T): T {
  if (!isPlainObject(finances)) return finances;
  const banks = finances.banks;
  if (!Array.isArray(banks)) return finances;
  return {
    ...finances,
    banks: banks.map((b) => (isPlainObject(b) ? omit(b, REDACTED_BANK_KEYS) : b)),
  } as T;
}

/**
 * Strip the legacy national-identifier block, per-member bank accounts, and the
 * government/insurance ID NUMBERS inside `identity`, from one already-slimmed
 * member object. Identity expiry dates and scheme names survive — see
 * REDACTED_IDENTITY_KEYS for why the record is split rather than dropped.
 */
export function redactMember<T>(member: T): T {
  if (!isPlainObject(member)) return member;
  const stripped: Record<string, unknown> = omit(member, REDACTED_MEMBER_KEYS);
  const identity = stripped.identity;
  if (isPlainObject(identity)) {
    stripped.identity = omit(identity, REDACTED_IDENTITY_KEYS);
  }
  return stripped as T;
}
