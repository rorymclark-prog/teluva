import { FamilyMember, CalendarEvent, ContactEntry, ExtendedBirthday, FamilyMemberRole } from '../types';

// Demo-mode fixtures: shown when the app is opened with ?demo=1.
// Never written to Firestore or localStorage.

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

export const DEMO_MEMBERS: FamilyMember[] = [
  {
    id: 'demo-mama',
    name: 'Mama',
    role: 'Parent',
    birthdate: '1989-04-12',
    // Full birth details on ONE demo member, so the star-sign card shows both
    // states side by side: a complete Sun/Moon/Rising here, and the honest
    // "needs the time of birth" on everyone else.
    birthTime: '07:20',
    placeOfBirth: 'Vienna, Austria',
    birthTimeZone: 'Europe/Vienna',
    birthLatitude: 48.2082,
    birthLongitude: 16.3738,
    avatarColor: 'bg-rosa-500',
    clothingSizes: { tops: 'M', bottoms: '38', shoes: '39', outerwear: 'M', notes: 'Prefers natural fabrics', lastUpdated: iso(-12) },
    documents: [],
    growthHistory: [],
    favorites: [
      { id: 'demo-fav-1', title: 'Garden herbs', category: 'Hobbies & Sports', imageUrl: '', notes: 'Basil over everything', addedAt: iso(-40) },
    ],
    // Overdue yearly check-up → shows an "overdue" care nudge + Overview banner.
    careSchedule: [
      { id: 'demo-care-mama-1', kind: 'Medical check-up', provider: 'Dr. Wagner', lastVisit: iso(-400), intervalMonths: 12 },
    ],
  },
  {
    id: 'demo-papa',
    name: 'Papa',
    role: 'Parent',
    birthdate: '1987-09-03',
    avatarColor: 'bg-dusk-500',
    clothingSizes: { tops: 'L', bottoms: '34/34', shoes: '44', lastUpdated: iso(-30) },
    passport: {
      passportNumber: 'P1234567',
      fullName: 'Demo Papa',
      issuingCountry: 'Austria',
      dateOfBirth: '1987-09-03',
      issueDate: '2019-06-15',
      expiryDate: iso(160), // expiring within ~5 months → shows the renewal notice
    },
    // Annual transit pass expiring soon → transit section + Show-card + expiry nudge.
    travel: {
      transitPasses: [
        { id: 'demo-pass-papa-1', name: 'Wiener Linien Jahreskarte', operator: 'Wiener Linien', cardNumber: 'WL-8842-1077-3390', zone: 'Wien Kernzone', validFrom: iso(-345), validUntil: iso(20) },
      ],
    },
    documents: [],
    growthHistory: [],
  },
  {
    id: 'demo-mia',
    name: 'Mia',
    role: 'Child',
    birthdate: '2020-02-18',
    avatarColor: 'bg-sage-500',
    clothingSizes: { tops: '116', bottoms: '116', shoes: '30', outerwear: '122', notes: 'Growing fast — size up jackets', lastUpdated: iso(-5) },
    documents: [],
    growthHistory: [
      { id: 'demo-g1', date: iso(-365), heightCm: 105, weightKg: 17.2 },
      { id: 'demo-g2', date: iso(-180), heightCm: 109, weightKg: 18.4 },
      { id: 'demo-g3', date: iso(-14), heightCm: 113, weightKg: 19.6, notes: 'Yearly checkup — all good' },
    ],
    favorites: [
      { id: 'demo-fav-2', title: 'Drawing set', category: 'Toy', imageUrl: '', addedAt: iso(-20), isWishlist: true, targetPrice: '€19.90' },
    ],
    education: { schoolName: 'Volksschule am Park', grade: '1a', teacherName: 'Fr. Berger' },
    // Dental check-up due in ~3 weeks → "due-soon" care nudge + Overview banner.
    careSchedule: [
      { id: 'demo-care-mia-1', kind: 'Dental check-up', provider: 'Dr. Müller (Zahnarzt)', lastVisit: iso(-160), intervalMonths: 6 },
      { id: 'demo-care-mia-2', kind: 'Eye test', lastVisit: iso(-30), intervalMonths: 24 },
    ],
  },
  {
    id: 'demo-ben',
    name: 'Ben',
    role: 'Child',
    birthdate: '2024-07-30',
    avatarColor: 'bg-honey-500',
    clothingSizes: { tops: '86', bottoms: '86', shoes: '21', lastUpdated: iso(-2) },
    documents: [],
    growthHistory: [
      { id: 'demo-g4', date: iso(-90), heightCm: 74, weightKg: 9.1 },
      { id: 'demo-g5', date: iso(-7), heightCm: 78, weightKg: 10.0 },
    ],
  },
];

