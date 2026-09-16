// Standalone assertion tests for the assistant's ID-number reveal. No test
// runner is configured in this project, so run it directly — same convention
// as aiRedact.test.ts, whose contract this one is the other half of:
//   npx tsx src/utils/aiReveal.test.ts
// It exits non-zero on failure.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRevealIndex, resolveReveals, groupReveals, formatRevealsForCopy, MAX_REVEALS_PER_MESSAGE,
} from './aiReveal';
import { REDACTED_IDENTITY_KEYS } from './aiRedact';

const root = join(import.meta.dirname ?? __dirname, '..', '..');

// One member carrying every category this file has an opinion about.
const ben: any = {
  id: 'm-ben',
  name: 'Ben',
  identity: {
    svNumber: '1234 010190',
    nationalIdNumber: '9001015800086',
    residencePermitNumber: 'AT-RWR-88213',
    residencePermitExpiry: '2027-04-30',   // a DATE — never a reveal, always in context
    medicalAidScheme: 'Discovery Health',  // a NAME — same
    eCardNumber: '',                       // empty → not on file → not offered
    taxNumber: 'enc:2:aa:bb:cc',           // ciphertext → not offered
  },
  passports: [
    { id: 'p-za', country: 'South Africa', number: 'A01234567', expiryDate: '2029-01-01' },
    { id: 'p-at', country: 'Austria', number: 'U9876543', expiryDate: '2031-06-30' },
  ],
  travel: {
    visas: [{ id: 'v-pt', country: 'Portugal', number: 'PT-55512', permitType: 'D7' }],
  },
  identifiers: { ssn: '078-05-1120', taxId: 'TX-9', notes: 'from the old system' },
  financialAccounts: [{ id: 'fa1', bankName: 'Erste', accountNumber: '00110022', routingNumber: '20111' }],
};

const anon: any = { id: 'm-none', name: 'Nobody', identity: {}, passports: [] };

// ── the catalogue carries labels, never values ──────────────────────────────

const admin = buildRevealIndex([ben, anon], { isAdmin: true });
const handles = admin.handlesByMember.get('m-ben')!;
assert.ok(handles && handles.length, 'Ben has ID numbers on file and must get handles');

const catalogueJson = JSON.stringify([...admin.handlesByMember.values()]);
for (const secret of ['1234 010190', '9001015800086', 'AT-RWR-88213', 'A01234567', 'U9876543', 'PT-55512', '078-05-1120']) {
  assert.ok(!catalogueJson.includes(secret),
    `THE CATALOGUE IS WHAT LEAVES THE BROWSER. "${secret}" must never appear in it.`);
}
for (const h of handles) {
  assert.strictEqual(typeof h.id, 'string');
  assert.strictEqual(typeof h.label, 'string');
  assert.deepEqual(Object.keys(h).sort(), ['id', 'label'],
    'a handle carries an id and a label and nothing else — an extra key is how a value escapes');
}

// A member with nothing on file gets no entry at all, so the model is never
// shown an empty array and tempted to explain it.
assert.ok(!admin.handlesByMember.has('m-none'), 'a member with no ID numbers is absent, not empty');

// ── what is offered, and what is deliberately not ───────────────────────────

const labelFor = (id: string) => handles.find(h => h.id === id)?.label;
const has = (slot: string) => handles.some(h => h.id === `m-ben~${slot}`);

assert.ok(has('identity.svNumber'), 'the SV number is on file and must be offerable');
assert.ok(has('identity.nationalIdNumber'), 'the national ID is on file and must be offerable');
assert.ok(has('passport.p-za') && has('passport.p-at'), 'both passports are offerable');
assert.ok(has('visa.v-pt'), 'the visa/permit number is offerable');

assert.ok(!has('identity.eCardNumber'), 'an EMPTY value is not "on file" and must not be advertised');
assert.ok(!has('identity.taxNumber'),
  'a value that is still ciphertext must not be offered — revealSharedSecrets returns the '
  + 'original enc: string when its round trip fails, and revealing that prints enc:2:… at the user');
assert.ok(!has('identity.residencePermitExpiry'),
  'expiry DATES are not redacted from context in the first place — offering one as a reveal '
  + 'would be a second, worse route to a value the model can already read');
assert.ok(!has('identity.medicalAidScheme'), 'a scheme NAME is not a credential and stays in context');

// The money side is out of scope on purpose — see the file header.
assert.ok(!handles.some(h => h.id.includes('financial')),
  'financialAccounts move money; they are not identity documents and are never catalogued');
