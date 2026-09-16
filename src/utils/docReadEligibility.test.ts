// Standalone assertion tests — same convention as vaultFields.test.ts /
// aiRedact.test.ts:
//   npx tsx src/utils/docReadEligibility.test.ts
// It exits non-zero on failure.
//
// What these tests are actually protecting: this module decides whether the
// "Ask about this document" button appears. The server independently enforces
// the same rules, so a bug here is a UX bug, not a breach — but the branch that
// matters most is the insurance back-door, because that is the one a later
// refactor could quietly delete without anything else failing.
import assert from 'node:assert';
import { canAskAboutDocument, looksLikeInsuranceDocument, INSURANCE_NAME_PATTERNS } from './docReadEligibility';
import { INSURANCE_READER_ENABLED, MEDICAL_READER_ENABLED } from '../config/features';

// ── the happy path ──────────────────────────────────────────────────────────

{
  assert.strictEqual(
    canAskAboutDocument({ category: 'Legal', name: 'Mietvertrag Hauptstrasse.pdf', fileType: 'application/pdf' }),
    true,
    'a lease PDF in a family space is exactly what this feature is for',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: 'Other', name: 'notes.txt', fileType: 'text/plain' }),
    true,
    'plain text is extractable and therefore askable',
  );
  assert.strictEqual(
    canAskAboutDocument({}),
    true,
    'no information at all falls through to the server, which has the real record',
  );
}

// ── business spaces ─────────────────────────────────────────────────────────

{
  assert.strictEqual(
    canAskAboutDocument({ category: 'Legal', name: 'Mietvertrag.pdf', fileType: 'application/pdf', isBusinessSpace: true }),
    false,
    'business spaces are out entirely, even for an otherwise perfect document',
  );
  assert.strictEqual(
    canAskAboutDocument({ isBusinessSpace: true }),
    false,
    'business is checked first and needs no other field',
  );
  assert.strictEqual(
    canAskAboutDocument({ name: 'Mietvertrag.pdf', isBusinessSpace: false }),
    true,
    'explicitly-false must not be read as truthy',
  );
}

// ── medical / health ────────────────────────────────────────────────────────

// Medical was a hard denial until v345, when it became MEDICAL_READER_ENABLED —
// a switch, so the posture is a config change rather than a code change. These
// assertions therefore track the FLAG rather than a fixed answer: with it on
// they prove the category no longer blocks, with it off they prove the original
// refusal is intact, and either way they fail if the check stops keying on
// category at all.

{
  assert.strictEqual(
    canAskAboutDocument({ category: 'Medical', name: 'Befund.pdf', fileType: 'application/pdf' }),
    MEDICAL_READER_ENABLED,
    'VaultDocument category Medical follows the flag',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: 'Health', name: 'Impfpass.pdf', fileType: 'application/pdf' }),
    MEDICAL_READER_ENABLED,
    'FamilyDocument category Health is the same class of file under a different vocabulary, '
    + 'and must follow the same flag — checking only one vocabulary would admit the profile '
    + 'copy of a lab result while denying the vault copy of the same file',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: '  medical  ', name: 'x.pdf', fileType: 'application/pdf' }),
    MEDICAL_READER_ENABLED,
    'category matching must survive casing and stray whitespace from old records',
  );
  // THE CONTROL for the two above. Both currently expect `true`, which a
  // function that ignored category entirely would also produce. This one is
  // true for a different reason — "Medicalish" is not the category — so it
  // cannot distinguish anything on its own; what makes the pair meaningful is
  // the server-side assertion below, which tests the gate with the flag OFF.
  assert.strictEqual(
    canAskAboutDocument({ category: 'Medicalish', name: 'x.pdf', fileType: 'application/pdf' }),
    true,
    'exact category match, not substring — inventing new denials silently removes the button',
  );
}

// ── images: OFFERED, and told the truth inside ───────────────────────────────
//
// Regression guard for a real failure: the button used to be hidden for images,
// so a photographed lease — the single most likely document someone wants read —
// simply had no Ask button and no reason given. The first real user hunted for
// it and found nothing. v1 still cannot OCR, but the honest place to say so is
// inside the reader (which checks coverage before it posts, so an image costs no
// AI action), not a silently missing control.

