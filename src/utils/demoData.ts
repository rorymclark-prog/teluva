import { FamilyMember, CalendarEvent } from '../types';

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
    avatarColor: 'bg-rosa-500',
    clothingSizes: { tops: 'M', bottoms: '38', shoes: '39', outerwear: 'M', notes: 'Prefers natural fabrics', lastUpdated: iso(-12) },
    documents: [],
    growthHistory: [],
    favorites: [
      { id: 'demo-fav-1', title: 'Garden herbs', category: 'Hobbies & Sports', imageUrl: '', notes: 'Basil over everything', addedAt: iso(-40) },
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
  { id: 'demo-e1', title: "Mia's school play", date: iso(6), time: '16:00', category: 'School', remindMe: true, memberIds: ['demo-mia'] },
  { id: 'demo-e2', title: 'Pediatrician — Ben', date: iso(12), time: '09:30', category: 'Appointment', remindMe: true, memberIds: ['demo-ben'] },
  { id: 'demo-e3', title: 'Renew Papa passport', date: iso(30), category: 'Travel', remindMe: true, memberIds: ['demo-papa'] },
];

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('demo');
}
