import assert from 'node:assert/strict';
import type { CalendarEvent, FamilyMember, VaultDocument } from '../types';
import type { AiEdit } from '../components/AIChatbot';
import { applyTripAttachEdits, hasTripAttachEdits } from './aiApply';

// The code behind the promise. The assistant once CLAIMED "I have now attached
// it to the travel pack" with no edit kind to do it — a promise with no code
// behind it. These tests pin the resolution rules that make trip_attach honest:
// everything resolves by NAME (doc, trip, member), and anything unresolvable
// lands in `notes` instead of silently vanishing.

const NOW = new Date('2026-08-24T12:00:00');

const doc = (id: string, name: string, memberId?: string): VaultDocument =>
  ({ id, name, category: 'Travel', memberId } as unknown as VaultDocument);

const trip = (id: string, title: string, date: string, endDate?: string, destination?: string): CalendarEvent =>
  ({ id, title, date, endDate, destination, category: 'Travel', remindMe: false } as CalendarEvent);

const ben = { id: 'm-ben', name: 'Ben', role: 'Child', birthdate: '2012-01-01' } as unknown as FamilyMember;
const rory = { id: 'm-rory', name: 'Rory', role: 'Parent', birthdate: '1985-01-01' } as unknown as FamilyMember;
const MEMBERS = [ben, rory];

const VAULT: VaultDocument[] = [
  doc('d-consent', 'Parental Consent Affidavit - Ben SA Trip Aug-Sep 2026', 'm-ben'),
  doc('d-insurance', 'Erste Bank & Sparkasse Travel Insurance Policy (Donau)'),
  doc('d-bc', "Ben's Apostilled Birth Certificate", 'm-ben'),
];

const attach = (document: string, extra: Partial<{ trip: string; role: string; member: string }> = {}): AiEdit =>
  ({ kind: 'trip_attach', document, ...extra } as AiEdit);

// --- hasTripAttachEdits ------------------------------------------------------
assert.equal(hasTripAttachEdits([attach('x')]), true);
assert.equal(hasTripAttachEdits([{ kind: 'calendar_event', title: 't', date: '2026-01-01' } as unknown as AiEdit]), false);

// --- 1. Happy path: exact name, no trip named → current-or-next Travel event
{
  const events = [
    trip('t-past', 'Old Lisbon trip', '2026-01-04', '2026-01-15'),
    trip('t-sa', 'Ben & Leo return from South Africa', '2026-08-22', '2026-09-12', 'South Africa'),
    trip('t-later', 'Christmas in Vienna', '2026-12-20', '2026-12-27'),
  ];
  const res = applyTripAttachEdits(events, [attach('Erste Bank & Sparkasse Travel Insurance Policy (Donau)', { role: 'insurance' })], MEMBERS, VAULT, NOW);
  assert.equal(res.notes.length, 0);
  assert.deepEqual(res.attached, ['"Erste Bank & Sparkasse Travel Insurance Policy (Donau)" → Ben & Leo return from South Africa']);
  const sa = res.events.find(e => e.id === 't-sa')!;
  assert.deepEqual(sa.tripDocs, [{ id: 'd-insurance', role: 'insurance' }]);
  // The other trips are untouched — and untouched means SAME reference.
  assert.equal(res.events.find(e => e.id === 't-later'), events[2]);
}

// --- 2. The ACTIVE trip wins over a later one (endDate >= today keeps it current)
{
  const events = [
    trip('t-sa', 'SA trip', '2026-08-22', '2026-09-12'), // departed but not returned — ACTIVE today (2026-08-24)
    trip('t-later', 'Christmas', '2026-12-20', '2026-12-27'),
  ];
  const res = applyTripAttachEdits(events, [attach("Ben's Apostilled Birth Certificate")], MEMBERS, VAULT, NOW);
  assert.equal(res.events.find(e => e.id === 't-sa')!.tripDocs?.length, 1);
  assert.equal(res.events.find(e => e.id === 't-later')!.tripDocs, undefined);
}

// --- 3. An explicitly named trip beats the next-upcoming default (by title OR destination)
{
  const events = [
    trip('t-sa', 'SA trip', '2026-08-22', '2026-09-12'),
    trip('t-lisbon', 'Autumn break', '2026-10-04', '2026-10-15', 'Lisbon, Portugal'),
  ];
  const res = applyTripAttachEdits(events, [attach('Erste Bank', { trip: 'lisbon' })], MEMBERS, VAULT, NOW);
  assert.equal(res.events.find(e => e.id === 't-lisbon')!.tripDocs?.length, 1);
  assert.equal(res.events.find(e => e.id === 't-sa')!.tripDocs, undefined);
}

