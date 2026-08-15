// AI destructive edits — DELETE and UPDATE existing records by voice/chat.
//
// WHY THIS FILE EXISTS (and why it is paranoid): the rest of the AI pipeline
// only ever CREATES/APPENDS. Removing or changing a record the family already
// saved (a passport, a medical schedule, a scanned ID) is fundamentally more
// dangerous — a mis-heard command must never quietly destroy the wrong thing.
// Two safeguards live here and MUST stay:
//   1. CONFIRM-BEFORE-DESTROY. Nothing in here runs until the user taps Apply
//      on the same edit card every other edit flows through. annotateDestructive
//      Edits() stamps a plain-language, display-only `label` onto each edit
//      ("Delete document 'Rory UK Passport (old)' from Rory's profile") so the
//      user reads WHAT and WHOSE record will change BEFORE applying — a
//      mis-heard target is caught by eye.
//   2. RE-RESOLVE AT APPLY TIME. applyDestructiveEdits() looks the id up again
//      in freshly-loaded data at the moment of Apply. It NEVER trusts the label
//      or a stale id from chat history: if the id is gone (already deleted on
//      another device, or the model hallucinated it), that one edit is DROPPED
//      with a note — we never fall back to "something similar". This is what
//      the system prompt promises the model, enforced in code.
//
// Real substance lives here on purpose; AIChatbot/aiApply/Dashboard/server only
// get tiny append-only wiring (this is a heavily shared-file feature).

import {
  loadFamilyInfo, saveFamilyInfo,
  loadHousehold, saveHousehold,
  loadFinances, saveFinances,
  loadTimeline, saveTimeline,
  loadCalendarEvents, saveCalendarEvents,
  loadSlips, saveSlips,
  loadDocuments, saveFamilyMembers,
  deleteDocumentEverywhere,
  loadAssets, saveAsset, deleteAsset,
} from './db';
import type { FamilyMember, ContactEntry } from '../types';
import type { AiEdit } from '../components/AIChatbot';

// --- Record targeting registries ------------------------------------------

// Member-owned sub-record arrays. get/set are the ONLY places that know where a
// given kind lives on a FamilyMember, so both find (for labels) and mutate (for
// apply) go through the same accessor and can't drift.
const MEMBER_ARRAY: Record<string, { get: (m: any) => any[]; set: (m: any, arr: any[]) => any }> = {
  passport: { get: m => m.passports || [], set: (m, arr) => ({ ...m, passports: arr }) },
  transit_pass: {
    get: m => (m.travel?.transitPasses) || [],
    set: (m, arr) => ({ ...m, travel: { ...(m.travel || {}), transitPasses: arr } }),
  },
  care_schedule: { get: m => m.careSchedule || [], set: (m, arr) => ({ ...m, careSchedule: arr }) },
  saying: { get: m => m.sayings || [], set: (m, arr) => ({ ...m, sayings: arr }) },
  favorite_quote: { get: m => m.favoriteQuotes || [], set: (m, arr) => ({ ...m, favoriteQuotes: arr }) },
  // The three sections the assistant could not reach until v145-v148. Adding
  // them here is what makes "delete that expired visa" work by voice — filing
  // something the user then cannot remove the same way is a half-built feature.
  vaccination: {
    get: m => (m.medical?.vaccinations) || [],
    set: (m, arr) => ({ ...m, medical: { ...(m.medical || {}), vaccinations: arr } }),
  },
  visa: {
    get: m => (m.travel?.visas) || [],
    set: (m, arr) => ({ ...m, travel: { ...(m.travel || {}), visas: arr } }),
  },
  referral: { get: m => m.referrals || [], set: (m, arr) => ({ ...m, referrals: arr }) },
};

