// Standalone assertion tests for MemberIdOverview.tsx's scan-linking and
// empty-state logic (utils/idOverviewDocs.ts). No test runner is configured
// in this project, so run it directly:
//   npx tsx src/utils/idOverviewDocs.test.ts
// It exits non-zero on failure.
import assert from 'node:assert/strict';
import { buildIdOverview } from './idOverview';
import { resolveIdOverviewScans, idOverviewEmptiness } from './idOverviewDocs';

// One member carrying a scan for every kind of row this file resolves:
//  - eCardNumber, matched by its own specific pattern
//  - a COMBINED "ID and Driver's Licence" scan, matched by nationalIdNumber's
//    generic \bid\b fallback AND driversLicenseNumber's own pattern — the
//    "one document backs two rows" case itemLabelsByDocId exists for
//  - a passport, resolved by country-token match
//  - a visa, resolved by substring country match
//  - an admin-only "other" identifier (ssn) that LOOKS like it has a matching
//    scan by name, but must never be attached — no finder exists for it
//  - an unrelated document (a school report) that must never be attached to anything
const ben: any = {
  id: 'm-ben',
  name: 'Ben',
  identity: {
    eCardNumber: 'EC-12345',
    nationalIdNumber: '900101580',
    driversLicenseNumber: 'DL-99000',
  },
  passports: [{ id: 'p-za', country: 'South Africa', number: 'A01234567' }],
  travel: { visas: [{ id: 'v-pt', country: 'Portugal', number: 'PT-55512' }] },
  identifiers: { ssn: '078-05-1120' },
  documents: [
    { id: 'd-ecard', name: 'eCard front.jpg', category: 'ID', fileType: 'image/jpeg', fileName: 'ecard.jpg', fileSize: 100, uploadedAt: '2024-01-01', fileData: 'data:image/jpeg;base64,AAA' },
    { id: 'd-combo', name: "Ben's ID and Driver's Licence", category: 'ID', fileType: 'application/pdf', fileName: 'combo.pdf', fileSize: 200, uploadedAt: '2024-02-01', fileData: 'data:application/pdf;base64,AAA' },
    { id: 'd-passport', name: 'South Africa passport scan', category: 'ID', fileType: 'application/pdf', fileName: 'za.pdf', fileSize: 300, uploadedAt: '2024-03-01', fileData: 'data:application/pdf;base64,AAA' },
    { id: 'd-visa', name: 'Portugal visa sticker', category: 'Travel', fileType: 'image/jpeg', fileName: 'pt.jpg', fileSize: 150, uploadedAt: '2024-04-01', fileData: 'data:image/jpeg;base64,AAA' },
    { id: 'd-ssn-lookalike', name: 'ssn card', category: 'ID', fileType: 'image/jpeg', fileName: 'ssn.jpg', fileSize: 50, uploadedAt: '2024-05-01', fileData: 'data:image/jpeg;base64,AAA' },
    { id: 'd-unrelated', name: 'School report term 1', category: 'Education', fileType: 'application/pdf', fileName: 'report.pdf', fileSize: 400, uploadedAt: '2024-06-01', fileData: 'data:application/pdf;base64,AAA' },
  ],
};

// ── each finder actually gets used ──────────────────────────────────────────

