import { MedicineCabinetItem, MedicineCategory } from '../types';
import { parseDateOnly, todayISO } from './age';

// ---------------------------------------------------------------------------
// The medicine cabinet's rules, kept out of the screen so the screen, the
// reminder engine and the assistant's apply path all read a shelf the same way.
//
// What is STORED is what the family typed: a name, how many, the level they
// want to keep, the soonest expiry. What is DERIVED, every time, from those and
// today's date: out, low, expired, expiring. A stored "status: low" is wrong
// the moment somebody tops the box up, so there is no such field.
//
// This is a household shelf, not a health record. Nothing here knows whose
// illness anything is for, and nothing here gives a dose or a diagnosis — the
// suggestion chips carry only a name and a group.
// ---------------------------------------------------------------------------

export const MEDICINE_CATEGORIES: MedicineCategory[] = [
  'Pain & fever',
  'Cold, cough & allergy',
  'Stomach & gut',
  'Skin, wounds & burns',
  'First-aid supplies',
  'Other',
];

/** How far ahead "expiring soon" looks. Two months is long enough to buy a replacement without nagging. */
export const EXPIRY_WARN_DAYS = 60;

/**
 * Whatever word the assistant (or an old export) sends → one of the closed
 * categories, or undefined. Undefined, never 'Other': an unrecognised word
 * should leave the item uncategorised for the person to place, not file it
 * somewhere plausible and wrong.
 */
export function categoryFromWord(raw: unknown): MedicineCategory | undefined {
  const w = String(raw ?? '').trim().toLowerCase();
  if (!w) return undefined;
  const exact = MEDICINE_CATEGORIES.find(c => c.toLowerCase() === w);
  if (exact) return exact;
  if (/pain|fever|headache|painkiller|analges/.test(w)) return 'Pain & fever';
  if (/cold|cough|throat|allerg|hay ?fever|nasal|sinus|eye/.test(w)) return 'Cold, cough & allergy';
  if (/stomach|gut|digest|nausea|sick|diarrh|constip|rehydrat|electrolyte/.test(w)) return 'Stomach & gut';
  if (/skin|wound|burn|cut|graze|sting|bite|itch|sun|ointment|salve|disinfect|antisept/.test(w)) return 'Skin, wounds & burns';
  if (/first.?aid|bandage|plaster|dressing|gauze|glove|thermometer|scissor|tweezer|tick|supplies|equipment|device/.test(w)) return 'First-aid supplies';
  if (w === 'other') return 'Other';
  return undefined;
}

