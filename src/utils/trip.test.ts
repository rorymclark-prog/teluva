import assert from 'node:assert/strict';
import {
  buildLostDocumentsBrief,
  buildTripChecklist,
  buildTripGlance,
  buildTrips,
  currentTrips,
  docsAwaitingFacts,
  KEY_FACTS_VERSION,
  keyFactsCurrent,
  missingRequired,
  moveTripDoc,
  needsConsentLetter,
  suggestTripRole,
  tripsForMember,
} from './trip';
import type { CalendarEvent, FamilyMember, VaultDocument } from '../types';

const NOW = new Date('2026-09-01T12:00:00');

function day(offset: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function event(over: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'date'>): CalendarEvent {
  return { title: 'Trip', category: 'Travel', remindMe: false, ...over } as CalendarEvent;
}

const ben = {
  id: 'ben',
  name: 'Ben',
  role: 'Child',
  avatarColor: 'sage',
  birthdate: '2010-05-04', // 16 on the test dates
  passports: [{ id: 'p1', country: 'South Africa', number: 'A01234567', expiryDate: '2029-01-01', issueDate: '2019-01-01' }],
  travel: {
    travelInsuranceProvider: 'Europäische',
    travelInsuranceNumber: 'POL-99',
    travelInsuranceEmergencyNumber: '+43 1 317 25 00',
    emergencyTravelContact: 'Rory +43 660 000',
    visas: [{ id: 'v1', country: 'Portugal', number: 'V-7', expiryDate: '2027-01-01' }],
  },
} as unknown as FamilyMember;

const adult = { ...ben, id: 'rory', name: 'Rory', birthdate: '1985-01-01', role: 'Parent' } as FamilyMember;

const vaultDocs: VaultDocument[] = [
  { id: 'd-ins', name: 'Travel insurance policy.pdf', category: 'Travel' },
  { id: 'd-tkt', name: 'Lisbon flights.pdf', category: 'Travel' },
  { id: 'd-consent', name: 'Consent letter signed.pdf', category: 'Travel' },
] as unknown as VaultDocument[];

// --- buildTrips -----------------------------------------------------------

{
  const trips = buildTrips([
    event({ id: 'past', date: day(-30), endDate: day(-20) }),
    event({ id: 'active', date: day(-2), endDate: day(5) }),
    event({ id: 'soon', date: day(3) }),
    event({ id: 'far', date: day(200) }),
    event({ id: 'nottravel', date: day(1), category: 'Appointment' }),
  ], NOW);

  assert.equal(trips.length, 4, 'non-Travel events are not trips');
  assert.deepEqual(trips.map(t => t.id), ['active', 'soon', 'far', 'past'], 'active first, then soonest upcoming, then past');
  assert.equal(trips[0].status, 'active');
  assert.equal(trips[1].status, 'upcoming');
  assert.equal(trips[3].status, 'past');
}

{
  // A Travel event saved before endDate existed must still be a usable trip.
  const [trip] = buildTrips([event({ id: 'legacy', date: day(0) })], NOW);
  assert.equal(trip.endDate, trip.startDate, 'missing endDate collapses to the start date');
  assert.equal(trip.status, 'active', 'a day trip today is active, not past');
  assert.equal(trip.lengthDays, 1);
  assert.equal(trip.daysUntilStart, 0);
}

{
  // A broken end date (before the start) must not silently drop the trip.
  const [trip] = buildTrips([event({ id: 'broken', date: day(2), endDate: day(-5) })], NOW);
  assert.equal(trip.endDate, trip.startDate, 'an end before the start collapses rather than vanishing');
  assert.equal(trip.status, 'upcoming');
}

{
  const trips = buildTrips([
    event({ id: 'active', date: day(-1), endDate: day(2) }),
    event({ id: 'soon', date: day(10) }),
    event({ id: 'far', date: day(90) }),
  ], NOW);
  assert.deepEqual(currentTrips(trips).map(t => t.id), ['active', 'soon'], 'far-off trips are not "current"');
}

// --- tripsForMember -------------------------------------------------------

{
  const trips = buildTrips([
    event({ id: 'ben-only', date: day(1), memberIds: ['ben'] }),
    event({ id: 'everyone', date: day(2) }),
    event({ id: 'someone-else', date: day(3), memberIds: ['other'] }),
  ], NOW);

  assert.deepEqual(tripsForMember(trips, 'ben').map(t => t.id), ['ben-only', 'everyone'],
    'an untagged trip belongs to everyone; a trip tagged to someone else does not');
  assert.deepEqual(tripsForMember(trips, 'other').map(t => t.id), ['everyone', 'someone-else']);
}

// --- needsConsentLetter ---------------------------------------------------

assert.equal(needsConsentLetter(ben, '2026-09-04'), true, '16-year-old needs one');
assert.equal(needsConsentLetter(adult, '2026-09-04'), false, 'an adult does not');
assert.equal(needsConsentLetter({ birthdate: '2008-09-05' }, '2026-09-04'), true,
  'turns 18 the DAY AFTER departure — still a minor when they travel');
assert.equal(needsConsentLetter({ birthdate: '2008-09-04' }, '2026-09-04'), false,
  'turns 18 ON the day of departure');
assert.equal(needsConsentLetter({ birthdate: undefined }, '2026-09-04'), false,
  'no birthdate cannot be guessed at');

// --- buildTripChecklist ---------------------------------------------------

{
  const [trip] = buildTrips([event({
    id: 't', date: day(3), endDate: day(14), memberIds: ['ben'], destination: 'Lisbon, Portugal',
    tripDocs: [
      { id: 'd-ins', role: 'insurance' },
      { id: 'd-tkt', role: 'ticket', memberId: 'ben' },
    ],
  })], NOW);

  const rows = buildTripChecklist(trip, ben, vaultDocs);
  const byKey = new Map(rows.map(r => [r.key, r]));

  assert.equal(byKey.get('passport-0')?.present, true);
  assert.equal(byKey.get('passport-0')?.detail, 'A01234567', 'the number is what replaces a lost passport');

  assert.equal(byKey.get('insurance-doc')?.present, true, 'a party-wide doc (no memberId) covers this member');
  assert.equal(byKey.get('insurance-doc')?.detail, 'Travel insurance policy.pdf', 'resolved to the real vault name');
  assert.equal(byKey.get('tickets')?.present, true);
  assert.equal(byKey.get('accommodation')?.present, false, 'nothing attached for where he is staying');

  const consent = byKey.get('consent');
  assert.ok(consent, 'a 16-year-old gets a consent row');
  assert.equal(consent?.present, false);
  assert.equal(consent?.required, true);

  const missing = missingRequired(rows).map(r => r.key);
  assert.deepEqual(missing, ['accommodation', 'consent', 'birthCertificate'],
    'exactly the required gaps, nothing else — a minor with no saved birth certificate has that gap too');
}

{
  // The adult on the same trip gets no consent row — and no birth-certificate
  // row either: both exist only for a travelling minor.
  const [trip] = buildTrips([event({ id: 't', date: day(3), memberIds: ['rory'] })], NOW);
  const rows = buildTripChecklist(trip, adult, vaultDocs);
  assert.equal(rows.some(r => r.key === 'consent'), false, 'no consent row for an adult');
  assert.equal(rows.some(r => r.key === 'birthCertificate'), false, 'no birth-certificate row for an adult');
}

{
  // "I need a place for his birth certificate" — a minor gets a required row,
  // and EVERY saved certificate auto-pulls onto it (the original AND the
  // apostilled copy are different answers at a border, not duplicates).
  const withCerts: VaultDocument[] = [
    ...vaultDocs,
    { id: 'd-bc-apo', name: "Ben's Apostilled Birth Certificate", category: 'Travel', memberId: 'ben', downloadUrl: 'https://files/bc-apo.pdf' },
    { id: 'd-bc', name: 'Ben Clark Birth Certificate', category: 'Identity', memberId: 'ben', downloadUrl: 'https://files/bc.pdf' },
    { id: 'd-bc-other', name: 'Birth certificate', category: 'Identity', memberId: 'someone-else', downloadUrl: 'https://files/other.pdf' },
  ] as unknown as VaultDocument[];
  const [trip] = buildTrips([event({ id: 't', date: day(3), endDate: day(10), memberIds: ['ben'] })], NOW);
  const row = buildTripChecklist(trip, ben, withCerts).find(r => r.key === 'birthCertificate');
  assert.ok(row, 'a travelling minor gets a birth-certificate row');
  assert.equal(row.required, true);
  assert.equal(row.present, true, 'saved certificates satisfy the row without being attached to the trip');
  assert.deepEqual(row.docIds, ['d-bc-apo', 'd-bc'],
    "BOTH of the member's saved certificates back the row; another member's never leaks in");
}

{
  // "i mainly as a default want to delete it only from the travel pack" — a
  // hidden id stops being auto-pulled on THIS trip (any row), but an explicit
  // attachment of the very same doc always shows: attach beats hide.
  const withCerts: VaultDocument[] = [
    ...vaultDocs,
    { id: 'd-bc-apo', name: "Ben's Apostilled Birth Certificate", category: 'Travel', memberId: 'ben', downloadUrl: 'https://files/bc-apo.pdf' },
    { id: 'd-bc', name: 'Ben Clark Birth Certificate', category: 'Identity', memberId: 'ben', downloadUrl: 'https://files/bc.pdf' },
  ] as unknown as VaultDocument[];

  const [hiddenTrip] = buildTrips([event({
    id: 't', date: day(3), endDate: day(10), memberIds: ['ben'],
    tripDocsHidden: ['d-bc-apo'],
  })], NOW);
  const hiddenRow = buildTripChecklist(hiddenTrip, ben, withCerts).find(r => r.key === 'birthCertificate');
  assert.deepEqual(hiddenRow?.docIds, ['d-bc'], 'a hidden doc is not auto-pulled; the other still is');

  const [attachedTrip] = buildTrips([event({
    id: 't2', date: day(3), endDate: day(10), memberIds: ['ben'],
    tripDocsHidden: ['d-bc-apo'],
    tripDocs: [{ id: 'd-bc-apo', role: 'birthCertificate', memberId: 'ben' }],
  })], NOW);
  const attachedRow = buildTripChecklist(attachedTrip, ben, withCerts).find(r => r.key === 'birthCertificate');
  assert.ok(attachedRow?.docIds.includes('d-bc-apo'),
    'an EXPLICIT attachment shows even while the id sits on the hidden list');

  // Hiding also silences the passport/visa auto-pull — one list, every row.
  const withCard: VaultDocument[] = [
    ...vaultDocs,
    { id: 'd-res', name: "Ben's Temporary Residence Card", category: 'Identity', memberId: 'ben', downloadUrl: 'https://x/res.jpg' } as unknown as VaultDocument,
  ];
  const [visaHidden] = buildTrips([event({
    id: 't3', date: day(3), endDate: day(10), memberIds: ['ben'], tripDocsHidden: ['d-res'],
  })], NOW);
  const visaRow = buildTripChecklist(visaHidden, ben, withCard).find(r => r.key === 'visa-v1');
  assert.deepEqual(visaRow?.docIds, [], 'a hidden residence card leaves the visa row empty again');
}

{
  // A document tagged to ANOTHER member must not count for this one.
  const [trip] = buildTrips([event({
    id: 't', date: day(3), memberIds: ['ben', 'rory'],
    tripDocs: [{ id: 'd-consent', role: 'consent', memberId: 'rory' }],
  })], NOW);
  const rows = buildTripChecklist(trip, ben, vaultDocs);
  assert.equal(rows.find(r => r.key === 'consent')?.present, false,
    "someone else's consent letter is not Ben's consent letter");
}

{
  // No passport on file is a required gap, not a crash.
  const [trip] = buildTrips([event({ id: 't', date: day(3) })], NOW);
  const bare = { id: 'x', name: 'X', role: 'Child', birthdate: '2012-01-01' } as unknown as FamilyMember;
  const rows = buildTripChecklist(trip, bare, []);
  assert.equal(rows.find(r => r.key === 'passport')?.present, false);
  assert.ok(missingRequired(rows).some(r => r.key === 'passport'));
}

{
  // The legacy single passport field and the folded array must not double up.
  const [trip] = buildTrips([event({ id: 't', date: day(3) })], NOW);
  const folded = {
    ...ben,
    passport: { passportNumber: 'A01234567', issuingCountry: 'South Africa', expiryDate: '2029-01-01' },
  } as unknown as FamilyMember;
  const rows = buildTripChecklist(trip, folded, []);
  assert.equal(rows.filter(r => r.role === 'passport').length, 1, 'folded legacy passport is not listed twice');
}

// --- passport scan resolution (the ladder shared with the IDs tab) --------

{
  // Rung 1: the explicit photoDocId link wins.
  const linked = {
    ...ben,
    passports: [{ id: 'p1', country: 'South Africa', number: 'A01234567', photoDocId: 'doc-scan' }],
    documents: [{ id: 'doc-scan', name: 'Some scan', category: 'ID', fileType: 'image/png', fileName: 's.png', fileSize: 1, uploadedAt: '2026-01-01', fileData: 'data:image/png;base64,x' }],
  } as unknown as FamilyMember;
  const [trip] = buildTrips([event({ id: 't', date: day(3), memberIds: ['ben'] })], NOW);
  const row = buildTripChecklist(trip, linked, []).find(r => r.key === 'passport-0');
  assert.deepEqual(row?.docIds, ['doc-scan'], 'explicitly linked scan reaches the pack');
}

{
  // Rung 2: no photoDocId — a member document NAMED like the passport is
  // found by the same heuristic the IDs tab uses. This is the "we have his
  // passport saved, why isn't the pack showing it" case.
  const unlinked = {
    ...ben,
    documents: [{ id: 'doc-heur', name: 'Ben SA passport', category: 'ID', fileType: 'image/jpeg', fileName: 'p.jpg', fileSize: 1, uploadedAt: '2026-01-01', fileData: 'data:image/jpeg;base64,x' }],
  } as unknown as FamilyMember;
  const [trip] = buildTrips([event({ id: 't', date: day(3), memberIds: ['ben'] })], NOW);
  const row = buildTripChecklist(trip, unlinked, []).find(r => r.key === 'passport-0');
  assert.deepEqual(row?.docIds, ['doc-heur'], 'a saved-but-unlinked scan is auto-pulled by name');
}

{
  // Rung 3: the scan lives in the shared VAULT, linked to this member.
  // A vault doc linked to a DIFFERENT member must never leak in.
  const vault = [
    { id: 'v-ben', name: 'South Africa passport scan', category: 'Identity', memberId: 'ben', fileType: 'image/png', fileName: 'k.png', fileSize: 1, uploadedAt: '2026-01-01', downloadUrl: 'https://x/k.png' },
    { id: 'v-other', name: 'South Africa passport scan', category: 'Identity', memberId: 'someone-else', fileType: 'image/png', fileName: 'o.png', fileSize: 1, uploadedAt: '2026-01-01', downloadUrl: 'https://x/o.png' },
  ] as unknown as VaultDocument[];
  const [trip] = buildTrips([event({ id: 't', date: day(3), memberIds: ['ben'] })], NOW);
  const row = buildTripChecklist(trip, ben, vault).find(r => r.key === 'passport-0');
  assert.deepEqual(row?.docIds, ['v-ben'], "the member's own vault scan resolves; another member's never does");
}

{
  // Dedupe: the resolved scan is ALSO attached to the trip as a passport
  // copy — one file, one card.
  const linked = {
    ...ben,
    passports: [{ id: 'p1', country: 'South Africa', number: 'A01234567', photoDocId: 'doc-scan' }],
    documents: [{ id: 'doc-scan', name: 'Some scan', category: 'ID', fileType: 'image/png', fileName: 's.png', fileSize: 1, uploadedAt: '2026-01-01', fileData: 'data:image/png;base64,x' }],
  } as unknown as FamilyMember;
  const [trip] = buildTrips([event({
    id: 't', date: day(3), memberIds: ['ben'],
    tripDocs: [{ id: 'doc-scan', role: 'passportCopy', memberId: 'ben' }],
  })], NOW);
  const row = buildTripChecklist(trip, linked, []).find(r => r.key === 'passport-0');
  assert.deepEqual(row?.docIds, ['doc-scan'], 'scan + identical trip attachment render once, not twice');
}

// --- buildLostDocumentsBrief ---------------------------------------------

{
  const [trip] = buildTrips([event({ id: 't', date: day(-1), endDate: day(6), destinationCountry: 'ZA' })], NOW);
  const brief = buildLostDocumentsBrief(trip, ben);

  assert.equal(brief.passports.length, 1);
  assert.equal(brief.passports[0].number, 'A01234567');
  assert.equal(brief.passports[0].issueDate, '2019-01-01', 'issue date matters for a replacement');
  assert.equal(brief.insuranceEmergencyNumber, '+43 1 317 25 00');
  assert.equal(brief.homeContact, 'Rory +43 660 000');
  assert.equal(brief.destinationCountry, 'ZA');
  assert.equal(brief.steps[0].startsWith('Report it to the local police'), true,
    'the police report comes first — the embassy asks for it');
  assert.equal(brief.steps.length, 4);
}

{
  // An unknown destination must yield NO country, never a guess.
  const [trip] = buildTrips([event({ id: 't', date: day(0), destination: 'Somewhere' })], NOW);
  const brief = buildLostDocumentsBrief(trip, ben);
  assert.equal(brief.destinationCountry, undefined, 'never invent a country for emergency numbers');
}

// --- The at-a-glance card -------------------------------------------------

{
  const withFacts: VaultDocument[] = [
    ...vaultDocs,
    {
      id: 'd-pol', name: 'Allianz policy', category: 'Travel',
      keyFacts: [
        { label: '24/7 emergency line', value: '+43 (0)5 0330 - 72222', verified: true },
        { label: '24/7 emergency line', value: '05 0330 - 72222', verified: true }, // same line, local dress
        { label: 'Reference to quote', value: 'KL/889-771', verified: false },
        { label: 'Provider / issuer', value: 'Allianz', verified: true },
        { label: 'Provider / issuer', value: 'Allianz Partners GmbH', verified: true },
        { label: 'Address', value: 'Schottenring 15, 1010 Wien', verified: true },
        { label: 'Phone number', value: '+43 1 000 00 00', verified: true },
      ],
      keyFactsAt: '2026-08-24',
      keyFactsVersion: KEY_FACTS_VERSION,
    } as unknown as VaultDocument,
    {
      id: 'd-con', name: 'Consent affidavit', category: 'Travel',
      keyFacts: [
        { label: 'Phone number', value: '+27 84 555 0142', who: 'Mother', verified: false },
        { label: 'Passport or ID number', value: 'A01234567', verified: false }, // quotes the typed number
        { label: 'Name on the document', value: 'BEN CLARK', verified: false },
      ],
      keyFactsAt: '2026-08-24',
      keyFactsVersion: KEY_FACTS_VERSION,
    } as unknown as VaultDocument,
  ];
  const [trip] = buildTrips([event({
    id: 't', date: day(3), endDate: day(10), memberIds: ['ben'],
    tripDocs: [
      { id: 'd-pol', role: 'insurance' },
      { id: 'd-tkt', role: 'ticket' },                    // attached but no facts yet
      { id: 'd-pol', role: 'other' },                     // same doc filed twice → facts once
      { id: 'd-con', role: 'consent', memberId: 'ben' }, // PERSONAL paper
    ],
  })], NOW);

  const glance = buildTripGlance(trip, [ben], withFacts);

  // Person first: typed-in numbers via the SAME checklist derivations the rows use.
  const benSection = glance.find((s) => s.key === 'member-ben');
  assert.ok(benSection, 'a traveller with typed-in details gets a section');
  assert.ok(benSection.facts.some((f) => f.value === 'A01234567'), 'passport number surfaces');
  assert.ok(benSection.facts.some((f) => f.value === 'V-7'), 'visa number surfaces');

  // A personal document's facts fold into the OWNER's section, attributed.
  assert.ok(benSection.facts.some((f) => f.label === 'Phone number — Mother' && f.value === '+27 84 555 0142'),
    "the consent letter's number lands under Ben and says WHOSE it is");
  assert.equal(benSection.facts.filter((f) => f.value === 'A01234567').length, 1,
    'the affidavit quoting the typed passport number adds nothing');
  assert.ok(!benSection.facts.some((f) => f.label.startsWith('Name on the document')),
    'the section title already names the person');

  // Insurance: typed detail + policy facts pooled into ONE section.
  const ins = glance.find((s) => s.key === 'insurance');
  assert.ok(ins, 'insurance gets one pooled section');
  assert.ok(ins.facts.some((f) => f.label === '24/7 emergency line' && f.value === '+43 1 317 25 00'),
    'typed-in insurance detail surfaces');
  assert.ok(ins.facts.some((f) => f.label === 'Provider / issuer' && f.value === 'Europäische'),
    'the typed provider wins over the one read off the policy');
  assert.ok(ins.facts.some((f) => f.label === 'Policy or booking number' && f.value === 'POL-99'),
    'the typed policy number gets its own labelled row');
  assert.ok(!ins.facts.some((f) => f.value.includes(' · ')),
    'the glance shows facts, never the checklist row\'s joined display string');
  assert.equal(ins.facts.filter((f) => f.value === '+43 (0)5 0330 - 72222').length, 1,
    'the 24/7 line shows once though the doc is filed under two roles');
  assert.equal(ins.facts.filter((f) => f.label === 'Provider / issuer').length, 1,
    'distributor AND underwriter is detail, not glance');
  assert.ok(!ins.facts.some((f) => f.label === 'Address'),
    'addresses belong to the document viewer, not the glance');
  assert.ok(!ins.facts.some((f) => f.value === '+43 1 000 00 00'),
    'an unattributed office number loses to the 24/7 line');
  const ref = ins.facts.find((f) => f.value === 'KL/889-771');
  assert.ok(ref, 'the reference to quote survives');
  assert.equal(ref.verified, false, 'an OCR-read fact carries its flag');

  // Phone dedupe is digit-aware — the live card showed the insurer's 24/7
  // line twice, once with the +43 and once without. Same trailing digits,
  // one row.
  assert.equal(ins.facts.filter((f) => f.value.includes('0330')).length, 1,
    'a number never repeats in another dress');

  // A doc with no facts contributes nothing — and IS awaiting extraction.
  assert.ok(!glance.some((s) => s.key === 'bookings'));
  assert.deepEqual(docsAwaitingFacts(trip, withFacts).map((d) => d.id), ['d-tkt'],
    'only the unread attachment awaits; the extracted ones do not');
}

{
  // Reported from the phone: the insurance card printed the insurer and the
  // assistance line TWICE — once inside the typed "Erste Bank und Sparkasse ·
  // 05 0330 - 72222" row and once as separate rows off the policy document.
  // Nothing was typed in: the checklist row had filled ITSELF from the
  // document, joined the pieces for display, and the glance pushed that joined
  // string as one more fact. Value-dedupe could never match a composite.
  const noTyped = { ...ben, id: 'nt', name: 'Nomsa', travel: { visas: [] } } as unknown as FamilyMember;
  const policy = {
    id: 'd-erste', name: 'Erste policy', category: 'Travel',
    keyFacts: [
      { label: 'Provider / issuer', value: 'Erste Bank und Sparkasse', verified: true },
      { label: '24/7 emergency line', value: '05 0330 - 72222', verified: true },
    ],
    keyFactsAt: '2026-08-24',
    keyFactsVersion: KEY_FACTS_VERSION,
  } as unknown as VaultDocument;
  const [trip2] = buildTrips([event({
    id: 't2', date: day(3), endDate: day(10), memberIds: ['nt'],
    tripDocs: [{ id: 'd-erste', role: 'insurance' }],
  })], NOW);
  const ins2 = buildTripGlance(trip2, [noTyped], [policy]).find((s) => s.key === 'insurance');
  assert.ok(ins2, 'the pooled insurance section still forms with nothing typed in');
  assert.equal(ins2.facts.filter((f) => f.value.includes('Erste')).length, 1, 'the insurer once');
  assert.equal(ins2.facts.filter((f) => f.value.includes('0330')).length, 1, 'the assistance line once');
  assert.deepEqual(ins2.facts.map((f) => f.label).sort(), ['24/7 emergency line', 'Provider / issuer'],
    'two labelled rows, no run-on duplicate of them');
}

{
  // keyFactsCurrent: ran-and-empty counts as done; replaced bytes do not;
  // neither do facts saved by an older extractor version.
  const V = KEY_FACTS_VERSION;
  assert.equal(keyFactsCurrent({ keyFactsAt: undefined }), false, 'never ran');
  assert.equal(keyFactsCurrent({ keyFactsAt: '2026-08-24', keyFactsVersion: V }), true, 'ran, no hashes to compare');
  assert.equal(keyFactsCurrent({ keyFactsAt: '2026-08-24', keyFactsVersion: V, keyFactsHash: 'aa', contentHash: 'aa' }), true);
  assert.equal(keyFactsCurrent({ keyFactsAt: '2026-08-24', keyFactsVersion: V, keyFactsHash: 'aa', contentHash: 'bb' }), false,
    'a replaced file invalidates last year\'s facts');
  assert.equal(keyFactsCurrent({ keyFactsAt: '2026-08-24', keyFactsHash: 'aa', contentHash: 'aa' }), false,
    'unversioned v1 facts are stale — that extractor mislabelled passport numbers and truncated names');
  assert.equal(keyFactsCurrent({ keyFactsAt: '2026-08-24', keyFactsVersion: V + 1, keyFactsHash: 'aa', contentHash: 'aa' }), true,
    'a NEWER version than this build knows is not stale — never fight a rollout');
}

// --- The visa row auto-pulls a residence card, like the passport row -----

{
  // "Why doesn't his temporary residence card show here" — a card saved in
  // the vault, linked to the member, never attached to the trip. The visa
  // row must find it the same way the passport row finds its scan.
  const withCard: VaultDocument[] = [
    ...vaultDocs,
    {
      id: 'd-res', name: "Ben's Temporary Residence Card", category: 'Identity',
      memberId: 'ben', downloadUrl: 'https://files/res.jpg',
    } as unknown as VaultDocument,
  ];
  const [trip] = buildTrips([event({ id: 't', date: day(3), endDate: day(10), memberIds: ['ben'] })], NOW);
  const rows = buildTripChecklist(trip, ben, withCard);
  const visaRow = rows.find((row) => row.key === 'visa-v1');
  assert.ok(visaRow, 'the visa row exists');
  assert.deepEqual(visaRow.docIds, ['d-res'],
    'the saved residence card backs the visa row without being attached to the trip');
  const passportRow = rows.find((row) => row.role === 'passport');
  assert.ok(passportRow && !passportRow.docIds.includes('d-res'),
    'the residence card answers the visa row only, never the passport row');
}

// --- moveTripDoc: re-filing a mis-attached paper -------------------------

{
  // The reported case: a consent letter picked while the picker was scoped to
  // "Tickets & bookings". Moving it changes ONLY the role — the ref's identity
  // and owner travel with it.
  const docs = [
    { id: 'letter', role: 'ticket' as const, memberId: 'ben' },
    { id: 'flight', role: 'ticket' as const },
  ];
  const moved = moveTripDoc(docs, 'letter', 'ticket', 'consent');
  assert.deepEqual(moved.find((d) => d.id === 'letter'), { id: 'letter', role: 'consent', memberId: 'ben' });
  assert.deepEqual(moved.find((d) => d.id === 'flight'), { id: 'flight', role: 'ticket' }, 'other refs untouched');
  assert.equal(moved.length, 2);
}

{
  // Moving onto an identical existing ref must not duplicate — it collapses to
  // a plain remove of the mis-filed one.
  const docs = [
    { id: 'letter', role: 'ticket' as const },
    { id: 'letter', role: 'consent' as const },
  ];
  const moved = moveTripDoc(docs, 'letter', 'ticket', 'consent');
  assert.deepEqual(moved, [{ id: 'letter', role: 'consent' }]);
}

{
  // A no-op move and a miss both leave the list as it was.
  const docs = [{ id: 'letter', role: 'consent' as const }];
  assert.deepEqual(moveTripDoc(docs, 'letter', 'consent', 'consent'), docs);
  assert.deepEqual(moveTripDoc(docs, 'nope', 'ticket', 'consent'), docs);
}

// --- suggestTripRole: the picker's "belongs elsewhere" hint --------------

{
  assert.equal(suggestTripRole('Parents approval letter.pdf'), 'consent');
  assert.equal(suggestTripRole('Signed travel consent — Ben'), 'consent');
  assert.equal(suggestTripRole('Ben SA passport scan'), 'passportCopy');
  assert.equal(suggestTripRole('Schengen visa 2026'), 'visa');
  assert.equal(suggestTripRole("Ben's Temporary Residence Card"), 'visa',
    'a residence card IS the visa for the border\'s purposes');
  assert.equal(suggestTripRole('Aufenthaltstitel 2026'), 'visa');
  assert.equal(suggestTripRole('Critical Skills work permit'), 'visa');
  assert.equal(suggestTripRole('Signed permission letter'), 'consent',
    '"permission" stays consent — the consent rule wins before the permit rule can see it');
  assert.equal(suggestTripRole("Ben's Apostilled Birth Certificate"), 'birthCertificate');
  assert.equal(suggestTripRole('Geburtsurkunde Ben.pdf'), 'birthCertificate');
  assert.equal(suggestTripRole('Unabridged Birth Certificate (UBC)'), 'birthCertificate');
  assert.equal(suggestTripRole('Allianz travel insurance policy'), 'insurance');
  assert.equal(suggestTripRole('Booking.com hotel confirmation'), 'accommodation');
  assert.equal(suggestTripRole('FlySafair e-ticket JNB-VIE'), 'ticket');
  assert.equal(suggestTripRole('Grandpa 90th photos'), undefined, 'no keyword, no guess');
}

// --- insurance-details row: extracted key facts fill what nobody typed in ---
//
// "theres a emergency number in the brochure i uploaded but the ai didnt pick
// it up" — the row read ONLY member.travel and ignored the facts extracted from
// the attached policy. Typed-in wins; verified doc facts fill the gaps;
// unverified facts never surface; an unread attached policy changes the note
// to point at the Read button instead of claiming nothing is saved.
{
  const trip = buildTrips([event({ id: 'act', date: day(-2), endDate: day(5), tripDocs: [{ id: 'd-pol9', role: 'insurance' }] })], NOW)[0];
  const bare = { id: 'nofields', name: 'NoFields', role: 'Parent', birthdate: '1990-01-01' } as unknown as FamilyMember;
  const policy = (facts?: unknown, extractedAt?: string): VaultDocument[] => ([{
    id: 'd-pol9', name: 'Erste travel insurance brochure.pdf', category: 'Travel',
    ...(facts ? { keyFacts: facts } : {}),
    ...(extractedAt ? { keyFactsAt: extractedAt, keyFactsVersion: 3 } : {}),
  }] as unknown as VaultDocument[]);

  // Extracted + verified facts populate detail and flip the note.
  const read = buildTripChecklist(trip, bare, policy([
    { label: 'Provider / issuer', value: 'Erste Bank & Sparkasse' },
    { label: '24/7 emergency line', value: '+43 50 100 12345' },
  ], day(-1))).find(r => r.key === 'insurance-details')!;
  assert.equal(read.present, true, 'provider fact makes the row present');
  assert.equal(read.detail, 'Erste Bank & Sparkasse · +43 50 100 12345');
  assert.match(read.note, /assistance line to call/);

  // Typed-in values WIN over extracted ones.
  const typed = buildTripChecklist(trip, ben, policy([
    { label: 'Provider / issuer', value: 'SomeOther Insurer' },
    { label: '24/7 emergency line', value: '+1 555 000' },
  ], day(-1))).find(r => r.key === 'insurance-details')!;
  assert.equal(typed.detail, 'Europäische · POL-99 · +43 1 317 25 00', 'typed-in beats extracted');

  // An unverified fact (failed the verbatim re-check) never surfaces.
  const unverified = buildTripChecklist(trip, bare, policy([
    { label: '24/7 emergency line', value: '+43 50 100 12345', verified: false },
  ], day(-1))).find(r => r.key === 'insurance-details')!;
  assert.equal(unverified.detail, undefined);

  // Attached but never read → the note points at the Read button.
  const unread = buildTripChecklist(trip, bare, policy()).find(r => r.key === 'insurance-details')!;
  assert.match(unread.note, /Tap “Read” on the attached policy/);

  // No policy attached at all → the plain "not saved" wording, no Read nudge.
  const bareTrip = buildTrips([event({ id: 'act2', date: day(-2), endDate: day(5) })], NOW)[0];
  const none = buildTripChecklist(bareTrip, bare, []).find(r => r.key === 'insurance-details')!;
  assert.match(none.note, /No 24-hour assistance number saved\. It is the number/);
}

console.log('trip.test.ts: all assertions passed');
