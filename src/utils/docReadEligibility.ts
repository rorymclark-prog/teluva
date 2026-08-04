// ---------------------------------------------------------------------------
// Client-side mirror of the document reader's deny-list.
//
// *** THE SERVER IS AUTHORITATIVE. ***
//
// This file decides ONE thing: whether to draw the "Ask" button. It is not a
// security boundary and must never be treated as one. /api/doc-read runs its
// own copy of these rules (docRead.mjs's isEligible) and refuses anything that
// fails them, whatever the client believed. This module exists purely so we
// don't offer a button that would come back 403 — a dead control the user taps
// and gets an error from is worse than no control.
//
// This is the same two-gate discipline as the insurance reader (a client const
// AND an independent server env var), and it exists for the same unglamorous
// reason: a client flag is compiled into a bundle that ships to the user's
// phone. Anyone who wants to can edit it, or skip the UI entirely and POST to
// the endpoint. So the client flag buys us a tidy UI and nothing else; the
// server flag is what actually keeps a Medical document, a business space, or
// (until an Austrian Rechtsanwalt signs it off) an insurance policy out of the
// reader. If these two ever disagree, the server wins and the user sees an
// error — annoying, but never unsafe.
//
// KEEP IN SYNC with server/docRead.mjs isEligible(). If you change a rule here,
// change it there in the same commit; the server copy is the one that matters.

import { INSURANCE_READER_ENABLED } from '../config/features';

/**
 * Document names that look like an insurance policy.
 *
 * DE and EN, because a Viennese household's policy is called "Polizze" and the
 * app is bilingual. Substrings, not whole words — real filenames look like
 * "Polizze_Haushalt_2026.pdf" and "Wiener Städtische Versicherungsschein.pdf".
 *
 * Why insurance is singled out at all: quoting the conditions of an insurance
 * contract edges toward regulated Versicherungsvermittlung (GewO §137) in a way
 * that quoting a lease does not. Until a licensed Austrian lawyer confirms the
 * recall/advice line for this product, insurance documents route to the
 * purpose-built insurance reader (also dark) rather than the general one.
 */
export const INSURANCE_NAME_PATTERNS = [
  'polizze',
  'versicherung',        // also catches versicherungsschein, Versicherungspolizze…
  'insurance',
  'policy schedule',
  'cover note',
  'deckung',
  'versicherungsschein',
];

/** Pure, flag-independent name test — exported so it can be tested on its own,
 *  since INSURANCE_READER_ENABLED is a compile-time const the tests cannot flip. */
export function looksLikeInsuranceDocument(name?: string): boolean {
  const n = (name || '').toLowerCase();
  if (!n) return false;
  return INSURANCE_NAME_PATTERNS.some((p) => n.includes(p));
}

/**
 * Should the "Ask about this document" button be shown?
 *
 * Fail-closed by construction: every rule below is a reason to return false,
 * and unknown/missing input falls through to the server, which will apply the
 * same rules with the real record in hand.
 */
export function canAskAboutDocument(input: {
  category?: string;
  name?: string;
  fileType?: string;
  isBusinessSpace?: boolean;
}): boolean {
  // Business spaces are out entirely. Not a privacy nicety: a business space's
  // documents are employment contracts and staff records that other members of
  // the space can already read, and a quoting tool over them is a different
  // product with different obligations. Until that has been thought through
  // properly, the reader is family-space only.
  if (input.isBusinessSpace) return false;

  // Medical documents never enter the reader. GDPR special-category data, and
  // the one place where "here is a verbatim sentence from your file, with no
  // interpretation" is at its least useful and most alarming.
  //
  // NOTE: this checks 'health' as well as 'medical' because the app has TWO
  // category vocabularies — VaultDocument.category uses 'Medical' and
  // FamilyDocument.category (member documents) uses 'Health' for the same
  // class of file. Denying both is a deliberate over-deny: if the server copy
  // only rejects 'Medical', the two disagree in the SAFE direction (button
  // hidden, no request made, no 403). Flagged for the server owner to align.
  const category = (input.category || '').trim().toLowerCase();
  if (category === 'medical' || category === 'health') return false;

  // NOT excluded here: images — and as of v186 they are fully readable.
  //
  // The button was kept visible even while the reader could not quote a photo,
  // because hiding it was worse than useless: a photographed lease is the single
  // most likely document a person wants read, and the first real user hunted for
  // a control that had been silently deleted from under them, learning nothing.
  // That decision is why switching OCR on needed no change here at all — the
  // entry point was already in the right place, and utils/docReader.ts simply
  // stopped giving up when there was no text layer.

  // The insurance back-door: the ONLY thing standing between an insurance
  // policy and the general reader is this flag. Flipping INSURANCE_READER_ENABLED
  // (once the legal opinion lands, and together with the server's own
  // FEATURE_INSURANCE_READER) turns insurance documents on here too — that is
  // the intended, single point of control. Do not add a second way in.
  if (!INSURANCE_READER_ENABLED && looksLikeInsuranceDocument(input.name)) return false;

  return true;
}
