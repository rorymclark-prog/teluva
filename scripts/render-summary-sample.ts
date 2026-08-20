// Render a sample summary PDF from fixture data so it can be LOOKED AT.
//
// A layout bug in a generated PDF — a table running off the page, a header not
// repeating, text overlapping a rule — passes every assertion you can write
// about the document model, because the model is fine. The only way to know
// the PDF is right is to open it.
//
//   npx tsx scripts/render-summary-sample.ts /tmp/out.pdf
import { writeFileSync } from 'node:fs';
import { FamilyMember, VaultDocument, CalendarEvent } from '../src/types';
import { buildPack, TOPIC_PRESETS } from '../src/utils/exportPack';
import { renderSummaryPdf } from '../src/utils/summaryPdf';

const out = process.argv[2] || 'summary-sample.pdf';

const member = (p: Partial<FamilyMember> & { id: string; name: string }): FamilyMember => ({
  role: 'Child', avatarColor: 'bg-rosa-500', clothingSizes: {}, documents: [], ...p,
} as FamilyMember);

// Deliberately awkward: long free-text values, a German umlaut, many rows to
// force a page break, and a notes column long enough to test column clamping.
const SOPHIE = member({
  id: 'sophie',
  name: 'Sophie Clark',
  birthdate: '2018-03-04',
  gender: 'Female',
  address: 'Ahornweg 42/7, 1120 Wien, Austria',
  emergencyContactName: 'Rory Clark',
  emergencyContactPhone: '+43 660 1234567',
  identity: { eCardNumber: '1234 040318', svNumber: '1234 040318' },
  medical: {
    bloodGroup: 'A+',
    allergies: 'Penicillin (rash, 2023). No known food allergies.',
    medications: 'Vitamin D 400 IU daily through the winter months',
    conditions: 'Mild iron deficiency, monitored six-monthly since March 2025',
    familyHistory: 'Type 2 diabetes on the maternal side; no known cardiac history',
    organDonor: false,
    preferredPharmacy: 'Ahorn-Apotheke, Ahornweg',
    vaccinations: Array.from({ length: 14 }, (_, i) => ({
      id: `v${i}`, name: ['MMR', 'DTaP-IPV-Hib', 'Pneumococcal', 'Rotavirus', 'Meningococcal B'][i % 5],
      date: `20${19 + (i % 7)}-0${(i % 9) + 1}-1${i % 9}`,
      notes: i % 3 === 0 ? 'Given at the Mutter-Kind-Pass check-up' : '',
    })),
  },
  referrals: Array.from({ length: 9 }, (_, i) => ({
    id: `r${i}`,
    kind: ['Lab result', 'Imaging', 'Referral letter', 'Specialist letter'][i % 4],
    date: `2026-0${(i % 6) + 1}-1${i % 9}`,
    reason: ['Ferritin and vitamin D', 'Right knee', 'Annual bloods', 'Orthodontic assessment'][i % 4],
    providerName: ['Dr Steiner', 'Dr Lena Hofer-Mayr', 'Ordination Dr Weiß'][i % 3],
    notes: i % 2 === 0 ? 'Repeat in six months; copy sent to the GP for the file' : '',
    fileName: `result-${i}.pdf`, fileType: 'application/pdf', fileSize: 100_000,
    storagePath: `s/${i}`, downloadUrl: i === 3 ? '' : `https://example/${i}`,
    addedAt: `2026-0${(i % 6) + 1}-1${i % 9}T09:00:00Z`,
  })),
  careSchedule: [
    { id: 'c1', kind: 'Dentist', provider: 'Dr Lena Hofer-Mayr', intervalMonths: 6, lastVisit: '2026-02-04', nextDue: '2026-08-04' },
    { id: 'c2', kind: 'Eye test', provider: 'Optiker Hartlauer', intervalMonths: 24, lastVisit: '2025-09-01' },
  ],
  growthHistory: Array.from({ length: 6 }, (_, i) => ({
    id: `g${i}`, date: `202${i}-06-01`, heightCm: 95 + i * 7, weightKg: 14 + i * 3,
    notes: i === 0 ? 'Measured at the Mutter-Kind-Pass appointment' : '',
  })),
});

const VAULT: VaultDocument[] = [
  { id: 'v1', name: 'MRI right knee — Radiologie Wien', category: 'Medical', fileName: 'mri.pdf', fileType: 'application/pdf', fileSize: 2_400_000, storagePath: 's/mri', downloadUrl: 'https://example/mri', uploadedAt: '2026-06-10', memberId: 'sophie' },
];

const EVENTS: CalendarEvent[] = Array.from({ length: 22 }, (_, i) => ({
  id: `e${i}`,
  title: i % 2 ? 'Sophie – Orthodontist (Dr. Lena Hofer-Mayr)' : 'Kinderarzt Kontrolle',
  date: `2026-0${(i % 9) + 1}-1${i % 9}`,
  time: '15:00',
  category: 'Appointment' as const,
  remindMe: true,
  memberIds: i % 2 ? [] : ['sophie'],
}));

const pack = buildPack(
  { title: "Sophie's medical records", memberIds: ['sophie'], topics: TOPIC_PRESETS.medical },
  { members: [SOPHIE], events: EVENTS, vaultDocuments: VAULT, spaceName: 'Clark – Family Hub', now: new Date('2026-07-29T12:00:00') },
);

const { blob, size } = renderSummaryPdf(pack.summary);
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync(out, buf);
console.log(`wrote ${out} — ${size} bytes, ${pack.files.length} files in the pack`);
