import assert from 'node:assert/strict';
import { FamilyMember, VaultDocument, CalendarEvent } from '../types';
import { buildPack, resolveTopics, formatBytes, ALL_TOPICS, TOPIC_PRESETS } from './exportPack';

const NOW = new Date('2026-07-29T12:00:00');

const member = (p: Partial<FamilyMember> & { id: string; name: string }): FamilyMember => ({
  role: 'Child',
  avatarColor: 'bg-rosa-500',
  clothingSizes: {},
  documents: [],
  ...p,
} as FamilyMember);

const SOPHIE = member({
  id: 'sophie',
  name: 'Sophie Clark',
  birthdate: '2018-03-04',
  medical: {
    bloodGroup: 'A+',
    allergies: 'Penicillin',
    vaccinations: [{ id: 'v1', name: 'MMR', date: '2019-04-01' }],
  },
  referrals: [
    {
      id: 'r1', kind: 'Lab result', date: '2026-06-01', reason: 'Ferritin',
      providerName: 'Dr Steiner', fileName: 'bloods.pdf', fileType: 'application/pdf',
      fileSize: 120_000, storagePath: 'x/bloods.pdf', downloadUrl: 'https://example/bloods',
      contentHash: 'hash-bloods', addedAt: '2026-06-02T09:00:00Z',
    },
    // A referral recorded by hand, with no scan attached.
    {
      id: 'r2', kind: 'Referral letter', date: '2026-05-01', reason: 'Knee',
      fileName: '', fileType: '', fileSize: 0, storagePath: '', downloadUrl: '',
      addedAt: '2026-05-01T09:00:00Z',
    },
  ],
  documents: [
    { id: 'd1', name: 'Vaccination card', category: 'Health', fileType: 'image/jpeg', fileName: 'card.jpg', fileSize: 90_000, uploadedAt: '2025-01-01', fileData: 'data:image/jpeg;base64,AAA' },
    { id: 'd2', name: 'School report', category: 'Education', fileType: 'application/pdf', fileName: 'report.pdf', fileSize: 40_000, uploadedAt: '2025-06-01', fileData: 'data:application/pdf;base64,BBB' },
  ],
  passports: [{ id: 'p1', country: 'Austria', number: 'P1234', expiryDate: '2030-01-01' }],
  education: { schoolName: 'VS Ahornweg', grade: '2' },
});

const VITA = member({ id: 'vita', name: 'Vita Clark', medical: { bloodGroup: 'O-' } });

const VAULT: VaultDocument[] = [
  { id: 'v1', name: 'MRI knee', category: 'Medical', fileName: 'mri.pdf', fileType: 'application/pdf', fileSize: 2_000_000, storagePath: 's/mri', downloadUrl: 'https://example/mri', uploadedAt: '2026-06-10', memberId: 'sophie' },
  // Same physical file as the referral above, filed twice.
  { id: 'v2', name: 'Bloods', category: 'Medical', fileName: 'bloods.pdf', fileType: 'application/pdf', fileSize: 120_000, storagePath: 's/bloods', downloadUrl: 'https://example/bloods-2', uploadedAt: '2026-06-02', memberId: 'sophie', contentHash: 'hash-bloods' },
  // Somebody else's.
  { id: 'v3', name: 'Vita scan', category: 'Medical', fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 10_000, storagePath: 's/a', downloadUrl: 'https://example/a', uploadedAt: '2026-06-02', memberId: 'vita' },
];

const EVENTS: CalendarEvent[] = [
  { id: 'e1', title: 'Sophie – Orthodontist', date: '2026-08-04', time: '15:00', category: 'Appointment', remindMe: true, memberIds: [] },
  { id: 'e2', title: 'Dentist', date: '2026-01-04', category: 'Appointment', remindMe: false, memberIds: ['sophie'] },
];

const DATA = { members: [SOPHIE, VITA], events: EVENTS, vaultDocuments: VAULT, spaceName: 'Clark – Family Hub', now: NOW };