assert.ok(!catalogueJson.includes('00110022') && !catalogueJson.includes('20111'),
  'no account or routing number reaches the catalogue by any path');

// ── identifiers are ADMIN ONLY ──────────────────────────────────────────────

const member = buildRevealIndex([ben], { isAdmin: false });
const memberHandles = member.handlesByMember.get('m-ben')!;
assert.ok(memberHandles.some(h => h.id === 'm-ben~passport.p-za'),
  'a non-admin adult still gets passports — that screen is not admin-gated');
assert.ok(!memberHandles.some(h => h.id.startsWith('m-ben~identifiers.')),
  'SecureSecrets.tsx is gated on isAdmin while reveal-shared is only adult-gated, so a '
  + "member's browser can hold identifiers its own UI would not show. The assistant must "
  + 'not become the back door that shows them.');
assert.ok(!member.values.has('m-ben~identifiers.ssn'),
  'and the VALUE map must not hold it either — an omitted label with a live value is the '
  + 'exact bug this gate exists to prevent');
assert.ok(admin.values.has('m-ben~identifiers.ssn'), 'an admin does get it (control)');

// ── every redacted identity key stays reachable ─────────────────────────────
//
// The catalogue is driven off REDACTED_IDENTITY_KEYS, so a key added to the
// redaction list is automatically offerable. This asserts that wiring rather
// than trusting it: if the two lists ever drift, a number would be stripped
// from context AND absent from the catalogue — unreachable by any route, with
// the assistant back to "it's saved but I can't see it" for that one field.
const allFields: any = { id: 'm-all', name: 'All', identity: {} };
for (const k of REDACTED_IDENTITY_KEYS) allFields.identity[k] = `val-${k}`;
const allIdx = buildRevealIndex([allFields], { isAdmin: true });
const allHandles = allIdx.handlesByMember.get('m-all') || [];
for (const k of REDACTED_IDENTITY_KEYS) {
  const h = allHandles.find(x => x.id === `m-all~identity.${k}`);
  assert.ok(h, `${k} is redacted from AI context but has no reveal handle — it is unreachable`);
  assert.ok(!/^All's [a-z]*[A-Z]/.test(h!.label) || h!.label.length > 0,
    `${k} needs a human label in IDENTITY_LABELS`);
  assert.strictEqual(allIdx.values.get(h!.id)!.value, `val-${k}`, `${k} resolves to its value`);
}
assert.strictEqual(allHandles.length, REDACTED_IDENTITY_KEYS.length,
  'exactly one handle per redacted identity key — no more, no fewer');

// ── resolveReveals: the map IS the allow-list ───────────────────────────────

const svId = 'm-ben~identity.svNumber';
const one = resolveReveals([svId], admin);
assert.strictEqual(one.revealed.length, 1);
assert.strictEqual(one.revealed[0].value, '1234 010190', 'an offered handle resolves to the real value');
assert.strictEqual(one.revealed[0].memberName, 'Ben', 'and names whose number it is');
assert.strictEqual(one.truncated, false);

for (const bogus of [
  ['m-ben~identity.doorCode'],                      // never offered
  ['m-ben~financial.fa1.accountNumber'],            // deliberately not catalogued
  ['m-ben~identity.svnumber'],                      // wrong case
  [' '], [''], [null], [42], [{ id: svId }],          // junk
  ['m-nobody~identity.svNumber'],                     // real slot, wrong member
]) {
  assert.deepEqual(resolveReveals(bogus as any, admin).revealed, [],
    `a handle the browser did not offer must resolve to nothing: ${JSON.stringify(bogus)}`);
}
assert.deepEqual(resolveReveals('not an array' as any, admin).revealed, []);
assert.deepEqual(resolveReveals(null, admin).revealed, []);
assert.deepEqual(resolveReveals([], admin).revealed, []);

// A member's own resolver refuses what a member's own catalogue withheld —
// so a handle replayed from an admin's earlier turn is inert on this account.
assert.deepEqual(resolveReveals(['m-ben~identifiers.ssn'], member).revealed, [],
  'a non-admin cannot resolve an admin-only handle even by naming it exactly');

// Duplicates collapse; a valid handle beside junk still resolves.
assert.strictEqual(resolveReveals([svId, svId, 'bogus'], admin).revealed.length, 1);

// ── the cap is reported, never silent ───────────────────────────────────────

