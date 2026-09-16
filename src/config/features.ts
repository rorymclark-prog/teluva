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
export const INSURANCE_READER_ENABLED = true;

// MEDICAL_READER: whether the document reader and the vault-wide search may
// touch documents filed under Medical or Health.
//
// This was a hard-coded refusal, and the reasoning behind it was real: Art. 9
// GDPR special-category data, and a worried person over-reading a lab value out
// of its clinical context. It is a FLAG now rather than a rule because the owner
// of a family vault asked for their own documents to be readable, and because
// the reasoning was aimed at INTERPRETATION — which the reader has never done.
// It returns passages sliced out of the document's own text; the prohibition on
// saying what a result MEANS is unchanged, unconditional, and still enforced for
// medical documents specifically.
//
// Left as a switch so the posture is a config change and not a code change. Set
// this and the server's FEATURE_MEDICAL_READER to false to restore the original
// refusal in one step.
export const MEDICAL_READER_ENABLED = true;

// Ember Thread is the 2027 shell and Family Pulse experience. The classic
// dashboard remains compiled and can be selected instantly from Appearance,
// so this is a reversible presentation rollout rather than a data migration.
export const EMBER_THREAD_ENABLED = true;
