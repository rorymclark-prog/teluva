// ---------------------------------------------------------------------------
// Timeline import — turning a pasted list, a spreadsheet export, or a
// calendar file into candidate TimelineEntry rows for review.
//
// Everything in this file is PURE and runs entirely client-side, no network,
// no AI. It is the "free" half of the import pipeline: CSV/TSV/ICS parse
// exactly, and free text gets one honest attempt at line-by-line reading
// before anything is handed to the assistant. See TimelineImportModal.tsx for
// the orchestration (which lines go local vs. to /api/timeline/parse) and
// server/timelineParse.mjs for the AI half's own validation.
//
// It speaks the life timeline's own contract (lifeTimeline.ts): a row has a
// `category` from LIFE_CATEGORIES and a `datePrecision` of 'month' or 'year'
// — ABSENT means the day is known, exactly as on TimelineEntry.
//
// THE ONE RULE EVERYTHING HERE OBEYS: never invent a day or month. A date
// this module cannot fully read comes back at a coarser precision (month or
// year) rather than guessing the 1st, and a date it cannot read AT ALL comes
// back as date: '' with needsDate: true — never silently dropped, and never
// defaulted to today. The review screen decides what happens to an undated
// row; this module's job is only to be honest about what it found.
// ---------------------------------------------------------------------------

import { LifeCategory, TimelineEntry } from '../types';
import { unfoldIcs, parseIcsLine, unescapeIcsText, parseIcsRaw, rawToLocal } from './ics';
import { LIFE_CATEGORIES, lifeCategoryFromWord } from './lifeTimeline';

/** A coarse date, as TimelineEntry stores it. Absent = the day is known. */
export type ImportPrecision = 'month' | 'year' | undefined;

export interface TimelineImportMember {
  id: string;
  name: string;
  /**
   * Optional (FamilyMember.birthdate). When present it lets findDuplicates
   * recognise "Nora born 15.03.2019" as already known even before any
   * moment for it exists on the timeline — the life timeline already shows
   * every member's birth from this field.
   */
  birthdate?: string;
}

export interface TimelineCandidate {
  key: string;
  /** '' when no date could be read at all — see needsDate. */
  date: string;
  /** 'month' | 'year' for a coarse date; absent = the day is known. */
  datePrecision?: 'month' | 'year';
  title: string;
  category?: LifeCategory;
  memberIds: string[];
  note?: string;
  /** The exact line/field/fragment this row came from — shown as "from: …". */
  sourceText: string;
  sourceName?: string;
  sourceDocument?: { memberId: string; documentId: string };
  preserveUnassigned?: boolean;
  docIds?: string[];
  /** An ICS VEVENT with an RRULE — only its first occurrence was imported. */
  repeats?: boolean;
  /** id of an existing TimelineEntry this looks like a repeat of. */
  duplicateOf?: string;
  /** True when date === ''. Kept as an explicit field so a parser that sets
   *  it can't be second-guessed by a later `!candidate.date` check drifting
   *  out of sync with this one. */
  needsDate?: boolean;
}

