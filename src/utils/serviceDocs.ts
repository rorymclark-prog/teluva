/* ---------------------------------------------------------------------------
 * Receipts and invoices filed WITH a service entry.
 *
 * Rory, 2026-09-12: "i just had a bicycle service for example where does the
 * receiot and document of the service live? also, we need for anything
 * imagine i had a dishwasher service where do we keep it? the document".
 *
 * The answer this module encodes: the FILE lives in the Document Vault, like
 * every other paper the family owns — one place to search, share and back up.
 * A service entry (a vehicle's ServiceRecord, the house's HomeServiceRecord)
 * only holds `docIds`, pointers into the vault.
 *
 * Two rules every function here keeps:
 *
 *  1. POINTERS MAY DANGLE. A document can be deleted from the vault while an
 *     entry still names it, and an assetId can outlive its Belongings item.
 *     Readers filter unknown ids; nothing here throws on one.
 *  2. NO BACK-POINTER. The vault's "Filed with Trek FX · service 10 Sep" is
 *     DERIVED from the household doc (filedWithIndex), never stored on the
 *     VaultDocument. One fact, one writer — a second copy is how the v228
 *     birthday split-brain started.
 *
 * Pure: no Firebase, so the tests import it directly. The upload lives in
 * serviceDocUpload.ts.
 * ------------------------------------------------------------------------- */

import type { AssetItem, FamilyMember, HomeServiceRecord, HouseholdInfo, VaultDocument } from '../types';
import { vehicleLabel } from './vehicle';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-10" → "10 Sep 2026" (or "10 Sep" with `withYear` false). Fixed
 *  month names rather than toLocaleDateString: ICU spells September "Sept"
 *  in en-GB on some runtimes, and a document's NAME must not depend on which
 *  phone filed it. */
export function shortServiceDate(iso: string | undefined, withYear = true): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return '';
  const day = String(Number(m[3]));
  return withYear ? `${day} ${month} ${m[1]}` : `${day} ${month}`;
}

/* "repair" when the work reads like something broke, else "service". Only
 * used for the auto-name and the vault's "Filed with" line, so a wrong guess
 * costs a word, never data. */
export function serviceVerb(work: string | undefined): 'repair' | 'service' {
  return /\b(repair|repaired|fix|fixed|broke|broken|leak|leaking|replace|replaced|fault|puncture|reparatur|kaputt)\b/i
    .test(work || '') ? 'repair' : 'service';
}

/** The name a scanned/uploaded receipt is filed under in the vault:
 *  "Trek FX — service 10 Sep 2026", "Dishwasher — repair 10 Sep 2026". */
export function serviceDocName(subject: string, verb: string, dateISO?: string): string {
  const s = (subject || '').trim() || 'Service';
  const when = shortServiceDate(dateISO);
  return when ? `${s} — ${verb} ${when}` : `${s} — ${verb}`;
}

/* Vehicle.assignedMember holds a member NAME (historical), the vault links by
 * member ID. Exact, case-insensitive match only — guessing "Rory" onto "Rory
 * Senior" files a receipt on the wrong person's profile. */
export function memberIdForName(members: Pick<FamilyMember, 'id' | 'name'>[], name?: string): string | undefined {
  const n = (name || '').trim().toLowerCase();
  if (!n) return undefined;
  return members.find((m) => (m.name || '').trim().toLowerCase() === n)?.id;
}

