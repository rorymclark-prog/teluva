// Family spaces use the 4 fixed values below. Business spaces use a preset
// business title (see BUSINESS_ROLE_PRESETS in AddMemberModal.tsx) or any
// custom free-text title — hence the open `string` fallback.
export type MemberRole = 'Parent' | 'Child' | 'Grandparent' | 'Other' | string;

export interface ClothingSizes {
  tops?: string;
  bottoms?: string;
  shoes?: string;
  outerwear?: string;
  underwear?: string;
  hatValue?: string;
  dressSize?: string;
  jacketSize?: string;
  ringSize?: string;
  heightCm?: string;
  weightKg?: string;
  notes?: string;
  lastUpdated?: string;
}

export interface PassportInfo {
  passportNumber: string;
  fullName: string;
  issuingCountry: string;
  dateOfBirth: string;
  issueDate: string;
  expiryDate: string;
  notes?: string;
}

export interface FamilyDocument {
  id: string;
  name: string;
  category: 'ID' | 'Health' | 'Education' | 'Travel' | 'Other';
  fileType: string; // e.g., 'image/png', 'application/pdf', etc.
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  notes?: string;
  fileData?: string; // base64 string or url
  contentHash?: string; // SHA-256 of the file bytes — powers duplicate detection; absent on documents saved before this existed
}

export interface GrowthLog {
  id: string;
  date: string;
  heightCm: number;
  weightKg: number;
  notes?: string;
}

// --- Yearly birthday photo (growing-up timelapse) ---
// One tagged photo per member per calendar year. The actual image bytes live in
// Firebase Storage (families/{FAMILY_ID}/birthday-photos/…) so the member record
// stays small even after many years; only the download URL + light metadata are
// stored here. In demo mode `url` is a base64 data URL (no Storage round-trip).
export interface BirthdayPhoto {
  id: string;
  year: number;        // calendar year this photo represents (one per member per year)
  url: string;         // Storage download URL (or a base64 data URL in demo mode)
  storagePath?: string; // Storage object path, for deletion (absent in demo)
  ageYears?: number;   // age at capture, derived from birthdate (display only)
  addedAt: string;     // ISO timestamp
}

export interface DigitalAccount {
  id: string;
  serviceName: string;
  username: string;
  passwordPlain: string;
  url?: string;
  notes?: string;
}

export interface FinancialAccount {
  id: string;
  bankName: string;
  accountType: string; // e.g. Savings, Checking, Electric Company, etc.
  accountNumber: string;
  routingNumber?: string;
  notes?: string;
}

export interface EducationDetails {
  schoolName?: string;
  grade?: string;
  teacherName?: string;
  teacherContact?: string;
  roomNumber?: string;
  scheduleNotes?: string;
}

export interface NationalIdentifiers {
  ssn?: string;
  nationalId?: string;
  driversLicenseNo?: string;
  taxId?: string;
  insuranceNo?: string;
  notes?: string;
}

export interface FavoriteItem {
  id: string;
  title: string;
  category: 'Toy' | 'Clothing & Style' | 'Hobbies & Sports' | 'Books & Media' | 'Food & Treats' | 'Other';
  imageUrl: string; // base64 representation or illustrative image
  notes?: string;
  addedAt: string;
  isWishlist?: boolean;
  targetPrice?: string; // Estimated cost in Euros (e.g. "€25.00")
  webLink?: string;     // Web shop URL link
  bought?: boolean;     // Gift secured/purchased status
}

