import { KinLink, KinRef } from '../types';
import { KinGraph, KinPerson, kinName } from './kin';

// ---------------------------------------------------------------------------
// GEDCOM 5.5.1 export.
//
// WHY THIS EXISTS AT ALL: a family tree that only opens in the app that made
// it is a worse place to keep four generations than a shoebox, because at
// least the shoebox outlives the company. GEDCOM is the one format every
// genealogy program on earth imports — FamilySearch, MyHeritage, Ancestry,
// Geni, Gramps, Reunion — and it has been stable since 1999. Writing it is a
// few hundred lines; the alternative is asking a family to retype their
// grandparents.
//
// 5.5.1 rather than the newer 7.0 on purpose: 7.0 is better specified and
// almost nothing imports it yet.
//
// THE STRUCTURAL MISMATCH, which is most of the work below. Our model is
// person-centric: an edge says "A is a parent of B". GEDCOM is family-centric:
// a FAM record holds a HUSB, a WIFE and their CHIL. So children have to be
// grouped by their exact set of parents, one FAM per distinct set, and
// adoptive/step parents split into their own FAM carrying a PEDI tag — which
// is exactly what PEDI is for, and is how an adopted child keeps both sets of
// parents on import instead of losing one.
// ---------------------------------------------------------------------------

const CRLF = '\r\n';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * `@` is the pointer delimiter, so a literal one must be doubled or the file
 * is corrupt from that line on. An email address in a note is enough to do it.
 */
const esc = (s: string): string => s.replace(/@/g, '@@');

/**
 * A cross-reference value (`@I1@`), written RAW.
 *
 * Pointers are the one place an `@` is structural rather than text, so they
 * must skip the escaping above — double them and every link between people in
 * the file breaks while the file still looks superficially valid.
 */
function ptr(out: string[], level: number, tag: string, xref: string): void {
  out.push(`${level} ${tag} @${xref}@`);
}

/** One tag, wrapped: real newlines become CONT, over-long values become CONC. */
function line(out: string[], level: number, tag: string, value?: string): void {
  if (value === undefined || value === '') { out.push(`${level} ${tag}`); return; }
  const parts = esc(value).split(/\r?\n/);
  parts.forEach((part, i) => {
    const t = i === 0 ? tag : 'CONT';
    const lvl = i === 0 ? level : level + 1;
    // 255 bytes is the spec's line cap; 200 chars leaves room for multi-byte
    // characters without having to count bytes.
    if (part.length <= 200) { out.push(`${lvl} ${t} ${part}`); return; }
    let rest = part;
    let first = true;
    while (rest.length) {
      const chunk = rest.slice(0, 200);
      rest = rest.slice(200);
      out.push(first ? `${lvl} ${t} ${chunk}` : `${level + 1} CONC ${chunk}`);
      first = false;
    }
  });
}

// A name that OPENS with a relationship word is a family nickname, not a
// structured name, and the last-token-is-a-surname rule is wrong for it.
// "Grandma Sue" exported as given name "Grandma", surname "Sue" — inventing a
// surname the family never wrote, in a file designed to be merged into other
// people's trees. Strip the title first and the rule works again on what is
// left: "Grandma Sue" → Sue, no surname; "Oma Anna Müller" → Anna /Müller/.
export const TITLES = [
  'grandma', 'grandmother', 'granny', 'gran', 'nan', 'nana', 'oma', 'ouma',
  'grandad', 'granddad', 'grandpa', 'grandfather', 'opa', 'oupa',
  'auntie', 'aunty', 'aunt', 'tante', 'tannie', 'uncle', 'onkel', 'oom',
  'mum', 'mom', 'mother', 'ma', 'mama', 'dad', 'father', 'pa', 'papa',
  'great', 'step', 'oupa-grootjie',
];

