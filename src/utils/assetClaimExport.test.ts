import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { AssetItem, InsurancePolicy, SlipItem, VaultDocument } from '../types';
import { FILE_BUCKET, fileContentUrl } from './fileReferences';
import {
  assetClaimCsv, assetClaimHtml, assetClaimSummary, assetCurrency, buildAssetClaimArchive,
  claimCsvCell, claimCurrencyTotals, claimText, isIncidentAsset, safeClaimFileName, scopedClaimAssets,
  type AssetClaimReferences,
} from './assetClaimExport';

const item = (id: string, patch: Partial<AssetItem> = {}): AssetItem => ({ id, name: `Asset ${id}`, category: 'Electronics', createdAt: '2026-10-31', ...patch });
const fixtures = [
  item('eur', { currency: 'EUR', purchasePrice: '1.200,50', replacementValue: '1.500,25', status: 'stolen' }),
  item('usd', { currency: 'usd', purchasePrice: '2,400.75', status: 'damaged' }),
  item('legacy', { purchasePrice: '25,20' }),
  item('unknown', { currency: 'EUR', purchasePrice: 'not recorded' }),
  item('zero', { currency: 'GBP', purchasePrice: '0' }),
  item('recovered', { currency: 'GBP', purchasePrice: '40', status: 'owned', incident: { type: 'stolen', date: '2025-01-01' } }),
  item('invalid-currency', { currency: '???', purchasePrice: '50' }),
];
assert.equal(assetCurrency(fixtures[2]), 'EUR', 'legacy missing currencies retain their documented EUR default');
assert.equal(assetCurrency(fixtures[6]), 'Unspecified', 'an invalid currency cannot silently join a EUR total');
assert.deepEqual(claimCurrencyTotals(fixtures), [
  { currency: 'EUR', items: 3, recordedValue: 1525.45, unpriced: 1 },
  { currency: 'GBP', items: 2, recordedValue: 40, unpriced: 0 },
  { currency: 'Unspecified', items: 1, recordedValue: 50, unpriced: 0 },
  { currency: 'USD', items: 1, recordedValue: 2400.75, unpriced: 0 },
]);
assert.deepEqual(scopedClaimAssets(fixtures, 'incident').map(asset => asset.id), ['eur', 'usd'], 'damaged joins stolen/lost, recovered assets stay off incident packs');
assert.equal(isIncidentAsset(item('lost', { status: 'lost' })), true);
assert.equal(isIncidentAsset(item('sold', { status: 'sold', incident: { type: 'damaged' } })), false);
assert.equal(scopedClaimAssets(fixtures, 'all').length, fixtures.length);
assert.deepEqual(claimCurrencyTotals([item('negative', { purchasePrice: '-10' })])[0].unpriced, 1, 'a negative free-text amount is not turned into a positive claim value');

for (const text of ['=HYPERLINK("https://evil.test")', '+SUM(1,2)', '-10', '@SUM(A1)', '\t=1+1', ' \r=2+2']) {
  assert.ok(claimCsvCell(text).startsWith('"\''), `spreadsheet formula is neutralized: ${JSON.stringify(text)}`);
}
assert.equal(claimCsvCell('A "quoted", value\nnext line'), '"A ""quoted"", value\nnext line"');
assert.equal(claimCsvCell('100.00'), '"100.00"');
assert.equal(safeClaimFileName('../../Manifest.json'), '_.._Manifest.json');
assert.equal(safeClaimFileName('CON.txt'), '_CON.txt');
assert.equal(safeClaimFileName('..'), 'file');
assert.ok(safeClaimFileName('a'.repeat(200) + '.pdf').endsWith('.pdf'));
assert.ok(safeClaimFileName('a'.repeat(200) + '.pdf').length <= 120);
assert.ok(new TextEncoder().encode(safeClaimFileName('📷'.repeat(100) + '.pdf')).length <= 120, 'multibyte names remain extractable on filesystems with byte limits');