let keySeq = 0;
function makeKey(seed: string): string {
  keySeq += 1;
  return `imp-${keySeq}-${seed.length}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Date parsing — the part that must never invent a day or month
// ---------------------------------------------------------------------------

export interface ParsedDate {
  date: string; // YYYY-MM-DD
  datePrecision?: 'month' | 'year';
}

const MONTHS: Record<string, number> = {
  // English, full and abbreviated
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
  // German, full and abbreviated. "marz" is März with the diacritic stripped
  // (the lookup always runs on stripDiacritics() output). april/august/
  // september/november collide harmlessly with the English entries above.
  januar: 1, februar: 2, marz: 3,
  mai: 5, juni: 6, juli: 7,
  oktober: 10, okt: 10,
  dezember: 12, dez: 12,
};

const SEASON_OR_QUALIFIER = /^(summer|winter|spring|autumn|fall|early|mid|late|around|circa|c\.|sommer|fruhling|fruhjahr|herbst|anfang|mitte|ende|um|etwa)$/i;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** True calendar validity — this is what turns "31.02.2024" into null rather than a wrong date. */
function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1000 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  const max = m === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[m - 1];
  return d >= 1 && d <= max;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const dayDate = (y: number, mo: number, d: number): ParsedDate | null =>
  isValidYmd(y, mo, d) ? { date: `${y}-${pad2(mo)}-${pad2(d)}` } : null;

/**
 * Read one date out of free text, as loosely as possible without ever
 * inventing a part it didn't see. Handles (in order tried):
 *   - ISO: 2019-04-12
 *   - day-first numeric: 12.04.2019 / 12/04/2019 (never month-first — this is
 *     an Austria/UK/South Africa household)
 *   - "12 April 2019" / "12 Apr 2019" / German month names
 *   - "July 2024" / "Jul 2024" (no day) → month precision
 *   - "summer 2015" / "early 2019" (qualifier + year) → year precision
 *   - a bare 4-digit year → year precision
 * Returns null for anything it can't confidently read, INCLUDING a
 * numerically-shaped date that isn't real (31.02.2024).
 */
export function parseDateLoose(input: string): ParsedDate | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  // ISO: 2019-04-12 (also accept 2019/04/12 for symmetry with the day-first check)
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (m) return dayDate(+m[1], +m[2], +m[3]);

  // ISO month: 2019-04 → month precision (the shape the assistant and the
  // life timeline's own parseLifeDate use).
  m = /^(\d{4})-(\d{2})$/.exec(raw);
  if (m) return +m[2] >= 1 && +m[2] <= 12 ? { date: `${m[1]}-${m[2]}-01`, datePrecision: 'month' } : null;

  // Numeric month and year: 09.2022 / 9/2022 → month precision (a German or
  // Austrian spreadsheet's usual way to write "September 2022").
  m = /^(\d{1,2})[./](\d{4})$/.exec(raw);
  if (m) return +m[1] >= 1 && +m[1] <= 12 ? { date: `${m[2]}-${pad2(+m[1])}-01`, datePrecision: 'month' } : null;

  // Day-first numeric: 12.04.2019, 12/04/2019, 12-04-2019
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(raw);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y < 50 ? 2000 : 1900; // '24 -> 2024, '87 -> 1987
    else if (m[3].length === 3) return null;
    return dayDate(y, +m[2], +m[1]);
  }

  const words = stripDiacritics(raw).toLowerCase().split(/\s+/).filter(Boolean);

  // "12 April 2019" / "12 Apr 2019"  (day, month-name, year)
  if (words.length === 3) {
    const [w1, w2, w3] = words;
    const dNum = /^\d{1,2}(st|nd|rd|th|\.)?$/.test(w1) ? parseInt(w1, 10) : null;
    const monthNum = MONTHS[w2.replace(/\.$/, '')];
    const yNum = /^\d{4}$/.test(w3) ? +w3 : null;
    if (dNum !== null && monthNum && yNum !== null) return dayDate(yNum, monthNum, dNum);
    // "July 25 2024" / "Jul 25, 2024" — the day-first policy is about NUMERIC
    // dd/mm; a written month name is unambiguous.
    const monthNum2 = MONTHS[w1.replace(/\.$/, '')];
    const dNum2 = /^\d{1,2}(st|nd|rd|th)?,?$/.test(w2) ? parseInt(w2, 10) : null;
    if (monthNum2 && dNum2 !== null && yNum !== null) return dayDate(yNum, monthNum2, dNum2);
  }

  // "July 2024" / "Jul 2024" (month, year — no day)
  if (words.length === 2) {
    const [w1, w2] = words;
    const monthNum = MONTHS[w1.replace(/\.$/, '')];
    const yNum = /^\d{4}$/.test(w2) ? +w2 : null;
    if (monthNum && yNum !== null) {
      return { date: `${yNum}-${pad2(monthNum)}-01`, datePrecision: 'month' };
    }
    // "summer 2015" / "early 2019" (qualifier, year) — year precision only.
    if (SEASON_OR_QUALIFIER.test(w1) && yNum !== null) {
      return { date: `${yNum}-01-01`, datePrecision: 'year' };
    }
  }

  // Bare 4-digit year
  if (words.length === 1 && /^\d{4}$/.test(words[0])) {
    return { date: `${words[0]}-01-01`, datePrecision: 'year' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Category — a free word from a spreadsheet column into a LifeCategory
// ---------------------------------------------------------------------------

// German words a family's own spreadsheet might use. English words and the
// category ids themselves go through lifeTimeline's lifeCategoryFromWord.
const GERMAN_CATEGORY_WORDS: Record<string, LifeCategory> = {
  meilenstein: 'milestone', geburt: 'milestone', hochzeit: 'milestone',
  gesundheit: 'medical', medizinisch: 'medical', arzt: 'medical', krankenhaus: 'medical', spital: 'medical',
  urlaub: 'holiday', reise: 'holiday', ferien: 'holiday',
  schule: 'school', ausbildung: 'school', studium: 'school', kindergarten: 'school',
  arbeit: 'work', beruf: 'work', job: 'work',
  zuhause: 'home', umzug: 'home', wohnung: 'home', haus: 'home',
  dokument: 'papers', dokumente: 'papers', papiere: 'papers', urkunde: 'papers',
  erinnerung: 'memory', erinnerungen: 'memory',
  sonstiges: 'other', andere: 'other', anderes: 'other',
};

/**
 * A category column's cell as a LifeCategory. Blank → undefined (the review
 * row asks); a word nobody recognises → 'other', never a guess at a closer
 * kind — the same rule the assistant path and server/timelineParse.mjs follow.
 */
export function importCategoryFromWord(raw: string | undefined): LifeCategory | undefined {
  const w = stripDiacritics(raw || '').trim().toLowerCase();
  if (!w) return undefined;
  return lifeCategoryFromWord(w)
    || LIFE_CATEGORIES.find((c) => c.label.toLowerCase() === w)?.id
    || GERMAN_CATEGORY_WORDS[w]
    || 'other';
}

// ---------------------------------------------------------------------------
// CSV / TSV parsing (Austrian Excel exports use ';')
// ---------------------------------------------------------------------------

/** Split one line on a delimiter, honouring "quoted, fields" and "" escapes. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"' && cur === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Pick whichever of , ; \t appears most in the header line — ties favour ',' */
function detectDelimiter(headerLine: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const c of headerLine) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

type Field = 'date' | 'title' | 'who' | 'category' | 'note';

const HEADER_SYNONYMS: Record<Field, string[]> = {
  date: ['date', 'when', 'datum', 'year', 'jahr', 'zeitpunkt'],
  title: ['title', 'event', 'what', 'moment', 'ereignis', 'anlass', 'beschreibung', 'titel'],
  who: ['who', 'person', 'people', 'name', 'names', 'wer', 'personen'],
  category: ['category', 'type', 'kind', 'art', 'kategorie', 'typ'],
  note: ['note', 'notes', 'details', 'notiz', 'anmerkung', 'bemerkung'],
};

function matchHeaderField(header: string): Field | null {
  const h = stripDiacritics(header).toLowerCase().trim();
  for (const field of Object.keys(HEADER_SYNONYMS) as Field[]) {
    if (HEADER_SYNONYMS[field].includes(h)) return field;
  }
  return null;
}

/**
 * Parse a CSV/TSV/semicolon-delimited export into candidates. The first row
 * must be a header; columns are matched by synonym (English + German), and
 * any column that isn't recognised is ignored rather than rejecting the file
 * — a spreadsheet someone exported from their own system usually carries
 * extra columns this app has no use for.
 */
export function parseCsv(text: string, members: TimelineImportMember[] = []): TimelineCandidate[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = splitDelimited(lines[0], delimiter);
  const columns: (Field | null)[] = headerCells.map(matchHeaderField);
  if (!columns.some((c) => c === 'date') && !columns.some((c) => c === 'title')) {
    // Not recognisable as this app's shape at all — nothing to salvage.
    return [];
  }

  const out: TimelineCandidate[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cells = splitDelimited(raw, delimiter);
    const byField: Partial<Record<Field, string>> = {};
    columns.forEach((field, idx) => {
      if (field && cells[idx] !== undefined && cells[idx] !== '') byField[field] = cells[idx];
    });
    if (!byField.date && !byField.title) continue; // a genuinely blank/junk row

    const parsedDate = byField.date ? parseDateLoose(byField.date) : null;
    const title = (byField.title || byField.date || raw).trim();
    const whoText = byField.who || `${title} ${byField.note || ''}`;
    const category = importCategoryFromWord(byField.category);

    out.push({
      key: makeKey(raw),
      date: parsedDate?.date || '',
      ...(parsedDate?.datePrecision ? { datePrecision: parsedDate.datePrecision } : {}),
      title,
      ...(category ? { category } : {}),
      memberIds: resolvePeople(whoText, members),
      note: byField.note?.trim() || undefined,
      sourceText: raw.trim(),
      needsDate: !parsedDate,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ICS parsing — reuses the low-level RFC 5545 building blocks from ics.ts
// (unfoldIcs / parseIcsLine / parseIcsRaw / rawToLocal) rather than
// reimplementing DTSTART/TZID/UTC handling a second time.
// ---------------------------------------------------------------------------

interface VeventDraft {
  dtstart?: { value: string; params: Record<string, string> };
  summary?: string;
  description?: string;
  rrule?: string;
}

function candidateFromVevent(v: VeventDraft, index: number): TimelineCandidate | null {
  if (!v.dtstart && !v.summary) return null; // an empty/garbled block, nothing to show
  const raw = v.dtstart ? parseIcsRaw(v.dtstart.value, v.dtstart.params) : null;
  const instant = raw ? rawToLocal(raw) : null;

  const title = (v.summary || '').trim() || 'Untitled event';
  return {
    key: makeKey(`${v.summary || ''}-${index}`),
    date: instant?.date || '',
    // No datePrecision: ICS always writes a full date, even for all-day.
    title,
    memberIds: [],
    note: v.description?.trim() || undefined,
    sourceText: v.summary?.trim() || `VEVENT ${index + 1}`,
    // Any RRULE on a personal-life-events export is overwhelmingly a yearly
    // birthday/anniversary re-export, which is exactly the case the review
    // screen's "repeats yearly" chip is for — so any recurrence rule is
    // flagged, not only FREQ=YEARLY specifically.
    repeats: typeof v.rrule === 'string' && v.rrule.length > 0 ? true : undefined,
    needsDate: !instant?.date,
  };
}

export function parseIcs(text: string): TimelineCandidate[] {
  const lines = unfoldIcs(text);
  const out: TimelineCandidate[] = [];
  let cur: VeventDraft | null = null;
  let index = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^BEGIN:VEVENT$/i.test(trimmed)) { cur = {}; continue; }
    if (/^END:VEVENT$/i.test(trimmed)) {
      if (cur) {
        const c = candidateFromVevent(cur, index++);
        if (c) out.push(c);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const prop = parseIcsLine(trimmed);
    if (!prop) continue;
    if (prop.name === 'DTSTART') cur.dtstart = { value: prop.value, params: prop.params };
    else if (prop.name === 'SUMMARY') cur.summary = unescapeIcsText(prop.value);
    else if (prop.name === 'DESCRIPTION') cur.description = unescapeIcsText(prop.value);
    else if (prop.name === 'RRULE') cur.rrule = prop.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Free-text line parsing — the "can we read this ourselves?" first pass.
// Everything this fails on is what the caller sends to the assistant.
// ---------------------------------------------------------------------------

const LEADING_TRAILING_STRIP = /^[\s\-–—:,·]+|[\s\-–—:,·]+$/g;

/** Try to read a date from the first (or last) 1–4 tokens of a line. */
function extractEdgeDate(line: string): { parsed: ParsedDate; rest: string } | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;

  // Leading date, longest match first (so "12 April 2019 X" isn't read as
  // just "12").
  for (let k = Math.min(4, tokens.length); k >= 1; k--) {
    const candidate = tokens.slice(0, k).join(' ').replace(/[,:\-–—]+$/, '');
    const parsed = parseDateLoose(candidate);
    if (parsed) return { parsed, rest: tokens.slice(k).join(' ').replace(LEADING_TRAILING_STRIP, '') };
  }
  // Trailing date.
  for (let k = Math.min(4, tokens.length); k >= 1; k--) {
    const candidate = tokens.slice(tokens.length - k).join(' ').replace(/^[,:\-–—(]+|[)]+$/g, '');
    const parsed = parseDateLoose(candidate);
    if (parsed) return { parsed, rest: tokens.slice(0, tokens.length - k).join(' ').replace(LEADING_TRAILING_STRIP, '') };
  }
  return null;
}

export interface FreeTextParseResult {
  candidates: TimelineCandidate[];
  /** Lines that need the assistant — no leading/trailing date this pass could read. */
  unparsedLines: string[];
}

/**
 * One pass over pasted free text, line by line (also splits on a "·" bullet,
 * the separator the modal's own placeholder text uses for one-line-per-idea
 * paste-friendliness). A line with a date at either edge is read for free;
 * everything else is returned separately so the caller can decide whether to
 * send it to /api/timeline/parse (and can tell the user it's doing so).
 */
export function parseFreeTextLines(text: string, members: TimelineImportMember[] = []): FreeTextParseResult {
  const lines = text
    .split(/\r?\n|·/)
    .map((l) => l.trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean);

  const candidates: TimelineCandidate[] = [];
  const unparsedLines: string[] = [];

  for (const line of lines) {
    const found = extractEdgeDate(line);
    if (!found) { unparsedLines.push(line); continue; }
    const title = found.rest || line;
    candidates.push({
      key: makeKey(line),
      date: found.parsed.date,
      ...(found.parsed.datePrecision ? { datePrecision: found.parsed.datePrecision } : {}),
      title,
      memberIds: resolvePeople(line, members),
      sourceText: line,
      needsDate: false,
    });
  }
  return { candidates, unparsedLines };
}

// ---------------------------------------------------------------------------
// Person resolution
//
// Deliberately a small implementation of its own rather than
// eventMemberMatch.ts's resolveEventMembers: that one decides whether a
// calendar TITLE attributes an event to someone (with its own "May/June"
// ambiguous-word list) and has no concept of two members sharing a first
// name, which import text hits constantly (same-named cousins).
// ---------------------------------------------------------------------------

function normalizeForMatch(s: string): string {
  return stripDiacritics(s).toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u');
  return re.test(haystack);
}

/**
 * Which family members a piece of text names. Full names always count; a
 * bare first name counts only when it is unambiguous across the given member
 * list — two members sharing a first name means neither is credited from a
 * first-name-only mention (a full-name mention still resolves that member
 * individually).
 */
export function resolvePeople(text: string, members: TimelineImportMember[]): string[] {
  const norm = normalizeForMatch(text || '');
  if (!norm.trim() || !members.length) return [];

  const firstNameOwners = new Map<string, string[]>();
  for (const m of members) {
    const parts = normalizeForMatch(m.name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const first = parts[0];
    firstNameOwners.set(first, [...(firstNameOwners.get(first) || []), m.id]);
  }

  const found = new Set<string>();
  for (const m of members) {
    const full = normalizeForMatch(m.name).trim();
    if (!full) continue;
    if (full.length >= 2 && containsWholeWord(norm, full)) { found.add(m.id); continue; }

    const first = full.split(/\s+/)[0];
    if (first && first.length >= 2 && containsWholeWord(norm, first)) {
      const owners = firstNameOwners.get(first) || [];
      if (owners.length === 1) found.add(m.id);
      // else: ambiguous first name — contribute nothing for this mention.
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

type Grain = 'day' | 'month' | 'year';
const GRAIN_ORDER: Grain[] = ['day', 'month', 'year'];
const grainOf = (p: ImportPrecision): Grain => p || 'day';

function truncateToGrain(date: string, grain: Grain): string {
  if (grain === 'year') return date.slice(0, 4);
  if (grain === 'month') return date.slice(0, 7);
  return date;
}

function coarser(a: Grain, b: Grain): Grain {
  return GRAIN_ORDER.indexOf(a) > GRAIN_ORDER.indexOf(b) ? a : b;
}

function sameDate(date: string, precision: ImportPrecision, other: { date: string; datePrecision?: ImportPrecision }): boolean {
  if (!date || !other.date) return false;
  const grain = coarser(grainOf(precision), grainOf(other.datePrecision));
  return truncateToGrain(date, grain) === truncateToGrain(other.date, grain);
}

/** Normalised word set for a title, used for a cheap Jaccard-style overlap. */
function titleWords(title: string): Set<string> {
  return new Set(
    normalizeForMatch(title)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

/**
 * Are two titles "the same moment, described twice"? Exact match after
 * normalising, or containment either way, or at least half the words of the
 * shorter title also appear in the longer one — generous on purpose, since a
 * near-miss shown to the user (unchecked, with a reason) costs nothing, while
 * silently importing a second "Nora born" is a duplicated life event.
 */
function titlesSimilar(a: string, b: string): boolean {
  const na = normalizeForMatch(a).trim();
  const nb = normalizeForMatch(b).trim();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;

  const wa = titleWords(a);
  const wb = titleWords(b);
  if (!wa.size || !wb.size) return false;
  const [shorter, longer] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let overlap = 0;
  for (const w of shorter) if (longer.has(w)) overlap++;
  return overlap / shorter.size >= 0.5;
}

export const BORN_WORD = /\b(born|birth|geboren|geburt)\b/i;

/**
 * Mark candidates that look like they're already on the timeline —
 * `duplicateOf` gets the existing TimelineEntry's id (or, for a birth date
 * matched purely against a member's birthdate, `member:<id>`: the life
 * timeline already shows that birth as a row of its own). Never mutates or
 * drops anything; the review screen uses the flag to default the row
 * unchecked with a reason chip.
 */
export function findDuplicates(
  candidates: TimelineCandidate[],
  existing: TimelineEntry[],
  members: TimelineImportMember[] = [],
): TimelineCandidate[] {
  const seen = [...existing];
  return candidates.map((c) => {

    const existingMatch = seen.find(
      (e) => (!c.memberIds.length || !e.memberIds?.length || c.memberIds.some(id => e.memberIds?.includes(id))) && ((!c.date && !e.date) || sameDate(c.date, c.datePrecision, e)) && titlesSimilar(c.title, e.title),
    );
    if (existingMatch) return { ...c, duplicateOf: existingMatch.id };

    if (BORN_WORD.test(c.title)) {
      const memberMatch = members.find((m) => {
        if (!m.birthdate) return false;
        const parsed = parseDateLoose(m.birthdate) || { date: m.birthdate };
        if (!sameDate(c.date, c.datePrecision, parsed)) return false;
        const first = normalizeForMatch(m.name).trim().split(/\s+/)[0];
        return !!first && containsWholeWord(normalizeForMatch(c.title), first);
      });
      if (memberMatch) return { ...c, duplicateOf: `member:${memberMatch.id}` };
    }

    seen.push({ ...c, id: c.key });
    return c;
  });
}

// ---------------------------------------------------------------------------
// Review-screen rules (TimelineImportModal) — kept here so they are tested
// ---------------------------------------------------------------------------

/** The review screen's precision control: 'day' is stored as an absent datePrecision. */
export type ImportGrain = 'day' | 'month' | 'year';

/**
 * Why a row starts UNCHECKED on the review screen, or null when it is ready.
 * A reason is shown as a chip; the family can still tick the row.
 */
export function importRowReason(
  row: Pick<TimelineCandidate, 'duplicateOf' | 'needsDate' | 'date' | 'title' | 'datePrecision'>,
): string | null {
  if (row.duplicateOf) return 'Already on the timeline';
  if (row.needsDate || !row.date) return 'Needs a date';
  // Each member's birth is already on the life timeline, from their date of
  // birth. A coarse "born <year>" row would sit next to it as a visible
  // duplicate, so it starts unchecked rather than silently merged.
  if (row.datePrecision === 'year' && BORN_WORD.test(row.title)) {
    return 'Year only — births already show from each person’s date of birth';
  }
  return null;
}

/**
 * "Switching precision keeps the known parts" — truncate to what the old
 * precision actually knew, then re-pad with the "unknown" convention (01).
 * Going FINER than what's known (year → day) never invents the missing part:
 * the result is '' so the control shows empty and asks the family.
 */
export function datePrecisionChange(date: string, from: ImportGrain, to: ImportGrain): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  if (to === 'year') return `${year}-01-01`;
  if (to === 'month') return from === 'year' ? '' : `${year}-${month}-01`;
  return from === 'day' ? date : '';
}