export const DEMO_EVENTS: CalendarEvent[] = [
  // Marked important by hand, so the demo shows both kinds of mark: this one,
  // and the pediatrician below, which is important because it is medical.
  { id: 'demo-e1', title: "Mia's school play", date: iso(6), time: '16:00', category: 'School', remindMe: true, memberIds: ['demo-mia'], important: true },
  { id: 'demo-e2', title: 'Pediatrician — Ben', date: iso(12), time: '09:30', category: 'Appointment', remindMe: true, memberIds: ['demo-ben'] },
  { id: 'demo-e3', title: 'Renew Papa passport', date: iso(30), category: 'Travel', remindMe: true, memberIds: ['demo-papa'] },
  // A trip that is HAPPENING — the demo's whole point is showing what the app
  // looks like in use, and the travel banner and trip pack only appear while
  // somebody is actually away. Dated relative to today so it never goes stale.
  {
    id: 'demo-e4',
    title: 'Mia in Lisbon',
    date: iso(-3),
    endDate: iso(5),
    destination: 'Lisbon, Portugal',
    category: 'Travel',
    remindMe: true,
    memberIds: ['demo-mia'],
  },
];

function birthdateInDays(daysFromNow: number, birthYear: number): string {
  return `${birthYear}-${iso(daysFromNow).slice(5, 7)}-${iso(daysFromNow).slice(8, 10)}`;
}

export const DEMO_CONTACTS: ContactEntry[] = [
  // Birthday in ~5 days — shows up as a nudge even without a full profile.
  { id: 'demo-contact-oma', name: 'Oma', relation: 'Grandmother', phone: '+43 664 1234567', birthdate: birthdateInDays(5, 1951) },
  { id: 'demo-contact-school', name: 'Volksschule am Park Office', relation: 'School office', phone: '+43 1 5551234' },
];

// One relative who is not a family member, so the demo calendar has an
// extended-family birthday to show (and to show "Hide Aunt Klara's dates" on). About
// two weeks out, so it lands within the home screen's look-ahead.
export const DEMO_EXTENDED_BIRTHDAYS: ExtendedBirthday[] = [
  { id: 'demo-eb-klara', name: 'Aunt Klara', relationship: 'Aunt', date: iso(12).slice(5), originalYear: 1968, createdAt: '2026-01-01' },
];

// The demo family's sign-in accounts, for the "Choose who" checklist in
// "Hide <Name>'s dates" (contexts/HiddenPeopleContext.tsx). A real family
// reads these from families/{id}/roles; the demo has no accounts, so without
// this the checklist would have nobody to show. Two parents who are both
// admins — the case the feature exists for — and the two children. The demo
// is read-only, so these uids are never written anywhere; DEMO_ACCOUNT_UID is
// "you" in the demo (Mama), only so the list can say "You" on one row.
export const DEMO_ACCOUNT_UID = 'demo-uid-mama';
export const DEMO_ACCOUNT_ROLES: Record<string, FamilyMemberRole> = {
  'demo-uid-mama': { role: 'admin', email: 'mama@demo.teluva.invalid', displayName: 'Mama' },
  'demo-uid-papa': { role: 'admin', email: 'papa@demo.teluva.invalid', displayName: 'Papa' },
  'demo-uid-mia': { role: 'child', email: 'mia@demo.teluva.invalid', displayName: 'Mia' },
  'demo-uid-ben': { role: 'child', email: 'ben@demo.teluva.invalid', displayName: 'Ben' },
};

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('demo');
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE BUSINESS DEMO (?demo=business)
 *
 * A business space is not a skin on the family app — the Firestore rules answer
 * differently (a colleague's record is an HR file, the company's finances are
 * owners-only), whole sections are hidden, three are renamed, and a CV tab
 * appears that has no family equivalent. None of that could be SEEN without an
 * account, so the only way to show somebody the business product was to sell
 * them a subscription first.
 *
 * The company is invented. Donaupflege is a small Vienna home-care business
 * because that is the shape Teluva's business bundle was built for — a handful
 * of staff, real compliance dates, no HR department — and because a demo full
 * of "Acme Corp" and "Employee 1" demonstrates nothing. Every name, number and
 * address here is fictional; nothing in this file is ever written to Firestore
 * or localStorage.
 *
 * The demo signs you in as the OWNER, which is why birthdates are visible here.
 * An employee sees the staff directory instead — name, title, work phone — and
 * none of these dates. See server/directory.mjs for why.
 * ───────────────────────────────────────────────────────────────────────────*/