{
  const groups = buildIdOverview(ben, true);
  const { scanByItemId, itemLabelsByDocId } = resolveIdOverviewScans(ben, groups);

  const identity = groups.find(g => g.kind === 'identity')!;
  const eCard = identity.items.find(i => i.value === 'EC-12345')!;
  assert.equal(scanByItemId.get(eCard.id)?.id, 'd-ecard', 'eCard number resolves its own scan');

  const nationalId = identity.items.find(i => i.value === '900101580')!;
  assert.equal(scanByItemId.get(nationalId.id)?.id, 'd-combo',
    'national ID falls back to the \\bid\\b-labelled combo scan, same as the IDs tab');

  const licence = identity.items.find(i => i.value === 'DL-99000')!;
  assert.equal(scanByItemId.get(licence.id)?.id, 'd-combo',
    "driver's licence matches the SAME combo scan by its own pattern");

  const passports = groups.find(g => g.kind === 'passport')!;
  const za = passports.items.find(i => i.value === 'A01234567')!;
  assert.equal(scanByItemId.get(za.id)?.id, 'd-passport', 'passport resolves by country-token match');

  const visas = groups.find(g => g.kind === 'visa')!;
  const pt = visas.items.find(i => i.value === 'PT-55512')!;
  assert.equal(scanByItemId.get(pt.id)?.id, 'd-visa', 'visa resolves by substring country match');

  // ── the reverse map ────────────────────────────────────────────────────
  assert.deepEqual(
    new Set(itemLabelsByDocId.get('d-combo')),
    new Set([nationalId.label, licence.label]),
    'one combined scan is attached to BOTH the rows it backs, not just the first one matched',
  );
  assert.equal(itemLabelsByDocId.get('d-ecard')?.length, 1);
  assert.equal(itemLabelsByDocId.get('d-passport')?.length, 1);
  assert.equal(itemLabelsByDocId.get('d-visa')?.length, 1);

  // ── CONTROLS: what must NOT be attached ─────────────────────────────────
  const other = groups.find(g => g.kind === 'other')!;
  const ssn = other.items.find(i => i.value === '078-05-1120')!;
  assert.equal(scanByItemId.has(ssn.id), false,
    'admin-only identifiers have no scan finder at all — "ssn card" existing must not fake an attachment');
  assert.equal(itemLabelsByDocId.has('d-ssn-lookalike'), false,
    'and the lookalike document itself must not be marked as attached to anything');

  assert.equal(itemLabelsByDocId.has('d-unrelated'), false,
    'CONTROL: an unrelated document (a school report) is not attached to any ID row — '
    + 'without this, "attached" could mean nothing and every test above would still pass',
  );
  assert.equal(
    [...scanByItemId.values()].some(d => d.id === 'd-unrelated'), false,
    'CONTROL (reverse direction): the unrelated document is never handed back as anyone\'s scan',
  );
}

// ── a legacy single passport (pre-multi-passport schema) still resolves its
//    scan, because foldPassports() is applied before matching — the same fold
//    the IDs tab itself does for display ──────────────────────────────────
{
  const legacyOnly: any = {
    id: 'm-legacy',
    name: 'Legacy',
    passport: {
      passportNumber: 'LEGACY123', fullName: 'Legacy Person', issuingCountry: 'Austria',
      dateOfBirth: '', issueDate: '', expiryDate: '',
    },
    documents: [
      { id: 'd-legacy-scan', name: 'Austria passport photo', category: 'ID', fileType: 'image/jpeg', fileName: 'at.jpg', fileSize: 90, uploadedAt: '2024-01-01', fileData: 'data:image/jpeg;base64,AAA' },
    ],
  };
  const groups = buildIdOverview(legacyOnly, true);
  const passports = groups.find(g => g.kind === 'passport')!;
  assert.equal(passports.items.length, 1, 'sanity: the legacy passport is listed at all (aiReveal.ts folds it too)');
  const { scanByItemId } = resolveIdOverviewScans(legacyOnly, groups);
  assert.equal(scanByItemId.get(passports.items[0].id)?.id, 'd-legacy-scan',
    'a pre-migration single `member.passport` still resolves its scan via foldPassports()');
}

// ── no documents at all: no crash, empty maps, not "everything matches" ────
{
  const bare: any = { id: 'm-bare', name: 'Bare', identity: { eCardNumber: 'X' } };
  const groups = buildIdOverview(bare, true);
  const { scanByItemId, itemLabelsByDocId } = resolveIdOverviewScans(bare, groups);
  assert.equal(scanByItemId.size, 0, 'no documents means nothing resolves — not a crash, not a false match');
  assert.equal(itemLabelsByDocId.size, 0);
}

// ── idOverviewEmptiness ──────────────────────────────────────────────────

{
  assert.equal(idOverviewEmptiness(0, 0), 'all', 'nothing at all → one full EmptyState');
  assert.equal(idOverviewEmptiness(0, 3), 'numbers', 'documents only → the numbers section is the empty one');
  assert.equal(idOverviewEmptiness(4, 0), 'documents', 'numbers only → the documents section is the empty one');
  assert.equal(idOverviewEmptiness(2, 2), 'none', 'both populated → neither section renders an empty state');
  // Boundary CONTROLS — one item on either side must not tip into 'all'.
  assert.equal(idOverviewEmptiness(1, 0), 'documents');
  assert.equal(idOverviewEmptiness(0, 1), 'numbers');
}

console.log('idOverviewDocs.test.ts: all assertions passed');