const many: any[] = [];
for (let i = 0; i < MAX_REVEALS_PER_MESSAGE + 5; i++) {
  many.push({ id: `m${i}`, name: `P${i}`, identity: { svNumber: `sv-${i}` } });
}
const bigIdx = buildRevealIndex(many, { isAdmin: true });
const allIds = [...bigIdx.values.keys()];
assert.strictEqual(allIds.length, MAX_REVEALS_PER_MESSAGE + 5);
const capped = resolveReveals(allIds, bigIdx);
assert.strictEqual(capped.revealed.length, MAX_REVEALS_PER_MESSAGE);
assert.strictEqual(capped.truncated, true,
  'a cut list must SAY it was cut — a short answer that looks complete is worse than none');
assert.strictEqual(resolveReveals(allIds.slice(0, MAX_REVEALS_PER_MESSAGE), bigIdx).truncated, false,
  'exactly at the cap is not truncated (control)');

// ── passport handles survive a reordering ───────────────────────────────────
//
// Keyed on each passport's own id, not its array position: a second passport
// filed between two turns would otherwise shift every index and turn a handle
// the model just read into a DIFFERENT document. Silently returning the wrong
// person's-passport number is the worst failure this feature has available.
const reordered = { ...ben, passports: [ben.passports[1], ben.passports[0]] };
const afterIdx = buildRevealIndex([reordered], { isAdmin: true });
assert.strictEqual(afterIdx.values.get('m-ben~passport.p-za')!.value, 'A01234567',
  'the ZA passport handle still resolves to the ZA number after the array is reordered');
assert.strictEqual(afterIdx.values.get('m-ben~passport.p-at')!.value, 'U9876543');

// ── malformed input never throws ────────────────────────────────────────────

assert.doesNotThrow(() => buildRevealIndex([] as any, { isAdmin: true }));
assert.doesNotThrow(() => buildRevealIndex(null as any, { isAdmin: true }));
assert.doesNotThrow(() => buildRevealIndex(
  [null, undefined, {}, { id: 5 }, { id: 'x', passports: 'nope', identity: 7, travel: { visas: {} } }] as any,
  { isAdmin: true },
));

// ── label vs field ──────────────────────────────────────────────────────────
//
// The MODEL picks by `label`, which must name whose number it is or two
// people's passports are indistinguishable to it. The CARD prints `field`,
// which must NOT, because the card already groups under the person's name.

const pz = admin.values.get('m-ben~passport.p-za')!;
assert.strictEqual(pz.field, 'passport number (South Africa)',
  'the card label carries no name — it sits under a heading that already has one');
assert.strictEqual(pz.label, "Ben's passport number (South Africa)",
  'the model label DOES carry the name — it has no heading to sit under');
assert.ok(pz.label.endsWith(pz.field),
  'label is field with the owner prefixed — built at one call site so they cannot '
  + 'end up describing different numbers');
for (const v of admin.values.values()) {
  assert.ok(!v.field.includes(v.memberName),
    `"${v.field}" repeats the member name — that is what pushed the field name out of the `
    + 'ellipsis on a phone, leaving two rows both reading "Ben Clark\'s national ID nu…"');
}

// ── grouping, and the single Copy that gathers names WITH numbers ───────────

const twoPeople = buildRevealIndex([
  { id: 'm-k', name: 'Ben Clark', identity: { nationalIdNumber: '1303155029087' },
    passports: [{ id: 'pk', country: 'South Africa', number: 'A01234567' }] },
  { id: 'm-n', name: 'Leo Clark', identity: { nationalIdNumber: '0802115128086' } },
] as any, { isAdmin: false });

const bothIds = [
  'm-k~identity.nationalIdNumber',
  'm-n~identity.nationalIdNumber',
  'm-k~passport.pk',
];
const both = resolveReveals(bothIds, twoPeople).revealed;
assert.strictEqual(both.length, 3);

const grouped = groupReveals(both);
assert.strictEqual(grouped.length, 2, 'one group per person, not one per number');
assert.strictEqual(grouped[0].memberName, 'Ben Clark',
  'first mention fixes the order — the answer should read in the order it was asked');
assert.strictEqual(grouped[0].items.length, 2, "Ben's two numbers gather under one heading");
assert.strictEqual(grouped[1].memberName, 'Leo Clark');
assert.deepEqual(groupReveals([]), []);

// THE ACTUAL ASK: one copy, names AND numbers, for everyone on the card.
const copied = formatRevealsForCopy(both);
assert.strictEqual(copied,
  'Ben Clark\n'
  + 'National ID number: 1303155029087\n'
  + 'Passport number (South Africa): A01234567\n'
  + '\n'
  + 'Leo Clark\n'
  + 'National ID number: 0802115128086');