export interface FamilyMember {
  id: string;
  name: string;
  nickname?: string;
  role: MemberRole;
  birthdate?: string;
  birthTime?: string;        // HH:MM — optional, powers the fun astrology view
  placeOfBirth?: string;
  // The "just for fun" AI-written star-sign blurb — persisted so it survives a
  // reload instead of reverting to the plain static fallback every session.
  // forInputs snapshots birthdate|birthTime|placeOfBirth so an edit to any of
  // them is detected as stale and silently regenerated on next view.
  astrologyBlurb?: { text: string; sign: string; generatedAt: string; forInputs: string };
  birthHospital?: string;
  taxNumber?: string;        // personal tax / social-security number — useful for a family member too, not business-only
  startDate?: string;        // YYYY-MM-DD — unused for a family member; an employee's start-of-employment date in a business space
  nationality?: string;     // comma-separated is fine, free text
  languages?: string;
  gender?: string;
  // Where this member lives + how to reach them. Visible to the whole family
  // (members can live at different addresses, e.g. an adult child or relative).
  address?: string;
  phone?: string;
  email?: string;
  // Employer/workplace details — useful in an emergency (who to call, where someone works).
  employer?: string;
  jobTitle?: string;
  workPhone?: string;
  workAddress?: string;
  avatarColor: string; // e.g., 'bg-blue-500'
  avatarUrl?: string;  // Base64 representation of uploaded / captured photo
  avatarOriginalUrl?: string; // Real photo kept when an AI-restyled avatar is applied, so "reset to photo" works
  avatarStyle?: string;       // Which fun-avatar preset is currently applied (undefined = real photo)
  isOnline?: boolean;  // System status online indicator flag
  clothingSizes: ClothingSizes;
  passport?: PassportInfo;
  passports?: PassportRecord[];     // multiple passports (UK / SA / AT …)
  documents: FamilyDocument[];
  growthHistory?: GrowthLog[];
  digitalAccounts?: DigitalAccount[];
  financialAccounts?: FinancialAccount[];
  education?: EducationDetails;
  identifiers?: NationalIdentifiers;
  identity?: IdentityRecord;        // richer ID/permit numbers
  medical?: MedicalRecord;
  travel?: TravelInfo;
  preferences?: Preferences;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  favorites?: FavoriteItem[];
  careSchedule?: CareSchedule[];    // recurring health/admin appointments (dentist, yearly check-up …)
  sayings?: Saying[];               // keepsake: funny/wise things they said, age derived from birthdate
  favoriteQuotes?: FavoriteQuote[]; // quotes THEY love from someone/something else — a book, song, grandparent, film — the OPPOSITE direction from sayings (their own words)
  birthdayPhotos?: BirthdayPhoto[]; // one photo per year → growing-up timelapse
}

// A quote a family member said — captured with the date so their AGE at the time
// is DERIVED from birthdate (never stored). The keepsake most parents lose.
export interface Saying {
  id: string;
  text: string;         // the quote, verbatim
  said: string;         // ISO date (YYYY-MM-DD) it was said
  context?: string;     // what prompted it / where
  milestone?: boolean;  // star a specially treasured one
}

// A quote a family member LOVES from someone/something ELSE — a book, a song,
// a grandparent, a film. The OPPOSITE of Saying (which is their OWN words).
// "source" is what distinguishes it: who said/wrote it, or where it's from.
// addedAt is bookkeeping/sort order only — it is NOT a "when said" claim.
export interface FavoriteQuote {
  id: string;
  text: string;      // the quote, verbatim
  source?: string;    // who said/wrote it, or where it's from (person, author, book, film, song)
  note?: string;      // optional — why it matters to this person
  addedAt: string;    // ISO date (YYYY-MM-DD) it was recorded, for sort order only
}

// A word a child invented or mangled that the family adopted ("boo-blerries").
// Family-LEVEL (stored in a reference doc), not per-member — a shared artifact.
export interface FamilyWord {
  id: string;
  word: string;         // the invented/mispronounced word
  meaning: string;      // what it actually means
  coinedBy?: string;    // member name (free text, matches assignedMember style)
  approxDate?: string;  // ISO date (YYYY-MM-DD), optional — enables an age hint
  stillUsed?: boolean;  // does the family still use it?
}

export interface FamilyWordsDoc {
  words: FamilyWord[];
}

// --- Care schedule (recurring health / admin appointments per member) ---
// The point: store "last visit + how often" and DERIVE the next-due date, so the
// app can nudge "Mia's dental check-up is due" without anyone hand-entering a date.
export type CareKind =
  | 'Dental check-up'
  | 'Medical check-up'
  | 'Eye test'
  | 'Vaccination / booster'
  | 'Specialist review'
  | 'Skin check'
  | 'Other';

export interface CareSchedule {
  id: string;
  kind: CareKind | string;   // one of CareKind, or free text
  provider?: string;         // e.g. "Dr. Müller (Zahnarzt)"
  lastVisit?: string;        // YYYY-MM-DD
  intervalMonths: number;    // recur every N months (6 = twice a year, 12 = yearly)
  nextDue?: string;          // optional explicit override; else derived from lastVisit + interval
  notes?: string;
}

// --- Medical ---
export interface Vaccination {
  id: string;
  name: string;
  date?: string;
  notes?: string;
}