{
  for (const t of ['image/jpeg', 'image/png', 'image/HEIC']) {
    assert.strictEqual(
      canAskAboutDocument({ category: 'Legal', name: 'lease photo', fileType: t }),
      true,
      `${t} is offered so the modal can explain there is no text to search`,
    );
  }
  assert.strictEqual(
    canAskAboutDocument({ category: 'Legal', name: 'lease', fileType: 'application/pdf' }),
    true,
    'a PDF of the same document is fine',
  );
  // The exclusions that DO still hide the button must not have been loosened
  // by the same change.
  assert.strictEqual(
    canAskAboutDocument({ category: 'Medical', name: 'lease photo', fileType: 'image/jpeg' }),
    MEDICAL_READER_ENABLED,
    'the file TYPE must not change the medical answer — an image of a lab result and a '
    + 'PDF of one are the same document and must follow the same flag',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: 'Legal', name: 'lease photo', fileType: 'image/jpeg', isBusinessSpace: true }),
    false,
    'an image is still denied in a business space',
  );
}

// ── the insurance back-door (the branch that matters) ───────────────────────

{
  // The name test is pure and flag-independent, so it can be asserted directly.
  for (const p of INSURANCE_NAME_PATTERNS) {
    assert.strictEqual(looksLikeInsuranceDocument(`My ${p.toUpperCase()} 2026.pdf`), true, `pattern "${p}" must match case-insensitively, mid-name`);
  }
  assert.strictEqual(looksLikeInsuranceDocument('Polizze_Haushalt_2026.pdf'), true, 'real-world Austrian filename');
  assert.strictEqual(looksLikeInsuranceDocument('Wiener Städtische Versicherungsschein.pdf'), true);
  assert.strictEqual(looksLikeInsuranceDocument('Deckungszusage.pdf'), true, '"deckung" is a substring rule on purpose');
  assert.strictEqual(looksLikeInsuranceDocument('Mietvertrag.pdf'), false, 'a lease is not an insurance policy');
  assert.strictEqual(looksLikeInsuranceDocument(''), false);
  assert.strictEqual(looksLikeInsuranceDocument(undefined), false);

  // THE BACK-DOOR ASSERTION. An insurance-looking document is askable if and
  // ONLY IF INSURANCE_READER_ENABLED is on. Written against the flag rather
  // than against `false` so it stays meaningful after the legal opinion lands
  // and the flag flips — and so that deleting the flag check from
  // canAskAboutDocument() fails this test today, while the flag is off.
  assert.strictEqual(
    canAskAboutDocument({ category: 'Financial', name: 'Polizze 2026.pdf', fileType: 'application/pdf' }),
    INSURANCE_READER_ENABLED,
    'insurance documents must be gated on INSURANCE_READER_ENABLED and nothing else',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: 'Other', name: 'home insurance policy schedule.pdf', fileType: 'application/pdf' }),
    INSURANCE_READER_ENABLED,
    'the English pattern list is gated identically',
  );

  // The other denials are independent of the INSURANCE flag — flipping it must
  // not open any of them. Medical has its own switch now, so this asserts the
  // two are separate rather than that medical is closed: a document that is
  // both insurance-named AND medical answers to the medical flag, not to
  // whether the insurance route happens to be open.
  assert.strictEqual(
    canAskAboutDocument({ category: 'Medical', name: 'Versicherung Befund.pdf', fileType: 'application/pdf' }),
    MEDICAL_READER_ENABLED,
    'the two scope flags are independent — insurance being open must not decide a '
    + 'medical document, and vice versa',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: 'Financial', name: 'Polizze.pdf', fileType: 'image/jpeg' }),
    INSURANCE_READER_ENABLED,
    'a photographed policy follows the insurance flag like any other policy — being an image is no longer a second, independent denial',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: 'Financial', name: 'Polizze.pdf', fileType: 'application/pdf', isBusinessSpace: true }),
    false,
    'business stays denied even when the insurance route is open',
  );
}

console.log('docReadEligibility.test.ts: all assertions passed');
