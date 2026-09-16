import { FamilyMember, FamilyInfo, MemberRole, CalendarEvent, HouseholdInfo, FinancesInfo, FamilyTimeline, ShoppingItem, FamilyWord, HealthcareProvider, Recipe, CvRole, CvEducationEntry, CvQualification, EstateRecord, SlipItem, DesignatedSuccessor, EmergencyInstructions, HubSettings, NonResidentGuardian, GuardianRelationship, AnniversaryRecord, AnniversaryKind, ExtendedBirthday, HouseholdVendor, HomeServiceRecord, PetHealthRecord, TripDocRole, VaultDocument } from '../types';
import type { AiEdit } from '../components/AIChatbot';
import { suggestReturnBy } from './slip';
import { AVATAR_COLORS } from './avatarPalette';
import { partitionNewEvents } from './calendarDedup';
import { appointmentMatchesEvent } from './referralAppointment';
import { importantOverride, type ImportanceOptions } from './importantEvents';
import { isValidNameDay } from './nameDay';
import { suggestTripRole } from './trip';
import { normalizeVehicleKind } from './vehicle';
import { lifeCategoryFromWord, parseLifeDate } from './lifeTimeline';
import type { LifeCategory, TimelineEntry } from '../types';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);
const VALID_FAMILY_ROLES: MemberRole[] = ['Parent', 'Child', 'Grandparent', 'Other'];
const VALID_GUARDIAN_RELATIONSHIPS: GuardianRelationship[] = ['Parent', 'Guardian', 'Grandparent', 'Other'];

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
/**
 * Run ONE member-field edit's writer over a copy of `m`, exactly as the apply
 * pass above would, and hand back the result — or null when the field name is
 * not one this map knows.
 *
 * Exists so utils/aiNoOp can ask "would this edit change anything?" by running
 * the real writer and comparing, rather than keeping a parallel map of getters
 * that would drift out of step with MEMBER_FIELD_MAP the first time a field is
 * added here and nowhere else. Pure — `m` is not mutated.
 */
export function applyMemberFieldEdit(m: FamilyMember, field: string, value: string): FamilyMember | null {
  const fn = MEMBER_FIELD_MAP[field];
  return fn ? fn(m, value) : null;
}

const MEMBER_FIELD_MAP: Record<string, (m: FamilyMember, v: string) => FamilyMember> = {
  name: (m, v) => ({ ...m, name: v }),
  nickname: (m, v) => ({ ...m, nickname: v }),
  birthdate: (m, v) => ({ ...m, birthdate: v }),
  place_of_birth: (m, v) => ({ ...m, placeOfBirth: v }),
  // Namenstag. Stored as 'MM-DD' — a name day has no year. The model is asked
  // for that form but will sometimes send a full ISO date because every other
  // date field in this app is one, so trim it here rather than dropping the
  // edit: a rejected write that reports success is exactly the silent no-op
  // this codebase keeps having to hunt down. An empty value clears the field
  // (clear_field routes through this same map), and anything else is refused.
  name_day: (m, v) => {
    const raw = String(v || '').trim();
    if (!raw) return { ...m, nameDay: undefined, nameDayFeast: undefined };
    const monthDay = /^\d{4}-(\d{2}-\d{2})$/.exec(raw)?.[1] || raw;
    if (!isValidNameDay(monthDay)) { console.warn('AI: ignoring malformed name day', v); return m; }
    // The feast belongs to whatever day was previously stored, so a new date
    // must not keep the old label — better blank than mislabelled.
    return { ...m, nameDay: monthDay, nameDayFeast: undefined };
  },
  nationality: (m, v) => ({ ...m, nationality: v }),
  languages: (m, v) => ({ ...m, languages: v }),
  gender: (m, v) => ({ ...m, gender: v }),
  spouse: (m, v) => ({ ...m, spouse: v }),

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
  travel_insurance_provider: (m, v) => setTravel(m, 'travelInsuranceProvider', v),
  travel_insurance_emergency_number: (m, v) => setTravel(m, 'travelInsuranceEmergencyNumber', v),
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
  const exact = members.find(m => m.name.toLowerCase() === n || (m.nickname || '').toLowerCase() === n);
  if (exact) return exact;
  // Substring fallback — "Mia" for "Miabella", or the model dropping a
  // surname — but ONLY when it's unambiguous. With two members whose names
  // both contain the given text (e.g. "Ann" and "Annabelle"), .find() used
  // to silently take whichever came first in the array: an edit meant for
  // one person could write to the other's profile with no indication
  // anything was wrong (found 2026-08-15, chat-function audit). An ambiguous
  // match now resolves to "not found" — surfaced by the caller as a skipped-
  // edit note — rather than guessing, the same rule aiDestructive.ts already
  // documents for its own targeting: never substitute something similar.
  const matches = members.filter(m => m.name.toLowerCase().includes(n) || n.includes(m.name.toLowerCase()));
  return matches.length === 1 ? matches[0] : undefined;
}