export interface MedicalRecord {
  bloodGroup?: string;
  allergies?: string;
  medications?: string;
  conditions?: string;          // chronic conditions
  vaccinations?: Vaccination[];
  surgeries?: string;
  emergencyMedication?: string;
  organDonor?: boolean;
  familyHistory?: string;       // diabetes, heart disease, cancer, genetic
  preferredPharmacy?: string;   // UK: EPS nomination · US: per-member override of the household default
  notes?: string;
}

// --- Identity / IDs (multiple passports + permits) ---
export interface PassportRecord {
  id: string;
  country: string;              // e.g. "Austria", "United Kingdom", "South Africa"
  number: string;
  expiryDate?: string;
  issueDate?: string;
  notes?: string;
}

// A visa or work permit. "country" is the country it's valid IN (not the
// holder's nationality) — the permitType/issuingAuthority/sponsor/status
// fields matter most for a foreign EMPLOYEE at a multi-location business;
// they're optional so this stays lightweight for a simple travel visa too.
export interface VisaRecord {
  id: string;
  country: string;
  number?: string;
  expiryDate?: string;
  permitType?: string;        // e.g. "Critical Skills", "General Work", "Tourist"
  issuingAuthority?: string;
  sponsor?: string;           // employer of record, for a work permit
  status?: 'active' | 'expired' | 'pending';
  conditions?: string;        // e.g. "employer-tied"
  notes?: string;
}

export interface IdentityRecord {
  // Austria
  eCardNumber?: string;
  svNumber?: string;            // Sozialversicherungsnummer
  taxNumber?: string;
  studentNumber?: string;
  schoolRegNumber?: string;
  // Residence / national / international
  residencePermitNumber?: string;
  residencePermitExpiry?: string;
  nationalIdNumber?: string;    // e.g. SA 13-digit ID number
  idDocumentType?: string;      // e.g. "Smart ID Card", "Green ID Book" (South Africa)
  birthCertNumber?: string;     // unabridged birth certificate number
  medicalAidNumber?: string;    // private medical aid membership (SA has no national health-insurance card)
  medicalAidScheme?: string;    // SA: scheme name (Discovery Health, Bonitas, GEMS…) · US: insurer/plan name
  medicalAidPlanOption?: string; // SA: plan/option name · US: plan type (e.g. "HMO — referral needed")
  medicalAidDependantCode?: string; // SA only — 00 principal member, 01/02… dependants
  insuranceGroupNumber?: string;    // US only — needed alongside the member ID to use insurance
  registeredGpPractice?: string;    // UK only — the practice you're registered with (not an individual GP)
  citizenshipCertNumber?: string;
  driversLicenseNumber?: string;
  driversLicenseExpiry?: string;
  notes?: string;
}

// --- Travel ---
// A season ticket / travel card — Wiener Linien Jahreskarte, ÖBB Klimaticket,
// a rail pass, etc. validUntil drives renewal nudges; teens can "show" it.
export interface TransitPass {
  id: string;
  name: string;            // e.g. "Wiener Linien Jahreskarte", "ÖBB Klimaticket"
  operator?: string;       // e.g. "Wiener Linien", "ÖBB"
  cardNumber?: string;
  zone?: string;           // e.g. "Wien Kernzone", "Österreich"
  validFrom?: string;      // YYYY-MM-DD
  validUntil?: string;     // YYYY-MM-DD — expiry → nudge
  scanDocId?: string;      // optional link to a saved document scan
  notes?: string;
}

export interface TravelInfo {
  frequentFlyer?: string;
  travelInsuranceNumber?: string;
  etiasStatus?: string;         // ESTA / ETIAS status
  visas?: VisaRecord[];
  transitPasses?: TransitPass[];  // Jahreskarte, Klimaticket, rail passes …
  preferences?: string;
  emergencyTravelContact?: string;
}

// --- Personal preferences ---
export interface Preferences {
  favoriteMeals?: string;
  dislikedFoods?: string;
  dietaryRestrictions?: string;
  favoriteMovies?: string;
  favoriteBooks?: string;
  favoriteGames?: string;
  favoriteMusic?: string;
  sports?: string;
  hobbies?: string;
  clothingBrands?: string;
  colorPreferences?: string;
}