/** A whole, non-negative count, or undefined. "3" → 3; "two", "-1", "1.5", "" → undefined. */
export function coerceCount(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw <= 9999 ? raw : undefined;
  const s = String(raw ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return undefined;
  return parseInt(s, 10);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * An expiry as printed on a pack → YYYY-MM-DD, or undefined when it is not a
 * date we can read. Never guesses.
 *
 * Packs say "EXP 03/2027" or "03.2027", which means good to the END of March,
 * so a month-only value becomes that month's LAST day. Reading it as the 1st
 * would call a pack expired for a month it is still fine.
 * Accepted: YYYY-MM-DD, YYYY-MM, MM/YYYY, MM.YYYY, MM-YYYY. A two-digit year is
 * refused — 03/27 could be a day or a year, and this is medicine.
 */
export function normaliseExpiry(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return undefined;
    return s;
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12) return undefined;
    return `${y}-${pad2(mo)}-${pad2(lastDay(y, mo))}`;
  }
  m = /^(\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (m) {
    const mo = +m[1], y = +m[2];
    if (mo < 1 || mo > 12) return undefined;
    return `${y}-${pad2(mo)}-${pad2(lastDay(y, mo))}`;
  }
  return undefined;
}

export type CabinetState = 'expired' | 'out' | 'low' | 'expiring' | 'ok';

export interface CabinetStatus {
  state: CabinetState;
  /** Days until expiry (negative = already expired). Present whenever there is an expiry date. */
  days?: number;
}

function daysUntil(dateStr: string, today: string): number | null {
  const d = parseDateOnly(dateStr);
  const t = parseDateOnly(today);
  if (!d || !t) return null;
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

/**
 * The one reading of a shelf item. Order is by what the family has to DO:
 * expired stock is not stock at all, then nothing left, then below the level
 * they set, then just approaching a date.
 *
 * `quantity` absent means "not counting this one" (a thermometer), so it is
 * never "out" or "low" — only an explicit 0 is out, and only an explicit
 * number under an explicit minimum is low.
 */
export function itemStatus(item: MedicineCabinetItem, today: string = todayISO()): CabinetStatus {
  const days = item.expiry ? daysUntil(item.expiry, today) : null;
  const withDays = (state: CabinetState): CabinetStatus => (days === null ? { state } : { state, days });
  if (days !== null && days < 0) return withDays('expired');
  if (item.quantity === 0) return withDays('out');
  if (item.quantity !== undefined && item.minimum !== undefined && item.quantity < item.minimum) return withDays('low');
  if (days !== null && days <= EXPIRY_WARN_DAYS) return withDays('expiring');
  return withDays('ok');
}

/** Needs BUYING (not merely watching): expired, gone, or under the level. "Expiring soon" is not a purchase yet. */
export function needsRestock(item: MedicineCabinetItem, today: string = todayISO()): boolean {
  const s = itemStatus(item, today).state;
  return s === 'expired' || s === 'out' || s === 'low';
}

const SEVERITY: Record<CabinetState, number> = { expired: 0, out: 1, low: 2, expiring: 3, ok: 4 };

/** Items that need attention first, then by name — the order the screen shows within a group. */
export function sortItems(items: MedicineCabinetItem[], today: string = todayISO()): MedicineCabinetItem[] {
  return [...items].sort((a, b) => {
    const s = SEVERITY[itemStatus(a, today).state] - SEVERITY[itemStatus(b, today).state];
    return s !== 0 ? s : (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
}

export interface CabinetGroup { category: MedicineCategory; items: MedicineCabinetItem[] }

/** Group in the fixed category order; an item with no category sits under "Other". Empty groups are omitted. */
export function groupByCategory(items: MedicineCabinetItem[], today: string = todayISO()): CabinetGroup[] {
  const sorted = sortItems(items, today);
  return MEDICINE_CATEGORIES
    .map(category => ({ category, items: sorted.filter(i => (i.category ?? 'Other') === category) }))
    .filter(g => g.items.length > 0);
}

export interface CabinetSummary { restock: number; expired: number; expiring: number; total: number }

export function summarise(items: MedicineCabinetItem[], today: string = todayISO()): CabinetSummary {
  let restock = 0, expired = 0, expiring = 0;
  for (const i of items) {
    const s = itemStatus(i, today).state;
    if (s === 'expired') expired++;
    if (s === 'expiring') expiring++;
    if (needsRestock(i, today)) restock++;
  }
  return { restock, expired, expiring, total: items.length };
}

/**
 * The names to add to the shopping list, minus anything already on it
 * unticked. Case-insensitive; a ticked ("got it") entry does not count as
 * already on the list — that trip is over.
 */
export function restockNames(
  items: MedicineCabinetItem[],
  onList: { name: string; checked: boolean }[],
  today: string = todayISO(),
): string[] {
  const open = new Set(onList.filter(x => !x.checked).map(x => x.name.trim().toLowerCase()));
  const out: string[] = [];
  for (const i of items) {
    if (!needsRestock(i, today)) continue;
    const name = (i.name || '').trim();
    if (!name || open.has(name.toLowerCase()) || out.some(n => n.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

/** "Mar 2027" — expiry the way it is printed on the box, for display. */
export function expiryLabel(expiry: string | undefined): string {
  const d = parseDateOnly(expiry);
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** The value a `<input type="month">` wants (YYYY-MM) from a stored expiry. */
export function expiryToMonthInput(expiry: string | undefined): string {
  return expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry.slice(0, 7) : '';
}

/**
 * The assistant's version of an item → a clean item minus its id, or null when
 * there is no usable name. list_add items arrive as Record<string, string>, so
 * every number is text and every date is whatever the label said; each is
 * validated here, at the one door the model's version comes through, and a
 * value that will not validate is DROPPED rather than stored raw.
 */
export function itemFromAi(raw: Record<string, unknown>): Omit<MedicineCabinetItem, 'id'> | null {
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const item: Omit<MedicineCabinetItem, 'id'> = { name };
  const category = categoryFromWord(raw.category);
  if (category) item.category = category;
  const quantity = coerceCount(raw.quantity);
  if (quantity !== undefined) item.quantity = quantity;
  const minimum = coerceCount(raw.minimum);
  if (minimum !== undefined) item.minimum = minimum;
  const expiry = normaliseExpiry(raw.expiry);
  if (expiry) item.expiry = expiry;
  const location = String(raw.location ?? '').trim();
  if (location) item.location = location;
  const notes = String(raw.notes ?? raw.note ?? '').trim();
  if (notes) item.notes = notes;
  return item;
}

// ---------------------------------------------------------------------------
// Suggested must-haves. NAMES AND GROUPS ONLY — no strengths, no doses, no
// brands, and no claim that anyone needs any of them. They are a starting
// shelf to tick off, and the person renames "Pain relief tablets" to the
// product they actually trust.
//
// Source for the list: the Austrian health portal's Hausapotheke checklist
// (gesundheit.gv.at, "Checkliste Hausapotheke"), which groups them the same
// way. The wording is generic on purpose: paracetamol is acetaminophen in the
// US, and a family in Leeds and a family in Vienna should both recognise the
// chip. `minimum` is a starting point, editable.
// ---------------------------------------------------------------------------

export interface SuggestedEssential {
  name: string;
  category: MedicineCategory;
  minimum: number;
  /** Shown under "For children" rather than the main group. */
  forChildren?: boolean;
}

export const SUGGESTED_ESSENTIALS: SuggestedEssential[] = [
  { name: 'Pain relief tablets', category: 'Pain & fever', minimum: 1 },
  { name: 'Fever reducer', category: 'Pain & fever', minimum: 1 },
  { name: 'Sore throat lozenges or spray', category: 'Cold, cough & allergy', minimum: 1 },
  { name: 'Cough remedy', category: 'Cold, cough & allergy', minimum: 1 },
  { name: 'Nasal spray', category: 'Cold, cough & allergy', minimum: 1 },
  { name: 'Allergy tablets', category: 'Cold, cough & allergy', minimum: 1 },
  { name: 'Eye drops', category: 'Cold, cough & allergy', minimum: 1 },
  { name: 'Diarrhoea remedy', category: 'Stomach & gut', minimum: 1 },
  { name: 'Indigestion remedy', category: 'Stomach & gut', minimum: 1 },
  { name: 'Nausea remedy', category: 'Stomach & gut', minimum: 1 },
  { name: 'Constipation remedy', category: 'Stomach & gut', minimum: 1 },
  { name: 'Wound disinfectant', category: 'Skin, wounds & burns', minimum: 1 },
  { name: 'Wound healing ointment', category: 'Skin, wounds & burns', minimum: 1 },
  { name: 'Burn gel or ointment', category: 'Skin, wounds & burns', minimum: 1 },
  { name: 'Sports injury gel', category: 'Skin, wounds & burns', minimum: 1 },
  { name: 'Insect bite and itch relief', category: 'Skin, wounds & burns', minimum: 1 },
  { name: 'Insect repellent', category: 'Skin, wounds & burns', minimum: 1 },
  { name: 'Sun cream', category: 'Skin, wounds & burns', minimum: 1 },
  { name: 'Plasters', category: 'First-aid supplies', minimum: 1 },
  { name: 'Blister plasters', category: 'First-aid supplies', minimum: 1 },
  { name: 'Sterile wound dressings', category: 'First-aid supplies', minimum: 2 },
  { name: 'Gauze bandages', category: 'First-aid supplies', minimum: 2 },
  { name: 'Elastic bandage', category: 'First-aid supplies', minimum: 1 },
  { name: 'Triangular bandage', category: 'First-aid supplies', minimum: 1 },
  { name: 'Disposable gloves', category: 'First-aid supplies', minimum: 1 },
  { name: 'Cool pack', category: 'First-aid supplies', minimum: 1 },
  { name: 'Fever thermometer', category: 'First-aid supplies', minimum: 1 },
  { name: 'Bandage scissors', category: 'First-aid supplies', minimum: 1 },
  { name: 'Tweezers and tick remover', category: 'First-aid supplies', minimum: 1 },
  { name: 'Children’s fever reducer', category: 'Pain & fever', minimum: 1, forChildren: true },
  { name: 'Children’s pain relief', category: 'Pain & fever', minimum: 1, forChildren: true },
  { name: 'Oral rehydration salts', category: 'Stomach & gut', minimum: 1, forChildren: true },
  { name: 'Head-lice treatment', category: 'Skin, wounds & burns', minimum: 1, forChildren: true },
];

/** Suggestions the family has not already got, matched by name ignoring case and curly vs straight apostrophes. */
export function remainingSuggestions(items: MedicineCabinetItem[]): SuggestedEssential[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'");
  const have = new Set(items.map(i => norm(i.name || '')));
  return SUGGESTED_ESSENTIALS.filter(s => !have.has(norm(s.name)));
}
