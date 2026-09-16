/**
 * Letting the assistant hand back an ID number — without ever sending one to a
 * model.
 * ---------------------------------------------------------------------------
 *
 * aiRedact.ts strips every government/identity NUMBER out of the chat context
 * before it leaves the browser, and that stays exactly as it was: no number in
 * this file is ever added to a prompt, sent to /api/chat, or written to a log.
 * Read that file first — it is the contract this one is built around, not an
 * obstacle it works past.
 *
 * The problem it left behind is a real one. "What's Ben's passport number"
 * is the single most ordinary question a family vault can be asked, and the
 * honest answer the app gave — "it's saved, but I can't see it, open the ID &
 * Passports tab" — is a worse experience than the screen it points at, for a
 * value the asker is already looking at somewhere else in the same session.
 *
 * The way out is that the redaction happens CLIENT-SIDE. loadMembers() calls
 * revealMemberSensitive() (db.ts), so by the time this code runs the browser
 * is already holding these numbers decrypted — the server authorised that
 * decryption at load time via /api/vault/reveal-shared, which is where the
 * access decision belongs and where it still is. Nothing here re-decrypts
 * anything, asks the server for anything, or widens what this account can
 * read. It only stops the browser from pretending it doesn't know.
 *
 * So the model never sees a number. It sees a CATALOGUE — an id and a human
 * label per number on file — and when it decides the user asked for one it
 * names the id. The browser resolves that id against a map it built itself and
 * renders the value beside the reply. The model's only power is to point.
 *
 * Three properties follow from that, and each one is load-bearing:
 *
 *   1. An id the browser did not offer resolves to nothing. The map IS the
 *      allow-list; an invented or replayed id finds no entry and is dropped.
 *      Same shape as the document reader's `if (!c) continue;` (server.js),
 *      for the same reason: never trust the model to stay inside a set you can
 *      re-check yourself in one line.
 *
 *   2. A revealed value is never persisted. It lives on the message object in
 *      `reveals`, which slimForCloud strips before localStorage and which is
 *      absent from saveChatHistory's explicit field list (db.ts) — so it
 *      reaches neither the device cache nor Firestore, and reloading the panel
 *      shows the reply with the number gone. That mirrors patchRead()'s
 *      "deliberately never persisted" rule for document passages.
 *
 *   3. What is catalogued is narrower than what the browser holds, on purpose.
 *      See CATALOGUED / NOT CATALOGUED below.
 *
 * ── CATALOGUED ─────────────────────────────────────────────────────────────
 *   members[].identity.*        the ID numbers in REDACTED_IDENTITY_KEYS
 *   members[].passports[]       .number
 *   members[].travel.visas[]    .number
 *   members[].identifiers.*     ADMIN ONLY — SecureSecrets.tsx is gated on
 *                               isAdmin (Dashboard.tsx), while the reveal-shared
 *                               endpoint that decrypted them is adult-gated. A
 *                               member's browser can therefore hold values its
 *                               own UI would not show it; the assistant must
 *                               not become the back door that shows them.
 *
 * ── NOT CATALOGUED ─────────────────────────────────────────────────────────
 *   members[].financialAccounts  Account and routing numbers move money. They
 *                                are not identity documents, they are not what
 *                                anyone means by "my ID number", and the cost
 *                                of being wrong about one is unlike the rest of
 *                                this list. Deliberately out of scope.
 *   finances.banks[].iban/bic    Same reasoning.
 *   household door/alarm/wifi    Credentials, not identifiers. Knowing a door
 *                                code is being able to open the door.
 *   info.numbers[].value         The free-text bucket. aiRedact.ts strips these
 *                                unconditionally precisely BECAUSE you cannot
 *                                tell from a family's own label whether the
 *                                value is a loyalty card or a safe combination.
 *                                A catalogue built on those labels would be the
 *                                same guess, one layer up.
 *
 * The line is: things that IDENTIFY a person, which they are entitled to read
 * off their own screen. Not things that OPEN something.
 */

import type { FamilyMember } from '../types';
import { REDACTED_IDENTITY_KEYS } from './aiRedact';

/** What the model is shown: a handle and a label, never a value. */
export interface RevealHandle {
  id: string;
  label: string;
}

/** What the browser keeps to itself and renders if the model asks for it. */
export interface RevealedValue {
  id: string;
  /** The full "Ben's passport number (South Africa)" — what the MODEL picks by. */
  label: string;
  /** The same thing with the name taken off: "passport number (South Africa)".
   *
   * The model needs the name in the label to tell two people's passports
   * apart. The CARD does not — it groups by person, so repeating "Ben
   * Clark's" on every row inside Ben's own group was pure width, and on a
   * phone it pushed the actual field name out of the ellipsis: two rows both
   * reading "Ben Clark's national ID nu…" tell you nothing. */
  field: string;
  memberName: string;
  value: string;
}

export interface RevealIndex {
  /** memberId → the handles offered for that member, for slimMembers(). */
  handlesByMember: Map<string, RevealHandle[]>;
  /** handle id → the value, never serialised anywhere. */
  values: Map<string, RevealedValue>;
}