for (const needed of ['Ben Clark', 'Leo Clark', '1303155029087', '0802115128086']) {
  assert.ok(copied.includes(needed), `Copy all must carry "${needed}" — a number with no name `
    + 'attached is not what someone asking about two people wanted to paste');
}
// Nothing the sender did not ask for: no header, no timestamp, no app name.
assert.ok(!/teluva/i.test(copied) && !/\b20\d\d-\d\d-\d\d\b/.test(copied),
  'the block goes straight into a message — anything extra is something to delete around');
assert.strictEqual(formatRevealsForCopy([]), '');

// A single value still formats sanely (the card hides the control, but the
// function must not depend on that to be correct).
assert.strictEqual(formatRevealsForCopy([both[1]]),
  'Leo Clark\nNational ID number: 0802115128086');

// ── THE PERSISTENCE GUARD ───────────────────────────────────────────────────
//
// Everything above is worth nothing if a revealed number lands on disk.
// slimForCloud feeds BOTH storage paths — Firestore via saveChatHistory and
// this device's localStorage — and it spreads `...m`, so any field not named
// in its destructure survives into the cache verbatim. db.ts's saveChatHistory
// happens to re-pick an explicit field list and would drop them anyway, but
// localStorage.setItem takes slimForCloud's output as-is.
//
// slimForCloud lives inside the component and isn't exported, so this reads
// the source. Source-matching guards die quietly when the code reflows or a
// comment lands in the middle of the pattern, so: comments are stripped first,
// whitespace is collapsed, and the CONTROL below proves the check can still
// fail — without it, a regex that silently stopped matching anything would
// read as a pass.
const chatSrc = readFileSync(join(root, 'src/components/AIChatbot.tsx'), 'utf8');
const decomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const destructureOf = (src: string): string | null => {
  // Decomment FIRST and stay inside that string — mixing an index taken from
  // the stripped text with a slice of the original reads the wrong region the
  // moment a comment sits above the function, which is how this guard failed
  // on its own first run.
  const clean = decomment(src);
  const at = clean.indexOf('const slimForCloud');
  if (at < 0) return null;
  const open = clean.indexOf('({', at);
  const close = clean.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return clean.slice(open, close).replace(/\s+/g, ' ');
};

const params = destructureOf(chatSrc);
assert.ok(params, 'slimForCloud not found — this guard has stopped guarding anything');
for (const field of ['reveals', 'revealsTruncated']) {
  assert.ok(new RegExp(String.raw`\b${field}\b`).test(params!),
    `slimForCloud must destructure \`${field}\` off the message so it never reaches `
    + 'localStorage. It spreads ...m — a field it does not name is a field it SAVES, and '
    + 'this one is a passport number in plaintext in a cache that nothing expires.');
}

// The control. If this passed, the check above would pass on any file.
const withoutIt = 'const slimForCloud = (msgs: ChatMessage[]) =>\n  msgs.map(({ images, ...m }) => {';
assert.ok(!/\breveals\b/.test(destructureOf(withoutIt)!),
  'CONTROL FAILED: the guard matches a slimForCloud that does NOT strip reveals, so it '
  + 'cannot detect the regression it exists to detect');

// And the field must not be in the message shape db.ts persists.
const dbSrc = decomment(readFileSync(join(root, 'src/utils/db.ts'), 'utf8'));
const saveFn = dbSrc.slice(dbSrc.indexOf('export async function saveChatHistory'));
assert.ok(!/\breveals\b/.test(saveFn.slice(0, 1200)),
  'saveChatHistory must not pick up `reveals` — its explicit field list is the second of '
  + 'the two guarantees that a revealed ID number never reaches Firestore');

// ── the labelled copy must be reachable for a SINGLE value ─────────────────
//
// v342 drew the labelled "copy the whole card" button only when there was more
// than one value, on the reasoning that one value made it redundant. It did
// not: the per-row button copies the bare number, so a card showing one ID
// number offered no way whatsoever to copy the person's name with it — which
// is precisely what the first user to hit that case asked for.
//
// The two controls differ by CONTENT (bare value vs. name + label + value),
// not by quantity, so neither may be gated on how many values there are.

