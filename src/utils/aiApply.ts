import { FamilyMember, FamilyInfo } from '../types';
import type { AiEdit } from '../components/AIChatbot';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

const setSizes = (m: FamilyMember, k: string, v: string): FamilyMember => ({ ...m, clothingSizes: { ...m.clothingSizes, [k]: v } });
const setMedical = (m: FamilyMember, k: string, v: any): FamilyMember => ({ ...m, medical: { ...(m.medical || {}), [k]: v } });
const setIdentity = (m: FamilyMember, k: string, v: string): FamilyMember => ({ ...m, identity: { ...(m.identity || {}), [k]: v } });
const setEducation = (m: FamilyMember, k: string, v: string): FamilyMember => ({ ...m, education: { ...(m.education || {}), [k]: v } });
const setTravel = (m: FamilyMember, k: string, v: string): FamilyMember => ({ ...m, travel: { ...(m.travel || {}), [k]: v } });
const setPrefs = (m: FamilyMember, k: string, v: string): FamilyMember => ({ ...m, preferences: { ...(m.preferences || {}), [k]: v } });

// Canonical AI field key -> how to write it onto a member.
const MEMBER_FIELD_MAP: Record<string, (m: FamilyMember, v: string) => FamilyMember> = {
  name: (m, v) => ({ ...m, name: v }),
  nickname: (m, v) => ({ ...m, nickname: v }),
  birthdate: (m, v) => ({ ...m, birthdate: v }),
  place_of_birth: (m, v) => ({ ...m, placeOfBirth: v }),
  nationality: (m, v) => ({ ...m, nationality: v }),
  languages: (m, v) => ({ ...m, languages: v }),
  gender: (m, v) => ({ ...m, gender: v }),

  shirt_size: (m, v) => setSizes(m, 'tops', v),
  pants_size: (m, v) => setSizes(m, 'bottoms', v),
  shoe_size: (m, v) => setSizes(m, 'shoes', v),
  dress_size: (m, v) => setSizes(m, 'dressSize', v),
  jacket_size: (m, v) => setSizes(m, 'jacketSize', v),
  hat_size: (m, v) => setSizes(m, 'hatValue', v),
  ring_size: (m, v) => setSizes(m, 'ringSize', v),
  height_cm: (m, v) => setSizes(m, 'heightCm', v),
  weight_kg: (m, v) => setSizes(m, 'weightKg', v),
  size_notes: (m, v) => setSizes(m, 'notes', v),

  blood_group: (m, v) => setMedical(m, 'bloodGroup', v),
  allergies: (m, v) => setMedical(m, 'allergies', v),
  medications: (m, v) => setMedical(m, 'medications', v),
  conditions: (m, v) => setMedical(m, 'conditions', v),
  surgeries: (m, v) => setMedical(m, 'surgeries', v),
  emergency_medication: (m, v) => setMedical(m, 'emergencyMedication', v),
  organ_donor: (m, v) => setMedical(m, 'organDonor', /^(y|yes|true|1)$/i.test(v)),
  family_medical_history: (m, v) => setMedical(m, 'familyHistory', v),
  medical_notes: (m, v) => setMedical(m, 'notes', v),

  sv_number: (m, v) => setIdentity(m, 'svNumber', v),
  ecard_number: (m, v) => setIdentity(m, 'eCardNumber', v),
  tax_number: (m, v) => setIdentity(m, 'taxNumber', v),
  student_number: (m, v) => setIdentity(m, 'studentNumber', v),
  school_reg_number: (m, v) => setIdentity(m, 'schoolRegNumber', v),
  residence_permit_number: (m, v) => setIdentity(m, 'residencePermitNumber', v),
  residence_permit_expiry: (m, v) => setIdentity(m, 'residencePermitExpiry', v),
  national_id_number: (m, v) => setIdentity(m, 'nationalIdNumber', v),
  citizenship_cert_number: (m, v) => setIdentity(m, 'citizenshipCertNumber', v),
  drivers_license_number: (m, v) => setIdentity(m, 'driversLicenseNumber', v),
  drivers_license_expiry: (m, v) => setIdentity(m, 'driversLicenseExpiry', v),

  school_name: (m, v) => setEducation(m, 'schoolName', v),
  class_grade: (m, v) => setEducation(m, 'grade', v),
  teacher_name: (m, v) => setEducation(m, 'teacherName', v),
  teacher_contact: (m, v) => setEducation(m, 'teacherContact', v),

  frequent_flyer: (m, v) => setTravel(m, 'frequentFlyer', v),
  travel_insurance_number: (m, v) => setTravel(m, 'travelInsuranceNumber', v),
  etias_status: (m, v) => setTravel(m, 'etiasStatus', v),
  travel_preferences: (m, v) => setTravel(m, 'preferences', v),
  emergency_travel_contact: (m, v) => setTravel(m, 'emergencyTravelContact', v),

  emergency_contact_name: (m, v) => ({ ...m, emergencyContactName: v }),
  emergency_contact_phone: (m, v) => ({ ...m, emergencyContactPhone: v }),

  favorite_meals: (m, v) => setPrefs(m, 'favoriteMeals', v),
  disliked_foods: (m, v) => setPrefs(m, 'dislikedFoods', v),
  dietary_restrictions: (m, v) => setPrefs(m, 'dietaryRestrictions', v),
  favorite_movies: (m, v) => setPrefs(m, 'favoriteMovies', v),
  favorite_books: (m, v) => setPrefs(m, 'favoriteBooks', v),
  favorite_games: (m, v) => setPrefs(m, 'favoriteGames', v),
  favorite_music: (m, v) => setPrefs(m, 'favoriteMusic', v),
  sports: (m, v) => setPrefs(m, 'sports', v),
  hobbies: (m, v) => setPrefs(m, 'hobbies', v),
  clothing_brands: (m, v) => setPrefs(m, 'clothingBrands', v),
  color_preferences: (m, v) => setPrefs(m, 'colorPreferences', v),
};

