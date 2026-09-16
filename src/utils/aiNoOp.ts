// Drop the edits that would change nothing.
//
// WHY THIS EXISTS
// ---------------
// When the assistant reads a document it re-states everything it recognises —
// including the facts the family already has on file. A parental consent letter
// names a passport number, so back comes an `update_record` setting that
// passport's number to the value it already holds. Nothing happens when it is
// applied; the harm is entirely in the asking.
//
// And the asking is expensive. `update_record` is classified DESTRUCTIVE
// (aiDestructive.ts), which means the Apply card renders expanded and refuses
// to collapse — deliberately, so a real deletion can never be waved through
// folded up. So a scan that genuinely contributes two new facts arrives as a
// nine-row batch with four rewrite-looking rows in it, and the user has to
// read and clear every one. Do that a few times and the reflex becomes "tap
// Apply without reading", which is precisely the reflex the destructive-edit
// design exists to prevent. Noise here doesn't just annoy; it erodes the one
// safeguard in front of the dangerous edits.
//
// THE RULE, deliberately strict
// -----------------------------
// An edit is dropped only when applying it would leave a byte-identical
// record. Not "similar", not "close enough after normalising punctuation" —
// each check below mirrors the EXACT merge that utils/aiApply.ts or
// utils/aiDestructive.ts performs, then deep-compares the result with what is
// there now. A trailing space, a changed capital, a reformatted date: all real
// changes, all kept.
//
// That strictness is what earns the right to run without asking. Because the
// only rows this can remove are rows that were provably going to do nothing,
// it cannot hide a correction, and no genuine change can be lost to a
// normalisation rule that turned out to be too clever. If the comparison
// cannot be made confidently — unknown field, record not found, patch empty —
// the edit is KEPT. Every uncertain path fails towards showing the user more,
// never less.
//
// What is dropped is reported back (see `skipped`), never silently swallowed:
// "already saved" is useful information about a document, and a batch that
// quietly shrank would be its own kind of unexplained.

/** Total, order-insensitive structural equality. Never throws. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Treat the three ways this codebase spells "no value" as one. A record that
  // omits `notes` and a patch that sets it to undefined are the same record;
  // saving that is not a change anybody asked for.
  const blank = (v: unknown) => v === undefined || v === null;
  if (blank(a) && blank(b)) return true;
  if (blank(a) || blank(b)) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false; // primitives already failed ===
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // Union of keys, so a key present-but-undefined on one side and absent on
  // the other still compares equal via the blank() check above.
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/** Would `{...record, ...patch}` — the merge apply performs — change anything? */
export function mergeChangesNothing(record: unknown, patch: Record<string, unknown>): boolean {
  if (!record || typeof record !== 'object') return false;
  if (!patch || !Object.keys(patch).length) return false; // nothing to compare; caller keeps the edit
  return deepEqual({ ...(record as Record<string, unknown>), ...patch }, record);
}

export interface SkippedEdit {
  /** The dropped edit, kept so a caller could show or re-instate it. */
  edit: unknown;
  /** One line, addressed to the family: what was already correct. */
  reason: string;
}

/**
 * The host wiring. Each lookup returns null whenever it cannot answer
 * confidently, and null always means "keep the edit" — see the fail-towards-
 * showing rule above. Injected rather than imported so this file stays free of
 * Firebase and can be unit-tested under plain `tsx`.
 */
export interface NoOpLookups {
  /** The named member's REAL, unredacted record — never the AI context copy,
   *  which has identity numbers stripped (utils/aiRedact.ts) and would make
   *  every already-correct ID number look like a change. */
  resolveMember: (name: string) => Record<string, unknown> | null;
  /** Run a `member`/`clear_field` edit's field writer over a copy of the
   *  member, exactly as aiApply's MEMBER_FIELD_MAP will. Null = unknown field. */
  applyMemberField: (
    member: Record<string, unknown>,
    field: string,
    value: string,
  ) => Record<string, unknown> | null;
  /** The real record an `update_record` targets, the whitelisted patch that
   *  would be merged into it, and a phrase naming it ("South Africa passport
   *  A77410256"). Null = target or patch unresolvable. */
  resolveUpdate: (
    targetKind: string,
    id: string,
    fields?: Record<string, string>,
  ) => { record: Record<string, unknown>; patch: Record<string, unknown>; phrase: string } | null;
}

const prettyField = (f: string) => f.replace(/_/g, ' ');

/**
 * Split an edit batch into the edits worth showing and the ones that would
 * change nothing. Pure: mutates neither the array nor the edits.
 */