{
  const clean = decomment(chatSrc);
  assert.ok(clean.includes('formatRevealsForCopy(m.reveals!)'),
    'the labelled copy control is gone — this guard has stopped guarding anything');

  assert.ok(!/m\.reveals\.length\s*>\s*1\s*&&/.test(clean),
    'the labelled copy button must not be CONDITIONALLY RENDERED on the value count. '
    + 'With one value the row button copies only digits, so gating this one leaves no '
    + 'way at all to copy the name — the exact regression v343 fixed.');

  // Choosing the WORD by count is fine and expected: "Copy all" is wrong for a
  // list of one. This assertion is what stops the guard above from being read
  // as "the count may never be mentioned".
  assert.ok(/m\.reveals\.length\s*>\s*1\s*\?/.test(clean),
    'the button should still pick its label by count — "Copy all" reads wrong on a '
    + 'single value, and "Copy with name" reads thin on four');

  // THE CONTROL. Without it the negative assertion above would pass against a
  // file that had never contained the gate at all.
  const gated = 'x {m.reveals.length > 1 && (<button onClick={() => formatRevealsForCopy(m.reveals!)} />)}';
  assert.ok(/m\.reveals\.length\s*>\s*1\s*&&/.test(decomment(gated)),
    'CONTROL FAILED: the pattern does not match a genuinely gated button, so it cannot '
    + 'detect the regression it exists to detect');
}

// Every locale must carry the new word, or a non-English user gets `undefined`
// printed on the button.
{
  const localesSrc = readFileSync(join(root, 'src/i18n/locales.ts'), 'utf8');
  const named = (localesSrc.match(/^\s*ai_reveal_copy_named:\s*'/gm) || []).length;
  const all = (localesSrc.match(/^\s*ai_reveal_copy_all:\s*'/gm) || []).length;
  assert.ok(all > 0, 'ai_reveal_copy_all has no locale entries — anchor drifted');
  assert.equal(named, all,
    `ai_reveal_copy_named is in ${named} locales but ai_reveal_copy_all is in ${all}. `
    + 'A missing key renders as `undefined` on the button rather than failing loudly.');
}

// ── the legacy singular passport ────────────────────────────────────────────
//
// Records predating the passports[] list carry a single `member.passport`.
// MemberIDs.tsx folds it in for display but never persists that fold, so until
// this was fixed the number sat in the record while both the assistant's
// reveal card and the "all ID numbers" screen — which is built on this index —
// reported the person as having no passport at all.

{
  const legacyOnly: any = {
    id: 'lg1', firstName: 'Ada', lastName: 'Byron',
    passport: { passportNumber: 'P9911223', issuingCountry: 'GB' },
  };
  const idx = buildRevealIndex([legacyOnly], { isAdmin: true });
  const hs = idx.handlesByMember.get('lg1') ?? [];
  // Handle ids are namespaced `<memberId>~<slot>` so two people's passports
  // cannot collide — match on the slot half, not the whole id.
  const slotOf = (id: string) => id.slice(id.indexOf('~') + 1);
  const hit = hs.find((h) => slotOf(h.id).startsWith('passport.'));
  assert.ok(hit, 'a passport held only in the legacy singular field is still offerable');
  assert.ok(hit!.label.includes('GB'), 'the issuing country comes across from the legacy field name');
  assert.strictEqual(
    resolveReveals([hit!.id], idx).revealed[0]?.value, 'P9911223',
    'and it resolves to the real number, not to a handle that leads nowhere',
  );

  // NO DOUBLE-COUNTING. A record that has been migrated holds the same number
  // in both places, and offering it twice would show the reader two identical
  // passports and make "copy all" repeat it.
  const both: any = {
    id: 'lg2', firstName: 'Ada', lastName: 'Byron',
    passport: { passportNumber: 'P9911223', issuingCountry: 'GB' },
    passports: [{ id: 'p1', number: 'P9911223', country: 'GB' }],
  };
  const dupHandles = buildRevealIndex([both], { isAdmin: true }).handlesByMember.get('lg2') ?? [];
  assert.strictEqual(
    dupHandles.filter((h) => h.id.slice(h.id.indexOf('~') + 1).startsWith('passport.')).length, 1,
    'a migrated record offers the passport once, not once per schema version',
  );

  // THE CONTROL. Both assertions above pass trivially if the legacy branch
  // ignored isRevealable and offered whatever it found — this proves the same
  // emptiness and ciphertext rules apply to it as to every other handle.
  const empty: any = { id: 'lg3', firstName: 'Ada', passport: { passportNumber: '   ', issuingCountry: 'GB' } };
  assert.ok(
    !buildRevealIndex([empty], { isAdmin: true }).handlesByMember.has('lg3'),
    'a blank legacy passport number is not a passport',
  );
}

console.log('aiReveal.test.ts — all assertions passed');
