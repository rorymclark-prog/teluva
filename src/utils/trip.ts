// Trips — turning a Travel-category calendar event into the folder of papers
// somebody actually has to produce at a check-in desk, a border, or a police
// station in a country where they don't speak the language.
//
// WHY THIS EXISTS, stated plainly, because it shapes every decision below:
// the app already knew four separate things about travel and connected none of
// them — the trip (a Travel CalendarEvent), the typed-in travel fields
// (member.travel), the documents (VaultDocument, category 'Travel'), and the
// checklist (TravelPack.tsx, whose props never included a single document).
// You could have a travel insurance PDF uploaded and a trip in the calendar and
// still have no screen in the app that showed you both at once.
//
// THE LOAD-BEARING CASE is the bad one: the documents are lost or stolen. That
// is not the edge case this module tolerates, it is the case it is designed
// around. When someone's passport is gone, what replaces it is *knowing the
// number* — an emergency travel document is issued off the passport details,
// the police report, and proof of identity, and every one of those is easier to
// obtain if the details are on a phone rather than in the missing document. So
// buildLostDocumentsBrief() is a first-class export, not a footnote, and the
// checklist counts a passport with no scan attached as an incomplete row even
// though the passport itself is perfectly valid.
//
// WHAT THIS MODULE WILL NOT DO: invent an embassy phone number, a consulate
// address, or a local emergency number for a country emergencyNumbers.ts has
// not verified. A confidently wrong number handed to someone in trouble abroad
// is the worst output this feature could produce, so unknown destinations get
// an honest blank and a prompt to fill it in before departure — never a guess.

import type {
  CalendarEvent,
  FamilyMember,
  IdCountry,
  TripDocRef,
  TripDocRole,
  VaultDocument,
} from '../types';
import { toFamilyDoc } from './vaultDoc';
import { findBirthCertificateScans, findPassportScan, findVisaScan } from './passportScan';

const DAY_MS = 86_400_000;

/** How far ahead a trip starts showing up as something to prepare for. */
export const TRIP_PREP_WINDOW_DAYS = 21;

/** How far ahead a trip is promoted to the top of Pulse / Emergency. */
export const TRIP_IMMINENT_DAYS = 7;

export type TripStatus = 'upcoming' | 'active' | 'past';

export interface Trip {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  startDate: string;
  /**
   * YYYY-MM-DD. Always populated: a Travel event saved before endDate existed
   * (or a genuine day trip) resolves to its own start date, so callers never
   * branch on absence.
   */
  endDate: string;
  destination?: string;
  destinationCountry?: IdCountry;
  /** Members tagged as travelling. Empty means "nobody specified". */
  memberIds: string[];
  docs: TripDocRef[];
  /** Doc ids auto-pull must skip for this trip (CalendarEvent.tripDocsHidden). */
  hiddenDocIds: string[];
  notes?: string;
  status: TripStatus;
  /** Negative once departed. 0 on the day of departure. */
  daysUntilStart: number;
  /** Days until the return date. Negative once home. */
  daysUntilEnd: number;
  /** Inclusive of both travel days: a same-day trip is 1. */
  lengthDays: number;
}

function parseDateOnly(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Every Travel-category event, resolved into a Trip.
 *
 * Note this returns PAST trips too, sorted with the most relevant first
 * (active, then soonest upcoming, then most recent past). Filtering is the
 * caller's job because the answers differ: Pulse wants "active or imminent",
 * the trip list wants "everything", and the lost-documents brief has to keep
 * working on the last day of a trip that technically ended yesterday because
 * the traveller's flight home was delayed.
 */
export function buildTrips(events: readonly CalendarEvent[], now: Date = new Date()): Trip[] {
  const today = startOfDay(now);
  const out: Trip[] = [];

  for (const event of events) {
    if (event.category !== 'Travel') continue;
    const start = parseDateOnly(event.date);
    if (!start) continue;

    // A missing or nonsensical end date (before the start) collapses to the
    // start date rather than being dropped — a Travel event with a broken end
    // is still a trip, and silently hiding it would be the worse failure.
    //
    // endDateStr is carried as the ORIGINAL string, never re-derived from the
    // Date. Formatting a local-midnight Date back out via toISOString() shifts
    // it into UTC, which lands on the previous day for every timezone east of
    // Greenwich — Vienna and Johannesburg both — so every trip would have
    // ended a day early. Caught by trip.test.ts; do not "simplify" this back.
    const parsedEnd = parseDateOnly(event.endDate);
    const endValid = !!parsedEnd && parsedEnd.getTime() >= start.getTime();
    const end = endValid ? (parsedEnd as Date) : start;
    const endDateStr = endValid ? (event.endDate as string) : event.date;

    const daysUntilStart = Math.round((start.getTime() - today) / DAY_MS);
    const daysUntilEnd = Math.round((end.getTime() - today) / DAY_MS);
    const status: TripStatus = daysUntilStart > 0 ? 'upcoming' : daysUntilEnd >= 0 ? 'active' : 'past';

    out.push({
      id: event.id,
      title: event.title,
      startDate: event.date,
      endDate: endDateStr,
      destination: event.destination,
      destinationCountry: event.destinationCountry,
      memberIds: event.memberIds ? [...event.memberIds] : [],
      docs: event.tripDocs ? [...event.tripDocs] : [],
      hiddenDocIds: event.tripDocsHidden ? [...event.tripDocsHidden] : [],
      notes: event.description,
      status,
      daysUntilStart,
      daysUntilEnd,
      lengthDays: Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1,
    });
  }

  const rank = (trip: Trip) => (trip.status === 'active' ? 0 : trip.status === 'upcoming' ? 1 : 2);
  return out.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    // Within upcoming: soonest first. Within past: most recent first.
    return a.status === 'past' ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate);
  });
}