// --- Household (family-wide) ---
export interface Vehicle {
  id: string;
  name: string;                 // e.g. "VW Golf" (kept for back-compat)
  make?: string;
  model?: string;
  year?: string;
  registration?: string;        // number plate / Kennzeichen
  vin?: string;                 // chassis number / Fahrgestellnummer
  fuelType?: string;            // Petrol / Diesel / Electric / Hybrid / Other
  assignedMember?: string;      // primary driver (member name)
  odometer?: string;
  // --- Insurance ---
  insurer?: string;
  insuranceNumber?: string;
  insuranceRenewal?: string;    // YYYY-MM-DD → renewal reminder
  // --- Legal / maintenance deadlines (the reminder engine) ---
  inspectionExpiry?: string;    // §57a Pickerl / MOT / TÜV — YYYY-MM-DD
  vignetteExpiry?: string;      // motorway toll sticker (AT/CH/SI) — YYYY-MM-DD
  lastService?: string;         // YYYY-MM-DD
  serviceIntervalMonths?: number;
  nextServiceDue?: string;      // explicit override; else derived from lastService + interval
  serviceDate?: string;         // LEGACY field (older records) — treated as next-service date
  serviceLog?: ServiceRecord[]; // maintenance & repair history ("what was done last time")
  // --- Parking ---
  parkingPermit?: string;       // e.g. Parkpickerl 1010 / resident zone permit
  parkingPermitExpiry?: string; // YYYY-MM-DD → renewal reminder
  parkingSpot?: string;         // garage / bay / space number or location
  notes?: string;
}

// One entry in a vehicle's service & repair history.
export interface ServiceRecord {
  id: string;
  date: string;      // YYYY-MM-DD
  work: string;      // what was done / the issue reported
  odometer?: string;
  cost?: string;
  garage?: string;   // workshop / who did it
  notes?: string;
}

export interface Pet {
  id: string;
  name: string;
  species?: string;
  vet?: string;
  vaccinations?: string;
  microchip?: string;
  notes?: string;
}

export interface UtilityProvider {
  id: string;
  type: string;                 // e.g. "Electricity", "Internet"
  provider?: string;
  accountNumber?: string;
  notes?: string;
}

// One site for a multi-location business (a home-based family only ever needs
// the single legacy `address` field above; this is additive, not a replacement).
export interface BusinessLocation {
  id: string;
  label: string;             // e.g. "Head office", "Cape Town branch"
  address: string;
  type?: 'hq' | 'branch' | 'site' | 'other';
  notes?: string;
}

export interface HouseholdInfo {
  address?: string;
  doorCode?: string;
  wifiName?: string;
  wifiPassword?: string;
  utilities?: UtilityProvider[];
  vehicles?: Vehicle[];
  pets?: Pet[];
  locations?: BusinessLocation[];
}

// --- Finances (family-wide references, not passwords) ---
export interface BankAccount {
  id: string;
  bankName: string;
  accountHolder?: string;
  iban?: string;
  bic?: string;
  notes?: string;
}

// A peril / component within a policy (Fire, Water, Theft, Away-from-home …).
export interface InsuranceCoverage {
  id: string;
  name: string;
  limit?: string;
  notes?: string;
}

// A condition/obligation QUOTED verbatim from the policyholder's own document by
// the recall-only reader. `quote` is copied word-for-word from the policy and is
// NEVER a paraphrase, verdict, or recommendation — there is deliberately no
// "covered" / "risk" / "advice" field so an opinion cannot be stored here.
export interface PolicyObligation {
  id: string;
  quote: string;    // verbatim text from the document
  topic?: string;   // neutral tag: Lock | Storage | Travel | Safety | Deadline | Documents | General
  done?: boolean;   // user-controlled checklist tick
  verified?: boolean; // true = the server confirmed this quote is a literal substring
                      // of pasted text; false = read from a photo (OCR, unverifiable)
}

export interface InsurancePolicy {
  id: string;
  provider: string;              // insurer name (field kept as 'provider' for back-compat)
  type?: string;                 // Home contents / Health / Car / Travel / Life / Liability / Valuables / Other
  policyNumber?: string;
  renewalDate?: string;          // Hauptfälligkeit / main due date
  notes?: string;
  // --- Phase 2: richer policy record ---
  claimsPhone?: string;          // dedicated claims line
  claimsNotes?: string;          // how to report a claim / portal URL
  broker?: string;
  sumInsured?: string;
  currency?: string;             // ISO 4217, default EUR
  excess?: string;               // deductible / Selbstbehalt
  premium?: string;
  premiumFrequency?: string;     // Monthly / Quarterly / Semi-annual / Annual
  startDate?: string;
  geographicScope?: string;      // e.g. Austria / Schengen / Worldwide
  cancellationNoticeDays?: number; // notice period; AT is generally 1–3 months (read the policy)
  status?: 'active' | 'lapsed' | 'cancelled';
  coverage?: InsuranceCoverage[];
  coveredMemberIds?: string[];   // family member ids this policy covers
  coveredAssetIds?: string[];    // asset ids this policy covers
  // --- Recall-only reader (dark-launched, see config/features.ts) ---
  obligations?: PolicyObligation[]; // verbatim quotes of conditions the holder must meet
  obligationsReadAt?: string;       // ISO timestamp of the last AI read
}