const path = 'families/business/documents/cert/original.docx';
const legacySource = `https://firebasestorage.googleapis.com/v0/b/${FILE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=PRIVATE-TOKEN`;
const sourcePhoto = fileContentUrl('families/business/asset-photos/item.jpg');
const sourceSlip = fileContentUrl('families/business/slips/receipt.jpg');
const document: VaultDocument = { id: 'cert', name: 'Purchase certificate', category: 'Other', fileName: '../../Manifest.json', fileType: 'application/pdf', fileSize: 10, storagePath: path, downloadUrl: legacySource, uploadedAt: '2026-01-01' };
const duplicateName: VaultDocument = { ...document, id: 'second', fileName: '../../Manifest.json', downloadUrl: fileContentUrl('families/business/documents/second/original.pdf') };
const unreadable: VaultDocument = { ...document, id: 'denied', fileName: 'Claim.pdf', downloadUrl: fileContentUrl('families/business/documents/denied/claim.pdf') };
const serviceDocument: VaultDocument = { ...document, id: 'service-invoice', name: 'Repair invoice', fileName: 'Service-invoice.pdf', downloadUrl: fileContentUrl('families/business/documents/service/invoice.pdf') };
const receipt: SlipItem = { id: 'receipt', item: 'Laptop', shop: 'Computer shop', amount: '1.200,50', currency: 'EUR', purchaseDate: '2026-01-02', photoUrl: sourceSlip, createdAt: '2026-01-02' };
const policy: InsurancePolicy = { id: 'policy', provider: 'Example insurer', type: 'Equipment', policyNumber: 'POL-1', status: 'active', claimsNotes: `Upload at ${fileContentUrl(path)}`, sumInsured: '3000', currency: 'EUR' };
const legacyPolicy: InsurancePolicy = { id: 'legacy-policy', provider: 'Legacy insurer', coveredAssetIds: ['asset/../1'] };
const references: AssetClaimReferences = { documents: [document, duplicateName, unreadable, serviceDocument], slips: [receipt],
  policies: [policy, legacyPolicy, { id: 'unrelated', provider: 'Other insurance', coveredAssetIds: ['other-asset'] }],
  household: { homeServiceLog: [
    { id: 'repair', assetId: 'asset/../1', date: '2026-06-01', work: 'Replaced screen', by: 'Repair shop', cost: '100 EUR', notes: 'Original invoice retained', warrantyUntil: '2027-06-01', docIds: ['service-invoice', 'cert'] },
    { id: 'unrelated-work', assetId: 'other-asset', date: '2026-07-01', work: 'Private unrelated repair' },
  ] },
};
const rich = item('asset/../1', {
  name: '=Laptop <script>alert("x")</script>', ownerName: 'Company', assignedMember: 'Employee', location: 'Office',
  currency: 'USD', purchasePrice: '1000', replacementValue: '1400', purchaseLocation: 'Seller, Inc.', purchaseReference: 'INV-1',
  deliveryDate: '2026-01-03', purchaseCountry: 'AT', purchaseContext: 'business', retailerContact: 'https://seller.example/contact',
  returnByDate: '2026-01-16', warrantyUntil: '2028-01-02', replacementValueCheckedAt: '2026-10-01', replacementValueSource: 'Retail quote',
  notes: `First line\n=HYPERLINK("x")\n${legacySource}\nhttps://storage.googleapis.com/private/file?X-Goog-Signature=PRIVATE-SIGNATURE\n${sourcePhoto}`,
  status: 'damaged', incident: { type: 'damaged', date: '2026-10-28', policeReference: 'REF-1', notes: '<img src=x onerror=alert(1)>' },
  warranties: [{ id: 'warranty', kind: 'extended', provider: 'Seller', startDate: '2026-01-02', endDate: '2029-01-02', reference: 'W-1', contact: '+43 123', terms: '<b>Accidental damage</b>', documentIds: ['cert'], reminderDays: [60, 7] }],
  documentIds: ['cert', 'second'], slipIds: ['receipt'], insurancePolicyIds: ['policy'], insuranceNotes: 'Confirm excess with insurer.',
  photoDataUrl: sourcePhoto, photos: [sourcePhoto], receiptDataUrl: sourceSlip,
});
const before = JSON.stringify(rich);
const summary = assetClaimSummary({ items: [rich], scope: 'incident', references, isBusinessSpace: true, generatedAt: '2026-10-31T12:00:00Z' });
assert.equal(summary.assets.length, 1);
assert.equal(summary.assets[0].evidence.filter(file => file.kind === 'document').length, 3, 'direct, warranty and repair links include each original once');
assert.equal(summary.assets[0].warranties[0].End, '2029-01-02');
assert.equal(summary.assets[0].details.Seller, 'Seller, Inc.');
assert.equal(summary.assets[0].details['Delivery date'], '2026-01-03');
assert.equal(summary.assets[0].policies[0]['Policy number'], 'POL-1');
assert.equal(summary.assets[0].policies.length, 2, 'legacy coveredAssetIds and new asset policy links are both included');
assert.equal(summary.assets[0].serviceHistory[0].Work, 'Replaced screen');
assert.equal(summary.assets[0].serviceHistory[0]['Work warranty until'], '2027-06-01');
assert.equal(summary.assets[0].serviceHistory.length, 1, 'unrelated service records never enter a selected asset pack');
assert.ok(summary.coverageNote.includes('not confirmed'));
const csv = assetClaimCsv(summary);
for (const field of ['Currency', 'Seller', 'Notes', 'Warranties', 'Evidence', 'Purchase reference', 'Return by', 'Service and repair history']) assert.ok(csv.includes(`"${field}"`), `${field} is present in CSV`);
assert.ok(csv.includes('"\'=Laptop'), 'the item name is a spreadsheet-safe text cell');
const html = assetClaimHtml(summary);
assert.ok(html.includes('Business asset evidence pack'));
assert.ok(html.includes('&lt;script&gt;'));
assert.equal(html.includes('<script>'), false);
assert.equal(html.includes('<img src='), false);
assert.equal(html.includes('href="javascript:'), false);
assert.ok(html.includes('coverage, claim eligibility and payout are not confirmed'));
for (const text of [JSON.stringify(summary), csv, html]) {
  for (const forbidden of ['PRIVATE-TOKEN', 'PRIVATE-SIGNATURE', '/api/files/content?', 'data:image', 'downloadUrl', 'storagePath']) assert.equal(text.includes(forbidden), false, `export omits private file references: ${forbidden}`);
}
assert.ok(JSON.stringify(summary).includes('https://seller.example/contact'), 'ordinary retailer contact links remain useful');
assert.equal(claimText('https://example.test/file?authkey=PRIVATE'), '[file reference omitted]');
assert.equal(JSON.stringify(rich), before, 'summary projection never mutates a live asset');