/** Trips worth surfacing right now: happening, or close enough to prepare for. */
export function currentTrips(trips: readonly Trip[], windowDays = TRIP_PREP_WINDOW_DAYS): Trip[] {
  return trips.filter((trip) => trip.status === 'active' || (trip.status === 'upcoming' && trip.daysUntilStart <= windowDays));
}

/**
 * Trips a specific person is on.
 *
 * A trip with NO members tagged counts for everyone — that is the common case
 * for a family holiday typed in a hurry, and treating it as "nobody's trip"
 * would hide the pack from the very people it was created for.
 */
export function tripsForMember(trips: readonly Trip[], memberId: string): Trip[] {
  return trips.filter((trip) => trip.memberIds.length === 0 || trip.memberIds.includes(memberId));
}

// --- Filing and re-filing attached papers --------------------------------

/**
 * Change which item a trip attachment is filed under.
 *
 * This exists because mis-filing is one tap away: the attach picker opens
 * scoped to whichever row's button was pressed but lists EVERY vault document,
 * so a parents' consent letter picked while the picker said "Tickets &
 * bookings" lands under tickets — and until this helper the only way back was
 * to find Remove and start over (which is exactly how it was reported:
 * "it saved parent consent letter under tickets and bookings").
 *
 * The memberId travels with the ref unchanged: whose paper it is doesn't
 * change because it was re-filed. If moving would collide with an identical
 * ref already at the destination, the move becomes a plain remove — never a
 * duplicate row.
 */
export function moveTripDoc(
  docs: readonly TripDocRef[],
  docId: string,
  fromRole: TripDocRole,
  toRole: TripDocRole,
): TripDocRef[] {
  const moving = docs.find((d) => d.id === docId && d.role === fromRole);
  if (!moving || fromRole === toRole) return [...docs];
  const rest = docs.filter((d) => !(d.id === docId && d.role === fromRole));
  const collides = rest.some((d) => d.id === docId && d.role === toRole && d.memberId === moving.memberId);
  return collides ? rest : [...rest, { ...moving, role: toRole }];
}

/**
 * Where a document with this name is USUALLY filed — a hint, never a decision.
 *
 * The picker shows this under a document whose name plainly says what it is
 * ("Parents approval letter.pdf") when the picker is scoped to a different
 * item, so the mis-file above announces itself before the tap instead of
 * being discovered later under the wrong heading. It only ever reads the
 * name the user gave the file; a name that matches nothing gets no hint.
 * Order matters: "travel insurance booking confirmation" is insurance, and
 * the specific document kinds win over the generic booking words.
 */
export function suggestTripRole(docName: string): TripDocRole | undefined {
  const s = docName.toLowerCase();
  // Most specific first: a birth certificate's name says exactly what it is,
  // in either of the languages this family's papers come in.
  if (/birth\s*certificate|geburtsurkunde|unabridged|\bubc\b/.test(s)) return 'birthCertificate';
  if (/consent|approval|permission|authori[sz]ation/.test(s)) return 'consent';
  if (/passport/.test(s)) return 'passportCopy';
  // A residence permit or card IS the visa for the border's purposes, and
  // real files are named after the physical thing ("Ben's Temporary
  // Residence Card", "Aufenthaltstitel") — none of which contain "visa".
  // "permission" is safe: the consent test above already claimed it.
  if (/visa|residence|aufenthalt|permit/.test(s)) return 'visa';
  if (/insurance|policy|versicherung/.test(s)) return 'insurance';
  if (/hotel|hostel|airbnb|accommodation|apartment|lodge|guesthouse|b&b/.test(s)) return 'accommodation';
  if (/ticket|boarding|flight|itinerary|e-?ticket|train|bus|booking/.test(s)) return 'ticket';
  return undefined;
}

