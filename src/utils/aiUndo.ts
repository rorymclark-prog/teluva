// Undo-manifest model + before/after diffing for the AI Apply flow.
//
// WHY this lives here and not in aiApply.ts: the apply functions in aiApply.ts
// are PURE and mint their record ids internally (newId()), returning only the
// whole next-collection — so the ids of the records an Apply *created* are not
// recoverable from their return value without rewriting that shared file. The
// honest, non-invasive way to learn which records were minted is to diff the
// collection BEFORE the apply against the collection AFTER it, which is exactly
// what Dashboard.handleApplyAiEdits already holds for every domain. These pure
// diff helpers turn that before/after pair into a durable UndoRecord[] that can
// later delete precisely those records — nothing more.
//
// Filing is append-only and every record is minted with a fresh id, so a new id
// present in "after" but not "before" is unambiguously a record this Apply
// created. Field-set edits (member scalar fields, household_set, cv merges)
// MUTATE existing records in place and cannot be reversed by id — they are
// deliberately excluded from the manifest and counted separately so the UI can
// say plainly that they stay.

import type {
  FamilyMember, FamilyInfo, HouseholdInfo, FinancesInfo,
} from '../types';
import type { AiEdit } from '../components/AIChatbot';

// Which store a created record lives in — drives how handleUndoAiEdits reverses it.
export type UndoDomain =
  | 'member' | 'memberNested' | 'transitPass' | 'vaccination' | 'visa' | 'serviceRecord'
  | 'contact' | 'number' | 'provider'
  | 'calendar' | 'vehicle' | 'pet' | 'utility'
  | 'bank' | 'insurance' | 'benefit'
  | 'timeline' | 'familyWord' | 'shopping' | 'asset' | 'recipe' | 'slip' | 'estate'
  | 'document';

// Nested arrays hanging off a FamilyMember that Apply can append to.
export type MemberNestedCollection = 'passports' | 'sayings' | 'favoriteQuotes' | 'careSchedule';

export interface UndoRecord {
  domain: UndoDomain;
  id: string;                        // the id of the record that was created
  memberId?: string;                 // parent member (memberNested / transitPass) or document owner
  parentId?: string;                 // parent vehicle id (serviceRecord)
  collection?: MemberNestedCollection; // which nested array (memberNested only)
  label: string;                     // short human summary, display-only
}

interface HasId { id: string }

// New ids in `after` that weren't in `before` — the records this Apply created.
export function diffNewIds<T extends HasId>(before: T[] | undefined, after: T[] | undefined): T[] {
  const beforeIds = new Set((before || []).map((x) => x && x.id).filter(Boolean));
  return (after || []).filter((x) => x && x.id && !beforeIds.has(x.id));
}

// Convenience for the single-array stores (calendar, timeline, shopping, …).
export function mapNewIds<T extends HasId>(
  before: T[] | undefined,
  after: T[] | undefined,
  domain: UndoDomain,
  label: (x: T) => string,
): UndoRecord[] {
  return diffNewIds(before, after).map((x) => ({ domain, id: x.id, label: label(x) || domain }));
}

function nestedLabel(col: MemberNestedCollection, m: FamilyMember, rec: any): string {
  const who = (m.nickname || m.name || 'Someone').trim();
  if (col === 'passports') return `${who}: ${(rec.country || '').trim()} passport`.trim();
  if (col === 'sayings') return `${who}: saying`;
  if (col === 'favoriteQuotes') return `${who}: quote`;
  if (col === 'careSchedule') return `${who}: ${(rec.kind || 'care').trim()}`;
  return who;
}

// Members are a compound store: a brand-new member undoes as a whole profile;
// records appended to an EXISTING member (passports/sayings/quotes/care/transit
// passes) undo individually. New members never carry separate nested records in
// the manifest — removing the profile takes their nested rows with it — so this
// only diffs nested arrays for members that already existed before the Apply.
export function diffMemberUndo(before: FamilyMember[], after: FamilyMember[]): UndoRecord[] {
  const out: UndoRecord[] = [];
  const beforeById = new Map(before.map((m) => [m.id, m]));
  for (const m of after) {
    const prev = beforeById.get(m.id);
    if (!prev) {
      out.push({ domain: 'member', id: m.id, label: (m.nickname || m.name || 'new member').trim() });
      continue;
    }
    const cols: MemberNestedCollection[] = ['passports', 'sayings', 'favoriteQuotes', 'careSchedule'];
    for (const col of cols) {
      for (const rec of diffNewIds((prev as any)[col], (m as any)[col])) {
        out.push({ domain: 'memberNested', id: rec.id, memberId: m.id, collection: col, label: nestedLabel(col, m, rec) });
      }
    }
    for (const rec of diffNewIds(prev.travel?.transitPasses, m.travel?.transitPasses)) {
      out.push({ domain: 'transitPass', id: rec.id, memberId: m.id, label: `${(m.nickname || m.name || '').trim()}: ${(rec as any).name || 'travel pass'}` });
    }
    // Vaccinations and visas were the two nested collections v145-v148 made
    // filable and deletable by the assistant (see MEMBER_ARRAY in
    // aiDestructive.ts) without ever being added HERE — so "Apply" recorded no
    // undo entry for either, and a card that says "Undo this" quietly did
    // nothing for the record it names. Same shape as the transitPass block
    // above, because the bug was that this block was never extended to match it.
    const who = (m.nickname || m.name || '').trim();
    for (const rec of diffNewIds(prev.medical?.vaccinations, m.medical?.vaccinations)) {
      out.push({ domain: 'vaccination', id: rec.id, memberId: m.id, label: `${who}: ${(rec as any).name || 'vaccination'}` });
    }
    for (const rec of diffNewIds(prev.travel?.visas, m.travel?.visas)) {
      out.push({ domain: 'visa', id: rec.id, memberId: m.id, label: `${who}: ${(rec as any).country ? `${(rec as any).country} visa` : 'visa'}` });
    }
  }
  return out;
}