// Apply member + passport edits, returning the next members array plus any
// user-facing notes for edits that named a member resolveMember couldn't
// pin down (no match, or an ambiguous one) — those edits are skipped, not
// guessed at, and the skip used to be completely silent: the card still
// showed "Applied ✓" for a field that never actually changed (found
// 2026-08-15, chat-function audit).
export function applyMemberEdits(members: FamilyMember[], edits: AiEdit[], isBusinessSpace?: boolean): { members: FamilyMember[]; skipped: string[] } {
  let next = members;
  const skipped: string[] = [];
  const resolve = (name: string | undefined, what: string): FamilyMember | undefined => {
    const target = resolveMember(next, name || '');
    if (!target) skipped.push(`Couldn't tell which family member "${(name || '').trim() || '(unnamed)'}" was — a ${what} change was skipped.`);
    return target;
  };
  // Pass 1: create any new members first, so later field edits can target them.
  // Deduped on exact name/nickname (not resolveMember's fuzzy substring match
  // — too permissive for deciding whether to CREATE someone, where a false
  // "already exists" silently drops a genuinely new person) — the AI asked
  // twice in one conversation, or misread an existing name as new, otherwise
  // ends up with two profiles for the same person (pre-publish audit).
  for (const e of edits) {
    if (e.kind === 'new_member' && e.name) {
      const n = e.name.trim().toLowerCase();
      const already = next.some(m => m.name.toLowerCase() === n || (m.nickname || '').toLowerCase() === n);
      if (already) continue;
      next = [...next, createMember(e.name, e.role, e.nickname, e.birthdate, next.length, isBusinessSpace)];
    }
  }
  // Pass 2: field + passport edits.
  for (const e of edits) {
    if (e.kind === 'member') {
      const target = resolve(e.member, e.field ? e.field.replace(/_/g, ' ') : 'profile');
      const fn = MEMBER_FIELD_MAP[e.field];
      if (!target || !fn) { if (!fn) console.warn('AI: unknown field', e.field); continue; }
      next = next.map(m => (m.id === target.id ? fn(m, e.value) : m));
    } else if (e.kind === 'passport') {
      const target = resolve(e.member, 'passport');
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
      const target = resolve(e.member, 'transit pass');
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
      const target = resolve(e.member, 'care schedule');
      if (!target || !e.careKind) continue;
      const rec = {
        id: newId(), kind: e.careKind, provider: e.provider || undefined,
        lastVisit: e.lastVisit || undefined,
        intervalMonths: e.intervalMonths && e.intervalMonths > 0 ? e.intervalMonths : defaultCareInterval(e.careKind),
        nextDue: e.nextDue || undefined, notes: e.notes || undefined,
      };
      next = next.map(m => (m.id === target.id ? { ...m, careSchedule: [...(m.careSchedule || []), rec] } : m));
    } else if (e.kind === 'visa') {
      const target = resolve(e.member, 'visa');
      if (!target || !e.country || !e.country.trim()) continue;
      // Same country + same expiry is the same permit re-scanned. A renewal has
      // a different expiry and is a genuinely new record, so it is kept.
      const already = (target.travel?.visas || []).some(
        v => v.country.trim().toLowerCase() === e.country.trim().toLowerCase() && (v.expiryDate || '') === (e.expiryDate || ''),
      );
      if (already) continue;
      const rec = {
        id: newId(),
        country: e.country.trim(),
        number: e.number?.trim() || undefined,
        expiryDate: (e.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(e.expiryDate)) ? e.expiryDate : undefined,
        permitType: e.permitType?.trim() || undefined,
        issuingAuthority: e.issuingAuthority?.trim() || undefined,
        sponsor: e.sponsor?.trim() || undefined,
        conditions: e.conditions?.trim() || undefined,
        notes: e.notes?.trim() || undefined,
      };
      next = next.map(m => (m.id === target.id
        ? { ...m, travel: { ...(m.travel || {}), visas: [...(m.travel?.visas || []), rec] } }
        : m));
    } else if (e.kind === 'guardian') {
      const target = resolve(e.member, 'guardian');
      if (!target || !e.name || !e.name.trim()) continue;
      const rawRel = (e.relationship || '').trim();
      // A free-text relationship that isn't one of the 4 presets (e.g.
      // "Uncle", "Stepfather") becomes 'Other' with the model's own wording
      // kept in relationshipOther, rather than silently dropped.
      const relationship: GuardianRelationship = VALID_GUARDIAN_RELATIONSHIPS.includes(rawRel as GuardianRelationship)
        ? (rawRel as GuardianRelationship)
        : 'Other';
      const relationshipOther = relationship === 'Other' ? (e.relationshipOther?.trim() || rawRel || undefined) : undefined;
      // Same person re-stated (a custody letter read twice, or asked again in
      // one conversation) is matched on name + relationship — not
      // resolveMember's fuzzy substring match, too permissive for deciding
      // whether to CREATE a new record — same dedupe spirit as new_member above.
      const already = (target.nonResidentGuardians || []).some(
        g => g.name.trim().toLowerCase() === e.name.trim().toLowerCase() && g.relationship === relationship,
      );
      if (already) continue;
      const rec: NonResidentGuardian = {
        id: newId(),
        name: e.name.trim(),
        relationship,
        relationshipOther,
        phone: e.phone?.trim() || undefined,
        email: e.email?.trim() || undefined,
        address: e.address?.trim() || undefined,
        notes: e.notes?.trim() || undefined,
        // Manual-upload-only — see the comment on NonResidentGuardian.documents
        // in types.ts. The AI never populates this array.
        documents: [],
        createdAt: new Date().toISOString(),
      };
      next = next.map(m => (m.id === target.id
        ? { ...m, nonResidentGuardians: [...(m.nonResidentGuardians || []), rec] }
        : m));
    } else if (e.kind === 'vaccination') {
      const target = resolve(e.member, 'vaccination');
      if (!target || !e.name || !e.name.trim()) continue;
      // A vaccination card photographed twice must not double every jab. Same
      // vaccine on the same date is the same jab — dates disagreeing is a real
      // second dose and is kept.
      const already = (target.medical?.vaccinations || []).some(
        v => v.name.trim().toLowerCase() === e.name.trim().toLowerCase() && (v.date || '') === (e.date || ''),
      );
      if (already) continue;
      const rec = {
        id: newId(),
        name: e.name.trim(),
        date: (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) ? e.date : undefined,
        notes: e.notes?.trim() || undefined,
      };
      next = next.map(m => (m.id === target.id
        ? { ...m, medical: { ...(m.medical || {}), vaccinations: [...(m.medical?.vaccinations || []), rec] } }
        : m));
    } else if (e.kind === 'saying') {
      const target = resolve(e.member, 'saying');
      if (!target || !e.text || !e.text.trim()) continue;
      const rec = {
        id: newId(),
        text: e.text.trim(),
        said: (e.said && /^\d{4}-\d{2}-\d{2}$/.test(e.said)) ? e.said : new Date().toLocaleDateString('en-CA'),
        context: e.context?.trim() || undefined,
      };
      next = next.map(m => (m.id === target.id ? { ...m, sayings: [...(m.sayings || []), rec] } : m));
    } else if (e.kind === 'favorite_quote') {
      const target = resolve(e.member, 'favourite quote');
      if (!target || !e.text || !e.text.trim()) continue;
      const rec = {
        id: newId(),
        text: e.text.trim(),
        source: e.source?.trim() || undefined,
        note: e.note?.trim() || undefined,
        addedAt: new Date().toLocaleDateString('en-CA'),
      };
      next = next.map(m => (m.id === target.id ? { ...m, favoriteQuotes: [...(m.favoriteQuotes || []), rec] } : m));
    } else if (e.kind === 'cv' && isBusinessSpace) {
      // Business-only, guarded here in addition to the UI (Dashboard's
      // HIDDEN_IN_FAMILY) and the system prompt (server.js only offers this
      // edit kind when context.isBusinessSpace) — belt-and-braces so even a
      // replayed/legacy chat card can't write cv data into a family space.
      const target = resolve(e.member, 'CV');
      if (!target) continue;
      const existingCv = target.cv || {};
      const norm = (s?: string) => (s || '').trim().toLowerCase();

      const existingRoles = existingCv.roles || [];
      const newRoles: CvRole[] = (e.roles || [])
        .filter(r => r && r.title && r.title.trim())
        .filter(r => !existingRoles.some(x => norm(x.title) === norm(r.title) && norm(x.employer) === norm(r.employer)))
        .map(r => ({ id: newId(), title: r.title.trim(), employer: r.employer || undefined, startDate: r.startDate || undefined, endDate: r.endDate || undefined, current: r.current || undefined, notes: r.notes || undefined }));

      const existingEdu = existingCv.education || [];
      const newEdu: CvEducationEntry[] = (e.education || [])
        .filter(x => x && x.institution && x.institution.trim())
        .filter(x => !existingEdu.some(y => norm(y.institution) === norm(x.institution) && norm(y.qualification) === norm(x.qualification)))
        .map(x => ({ id: newId(), institution: x.institution.trim(), qualification: x.qualification || undefined, fieldOfStudy: x.fieldOfStudy || undefined, startDate: x.startDate || undefined, endDate: x.endDate || undefined, notes: x.notes || undefined }));

      const existingQuals = existingCv.qualifications || [];
      const newQuals: CvQualification[] = (e.qualifications || [])
        .filter(q => q && q.name && q.name.trim())
        .filter(q => !existingQuals.some(y => norm(y.name) === norm(q.name) && norm(y.issuer) === norm(q.issuer)))
        .map(q => ({ id: newId(), name: q.name.trim(), issuer: q.issuer || undefined, issueDate: q.issueDate || undefined, expiryDate: q.expiryDate || undefined, notes: q.notes || undefined }));

      const mergeTags = (existing: string[], incoming?: string[]) => {
        const out = [...existing];
        for (const t of (incoming || [])) {
          const v = (t || '').trim();
          if (v && !out.some(x => norm(x) === norm(v))) out.push(v);
        }
        return out;
      };

      const nextCv = {
        ...existingCv,
        summary: e.summary?.trim() || existingCv.summary,
        roles: [...existingRoles, ...newRoles],
        education: [...existingEdu, ...newEdu],
        qualifications: [...existingQuals, ...newQuals],
        skills: mergeTags(existingCv.skills || [], e.skills),
        languages: mergeTags(existingCv.languages || [], e.languages),
        // Never clobber an already-filed CV with nothing — only set when this edit actually carries one.
        fileDocumentId: e.fileDocumentId || existingCv.fileDocumentId,
      };
      next = next.map(m => (m.id === target.id ? { ...m, cv: nextCv } : m));
    } else if (e.kind === 'clear_field') {
      // Blank out ONE member field on request ("remove Papa's old phone number").
      // Reuses the SAME whitelisted field-writer map as a normal member edit, just
      // with an empty value — so a "clear" can only ever touch a known field, never
      // wipe a whole record. Confirm-before-destroy still applies: like every edit
      // it only runs when the user taps Apply on a card that spells out the change.
      const target = resolve(e.member, e.field ? `clear ${e.field.replace(/_/g, ' ')}` : 'clear field');
      const fn = MEMBER_FIELD_MAP[e.field];
      if (!target || !fn) { if (!fn) console.warn('AI: unknown field', e.field); continue; }
      next = next.map(m => (m.id === target.id ? fn(m, '') : m));
    }
  }
  return { members: next, skipped };
}