// --- The checklist -------------------------------------------------------

export interface TripChecklistRow {
  key: string;
  role: TripDocRole | 'passport' | 'insuranceDetails' | 'emergencyContact';
  label: string;
  /** Why this row matters, shown when it's missing. Fixed copy, never generated. */
  note: string;
  /** True when we have something real to show for it. */
  present: boolean;
  /** What we can show: a document, or typed-in details, or both. */
  detail?: string;
  /**
   * `detail` for the insurance row is three separate facts joined with " · "
   * for display. The trip glance needs them APART: it dedupes by value, and a
   * composite string matches neither the provider nor the assistance number
   * extracted from the policy document — so the card printed both twice, once
   * inside the run-on line and once on its own row. Labels here match the
   * document key-fact labels exactly, which is what makes the dedupe bite.
   */
  parts?: { label: string; value: string }[];
  expiryDate?: string;
  /** VaultDocument ids backing this row, if any. */
  docIds: string[];
  /**
   * Rows the traveller would be asked to PRODUCE. A missing required row is a
   * problem to fix before departure; a missing optional one is a nice-to-have.
   */
  required: boolean;
}

const ROLE_LABEL: Record<TripDocRole, string> = {
  ticket: 'Tickets & bookings',
  accommodation: 'Where you are staying',
  insurance: 'Travel insurance policy',
  consent: 'Parental consent letter',
  birthCertificate: 'Birth certificate',
  visa: 'Visa',
  passportCopy: 'Passport copy',
  other: 'Other papers',
};

/**
 * Is this member likely to be asked for a parental consent letter?
 *
 * Under 18 is the near-universal threshold, and the letter is asked for when a
 * minor travels without both parents. We cannot know from the data who is
 * accompanying them, so this errs toward showing the row: a consent letter that
 * turns out to be unnecessary costs nothing, and being turned away at a check-in
 * desk for the want of one costs the trip.
 */