function resolveMember(members: FamilyMember[], name: string): FamilyMember | undefined {
  const n = (name || '').trim().toLowerCase();
  if (!n) return undefined;
  return members.find(m => m.name.toLowerCase() === n || (m.nickname || '').toLowerCase() === n)
    || members.find(m => m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase()));
}

// Apply member + passport edits, returning the next members array.
export function applyMemberEdits(members: FamilyMember[], edits: AiEdit[]): FamilyMember[] {
  let next = members;
  for (const e of edits) {
    if (e.kind === 'member') {
      const target = resolveMember(next, e.member);
      const fn = MEMBER_FIELD_MAP[e.field];
      if (!target || !fn) { if (!fn) console.warn('AI: unknown field', e.field); continue; }
      next = next.map(m => (m.id === target.id ? fn(m, e.value) : m));
    } else if (e.kind === 'passport') {
      const target = resolveMember(next, e.member);
      if (!target) continue;
      const rec = { id: newId(), country: e.country, number: e.number, expiryDate: e.expiry || undefined };
      next = next.map(m => (m.id === target.id ? { ...m, passports: [...(m.passports || []), rec] } : m));
    }
  }
  return next;
}

// Apply contact + number edits onto the shared family info doc.
export function applyInfoEdits(info: FamilyInfo, edits: AiEdit[]): FamilyInfo {
  const numbers = [...(info.numbers || [])];
  const contacts = [...(info.contacts || [])];
  for (const e of edits) {
    if (e.kind === 'contact') {
      contacts.push({ id: newId(), name: e.name, relation: e.relation, phone: e.phone, email: e.email });
    } else if (e.kind === 'number') {
      numbers.push({ id: newId(), label: e.label, value: e.value });
    }
  }
  return { numbers, contacts };
}

export const hasMemberEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'member' || e.kind === 'passport');
export const hasInfoEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'contact' || e.kind === 'number');