// Sensible recurrence when the AI didn't state an interval.
function defaultCareInterval(kind: string): number {
  const k = kind.toLowerCase();
  if (k.includes('dent')) return 6;
  if (k.includes('eye') || k.includes('optic')) return 24;
  return 12;
}

const VALID_PROVIDER_TYPES = ['GP practice', 'Dentist', 'Optician', 'Specialist', 'Pharmacy', 'Other', 'Financial advisor', 'Accountant', 'Lawyer / Notary', 'Insurance broker', 'Bank contact'];

// VendorTrade in types.ts. Matched CASE-INSENSITIVELY, unlike the provider
// types above, because these values are not things a model reproduces byte for
// byte — "Boiler / heating" comes back as "boiler", "Heating", "boiler service".
// An exact-match-or-Other rule would file most real trades as 'Other'.
const VALID_VENDOR_TRADES = [
  'Plumber', 'Electrician', 'Boiler / heating', 'Locksmith', 'Handyman',
  'Cleaner', 'Gardener', 'Appliance repair', 'Pest control',
  'Neighbour (spare key)', 'Other',
] as const;

/**
 * Best-effort trade match. Returns the canonical VendorTrade plus, when nothing
 * matched, the word the model actually used — the caller keeps it in `notes`
 * rather than discarding it. A vendor filed as "Other" with no trace of
 * "Roofer" anywhere is a worse record than the user's own sentence was.
 */
export function matchVendorTrade(raw?: string): { trade: HouseholdVendor['trade']; unmatched?: string } {
  const t = String(raw || '').trim();
  if (!t) return { trade: 'Other' };
  const norm = t.toLowerCase();
  const exact = VALID_VENDOR_TRADES.find((v) => v.toLowerCase() === norm);
  if (exact) return { trade: exact };
  // A loose contains-match in both directions, so "boiler" finds
  // "Boiler / heating" and "Locksmith (24h)" finds "Locksmith".
  const loose = VALID_VENDOR_TRADES.find(
    (v) => v !== 'Other' && (norm.includes(v.toLowerCase()) || v.toLowerCase().includes(norm)),
  );
  if (loose) return { trade: loose };
  return { trade: 'Other', unmatched: t };
}

// Apply contact + number + provider + vendor edits onto the shared family info doc.
export function applyInfoEdits(info: FamilyInfo, edits: AiEdit[]): FamilyInfo {
  const numbers = [...(info.numbers || [])];
  const contacts = [...(info.contacts || [])];
  const providers = [...(info.providers || [])];
  const vendors = [...(info.vendors || [])];
  for (const e of edits) {
    if (e.kind === 'contact') {
      // Deliberately NOT writing e.birthdate. A birthday on a contact only
      // ever reached two home-screen cards; from v228 it becomes an
      // ExtendedBirthday instead, which the calendar, the .ics export and the
      // push notifications all read. The prompt no longer asks for the field,
      // but the model may still volunteer it — applyExtendedBirthdayEdits
      // catches those so the birthday lands in the right place rather than
      // being dropped here.
      contacts.push({ id: newId(), name: e.name, relation: e.relation, phone: e.phone, email: e.email });
    } else if (e.kind === 'number') {
      numbers.push({ id: newId(), label: e.label, value: e.value });
    } else if (e.kind === 'provider') {
      providers.push({
        id: newId(),
        name: e.name,
        type: (e.type && VALID_PROVIDER_TYPES.includes(e.type)) ? e.type as HealthcareProvider['type'] : 'Other',
        specialty: e.specialty,
        practiceName: e.practiceName,
        phone: e.phone,
        afterHoursPhone: e.afterHoursPhone,
        email: e.email,
        address: e.address,
        forMember: e.forMember,
      });
    } else if (e.kind === 'vendor') {
      const { trade, unmatched } = matchVendorTrade(e.trade);
      const notes = [unmatched ? `Trade: ${unmatched}` : '', (e.notes || '').trim()].filter(Boolean).join(' · ');
      vendors.push({
        id: newId(),
        name: e.name,
        trade,
        company: e.company,
        phone: e.phone,
        afterHoursPhone: e.afterHoursPhone,
        accountRef: e.accountRef,
        lastServiceDate: e.lastServiceDate,
        isUsual: e.isUsual === true,
        notes: notes || undefined,
      });
    }
  }
  // The spread is load-bearing, not tidiness. This returns the WHOLE document
  // and the caller saves it, and saveFamilyInfo merges the result against what
  // this client last saw — so a key present in the base and missing here reads
  // as a DELETE and is applied. `vendors` was carried through by hand for
  // exactly that reason back when no edit kind wrote it; spreading `info`
  // instead means the NEXT field added to FamilyInfo survives without anyone
  // remembering this line exists. aiVendorEdits.test.ts pins it.
  return { ...info, numbers, contacts, providers, vendors };
}

export const hasMemberEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'member' || e.kind === 'passport' || e.kind === 'new_member' || e.kind === 'transit_pass' || e.kind === 'care_schedule' || e.kind === 'saying' || e.kind === 'favorite_quote' || e.kind === 'cv' || e.kind === 'vaccination' || e.kind === 'visa' || e.kind === 'guardian' || e.kind === 'clear_field');
export const hasInfoEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'contact' || e.kind === 'number' || e.kind === 'provider' || e.kind === 'vendor');

const VALID_CALENDAR_CATS = ['Milestone', 'Appointment', 'School', 'Travel', 'Other'] as const;
type CalendarCat = typeof VALID_CALENDAR_CATS[number];