export function needsConsentLetter(member: Pick<FamilyMember, 'birthdate'>, tripStart: string): boolean {
  const born = parseDateOnly(member.birthdate);
  const start = parseDateOnly(tripStart);
  if (!born || !start) return false;
  let age = start.getFullYear() - born.getFullYear();
  const beforeBirthday =
    start.getMonth() < born.getMonth() ||
    (start.getMonth() === born.getMonth() && start.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age < 18;
}

function docsFor(trip: Trip, role: TripDocRole, memberId: string): TripDocRef[] {
  // A doc with no memberId covers the whole party — a family insurance policy
  // or one hotel booking is genuinely everyone's, and requiring it to be
  // duplicated per person would make the attach flow tedious enough to skip.
  return trip.docs.filter((doc) => doc.role === role && (!doc.memberId || doc.memberId === memberId));
}

/**
 * Everything this person should be able to show on this trip, present or not.
 *
 * The missing rows are the point. A checklist that only lists what you have is
 * a filing cabinet; one that lists what you don't is a reason to open the app
 * before you leave rather than after something has gone wrong.
 */
export function buildTripChecklist(
  trip: Trip,
  member: FamilyMember,
  vaultDocs: readonly VaultDocument[] = [],
): TripChecklistRow[] {
  const byId = new Map(vaultDocs.map((doc) => [doc.id, doc]));
  const rows: TripChecklistRow[] = [];
  const named = (refs: TripDocRef[]) =>
    refs.map((ref) => byId.get(ref.id)?.name).filter((name): name is string => !!name);

  // --- Passport. Mirrors TravelPack's legacy-fold dedupe: MemberIDs.tsx folds
  // the old single `passport` field into `passports[]` but never clears the
  // original, so once folded both live side by side and match on number. ---
  const modern = member.passports || [];
  const legacyFolded = !!member.passport?.passportNumber
    && modern.some((p) => p.number === member.passport?.passportNumber);
  const passports = [
    ...modern.map((p) => ({ country: p.country, number: p.number, expiryDate: p.expiryDate, photoDocId: p.photoDocId })),
    ...(member.passport?.passportNumber && !legacyFolded
      ? [{
          country: member.passport.issuingCountry,
          number: member.passport.passportNumber,
          expiryDate: member.passport.expiryDate,
          photoDocId: undefined as string | undefined,
        }]
      : []),
  ];

  // Every place a scanned page can live, resolved the same way the IDs tab
  // resolves it (findPassportScan): the explicit photoDocId link first, then
  // the name/country heuristics — over the member's own documents AND the
  // shared vault's documents linked to this member (toFamilyDoc maps vault
  // "Identity" to "ID" so both stores match identically). Pushing the raw
  // photoDocId and nothing else, as this used to, meant a scan the profile
  // happily shows was invisible here. Shared by the passport AND visa rows —
  // a residence card in the vault backs the visa row the same way.
  // hiddenDocIds gates the POOL, not the rows: a doc the user removed from
  // this pack stops being auto-pulled everywhere at once, while an explicit
  // attachment (docsFor) never passes through here and so always shows.
  const hiddenIds = new Set(trip.hiddenDocIds);
  const scanPool = [
    ...(member.documents || []),
    ...vaultDocs.filter((d) => d.memberId === member.id).map(toFamilyDoc),
  ].filter((d) => !hiddenIds.has(d.id));

  if (passports.length === 0) {
    rows.push({
      key: 'passport',
      role: 'passport',
      label: 'Passport',
      note: 'No passport on file. Add the number and expiry — it is what replaces the document if it is lost.',
      present: false,
      docIds: [],
      required: true,
    });
  } else {
    passports.forEach((passport, index) => {
      const copies = docsFor(trip, 'passportCopy', member.id);
      const scan = findPassportScan(passport, scanPool);
      rows.push({
        key: `passport-${index}`,
        role: 'passport',
        label: passport.country ? `${passport.country} passport` : 'Passport',
        note: 'Keep the number to hand. A lost passport is replaced from its details, not from the document.',
        present: true,
        detail: passport.number,
        expiryDate: passport.expiryDate,
        // Set-dedup: the resolved scan may ALSO be attached to the trip as a
        // passport copy, and one file must not render as two cards.
        docIds: [...new Set([...(scan ? [scan.id] : []), ...copies.map((c) => c.id)])],
        required: true,
      });
    });
  }

  // --- Visas: only the ones for this trip's destination would strictly apply,
  // but we cannot reliably match free-text destinations to visa countries, so
  // every visa on file is listed and the traveller decides. ---
  (member.travel?.visas || []).forEach((visa) => {
    // Auto-pull the scan exactly as the passport row does — a saved residence
    // card ("Ben's Temporary Residence Card") IS this row's document even
    // though nobody attached it to the trip. Set-dedup for the same reason as
    // passports: the found scan may also be attached explicitly.
    const scan = findVisaScan(visa, scanPool);
    rows.push({
      key: `visa-${visa.id}`,
      role: 'visa',
      label: `${visa.country} visa`,
      note: 'Carry it with the passport it belongs to.',
      present: true,
      detail: visa.number,
      expiryDate: visa.expiryDate,
      docIds: [...new Set([...(scan ? [scan.id] : []), ...docsFor(trip, 'visa', member.id).map((d) => d.id)])],
      required: false,
    });
  });

  // --- Insurance. Split deliberately into DETAILS and DOCUMENT, because they
  // fail separately: you can have the policy PDF and not know the 24/7 number
  // (it is rarely on the certificate), or know the number and have no proof of
  // cover to show a hospital that wants one before treating you. ---
  const insurance = member.travel;
  const insuranceDocs = docsFor(trip, 'insurance', member.id);
  // The details row used to read ONLY the typed-in member.travel fields — so an
  // attached policy whose extracted key facts held the 24/7 line still showed
  // "No 24-hour assistance number saved" ("theres a emergency number in the
  // brochure i uploaded but the ai didnt pick it up"). Two stores, one fact:
  // typed-in wins, extracted-and-verified facts from THIS row's attached
  // documents fill the gaps. Unverified facts (failed the verbatim re-check)
  // never surface here — a phone number is exactly the kind of value a wrong
  // guess must not reach.
  const insuranceFact = (label: string): string | undefined => {
    for (const ref of insuranceDocs) {
      const fact = byId.get(ref.id)?.keyFacts?.find((f) => f.label === label && f.verified !== false);
      if (fact) return fact.value;
    }
    return undefined;
  };
  const insProvider = insurance?.travelInsuranceProvider || insuranceFact('Provider / issuer');
  const insPolicyNo = insurance?.travelInsuranceNumber || insuranceFact('Policy or booking number');
  const insEmergency = insurance?.travelInsuranceEmergencyNumber || insuranceFact('24/7 emergency line');
  // An attached policy nobody has run "Read" on yet is the likeliest reason the
  // number is missing — say so, instead of a dead "not saved".
  const insUnread = insuranceDocs.some((ref) => { const d = byId.get(ref.id); return d && !keyFactsCurrent(d); });
  const insuranceBits = [insProvider, insPolicyNo].filter(Boolean);
  rows.push({
    key: 'insurance-details',
    role: 'insuranceDetails',
    label: 'Insurance details & 24/7 line',
    note: insEmergency
      ? 'The assistance line to call before paying for treatment.'
      : insUnread
        ? 'No 24-hour assistance number saved yet. Tap “Read” on the attached policy below — if the number is printed in it, it will be pulled out for you.'
        : 'No 24-hour assistance number saved. It is the number to call before paying for treatment abroad.',
    present: insuranceBits.length > 0,
    detail: [...insuranceBits, insEmergency].filter(Boolean).join(' · ') || undefined,
    parts: [
      { label: 'Provider / issuer', value: insProvider },
      { label: 'Policy or booking number', value: insPolicyNo },
      { label: '24/7 emergency line', value: insEmergency },
    ].filter((p): p is { label: string; value: string } => !!p.value),
    docIds: [],
    required: true,
  });
  rows.push({
    key: 'insurance-doc',
    role: 'insurance',
    label: ROLE_LABEL.insurance,
    note: 'Proof of cover, for a hospital or clinic that asks to see it.',
    present: insuranceDocs.length > 0,
    detail: named(insuranceDocs).join(', ') || undefined,
    docIds: insuranceDocs.map((d) => d.id),
    required: true,
  });

  // --- Tickets & accommodation ---
  const tickets = docsFor(trip, 'ticket', member.id);
  rows.push({
    key: 'tickets',
    role: 'ticket',
    label: ROLE_LABEL.ticket,
    note: 'Flights, trains, buses — the booking you have to show to board.',
    present: tickets.length > 0,
    detail: named(tickets).join(', ') || undefined,
    docIds: tickets.map((d) => d.id),
    required: true,
  });

  const stay = docsFor(trip, 'accommodation', member.id);
  rows.push({
    key: 'accommodation',
    role: 'accommodation',
    label: ROLE_LABEL.accommodation,
    note: 'Border officers ask for an address. Have the booking, not a memory of it.',
    present: stay.length > 0,
    detail: named(stay).join(', ') || undefined,
    docIds: stay.map((d) => d.id),
    required: true,
  });

  // --- Consent letter: only surfaced for a minor, and required when surfaced. ---
  if (needsConsentLetter(member, trip.startDate)) {
    const consent = docsFor(trip, 'consent', member.id);
    rows.push({
      key: 'consent',
      role: 'consent',
      label: ROLE_LABEL.consent,
      note: 'A minor travelling without both parents is often asked for a signed letter of consent. Airlines and border control can both ask.',
      present: consent.length > 0,
      detail: named(consent).join(', ') || undefined,
      docIds: consent.map((d) => d.id),
      required: true,
    });

    // --- Birth certificate: the consent letter's companion document. The SA
    // consent affidavit itself lists "Unabridged Birth Certificate of child
    // travelling" among its required attachments, and South Africa asks for
    // the unabridged one (naming both parents) for its own travelling minors.
    // Auto-pulls saved certificates by name, exactly like the passport and
    // visa rows — ALL of them, because an apostilled copy and the original
    // are both real answers and hiding one would be a guess. ---
    const birthDocs = docsFor(trip, 'birthCertificate', member.id);
    const birthScans = findBirthCertificateScans(scanPool);
    rows.push({
      key: 'birthCertificate',
      role: 'birthCertificate',
      label: ROLE_LABEL.birthCertificate,
      note: 'Borders can ask for a travelling minor\'s birth certificate — South Africa wants the unabridged one, naming both parents. Carry it with the consent letter.',
      present: birthDocs.length > 0 || birthScans.length > 0,
      detail: named(birthDocs).join(', ') || undefined,
      docIds: [...new Set([...birthScans.map((s) => s.id), ...birthDocs.map((d) => d.id)])],
      required: true,
    });
  }

  const other = docsFor(trip, 'other', member.id);
  if (other.length > 0) {
    rows.push({
      key: 'other',
      role: 'other',
      label: ROLE_LABEL.other,
      note: 'Also attached to this trip.',
      present: true,
      detail: named(other).join(', '),
      docIds: other.map((d) => d.id),
      required: false,
    });
  }

  return rows;
}

/** Required rows with nothing behind them — the "sort this before you go" list. */
export function missingRequired(rows: readonly TripChecklistRow[]): TripChecklistRow[] {
  return rows.filter((row) => row.required && !row.present);
}

// --- The at-a-glance card -------------------------------------------------

export interface TripGlanceFact {
  label: string;
  value: string;
  /** False when the value was read from pixels (OCR) — the UI says "from photo". */
  verified: boolean;
}

export interface TripGlanceSection {
  key: string;
  title: string;
  facts: TripGlanceFact[];
}

/** Which extracted labels earn a place on the glance, per bucket. Everything
 *  else (addresses, emails, issue dates, amounts, the trip's own dates the
 *  hero already shows) stays on the document's own chips in the viewer — the
 *  first version showed every extracted fact and the card read as a dump, not
 *  a glance ("clean it up big time... information first that's relevant"). */
const GLANCE_LABELS = {
  personal: new Set(['Passport or ID number', 'Phone number', '24/7 emergency line', 'Valid until / expiry']),
  insurance: new Set(['Provider / issuer', '24/7 emergency line', 'Phone number', 'Policy or booking number', 'Reference to quote', 'Valid until / expiry']),
  booking: new Set(['Policy or booking number', 'Reference to quote', 'Seat', 'Departure', 'Arrival']),
  other: new Set(['Passport or ID number', 'Policy or booking number', 'Reference to quote', '24/7 emergency line', 'Phone number']),
} as const;

/** How a fact folded into a person's section names its paper. */
const ROLE_SHORT: Partial<Record<TripDocRole, string>> = {
  consent: 'consent letter',
  birthCertificate: 'birth certificate',
  passportCopy: 'passport copy',
  visa: 'visa',
  insurance: 'insurance',
  ticket: 'ticket',
  accommodation: 'booking',
  other: 'papers',
};

/**
 * Every detail someone actually types out loud on a trip — passport numbers,
 * booking references, the assistance line — collected into one card at the top
 * of the pack, instead of being scattered across checklist rows and inside
 * attached PDFs.
 *
 * Structured PERSON-FIRST (v288): the first shape was one section per member
 * plus one raw section per document, which repeated every number and left
 * phone numbers nobody could tell apart ("whose details are whose, like
 * mother's phone number"). Now:
 *  - a personal document's facts (TripDocRef.memberId) fold into that
 *    person's own section, labelled with the paper they came from and, when
 *    the document prints one, the holder ("Phone number — Mother");
 *  - insurance papers and the typed-in insurance details merge into ONE
 *    "Insurance & help" section (first provider only — a distributor AND an
 *    underwriter is detail, not glance);
 *  - a value already shown is never shown again (the affidavit quoting the
 *    passport number the profile already typed added nothing);
 *  - only hurry-relevant labels survive (GLANCE_LABELS above).
 *
 * Typed-in details still come via the same buildTripChecklist derivations the
 * rows use — one implementation, so the glance can never disagree with the
 * checklist about a number. Extracted values remain verbatim DocKeyFacts.
 */
export function buildTripGlance(
  trip: Trip,
  travellers: readonly FamilyMember[],
  vaultDocs: readonly VaultDocument[] = [],
): TripGlanceSection[] {
  const byId = new Map(vaultDocs.map((doc) => [doc.id, doc]));
  // Dedupe by VALUE, phone-aware: "+43 (0)5 0330 - 72222" and "05 0330 -
  // 72222" are the same line written twice (once with the country code), and
  // "+27 84 555 0142" is "084 5285402" in local dress — string equality sees
  // four numbers where a traveller has two. Values that are mostly digits key
  // on their last 9 digits; everything else on the whitespace-stripped string.
  const normVal = (v: string) => {
    const digits = v.replace(/\D+/g, '');
    if (digits.length >= 8 && digits.length >= v.replace(/\s+/g, '').length * 0.5) {
      return `#${digits.slice(-9)}`;
    }
    return v.toLowerCase().replace(/\s+/g, '');
  };
  const seenValues = new Set<string>();
  const push = (facts: TripGlanceFact[], fact: TripGlanceFact) => {
    const key = normVal(fact.value);
    if (seenValues.has(key)) return;
    seenValues.add(key);
    facts.push(fact);
  };

  const memberSections = new Map<string, TripGlanceSection>();
  const insuranceFacts: TripGlanceFact[] = [];
  // Set as soon as ANY provider name is shown — typed or extracted. A second
  // spelling of the same insurer ("Erste Bank u. Sparkasse AG") is not a second
  // insurer, and value-dedupe alone would not catch it.
  let insuranceProviderShown = false;
  const bookingFacts: TripGlanceFact[] = [];
  const otherFacts: TripGlanceFact[] = [];

  for (const member of travellers) {
    const first = member.name.split(/\s+/)[0] || member.name;
    const facts: TripGlanceFact[] = [];
    memberSections.set(member.id, { key: `member-${member.id}`, title: first, facts });
    for (const row of buildTripChecklist(trip, member, vaultDocs)) {
      if (!row.detail) continue;
      if (row.role === 'passport' || row.role === 'visa') {
        push(facts, { label: row.label, value: row.detail, verified: true });
      } else if (row.role === 'insuranceDetails') {
        // Shared by the party in practice (both kids carry the same policy) —
        // pooled so the same line doesn't print once per traveller. One fact
        // PER PART, never the joined display string: the parts carry the same
        // labels the policy document's key facts do, so whichever store a
        // value came from it lands on one row, not two.
        for (const part of row.parts ?? [{ label: 'Travel insurance', value: row.detail }]) {
          if (part.label === 'Provider / issuer') insuranceProviderShown = true;
          push(insuranceFacts, { label: part.label, value: part.value, verified: true });
        }
      }
    }
  }

  const seenDocs = new Set<string>();
  for (const ref of trip.docs) {
    if (seenDocs.has(ref.id)) continue;
    seenDocs.add(ref.id);
    const doc = byId.get(ref.id);
    if (!doc?.keyFacts?.length) continue;
    const memberSection = ref.memberId ? memberSections.get(ref.memberId) : undefined;
    const bucket: keyof typeof GLANCE_LABELS = memberSection ? 'personal'
      : ref.role === 'insurance' ? 'insurance'
      : ref.role === 'ticket' || ref.role === 'accommodation' ? 'booking'
      : 'other';
    const target = memberSection ? memberSection.facts
      : bucket === 'insurance' ? insuranceFacts
      : bucket === 'booking' ? bookingFacts
      : otherFacts;
    const allowed: ReadonlySet<string> = GLANCE_LABELS[bucket];
    const hasEmergencyLine = doc.keyFacts.some((f) => f.label === '24/7 emergency line');
    for (const f of doc.keyFacts) {
      if (!allowed.has(f.label)) continue;
      // When the paper has a 24/7 assistance line, an unattributed office
      // number beside it is noise; a number the document assigns to someone
      // ("Mother") stays.
      if (f.label === 'Phone number' && hasEmergencyLine && !f.who) continue;
      if (f.label === 'Provider / issuer' && bucket === 'insurance') {
        if (insuranceProviderShown) continue;
        insuranceProviderShown = true;
      }
      const source = memberSection ? ROLE_SHORT[ref.role] : undefined;
      const label = f.who ? `${f.label} — ${f.who}` : source ? `${f.label} · ${source}` : f.label;
      push(target, { label, value: f.value, verified: f.verified !== false });
    }
  }

  const sections: TripGlanceSection[] = [];
  for (const member of travellers) {
    const section = memberSections.get(member.id);
    if (section && section.facts.length) sections.push(section);
  }
  if (insuranceFacts.length) sections.push({ key: 'insurance', title: 'Insurance & help', facts: insuranceFacts });
  if (bookingFacts.length) sections.push({ key: 'bookings', title: 'Bookings', facts: bookingFacts });
  if (otherFacts.length) sections.push({ key: 'other-docs', title: 'Also in the papers', facts: otherFacts });
  return sections;
}

/**
 * The extraction generation this build writes and trusts. Bump it when the
 * server-side extraction meaningfully improves — every document extracted
 * under an older version becomes "awaiting" again, which re-offers (never
 * auto-runs) the read button. Version 1 (implicit, pre-field) lacked the
 * "Passport or ID number" label and the complete-name rule. Version 2 could
 * not join a name printed in separate Surname/Name form fields — the verbatim
 * filter killed the joined value, so "Name on the document" lost the surname.
 * Version 3 had no holder attribution — a consent affidavit's parents' phone
 * numbers surfaced as two bare "Phone number" rows nobody could tell apart;
 * version 4 added the verbatim "who" field. Version 5: the who RULE alone was
 * ignored at temperature 0 (live affidavit returned zero attributions); the
 * prompt gained a worked example. Version 6: v5's attributions were produced
 * and then STRIPPED by the client's response map (docKeyFacts.ts) before
 * saving — nothing stored under v5 can carry a who, so it all re-offers.
 */
export const KEY_FACTS_VERSION = 6;

/**
 * Has this document been through extraction, for the bytes it currently holds?
 *
 * keyFactsAt (not the facts array) is what marks "extraction ran" — a document
 * that genuinely contains no key facts saves an empty list, and re-charging an
 * AI call on it every open would be paying twice for the same answer. A
 * replaced file (contentHash moved past keyFactsHash) counts as never
 * extracted: last year's phone number on this year's policy is worse than no
 * facts at all.
 */
export function keyFactsCurrent(
  doc: Pick<VaultDocument, 'keyFactsAt' | 'keyFactsHash' | 'contentHash' | 'keyFactsVersion'>,
): boolean {
  if (!doc.keyFactsAt) return false;
  // Facts saved by an older extractor count as stale even for the same bytes:
  // v1 had no "Passport or ID number" label, so it filed passport numbers
  // under "Policy or booking number" and truncated names. Worse-than-nothing
  // facts should be re-offered, not trusted forever.
  if ((doc.keyFactsVersion ?? 1) < KEY_FACTS_VERSION) return false;
  if (!doc.contentHash || !doc.keyFactsHash) return true;
  return doc.keyFactsHash === doc.contentHash;
}

/** Attached documents that have no extracted facts yet — what the one-push button reads. */
export function docsAwaitingFacts(trip: Trip, vaultDocs: readonly VaultDocument[]): VaultDocument[] {
  const byId = new Map(vaultDocs.map((doc) => [doc.id, doc]));
  const out: VaultDocument[] = [];
  const seen = new Set<string>();
  for (const ref of trip.docs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    const doc = byId.get(ref.id);
    if (doc && !keyFactsCurrent(doc)) out.push(doc);
  }
  return out;
}

// --- The lost-documents brief -------------------------------------------

export interface LostDocumentsBrief {
  /** Passport details, which is what an emergency travel document is issued from. */
  passports: { country?: string; number: string; expiryDate?: string; issueDate?: string }[];
  /** The insurer's own emergency line, when saved. */
  insuranceEmergencyNumber?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  /** A person at home to call. */
  homeContact?: string;
  /**
   * Verified national emergency numbers for the destination — ONLY when the
   * destination country is one emergencyNumbers.ts has sourced. Empty
   * otherwise; the UI shows an honest gap rather than a guess.
   */
  destinationCountry?: IdCountry;
  /** Fixed, non-generated steps. */
  steps: string[];
}

export function buildLostDocumentsBrief(trip: Trip, member: FamilyMember): LostDocumentsBrief {
  const modern = member.passports || [];
  const legacyFolded = !!member.passport?.passportNumber
    && modern.some((p) => p.number === member.passport?.passportNumber);

  const passports = [
    ...modern
      .filter((p) => !!p.number)
      .map((p) => ({ country: p.country, number: p.number, expiryDate: p.expiryDate, issueDate: p.issueDate })),
    ...(member.passport?.passportNumber && !legacyFolded
      ? [{
          country: member.passport.issuingCountry,
          number: member.passport.passportNumber,
          expiryDate: member.passport.expiryDate,
          issueDate: undefined as string | undefined,
        }]
      : []),
  ];

  return {
    passports,
    insuranceEmergencyNumber: member.travel?.travelInsuranceEmergencyNumber,
    insuranceProvider: member.travel?.travelInsuranceProvider,
    insurancePolicyNumber: member.travel?.travelInsuranceNumber,
    homeContact: member.travel?.emergencyTravelContact,
    destinationCountry: trip.destinationCountry,
    // Fixed copy. These are the standard steps every foreign ministry gives for
    // a lost or stolen passport, in the order they have to happen — the police
    // report is what the embassy will ask for, so it comes first.
    steps: [
      'Report it to the local police and get a copy of the report — the embassy will ask for it.',
      'Contact your embassy or consulate for an emergency travel document.',
      'Call your travel insurer’s assistance line — lost documents are often covered.',
      'Tell someone at home, so they can send copies and help from your end.',
    ],
  };
}
