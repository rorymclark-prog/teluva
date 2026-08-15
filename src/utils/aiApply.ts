import { FamilyMember, FamilyInfo, MemberRole, CalendarEvent, HouseholdInfo, FinancesInfo, FamilyTimeline, ShoppingItem, FamilyWord, HealthcareProvider, Recipe, CvRole, CvEducationEntry, CvQualification, EstateRecord, SlipItem, DesignatedSuccessor, EmergencyInstructions, HubSettings } from '../types';
import type { AiEdit } from '../components/AIChatbot';
import { suggestReturnBy } from './slip';
import { AVATAR_COLORS } from './avatarPalette';
import { partitionNewEvents } from './calendarDedup';
import { isValidNameDay } from './nameDay';

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
  for (const e of edits) {
    if (e.kind === 'new_member' && e.name) {
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

// Apply contact + number + provider edits onto the shared family info doc.
export function applyInfoEdits(info: FamilyInfo, edits: AiEdit[]): FamilyInfo {
  const numbers = [...(info.numbers || [])];
  const contacts = [...(info.contacts || [])];
  const providers = [...(info.providers || [])];
  for (const e of edits) {
    if (e.kind === 'contact') {
      // birthdate lets a contact who isn't a full family member (a
      // grandparent, godparent, etc.) still surface a birthday nudge.
      contacts.push({ id: newId(), name: e.name, relation: e.relation, phone: e.phone, email: e.email, birthdate: e.birthdate });
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
    }
  }
  return { numbers, contacts, providers };
}

export const hasMemberEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'member' || e.kind === 'passport' || e.kind === 'new_member' || e.kind === 'transit_pass' || e.kind === 'care_schedule' || e.kind === 'saying' || e.kind === 'favorite_quote' || e.kind === 'cv' || e.kind === 'vaccination' || e.kind === 'visa' || e.kind === 'clear_field');
export const hasInfoEdits = (edits: AiEdit[]) => edits.some(e => e.kind === 'contact' || e.kind === 'number' || e.kind === 'provider');

const VALID_CALENDAR_CATS = ['Milestone', 'Appointment', 'School', 'Travel', 'Other'] as const;
type CalendarCat = typeof VALID_CALENDAR_CATS[number];

// Add calendar events from AI edits, resolving memberNames to memberIds.
//
// Skips anything already on the calendar at the same date, time and title.
// Without that check, applying the same suggestion twice — asking again, or
// tapping Apply again — silently made a second copy, which is how one live
// vault ended up with four identical "Re-test Ferritin and Vitamin D" entries
// twelve minutes apart. See utils/calendarDedup.ts.
export function applyCalendarEdits(events: CalendarEvent[], edits: AiEdit[], members: FamilyMember[]): CalendarEvent[] {
  const candidates: CalendarEvent[] = [];
  for (const e of edits) {
    if (e.kind !== 'calendar_event') continue;
    const cat: CalendarCat = (VALID_CALENDAR_CATS as readonly string[]).includes(e.category || '')
      ? (e.category as CalendarCat)
      : 'Other';
    const memberIds = (e.memberNames || [])
      .map(n => members.find(m => m.name.toLowerCase() === n.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id));
    candidates.push({
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
  const { fresh } = partitionNewEvents(events, candidates);
  return [...events, ...fresh];
}

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
const HOUSEHOLD_SET_FIELDS = new Set(['address', 'doorCode', 'wifiName', 'wifiPassword', 'garageCode']);

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