// Per-kind whitelist of update fields: incoming field name -> the real record
// key. Anything not listed is IGNORED (so update_record can never write an
// arbitrary/unknown property). Field names mirror each kind's create/list_add
// edit so the model reuses vocabulary it already knows.
const UPDATE_FIELDS: Record<string, Record<string, string>> = {
  passport: { country: 'country', number: 'number', expiry: 'expiryDate', expiryDate: 'expiryDate', issueDate: 'issueDate', notes: 'notes' },
  transit_pass: { name: 'name', operator: 'operator', cardNumber: 'cardNumber', zone: 'zone', validFrom: 'validFrom', validUntil: 'validUntil', notes: 'notes' },
  care_schedule: { careKind: 'kind', kind: 'kind', provider: 'provider', lastVisit: 'lastVisit', intervalMonths: 'intervalMonths', nextDue: 'nextDue', notes: 'notes' },
  saying: { text: 'text', said: 'said', context: 'context' },
  favorite_quote: { text: 'text', source: 'source', note: 'note' },
  vaccination: { name: 'name', date: 'date', notes: 'notes' },
  visa: { country: 'country', number: 'number', expiryDate: 'expiryDate', expiry: 'expiryDate', permitType: 'permitType', issuingAuthority: 'issuingAuthority', sponsor: 'sponsor', conditions: 'conditions', status: 'status', notes: 'notes' },
  // A referral's STATUS is the field that actually changes over time — open ->
  // booked -> done — so "mark that X-ray as done" is the whole point of this row.
  // The referralKind/referralDate/referralReason/referralProvider aliases exist
  // because that is the EXACT vocabulary the system prompt teaches the model to
  // use when FILING a referral (see server.js's document-edit instructions) —
  // an update_record for the same record could easily reuse it, and without the
  // alias buildPatch's allowlist would silently drop it (found 2026-08-15,
  // chat-function audit).
  referral: { kind: 'kind', referralKind: 'kind', date: 'date', referralDate: 'date', reason: 'reason', referralReason: 'reason', status: 'status', appointmentDate: 'appointmentDate', providerName: 'providerName', referralProvider: 'providerName', notes: 'notes' },
  contact: { name: 'name', relation: 'relation', phone: 'phone', email: 'email', birthdate: 'birthdate', note: 'note' },
  provider: { name: 'name', type: 'type', specialty: 'specialty', practiceName: 'practiceName', phone: 'phone', afterHoursPhone: 'afterHoursPhone', email: 'email', address: 'address', forMember: 'forMember', note: 'note' },
  number: { label: 'label', value: 'value', note: 'note' },
  // serviceIntervalMonths is a real Vehicle field (types.ts) the create prompt
  // (server.js list_add) already teaches the model to set — it was missing
  // here, so "change the service interval to 12 months" on an existing vehicle
  // silently changed nothing (found 2026-08-15, chat-function audit).
  vehicle: { name: 'name', make: 'make', model: 'model', year: 'year', registration: 'registration', vin: 'vin', fuelType: 'fuelType', assignedMember: 'assignedMember', insurer: 'insurer', insuranceNumber: 'insuranceNumber', insuranceRenewal: 'insuranceRenewal', inspectionExpiry: 'inspectionExpiry', vignetteExpiry: 'vignetteExpiry', lastService: 'lastService', serviceIntervalMonths: 'serviceIntervalMonths', parkingPermit: 'parkingPermit', parkingPermitExpiry: 'parkingPermitExpiry', notes: 'notes' },
  pet: { name: 'name', species: 'species', vet: 'vet', vaccinations: 'vaccinations', microchip: 'microchip', notes: 'notes' },
  utility: { type: 'type', provider: 'provider', accountNumber: 'accountNumber', notes: 'notes' },
  bank: { bankName: 'bankName', accountHolder: 'accountHolder', iban: 'iban', bic: 'bic', notes: 'notes' },
  insurance: { provider: 'provider', type: 'type', policyNumber: 'policyNumber', renewalDate: 'renewalDate', notes: 'notes' },
  benefit: { name: 'name', reference: 'reference', notes: 'notes' },
  timeline: { date: 'date', title: 'title', type: 'type', note: 'note' },
  calendar_event: { title: 'title', date: 'date', time: 'time', category: 'category' },
  slip: { shop: 'shop', item: 'item', purchaseDate: 'purchaseDate', amount: 'amount', currency: 'currency', assignedTo: 'assignedTo', returnByDate: 'returnByDate', warrantyUntil: 'warrantyUntil', notes: 'notes' },
  asset: { name: 'name', category: 'category', assignedMember: 'assignedMember', make: 'make', model: 'model', serialNumber: 'serialNumber', purchaseDate: 'purchaseDate', purchasePrice: 'purchasePrice', notes: 'notes' },
};

