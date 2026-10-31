import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backupRestorePlan, profileAndAssetBackupFiles, restoreBackupRecords } from './backupRestore';
import { buildDownloadZip, IncompleteZipError } from './share';
import JSZip from 'jszip';

const backup = {
  version: 3,
  members: [{ id: 'employee', name: 'Test', documents: [{ id: 'cv', fileName: 'CV.pdf', fileData: '/api/files/content?path=families%2Fbusiness%2Fdocuments%2Fcv%2FCV.pdf' }] }],
  calendarEvents: [{ id: 'event' }],
  documents: [{ id: 'vault', storagePath: 'families/business/documents/vault/contract.pdf' }],
  assets: [{ id: 'laptop', name: 'Laptop', photoDataUrl: 'data:image/jpeg;base64,primary', photos: ['/api/files/content?path=families%2Fbusiness%2Fasset-photos%2Fserial.jpg'], receiptDataUrl: 'data:image/jpeg;base64,receipt' }],
  slips: [{ id: 'receipt' }], recipes: [], shopping: [],
  info: { numbers: [{ id: 'vat' }] }, household: { address: 'Office' }, finances: { accounts: [] },
  timeline: { events: [] }, businessMilestones: { milestones: [{ id: 'opening' }] },
  willsEstate: { records: [] }, inMemory: { people: [] }, actions: { items: [] }, settings: { hubName: 'Business' },
};
const writes: Record<string, unknown> = {};
assert.deepEqual(await restoreBackupRecords(backup, async (section, value) => { writes[section] = value; return true; }, () => true), []);
for (const [section, value] of Object.entries(backup)) {
  if (section === 'version' || section === 'documents') continue;
  assert.deepEqual(writes[section], value, `${section} round-trips without being silently skipped`);
}
assert.equal((writes.documents as any[])[0].downloadUrl, '/api/files/content?path=families%2Fbusiness%2Fdocuments%2Fvault%2Fcontract.pdf', 'path-only metadata becomes usable without minting a token');
assert.equal((backup.documents[0] as any).downloadUrl, undefined, 'restore does not mutate the parsed backup');
const unsafe = backupRestorePlan({ documents: [{ id: 'bad', storagePath: 'families/business/../other/secret' }] });
assert.equal(unsafe[0].value[0].downloadUrl, undefined);
assert.deepEqual(backupRestorePlan({ members: [] }).map(item => item.section), ['members'], 'old JSON backups remain supported');
assert.equal(backupRestorePlan({ info: null, members: [] }).length, 1, 'permission-filtered null sections are skipped');
let mutations = 0;
await assert.rejects(restoreBackupRecords({ members: [], assets: [{ name: 'Missing ID' }] }, async () => { mutations++; }, () => true), /invalid-backup-assets/);
await assert.rejects(restoreBackupRecords({ members: [], actions: { items: 'bad' } }, async () => { mutations++; }, () => true), /invalid-backup-actions/);
assert.equal(mutations, 0, 'all sections are validated before the first write');
assert.deepEqual(await restoreBackupRecords({ assets: [], slips: [] }, async section => section !== 'assets', () => true), ['assets'], 'a false save is reported as pending rather than successful');
let current = true;
const visited: string[] = [];
await assert.rejects(restoreBackupRecords({ members: [], slips: [] }, async section => { visited.push(section); current = false; }, () => current), /backup-scope-changed/);
assert.deepEqual(visited, ['members'], 'changing account/space stops all subsequent writes');
const files = profileAndAssetBackupFiles(backup as any);
assert.equal(files.length, 4, 'CV and all asset evidence travel as bytes in the archive');
assert.ok(files.some(file => file.name === 'profiles/Test/CV.pdf'));
assert.ok(files.some(file => file.src.includes('serial.jpg')));
assert.deepEqual(profileAndAssetBackupFiles({ members: [{ name: '..', documents: [{ name: '../unsafe.pdf', fileData: 'data:application/pdf;base64,test' }] }] } as any).map(file => file.name), ['profiles/_/.._unsafe.pdf']);

// Keep the actual exported schema and the executable restore plan aligned.
const dashboard = readFileSync(new URL('../components/Dashboard.tsx', import.meta.url), 'utf8');
const exported = dashboard.slice(dashboard.indexOf('const backupData = {'), dashboard.indexOf('const dataStr = JSON.stringify(backupData'));
const fields = [...exported.matchAll(/^        (\w+)(?::|,)/gm)].map(match => match[1]).filter(key => !['version', 'exportedAt', 'author', 'passwordVault'].includes(key));
const restored = new Set(backupRestorePlan(backup).map(item => item.section));
assert.ok(fields.length >= 15);
assert.deepEqual(fields.filter(key => !restored.has(key as never)), [], 'every exported data section has an executable restore route');
for (const field of restored) assert.match(dashboard, new RegExp(`case '${field}':`), `Dashboard routes ${field} to persistence`);
assert.match(dashboard, /downloadZip\(fileItems,[\s\S]{0,180}requireAllFiles: true/, 'the full-backup button opts in to complete-file verification');

const mime = new Map([
  ['cv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['receipt', 'application/pdf'], ['picture', 'image/jpeg'], ['denied', 'application/json'],
]);
const fetchFile: typeof fetch = async input => {
  const key = String(input);
  return new Response(key === 'denied' ? '{"error":"forbidden"}' : `file:${key}`, { status: key === 'denied' ? 403 : 200, headers: { 'Content-Type': mime.get(key) || 'application/octet-stream' } });
};
const archive = await buildDownloadZip([
  { src: 'cv', name: 'profiles/Test/CV' },
  { src: 'cv', name: 'profiles/Test/CV' },
  { src: 'receipt', name: 'assets/receipt.pdf' },
  { src: 'picture', name: 'assets/photo' },
], [{ name: 'family_vault_data.json', content: JSON.stringify(backup) }], { requireAllFiles: true, fetch: fetchFile });
const zip = await JSZip.loadAsync(await archive.arrayBuffer());
for (const name of ['profiles/Test/CV.docx', 'profiles/Test/CV (2).docx', 'assets/receipt.pdf', 'assets/photo.jpg', 'family_vault_data.json']) assert.ok(zip.file(name), `correct archive entry: ${name}`);
assert.equal(await zip.file('profiles/Test/CV.docx')!.async('string'), 'file:cv', 'actual original bytes survive zip generation');
const originalLog = console.error;
try {
  console.error = () => {};
  await assert.rejects(buildDownloadZip([{ src: 'cv', name: 'CV.docx' }, { src: 'denied', name: 'Contract.pdf' }], [], { requireAllFiles: true, fetch: fetchFile }), error => error instanceof IncompleteZipError && error.missing[0] === 'Contract.pdf');
  const partial = await buildDownloadZip([{ src: 'cv', name: 'CV.docx' }, { src: 'denied', name: 'Contract.pdf' }], [], { fetch: fetchFile });
  const partialZip = await JSZip.loadAsync(await partial.arrayBuffer());
  assert.ok(partialZip.file('CV.docx'), 'ordinary partial sharing remains available');
  assert.equal(partialZip.file('Contract.pdf'), null, 'a denied JSON response never masquerades as document bytes');
} finally { console.error = originalLog; }
console.log('backupRestore: complete business records, legacy metadata, evidence, preflight validation and scope/pending guards passed');