export interface BenefitInfo {
  id: string;
  name: string;                 // e.g. "Familienbeihilfe"
  reference?: string;
  notes?: string;
}

export interface FinancesInfo {
  banks?: BankAccount[];
  insurance?: InsurancePolicy[];
  benefits?: BenefitInfo[];
}

// --- Family timeline ---
export interface TimelineEntry {
  id: string;
  date: string;                 // YYYY-MM-DD
  title: string;
  type?: string;                // Birth, Wedding, Graduation, Memory …
  note?: string;
}

export interface FamilyTimeline {
  entries: TimelineEntry[];
}

// --- Travel timeline (family-wide): countries visited, chronologically ---
// Built from photos with embedded GPS EXIF (auto-tagged, source: 'exif') or
// typed in by hand when a photo has no location data (source: 'manual').
export interface TravelTimelineEntry {
  id: string;
  country: string;              // display name, e.g. "Austria"
  countryCode?: string;         // ISO 3166-1 alpha-2, e.g. "AT" (offline-resolved)
  place?: string;                // optional free-text city/region, e.g. "Vienna"
  date: string;                  // YYYY-MM-DD
  photoUrl?: string;             // Firebase Storage download URL (compressed)
  photoStoragePath?: string;     // Storage path, so the file can be cleaned up on delete
  lat?: number;
  lng?: number;
  source: 'exif' | 'manual';
  notes?: string;
}

export interface TravelTimelineDoc {
  entries: TravelTimelineEntry[];
}

// --- Hub settings (shared): the family's name for their hub + a family photo ---
// ISO 3166-1 alpha-2 country codes the ID & Passports section has a dedicated
// field set for; 'other' shows a slim generic set (national ID/tax/driver's
// licence) that fits most countries reasonably.
export type IdCountry = 'AT' | 'ZA' | 'UK' | 'US' | 'other';

export interface HubSettings {
  hubName?: string;
  familyPhotoUrl?: string;   // compressed base64 thumbnail
  nameDisplay?: 'real' | 'nick' | 'both';   // how member names show (default 'both')
  astrology?: boolean;       // opt-in "just for fun" star-sign view (off by default)
  country?: IdCountry;       // drives which ID & Passports field set renders (default 'AT')
}

// --- Document Vault (real files in Firebase Storage; only metadata in Firestore) ---
export type VaultCategory = 'Identity' | 'Education' | 'Medical' | 'Financial' | 'Legal' | 'Travel' | 'Other';

export interface VaultDocument {
  id: string;
  name: string;
  category: VaultCategory;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;   // path within the Firebase Storage bucket
  downloadUrl: string;
  uploadedAt: string;    // YYYY-MM-DD
  uploadedBy?: string;
  memberId?: string;     // optional link to a family member
  notes?: string;
  contentHash?: string;  // SHA-256 of the file bytes — powers duplicate detection; absent on documents saved before this existed
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  description?: string;
  category: 'Milestone' | 'Appointment' | 'School' | 'Travel' | 'Other';
  remindMe: boolean;
  memberIds?: string[]; // Tagged family members
}

// --- Important Info tab: a shared family quick-reference sheet ---
// A free-form labelled number/value (social security, passport no, insurance,
// policy numbers, anything worth keeping in one place).
export interface InfoEntry {
  id: string;
  label: string;        // e.g. "Mia – Social security"
  value: string;        // e.g. "1234 010118"
  note?: string;
}

// A person/place to contact (school office, teacher, doctor, friend, emergency).
export interface ContactEntry {
  id: string;
  name: string;         // e.g. "Frau Müller" or "Volksschule Ottakring"
  relation?: string;    // e.g. "Class teacher 3b", "School", "Pediatrician", "Friend"
  phone?: string;
  email?: string;
  note?: string;
  birthdate?: string;   // YYYY-MM-DD, optional — lets a contact who isn't a full
                         // family member (a grandparent, godparent, etc.) still
                         // get a birthday nudge in NeedsAttention/OnThisDay
}