// --- the medical preset gathers the whole medical life ---------------------
{
  const pack = buildPack({ title: "Sophie's medical records", memberIds: ['sophie'], topics: TOPIC_PRESETS.medical }, DATA);

  const names = pack.files.map((f) => f.name);
  assert.ok(names.some((n) => n.startsWith('Referrals and results/')), 'the lab result travels with it');
  assert.ok(names.some((n) => n.includes('MRI knee')), 'so does a medical doc from the shared vault');
  assert.ok(!names.some((n) => n.includes('School report')), 'a school report is not medical');
  assert.ok(!names.some((n) => n.includes('Vita')), "and nothing of anybody else's");

  assert.match(pack.summaryMarkdown, /Blood group:\*\* A\+/);
  assert.match(pack.summaryMarkdown, /Penicillin/);
  assert.match(pack.summaryMarkdown, /MMR/);
  assert.match(pack.summaryMarkdown, /Dr Steiner/);
  assert.match(pack.folderName, /^Sophie's medical records \(2026-07-29\)$/);
}

// --- the same file filed twice is sent once --------------------------------
{
  const pack = buildPack({ memberIds: ['sophie'], topics: TOPIC_PRESETS.medical }, DATA);
  const blood = pack.files.filter((f) => f.hash === 'hash-bloods');
  assert.equal(blood.length, 1, 'the referral and the vault copy are one file');
}

// --- a record with no file is counted, never silently dropped --------------
{
  const pack = buildPack({ memberIds: ['sophie'], topics: ['referrals'] }, DATA);
  assert.equal(pack.recordsWithoutFiles, 1, 'the hand-entered knee referral has no scan');
  assert.match(pack.summaryMarkdown, /1 record is listed above with no file attached/);
  assert.match(pack.summaryMarkdown, /Knee/, 'and it still appears in the summary');
}

// --- storage download URLs never reach the written summary -----------------
{
  // A summary forwarded to an insurer must not hand them live bearer-token
  // links to every scan it names.
  const pack = buildPack({ memberIds: [], topics: ALL_TOPICS }, DATA);
  assert.ok(!/https:\/\/example\//.test(pack.summaryMarkdown), 'no download URLs in the summary');
  assert.ok(!/downloadUrl/.test(pack.summaryMarkdown));
}

// --- topics really do narrow what is gathered ------------------------------
{
  const school = buildPack({ memberIds: ['sophie'], topics: resolveTopics('school') }, DATA);
  const names = school.files.map((f) => f.name);
  assert.ok(names.some((n) => n.includes('School report')));
  assert.ok(!names.some((n) => n.includes('MRI')), 'a school folder contains no MRI');
  assert.ok(!/Penicillin/.test(school.summaryMarkdown), 'and no allergies');
  assert.match(school.summaryMarkdown, /VS Ahornweg/);
}

// --- appointments come through, including ones matched by name -------------
{
  const pack = buildPack({ memberIds: ['sophie'], topics: ['appointments'] }, DATA);
  assert.match(pack.summaryMarkdown, /Orthodontist/, 'untagged but named in the title');
  assert.match(pack.summaryMarkdown, /Dentist/, 'and the explicitly tagged past one');
}

// --- several people get a folder each --------------------------------------
{
  const pack = buildPack({ title: 'Both children', memberIds: ['sophie', 'vita'], topics: TOPIC_PRESETS.medical }, DATA);
  assert.ok(pack.files.every((f) => f.name.startsWith('Sophie Clark/') || f.name.startsWith('Vita Clark/')),
    'each person gets their own folder');
  assert.match(pack.summaryMarkdown, /## Sophie Clark/);
  assert.match(pack.summaryMarkdown, /## Vita Clark/);
}

// --- an empty member list means the household ------------------------------
{
  const pack = buildPack({ memberIds: [], topics: ['medical'] }, DATA);
  assert.match(pack.summaryMarkdown, /Sophie Clark, Vita Clark/);
}

// --- an unknown member id is dropped, not guessed at ------------------------
{
  const pack = buildPack({ memberIds: ['nobody'], topics: ['medical'] }, DATA);
  assert.equal(pack.files.length, 0);
  assert.match(pack.summaryMarkdown, /no matching people were found/);
}

// --- empty topics are shown as empty, not hidden ---------------------------
{
  const pack = buildPack({ memberIds: ['vita'], topics: TOPIC_PRESETS.medical }, DATA);
  const vaccinations = pack.sections.find((s) => s.topic === 'vaccinations');
  assert.equal(vaccinations?.count, 0, 'reported as zero rather than omitted');
  assert.ok(pack.sections.length > 1, 'every requested topic is accounted for');
}

// --- resolveTopics ---------------------------------------------------------
{
  assert.deepEqual(resolveTopics('medical'), TOPIC_PRESETS.medical.slice().sort(
    (a, b) => ALL_TOPICS.indexOf(a) - ALL_TOPICS.indexOf(b)));
  assert.ok(resolveTopics(undefined, ['growth']).includes('contact'),
    'contact details always ride along — a folder with no name or date of birth on it is a phone call');
  assert.deepEqual(resolveTopics('nonsense-preset'), [], 'an unknown preset adds nothing');
  assert.deepEqual(resolveTopics(undefined, ['not-a-topic']), [], 'and an unknown topic is ignored');
  assert.deepEqual(resolveTopics(undefined, []), [], 'nothing asked for, nothing added');
  // A preset and extra topics compose.
  const t = resolveTopics('school', ['medical']);
  assert.ok(t.includes('education') && t.includes('medical'));
}

// --- sizes -----------------------------------------------------------------
{
  assert.equal(formatBytes(0), 'unknown size');
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3_500_000), '3.3 MB');
  const pack = buildPack({ memberIds: ['sophie'], topics: TOPIC_PRESETS.medical }, DATA);
  assert.ok(pack.approxBytes > 2_000_000, 'the MRI dominates the estimate');
}

// --- a name with a slash in it cannot invent a folder ----------------------
{
  const odd = member({ id: 'x', name: 'A/B Clark', medical: { bloodGroup: 'B+' },
    documents: [{ id: 'd', name: 'Report 1/2', category: 'Health', fileType: 'application/pdf', fileName: 'r.pdf', fileSize: 10, uploadedAt: '2026-01-01', fileData: 'data:application/pdf;base64,CC' }] });
  const pack = buildPack({ memberIds: ['x'], topics: ['documents'] }, { members: [odd], now: NOW });
  assert.equal(pack.files[0].name, 'Documents/Report 1-2.pdf');
  assert.ok(!pack.folderName.includes('/'));
}

console.log('exportPack.test.ts: all assertions passed');