/**
 * A "reveal everything on file" answer is legitimate — the ID tab shows the
 * same list — but an unbounded loop over a large family is not something to
 * discover in production. Capped, and the cap is REPORTED rather than applied
 * silently: resolveReveals returns `truncated` so the UI can say so.
 */
export const MAX_REVEALS_PER_MESSAGE = 25;

/** Sozialversicherungsnummer → "SV number". Labels are what the model picks by. */
const IDENTITY_LABELS: Record<string, string> = {
  eCardNumber: 'e-card number',
  svNumber: 'SV number (Sozialversicherungsnummer)',
  taxNumber: 'tax number',
  studentNumber: 'student number',
  schoolRegNumber: 'school registration number',
  residencePermitNumber: 'residence permit number',
  nationalIdNumber: 'national ID number',
  birthCertNumber: 'birth certificate number',
  medicalAidNumber: 'medical aid membership number',
  insuranceGroupNumber: 'insurance group number',
  citizenshipCertNumber: 'citizenship certificate number',
  driversLicenseNumber: "driver's licence number",
};

const IDENTIFIER_LABELS: Record<string, string> = {
  ssn: 'social security number',
  nationalId: 'national ID',
  driversLicenseNo: "driver's licence number",
  taxId: 'tax ID',
  insuranceNo: 'insurance number',
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * A value that is still ciphertext never becomes a handle.
 *
 * revealSharedSecrets returns the ORIGINAL 'enc:…' string when the round trip
 * fails (network error, non-ok response) rather than throwing — see db.ts — so
 * a member object can legitimately reach this code carrying ciphertext. Naming
 * such a value in the catalogue would advertise a number the app cannot
 * actually produce, and revealing it would print `enc:2:…` at the user. It is
 * simply not on file as far as this catalogue is concerned.
 */
function isRevealable(v: unknown): v is string {
  return isNonEmptyString(v) && !v.startsWith('enc:');
}

/**
 * Build the catalogue and the private value map from the UNREDACTED members.
 *
 * Call with the same array that slimMembers() is about to redact — the point
 * is that both views are derived from one source, so a number can never appear
 * in the catalogue without the browser holding the value to match it.
 */
export function buildRevealIndex(
  members: FamilyMember[],
  opts: { isAdmin: boolean },
): RevealIndex {
  const handlesByMember = new Map<string, RevealHandle[]>();
  const values = new Map<string, RevealedValue>();

  for (const m of members || []) {
    const memberId = (m as any)?.id;
    if (!isNonEmptyString(memberId)) continue;
    const memberName = isNonEmptyString((m as any)?.name) ? (m as any).name : 'this person';
    const handles: RevealHandle[] = [];

    // `field` is the bare description; `label` is the same thing prefixed with
    // whose it is. One call site builds both so they cannot describe different
    // things — the model choosing by `label` and the card printing `field`
    // must always be pointing at the same number.
    const offer = (slot: string, field: string, value: string) => {
      const id = `${memberId}~${slot}`;
      const label = `${memberName}'s ${field}`;
      handles.push({ id, label });
      values.set(id, { id, label, field, memberName, value });
    };

    const identity = (m as any)?.identity;
    if (identity && typeof identity === 'object') {
      // Driven off REDACTED_IDENTITY_KEYS rather than a second hand-written
      // list: what aiRedact.ts removes is exactly what this can hand back, and
      // a key added there without a label here would silently stop being
      // offerable. The `?? key` fallback keeps it offerable, unprettily,
      // instead of dropping it.
      for (const key of REDACTED_IDENTITY_KEYS) {
        const v = identity[key];
        if (!isRevealable(v)) continue;
        offer(`identity.${key}`, IDENTITY_LABELS[key] ?? key, v);
      }
    }

    const passports = (m as any)?.passports;
    if (Array.isArray(passports)) {
      for (const p of passports) {
        if (!p || typeof p !== 'object' || !isRevealable(p.number)) continue;
        const where = isNonEmptyString(p.country) ? ` (${p.country})` : '';
        // Keyed on the passport's own id, not its array position: a second
        // passport filed between two turns would otherwise shift every index
        // and turn a handle the model just read into a different document.
        const slot = isNonEmptyString(p.id) ? `passport.${p.id}` : `passport.${p.number.slice(-4)}`;
        offer(slot, `passport number${where}`, p.number);
      }
    }

    /* THE LEGACY SINGULAR PASSPORT.
     *
     * Before passports became a list there was one `member.passport` object,
     * and records created then still carry it. MemberIDs.tsx folds it into the
     * list for DISPLAY (foldPassports), but that fold is never persisted until
     * the user happens to open and save that tab — so a passport that has sat
     * untouched since the old schema is a passport this index does not offer,
     * which means the assistant cannot hand it back AND the "all ID numbers"
     * screen (which is built on this same index) does not list it. The number
     * is right there in the record and every surface that exists to show it
     * says the person does not have one.
     *
     * Deduped by number against the modern list, matching foldPassports, so a
     * record that HAS been migrated does not show the same passport twice. */
    const legacy = (m as any)?.passport;
    if (legacy && typeof legacy === 'object' && isRevealable(legacy.passportNumber)) {
      const already = Array.isArray(passports)
        && passports.some((p: any) => p?.number === legacy.passportNumber);
      if (!already) {
        const where = isNonEmptyString(legacy.issuingCountry) ? ` (${legacy.issuingCountry})` : '';
        // Same slot prefix as the modern records — the overview screen parses
        // the group out of this prefix, and a passport is a passport whichever
        // schema version filed it.
        offer(`passport.legacy-${legacy.passportNumber.slice(-4)}`, `passport number${where}`, legacy.passportNumber);
      }
    }

    const visas = (m as any)?.travel?.visas;
    if (Array.isArray(visas)) {
      for (const v of visas) {
        if (!v || typeof v !== 'object' || !isRevealable(v.number)) continue;
        const where = isNonEmptyString(v.country) ? ` for ${v.country}` : '';
        const kind = isNonEmptyString(v.permitType) ? ` — ${v.permitType}` : '';
        const slot = isNonEmptyString(v.id) ? `visa.${v.id}` : `visa.${v.number.slice(-4)}`;
        offer(slot, `visa/permit number${where}${kind}`, v.number);
      }
    }

    // Admin only — see the CATALOGUED note in the file header.
    if (opts.isAdmin) {
      const identifiers = (m as any)?.identifiers;
      if (identifiers && typeof identifiers === 'object') {
        for (const [key, label] of Object.entries(IDENTIFIER_LABELS)) {
          const v = identifiers[key];
          if (!isRevealable(v)) continue;
          offer(`identifiers.${key}`, label, v);
        }
      }
    }

    if (handles.length) handlesByMember.set(memberId, handles);
  }

  return { handlesByMember, values };
}

/**
 * Group revealed values by whose they are, preserving the order the model
 * asked for them in — first mention of a person fixes that person's position,
 * and their other numbers gather under it.
 *
 * Grouped by NAME rather than member id because the name is what the card
 * prints and what a reader matches on. Two members who genuinely share a name
 * would merge into one heading, which is the right outcome for a card whose
 * heading is that name: splitting them into two identical headings would look
 * like a rendering bug, not a distinction.
 */
export function groupReveals(revealed: RevealedValue[]): { memberName: string; items: RevealedValue[] }[] {
  const order: string[] = [];
  const byName = new Map<string, RevealedValue[]>();
  for (const r of revealed) {
    if (!byName.has(r.memberName)) { byName.set(r.memberName, []); order.push(r.memberName); }
    byName.get(r.memberName)!.push(r);
  }
  return order.map(memberName => ({ memberName, items: byName.get(memberName)! }));
}

/**
 * Everything on the card as one block of text, for a single Copy.
 *
 * The per-row copy gives the bare number, which is what you want when you are
 * filling in a form field. That is the wrong unit when someone asked about two
 * people at once: they wanted a note they can paste into a message or a
 * booking form, and a number with no name attached to it is not one. So this
 * is a SECOND control rather than a replacement — the two copies answer
 * different questions and neither substitutes for the other.
 *
 * Shape is deliberately plain text, grouped and labelled:
 *
 *   Ben Clark
 *   National ID number: 1303155029087
 *
 *   Leo Clark
 *   National ID number: 0802115128086
 *
 * No header line, no "copied from Teluva", no timestamp: this lands in a
 * WhatsApp message or an email to a travel agent, and anything the sender did
 * not ask for is noise they then have to delete around the numbers.
 */
export function formatRevealsForCopy(revealed: RevealedValue[]): string {
  return groupReveals(revealed)
    .map(g => [
      g.memberName,
      ...g.items.map(i => `${i.field.charAt(0).toUpperCase()}${i.field.slice(1)}: ${i.value}`),
    ].join('\n'))
    .join('\n\n');
}

/**
 * Turn whatever the model put in "reveals" into values the UI can render.
 *
 * Everything unrecognised is dropped rather than repaired: a non-array, a
 * non-string entry, a duplicate, an id that was never offered. `truncated`
 * says the cap bit, so the caller can show that instead of quietly serving a
 * short list as if it were the whole one.
 */
export function resolveReveals(
  ids: unknown,
  index: RevealIndex,
): { revealed: RevealedValue[]; truncated: boolean } {
  if (!Array.isArray(ids) || ids.length === 0) return { revealed: [], truncated: false };
  const seen = new Set<string>();
  const revealed: RevealedValue[] = [];
  let truncated = false;
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    const hit = index.values.get(id);
    if (!hit) continue;               // never offered → does not exist
    seen.add(id);
    if (revealed.length >= MAX_REVEALS_PER_MESSAGE) { truncated = true; break; }
    revealed.push(hit);
  }
  return { revealed, truncated };
}