export function diffInfoUndo(before: FamilyInfo, after: FamilyInfo): UndoRecord[] {
  return [
    ...mapNewIds(before.contacts, after.contacts, 'contact', (c: any) => c.name || 'contact'),
    ...mapNewIds(before.numbers, after.numbers, 'number', (n: any) => n.label || 'number'),
    ...mapNewIds(before.providers, after.providers, 'provider', (p: any) => p.name || 'provider'),
  ];
}

// Household is compound too: new vehicles/pets/utilities undo as whole rows;
// service records appended onto an EXISTING vehicle's serviceLog undo one at a
// time (parentId = that vehicle). A service record added to a vehicle created in
// the same batch is skipped here — undoing the new vehicle row removes it.
export function diffHouseholdUndo(before: HouseholdInfo, after: HouseholdInfo): UndoRecord[] {
  const out: UndoRecord[] = [];
  out.push(...mapNewIds(before.vehicles, after.vehicles, 'vehicle', (v: any) => v.name || `${v.make || ''} ${v.model || ''}`.trim() || 'vehicle'));
  out.push(...mapNewIds(before.pets, after.pets, 'pet', (p: any) => p.name || 'pet'));
  out.push(...mapNewIds(before.utilities, after.utilities, 'utility', (u: any) => u.name || u.provider || 'utility'));
  const beforeVeh = new Map((before.vehicles || []).map((v) => [v.id, v]));
  for (const v of after.vehicles || []) {
    const prev = beforeVeh.get(v.id);
    if (!prev) continue; // brand-new vehicle — its whole row undoes above
    for (const rec of diffNewIds(prev.serviceLog, v.serviceLog)) {
      out.push({ domain: 'serviceRecord', id: rec.id, parentId: v.id, label: `${(v.name || 'vehicle').trim()}: ${(rec as any).work || 'service'}` });
    }
  }
  return out;
}

export function diffFinancesUndo(before: FinancesInfo, after: FinancesInfo): UndoRecord[] {
  return [
    ...mapNewIds(before.banks, after.banks, 'bank', (b: any) => b.name || b.bankName || 'bank'),
    ...mapNewIds(before.insurance, after.insurance, 'insurance', (i: any) => i.name || i.provider || 'insurance'),
    ...mapNewIds(before.benefits, after.benefits, 'benefit', (b: any) => b.name || b.type || 'benefit'),
  ];
}

// Field-set edits mutate existing records in place, so they cannot be reversed
// by deleting a created id. Count them so the Undo affordance can say plainly
// that these particular changes remain (e.g. "Sophie's shoe size stays set").
export function countIrreversibleEdits(edits: AiEdit[]): number {
  return edits.filter((e) => e.kind === 'member' || e.kind === 'household_set' || e.kind === 'cv').length;
}

// --- Where-it-landed (task A) -----------------------------------------------
// A short, display-only destination line per applied edit, e.g.
//   "Sophie's profile · ID & Passports"  or  "Document Vault (Identity)".
// `resolveName` maps a member reference to the person's display name (or
// undefined) — the same owner resolution Apply already uses; passed in so this
// stays a pure function with no dependency on component state.
export function landingLabel(e: AiEdit, resolveName: (n?: string) => string | undefined): string {
  const who = (n?: string) => resolveName(n) || (n || '').trim() || 'someone';
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  switch (e.kind) {
    case 'new_member': return `New ${(e.role || 'member').toLowerCase()} profile`;
    case 'member': return `${who(e.member)}'s profile`;
    case 'passport': return `${who(e.member)}'s profile · ID & Passports`;
    case 'contact': return 'Contacts';
    case 'provider': return 'Providers & services';
    case 'number': return 'Important numbers';
    case 'document': {
      const owner = resolveName(e.member);
      return owner
        ? `${owner}'s profile · Document Vault (${e.category})`
        : `Document Vault (${e.category})`;
    }
    case 'calendar_event': return 'Calendar';
    case 'list_add': {
      if (e.list === 'vehicles' || e.list === 'pets' || e.list === 'utilities') return `Household · ${cap(e.list)}`;
      if (e.list === 'banks' || e.list === 'insurance' || e.list === 'benefits') return `Finances · ${cap(e.list)}`;
      if (e.list === 'timeline') return 'Family timeline';
      if (e.list === 'shopping') return 'Shopping list';
      return 'Saved';
    }
    case 'household_set': return 'Household';
    case 'asset': return 'Assets';
    case 'recipe': return 'Recipes';
    case 'slip': return 'Slips';
    case 'transit_pass': return `${who(e.member)}'s profile · Travel`;
    case 'care_schedule': return `${who(e.member)}'s profile · Care schedule`;
    case 'saying': return `${who(e.member)}'s profile · Sayings`;
    case 'favorite_quote': return `${who(e.member)}'s profile · Favourite quotes`;
    case 'family_word': return 'Family dictionary';
    case 'cv': return `${who(e.member)}'s profile · CV`;
    case 'estate_record': return 'Wills & estate';
    case 'service_record': return 'Household · vehicle service history';
    default: return 'Saved';
  }
}
