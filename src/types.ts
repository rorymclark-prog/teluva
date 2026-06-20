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
  avatarColor: string; // e.g., 'bg-blue-500'
  avatarUrl?: string;  // Base64 representation of uploaded / captured photo
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
export interface TravelInfo {
  frequentFlyer?: string;
  travelInsuranceNumber?: string;
  etiasStatus?: string;         // ESTA / ETIAS status
  visas?: VisaRecord[];
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

export interface InsurancePolicy {
  id: string;
  provider: string;
  type?: string;                // e.g. "Home", "Health", "Car"
  policyNumber?: string;
  renewalDate?: string;
  notes?: string;
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
