import { FamilyMember, FamilyInfo, MemberRole, CalendarEvent, HouseholdInfo, FinancesInfo, FamilyTimeline, ShoppingItem, FamilyWord } from '../types';
import type { AiEdit } from '../components/AIChatbot';
import { AVATAR_COLORS } from './avatarPalette';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);
const VALID_FAMILY_ROLES: MemberRole[] = ['Parent', 'Child', 'Grandparent', 'Other'];

function createMember(name: string, role: string | undefined, nickname: string | undefined, birthdate: string | undefined, idx: number, isBusinessSpace?: boolean): FamilyMember {
  // A business space has no fixed role vocabulary — any AI-proposed title the
  // model gives is accepted as-is (free-text, same as the manual Add form's
  // "Custom…" option); only the family literals get validated against a list,
  // and 'Child' specifically is never valid there.
  const r = isBusinessSpace
    ? (role && role.trim() && role !== 'Child' ? role.trim() : 'Employee')
    : (role && VALID_FAMILY_ROLES.includes(role as MemberRole)) ? role as MemberRole : 'Child';
  return {
    id: newId(),
    name,
    nickname: nickname || undefined,
    role: r,
    birthdate: birthdate || undefined,
    avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
    clothingSizes: {},
    documents: [],
  };
}

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

  address: (m, v) => ({ ...m, address: v }),
  phone: (m, v) => ({ ...m, phone: v }),
  email: (m, v) => ({ ...m, email: v }),

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
  id_document_type: (m, v) => setIdentity(m, 'idDocumentType', v),
  birth_cert_number: (m, v) => setIdentity(m, 'birthCertNumber', v),
  medical_aid_number: (m, v) => setIdentity(m, 'medicalAidNumber', v),
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
export function applyMemberEdits(members: FamilyMember[], edits: AiEdit[], isBusinessSpace?: boolean): FamilyMember[] {
  let next = members;
  // Pass 1: create any new members first, so later field edits can target them.
  for (const e of edits) {
    if (e.kind === 'new_member' && e.name) {
      next = [...next, createMember(e.name, e.role, e.nickname, e.birthdate, next.length, isBusinessSpace)];
    }
  }
  // Pass 2: field + passport edits.
  for (const e of edits) {
    if (e.kind === 'member') {
      const target = resolveMember(next, e.member);
      const fn = MEMBER_FIELD_MAP[e.field];
      if (!target || !fn) { if (!fn) console.warn('AI: unknown field', e.field); continue; }
      next = next.map(m => (m.id === target.id ? fn(m, e.value) : m));
    } else if (e.kind === 'passport') {
      const target = resolveMember(next, e.member);
      if (!target) continue;
      // The AI can re-extract the same passport across multiple messages (a
      // re-scanned photo, or the same document referenced by more than one
      // card) — match on country+number and update in place instead of
      // appending a duplicate row.
      const existing = (target.passports || []).find(p =>
        (p.country || '').trim().toLowerCase() === (e.country || '').trim().toLowerCase()
        && (p.number || '').trim() === (e.number || '').trim()
      );
      if (existing) {
        next = next.map(m => (m.id === target.id ? {
          ...m,
          passports: (m.passports || []).map(p => p.id === existing.id
            ? { ...p, country: e.country, number: e.number, expiryDate: e.expiry || p.expiryDate }
            : p),
        } : m));
      } else {
        const rec = { id: newId(), country: e.country, number: e.number, expiryDate: e.expiry || undefined };
        next = next.map(m => (m.id === target.id ? { ...m, passports: [...(m.passports || []), rec] } : m));
      }
    } else if (e.kind === 'transit_pass') {
      const target = resolveMember(next, e.member);
      if (!target || !e.name) continue;
      const rec = {
        id: newId(), name: e.name,
        operator: e.operator || undefined, cardNumber: e.cardNumber || undefined,
        zone: e.zone || undefined, validFrom: e.validFrom || undefined,
        validUntil: e.validUntil || undefined, notes: e.notes || undefined,
      };
      next = next.map(m => (m.id === target.id
        ? { ...m, travel: { ...(m.travel || {}), transitPasses: [...(m.travel?.transitPasses || []), rec] } }
        : m));
    } else if (e.kind === 'care_schedule') {
      const target = resolveMember(next, e.member);
      if (!target || !e.careKind) continue;
      const rec = {
        id: newId(), kind: e.careKind, provider: e.provider || undefined,
        lastVisit: e.lastVisit || undefined,
        intervalMonths: e.intervalMonths && e.intervalMonths > 0 ? e.intervalMonths : defaultCareInterval(e.careKind),
        nextDue: e.nextDue || undefined, notes: e.notes || undefined,
      };
      next = next.map(m => (m.id === target.id ? { ...m, careSchedule: [...(m.careSchedule || []), rec] } : m));
    } else if (e.kind === 'saying') {
      const target = resolveMember(next, e.member);
      if (!target || !e.text || !e.text.trim()) continue;
      const rec = {
        id: newId(),
        text: e.text.trim(),
        said: (e.said && /^\d{4}-\d{2}-\d{2}$/.test(e.said)) ? e.said : new Date().toLocaleDateString('en-CA'),
        context: e.context?.trim() || undefined,
      };
      next = next.map(m => (m.id === target.id ? { ...m, sayings: [...(m.sayings || []), rec] } : m));
    }
  }
  return next;
}

// Sensible recurrence when the AI didn't state an interval.
function defaultCareInterval(kind: string): number {
  const k = kind.toLowerCase();
  if (k.includes('dent')) return 6;
  if (k.includes('eye') || k.includes('optic')) return 24;
  return 12;
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

export const hasMemberEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'member' || e.kind === 'passport' || e.kind === 'new_member' || e.kind === 'transit_pass' || e.kind === 'care_schedule' || e.kind === 'saying');
export const hasInfoEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'contact' || e.kind === 'number');

