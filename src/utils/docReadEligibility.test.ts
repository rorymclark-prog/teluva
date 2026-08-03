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
import { INSURANCE_READER_ENABLED } from '../config/features';

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

{
  assert.strictEqual(
    canAskAboutDocument({ category: 'Medical', name: 'Befund.pdf', fileType: 'application/pdf' }),
    false,
    'VaultDocument category Medical is denied',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: 'Health', name: 'Impfpass.pdf', fileType: 'application/pdf' }),
    false,
    'FamilyDocument category Health is the same class of file under a different vocabulary',
  );
  assert.strictEqual(
    canAskAboutDocument({ category: '  medical  ', name: 'x.pdf', fileType: 'application/pdf' }),
    false,
    'category matching must survive casing and stray whitespace from old records',
  );
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
    false,
    'an image is still denied when the category is Medical',
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

  // The other denials are independent of the flag — flipping insurance on must
  // not open any of them. These hold whichever way the flag points.
  assert.strictEqual(
    canAskAboutDocument({ category: 'Medical', name: 'Versicherung Befund.pdf', fileType: 'application/pdf' }),
    false,
    'Medical stays denied even when the insurance route is open',
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
