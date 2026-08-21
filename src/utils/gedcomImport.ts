import { DepartedRelative, ExtendedBirthday, KinLink, KinRef } from '../types';
import {
  KinGraph, KinSources, buildKinGraph, kinLinkProblem, kinRef, normName, parentsOf, partnersOf,
} from './kin';
import { TITLES } from './gedcom';

// ---------------------------------------------------------------------------
// GEDCOM 5.5.1 import — the other half of gedcom.ts.
//
// WHY: v249 could write a family's history out but never read one in, so a tree
// that already exists on MyHeritage or in a cousin's Gramps file still had to
// be retyped person by person. Export without import is a one-way door with a
// nice sign on it.
//
// TWO THINGS SHAPE EVERY DECISION BELOW.
//
// 1. A .ged FILE IS UNTRUSTED INPUT. It arrives by email from a relative, or
//    out of a website's export button, and it is a hand-editable text format
//    forty years old — so it will be malformed, truncated, in a legacy
//    character set, or five thousand people long. Nothing here throws; a line
//    that makes no sense is counted and skipped, and a file too big for the
//    vault's storage model is refused BEFORE anything is written rather than
//    half-imported.
//
// 2. MERGING IS THE DANGEROUS PART, NOT PARSING. Creating a duplicate
//    grandmother is an annoyance the family can see and fix. Silently fusing
//    two different people because they share a name is a corruption they
//    cannot see and will never think to look for. So the same no-guess rule
//    the spouse merge follows applies here: exactly one match by name means
//    match, anything else means say so and let the family decide. See
//    project-teluva-family-tree.
//
// The whole import is one pure function. The preview the family confirms and
// the records that get saved come out of the SAME call, so the two cannot
// drift — a plan computed separately from its application is a bug waiting for
// the day someone edits one branch of it.
//
// WHAT DOES NOT SURVIVE, stated here so nobody has to discover it: GEDCOM's
// `SEX` tag. Only FamilyMember has a sex field, and an import never creates
// household members — a great-grandfather does not need clothing sizes and a
// medical record. For everyone else the tree reads sex from the family's own
// words ("Oma", "Grandfather"), so an imported "Anna Müller" with no such word
// stays unknown, which only affects which slot she takes on the way back out.
// A field on ExtendedBirthday would fix it and is not worth the ripple yet.
// ---------------------------------------------------------------------------

// --- Line layer ------------------------------------------------------------

export interface GedLine {
  level: number;
  /** The record's own id, on `0 @I1@ INDI` lines. */
  xref?: string;
  tag: string;
  value: string;
}

/**
 * `level [@xref@] TAG [value]`.
 *
 * Leading whitespace is tolerated because plenty of files in the wild have it,
 * and a strict reader would reject an otherwise perfectly good tree over
 * indentation.
 */
// The leading `\s*` also eats a byte-order mark, which JavaScript counts as
// whitespace — files exported on Windows routinely carry one, and it would
// otherwise turn the very first line of the file into junk.
const LINE_RE = /^\s*(\d+)\s+(?:@([^@\s]+)@\s+)?([A-Za-z0-9_]+)(?:\s(.*))?$/;

/** A value that IS a pointer — structural, so its `@` must survive unescaped. */
export const isGedPointer = (value: string): boolean => /^@[^@\s]+@$/.test(value);

/** `@@` back to a literal `@`; pointers pass through untouched. */
const unesc = (value: string): string => (isGedPointer(value) ? value : value.replace(/@@/g, '@'));

/** `@I1@` → `I1`, or undefined when it is not a pointer at all. */
export const derefPointer = (value: string): string | undefined =>
  isGedPointer(value) ? value.slice(1, -1) : undefined;

/**
 * Tokenise, with CONT/CONC folded back into the line they continue.
 *
 * CONC is a plain join and CONT is a newline — getting these the wrong way
 * round runs a note's words together, which is invisible until someone reads
 * the imported text months later.
 */