// A doctor, practice, specialist, or pharmacy — the family's own directory of
// who to call. Shared at the family/business level (a GP is usually one
// shared practice, not a per-member fact); `forMember` optionally tags an
// entry to one person (e.g. "Mia's allergist") without needing a separate
// per-member list.
export type ProviderType = 'GP practice' | 'Dentist' | 'Optician' | 'Specialist' | 'Pharmacy' | 'Other' | 'Financial advisor' | 'Accountant' | 'Lawyer / Notary' | 'Insurance broker' | 'Bank contact';
// Also used for professional/financial contacts (adviser, accountant, lawyer, insurance broker, bank contact) — same list, alongside doctors.

export interface HealthcareProvider {
  id: string;
  name: string;              // doctor/consultant name, or practice/pharmacy name if no named doctor
  type: ProviderType;
  specialty?: string;        // e.g. "Paediatrician", "Cardiologist"
  practiceName?: string;     // practice / clinic / hospital / Trust name (when `name` is a person)
  phone?: string;
  afterHoursPhone?: string;  // emergency / out-of-hours line
  email?: string;
  address?: string;
  networksAccepted?: string; // SA: "Discovery Health – Delta network only" · US: "In-network: BCBS PPO"
  practiceNumber?: string;   // SA: HPCSA practice number · US: NPI number
  referredBy?: string;       // UK: referring GP/practice for a specialist
  isPrimary?: boolean;       // "our usual GP" / registered practice / PCP-on-file
  forMember?: string;        // family member's name this is specifically for; blank = whole family
  note?: string;
}

export interface FamilyInfo {
  numbers: InfoEntry[];
  contacts: ContactEntry[];
  providers: HealthcareProvider[];
}

// --- Shopping list ---
export interface ShoppingItem {
  id: string;
  name: string;
  checked: boolean;
  addedAt?: string;
}

// --- Family auth / roles (multi-user vault) ---
export type FamilyRole = 'admin' | 'member' | 'child';

// Explicit, withdrawable consent for AI processing (GDPR Art. 6/7). Off by
// default — no aiConsent, or granted:false, means AI features stay disabled.
export interface AiConsent {
  granted: boolean;
  at: string;       // ISO timestamp of the decision
  version: number;  // which version of the AI terms they agreed to
}

// A "space" is the generalisation of "family" — the same underlying
// families/{id}/* document tree, just typed differently so the UI can render a
// Family preset, a Business preset, or (later) a Personal preset on top of it.
export type SpaceType = 'family' | 'business' | 'personal';

// One entry in a user's space list — every space (family/business) they belong
// to, with their role in THAT space (roles are per-space, not global).
export interface SpaceMembership {
  id: string;       // the space's id (same value used as familyId today)
  role: FamilyRole;
  type: SpaceType;
  name?: string;     // cached display name for a fast switcher — source of truth is families/{id}/info
}

export interface UserProfile {
  familyId: string;  // the ACTIVE space (back-compat name — same field, now one-of-many)
  role: FamilyRole;  // the caller's role in the ACTIVE space
  email: string;
  displayName: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  aiConsent?: AiConsent;
  spaces?: SpaceMembership[]; // every space this user belongs to (family + business). Absent/empty on
                              // pre-multi-space accounts — callers should fall back to a single-entry
                              // list built from familyId/role.
}

// Firestore doc at families/{familyId}/info
// Named FamilyInfoDoc to avoid collision with the existing FamilyInfo type above.
export interface FamilyInfoDoc {
  name: string;
  createdAt: string;
  adminUid: string;
  type?: SpaceType; // undefined = 'family' (back-compat default)
  // Business-only — undefined for family/personal spaces. Captured at
  // creation time (optionally AI-suggested from the creator's other space,
  // see suggestBusinessInfo in db.ts) with no dedicated edit UI yet.
  address?: string;
  registrationNumber?: string;
  industry?: string;
}

export interface FamilyMemberRole {
  role: FamilyRole;
  email: string;
  displayName: string;
}

export type AssetStatus = 'owned' | 'stolen' | 'lost' | 'sold' | 'disposed';