/** 'Rory Michael Clark' → 'Rory Michael /Clark/'. A single word gets no surname. */
export function gedcomName(name: string): string {
  let parts = (name || '').trim().split(/\s+/).filter(Boolean);
  // Only ever strip a LEADING run of titles, and never the last token — a
  // person called only "Oma" still needs a name in the file.
  while (parts.length > 1 && TITLES.includes(parts[0].toLowerCase().replace(/[^a-zäöüß-]/g, ''))) {
    parts = parts.slice(1);
  }
  if (parts.length === 0) return 'Unnamed';
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(' ')} /${surname}/`;
}

/**
 * The name the family actually typed, when the export shortened it.
 *
 * "Grandma Sue" is what she is called, and dropping it because GEDCOM wanted a
 * structured name would lose the only version anyone recognises. NICK is the
 * spec's own slot for it.
 */
export function gedcomNick(name: string): string | undefined {
  const original = (name || '').trim();
  if (!original) return undefined;
  const structured = gedcomName(original).replace(/\//g, '');
  return structured === original ? undefined : original;
}

/** YYYY-MM-DD → '12 MAR 1938'. A bare year stays a bare year. */
export function gedcomDate(iso?: string, year?: number): string | undefined {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    if (m >= 1 && m <= 12) return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  if (year && year > 999 && year < 3000) return String(year);
  return undefined;
}

interface GedFamily {
  key: string;
  parents: KinRef[];
  children: KinRef[];
  via: 'birth' | 'adoptive' | 'step' | 'foster';
  status?: KinLink['status'];
}

const setKey = (refs: readonly KinRef[]) => [...refs].sort().join(',');

/**
 * Turn person-centric edges into GEDCOM's family records.
 *
 * Children are grouped by (pedigree, exact parent set), so siblings land in one
 * FAM and an adopted child's two sets of parents stay distinct. A partnership
 * with no children between them still gets a FAM, because a marriage is a fact
 * worth exporting on its own.
 */
export function buildGedFamilies(g: KinGraph): GedFamily[] {
  const byKey = new Map<string, GedFamily>();

  const childRefs = new Set<KinRef>();
  for (const l of g.links) if (l.kind === 'parent') childRefs.add(l.to);

  for (const child of [...childRefs].sort()) {
    const links = g.links.filter((l) => l.kind === 'parent' && l.to === child);
    const groups = new Map<string, KinRef[]>();
    for (const l of links) {
      const via = l.via || 'birth';
      const bucket = groups.get(via);
      if (bucket) { if (!bucket.includes(l.from)) bucket.push(l.from); } else groups.set(via, [l.from]);
    }
    for (const [via, parents] of groups) {
      const key = `${via}|${setKey(parents)}`;
      const fam = byKey.get(key);
      if (fam) { if (!fam.children.includes(child)) fam.children.push(child); } else {
        byKey.set(key, { key, parents: [...parents].sort(), children: [child], via: via as GedFamily['via'] });
      }
    }
  }

  // Partnerships. One between people who are already a child's birth parents
  // enriches that family with a MARR rather than creating a second one.
  for (const l of g.links) {
    if (l.kind !== 'partner') continue;
    const pair = [l.from, l.to];
    const birthKey = `birth|${setKey(pair)}`;
    const existing = byKey.get(birthKey);
    if (existing) { existing.status = existing.status || l.status; continue; }
    const soloKey = `union|${setKey(pair)}`;
    if (byKey.has(soloKey)) continue;
    byKey.set(soloKey, { key: soloKey, parents: [...pair].sort(), children: [], via: 'birth', status: l.status });
  }

  return [...byKey.values()];
}

const PEDI: Record<string, string | undefined> = {
  birth: undefined,   // the default — writing it adds noise, not information
  adoptive: 'adopted',
  step: 'step',
  foster: 'foster',
};

export interface GedcomOptions {
  /** Shown in the file header so an importer can see where it came from. */
  appVersion?: string;
  /** The family's own name for this vault, used as the submitter. */
  familyLabel?: string;
  /** Today, as YYYY-MM-DD. Injected so the output is testable. */
  todayISO?: string;
}

/**
 * The whole tree as one GEDCOM file.
 *
 * EVERY PERSON IS EXPORTED, including the ones with no edges yet — a
 * grandmother nobody has connected up is still someone the family recorded,
 * and dropping her from the export would make the file quietly lossier than
 * the app.
 */
export function toGedcom(g: KinGraph, opts: GedcomOptions = {}): string {
  const out: string[] = [];
  const today = gedcomDate(opts.todayISO) || gedcomDate(new Date().toLocaleDateString('en-CA'));

  const indiId = new Map<KinRef, string>();
  g.people.forEach((p, i) => indiId.set(p.ref, `I${i + 1}`));

  const families = buildGedFamilies(g);
  const famId = new Map<string, string>();
  families.forEach((f, i) => famId.set(f.key, `F${i + 1}`));

  // --- header ---
  line(out, 0, 'HEAD');
  line(out, 1, 'SOUR', 'Teluva');
  line(out, 2, 'NAME', 'Teluva Family Vault');
  if (opts.appVersion) line(out, 2, 'VERS', opts.appVersion);
  line(out, 1, 'GEDC');
  line(out, 2, 'VERS', '5.5.1');
  line(out, 2, 'FORM', 'LINEAGE-LINKED');
  line(out, 1, 'CHAR', 'UTF-8');
  if (today) line(out, 1, 'DATE', today);
  ptr(out, 1, 'SUBM', 'SUB1');
  line(out, 0, '@SUB1@ SUBM');
  line(out, 1, 'NAME', opts.familyLabel || 'Family');

  // --- people ---
  for (const p of g.people) {
    const id = indiId.get(p.ref)!;
    line(out, 0, `@${id}@ INDI`);
    line(out, 1, 'NAME', gedcomName(p.name));
    const nick = gedcomNick(p.name);
    if (nick) line(out, 2, 'NICK', nick);
    line(out, 1, 'SEX', p.sex);

    const birth = gedcomDate(p.birthdate, p.birthYear);
    if (birth) { line(out, 1, 'BIRT'); line(out, 2, 'DATE', birth); }
    if (p.deathYear) { line(out, 1, 'DEAT'); line(out, 2, 'DATE', String(p.deathYear)); }
    // A recurring birthday with no year cannot be a GEDCOM date at all, so it
    // goes in a note rather than being padded out to an invented year.
    if (!birth && p.birthdayMonthDay && /^\d{2}-\d{2}$/.test(p.birthdayMonthDay)) {
      const [mm, dd] = p.birthdayMonthDay.split('-').map(Number);
      if (mm >= 1 && mm <= 12) line(out, 1, 'NOTE', `Birthday ${dd} ${MONTHS[mm - 1]} (year not recorded)`);
    }
    if (p.departed && !p.deathYear) line(out, 1, 'DEAT', 'Y');   // known dead, date unknown
    if (p.relation) line(out, 1, 'NOTE', `Recorded in Teluva as: ${p.relation}`);

    for (const f of families) {
      const fid = famId.get(f.key)!;
      if (f.parents.includes(p.ref)) ptr(out, 1, 'FAMS', fid);
      if (f.children.includes(p.ref)) {
        ptr(out, 1, 'FAMC', fid);
        const pedi = PEDI[f.via];
        if (pedi) line(out, 2, 'PEDI', pedi);
      }
    }
  }

  // --- families ---
  for (const f of families) {
    const fid = famId.get(f.key)!;
    line(out, 0, `@${fid}@ FAM`);
    // GEDCOM holds one HUSB and one WIFE. Sex decides which slot; unknown sex
    // fills whichever is free, so a same-sex or unrecorded couple still both
    // appear rather than one of them being dropped.
    const people = f.parents.map((r) => g.index.get(r)).filter(Boolean) as KinPerson[];
    let husb = people.find((p) => p.sex === 'M');
    let wife = people.find((p) => p.sex === 'F');
    for (const p of people) {
      if (p === husb || p === wife) continue;
      if (!husb) husb = p; else if (!wife) wife = p;
    }
    if (husb) ptr(out, 1, 'HUSB', indiId.get(husb.ref)!);
    if (wife) ptr(out, 1, 'WIFE', indiId.get(wife.ref)!);
    for (const c of f.children) ptr(out, 1, 'CHIL', indiId.get(c)!);
    if (f.status === 'married') line(out, 1, 'MARR', 'Y');
    if (f.status === 'divorced') { line(out, 1, 'MARR', 'Y'); line(out, 1, 'DIV', 'Y'); }
    if (f.status === 'widowed') line(out, 1, 'MARR', 'Y');
    // A third or fourth parent has no slot in a 5.5.1 family record. Say so in
    // the file rather than silently dropping the person.
    const extra = people.filter((p) => p !== husb && p !== wife);
    if (extra.length) {
      line(out, 1, 'NOTE', `Also recorded as a parent here: ${extra.map((p) => p.name).join(', ')}`);
    }
  }

  line(out, 0, 'TRLR');
  return out.join(CRLF) + CRLF;
}

/** A filename a family will recognise a year later. */
export function gedcomFilename(familyLabel?: string, todayISO?: string): string {
  const stamp = (todayISO || new Date().toLocaleDateString('en-CA')).slice(0, 10);
  const base = (familyLabel || 'family').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'family';
  return `${base}-tree-${stamp}.ged`;
}

/** How many people and links the file will carry — shown before the download. */
export function gedcomSummary(g: KinGraph): { people: number; families: number; unlinked: string[] } {
  const linked = new Set<KinRef>();
  for (const l of g.links) { linked.add(l.from); linked.add(l.to); }
  return {
    people: g.people.length,
    families: buildGedFamilies(g).length,
    unlinked: g.people.filter((p) => !linked.has(p.ref)).map((p) => kinName(p.ref, g.index)),
  };
}