export function parseGedLines(text: string): { lines: GedLine[]; ignored: number } {
  const raw = String(text || '').split(/\r\n|\r|\n/);
  const lines: GedLine[] = [];
  let ignored = 0;

  for (const r of raw) {
    if (!r.trim()) continue;
    const m = LINE_RE.exec(r);
    if (!m) { ignored += 1; continue; }
    const tag = m[3].toUpperCase();
    const value = m[4] ?? '';

    if (tag === 'CONC' || tag === 'CONT') {
      const prev = lines[lines.length - 1];
      // A continuation with nothing to continue is junk, not a record.
      if (!prev) { ignored += 1; continue; }
      prev.value += (tag === 'CONT' ? '\n' : '') + unesc(value);
      continue;
    }

    lines.push({ level: Number(m[1]), xref: m[2], tag, value: unesc(value) });
  }

  return { lines, ignored };
}

// --- Date layer ------------------------------------------------------------

export interface GedDate {
  /** Exactly as written, for the free-text fields that can hold it faithfully. */
  text: string;
  /** 'MM-DD' when a day and month are both given. */
  monthDay?: string;
  year?: number;
  /** ABT / EST / CAL / BEF / AFT / BET — the date is not a fact. */
  approximate: boolean;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MODIFIERS = ['ABT', 'ABOUT', 'CAL', 'EST', 'BEF', 'AFT', 'FROM', 'TO', 'BET', 'AND', 'INT', 'CIRCA', 'CA'];

/**
 * GEDCOM dates are prose as much as data: `12 MAR 1938`, `ABT 1938`,
 * `BET 1938 AND 1940`, `MAR 1938`, `1938`.
 *
 * A range keeps its FIRST date and stays flagged approximate. Never invent the
 * missing half of a date — a day-less month yields no monthDay at all rather
 * than the 1st, because a birthday reminder on a made-up day is worse than no
 * reminder.
 */
export function parseGedDate(raw?: string): GedDate | undefined {
  const text = (raw || '').trim();
  if (!text) return undefined;

  const tokens = text.toUpperCase().split(/[\s.,]+/).filter(Boolean);
  const approximate = tokens.some((t) => MODIFIERS.includes(t));
  const words = tokens.filter((t) => !MODIFIERS.includes(t));

  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  for (const w of words) {
    const mi = MONTHS.indexOf(w.slice(0, 3));
    if (mi >= 0 && month === undefined) { month = mi + 1; continue; }
    if (!/^\d+$/.test(w)) continue;
    const n = Number(w);
    // A four-digit number is a year; one or two digits before a month is a day.
    if (n > 31 && year === undefined) { year = n; continue; }
    if (n >= 1 && n <= 31 && day === undefined) { day = n; continue; }
  }

  const monthDay = day && month
    ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : undefined;

  return {
    text,
    monthDay,
    year: year && year > 999 && year < 3000 ? year : undefined,
    approximate,
  };
}

/**
 * The same date in words a family would write.
 *
 * In Memory's `born` and `died` are free text SHOWN TO PEOPLE, under a
 * relative's photograph — so "BET 1905 AND 1907" is the wrong thing to put
 * there, however faithful it is to the file. Faithfulness here means the same
 * fact with the same uncertainty, not the same keywords.
 */
export function humanGedDate(d?: GedDate): string | undefined {
  if (!d) return undefined;
  const upper = d.text.toUpperCase();

  const plain = (day?: number, month?: number, year?: number): string => {
    const bits: string[] = [];
    if (day && month) bits.push(`${day} ${MONTH_NAMES[month - 1]}`);
    else if (month) bits.push(MONTH_NAMES[month - 1]);
    if (year) bits.push(String(year));
    return bits.join(' ');
  };

  const [, dayStr] = /(?:^|\s)(\d{1,2})\s+[A-Z]{3}/.exec(upper) || [];
  const monthIdx = MONTHS.findIndex((m) => new RegExp(`\\b${m}`).test(upper));
  const core = plain(dayStr ? Number(dayStr) : undefined, monthIdx >= 0 ? monthIdx + 1 : undefined, d.year);
  if (!core) return d.text;   // nothing recognisable — better their words than ours

  // A range keeps both ends; everything else is one date with a qualifier.
  const between = /\bBET\b/.test(upper) ? /\bAND\s+(?:.*?)(\d{3,4})\s*$/.exec(upper) : null;
  if (between) return `between ${core} and ${between[1]}`;
  if (/\bBEF\b/.test(upper)) return `before ${core}`;
  if (/\bAFT\b/.test(upper)) return `after ${core}`;
  if (/\b(ABT|ABOUT|CIRCA|CA|EST|CAL)\b/.test(upper)) return `about ${core}`;
  if (/\bFROM\b/.test(upper)) return `from ${core}`;
  return core;
}

// --- Record layer ----------------------------------------------------------

export interface GedIndi {
  xref: string;
  /** The de-slashed NAME. */
  name: string;
  nick?: string;
  sex: 'M' | 'F' | 'U';
  birth?: GedDate;
  death?: GedDate;
  /** Any death fact at all, including a bare `DEAT Y` with no date. */
  dead: boolean;
  notes: string[];
  famc: { xref: string; pedi?: string }[];
}

export interface GedFam {
  xref: string;
  /** HUSB then WIFE, in file order, minus any that failed to resolve. */
  spouses: string[];
  children: string[];
  married: boolean;
  divorced: boolean;
}

export interface GedFile {
  indis: GedIndi[];
  fams: GedFam[];
  charset?: string;
  source?: string;
  ignoredLines: number;
}

/** `Willem de /Villiers/` → `Willem de Villiers`. */
const deslash = (name: string): string => name.replace(/\//g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The name to file someone under.
 *
 * NICK wins ONLY when it contains the whole structured name — which is exactly
 * the shape gedcom.ts writes when the family's own name for someone had to be
 * shortened ("Sue" + NICK "Grandma Sue"), so a tree exported from here and
 * read back arrives under the name the family actually uses. A genuine
 * nickname ("Robert /Smith/" + NICK "Bob") fails that test and is ignored,
 * because filing him as "Bob" would throw away his surname.
 */
export function gedcomDisplayName(name: string, nick?: string): string {
  const plain = deslash(name || '');
  const n = (nick || '').trim();
  if (n && plain) {
    const words = plain.split(' ').map((w) => w.toLowerCase());
    const hay = n.toLowerCase();
    if (words.every((w) => hay.includes(w))) return n;
  }
  return plain || n || 'Unnamed';
}

/**
 * A name that is a privacy placeholder rather than a person's name.
 *
 * Ancestry, MyHeritage and FamilySearch all strip living people out of an
 * export they hand to someone else, leaving "Living /Smith/", "Private" or
 * "<Private>" behind. Those are the ABSENCE of a name, and adding a permanent
 * record called "Living van der Merwe" to a family's birthday list is worse
 * than telling them the file withheld those people.
 */
export function isPrivatisedName(name: string): boolean {
  const t = (name || '').trim().toLowerCase().replace(/[<>()]/g, '');
  if (!t) return true;
  const first = t.split(/\s+/)[0];
  return ['living', 'private', 'privat', 'withheld', 'confidential', 'unknown', 'unnamed'].includes(first);
}

/** The leading kinship word in a name the family uses — "Ouma Katrien" → "Ouma". */
export function titleFromName(name?: string): string | undefined {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  const taken: string[] = [];
  for (const p of parts) {
    if (!TITLES.includes(p.toLowerCase().replace(/[^a-zäöüß-]/g, ''))) break;
    taken.push(p);
  }
  return taken.length ? taken.join(' ') : undefined;
}

const sexOf = (value: string): 'M' | 'F' | 'U' => {
  const v = value.trim().toUpperCase();
  return v === 'M' || v === 'F' ? v : 'U';
};

/**
 * INDI and FAM records out of the line stream.
 *
 * Sub-records are read by level rather than by tag order, so an unfamiliar tag
 * between the ones we want (every genealogy program writes its own) does not
 * end a structure early.
 */
export function parseGedcom(text: string): GedFile {
  const { lines, ignored } = parseGedLines(text);
  const indis: GedIndi[] = [];
  const fams: GedFam[] = [];
  let charset: string | undefined;
  let source: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (l.level !== 0) continue;

    // The record body is every line until the next level-0.
    let end = i + 1;
    while (end < lines.length && lines[end].level !== 0) end += 1;
    const body = lines.slice(i + 1, end);

    if (l.tag === 'HEAD') {
      charset = body.find((b) => b.tag === 'CHAR')?.value.trim() || undefined;
      source = body.find((b) => b.tag === 'SOUR')?.value.trim() || undefined;
      continue;
    }

    if (l.tag === 'INDI' && l.xref) {
      const indi: GedIndi = { xref: l.xref, name: '', sex: 'U', dead: false, notes: [], famc: [] };
      for (let j = 0; j < body.length; j += 1) {
        const b = body[j];
        if (b.level !== 1) continue;
        const sub = [];
        for (let k = j + 1; k < body.length && body[k].level > 1; k += 1) sub.push(body[k]);

        if (b.tag === 'NAME' && !indi.name) {
          indi.name = b.value;
          indi.nick = sub.find((s) => s.tag === 'NICK')?.value.trim() || undefined;
        } else if (b.tag === 'SEX' && indi.sex === 'U') {
          indi.sex = sexOf(b.value);
        } else if (b.tag === 'BIRT' && !indi.birth) {
          indi.birth = parseGedDate(sub.find((s) => s.tag === 'DATE')?.value);
        } else if (b.tag === 'DEAT') {
          indi.dead = true;
          indi.death = indi.death || parseGedDate(sub.find((s) => s.tag === 'DATE')?.value);
        } else if (b.tag === 'BURI' || b.tag === 'CREM') {
          // A burial with no death record still means the person has died.
          indi.dead = true;
        } else if (b.tag === 'NOTE') {
          if (b.value.trim()) indi.notes.push(b.value.trim());
        } else if (b.tag === 'FAMC') {
          const ref = derefPointer(b.value);
          if (ref) indi.famc.push({ xref: ref, pedi: sub.find((s) => s.tag === 'PEDI')?.value.trim().toLowerCase() });
        }
      }
      indis.push(indi);
      continue;
    }

    if (l.tag === 'FAM' && l.xref) {
      const fam: GedFam = { xref: l.xref, spouses: [], children: [], married: false, divorced: false };
      for (const b of body) {
        if (b.level !== 1) continue;
        if (b.tag === 'HUSB' || b.tag === 'WIFE') {
          const ref = derefPointer(b.value);
          if (ref && !fam.spouses.includes(ref)) fam.spouses.push(ref);
        } else if (b.tag === 'CHIL') {
          const ref = derefPointer(b.value);
          if (ref && !fam.children.includes(ref)) fam.children.push(ref);
        } else if (b.tag === 'MARR') {
          fam.married = true;
        } else if (b.tag === 'DIV') {
          fam.divorced = true;
        }
      }
      fams.push(fam);
    }
  }

  return { indis, fams, charset, source, ignoredLines: ignored };
}

// --- Plan ------------------------------------------------------------------

export type ImportPersonAction = 'matched' | 'new-extended' | 'new-memory' | 'ambiguous';

export interface PlannedPerson {
  xref: string;
  name: string;
  action: ImportPersonAction;
  /** Where this person's links will attach. Absent only when ambiguous. */
  ref?: KinRef;
  /** Plain-language line under the name in the preview. */
  detail: string;
}

export interface PlannedLink {
  kind: 'parent' | 'partner';
  label: string;
  action: 'new' | 'already' | 'blocked';
  reason?: string;
}

export interface GedcomImportPlan {
  /** Set when nothing can be imported at all — shown instead of the preview. */
  refusal?: string;
  people: PlannedPerson[];
  links: PlannedLink[];
  warnings: string[];
  counts: {
    newPeople: number;
    matched: number;
    ambiguous: number;
    newLinks: number;
    skippedLinks: number;
  };
}

export interface GedcomImportResult {
  plan: GedcomImportPlan;
  /** The FULL arrays to save — existing records first, unchanged. */
  extendedBirthdays: ExtendedBirthday[];
  inMemory: DepartedRelative[];
  links: KinLink[];
}

export interface GedcomImportOptions {
  /** Injected so ids are deterministic in tests — and unique in bulk, which
   *  `Date.now() + random()` is not when 400 records are made in one tick. */
  newId?: (seed: string) => string;
  todayISO?: string;
}

/**
 * The vault keeps each of these lists in a single document, so a five-thousand
 * person Ancestry tree does not fit — and a half-written import is far worse
 * than a refused one. The caps are generous for a family tree and firm.
 */
export const MAX_IMPORT_CHARS = 5_000_000;
export const MAX_IMPORT_PEOPLE = 400;
export const MAX_IMPORT_LINKS = 1_500;

const PEDI_VIA: Record<string, KinLink['via'] | undefined> = {
  birth: undefined,
  natural: undefined,
  adopted: 'adoptive',
  adoptive: 'adoptive',
  step: 'step',
  foster: 'foster',
};

/**
 * A refusal carries the vault back UNCHANGED, not empty.
 *
 * The caller decides what to write from these three arrays, so a refused plan
 * holding empty ones is a loaded gun: any path that reached the save without
 * re-checking `refusal` would not import nothing, it would delete everything.
 * Returning the existing records makes that failure impossible rather than
 * merely guarded against.
 */
const refused = (
  message: string,
  existing: KinSources & { links?: readonly KinLink[] },
): GedcomImportResult => ({
  plan: {
    refusal: message,
    people: [],
    links: [],
    warnings: [],
    counts: { newPeople: 0, matched: 0, ambiguous: 0, newLinks: 0, skippedLinks: 0 },
  },
  extendedBirthdays: [...(existing.extendedBirthdays || [])],
  inMemory: [...(existing.inMemory || [])],
  links: [...(existing.links || [])],
});

const lifespan = (indi: GedIndi): string => {
  const b = indi.birth?.year;
  const d = indi.death?.year;
  if (b && d) return `${b}–${d}`;
  if (b) return `born ${b}`;
  if (d) return `died ${d}`;
  return indi.dead ? 'no dates recorded' : '';
};

/**
 * Read a .ged file against what is already on file and produce both the
 * preview and the records to save.
 *
 * NOTHING IS WRITTEN HERE and nothing is written by the caller until a person
 * has read the preview. An import is the one operation in this app that can
 * add a hundred records at once; it does not get to do that unannounced.
 */
export function planGedcomImport(
  text: string,
  existing: KinSources & { links?: readonly KinLink[] },
  opts: GedcomImportOptions = {},
): GedcomImportResult {
  const newId = opts.newId || ((seed: string) => `ged-${Date.now()}-${seed}`);
  const createdAt = opts.todayISO || new Date().toISOString().slice(0, 10);

  const source = String(text || '');
  if (!source.trim()) return refused('That file is empty.', existing);
  if (source.length > MAX_IMPORT_CHARS) {
    return refused('That file is too large to read in one go. A family tree of a few hundred people is well under the limit — this looks like a full archive.', existing);
  }

  const file = parseGedcom(source);
  if (!file.indis.length) {
    return refused(
      file.ignoredLines > 0
        ? 'No people could be read from that file. It may not be a GEDCOM file, or it may have been damaged in transit.'
        : 'That file has no people in it.',
      existing,
    );
  }
  if (file.indis.length > MAX_IMPORT_PEOPLE) {
    return refused(`That file holds ${file.indis.length} people. This vault keeps the tree as one record, so it can take up to ${MAX_IMPORT_PEOPLE} — a whole-archive export from a genealogy site is usually far larger than the family in it.`, existing);
  }

  const warnings: string[] = [];
  const charset = (file.charset || '').toUpperCase();
  if (charset && !charset.startsWith('UTF') && !charset.startsWith('ASCII')) {
    warnings.push(`This file says it is written in ${file.charset}, not UTF-8. Accented names may come through wrong — worth checking Müller, Böhm and the like after importing.`);
  }
  if (file.ignoredLines > 0) {
    warnings.push(`${file.ignoredLines} line${file.ignoredLines === 1 ? '' : 's'} could not be read and ${file.ignoredLines === 1 ? 'was' : 'were'} skipped.`);
  }

  // --- Match against everyone already on file ---
  const existingPeople = buildKinGraph(existing, [...(existing.links || [])]).people;
  const byName = new Map<string, KinRef[]>();
  for (const p of existingPeople) {
    const key = normName(p.name);
    if (!key) continue;
    const bucket = byName.get(key);
    if (bucket) bucket.push(p.ref); else byName.set(key, [p.ref]);
  }

  const display = new Map<string, string>();
  for (const indi of file.indis) display.set(indi.xref, gedcomDisplayName(indi.name, indi.nick));

  // Two incoming people who both match the SAME existing record would fuse
  // that record into a composite of two different lives. Neither may match.
  const claims = new Map<KinRef, string[]>();
  for (const indi of file.indis) {
    const hits = byName.get(normName(display.get(indi.xref)!)) || [];
    if (hits.length !== 1) continue;
    const bucket = claims.get(hits[0]);
    if (bucket) bucket.push(indi.xref); else claims.set(hits[0], [indi.xref]);
  }

  const people: PlannedPerson[] = [];
  const refFor = new Map<string, KinRef>();
  const newExtended: ExtendedBirthday[] = [];
  const newMemory: DepartedRelative[] = [];

  let privatised = 0;

  for (const indi of file.indis) {
    const name = display.get(indi.xref)!;
    const hits = byName.get(normName(name)) || [];
    const span = lifespan(indi);

    // The file itself withheld this person. Nothing to file them under.
    if (isPrivatisedName(name)) {
      privatised += 1;
      people.push({
        xref: indi.xref,
        name: name.trim() || 'Someone unnamed',
        action: 'ambiguous',
        detail: 'The file hides this person’s name, so there is nobody to add. Add them yourself and draw their links by hand.',
      });
      continue;
    }

    if (hits.length > 1) {
      people.push({
        xref: indi.xref,
        name,
        action: 'ambiguous',
        detail: `${hits.length} people already on file are called this. Nothing was added for them — say which one this is by hand.`,
      });
      continue;
    }
    if (hits.length === 1) {
      const rivals = claims.get(hits[0]) || [];
      if (rivals.length > 1) {
        people.push({
          xref: indi.xref,
          name,
          action: 'ambiguous',
          detail: `The file has ${rivals.length} people called this and the vault has one. Nothing was added for them.`,
        });
        continue;
      }
      refFor.set(indi.xref, hits[0]);
      people.push({
        xref: indi.xref,
        name,
        action: 'matched',
        ref: hits[0],
        detail: `Already on file${span ? ` · ${span}` : ''} — their links come across, their record is left alone.`,
      });
      continue;
    }

    // Someone recorded as having died belongs in In Memory, whose born/died
    // are free text and can hold "ABT 1861" as faithfully as the file wrote
    // it. Everyone else goes to Extended birthdays, the vault's list of
    // relatives who are not in the household.
    // How they are related, in the family's own words. A tree exported from
    // here says so outright; otherwise the kinship word in a name the file
    // could not use as the display name is the next best thing — "Ouma
    // Katrien" was going to be thrown away entirely, and it is the one word
    // that tells the tree she is a grandmother rather than an unknown.
    const relation = indi.notes.find((n) => /^Recorded in Teluva as: /.test(n))?.replace(/^Recorded in Teluva as: /, '')
      || titleFromName(indi.nick)
      || titleFromName(name);
    const remembered = indi.notes.filter((n) => !/^Recorded in Teluva as: /.test(n));

    if (indi.dead || indi.death) {
      const id = newId(indi.xref);
      newMemory.push({
        id,
        name,
        // In Memory shows this under the name and its own form insists on
        // one, so a blank here would be a record the app would not accept if
        // it had been typed.
        relation: relation || 'Relative',
        born: humanGedDate(indi.birth),
        died: humanGedDate(indi.death),
        documents: [],
        // A note in a GEDCOM is usually the one story that came with the
        // person — exactly what In Memory keeps.
        notes: remembered.map((text, i) => ({ id: `${id}-n${i + 1}`, text })),
        createdAt,
      });
      const ref = kinRef('memory', id);
      refFor.set(indi.xref, ref);
      people.push({ xref: indi.xref, name, action: 'new-memory', ref, detail: `In Memory${span ? ` · ${span}` : ''}` });
      continue;
    }

    const id = newId(indi.xref);
    newExtended.push({
      id,
      name,
      relationship: relation || undefined,
      notes: remembered.length ? remembered.join('\n') : undefined,
      // Not every ancestor has a birthday anyone recorded. An empty date is
      // the honest answer; the birthday list simply has nothing to remind
      // anyone about, and the person still exists in the tree.
      date: indi.birth?.monthDay || '',
      originalYear: indi.birth?.year,
      createdAt,
    });
    const ref = kinRef('extended', id);
    refFor.set(indi.xref, ref);
    people.push({
      xref: indi.xref,
      name,
      action: 'new-extended',
      ref,
      detail: indi.birth?.monthDay
        ? `Extended birthdays · ${span || 'birthday recorded'}`
        : `Extended birthdays · ${span || 'no birthday recorded'}`,
    });
  }

  // --- Links ---
  const projected: KinSources = {
    members: existing.members,
    extendedBirthdays: [...(existing.extendedBirthdays || []), ...newExtended],
    inMemory: [...(existing.inMemory || []), ...newMemory],
  };
  const stored: KinLink[] = [...(existing.links || [])];
  let graph: KinGraph = buildKinGraph(projected, stored);

  const links: PlannedLink[] = [];
  const added: KinLink[] = [];
  let seq = 0;
  let truncated = false;

  const nameOf = (xref: string) => display.get(xref) || 'Someone';

  const consider = (
    kind: 'parent' | 'partner',
    fromXref: string,
    toXref: string,
    extra: Pick<KinLink, 'via' | 'status'>,
  ) => {
    const label = kind === 'parent'
      ? `${nameOf(fromXref)} → parent of ${nameOf(toXref)}`
      : `${nameOf(fromXref)} & ${nameOf(toXref)}`;
    const from = refFor.get(fromXref);
    const to = refFor.get(toXref);
    if (!from || !to) {
      const ends = [fromXref, toXref];
      const missing = ends.some((x) => !display.has(x));
      const hidden = ends.some((x) => display.has(x) && isPrivatisedName(display.get(x)!));
      links.push({
        kind,
        label,
        action: 'blocked',
        reason: missing
          ? 'The file points at somebody it does not actually contain.'
          : hidden
            ? 'The file hides that person’s name, so there is nothing to connect to.'
            : 'One of the two could not be placed.',
      });
      return;
    }
    // Already there — including via a partner link the file wrote in the
    // other direction, which is the same fact, not a second one.
    const dupe = kind === 'partner'
      ? partnersOf(graph, from).includes(to)
      : parentsOf(graph, to).includes(from);
    if (dupe) {
      links.push({ kind, label, action: 'already' });
      return;
    }
    const problem = kinLinkProblem({ kind, from, to }, graph);
    if (problem) {
      links.push({ kind, label, action: 'blocked', reason: problem });
      return;
    }
    seq += 1;
    const link: KinLink = { id: newId(`link-${seq}`), kind, from, to, ...extra, createdAt };
    added.push(link);
    stored.push(link);
    graph = buildKinGraph(projected, stored);
    links.push({ kind, label, action: 'new' });
  };

  for (const fam of file.fams) {
    if (added.length + (fam.children.length + 1) * fam.spouses.length > MAX_IMPORT_LINKS) { truncated = true; break; }
    const [a, b] = fam.spouses;
    if (a && b) {
      consider('partner', a, b, { status: fam.divorced ? 'divorced' : fam.married ? 'married' : undefined });
    }
    for (const child of fam.children) {
      const childRecord = file.indis.find((i) => i.xref === child);
      const pedi = childRecord?.famc.find((f) => f.xref === fam.xref)?.pedi;
      const via = pedi ? PEDI_VIA[pedi] : undefined;
      for (const parent of fam.spouses) consider('parent', parent, child, { via });
    }
  }

  if (privatised) {
    warnings.push(`${privatised} ${privatised === 1 ? 'person is' : 'people are'} hidden in this file — genealogy sites strip living people's names out of an export before handing it to someone else. They were left out rather than added as "Living".`);
  }
  if (truncated) {
    warnings.push(`This file has more than ${MAX_IMPORT_LINKS} connections in it. The ones past that point were left out — say so rather than half-write them.`);
  }

  // A link that could not be placed is worth one line, not fifty identical
  // ones, so the preview stays readable on a phone.
  const skipped = links.filter((l) => l.action === 'blocked').length;

  return {
    plan: {
      people,
      links,
      warnings,
      counts: {
        newPeople: newExtended.length + newMemory.length,
        matched: people.filter((p) => p.action === 'matched').length,
        ambiguous: people.filter((p) => p.action === 'ambiguous').length,
        newLinks: added.length,
        skippedLinks: skipped,
      },
    },
    extendedBirthdays: [...(existing.extendedBirthdays || []), ...newExtended],
    inMemory: [...(existing.inMemory || []), ...newMemory],
    links: stored,
  };
}

/** One line for the confirm button — what the family is about to agree to. */
export function importSummary(plan: GedcomImportPlan): string {
  const c = plan.counts;
  const bits: string[] = [];
  bits.push(`${c.newPeople} new ${c.newPeople === 1 ? 'person' : 'people'}`);
  if (c.matched) bits.push(`${c.matched} already on file`);
  bits.push(`${c.newLinks} ${c.newLinks === 1 ? 'connection' : 'connections'}`);
  return bits.join(', ');
}

