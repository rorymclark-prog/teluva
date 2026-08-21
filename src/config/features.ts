// Dark-launch feature flags.
//
// These default OFF so a feature can be fully built, shipped, and code-reviewed
// while staying invisible to real users until it is deliberately switched on.
//
// INSURANCE_READER: the recall-only "read my policy conditions" tool. It quotes
// obligations verbatim from the user's OWN policy document and turns them into a
// checklist. It NEVER states whether anything is covered and NEVER gives advice.
// Even so it must stay OFF until a licensed Austrian Rechtsanwalt confirms the
// recall/advice line for this product (regulated Versicherungsvermittlung risk,
// GewO §137). The server has its OWN independent gate (FEATURE_INSURANCE_READER
// env var) — both must be on for the feature to work, so flipping this const
// alone does nothing until the server flag is also set.
export const INSURANCE_READER_ENABLED = false;

// Ember Thread is the 2027 shell and Family Pulse experience. The classic
// dashboard remains compiled and can be selected instantly from Appearance,
// so this is a reversible presentation rollout rather than a data migration.
export const EMBER_THREAD_ENABLED = true;