const seen: string[] = [];
const bytes = new Map<string, string>();
const pack = await buildAssetClaimArchive({ items: [rich], scope: 'all', references, isBusinessSpace: true, generatedAt: '2026-10-31T12:00:00Z',
  fetchBlob: async source => {
    seen.push(source);
    const content = `ORIGINAL:${source.includes('/api/') ? seen.length : 'external'}`;
    bytes.set(source, content);
    return new Blob([content], { type: source === sourcePhoto || source === sourceSlip ? 'image/jpeg' : 'application/pdf' });
  },
});
assert.equal(pack.partial, false);
assert.equal(pack.fileName, 'business-assets-register.zip');
assert.equal(seen.filter(source => source === sourcePhoto).length, 1, 'a duplicate primary photo is fetched once');
assert.equal(seen.filter(source => source === sourceSlip).length, 1, 'an attached receipt and linked slip share one original byte file');
assert.ok(seen.includes(fileContentUrl(path)), 'legacy token references use the protected canonical reader');
assert.equal(seen.some(source => source.includes('PRIVATE-TOKEN')), false);
const zip = await JSZip.loadAsync(await pack.blob.arrayBuffer());
for (const name of ['Summary.html', 'Assets.csv', 'Manifest.json', 'README.txt']) assert.ok(zip.file(name));
const evidencePaths = Object.keys(zip.files).filter(name => !zip.files[name].dir && name.startsWith('evidence/'));
assert.equal(evidencePaths.length, 5, 'original photo, receipt, linked documents and service invoice are included');
assert.equal(new Set(evidencePaths.map(name => name.toLowerCase())).size, 5);
assert.ok(evidencePaths.some(name => name.includes('(2)')), 'same-named files get distinct archive paths');
assert.ok(evidencePaths.every(name => !name.split('/').includes('..')));
assert.ok(pack.manifest.assets[0].evidence.every(file => file.status === 'included' && file.archivePath && file.bytes! > 0));
for (const file of pack.manifest.assets[0].evidence) assert.ok(zip.file(file.archivePath!), 'every manifest file points at an actual entry');
assert.equal(await zip.file(pack.manifest.assets[0].evidence[0].archivePath!)!.async('string'), bytes.get(sourcePhoto));
for (const name of ['Summary.html', 'Assets.csv', 'Manifest.json', 'README.txt']) {
  const text = await zip.file(name)!.async('string');
  assert.equal(text.includes('PRIVATE-TOKEN'), false);
  assert.equal(text.includes('/api/files/content?'), false);
}