/** The documents an entry points at, in its own order, dangling ids dropped. */
export function resolveDocIds(ids: string[] | undefined, docs: VaultDocument[]): VaultDocument[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const out: VaultDocument[] = [];
  for (const id of ids) {
    const d = typeof id === 'string' ? byId.get(id) : undefined;
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** How many of an entry's ids no longer resolve (deleted from the vault). */
export function missingDocCount(ids: string[] | undefined, docs: VaultDocument[]): number {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const have = new Set(docs.map((d) => d.id));
  return new Set(ids.filter((id) => typeof id === 'string' && !have.has(id))).size;
}

/** Add an id once, keeping order. */
export function withDocId(ids: string[] | undefined, id: string): string[] {
  const cur = Array.isArray(ids) ? ids : [];
  return cur.includes(id) ? cur : [...cur, id];
}

/* Removing the LAST link must leave the key absent, not `[]` — an empty
 * array is a value the merge will faithfully keep forever, absent is "never
 * had one", and the two should look the same on disk. */
export function withoutDocId(ids: string[] | undefined, id: string): string[] | undefined {
  const next = (Array.isArray(ids) ? ids : []).filter((x) => x !== id);
  return next.length ? next : undefined;
}

/** A copy of `rec` with `id` linked. Spreads the record, so a field this
 *  code has never heard of survives ("a forgotten key is a DELETE"). */
export function linkDoc<T extends { docIds?: string[] }>(rec: T, id: string): T {
  return { ...rec, docIds: withDocId(rec.docIds, id) };
}

/** A copy of `rec` with `id` unlinked; the key is dropped when none remain. */
export function unlinkDoc<T extends { docIds?: string[] }>(rec: T, id: string): T {
  const next = { ...rec };
  const ids = withoutDocId(rec.docIds, id);
  if (ids) next.docIds = ids; else delete next.docIds;
  return next;
}

/* ─── The derived "Filed with …" lookup for the Document Vault ──────────── */

export interface FiledWith {
  /** 'vehicle' → a Vehicle's serviceLog; 'home' → HouseholdInfo.homeServiceLog. */
  kind: 'vehicle' | 'home';
  /** What was serviced: "Trek FX", "Dishwasher", "Boiler". */
  subject: string;
  verb: 'service' | 'repair';
  date: string;          // YYYY-MM-DD
  entryId: string;
}

/** The thing a house entry is ABOUT: its linked Belongings item when that
 *  still exists, else the free-text area, else the work itself. */
export function homeEntrySubject(r: HomeServiceRecord, assets: Pick<AssetItem, 'id' | 'name'>[] = []): string {
  const asset = r.assetId ? assets.find((a) => a.id === r.assetId) : undefined;
  const named = (asset?.name || r.area || '').trim();
  if (named) return named;
  // Falling back to the work description: cap it, it becomes a file name.
  const work = (r.work || '').trim();
  if (!work) return 'Home';
  return work.length > 40 ? work.slice(0, 39).trimEnd() + '…' : work;
}

/**
 * docId → every service entry that files it. Derived on read from the
 * household doc; the VaultDocument itself carries nothing.
 */
export function filedWithIndex(
  household: HouseholdInfo | null | undefined,
  assets: Pick<AssetItem, 'id' | 'name'>[] = [],
): Map<string, FiledWith[]> {
  const out = new Map<string, FiledWith[]>();
  const add = (id: unknown, f: FiledWith) => {
    if (typeof id !== 'string' || !id) return;
    const list = out.get(id);
    if (list) list.push(f); else out.set(id, [f]);
  };
  for (const v of household?.vehicles || []) {
    for (const r of v?.serviceLog || []) {
      if (!Array.isArray(r?.docIds)) continue;
      const f: FiledWith = { kind: 'vehicle', subject: vehicleLabel(v), verb: serviceVerb(r.work), date: r.date || '', entryId: r.id };
      r.docIds.forEach((id) => add(id, f));
    }
  }
  for (const r of household?.homeServiceLog || []) {
    if (!Array.isArray(r?.docIds)) continue;
    const f: FiledWith = { kind: 'home', subject: homeEntrySubject(r, assets), verb: serviceVerb(r.work), date: r.date || '', entryId: r.id };
    r.docIds.forEach((id) => add(id, f));
  }
  return out;
}

/** "Trek FX · service 10 Sep" — the year only when it is not this year. */
export function filedWithText(f: FiledWith, now: Date = new Date()): string {
  const sameYear = f.date.slice(0, 4) === String(now.getFullYear());
  const when = shortServiceDate(f.date, !sameYear);
  return when ? `${f.subject} · ${f.verb} ${when}` : `${f.subject} · ${f.verb}`;
}

/* ─── Belongings: an item's own service history ─────────────────────────── */

/** Every house entry about this item, newest first. Unknown id → []. */
export function serviceHistoryForAsset(
  household: HouseholdInfo | null | undefined,
  assetId: string | undefined,
): HomeServiceRecord[] {
  if (!assetId) return [];
  return (household?.homeServiceLog || [])
    .filter((r) => r && r.assetId === assetId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