// --- 4. Doc-name resolution ladder: startsWith, includes, and the REVERSE match
//        (model says a longer phrase than the stored name)
{
  const events = [trip('t-sa', 'SA trip', '2026-08-22', '2026-09-12')];
  for (const q of [
    'parental consent affidavit', // startsWith (ci)
    'Consent Affidavit', // includes
    'the Parental Consent Affidavit - Ben SA Trip Aug-Sep 2026 that we scanned', // reverse: query contains stored name
  ]) {
    const res = applyTripAttachEdits(events, [attach(q)], MEMBERS, VAULT, NOW);
    assert.equal(res.notes.length, 0, `"${q}" should resolve`);
    assert.equal(res.events[0].tripDocs?.[0]?.id, 'd-consent', `"${q}" resolved to the consent doc`);
  }
}

// --- 5. Role fallback via suggestTripRole when the model omits/invents a role;
//        personal roles pick up memberId from the DOC when no member is named
{
  const events = [trip('t-sa', 'SA trip', '2026-08-22', '2026-09-12')];
  const res = applyTripAttachEdits(events, [attach("Ben's Apostilled Birth Certificate", { role: 'not-a-role' })], MEMBERS, VAULT, NOW);
  assert.deepEqual(res.events[0].tripDocs, [{ id: 'd-bc', role: 'birthCertificate', memberId: 'm-ben' }]);
}

// --- 6. A named member overrides the doc's own link; non-personal roles carry NO memberId
{
  const events = [trip('t-sa', 'SA trip', '2026-08-22', '2026-09-12')];
  const res = applyTripAttachEdits(events, [
    attach('Parental Consent Affidavit', { role: 'consent', member: 'Rory' }),
    attach('Erste Bank', { role: 'insurance', member: 'Rory' }),
  ], MEMBERS, VAULT, NOW);
  const refs = res.events[0].tripDocs!;
  assert.deepEqual(refs[0], { id: 'd-consent', role: 'consent', memberId: 'm-rory' });
  assert.deepEqual(refs[1], { id: 'd-insurance', role: 'insurance' }); // member ignored: insurance is a trip-wide paper
}

// --- 7. Attach beats hide: a doc the user removed from the pack comes back when
//        they ask for it BY NAME — and the empty hidden list is DELETED, never
//        left as an explicit-undefined key (Firestore rejects those).
{
  const hiddenTrip = { ...trip('t-sa', 'SA trip', '2026-08-22', '2026-09-12'), tripDocsHidden: ['d-bc'] };
  const res = applyTripAttachEdits([hiddenTrip], [attach("Ben's Apostilled Birth Certificate")], MEMBERS, VAULT, NOW);
  assert.equal(res.events[0].tripDocsHidden, undefined);
  assert.equal('tripDocsHidden' in res.events[0], false, 'key deleted, not set to undefined');
  assert.equal(res.events[0].tripDocs?.[0]?.id, 'd-bc');
}

// --- 8. Dedupe: attaching an identical ref twice never doubles it
{
  const events = [trip('t-sa', 'SA trip', '2026-08-22', '2026-09-12')];
  const once = applyTripAttachEdits(events, [attach('Erste Bank', { role: 'insurance' })], MEMBERS, VAULT, NOW);
  const twice = applyTripAttachEdits(once.events, [attach('Erste Bank', { role: 'insurance' })], MEMBERS, VAULT, NOW);
  assert.equal(twice.events[0].tripDocs?.length, 1);
  // Still reported as attached — idempotent success, not a silent failure.
  assert.equal(twice.attached.length, 1);
}

// --- 9. Misses land in notes, never silently: unknown doc, and no live trip
{
  const events = [trip('t-past', 'Old trip', '2026-01-04', '2026-01-15')];
  const res = applyTripAttachEdits(events, [
    attach('Some Paper Nobody Scanned'),
    attach('Erste Bank'),
  ], MEMBERS, VAULT, NOW);
  assert.equal(res.attached.length, 0);
  assert.equal(res.notes.length, 2);
  assert.match(res.notes[0], /no document with that name/);
  assert.match(res.notes[1], /no current or upcoming trip/);
  // Nothing changed — same array contents.
  assert.equal(res.events[0], events[0]);
}

// --- 10. A trip with NO endDate still counts as current on its own day
{
  const events = [trip('t-day', 'Day trip to Bratislava', '2026-08-24')];
  const res = applyTripAttachEdits(events, [attach('Erste Bank')], MEMBERS, VAULT, NOW);
  assert.equal(res.events[0].tripDocs?.length, 1);
}

console.log('aiTripAttach.test.ts: all assertions passed');