// Add calendar events from AI edits, resolving memberNames to memberIds.
//
// Skips anything already on the calendar at the same date, time and title.
// Without that check, applying the same suggestion twice — asking again, or
// tapping Apply again — silently made a second copy, which is how one live
// vault ended up with four identical "Re-test Ferritin and Vitamin D" entries
// twelve minutes apart. See utils/calendarDedup.ts.
//
// Appointments get one more, looser check (2026-09-13). A scanned referral
// letter now proposes a companion calendar_event, and so does telling the
// assistant about an appointment — while the same visit may already be on the
// calendar from a Google import, worded differently ("Termin Orthopädie" vs
// "Orthopaedic surgeon — Dr Example") and at a different time. An Appointment
// for a named person is skipped when that person (or nobody in particular)
// already has an entry that day sharing a meaningful word with it — see
// appointmentMatchesEvent. Untagged or non-Appointment proposals keep the
// exact-match rule only.
//
// `important` is stored only when it differs from what the app would decide
// on its own (importantOverride): a new medical appointment is important
// without the flag, and writing it anyway would freeze the choice.
export function applyCalendarEdits(events: CalendarEvent[], edits: AiEdit[], members: FamilyMember[], opts: ImportanceOptions = {}): CalendarEvent[] {
  const candidates: CalendarEvent[] = [];
  for (const e of edits) {
    if (e.kind !== 'calendar_event') continue;
    const cat: CalendarCat = (VALID_CALENDAR_CATS as readonly string[]).includes(e.category || '')
      ? (e.category as CalendarCat)
      : 'Other';
    // resolveMember (same helper applyMemberEdits above uses) also matches on
    // nickname and an unambiguous substring — a bare exact-name match here
    // dropped a tag whenever the AI used the nickname it was actually given
    // (pre-publish audit).
    const memberIds = (e.memberNames || [])
      .map(n => resolveMember(members, n)?.id)
      .filter((id): id is string => Boolean(id));
    // endDate/destination are Travel-only. Accepting them on an Appointment
    // would put a return date on a dentist visit, and utils/trip.ts only ever
    // reads them off Travel events anyway — so they are dropped rather than
    // stored where nothing will ever look for them.
    const isTrip = cat === 'Travel';
    const endDate = isTrip && e.endDate && e.endDate >= e.date ? e.endDate : undefined;
    const important = typeof e.important === 'boolean'
      ? importantOverride({ title: e.title, description: '' }, e.important, opts)
      : undefined;

    candidates.push({
      id: newId(),
      title: e.title,
      date: e.date,
      time: e.time || undefined,
      description: '',
      category: cat,
      remindMe: false,
      memberIds: memberIds.length ? memberIds : undefined,
      ...(endDate ? { endDate } : {}),
      ...(isTrip && e.destination ? { destination: e.destination } : {}),
      ...(typeof important === 'boolean' ? { important } : {}),
    });
  }
  const { fresh } = partitionNewEvents(events, candidates);
  const kept: CalendarEvent[] = [];
  for (const c of fresh) {
    const ids = c.category === 'Appointment' ? c.memberIds || [] : [];
    const sameVisit = ids.length > 0 && [...events, ...kept].some((ev) =>
      ids.some((memberId) => appointmentMatchesEvent(ev, { date: c.date, memberId, title: c.title }, members)));
    if (!sameVisit) kept.push(c);
  }
  return [...events, ...kept];
}

/* ---------------------------------------------------------------------------
 * trip_attach — link an EXISTING vault document into a trip's travel pack.
 *
 * Born from a live failure: "attach it to the travel pack!!!!!" and the
 * assistant, having no edit kind for it, proposed a calendar event and then
 * CLAIMED it had attached the paper — a promise with no code behind it, the
 * worst kind of refusal. This is the code behind the promise.
 *
 * Everything resolves by NAME, client-side and deterministically: the model
 * names a document (from FAMILY DATA's documents list) and optionally a trip
 * and role; ids never travel through the model. Anything that cannot be
 * resolved lands in `notes` so the Apply card can say what did NOT happen —
 * never a silent no-op.
 * ------------------------------------------------------------------------- */

const TRIP_ATTACH_ROLES: TripDocRole[] = ['ticket', 'accommodation', 'insurance', 'consent', 'birthCertificate', 'visa', 'passportCopy', 'other'];
/** Roles that belong to ONE person — mirror of TripPack's personal-role rule. */
const PERSONAL_TRIP_ROLES = new Set<TripDocRole>(['consent', 'birthCertificate', 'visa', 'passportCopy']);

function resolveVaultDocByName(docs: VaultDocument[], name: string): VaultDocument | undefined {
  const q = name.trim().toLowerCase();
  if (!q) return undefined;
  return docs.find(d => d.name.toLowerCase() === q)
    || docs.find(d => d.name.toLowerCase().startsWith(q))
    || docs.find(d => d.name.toLowerCase().includes(q))
    // The model sometimes returns a LONGER phrase than the stored name
    // ("the Parental Consent Affidavit for Ben" vs "Parental Consent
    // Affidavit - Ben SA Trip") — match the other direction too.
    || docs.find(d => q.includes(d.name.toLowerCase()) && d.name.length >= 8);
}

export interface TripAttachResult {
  events: CalendarEvent[];
  /** One sentence per edit that could NOT be applied (and why). */
  notes: string[];
  /** Human lines for what WAS attached — for the reply/toast. */
  attached: string[];
}

export function applyTripAttachEdits(
  events: CalendarEvent[],
  edits: AiEdit[],
  members: FamilyMember[],
  vaultDocs: VaultDocument[],
  now: Date = new Date(),
): TripAttachResult {
  let next = events;
  const notes: string[] = [];
  const attached: string[] = [];
  const today = now.toISOString().slice(0, 10);

  for (const e of edits) {
    if (e.kind !== 'trip_attach') continue;

    const doc = resolveVaultDocByName(vaultDocs, e.document || '');
    if (!doc) {
      notes.push(`Couldn't attach "${e.document}" — no document with that name is in the vault yet.`);
      continue;
    }

    // Trip resolution: an explicitly named trip first (title or destination,
    // case-insensitive substring), otherwise the current-or-next Travel event
    // — which is what "the travel pack", said today, means.
    const travelEvents = next.filter(ev => ev.category === 'Travel');
    let trip: CalendarEvent | undefined;
    if (e.trip && e.trip.trim()) {
      const q = e.trip.trim().toLowerCase();
      trip = travelEvents.find(ev => ev.title.toLowerCase().includes(q) || (ev.destination || '').toLowerCase().includes(q));
    }
    if (!trip) {
      trip = travelEvents
        .filter(ev => (ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date) >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
    }
    if (!trip) {
      notes.push(`Couldn't attach "${doc.name}" — no current or upcoming trip${e.trip ? ` matching "${e.trip}"` : ''} is on the calendar.`);
      continue;
    }

    // Role: the model's word if valid, else the same name-based suggestion the
    // pack's own picker uses, else the catch-all bucket.
    const role: TripDocRole = (TRIP_ATTACH_ROLES as string[]).includes(e.role || '')
      ? (e.role as TripDocRole)
      : (suggestTripRole(doc.name) ?? 'other');
    const memberId = PERSONAL_TRIP_ROLES.has(role)
      ? ((e.member ? resolveMember(members, e.member)?.id : undefined) ?? doc.memberId ?? undefined)
      : undefined;

    const tripId = trip.id;
    next = next.map(ev => {
      if (ev.id !== tripId) return ev;
      const existing = ev.tripDocs || [];
      // Same semantics as the pack's own attach (Dashboard.handleAttachTripDoc):
      // attach beats hide, identical refs never double up, and the update never
      // carries an explicit-undefined key (Firestore rejects those).
      const out = { ...ev };
      const hidden = (ev.tripDocsHidden || []).filter(id => id !== doc.id);
      if (hidden.length) out.tripDocsHidden = hidden; else delete out.tripDocsHidden;
      if (!existing.some(ref => ref.id === doc.id && ref.role === role && ref.memberId === memberId)) {
        out.tripDocs = [...existing, { id: doc.id, role, ...(memberId ? { memberId } : {}) }];
      }
      return out;
    });
    attached.push(`"${doc.name}" → ${trip.title}`);
  }
  return { events: next, notes, attached };
}

export const hasTripAttachEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'trip_attach');