export const DEMO_BUSINESS_NAME = 'Donaupflege GmbH';

export const DEMO_BUSINESS_MEMBERS: FamilyMember[] = [
  {
    id: 'demo-biz-owner',
    name: 'Katharina Moser',
    role: 'Owner',
    birthdate: '1978-03-09',
    avatarColor: 'bg-dusk-500',
    jobTitle: 'Owner & Pflegedienstleitung',
    employer: 'Donaupflege GmbH',
    workPhone: '+43 1 5550101',
    workAddress: 'Praterstraße 14/2, 1020 Wien',
    startDate: '2019-04-01',
    documents: [],
    growthHistory: [],
    clothingSizes: {},
    cv: {
      summary: 'Registered nurse (DGKP) who founded Donaupflege after eleven years in hospital and mobile care.',
      qualifications: [
        { id: 'demo-q1', name: 'Diplomierte Gesundheits- und Krankenpflegerin (DGKP)', issuer: 'FH Campus Wien', issueDate: '2003-06-30' },
        { id: 'demo-q2', name: 'Pflegedienstleitung certificate', issuer: 'ÖGKV', issueDate: '2018-11-15' },
      ],
      languages: ['German (native)', 'English (fluent)', 'Bosnian (conversational)'],
      skills: ['Care planning', 'Rostering', 'Family liaison', 'Wound care'],
    },
  },
  {
    id: 'demo-biz-manager',
    name: 'Tomas Lindqvist',
    role: 'Manager',
    birthdate: '1986-11-22',
    avatarColor: 'bg-sage-500',
    jobTitle: 'Care coordinator',
    employer: 'Donaupflege GmbH',
    workPhone: '+43 1 5550102',
    workAddress: 'Praterstraße 14/2, 1020 Wien',
    // Five years next month — the work-anniversary nudge has something to find.
    startDate: `${new Date().getFullYear() - 5}-${iso(21).slice(5, 7)}-${iso(21).slice(8, 10)}`,
    documents: [],
    growthHistory: [],
    clothingSizes: {},
    cv: {
      summary: 'Coordinates the roster and the first point of contact for families.',
      roles: [
        { id: 'demo-r1', title: 'Care coordinator', employer: 'Donaupflege GmbH', startDate: '2021-06-01' },
        { id: 'demo-r2', title: 'Mobile carer', employer: 'Caritas Wien', startDate: '2014-02-01', endDate: '2021-05-31' },
      ],
      languages: ['Swedish (native)', 'German (fluent)', 'English (fluent)'],
      skills: ['Rostering', 'Scheduling software', 'Complaint handling'],
    },
    employeePreferences: { preferredName: 'Tom', coffeeOrTea: 'Coffee, black', kitSize: 'L' },
  },
  {
    id: 'demo-biz-carer-1',
    name: 'Amina Yusuf',
    role: 'Employee',
    birthdate: '1994-06-02',
    avatarColor: 'bg-clay-500',
    jobTitle: 'Mobile carer',
    employer: 'Donaupflege GmbH',
    workPhone: '+43 1 5550103',
    startDate: '2022-09-12',
    documents: [],
    growthHistory: [],
    clothingSizes: {},
    cv: {
      summary: 'Pflegeassistenz, works the Leopoldstadt round.',
      qualifications: [
        { id: 'demo-q3', name: 'Pflegeassistenz', issuer: 'Wiener Gesundheitsverbund', issueDate: '2022-07-08' },
        // Expires in three weeks — this is the one the Compliance section is for.
        { id: 'demo-q4', name: 'First-aid refresher (16h)', issuer: 'Rotes Kreuz Wien', issueDate: iso(-711), expiryDate: iso(21) },
      ],
      languages: ['Somali (native)', 'German (fluent)', 'English (good)'],
      skills: ['Personal care', 'Medication support', 'Dementia care'],
    },
    employeePreferences: { dietaryRequirements: 'Halal', kitSize: 'M' },
  },
  {
    id: 'demo-biz-carer-2',
    name: 'Peter Brandstätter',
    role: 'Employee',
    birthdate: '1969-01-30',
    avatarColor: 'bg-rosa-500',
    jobTitle: 'Mobile carer',
    employer: 'Donaupflege GmbH',
    workPhone: '+43 1 5550104',
    startDate: '2020-02-03',
    documents: [],
    growthHistory: [],
    clothingSizes: {},
    // Opted out of being congratulated — the switch exists and the demo should
    // show that it is a real, per-person choice, not a setting nobody uses.
    noCelebrations: true,
    cv: {
      summary: 'Heimhilfe, night and weekend rounds.',
      languages: ['German (native)'],
      skills: ['Personal care', 'Night rounds', 'Manual handling'],
    },
  },
  {
    id: 'demo-biz-contractor',
    name: 'Ruth Ferreira',
    role: 'Contractor',
    avatarColor: 'bg-ink-400',
    jobTitle: 'Bookkeeper (external)',
    employer: 'Ferreira Buchhaltung e.U.',
    workPhone: '+43 1 5550188',
    startDate: '2023-01-09',
    documents: [],
    growthHistory: [],
    clothingSizes: {},
    cv: { summary: 'External bookkeeper, in on Tuesdays. Not on the payroll.' },
  },
];