export function pruneUnchangedEdits<T extends { kind: string; [k: string]: any }>(
  edits: T[],
  lookups: NoOpLookups,
): { edits: T[]; skipped: SkippedEdit[] } {
  const kept: T[] = [];
  const skipped: SkippedEdit[] = [];

  for (const e of edits) {
    // --- Setting one field on a person -----------------------------------
    // clear_field rides the same path because aiApply implements it as the
    // same field writer with an empty value; clearing an already-empty field
    // is as much a no-op as re-setting an unchanged one.
    if (e.kind === 'member' || e.kind === 'clear_field') {
      const member = lookups.resolveMember(e.member);
      if (!member) { kept.push(e); continue; }
      const value = e.kind === 'member' ? String(e.value ?? '') : '';
      const after = lookups.applyMemberField(member, e.field, value);
      if (!after) { kept.push(e); continue; }   // unknown field — apply will warn
      if (deepEqual(after, member)) {
        skipped.push({
          edit: e,
          reason: e.kind === 'member'
            ? `${member.name || e.member}’s ${prettyField(e.field)} is already “${value}”`
            : `${member.name || e.member}’s ${prettyField(e.field)} is already empty`,
        });
        continue;
      }
      kept.push(e);
      continue;
    }

    // --- Re-filing a passport that is already on file ---------------------
    // aiApply matches an incoming passport on country+number and updates that
    // row in place rather than appending a duplicate, so "add this passport"
    // is a no-op whenever the matched row would come out unchanged. Mirrors
    // that merge exactly, including `expiry || p.expiryDate` — an edit that
    // omits the expiry must not read as clearing it.
    if (e.kind === 'passport') {
      const member = lookups.resolveMember(e.member);
      const list = (member?.passports as Record<string, unknown>[] | undefined) || [];
      const existing = list.find(p =>
        String(p.country || '').trim().toLowerCase() === String(e.country || '').trim().toLowerCase()
        && String(p.number || '').trim() === String(e.number || '').trim());
      if (!existing) { kept.push(e); continue; }
      const merged = { ...existing, country: e.country, number: e.number, expiryDate: e.expiry || existing.expiryDate };
      if (deepEqual(merged, existing)) {
        skipped.push({ edit: e, reason: `${member?.name || e.member} already has ${e.country} passport ${e.number} on file` });
        continue;
      }
      kept.push(e);
      continue;
    }

    // --- Filing/re-filing a CV ---------------------------------------------
    // aiApply's cv branch (utils/aiApply.ts) doesn't overwrite a member's CV,
    // it MERGES: roles dedupe on title+employer, education on institution+
    // qualification, qualifications on name+issuer — all case-insensitively —
    // and skills/languages dedupe additively, also case-insensitively.
    // Re-scanning a CV already on file is the common case here, and the model
    // re-states every row it read, most of which are already saved. So this
    // isn't a plain keep-or-drop: it STRIPS the already-present rows out of
    // the edit and keeps only what's new, then drops the whole edit only if
    // NOTHING survives. Mirror the merge exactly — get it wrong in one
    // direction and the Apply card overstates what will happen; get it wrong
    // in the other and a real new row goes missing from the count.
    if (e.kind === 'cv') {
      const member = lookups.resolveMember(e.member);
      if (!member) { kept.push(e); continue; }
      const existingCv = (member.cv as Record<string, unknown> | undefined) || {};
      const norm = (s: unknown) => String(s || '').trim().toLowerCase();

      const existingRoles = (existingCv.roles as Record<string, unknown>[] | undefined) || [];
      const newRoles = ((e.roles as Record<string, unknown>[] | undefined) || [])
        .filter(r => r && r.title && String(r.title).trim())
        .filter(r => !existingRoles.some(x => norm(x.title) === norm(r.title) && norm(x.employer) === norm(r.employer)));

      const existingEdu = (existingCv.education as Record<string, unknown>[] | undefined) || [];
      const newEdu = ((e.education as Record<string, unknown>[] | undefined) || [])
        .filter(x => x && x.institution && String(x.institution).trim())
        .filter(x => !existingEdu.some(y => norm(y.institution) === norm(x.institution) && norm(y.qualification) === norm(x.qualification)));

      const existingQuals = (existingCv.qualifications as Record<string, unknown>[] | undefined) || [];
      const newQuals = ((e.qualifications as Record<string, unknown>[] | undefined) || [])
        .filter(q => q && q.name && String(q.name).trim())
        .filter(q => !existingQuals.some(y => norm(y.name) === norm(q.name) && norm(y.issuer) === norm(q.issuer)));

      // Mirrors mergeTags: a tag already on file, OR repeated within this
      // same incoming list, contributes nothing new.
      const newTags = (existing: string[], incoming?: string[]) => {
        const out: string[] = [];
        for (const t of (incoming || [])) {
          const v = (t || '').trim();
          if (!v) continue;
          if (existing.some(x => norm(x) === norm(v))) continue;
          if (out.some(x => norm(x) === norm(v))) continue;
          out.push(v);
        }
        return out;
      };
      const newSkills = newTags((existingCv.skills as string[] | undefined) || [], e.skills as string[] | undefined);
      const newLanguages = newTags((existingCv.languages as string[] | undefined) || [], e.languages as string[] | undefined);

      // summary is a plain overwrite in aiApply, not an additive merge — a
      // real change only when the trimmed incoming text differs from what's
      // already saved. An absent/blank summary never overwrites the saved one.
      const trimmedSummary = (e.summary as string | undefined)?.trim();
      const summaryChanged = !!trimmedSummary && trimmedSummary !== ((existingCv.summary as string | undefined) || '');

      if (!newRoles.length && !newEdu.length && !newQuals.length && !newSkills.length && !newLanguages.length && !summaryChanged) {
        skipped.push({ edit: e, reason: `${(member.name as string) || e.member}’s CV already has everything in this update` });
        continue;
      }
      // Push the STRIPPED edit, not the original — so a partly-duplicate scan
      // shows only the rows that will actually land (also fixes the Apply-card
      // count, which reads e.roles.length etc. straight off this object).
      kept.push({ ...e, roles: newRoles, education: newEdu, qualifications: newQuals, skills: newSkills, languages: newLanguages } as T);
      continue;
    }

    // --- Rewriting an existing record -------------------------------------
    // The costly one: update_record renders as a destructive row, so a no-op
    // here is the noise that makes a real deletion harder to notice.
    if (e.kind === 'update_record') {
      const found = lookups.resolveUpdate(e.targetKind, e.id, e.fields);
      if (!found) { kept.push(e); continue; }
      if (mergeChangesNothing(found.record, found.patch)) {
        skipped.push({ edit: e, reason: `${found.phrase} is already saved exactly like that` });
        continue;
      }
      kept.push(e);
      continue;
    }

    kept.push(e);
  }

  return { edits: kept, skipped };
}