/**
 * Which calendar edits in this batch are already on the calendar — so the
 * caller can SAY "that's already there" instead of showing an Apply that
 * appears to do nothing. Deliberately separate from applyCalendarEdits, which
 * must stay a pure list-in/list-out function.
 */
export function duplicateCalendarEdits(events: CalendarEvent[], edits: AiEdit[]): string[] {
  const candidates = edits
    .filter((e): e is Extract<AiEdit, { kind: 'calendar_event' }> => e.kind === 'calendar_event')
    .map(e => ({ title: e.title, date: e.date, time: e.time || undefined }));
  return partitionNewEvents(events, candidates).duplicates.map(c => c.title);
}

// The only 5 HouseholdInfo scalar fields the AI is ever allowed to write. AiEdit's
// TS type already narrows `field` to this same union, but that is compile-time
// only — edits arrive at runtime as JSON from the model, so a hallucinated or
// prompt-drift field name (e.g. 'alarmCode', which was briefly claimed as a valid
// write target in server.js's prompt despite HouseholdInfo never having had one;
// found in the 2026-08-15 chat-function audit) would otherwise be written as an
// untyped Firestore field with no UI ever reading it back. Every other AI-write
// path in this codebase (aiDestructive.ts's UPDATE_FIELDS) already whitelists
// like this; household_set was the one that didn't.
const HOUSEHOLD_SET_FIELDS = new Set([
  'address', 'doorCode', 'wifiName', 'wifiPassword', 'garageCode',
  // Locks & keys (see HouseholdInfo in types.ts). The three secret ones are
  // writable but never readable by the model — same split doorCode has had
  // since it shipped.
  'lockBrand', 'keyCardNumber', 'spareKeyWith', 'safeBrand', 'safeSerial', 'alarmProvider', 'alarmCode',
]);