export const DEMO_BUSINESS_EVENTS: CalendarEvent[] = [
  { id: 'demo-be1', title: 'Team meeting — roster for next month', date: iso(3), time: '08:30', category: 'Appointment', remindMe: true, memberIds: ['demo-biz-owner', 'demo-biz-manager'] },
  { id: 'demo-be2', title: "Amina's first-aid refresher expires", date: iso(21), category: 'Other', remindMe: true, memberIds: ['demo-biz-carer-1'] },
  { id: 'demo-be3', title: 'UVA / ÖGK monthly filing due', date: iso(9), category: 'Other', remindMe: true, memberIds: [] },
  { id: 'demo-be4', title: 'Tom — 5 years with Donaupflege', date: iso(21), category: 'Other', remindMe: true, memberIds: ['demo-biz-manager'] },
  { id: 'demo-be5', title: 'Annual fire-safety walkthrough (Praterstraße)', date: iso(34), time: '14:00', category: 'Other', remindMe: true, memberIds: [] },
];

export const DEMO_BUSINESS_CONTACTS: ContactEntry[] = [
  { id: 'demo-bc1', name: 'Steuerberatung Hofer & Partner', relation: 'Accountant', phone: '+43 1 5552200' },
  { id: 'demo-bc2', name: 'WKO Wien — Gesundheitsberufe', relation: 'Chamber advisor', phone: '+43 5 90900' },
  { id: 'demo-bc3', name: 'Arbeitsmedizin Zentrum Nord', relation: 'Occupational health', phone: '+43 1 5553311' },
  { id: 'demo-bc4', name: 'Hausverwaltung Praterstraße', relation: 'Landlord / building', phone: '+43 1 5554422' },
];

/**
 * Which KIND of demo space is being shown.
 *
 * `?demo=1` (or any other value) keeps the original family demo, so every link
 * already out there is unchanged. `?demo=business` opens the same app as a
 * business space, which is the only way to see the renames, the hidden
 * sections and the CV tab without an account.
 */
/**
 * Which side of the business boundary the demo is standing on.
 *
 * The demo has no account, so FamilyContext resolves `role: null` for it and
 * every `isAdmin` check answers false. That is not a neutral default in a
 * BUSINESS space: v330 made a colleague's record an HR file, so a non-admin
 * viewer sees the "you can see your own record" notice, no "add a team
 * member" button, and no Money or Insurance section. A prospect evaluating
 * the business bundle is an OWNER, and was being shown the employee's view of
 * a company they own.
 *
 * So a business demo defaults to owner, and `?demo=business&as=employee`
 * shows the other side deliberately — which is worth keeping, because the
 * employee view is the newest and least-walked surface in the app.
 *
 * Family demos keep answering false, exactly as before.
 */
export function demoIsOwner(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('demo') !== 'business') return false;
  return q.get('as') !== 'employee';
}

export function demoSpaceType(): 'family' | 'business' {
  if (typeof window === 'undefined') return 'family';
  const v = new URLSearchParams(window.location.search).get('demo');
  return v === 'business' ? 'business' : 'family';
}
