export type MemberRole = 'Parent' | 'Child' | 'Grandparent' | 'Other';

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
}

export interface GrowthLog {
  id: string;
  date: string;
  heightCm: number;
  weightKg: number;
  notes?: string;
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
  placeOfBirth?: string;
  nationality?: string;     // comma-separated is fine, free text
  languages?: string;
  gender?: string;
  // Where this member lives + how to reach them. Visible to the whole family
  // (members can live at different addresses, e.g. an adult child or relative).
  address?: string;
  phone?: string;
  email?: string;
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

export interface VisaRecord {
  id: string;
  country: string;
  number?: string;
  expiryDate?: string;
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
  nationalIdNumber?: string;    // e.g. SA ID number
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
  name: string;                 // e.g. "VW Golf"
  registration?: string;
  vin?: string;
  insuranceNumber?: string;
  serviceDate?: string;
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

export interface HouseholdInfo {
  address?: string;
  doorCode?: string;
  wifiName?: string;
  wifiPassword?: string;
  utilities?: UtilityProvider[];
  vehicles?: Vehicle[];
  pets?: Pet[];
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

// --- Hub settings (shared): the family's name for their hub + a family photo ---
export interface HubSettings {
  hubName?: string;
  familyPhotoUrl?: string;   // compressed base64 thumbnail
  nameDisplay?: 'real' | 'nick' | 'both';   // how member names show (default 'both')
}

// --- Document Vault (real files in Firebase Storage; only metadata in Firestore) ---
export type VaultCategory = 'Identity' | 'Education' | 'Medical' | 'Financial' | 'Travel' | 'Other';

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
}

export interface FamilyInfo {
  numbers: InfoEntry[];
  contacts: ContactEntry[];
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

export interface UserProfile {
  familyId: string;
  role: FamilyRole;
  email: string;
  displayName: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  aiConsent?: AiConsent;
}

// Firestore doc at families/{familyId}/info
// Named FamilyInfoDoc to avoid collision with the existing FamilyInfo type above.
export interface FamilyInfoDoc {
  name: string;
  createdAt: string;
  adminUid: string;
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