// Theft/loss details captured for an insurance claim (drives the claim export).
export interface AssetIncident {
  type?: 'stolen' | 'lost' | 'damaged';
  date?: string;             // date of loss / discovery, YYYY-MM-DD
  policeReference?: string;  // crime reference number / Aktenzeichen
  notes?: string;
}

export interface AssetItem {
  id: string;
  name: string;
  category: 'Electronics' | 'Bike' | 'Sporting' | 'Vehicle' | 'Jewellery' | 'Furniture' | 'Other';
  assignedMember?: string;
  make?: string;
  model?: string;
  serialNumber?: string;
  identifierType?: string;    // labels serialNumber: Serial | IMEI | VIN | Frame no. | ISBN | Certificate no.
  purchaseDate?: string;
  purchasePrice?: string;     // free text, kept for back-compat + display
  currency?: string;          // ISO 4217, default EUR
  replacementValue?: string;  // today's cost to replace new (Neuwert)
  purchaseLocation?: string;
  warrantyUntil?: string;     // YYYY-MM-DD
  condition?: string;         // New | Excellent | Good | Fair | Poor
  storageSecurity?: string;   // e.g. In the home | Locked away | In a safe
  notes?: string;
  photoDataUrl?: string;      // primary item photo
  photos?: string[];          // additional photos (serial plate, angles)
  receiptDataUrl?: string;    // receipt / proof of purchase image
  status?: AssetStatus;       // default 'owned'
  incident?: AssetIncident;   // theft/loss details for a claim
  createdAt: string;
}

export interface PasswordEntry {
  id: string;
  service: string;
  url?: string;
  username?: string;
  email?: string;
  password: string;
  notes?: string;
  createdAt: string;
}

// --- Recipe Book (family-wide): recipes captured by photographing a
// handwritten card / cookbook page, or dictated to the AI assistant. A
// memory-keeping feature — no meal planning, shopping-list generation, or
// nutrition info in v1.
export interface Recipe {
  id: string;
  title: string;
  ingredients: string[];   // one per line
  steps: string[];         // one per line
  tags?: string[];         // "Mama's", "Christmas", occasion, free text
  photoUrl?: string;       // Storage download URL of the original card/page
  createdAt: string;       // ISO date
}

// --- In Memory: an archive for deceased parents/grandparents' documents and a
// few remembered things. Deliberately a SEPARATE type from FamilyMember, not a
// `deceased` flag on it — FamilyMember drives living-person logistics
// (clothing sizes, care schedules, growth tracking, birthday timelapses,
// wishlists) and none of that machinery is deceased-aware. Keeping this a
// disjoint type makes it structurally impossible for a nudge, reminder, or
// "no medical info yet" prompt to ever reference someone who has died — those
// pipelines only ever accept FamilyMember[]/ContactEntry[], and DepartedRelative
// can't silently pass through a signature it was never added to.
// `born`/`died` are intentionally free text (not ISO dates) so no date-math
// helper (age calculators, "days until", nudges) is ever accidentally wireable
// to them — this record is read-only remembrance, never a countdown.
export type DepartedDocCategory =
  | 'Death certificate'
  | 'Birth certificate'
  | 'Marriage certificate'
  | 'Citizenship papers'
  | 'Estate & probate papers'
  | 'Other';

export interface DepartedDocument {
  id: string;
  name: string;
  category: DepartedDocCategory;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;   // path within the Firebase Storage bucket
  downloadUrl: string;
  uploadedAt: string;    // YYYY-MM-DD
  notes?: string;
}

// A short remembered thing — a saying, a favourite recipe, a habit, a story.
// Free text and undated on purpose; this is memory-keeping, not a record with
// deadlines.
export interface RememberedNote {
  id: string;
  text: string;
}

export interface DepartedRelative {
  id: string;
  name: string;
  relation: string;      // e.g. "Oma", "Grandfather", "Mother" — free text
  born?: string;          // free text, e.g. "1938" or "12 March 1938" — not a date field
  died?: string;           // free text, e.g. "2019" or "March 2019" — not a date field
  photoUrl?: string;      // Storage download URL of a portrait
  photoStoragePath?: string;
  documents: DepartedDocument[];
  notes: RememberedNote[]; // a few remembered things — stories, sayings, habits
  createdAt: string;       // ISO date this record was added to the archive
}

export interface InMemoryDoc {
  people: DepartedRelative[];
}

export interface RecipeBookDoc { recipes: Recipe[]; }