// The numeric fields a record here carries — everything else in UPDATE_FIELDS
// is a string, so this is a short exception list rather than a type lookup.
const NUMERIC_FIELDS = new Set(['intervalMonths', 'serviceIntervalMonths']);

// Build the (whitelisted, key-renamed) patch object for an update_record edit.
function buildPatch(targetKind: string, fields?: Record<string, string>): Record<string, any> {
  const allow = UPDATE_FIELDS[targetKind] || {};
  const patch: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const key = allow[k];
    if (!key) continue;
    patch[key] = NUMERIC_FIELDS.has(key) ? Number(v) : v;
  }
  return patch;
}

const truncate = (s?: string, n = 40) => {
  const t = (s || '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const prettyKind = (tk: string) => tk.replace(/_/g, ' ');

// A short human phrase for a record — the heart of the eye-catch label. Works
// off whatever fields the record has (context-slim or fully-loaded both carry
// the ones used here).
function recordPhrase(targetKind: string, r: any): string {
  switch (targetKind) {
    case 'passport': return `${r.country || ''} passport${r.number ? ' ' + r.number : ''}`.trim() || 'passport';
    case 'contact': return `contact ${r.name || ''}`.trim();
    case 'provider': return `${(r.type || 'provider')}: ${r.name || ''}`.trim();
    case 'number': return `number “${r.label || ''}”`;
    case 'vehicle': return `vehicle ${r.name || [r.make, r.model].filter(Boolean).join(' ') || r.registration || ''}`.trim();
    case 'pet': return `pet ${r.name || ''}`.trim();
    case 'utility': return `${r.type || 'utility'}${r.provider ? ' (' + r.provider + ')' : ''}`;
    case 'bank': return `bank account ${r.bankName || ''}${r.iban ? ' · ' + r.iban : ''}`.trim();
    case 'insurance': return `${r.type || 'insurance'} policy${r.provider ? ' (' + r.provider + ')' : ''}`;
    case 'benefit': return `benefit ${r.name || ''}`.trim();
    case 'timeline': return `timeline entry “${r.title || ''}”${r.date ? ' (' + r.date + ')' : ''}`;
    case 'calendar_event': return `calendar event “${r.title || ''}”${r.date ? ' on ' + r.date : ''}`;
    case 'transit_pass': return `travel pass “${r.name || ''}”`;
    case 'care_schedule': return `${r.kind || 'care'} schedule`;
    case 'saying': return `saying “${truncate(r.text)}”`;
    case 'favorite_quote': return `favourite quote “${truncate(r.text)}”`;
    case 'document': return `document “${r.name || ''}”`;
    case 'slip': return `slip ${r.item || ''}${r.shop ? ' from ' + r.shop : ''}`.trim();
    case 'asset': return `${r.name || 'item'}${(r.make || r.model) ? ' (' + [r.make, r.model].filter(Boolean).join(' ') + ')' : ''}`.trim();
    // These three were the v145-v148 additions to MEMBER_ARRAY above and never
    // got a matching case here — they fell through to the generic prettyKind
    // ("visa", "vaccination", "referral"), so a confirm-before-destroy label
    // couldn't distinguish WHICH one was about to be deleted or changed, the
    // one thing this label exists to do (found 2026-08-15, chat-function audit).
    case 'visa': return `${r.country || ''} visa${r.number ? ' ' + r.number : ''}`.trim() || 'visa';
    case 'vaccination': return `vaccination${r.name ? ` “${r.name}”` : ''}`.trim();
    case 'referral': return `${r.kind || 'referral'}${r.reason ? ' — ' + r.reason : ''}${r.date ? ' (' + r.date + ')' : ''}`.trim();
    default: return prettyKind(targetKind);
  }
}

// --- Public API ------------------------------------------------------------

export const hasDestructiveEdits = (edits: AiEdit[]) =>
  edits.some(e => e.kind === 'delete_record' || e.kind === 'update_record');

type Found = { record: any; ownerName?: string } | null;

// Locate a record by id inside the already-built chat CONTEXT (the object
// buildContext() sends). Used only to write the display label; apply re-does
// this against fresh data and does not trust anything found here.
function findInContext(context: any, targetKind: string, id: string): Found {
  const members: any[] = context?.members || [];
  if (targetKind in MEMBER_ARRAY) {
    for (const m of members) {
      const rec = MEMBER_ARRAY[targetKind].get(m).find((r: any) => r.id === id);
      if (rec) return { record: rec, ownerName: m.name };
    }
    return null;
  }
  if (targetKind === 'document') {
    for (const m of members) {
      const rec = (m.documents || []).find((d: any) => d.id === id);
      if (rec) return { record: rec, ownerName: m.name };
    }
    const vrec = (context?.documents || []).find((d: any) => d.id === id);
    return vrec ? { record: vrec } : null;
  }
  const TOP: Record<string, any[] | undefined> = {
    contact: context?.info?.contacts,
    provider: context?.info?.providers,
    number: context?.info?.numbers,
    vehicle: context?.household?.vehicles,
    pet: context?.household?.pets,
    utility: context?.household?.utilities,
    bank: context?.finances?.banks,
    insurance: context?.finances?.insurance,
    benefit: context?.finances?.benefits,
    timeline: context?.timeline?.entries,
    calendar_event: context?.calendar,
    slip: context?.slips,
    asset: context?.assets,
  };
  const rec = (TOP[targetKind] || []).find((r: any) => r.id === id);
  return rec ? { record: rec } : null;
}

function buildLabel(e: any, found: Found): string {
  const tk: string = e.targetKind;
  if (!found) {
    // The id isn't in the current data — say so plainly on the card so the user
    // isn't promised a deletion that won't (and shouldn't) happen.
    return e.kind === 'delete_record'
      ? `Delete a ${prettyKind(tk)} — but I can’t find that record in your current data (it may already be gone)`
      : `Update a ${prettyKind(tk)} — but I can’t find that record in your current data`;
  }
  const phrase = recordPhrase(tk, found.record);
  if (e.kind === 'delete_record') {
    const where = found.ownerName ? ` from ${found.ownerName}’s profile` : (tk === 'document' ? ' from the shared vault' : '');
    return `Delete ${phrase}${where}`;
  }
  const patch = buildPatch(tk, e.fields);
  const changes = Object.entries(patch)
    .map(([k, v]) => `${k} → “${v === '' || v === undefined ? '(blank)' : v}”`)
    .join(', ');
  const onWhose = found.ownerName ? ` on ${found.ownerName}’s profile` : '';
  return `Update ${phrase}${onWhose}${changes ? ` — set ${changes}` : ''}`;
}

/**
 * Stamp a display-only `label` onto every destructive edit, describing exactly
 * WHAT and WHOSE record it will remove/change. Purely cosmetic and safe to
 * persist in chat history — apply re-resolves the id and ignores this label.
 * Mutates the edits in place (they were just created from the model response)
 * and returns the same array for convenience.
 */
export function annotateDestructiveEdits(edits: AiEdit[], context: any): AiEdit[] {
  for (const e of edits) {
    if (e.kind === 'delete_record' || e.kind === 'update_record') {
      (e as any).label = buildLabel(e, findInContext(context, e.targetKind, e.id));
    }
  }
  return edits;
}

export interface DestructiveResult {
  /** Updated members array when a member record/document was removed/changed — caller must push to state. */
  members?: FamilyMember[];
  /** Updated contacts when a contact was removed/changed — for the top-level `contacts` state NeedsAttention reads. */
  contacts?: ContactEntry[];
  failures: string[];  // stores whose cloud save failed (surfaced as an error)
  notes: string[];     // ids that couldn't be resolved (skipped, never substituted) + doc-delete notes
}

/**
 * Apply delete_record / update_record edits. Runs LAST in handleApplyAiEdits so
 * every create/update in the same batch is already saved and a fresh read is
 * authoritative. RE-RESOLVES each id against freshly-loaded data; a target that
 * no longer exists is dropped with a note (never replaced with something else).
 *
 * @param edits       the full edit list (non-destructive kinds are ignored here)
 * @param ctxMembers  the freshest in-session members (membersRef.current) — the
 *                    member-edit block already saved these, so they are current;
 *                    member mutations here start from and are threaded through it.
 */
export async function applyDestructiveEdits(edits: AiEdit[], ctxMembers: FamilyMember[]): Promise<DestructiveResult> {
  const dels = edits.filter(e => e.kind === 'delete_record') as any[];
  const upds = edits.filter(e => e.kind === 'update_record') as any[];
  const failures: string[] = [];
  const notes: string[] = [];

  const skipNote = (e: any) =>
    notes.push(
      `Couldn't find the ${prettyKind(e.targetKind)} to ${e.kind === 'delete_record' ? 'remove' : 'update'} in your current data — it may already be gone. Skipped it and changed nothing else.`,
    );

  let workingMembers: FamilyMember[] = ctxMembers;
  let membersDirty = false;

  // 1) Member sub-records (passport / transit pass / care schedule / saying /
  //    favourite quote). Threaded through workingMembers so several edits on the
  //    same person compose.
  for (const e of [...dels, ...upds]) {
    if (!(e.targetKind in MEMBER_ARRAY)) continue;
    const cfg = MEMBER_ARRAY[e.targetKind];
    // `found` (the record exists) and `changed` (something in it actually
    // moved) are tracked separately — every other store below (2 onward)
    // already does this. Collapsing them into one `hit` flag was the bug:
    // an update_record whose fields were all unrecognized (buildPatch
    // returns {}) still set `hit` as soon as the record was FOUND, so it was
    // marked dirty and silently skipped no skipNote at all — the card came
    // back "Applied ✓" having changed nothing, with no clue why (found
    // 2026-08-15, chat-function audit; same root cause behind the
    // recordPhrase gap above).
    let found = false;
    let changed = false;
    workingMembers = workingMembers.map((m: any) => {
      if (found) return m;
      const arr = cfg.get(m);
      const idx = arr.findIndex((r: any) => r.id === e.id);
      if (idx < 0) return m;
      found = true;
      if (e.kind === 'delete_record') { changed = true; return cfg.set(m, arr.filter((r: any) => r.id !== e.id)); }
      const patch = buildPatch(e.targetKind, e.fields);
      if (!Object.keys(patch).length) return m; // nothing valid to change
      changed = true;
      return cfg.set(m, arr.map((r: any) => (r.id === e.id ? { ...r, ...patch } : r)));
    });
    if (changed) membersDirty = true; else skipNote(e);
  }

  // 2) Documents — delete only, routed through deleteDocumentEverywhere so the
  //    vault row, every member copy, AND the Storage object are all cleaned
  //    (the app's delete-means-delete helper). The id may be a vault id or a
  //    member-doc id ("doc-"+vaultId) — resolve either.
  const docDeletes = dels.filter(e => e.targetKind === 'document');
  if (docDeletes.length) {
    let vault: any[] = [];
    try { vault = await loadDocuments(); } catch { /* helper re-reads + notes it */ }
    for (const e of docDeletes) {
      const vaultDoc = vault.find((v: any) => v.id === e.id);
      let opts: any = null;
      if (vaultDoc) {
        opts = { vaultDoc, members: workingMembers };
      } else {
        for (const m of workingMembers) {
          const md = (m.documents || []).find((d: any) => d.id === e.id);
          if (md) { opts = { memberDoc: md, memberId: m.id, members: workingMembers }; break; }
        }
      }
      if (!opts) { skipNote(e); continue; }
      const res = await deleteDocumentEverywhere(opts);
      workingMembers = res.members;
      if (res.membersChanged) membersDirty = true;
      if (res.vaultSaveFailed) failures.push('shared document vault');
      for (const n of res.notes) notes.push(n);
    }
  }
  // update on a document isn't supported (renaming a scan is a niche edit best
  // done in the document view) — drop it rather than silently ignore.
  for (const e of upds) if (e.targetKind === 'document') {
    notes.push("Renaming a document from chat isn't supported yet — open the document to rename it. Skipped that one.");
  }

  if (membersDirty) {
    const ok = await saveFamilyMembers(workingMembers);
    if (!ok) failures.push('family records');
  }

  // 3) info store (contacts / providers / numbers) — one load + one save.
  let updatedContacts: ContactEntry[] | undefined;
  {
    const relevant = [...dels, ...upds].filter(e => ['contact', 'provider', 'number'].includes(e.targetKind));
    if (relevant.length) {
      const info = (await loadFamilyInfo()) || { numbers: [], contacts: [], providers: [] };
      const arrKey: Record<string, 'contacts' | 'providers' | 'numbers'> = { contact: 'contacts', provider: 'providers', number: 'numbers' };
      let dirty = false;
      for (const e of relevant) {
        const key = arrKey[e.targetKind];
        const arr = (info as any)[key] || [];
        if (!arr.some((r: any) => r.id === e.id)) { skipNote(e); continue; }
        if (e.kind === 'delete_record') { (info as any)[key] = arr.filter((r: any) => r.id !== e.id); dirty = true; }
        else {
          const patch = buildPatch(e.targetKind, e.fields);
          if (!Object.keys(patch).length) { skipNote(e); continue; }
          (info as any)[key] = arr.map((r: any) => (r.id === e.id ? { ...r, ...patch } : r));
          dirty = true;
        }
      }
      if (dirty) {
        const ok = await saveFamilyInfo(info);
        if (!ok) failures.push('contacts & numbers');
        updatedContacts = (info as any).contacts || [];
      }
    }
  }

  // 4) household store (vehicles / pets / utilities).
  {
    const relevant = [...dels, ...upds].filter(e => ['vehicle', 'pet', 'utility'].includes(e.targetKind));
    if (relevant.length) {
      const h: any = (await loadHousehold()) || {};
      const arrKey: Record<string, 'vehicles' | 'pets' | 'utilities'> = { vehicle: 'vehicles', pet: 'pets', utility: 'utilities' };
      let dirty = false;
      for (const e of relevant) {
        const key = arrKey[e.targetKind];
        const arr = h[key] || [];
        if (!arr.some((r: any) => r.id === e.id)) { skipNote(e); continue; }
        if (e.kind === 'delete_record') { h[key] = arr.filter((r: any) => r.id !== e.id); dirty = true; }
        else {
          const patch = buildPatch(e.targetKind, e.fields);
          if (!Object.keys(patch).length) { skipNote(e); continue; }
          h[key] = arr.map((r: any) => (r.id === e.id ? { ...r, ...patch } : r));
          dirty = true;
        }
      }
      if (dirty) { const ok = await saveHousehold(h); if (!ok) failures.push('household'); }
    }
  }

  // 5) finances store (banks / insurance / benefits).
  {
    const relevant = [...dels, ...upds].filter(e => ['bank', 'insurance', 'benefit'].includes(e.targetKind));
    if (relevant.length) {
      const f: any = (await loadFinances()) || {};
      const arrKey: Record<string, 'banks' | 'insurance' | 'benefits'> = { bank: 'banks', insurance: 'insurance', benefit: 'benefits' };
      let dirty = false;
      for (const e of relevant) {
        const key = arrKey[e.targetKind];
        const arr = f[key] || [];
        if (!arr.some((r: any) => r.id === e.id)) { skipNote(e); continue; }
        if (e.kind === 'delete_record') { f[key] = arr.filter((r: any) => r.id !== e.id); dirty = true; }
        else {
          const patch = buildPatch(e.targetKind, e.fields);
          if (!Object.keys(patch).length) { skipNote(e); continue; }
          f[key] = arr.map((r: any) => (r.id === e.id ? { ...r, ...patch } : r));
          dirty = true;
        }
      }
      if (dirty) { const ok = await saveFinances(f); if (!ok) failures.push('finances'); }
    }
  }

  // 6) timeline store.
  {
    const relevant = [...dels, ...upds].filter(e => e.targetKind === 'timeline');
    if (relevant.length) {
      const t: any = (await loadTimeline()) || { entries: [] };
      let arr = t.entries || [];
      let dirty = false;
      for (const e of relevant) {
        if (!arr.some((r: any) => r.id === e.id)) { skipNote(e); continue; }
        if (e.kind === 'delete_record') { arr = arr.filter((r: any) => r.id !== e.id); dirty = true; }
        else {
          const patch = buildPatch('timeline', e.fields);
          if (!Object.keys(patch).length) { skipNote(e); continue; }
          arr = arr.map((r: any) => (r.id === e.id ? { ...r, ...patch } : r));
          dirty = true;
        }
      }
      if (dirty) { const ok = await saveTimeline({ entries: arr }); if (!ok) failures.push('timeline'); }
    }
  }

  // 7) calendar events (bare array).
  {
    const relevant = [...dels, ...upds].filter(e => e.targetKind === 'calendar_event');
    if (relevant.length) {
      let arr = (await loadCalendarEvents()) || [];
      let dirty = false;
      for (const e of relevant) {
        if (!arr.some((r: any) => r.id === e.id)) { skipNote(e); continue; }
        if (e.kind === 'delete_record') { arr = arr.filter((r: any) => r.id !== e.id); dirty = true; }
        else {
          const patch = buildPatch('calendar_event', e.fields);
          if (!Object.keys(patch).length) { skipNote(e); continue; }
          arr = arr.map((r: any) => (r.id === e.id ? { ...r, ...patch } : r));
          dirty = true;
        }
      }
      if (dirty) { const ok = await saveCalendarEvents(arr); if (!ok) failures.push('calendar'); }
    }
  }

  // 8) slips (bare array).
  {
    const relevant = [...dels, ...upds].filter(e => e.targetKind === 'slip');
    if (relevant.length) {
      let arr = await loadSlips();
      let dirty = false;
      for (const e of relevant) {
        if (!arr.some((r: any) => r.id === e.id)) { skipNote(e); continue; }
        if (e.kind === 'delete_record') { arr = arr.filter((r: any) => r.id !== e.id); dirty = true; }
        else {
          const patch = buildPatch('slip', e.fields);
          if (!Object.keys(patch).length) { skipNote(e); continue; }
          arr = arr.map((r: any) => (r.id === e.id ? { ...r, ...patch } : r));
          dirty = true;
        }
      }
      if (dirty) { const ok = await saveSlips(arr); if (!ok) failures.push('slips'); }
    }
  }

  // 9) assets — ONE Firestore doc per item (unlike the bare-array stores
  //    above), so update patches-and-saves that single doc directly and
  //    delete calls deleteAsset. This is what makes "that's the same pump,
  //    just correct the serial number" possible instead of the assistant's
  //    only prior option (file a second, near-duplicate item).
  {
    const relevant = [...dels, ...upds].filter(e => e.targetKind === 'asset');
    if (relevant.length) {
      const arr = await loadAssets();
      for (const e of relevant) {
        const rec = arr.find((r: any) => r.id === e.id);
        if (!rec) { skipNote(e); continue; }
        if (e.kind === 'delete_record') {
          try { await deleteAsset(e.id); } catch { failures.push('assets'); }
        } else {
          const patch = buildPatch('asset', e.fields);
          if (!Object.keys(patch).length) { skipNote(e); continue; }
          const ok = await saveAsset({ ...rec, ...patch });
          if (!ok) failures.push('assets');
        }
      }
    }
  }

  return {
    members: membersDirty ? workingMembers : undefined,
    contacts: updatedContacts,
    failures,
    notes,
  };
}