const partialAsset = item('partial', { status: 'lost', documentIds: ['denied', 'missing-record'], slipIds: ['missing-receipt'], insurancePolicyIds: ['private-policy'], photoDataUrl: 'data:image/jpeg;base64,AAA' });
const partial = await buildAssetClaimArchive({ items: [partialAsset, fixtures[2]], scope: 'incident', references: { ...references, policyDetailsUnavailable: true },
  fetchBlob: async source => { if (source.startsWith('data:')) return new Blob(['original image'], { type: 'image/jpeg' }); throw new Error(`403 ${legacySource}`); },
});
assert.equal(partial.partial, true);
assert.ok(partial.fileName.endsWith('-PARTIAL.zip'));
assert.equal(partial.manifest.assets.length, 1, 'the ZIP uses exactly the selected incident scope');
assert.equal(partial.manifest.assets[0].evidence.filter(file => file.status === 'unavailable').length, 3);
assert.ok(partial.manifest.warnings.some(warning => warning.includes('not readable by this account')));
const partialZip = await JSZip.loadAsync(await partial.blob.arrayBuffer());
assert.ok((await partialZip.file('README.txt')!.async('string')).includes('PARTIAL EVIDENCE PACK'));
for (const name of ['Summary.html', 'Assets.csv', 'Manifest.json', 'README.txt']) {
  const text = await partialZip.file(name)!.async('string');
  assert.ok(text.includes('Linked document record is unavailable.') || name === 'Manifest.json');
  assert.equal(text.includes('PRIVATE-TOKEN'), false, 'raw fetch errors never leak a token into a shared pack');
}
const empty = await buildAssetClaimArchive({ items: [item('empty', { photoDataUrl: 'empty' })], scope: 'all', references, fetchBlob: async () => new Blob([]) });
assert.equal(empty.partial, true, 'empty source bytes are explicitly unavailable');
const limited = await buildAssetClaimArchive({ items: [item('limited', { photoDataUrl: 'photo', receiptDataUrl: 'receipt' })], scope: 'all', references,
  limits: { fileBytes: 4, totalBytes: 5 }, fetchBlob: async () => new Blob(['123']) });
assert.equal(limited.partial, true);
assert.equal(limited.manifest.assets[0].evidence.filter(file => file.status === 'included').length, 1);
assert.match(limited.manifest.assets[0].evidence[1].reason!, /exceed the archive size limit/);
const oversized = await buildAssetClaimArchive({ items: [item('large', { photoDataUrl: 'large' })], scope: 'all', references,
  limits: { fileBytes: 3 }, fetchBlob: async () => new Blob(['1234']) });
assert.equal(oversized.partial, true);
assert.match(oversized.manifest.assets[0].evidence[0].reason!, /per-file archive size limit/);
let current = true;
await assert.rejects(buildAssetClaimArchive({ items: [rich], scope: 'all', references, isCurrent: () => current,
  fetchBlob: async () => { current = false; return new Blob(['old account bytes']); },
}), /account, space or selected assets changed/, 'no archive is delivered after scope/account/unmount cancellation');

const component = readFileSync(new URL('../components/AssetClaimExport.tsx', import.meta.url), 'utf8');
assert.match(component, /getDocFromServer\(doc\(db, 'families', space, 'reference', 'documents'\)\)/);
assert.match(component, /mayReadPolicies \? getDocFromServer/);
assert.match(component, /setReferenceError\('Could not verify/);
assert.match(component, /Retry evidence check/);
assert.match(component, /if \(!current\(\)\) return;\s*download\(pack.blob, pack.fileName\)/);
assert.match(component, /background\.forEach\(element => \{ element.inert = true; \}\)/);
assert.match(component, /role="dialog" aria-modal="true"/);
console.log('assetClaimExport: scoped mixed-currency records, spreadsheet/HTML safety, original evidence ZIPs, partial errors, protected URLs and cancellation passed');