const VALID_CALENDAR_CATS = ['Milestone', 'Appointment', 'School', 'Travel', 'Other'] as const;
type CalendarCat = typeof VALID_CALENDAR_CATS[number];

// Add calendar events from AI edits, resolving memberNames to memberIds.
export function applyCalendarEdits(events: CalendarEvent[], edits: AiEdit[], members: FamilyMember[]): CalendarEvent[] {
  const added: CalendarEvent[] = [];
  for (const e of edits) {
    if (e.kind !== 'calendar_event') continue;
    const cat: CalendarCat = (VALID_CALENDAR_CATS as readonly string[]).includes(e.category || '')
      ? (e.category as CalendarCat)
      : 'Other';
    const memberIds = (e.memberNames || [])
      .map(n => members.find(m => m.name.toLowerCase() === n.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id));
    added.push({
      id: newId(),
      title: e.title,
      date: e.date,
      time: e.time || undefined,
      description: '',
      category: cat,
      remindMe: false,
      memberIds: memberIds.length ? memberIds : undefined,
    });
  }
  return [...events, ...added];
}

// Apply household edits: set scalar fields (address, wifi, door code) or append to lists.
export function applyHouseholdEdits(h: HouseholdInfo, edits: AiEdit[]): HouseholdInfo {
  let next = { ...h };
  for (const e of edits) {
    if (e.kind === 'household_set') {
      // Guard: never let an empty value clobber an existing field.
      if (e.value && e.value.trim()) next = { ...next, [e.field]: e.value.trim() };
    } else if (e.kind === 'list_add') {
      if (e.list === 'vehicles') {
        next = { ...next, vehicles: [...(next.vehicles || []), { id: newId(), ...e.item } as any] };
      } else if (e.list === 'pets') {
        next = { ...next, pets: [...(next.pets || []), { id: newId(), ...e.item } as any] };
      } else if (e.list === 'utilities') {
        next = { ...next, utilities: [...(next.utilities || []), { id: newId(), ...e.item } as any] };
      }
    }
  }
  return next;
}

// Append a row to a finances list (banks / insurance / benefits).
export function applyFinancesEdits(f: FinancesInfo, edits: AiEdit[]): FinancesInfo {
  let next = { ...f };
  for (const e of edits) {
    if (e.kind !== 'list_add') continue;
    if (e.list === 'banks') {
      next = { ...next, banks: [...(next.banks || []), { id: newId(), ...e.item } as any] };
    } else if (e.list === 'insurance') {
      next = { ...next, insurance: [...(next.insurance || []), { id: newId(), ...e.item } as any] };
    } else if (e.list === 'benefits') {
      next = { ...next, benefits: [...(next.benefits || []), { id: newId(), ...e.item } as any] };
    }
  }
  return next;
}

// Append an entry to the family timeline.
export function applyTimelineEdits(t: FamilyTimeline, edits: AiEdit[]): FamilyTimeline {
  // Clamp type to the values TimelineView can render — an off-list type from
  // the AI (e.g. "Anniversary") must degrade to Other, not crash the view.
  const VALID_TYPES = ['Birth', 'Wedding', 'Graduation', 'Milestone', 'Memory', 'Other'];
  const added = edits
    .filter((e): e is Extract<AiEdit, { kind: 'list_add' }> => e.kind === 'list_add' && e.list === 'timeline')
    .map(e => {
      const item: any = { id: newId(), ...e.item };
      if (item.type && !VALID_TYPES.includes(item.type)) item.type = 'Other';
      return item;
    });
  return { ...t, entries: [...(t.entries || []), ...added] };
}

export const hasCalendarEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'calendar_event');

export const hasShoppingEdits = (edits: AiEdit[]) =>
  edits.some(e => e.kind === 'list_add' && e.list === 'shopping');

export function applyShoppingEdits(items: ShoppingItem[], edits: AiEdit[]): ShoppingItem[] {
  const today = new Date().toISOString().slice(0, 10);
  const added = edits
    .filter((e): e is Extract<AiEdit, { kind: 'list_add' }> => e.kind === 'list_add' && e.list === 'shopping')
    .map(e => ({
      id: Date.now().toString() + Math.floor(Math.random() * 1000),
      name: e.item.name || Object.values(e.item).filter(Boolean)[0] || 'Item',
      checked: false,
      addedAt: today,
    }));
  return [...items, ...added];
}
export const hasAssetEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'asset');
export const hasHouseholdEdits = (edits: AiEdit[]) =>
  edits.some(e =>
    (e.kind === 'list_add' && ['vehicles', 'pets', 'utilities'].includes(e.list)) ||
    e.kind === 'household_set',
  );
export const hasFinancesEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'list_add' && ['banks', 'insurance', 'benefits'].includes(e.list));
export const hasTimelineEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'list_add' && e.list === 'timeline');
export const hasFamilyWordsEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'family_word');

// Append entries to the Family Dictionary. Requires both word + meaning.
export function applyFamilyWordsEdits(words: FamilyWord[], edits: AiEdit[]): FamilyWord[] {
  const added: FamilyWord[] = [];
  for (const e of edits) {
    if (e.kind !== 'family_word') continue;
    const word = (e.word || '').trim();
    const meaning = (e.meaning || '').trim();
    if (!word || !meaning) continue;
    added.push({
      id: newId(),
      word,
      meaning,
      coinedBy: e.coinedBy?.trim() || undefined,
      approxDate: (e.approxDate && /^\d{4}-\d{2}-\d{2}$/.test(e.approxDate)) ? e.approxDate : undefined,
    });
  }
  return [...words, ...added];
}
