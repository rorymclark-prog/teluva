import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FamilyMember, VaultDocument, CalendarEvent } from '../types';
import { buildPack, resolveTopics, formatBytes, ALL_TOPICS, TOPIC_PRESETS } from './exportPack';

const root = join(import.meta.dirname ?? __dirname, '..', '..');

const NOW = new Date('2026-07-29T12:00:00');

const member = (p: Partial<FamilyMember> & { id: string; name: string }): FamilyMember => ({
  role: 'Child',
  avatarColor: 'bg-rosa-500',
  clothingSizes: {},
  documents: [],
  ...p,
} as FamilyMember);

const MIA = member({
  id: 'mia',
  name: 'Mia Clark',
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

// A business-space member with CV data — the filed CV sits under the generic
// 'Other' FamilyDocument category (see the comment on
// TOPIC_MEMBER_DOC_CATEGORIES in exportPack.ts for why), alongside an
// unrelated 'Other' document that must NOT get swept in with it.
const KATHARINA = member({
  id: 'katharina',
  name: 'Katharina Moser',
  cv: {
    summary: 'Registered nurse with 12 years in home care.',
    roles: [
      { id: 'cr1', title: 'Pflegedienstleitung', employer: 'Donaupflege GmbH', startDate: '2021-01-01', current: true },
    ],
    education: [
      { id: 'ce1', institution: 'FH Campus Wien', qualification: 'BSc Pflegewissenschaft', startDate: '2015-09-01', endDate: '2018-06-30' },
    ],
    qualifications: [
      { id: 'cq1', name: 'First-aid refresher (16h)', issuer: 'Rotes Kreuz', expiryDate: '2026-09-19' },
    ],
    skills: ['Wound care', 'Palliative care'],
    languages: ['German', 'English'],
    fileDocumentId: 'cvdoc',
  },
  documents: [
    // 'misc' is filed FIRST — a category-only match ('Other') would grab it
    // by mistake before ever reaching the actual CV, which is the failure
    // mode this fixture exists to catch.
    { id: 'misc', name: 'Random note', category: 'Other', fileType: 'application/pdf', fileName: 'misc.pdf', fileSize: 1_000, uploadedAt: '2026-01-01', fileData: 'data:application/pdf;base64,EEE' },
    { id: 'cvdoc', name: 'Katharina CV', category: 'Other', fileType: 'application/pdf', fileName: 'cv.pdf', fileSize: 50_000, uploadedAt: '2026-01-01', fileData: 'data:application/pdf;base64,DDD', contentHash: 'hash-cv' },
  ],
});

const EMPTY_CV = member({ id: 'empty', name: 'Empty CV' });

const VAULT: VaultDocument[] = [
  { id: 'v1', name: 'MRI knee', category: 'Medical', fileName: 'mri.pdf', fileType: 'application/pdf', fileSize: 2_000_000, storagePath: 's/mri', downloadUrl: 'https://example/mri', uploadedAt: '2026-06-10', memberId: 'mia' },
  // Same physical file as the referral above, filed twice.
  { id: 'v2', name: 'Bloods', category: 'Medical', fileName: 'bloods.pdf', fileType: 'application/pdf', fileSize: 120_000, storagePath: 's/bloods', downloadUrl: 'https://example/bloods-2', uploadedAt: '2026-06-02', memberId: 'mia', contentHash: 'hash-bloods' },
  // Somebody else's.
  { id: 'v3', name: 'Vita scan', category: 'Medical', fileName: 'a.pdf', fileType: 'application/pdf', fileSize: 10_000, storagePath: 's/a', downloadUrl: 'https://example/a', uploadedAt: '2026-06-02', memberId: 'vita' },
];

const EVENTS: CalendarEvent[] = [
  { id: 'e1', title: 'Mia – Orthodontist', date: '2026-08-04', time: '15:00', category: 'Appointment', remindMe: true, memberIds: [] },
  { id: 'e2', title: 'Dentist', date: '2026-01-04', category: 'Appointment', remindMe: false, memberIds: ['mia'] },
];

const DATA = { members: [MIA, VITA], events: EVENTS, vaultDocuments: VAULT, spaceName: 'Clark – Family Hub', now: NOW };

// --- the medical preset gathers the whole medical life ---------------------
{
  const pack = buildPack({ title: "Mia's medical records", memberIds: ['mia'], topics: TOPIC_PRESETS.medical }, DATA);

  const names = pack.files.map((f) => f.name);
  assert.ok(names.some((n) => n.startsWith('Referrals and results/')), 'the lab result travels with it');
  assert.ok(names.some((n) => n.includes('MRI knee')), 'so does a medical doc from the shared vault');
  assert.ok(!names.some((n) => n.includes('School report')), 'a school report is not medical');
  assert.ok(!names.some((n) => n.includes('Vita')), "and nothing of anybody else's");

  assert.match(pack.summaryMarkdown, /Blood group:\*\* A\+/);
  assert.match(pack.summaryMarkdown, /Penicillin/);
  assert.match(pack.summaryMarkdown, /MMR/);
  assert.match(pack.summaryMarkdown, /Dr Steiner/);
  assert.match(pack.folderName, /^Mia's medical records \(2026-07-29\)$/);
}

// --- the same file filed twice is sent once --------------------------------
{
  const pack = buildPack({ memberIds: ['mia'], topics: TOPIC_PRESETS.medical }, DATA);
  const blood = pack.files.filter((f) => f.hash === 'hash-bloods');
  assert.equal(blood.length, 1, 'the referral and the vault copy are one file');
}

// --- a record with no file is counted, never silently dropped --------------
{
  const pack = buildPack({ memberIds: ['mia'], topics: ['referrals'] }, DATA);
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
  const school = buildPack({ memberIds: ['mia'], topics: resolveTopics('school') }, DATA);
  const names = school.files.map((f) => f.name);
  assert.ok(names.some((n) => n.includes('School report')));
  assert.ok(!names.some((n) => n.includes('MRI')), 'a school folder contains no MRI');
  assert.ok(!/Penicillin/.test(school.summaryMarkdown), 'and no allergies');
  assert.match(school.summaryMarkdown, /VS Ahornweg/);
}

// --- appointments come through, including ones matched by name -------------
{
  const pack = buildPack({ memberIds: ['mia'], topics: ['appointments'] }, DATA);
  assert.match(pack.summaryMarkdown, /Orthodontist/, 'untagged but named in the title');
  assert.match(pack.summaryMarkdown, /Dentist/, 'and the explicitly tagged past one');
}

// --- several people get a folder each --------------------------------------
{
  const pack = buildPack({ title: 'Both children', memberIds: ['mia', 'vita'], topics: TOPIC_PRESETS.medical }, DATA);
  assert.ok(pack.files.every((f) => f.name.startsWith('Mia Clark/') || f.name.startsWith('Vita Clark/')),
    'each person gets their own folder');
  assert.match(pack.summaryMarkdown, /## Mia Clark/);
  assert.match(pack.summaryMarkdown, /## Vita Clark/);
}

// --- an empty member list means the household ------------------------------
{
  const pack = buildPack({ memberIds: [], topics: ['medical'] }, DATA);
  assert.match(pack.summaryMarkdown, /Mia Clark, Vita Clark/);
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
  const pack = buildPack({ memberIds: ['mia'], topics: TOPIC_PRESETS.medical }, DATA);
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

// --- employment: CV facts are gathered ------------------------------------
{
  const pack = buildPack({ memberIds: ['katharina'], topics: ['employment'] }, { members: [KATHARINA], now: NOW });
  assert.match(pack.summaryMarkdown, /Registered nurse with 12 years/);
  assert.match(pack.summaryMarkdown, /Pflegedienstleitung/);
  assert.match(pack.summaryMarkdown, /Donaupflege GmbH/);
  assert.match(pack.summaryMarkdown, /FH Campus Wien/);
  assert.match(pack.summaryMarkdown, /First-aid refresher/);
  assert.match(pack.summaryMarkdown, /Wound care, Palliative care/);
  assert.match(pack.summaryMarkdown, /German, English/);
}

// --- employment: the filed CV travels by id, never by category -------------
{
  const pack = buildPack({ memberIds: ['katharina'], topics: ['employment'] }, { members: [KATHARINA], now: NOW });
  const names = pack.files.map((f) => f.name);
  assert.ok(names.some((n) => n.includes('Katharina CV')), 'the filed CV travels with the employment topic');
  assert.ok(!names.some((n) => n.includes('Random note')),
    'an unrelated document filed under the same generic "Other" category is not swept in just because it shares a category with the CV');
}

// --- employment + documents together: the CV is not sent twice -------------
{
  const pack = buildPack({ memberIds: ['katharina'], topics: ['employment', 'documents'] }, { members: [KATHARINA], now: NOW });
  const cvFiles = pack.files.filter((f) => f.hash === 'hash-cv');
  assert.equal(cvFiles.length, 1, 'the CV is attached once even when both employment and documents are requested');
  assert.ok(pack.files.some((f) => f.name.includes('Random note')),
    'the unrelated Other document DOES come through once "documents" itself is asked for');
}

// --- employment: nothing recorded reports zero, not omitted ----------------
{
  const pack = buildPack({ memberIds: ['empty'], topics: ['employment'] }, { members: [EMPTY_CV], now: NOW });
  const section = pack.sections.find((s) => s.topic === 'employment');
  assert.equal(section?.count, 0, 'a member with no CV data reports zero rather than being left out');
}

// --- employment preset --------------------------------------------------
{
  assert.deepEqual(resolveTopics('employment'), ['contact', 'employment']);
}

// --- server.js keeps ITS topic allowlist, and the sentence told to the
// model, in sync with ALL_TOPICS. Three separate lists that can silently
// drift the moment a topic is added to only one of them — the same failure
// shape as v338's prop threaded through every layer but the one that
// mattered, just one level up: a topic the model is never told about is a
// topic it will never ask for, and buildPack would never even see the gap.
{
  const serverSrc = readFileSync(join(root, 'server.js'), 'utf8');

  const setMatch = serverSrc.match(/const EXPORT_TOPICS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, 'server.js still declares EXPORT_TOPICS as a Set literal');
  const serverTopics = Array.from(setMatch![1].matchAll(/'([a-z]+)'/g)).map((m) => m[1]);
  assert.deepEqual(new Set(serverTopics), new Set(ALL_TOPICS),
    "server.js's EXPORT_TOPICS allowlist has drifted from exportPack.ts's ALL_TOPICS");

  const promptMatch = serverSrc.match(/Topics are exactly: ([^\n]+)\./);
  assert.ok(promptMatch, 'the prompt still states the topic list on one line');
  const promptTopics = Array.from(promptMatch![1].matchAll(/"([a-z]+)"/g)).map((m) => m[1]);
  assert.deepEqual(new Set(promptTopics), new Set(ALL_TOPICS),
    'the topics the model is TOLD it can ask for have drifted from ALL_TOPICS');
}

console.log('exportPack.test.ts: all assertions passed');