// Apply household edits: set scalar fields (address, wifi, door code) or append to lists.
export function applyHouseholdEdits(h: HouseholdInfo, edits: AiEdit[]): HouseholdInfo {
  let next = { ...h };
  for (const e of edits) {
    if (e.kind === 'household_set') {
      if (!HOUSEHOLD_SET_FIELDS.has(e.field)) continue;
      // Guard: never let an empty value clobber an existing field.
      if (e.value && e.value.trim()) next = { ...next, [e.field]: e.value.trim() };
    } else if (e.kind === 'list_add') {
      if (e.list === 'vehicles') {
        // `kind` onto the closed VehicleKind set ("bike" → bicycle, "scooter"
        // → moped). A car arrives with no kind at all — absent means car — and
        // an unrecognised word ("boat") lands as 'other', never as raw text.
        const item: Record<string, unknown> = { ...e.item };
        if ('kind' in item) {
          const kind = normalizeVehicleKind(item.kind);
          if (kind && kind !== 'car') item.kind = kind; else delete item.kind;
        }
        next = { ...next, vehicles: [...(next.vehicles || []), { id: newId(), ...item } as any] };
      } else if (e.list === 'pets') {
        // list_add items are Record<string, string> — the model can only send
        // text. Pet.birthdateEstimated is the one BOOLEAN in any of these
        // lists, and spreading it raw would store the string "false", which is
        // truthy: a family that told the assistant the birthday was NOT a guess
        // would get "about 7" everywhere. Coerced here, at the one door the
        // model's version of a pet comes through.
        const item: Record<string, unknown> = { ...e.item };
        if ('birthdateEstimated' in item) {
          const raw = String(item.birthdateEstimated ?? '').trim().toLowerCase();
          if (raw === 'true' || raw === 'yes' || raw === '1') item.birthdateEstimated = true;
          else delete item.birthdateEstimated;
        }
        next = { ...next, pets: [...(next.pets || []), { id: newId(), ...item } as any] };
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

// Append a moment to the life timeline.
//
// `members` is a list of names ("Mia, Ben", "Mia and Ben"); none means the
// whole family. A name that matches nobody is dropped, not guessed at — the
// moment then shows as the whole family's, which is visible and editable,
// rather than silently landing on the wrong person — and the drop is REPORTED
// in `notes`, the same way applyMemberEdits reports a member it couldn't pin
// down, so the Apply card never says "done" about a tag that never happened.
//
// `date` may be a year or a month on its own ("2009", "2019-06") because that
// is often all anyone remembers; it is stored as the first of that period with
// its precision, so it sorts correctly and is shown as "2009", not "1 Jan 2009".
// A date in no recognisable shape is kept as undated, never invented. An
// explicit `datePrecision` of "month" or "year" may make a date COARSER (the
// model wrote "2019-01-01" but meant "2019"), never finer; any other value is
// ignored.
//
// The stored row is built from a whitelist — nothing else the model puts in
// `item` reaches the store (not an id, not photos, not an importBatchId) — and
// is marked source: 'assistant', so it can be told apart from a moment typed
// by hand or imported.
export function applyTimelineEdits(
  t: FamilyTimeline, edits: AiEdit[], members: FamilyMember[] = [],
): { timeline: FamilyTimeline; notes: string[] } {
  const added: TimelineEntry[] = [];
  const notes: string[] = [];
  for (const e of edits) {
    if (e.kind !== 'list_add' || e.list !== 'timeline') continue;
    const item = e.item || {};
    const title = (item.title || '').trim();
    if (!title) continue;

    const parsed = parseLifeDate(item.date);
    const askedPrecision = String(item.datePrecision || '').trim().toLowerCase();
    let { date, datePrecision } = parsed;
    if (date && askedPrecision === 'year' && datePrecision !== 'year') {
      date = `${date.slice(0, 4)}-01-01`;
      datePrecision = 'year';
    } else if (date && askedPrecision === 'month' && !datePrecision) {
      date = `${date.slice(0, 7)}-01`;
      datePrecision = 'month';
    }

    const asked = item.category || item.type || '';
    const category: LifeCategory = lifeCategoryFromWord(asked) || (asked.trim() ? 'other' : 'memory');

    const names = (item.members || '')
      .split(/\s*(?:,|;|&|\band\b)\s*/i)
      .map(n => n.trim())
      .filter(Boolean);
    const memberIds: string[] = [];
    const unknown: string[] = [];
    for (const n of names) {
      const id = resolveMember(members, n)?.id;
      if (id) { if (!memberIds.includes(id)) memberIds.push(id); }
      else unknown.push(n);
    }
    if (unknown.length) {
      notes.push(`Added “${title}” to the timeline, but couldn't tell who ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'}, so it isn't tagged to ${unknown.length === 1 ? 'them' : 'those names'}.`);
    }

    const endDate = !datePrecision && /^\d{4}-\d{2}-\d{2}$/.test(item.endDate || '') && item.endDate > date
      ? item.endDate
      : undefined;

    added.push({
      id: newId(),
      date,
      title,
      category,
      ...(datePrecision ? { datePrecision } : {}),
      ...(memberIds.length ? { memberIds } : {}),
      ...(endDate ? { endDate } : {}),
      ...(item.place?.trim() ? { place: item.place.trim() } : {}),
      ...(item.note?.trim() ? { note: item.note.trim() } : {}),
      source: 'assistant',
    });
  }
  return { timeline: { ...t, entries: [...(t.entries || []), ...added] }, notes };
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

// Add recipes from AI edits. photoUrl (when present) was already uploaded to
// Storage client-side before this runs — the model itself never supplies it.
export const hasRecipeEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'recipe');

export function applyRecipeEdits(recipes: Recipe[], edits: AiEdit[]): Recipe[] {
  const today = new Date().toISOString().slice(0, 10);
  const added: Recipe[] = edits
    .filter((e): e is Extract<AiEdit, { kind: 'recipe' }> => e.kind === 'recipe' && !!e.title)
    .map(e => ({
      id: newId(),
      title: e.title,
      ingredients: Array.isArray(e.ingredients) ? e.ingredients.filter(Boolean) : [],
      steps: Array.isArray(e.steps) ? e.steps.filter(Boolean) : [],
      tags: e.tags && e.tags.length ? e.tags : undefined,
      photoUrl: e.photoUrl || undefined,
      createdAt: today,
    }));
  return [...recipes, ...added];
}

// Add anniversaries/special days from AI edits. `anniversaryKind` degrades to
// 'Other' for anything the model invents that isn't one of the five valid
// values — same defensive pattern applyMemberEdits below uses for
// asset/timeline categories the AI might get wrong. memberNames resolves to
// memberIds the same way applyCalendarEdits above does. `date` must already
// be 'MM-DD' — an edit whose date isn't that shape is dropped rather than
// filed as a broken recurring record (it would either never fire or fire on
// the wrong day forever, unlike a one-off calendar_event a user can just
// re-edit).
export const hasAnniversaryEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'anniversary');

const VALID_ANNIVERSARY_KINDS: AnniversaryKind[] = ['Wedding', 'Engagement', 'Adoption', 'Anniversary', 'Other'];

export function applyAnniversaryEdits(anniversaries: AnniversaryRecord[], edits: AiEdit[], members: FamilyMember[]): AnniversaryRecord[] {
  const today = new Date().toISOString().slice(0, 10);
  const added: AnniversaryRecord[] = [];
  for (const e of edits) {
    if (e.kind !== 'anniversary') continue;
    const title = (e.title || '').trim();
    if (!title || !/^\d{2}-\d{2}$/.test(e.date || '')) continue;
    const memberIds = (e.memberNames || [])
      .map(n => resolveMember(members, n)?.id)
      .filter((id): id is string => Boolean(id));
    added.push({
      id: newId(),
      title,
      kind: VALID_ANNIVERSARY_KINDS.includes(e.anniversaryKind as AnniversaryKind) ? (e.anniversaryKind as AnniversaryKind) : 'Other',
      date: e.date,
      originalYear: (typeof e.originalYear === 'number' && Number.isInteger(e.originalYear)) ? e.originalYear : undefined,
      memberIds: memberIds.length ? memberIds : undefined,
      notes: e.notes?.trim() || undefined,
      createdAt: today,
    });
  }
  return [...anniversaries, ...added];
}

/* Extended birthdays — a birthday for someone who isn't a family member.
 *
 * Same shape as applyAnniversaryEdits above, and the same MM-DD discipline:
 * an edit whose date isn't a bare month-day is DROPPED rather than coerced,
 * because the model occasionally supplies a full YYYY-MM-DD and silently
 * slicing it would put a made-up birth year on the record when what we want is
 * originalYear left empty. DEDUPE against what's already on file — the model
 * is shown the existing list, but a family who mentions Granny's birthday
 * twice in two sessions must not end up with two Grannys. */
/* A `contact` edit carrying a birthdate, normalised into the same shape.
 *
 * The prompt no longer asks for that field and applyInfoEdits no longer writes
 * it, but a model that volunteered one anyway would otherwise have the birthday
 * silently dropped — worse than the bug being fixed, because the family would
 * have been told it was saved. So it is re-routed to its proper home instead.
 * Only a full YYYY-MM-DD counts, which is what the old field always held. */
function contactBirthdayAsEdit(e: AiEdit): Extract<AiEdit, { kind: 'extended_birthday' }> | null {
  if (e.kind !== 'contact') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((e.birthdate || '').trim());
  if (!m || !(e.name || '').trim()) return null;
  return {
    kind: 'extended_birthday',
    name: e.name,
    relationship: e.relation,
    date: `${m[2]}-${m[3]}`,
    originalYear: Number(m[1]),
  };
}

export const hasExtendedBirthdayEdits = (edits: AiEdit[]) =>
  edits.some(e => e.kind === 'extended_birthday' || contactBirthdayAsEdit(e));

export function applyExtendedBirthdayEdits(
  extendedBirthdays: ExtendedBirthday[],
  edits: AiEdit[],
): ExtendedBirthday[] {
  const today = new Date().toISOString().slice(0, 10);
  const out = [...extendedBirthdays];
  const seen = new Set(out.map(eb => `${(eb.name || '').trim().toLowerCase()}|${eb.date}`));

  for (const raw of edits) {
    const e = raw.kind === 'extended_birthday' ? raw : contactBirthdayAsEdit(raw);
    if (!e) continue;
    const name = (e.name || '').trim();
    if (!name || !/^\d{2}-\d{2}$/.test(e.date || '')) continue;

    const key = `${name.toLowerCase()}|${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: newId(),
      name,
      relationship: e.relationship?.trim() || undefined,
      date: e.date,
      originalYear: (typeof e.originalYear === 'number' && Number.isInteger(e.originalYear)) ? e.originalYear : undefined,
      notes: e.notes?.trim() || undefined,
      createdAt: today,
    });
  }
  return out;
}

// Add slips ("Keep the slip") from AI edits. photoUrl/photoStoragePath (when
// present) were already uploaded to Storage client-side before this runs —
// the model itself never supplies them. currency is validated against the
// same list Assets uses, falling back to EUR for an unrecognised value.
export const hasSlipEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'slip');

const SLIP_CURRENCIES = ['EUR', 'GBP', 'USD', 'ZAR', 'CHF'];

export function applySlipEdits(slips: SlipItem[], edits: AiEdit[]): SlipItem[] {
  const today = new Date().toISOString().slice(0, 10);
  const added: SlipItem[] = edits
    .filter((e): e is Extract<AiEdit, { kind: 'slip' }> => e.kind === 'slip' && !!e.item)
    .map(e => ({
      id: newId(),
      shop: e.shop || undefined,
      item: e.item,
      purchaseDate: e.purchaseDate || undefined,
      amount: e.amount || undefined,
      currency: e.currency && SLIP_CURRENCIES.includes(e.currency) ? e.currency : 'EUR',
      assignedTo: e.assignedTo || undefined,
      // A till slip almost never prints a return-by date, so the model has
      // nothing to extract and left this blank — which meant an AI-filed slip
      // carried NO return clock, produced no nudge, and the feature's whole
      // point ("photograph it, get reminded before the window shuts") silently
      // did nothing. Fall back to the same editable purchase-date + 30 days
      // suggestion the manual form already offers. It is a starting point the
      // user can change, never a claim about their rights — shop policy varies
      // and consumer law differs between Austria and South Africa.
      returnByDate: e.returnByDate || suggestReturnBy(e.purchaseDate),
      warrantyUntil: e.warrantyUntil || undefined,
      notes: e.notes || undefined,
      photoUrl: e.photoUrl || undefined,
      photoStoragePath: e.photoStoragePath || undefined,
      createdAt: today,
    }));
  return [...slips, ...added];
}
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

// Wills & estate — capture ONLY what the user states (which document, whose,
// where the signed original is, who to call, when last reviewed). Never the
// document's legal content; see server.js's system prompt for that boundary.
export const hasEstateEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'estate_record');

export function applyEstateEdits(records: EstateRecord[], edits: AiEdit[]): EstateRecord[] {
  const added: EstateRecord[] = [];
  for (const e of edits) {
    if (e.kind !== 'estate_record') continue;
    const docKind = (e.docKind || '').trim();
    if (!docKind) continue;
    added.push({
      id: newId(),
      kind: docKind,
      forMember: e.forMember?.trim() || undefined,
      originalLocation: e.originalLocation?.trim() || undefined,
      heldBy: e.heldBy?.trim() || undefined,
      notaryName: e.notaryName?.trim() || undefined,
      notaryPhone: e.notaryPhone?.trim() || undefined,
      executor: e.executor?.trim() || undefined,
      lastReviewed: (e.lastReviewed && /^\d{4}-\d{2}-\d{2}$/.test(e.lastReviewed)) ? e.lastReviewed : undefined,
      notes: e.notes?.trim() || undefined,
    });
  }
  return [...records, ...added];
}

// --- Who takes over, and what to do (siblings of `records` on WillsEstateDoc) ---
// Same store-and-recall boundary as applyEstateEdits: record what the user says,
// never advise. `successor` is a single record, so it is LAST-WRITE-WINS —
// naming a new person replaces the old one rather than accumulating, which is
// what "who takes over" means. `instructions` patches its scalars and APPENDS to
// its two lists, so saying "also tell my landlord" adds rather than replaces.
export const hasSuccessorEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'designated_successor');

export function applySuccessorEdit(
  current: DesignatedSuccessor | undefined,
  edits: AiEdit[],
): DesignatedSuccessor | undefined {
  let next = current;
  for (const e of edits) {
    if (e.kind !== 'designated_successor') continue;
    const name = (e.name || '').trim();
    if (!name) continue;
    next = {
      name,
      // Keep the existing brief when the user only renames the person.
      whatTheyShouldDo: e.whatTheyShouldDo?.trim() || (name === current?.name ? current?.whatTheyShouldDo || '' : ''),
      memberId: name === current?.name ? current?.memberId : undefined,
      setAt: new Date().toISOString(),
    };
  }
  return next;
}

// The one-line family status (the "fridge whiteboard", HubSettings.status).
// REPLACES rather than accumulates — mirrors household_set's single-field
// semantics, not designated_successor's "keep what wasn't mentioned" merge,
// because this field has no sibling scalars to preserve.
export const hasStatusEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'hub_status');

export function applyStatusEdit(
  current: HubSettings['status'],
  edits: AiEdit[],
  authorName: string,
): HubSettings['status'] {
  let next = current;
  for (const e of edits) {
    if (e.kind !== 'hub_status') continue;
    const text = (e.text || '').trim();
    // An empty text isn't "clear the status" here — clear_field already
    // covers deliberate clearing everywhere else in this pipeline, and a
    // blank hub_status is far more likely to be a malformed edit than intent.
    if (!text) continue;
    next = { text, by: authorName, at: new Date().toISOString() };
  }
  return next;
}

export const hasInstructionsEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'emergency_instructions');

export function applyInstructionsEdit(
  current: EmergencyInstructions | undefined,
  edits: AiEdit[],
): EmergencyInstructions | undefined {
  let next: EmergencyInstructions | undefined = current;
  for (const e of edits) {
    if (e.kind !== 'emergency_instructions') continue;
    const base: EmergencyInstructions = next ? { ...next } : {};
    if (e.keysAndSafes?.trim()) base.keysAndSafes = e.keysAndSafes.trim();
    if (e.letter?.trim()) base.letter = e.letter.trim();
    const contacts = (e.notifyContacts || []).filter(c => c && (c.name || '').trim());
    if (contacts.length) {
      base.notifyContacts = [
        ...(base.notifyContacts || []),
        ...contacts.map(c => ({
          id: newId(),
          name: c.name.trim(),
          relation: c.relation?.trim() || undefined,
          phone: c.phone?.trim() || undefined,
          email: c.email?.trim() || undefined,
          notes: c.notes?.trim() || undefined,
        })),
      ];
    }
    const accounts = (e.accountsToClose || []).filter(a => a && (a.name || '').trim());
    if (accounts.length) {
      base.accountsToClose = [
        ...(base.accountsToClose || []),
        ...accounts.map(a => ({
          id: newId(),
          name: a.name.trim(),
          accountRef: a.accountRef?.trim() || undefined,
          notes: a.notes?.trim() || undefined,
        })),
      ];
    }
    base.updatedAt = new Date().toISOString();
    next = base;
  }
  return next;
}

// --- Vehicle service history (scanned service booklet / workshop invoice) ---
// Appends ServiceRecord(s) onto an EXISTING vehicle's serviceLog. The vehicle is
// matched by VIN, then registration plate, then name — all normalised (uppercase,
// non-alphanumerics stripped) so "W 12345 X" == "W-12345X" and a VIN copied with
// stray spaces still lands. Store-and-recall only: records exactly what the doc
// shows, no interpretation. Freshens lastService to the newest record date so the
// existing next-service reminder stays accurate (mirrors VehiclesView.addRecord).
// Returns { vehicles, matched, unmatched } — `unmatched` lists the plate/vehicle
// tokens whose records found no vehicle, so the caller can tell the user rather
// than silently dropping the data (service records need a vehicle to attach to).
type ServiceVehicle = NonNullable<HouseholdInfo['vehicles']>[number];
const normVehicleKey = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const hasServiceRecordEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'service_record');

export function applyServiceRecordEdits(
  vehicles: ServiceVehicle[],
  edits: AiEdit[],
): { vehicles: ServiceVehicle[]; matched: number; unmatched: string[] } {
  const next = [...vehicles];
  const unmatched: string[] = [];
  let matched = 0;
  for (const e of edits) {
    if (e.kind !== 'service_record') continue;
    const recs = (e.records || [])
      .filter(r => r && (r.work || '').trim())
      .map(r => ({
        id: newId(),
        date: (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : new Date().toISOString().slice(0, 10),
        work: r.work.trim(),
        odometer: r.odometer?.trim() || undefined,
        cost: r.cost?.trim() || undefined,
        garage: r.garage?.trim() || undefined,
        notes: r.notes?.trim() || undefined,
      }));
    if (!recs.length) continue;
    const vin = normVehicleKey(e.vin);
    const plate = normVehicleKey(e.plate);
    const name = (e.vehicle || '').trim().toLowerCase();
    let idx = -1;
    if (vin) idx = next.findIndex(v => normVehicleKey(v.vin) && normVehicleKey(v.vin) === vin);
    if (idx < 0 && plate) idx = next.findIndex(v => normVehicleKey(v.registration) && normVehicleKey(v.registration) === plate);
    if (idx < 0 && name) idx = next.findIndex(v =>
      (v.name || '').trim().toLowerCase() === name ||
      `${v.make || ''} ${v.model || ''}`.trim().toLowerCase() === name);
    // Single-car convenience: an unqualified service doc (no plate/VIN/name) with
    // exactly one vehicle on file attaches to it.
    if (idx < 0 && !vin && !plate && !name && next.length === 1) idx = 0;
    if (idx < 0) { unmatched.push(e.plate || e.vin || e.vehicle || 'an unknown vehicle'); continue; }
    const veh = next[idx];
    const log = [...(veh.serviceLog || []), ...recs];
    const newest = recs.reduce((mx, r) => (r.date > mx ? r.date : mx), veh.lastService || '');
    next[idx] = { ...veh, serviceLog: log, lastService: newest || veh.lastService };
    matched += recs.length;
  }
  return { vehicles: next, matched, unmatched };
}

// --- Pet medical history ---------------------------------------------------
// The animal's version of a service log. Same shape as the two above and,
// like the house one, nothing can fail to land in the same way a vehicle
// service record can — except that here there IS something to match against,
// because a family has more than one pet.
//
// MATCHING IS BY NAME AND MUST NOT GUESS. Pets are almost always named, the
// name is what the family says out loud ("Buddy had his rabies jab"), and
// there is no plate or VIN to fall back on. So the match is normalised
// (case, spacing) but never fuzzy: a record for a pet that isn't on file is
// returned as `unmatched` rather than dropped or filed against whichever pet
// happens to be first. A vet bill silently attached to the wrong animal is
// worse than one that didn't save, because nobody goes looking for it.
//
// The single-pet case is the exception, and a deliberate one: if the family
// has exactly one pet and the model named nobody, the record is theirs. There
// is no ambiguity to resolve.
export const hasPetHealthEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'pet_health');

const normPetName = (s?: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function applyPetHealthEdits(
  household: HouseholdInfo,
  edits: AiEdit[],
): { household: HouseholdInfo; matched: number; unmatched: string[] } {
  const pets = household.pets || [];
  const additions = new Map<string, PetHealthRecord[]>();
  const unmatched: string[] = [];
  let matched = 0;

  for (const e of edits) {
    if (e.kind !== 'pet_health') continue;
    for (const r of e.records || []) {
      const what = (r?.what || '').trim();
      if (!what) continue;   // an entry with nothing that happened is not a record

      const named = normPetName(r.pet);
      const hit = named
        ? pets.find(p => normPetName(p.name) === named)
        : (pets.length === 1 ? pets[0] : undefined);

      if (!hit) {
        unmatched.push(r.pet?.trim() || what);
        continue;
      }
      matched += 1;

      const rec: PetHealthRecord = {
        id: newId(),
        date: (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : new Date().toISOString().slice(0, 10),
        what,
        type: r.type?.trim() || undefined,
        vet: r.vet?.trim() || undefined,
        cost: r.cost?.trim() || undefined,
        // A next-due date that isn't a date is not a date. Same rule the
        // house log applies to warrantyUntil — better absent than invented.
        nextDue: (r.nextDue && /^\d{4}-\d{2}-\d{2}$/.test(r.nextDue)) ? r.nextDue : undefined,
        notes: r.notes?.trim() || undefined,
      };
      additions.set(hit.id, [...(additions.get(hit.id) || []), rec]);
    }
  }

  if (additions.size === 0) return { household, matched, unmatched };

  // Spread both the document AND each pet — HouseholdInfo is a merged shared
  // doc, and a rebuilt-by-key pet would silently delete every field this
  // function doesn't happen to name. That is the v236 lesson, and a pet now
  // has twenty-five fields for it to eat.
  return {
    household: {
      ...household,
      pets: pets.map(p => (
        additions.has(p.id)
          ? { ...p, healthLog: [...(p.healthLog || []), ...additions.get(p.id)!] }
          : p
      )),
    },
    matched,
    unmatched,
  };
}

// --- House service history (what the plumber/electrician actually did) ------
// The property's version of the above. There is only one house, so there is
// nothing to match against and nothing that can fail to land — the entire
// unmatched/throw machinery of applyServiceRecordEdits has no equivalent here.
//
// `by` is resolved against the vendor directory when one is supplied, ONLY to
// stamp vendorId and to borrow their canonical trade. The name is stored on
// the record regardless: see HomeServiceRecord in types.ts for why a service
// log must not go blank when a vendor row is deleted years later.
//
// Deliberately does not touch the vendor's own lastServiceDate. One fact, one
// writer — that is v228's lesson and it applies here exactly.
export const hasHomeServiceEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'home_service');

const normVendorName = (s?: string) => (s || '').trim().toLowerCase();

export function applyHomeServiceEdits(
  household: HouseholdInfo,
  edits: AiEdit[],
  vendors: HouseholdVendor[] = [],
): HouseholdInfo {
  const recs: HomeServiceRecord[] = [];
  for (const e of edits) {
    if (e.kind !== 'home_service') continue;
    for (const r of e.records || []) {
      const work = (r?.work || '').trim();
      if (!work) continue;   // an entry with no work done is not a record of anything
      const by = r.by?.trim() || undefined;
      // Match on the person's name OR their firm — a family says "Hofer" for
      // both, and which one is in the directory's `name` field is a coin flip.
      const hit = by
        ? vendors.find(v => normVendorName(v.name) === normVendorName(by))
          ?? vendors.find(v => v.company && normVendorName(v.company) === normVendorName(by))
        : undefined;
      // The model's word wins when it gave one; the linked vendor's trade only
      // fills a blank. Someone's usual plumber can turn up to fit a radiator.
      const trade = r.trade ? matchVendorTrade(r.trade).trade : hit?.trade;
      const unmatched = r.trade ? matchVendorTrade(r.trade).unmatched : undefined;
      const notes = [r.notes?.trim(), unmatched ? `Trade: ${unmatched}` : ''].filter(Boolean).join(' · ');
      recs.push({
        id: newId(),
        date: (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : new Date().toISOString().slice(0, 10),
        work,
        by,
        trade,
        vendorId: hit?.id,
        area: r.area?.trim() || undefined,
        cost: r.cost?.trim() || undefined,
        warrantyUntil: (r.warrantyUntil && /^\d{4}-\d{2}-\d{2}$/.test(r.warrantyUntil)) ? r.warrantyUntil : undefined,
        notes: notes || undefined,
      });
    }
  }
  if (!recs.length) return household;
  // Spread, never a key list — HouseholdInfo is a merged shared doc and every
  // key this function fails to name would be read as a deletion on save.
  return { ...household, homeServiceLog: [...(household.homeServiceLog || []), ...recs] };
}
