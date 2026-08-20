import { FamilyMember, CalendarEvent, FamilyInfo, HouseholdInfo, FinancesInfo, FamilyTimeline, VaultDocument, HubSettings, ShoppingItem, FamilyRole, FamilyMemberRole, UserProfile, FamilyInfoDoc, AssetItem, PasswordEntry, FamilyWordsDoc, Recipe, RecipeBookDoc, TravelTimelineDoc, InMemoryDoc, WillsEstateDoc, SlipItem, SlipsDoc, FamilyDocument, BusinessMilestonesDoc, AiUsage, AnniversaryRecord, AnniversariesDoc, ExtendedBirthday, ExtendedBirthdaysDoc, WillsAccessDoc } from '../types';
import { db, auth, storage } from '../lib/firebase';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch, runTransaction, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { mergeShared, mergeIdList, deepEqual } from './mergeShared';
import { markDirty, clearDirty, isDirty } from './pendingSync';
import {
  protectIdentity, revealIdentity, protectPassports, revealPassports,
  protectVisas, revealVisas, protectIdentifiers, revealIdentifiers,
  protectFinancialAccounts, revealFinancialAccounts,
  protectHousehold, revealHousehold, protectFinances, revealFinances,
} from './vaultFields';

// Merge-base keys for the two id-index documents (metadata/members,
// metadata/events). Namespaced away from the reference-doc keys so they can
// never collide with a document called 'members'.
const MEMBER_IDS_KEY = 'metadata:members';
const EVENT_IDS_KEY = 'metadata:events';

// Per-member merge-base key — same lastSeen/noteSeen mechanism the reference
// docs use below (getSeen/noteSeen), just namespaced under 'member:' so it
// can never collide with MEMBER_IDS_KEY or a reference doc called 'members'.
const memberSeenKey = (id: string) => `member:${id}`;

// One shared vault for the whole household. Every authorised family account
// (see firestore.rules) reads and writes this same path, so Mama, Papa and the
// kids all see the same family — instead of each Google account getting its own
// private island.
export let FAMILY_ID = 'household';

/** Called by FamilyProvider once it resolves the user's familyId. */
export function setFamilyId(id: string): void {
  if (id !== FAMILY_ID) resetSharedDocBaselines();
  FAMILY_ID = id;
}

// SPACE-SCOPED localStorage keys. THESE MUST BE FUNCTIONS, not constants — a
// fixed key like 'family_members' is shared by every space a device has ever
// viewed. Business Hub means the SAME browser now moves between multiple
// spaces (a family + one or more businesses) without signing out, and every
// loader below has an "if the cloud looks empty, migrate this device's local
// cache up to Firestore" fallback (a genuinely useful one-time migration for a
// brand-new device that predates cloud sync). With an UNSCOPED key, that
// fallback fires for any genuinely-empty NEW space too — "empty cloud" no
// longer means "never synced", it can just mean "you just created this
// space" — and silently copies whatever the LAST space cached into the new
// one's Firestore. That's a real bug that happened live: creating a business
// space copied the family's members/calendar/info into it. Keep the
// 'family_' prefix (not just the suffix) so logout()'s existing cleanup in
// lib/firebase.ts (which sweeps every key starting with 'family_') still
// catches these without needing its own change.
//
// '_v2_': bumped the moment this scoping shipped. A browser that already
// cached wrongly-copied data under the OLD unscoped key (or even under a
// correctly-scoped-but-still-wrong key, from before this fix existed) must
// never have that data read again — the version bump makes every such key
// simply absent for every reader, a clean slate, without needing to reach
// into anyone's browser. Also caught live: even a correctly-scoped cache can
// resurrect data an admin deliberately deleted server-side, because "cloud
// empty" isn't only true for "never synced" — it's also true right after a
// legitimate cleanup. The MIGRATED_KEY guard below closes that: once a
// migration has been attempted for a space (successful or not), it never
// fires again for that space, so a later server-side delete can't be
// silently undone by a stale local cache.
const membersKey = () => `family_members_v2_${FAMILY_ID}`;
const calendarKey = () => `family_calendar_v2_${FAMILY_ID}`;
// (Important Info's key is `family_info_v2_${FAMILY_ID}` too — it is now built
// by the shared reference-doc store from the localKey 'family_info_v2', see
// SHARED_DOCS below, so the byte-identical key keeps every existing cache valid.)
const migratedFlagKey = (kind: string) => `family_migrated_v2_${kind}_${FAMILY_ID}`;
const hintSeenKey = (hint: string) => `family_seen_hint_${hint}_v1_${FAMILY_ID}`;

// One-time UI discovery hints (e.g. "tap the dice for an AI version") — per
// device, per space, so a fresh device/space sees them again. Deliberately
// plain localStorage (not synced data), same convention as the keys above.
export const isHintSeen = (hint: string): boolean => {
  try { return localStorage.getItem(hintSeenKey(hint)) === '1'; } catch { return false; }
};
export const markHintSeen = (hint: string): void => {
  try { localStorage.setItem(hintSeenKey(hint), '1'); } catch { /* ignore */ }
};

// Returns true when the data reached Firestore, false when it only landed in
// localStorage — callers surface that so silent sync failures are impossible.
//
// Each member document is a real three-way merge (mergeShared) against the
// server's current copy, not a blind {merge:true} overwrite. It used to not
// be: this comment used to claim "one document each, written with
// {merge:true}, so two people editing two different members never collide" —
// that was false, because EVERY save writes EVERY member's document, not
// just the one the user actually touched. A device that loaded once this
// morning and is still open this afternoon would, on its next unrelated save
// (editing anyone, adding a document, an AI chat edit, an Undo), silently
// rewrite every OTHER member's document from its now-stale in-memory copy —
// reverting scalar fields another device had since changed, and replacing
// array fields (documents, passports, visas, vaccinations, referrals…)
// wholesale, because {merge:true} does not deep-merge arrays. Confirmed live
// in the 2026-08-15 chat-function audit: a parent scanning a child's second
// passport on one device could have it silently erased by an unrelated save
// from the other parent's stale device minutes later.
//
// The fix mirrors saveReferenceDoc below exactly: read each member's CURRENT
// server copy inside the transaction, diff the writer's value against the
// base it was actually built from (mergeShared's base/local/server
// three-way), and write only the merged result — so a member this device
// never touched comes back out unchanged (server wins), and a member both
// devices touched merges field-by-field instead of one write clobbering the
// other. As with vaultFields.ts's CALLER RESPONSIBILITY note: reveal happens
// BEFORE the diff, protect AFTER — or the diff sees ciphertext and treats
// every untouched field as a fresh edit. The INDEX merge below (mergeIdList)
// is unchanged — it was already correct, this only closes the per-document gap.

// Every place a member document crosses the Firestore boundary needs the
// same encrypt/decrypt fields touched — identity numbers, passport numbers,
// visa/permit numbers (nested under travel.visas, not a top-level array like
// passports — easy to miss, which is exactly how it shipped unencrypted until
// the 2026-08-15 chat-function audit), and — found the same day, same root
// cause one field group deeper — identifiers (SSN/driver's licence/tax ID/
// insurance number) and financialAccounts (bank account/routing number) from
// SecureSecrets.tsx, which had NO encryption at all, not even a missed one:
// nothing here ever called protectSecrets on them before this fix. One pair
// of helpers so the three call sites below (reveal-for-merge, protect-for-
// write, reveal-on-load) can't drift out of sync with each other.
async function revealMemberSensitive(raw: FamilyMember): Promise<FamilyMember> {
  return {
    ...raw,
    identity: await revealIdentity(raw.identity, revealSharedSecrets),
    passports: await revealPassports(raw.passports, revealSharedSecrets),
    travel: raw.travel
      ? { ...raw.travel, visas: await revealVisas(raw.travel.visas, revealSharedSecrets) }
      : raw.travel,
    identifiers: await revealIdentifiers(raw.identifiers, revealSharedSecrets),
    financialAccounts: await revealFinancialAccounts(raw.financialAccounts, revealSharedSecrets),
  };
}

async function protectMemberSensitive(merged: FamilyMember): Promise<FamilyMember> {
  return {
    ...merged,
    identity: await protectIdentity(merged.identity, protectSecrets),
    passports: await protectPassports(merged.passports, protectSecrets),
    travel: merged.travel
      ? { ...merged.travel, visas: await protectVisas(merged.travel.visas, protectSecrets) }
      : merged.travel,
    identifiers: await protectIdentifiers(merged.identifiers, protectSecrets),
    financialAccounts: await protectFinancialAccounts(merged.financialAccounts, protectSecrets),
  };
}

export async function saveFamilyMembers(members: FamilyMember[]): Promise<boolean> {
  const user = auth.currentUser;
  let cloudOk = false;

  if (user) {
    try {
      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'members');
      const localIds = members.map(m => m.id).filter(Boolean);
      const targets = members.filter(m => m.id);
      const memberRefs = targets.map(m => doc(db, 'families', FAMILY_ID, 'family_members', m.id));

      const { mergedIds, mergedMembers } = await runTransaction(db, async (tx) => {
        // ALL reads before ANY write — the metadata index and every member
        // doc being touched, read together up front.
        const metaSnap = await tx.get(metaRef);
        const memberSnaps = await Promise.all(memberRefs.map(r => tx.get(r)));

        const serverIds = (metaSnap.exists() ? (metaSnap.data().ids as string[]) : undefined) || [];
        const ids = mergeIdList(getSeen<string[]>(MEMBER_IDS_KEY), localIds, serverIds);

        // Decrypt every server copy up front (concurrently, not one member
        // after another — same concurrency style the old encrypt-before-write
        // here used to have).
        const servers = await Promise.all(memberSnaps.map(async (snap) => {
          if (!snap.exists()) return undefined;
          return revealMemberSensitive(snap.data() as FamilyMember);
        }));

        const mergedMembers = targets.map((local, i) =>
          mergeShared<FamilyMember>(getSeen<FamilyMember>(memberSeenKey(local.id)), local, servers[i]));

        // Only re-encrypt + write docs that actually changed vs. the server's
        // (decrypted) copy — a member nobody touched costs nothing here.
        const toWrite = mergedMembers
          .map((merged, i) => ({ merged, ref: memberRefs[i], server: servers[i] }))
          .filter(({ merged, server }) => server === undefined || !deepEqual(merged, server));
        const protectedWrites = await Promise.all(toWrite.map(async ({ merged, ref }) => ({
          ref,
          value: await protectMemberSensitive(merged),
        })));
        for (const { ref, value } of protectedWrites) tx.set(ref, value as any);

        tx.set(metaRef, { ids });
        return { mergedIds: ids, mergedMembers };
      });

      noteSeen(MEMBER_IDS_KEY, mergedIds);
      for (const m of mergedMembers) noteSeen(memberSeenKey(m.id), m);
      cloudOk = true;
    } catch (error) {
      console.error('Error saving to Firestore:', error);
    }
  }

  // Always keep local storage updated for fast loading
  try {
    localStorage.setItem(membersKey(), JSON.stringify(members));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }

  // See pendingSync.ts: a write that didn't reach Firestore must not be
  // silently discarded the next time this device successfully LOADS members
  // (loadFamilyMembers checks this before it would overwrite localStorage).
  if (cloudOk) clearDirty('members', FAMILY_ID); else markDirty('members', FAMILY_ID);

  return cloudOk;
}

/**
 * The last-known members for THIS space, straight from localStorage, synchronously.
 *
 * `loadFamilyMembers` is network-first by design (its migratedFlagKey guard
 * depends on that) and on a cold start it can take seconds. Until it returned,
 * `members` was `[]` — indistinguishable from a genuinely empty family — so the
 * app greeted an eight-person household with "Add your first family member".
 * This gives the first paint something true to draw while the network catches up.
 */
export function readCachedFamilyMembers(): FamilyMember[] | null {
  try {
    const raw = localStorage.getItem(membersKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FamilyMember[]) : null;
  } catch {
    return null;
  }
}

export async function loadFamilyMembers(): Promise<FamilyMember[] | null> {
  const user = auth.currentUser;

  if (user) {
    try {
      // See pendingSync.ts. A previous save of this device's members never
      // reached Firestore, so the server read below would be OLDER than
      // what's actually in localStorage right now — fetching it and
      // overwriting localStorage would silently discard the unsynced edit.
      // Retry the save first; whether it succeeds or not, serve what this
      // device actually has rather than a stale server copy that would
      // clobber it.
      if (isDirty('members', FAMILY_ID)) {
        const pendingRaw = localStorage.getItem(membersKey());
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw) as FamilyMember[];
            if (Array.isArray(pending)) {
              await saveFamilyMembers(pending);   // clears the dirty flag on success
              return pending.length > 0 ? pending : null;
            }
          } catch { /* corrupt local cache — fall through to a normal load */ }
        }
        clearDirty('members', FAMILY_ID);   // dirty but nothing sensible to resync — stale flag, drop it
      }

      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'members');
      const metaSnap = await getDoc(metaRef);

      if (metaSnap.exists()) {
        const ids = metaSnap.data().ids as string[];
        noteSeen(MEMBER_IDS_KEY, ids);   // merge base for the next index write
        const membersReqs = ids.map(id => getDoc(doc(db, 'families', FAMILY_ID, 'family_members', id)));
        const snaps = await Promise.all(membersReqs);
        const rawMembers = snaps.map(s => s.data() as FamilyMember).filter(Boolean);

        // Decrypt ID numbers/passport/visa numbers (see revealMemberSensitive
        // above). The underlying reveal* calls use a local ciphertext cache
        // internally, so a value seen once stays readable offline (see
        // vaultFields.ts) — this is what keeps a screen like Emergency
        // essentials usable without signal after first sync.
        const members = await Promise.all(rawMembers.map(revealMemberSensitive));

        // Merge base for the next per-member write (see saveFamilyMembers) —
        // this load IS what this device's screen is about to be built from.
        for (const m of members) noteSeen(memberSeenKey(m.id), m);

        // Cache locally (plaintext — this is what the rest of the app reads)
        localStorage.setItem(membersKey(), JSON.stringify(members));
        return members.length > 0 ? members : null;
      }

      // Shared vault is empty: migrate whatever this device saved locally (e.g.
      // data entered before sharing existed) up into the family vault — but
      // ONLY ONCE per space, ever. Without the flag, this fires every time the
      // cloud looks empty, including right after a deliberate server-side
      // delete — which would silently resurrect data an admin just removed.
      const migratedKey = migratedFlagKey('members');
      if (!localStorage.getItem(migratedKey)) {
        const local = localStorage.getItem(membersKey());
        if (local) {
          const localMembers = JSON.parse(local) as FamilyMember[];
          if (Array.isArray(localMembers) && localMembers.length > 0) {
            await saveFamilyMembers(localMembers);
            localStorage.setItem(migratedKey, '1');
            return localMembers;
          }
        }
        localStorage.setItem(migratedKey, '1');
      }
    } catch (error) {
      console.error('Error loading from Firestore:', error);
    }
  }

  // Fallback to local (not signed in)
  const local = localStorage.getItem(membersKey());
  if (local) {
    try {
      return JSON.parse(local);
    } catch (e) {
      return null;
    }
  }
  return null;
}

// Same per-document merge as saveFamilyMembers above — see the note there for
// why a blind {merge:true} whole-array write was unsafe here too (Dashboard's
// applyCalendarEdits builds `events` from React state loaded once at mount,
// with no live listener). No encrypted fields on CalendarEvent, so this is
// the same shape without the reveal/protect wrapper.
const eventSeenKey = (id: string) => `event:${id}`;

export async function saveCalendarEvents(events: CalendarEvent[]): Promise<boolean> {
  const user = auth.currentUser;
  let cloudOk = false;

  if (user) {
    try {
      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'events');
      const localIds = events.map(e => e.id).filter(Boolean);
      const targets = events.filter(e => e.id);
      const eventRefs = targets.map(e => doc(db, 'families', FAMILY_ID, 'calendar_events', e.id));

      const { mergedIds, mergedEvents } = await runTransaction(db, async (tx) => {
        const metaSnap = await tx.get(metaRef);
        const eventSnaps = await Promise.all(eventRefs.map(r => tx.get(r)));

        const serverIds = (metaSnap.exists() ? (metaSnap.data().ids as string[]) : undefined) || [];
        const ids = mergeIdList(getSeen<string[]>(EVENT_IDS_KEY), localIds, serverIds);

        const servers = eventSnaps.map(snap => (snap.exists() ? (snap.data() as CalendarEvent) : undefined));
        const mergedEvents = targets.map((local, i) =>
          mergeShared<CalendarEvent>(getSeen<CalendarEvent>(eventSeenKey(local.id)), local, servers[i]));

        mergedEvents.forEach((merged, i) => {
          const server = servers[i];
          if (server !== undefined && deepEqual(merged, server)) return; // untouched — nothing to write
          tx.set(eventRefs[i], merged as any);
        });

        tx.set(metaRef, { ids });
        return { mergedIds: ids, mergedEvents };
      });
      noteSeen(EVENT_IDS_KEY, mergedIds);
      for (const e of mergedEvents) noteSeen(eventSeenKey(e.id), e);
      cloudOk = true;
    } catch (error) {
      console.error('Error saving to Firestore:', error);
    }
  }

  try {
    localStorage.setItem(calendarKey(), JSON.stringify(events));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }

  // See pendingSync.ts / saveFamilyMembers above for why this exists.
  if (cloudOk) clearDirty('calendar', FAMILY_ID); else markDirty('calendar', FAMILY_ID);

  return cloudOk;
}

export async function loadCalendarEvents(): Promise<CalendarEvent[] | null> {
  const user = auth.currentUser;

  if (user) {
    try {
      // See loadFamilyMembers above for why this guard exists.
      if (isDirty('calendar', FAMILY_ID)) {
        const pendingRaw = localStorage.getItem(calendarKey());
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw) as CalendarEvent[];
            if (Array.isArray(pending)) {
              await saveCalendarEvents(pending);   // clears the dirty flag on success
              return pending.length > 0 ? pending : null;
            }
          } catch { /* corrupt local cache — fall through to a normal load */ }
        }
        clearDirty('calendar', FAMILY_ID);
      }

      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'events');
      const metaSnap = await getDoc(metaRef);

      if (metaSnap.exists()) {
        const ids = metaSnap.data().ids as string[];
        noteSeen(EVENT_IDS_KEY, ids);    // merge base for the next index write
        const eventReqs = ids.map(id => getDoc(doc(db, 'families', FAMILY_ID, 'calendar_events', id)));
        const snaps = await Promise.all(eventReqs);
        const events = snaps.map(s => s.data() as CalendarEvent).filter(Boolean);

        // Merge base for the next per-event write (see saveCalendarEvents).
        for (const e of events) noteSeen(eventSeenKey(e.id), e);

        localStorage.setItem(calendarKey(), JSON.stringify(events));
        return events.length > 0 ? events : null;
      }

      // Shared vault empty: migrate this device's local events up — ONLY ONCE
      // per space, ever (see the members loader above for why: without the
      // flag, a deliberate server-side delete gets silently undone on the
      // next load from a stale local cache).
      const migratedKey = migratedFlagKey('events');
      if (!localStorage.getItem(migratedKey)) {
        const local = localStorage.getItem(calendarKey());
        if (local) {
          const localEvents = JSON.parse(local) as CalendarEvent[];
          if (Array.isArray(localEvents) && localEvents.length > 0) {
            await saveCalendarEvents(localEvents);
            localStorage.setItem(migratedKey, '1');
            return localEvents;
          }
        }
        localStorage.setItem(migratedKey, '1');
      }
    } catch (error) {
      console.error('Error loading events from Firestore:', error);
    }
  }

  const local = localStorage.getItem(calendarKey());
  if (local) {
    try {
      return JSON.parse(local);
    } catch (e) {
      return null;
    }
  }
  return null;
}

// --- Important Info: one shared doc for the whole household ---
// Same store, same document (families/{FAMILY_ID}/reference/info) and the same
// localStorage key as before — it just goes through the merging writer below
// now, instead of its own hand-rolled copy of the old overwrite. Declared after
// saveReferenceDoc/loadReferenceDoc, which are hoisted function declarations.
export const saveFamilyInfo = (info: FamilyInfo, base?: FamilyInfo) =>
  saveReferenceDoc('info', info, 'family_info_v2', base);
export const loadFamilyInfo = () => loadReferenceDoc<FamilyInfo>('info', 'family_info_v2');

// --- Generic shared single-doc reference store (household / finances / timeline) ---
// Each lives at families/{FAMILY_ID}/reference/{key}, shared across the household.
// localKey is scoped by FAMILY_ID internally (see membersKey/calendarKey/infoKey
// above for why) — callers keep passing their existing plain 'family_household'-
// style constant, no call-site change needed.
//
// ── CONCURRENT WRITERS ──────────────────────────────────────────────────────
// These documents each hold a WHOLE array (the shopping list, the recipe book,
// the document vault…) and are written by every adult in the household from
// their own phone. The original implementation was a bare
// `setDoc(ref, value)` — last writer wins, whole document — and every view
// loads its array ONCE into React state and never refetches. That combination
// destroyed data in completely ordinary use:
//
//   Mama loads ["Milk"] · Papa loads ["Milk"] a minute later
//   Mama adds Eggs  → ["Milk","Eggs"]
//   Papa adds Bread → ["Milk","Bread"]   ← writes his stale array over hers
//   "Eggs" is gone, with no error anywhere.
//
// Wrapping that same write in a transaction would NOT have fixed it. A
// transaction only guarantees the document did not change between the
// transaction's own read and its commit — microseconds. Papa's array is
// minutes old, and a transaction that reads the document and then writes
// `value` anyway commits the identical destructive result, just atomically.
//
// The fix is therefore a three-way merge (see utils/mergeShared.ts) run INSIDE
// a transaction:
//
//   base   what this client last saw   (its screen was built from this)
//   value  what this client wants to save
//   server what Firestore holds right now, read in the transaction
//
// The diff of `value` against `base` is the writer's actual intent, and only
// that intent is applied on top of `server`. The transaction is still needed —
// it makes read-merge-write atomic so two merges cannot interleave — but it is
// the base, not the transaction, that closes the hole.
//
// Every ambiguous case resolves toward keeping data (see mergeShared.ts for the
// full policy); this vault holds passports and children's medical records.

// The base: the last value this client saw for a document, per space. Written
// when a value is HANDED TO THE APP (a load, an applied live snapshot) or
// committed by this client — i.e. it always equals what the user's screen was
// built from, which is exactly what a merge base has to be.
const lastSeen = new Map<string, unknown>();
const seenKey = (key: string) => `${FAMILY_ID}::${key}`;

function noteSeen<T>(key: string, value: T): void {
  lastSeen.set(seenKey(key), value);
}

function getSeen<T>(key: string): T | undefined {
  return lastSeen.get(seenKey(key)) as T | undefined;
}

/**
 * Forget the merge base for every document. Called on sign-out / space switch:
 * a base from another account or another space must never be diffed against.
 */
export function resetSharedDocBaselines(): void {
  lastSeen.clear();
}

/**
 * @param base Optional explicit merge base — the exact value this writer's
 *   state was built from. Callers that hold a live subscription pass it (see
 *   hooks/useSharedDoc.ts); everything else falls back to the module-level
 *   `lastSeen`, which is correct for the load-mutate-save callers (Dashboard's
 *   AI apply paths, aiDestructive, deleteDocumentEverywhere) because they
 *   re-read the document immediately before writing it.
 */
// `protect`/`reveal` are how household/finances get encrypted fields without
// their own copy of this function — see saveHousehold/loadHousehold and
// saveFinances/loadFinances below. EVERY OTHER caller omits them and gets the
// default no-op pass-through, so nothing about this changes for them.
//
// WHERE protect/reveal MUST run, and why: mergeShared does a real plaintext
// three-way diff (mergeBase / value / server). `server` is decrypted the
// instant it's read from Firestore, BEFORE mergeShared ever sees it, and the
// merged RESULT is encrypted only in the copy handed to tx.set() — `persisted`
// (returned, noteSeen'd, and cached to localStorage) stays the plaintext
// `merged`. If protect() were applied any earlier, or reveal() skipped,
// mergeShared would be diffing ciphertext against plaintext: ciphertext never
// equals anything (fresh random IV every encryption, including of an
// unchanged value), so every field would look like a fresh edit on every
// single save — silently corrupting the multi-device merge this function
// exists to get right.
const passthrough = async <T,>(v: T): Promise<T> => v;

async function saveReferenceDoc<T>(
  key: string, value: T, localKey: string, base?: T,
  protect: (v: T) => Promise<T> = passthrough, reveal: (v: T) => Promise<T> = passthrough,
): Promise<boolean> {
  const user = auth.currentUser;
  let cloudOk = false;
  // What actually ends up stored — the merge may legitimately differ from
  // `value` (it can carry another device's items), and the local cache must
  // hold the merged truth, not this device's half of it.
  let persisted: T = value;

  if (user) {
    const mergeBase = base !== undefined ? base : getSeen<T>(key);
    try {
      const docRef = doc(db, 'families', FAMILY_ID, 'reference', key);
      persisted = await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        const serverRaw = snap.exists() ? (snap.data() as T) : undefined;
        const server = serverRaw !== undefined ? await reveal(serverRaw) : undefined;
        const merged = mergeShared<T>(mergeBase, value, server);
        tx.set(docRef, (await protect(merged)) as any);
        return merged;
      });
      cloudOk = true;
      noteSeen(key, persisted);
    } catch (error) {
      console.error(`Error saving ${key}:`, error);
      persisted = value;
    }
  }

  try {
    localStorage.setItem(`${localKey}_${FAMILY_ID}`, JSON.stringify(persisted));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }

  // See pendingSync.ts / saveFamilyMembers above for why this exists.
  if (cloudOk) clearDirty(key, FAMILY_ID); else markDirty(key, FAMILY_ID);

  return cloudOk;
}

async function loadReferenceDoc<T>(
  key: string, localKey: string,
  reveal: (v: T) => Promise<T> = passthrough, protect: (v: T) => Promise<T> = passthrough,
): Promise<T | null> {
  const scopedKey = `${localKey}_${FAMILY_ID}`;
  const user = auth.currentUser;
  if (user) {
    try {
      // See loadFamilyMembers above for why this guard exists. getSeen(key)
      // is untouched by a failed save (noteSeen only runs on success), so
      // the retry below diffs against the same base the failed attempt did
      // — this is a genuine retry, not a fresh, unrelated write.
      if (isDirty(key, FAMILY_ID)) {
        const pendingRaw = localStorage.getItem(scopedKey);
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw) as T;   // plaintext — local cache always is
            await saveReferenceDoc(key, pending, localKey, undefined, protect, reveal);   // clears the dirty flag on success
            return pending;
          } catch { /* corrupt local cache — fall through to a normal load */ }
        }
        clearDirty(key, FAMILY_ID);
      }

      const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'reference', key));
      if (snap.exists()) {
        const data = await reveal(snap.data() as T);
        localStorage.setItem(scopedKey, JSON.stringify(data));
        noteSeen(key, data);
        return data;
      }
    } catch (error) {
      console.error(`Error loading ${key}:`, error);
      /* A REFUSAL IS NOT AN OUTAGE, and must not fall through to the cache.
       *
       * Everything below this block treats a failed read as "we're offline,
       * serve what we last saw" — right for a network blip, wrong when the
       * server has just told us this person may not read this document. Since
       * reference/willsEstate became admin-and-named-readers-only, that case is
       * real: a member who could open the will yesterday still has a plaintext
       * copy in their own localStorage, and serving it would mean the lock
       * changed nothing on the one device that already had the data.
       *
       * So a permission-denied purges the local copy and returns null. It also
       * clears any dirty flag: a pending write we are no longer allowed to make
       * would otherwise be retried on every load, forever. */
      if ((error as { code?: string })?.code === 'permission-denied') {
        try { localStorage.removeItem(scopedKey); } catch { /* private mode */ }
        clearDirty(key, FAMILY_ID);
        return null;
      }
    }
  }
  const local = localStorage.getItem(scopedKey);
  if (local) {
    try {
      const parsed = JSON.parse(local) as T;   // plaintext — local cache always is
      noteSeen(key, parsed);
      return parsed;
    } catch (e) { return null; }
  }
  return null;
}

// --- Live subscriptions -----------------------------------------------------
// The merge above is only as good as its base, and the base is only fresh if
// the screen is. A view that loaded once at mount and never refetched is
// exactly the "minutes stale" writer the merge has to defend against; a view
// that listens is never more than a moment behind, so its writes are clean
// diffs and its user sees the other phone's changes arrive.
//
// `commit()` is deliberately NOT called for the subscriber: a view that is
// mid-edit defers applying a snapshot, and until it applies it, that snapshot
// is NOT what its state was built from and must not become the merge base.
// Callers invoke commit() at the moment they actually adopt the value.

export interface SharedDocMeta { readonly key: string; readonly localKey: string }

/** Every shared reference document, so views can subscribe by name. */
export const SHARED_DOCS = {
  info:           { key: 'info',           localKey: 'family_info_v2' },
  household:      { key: 'household',      localKey: 'family_household' },
  finances:       { key: 'finances',       localKey: 'family_finances' },
  timeline:       { key: 'timeline',       localKey: 'family_timeline' },
  familyWords:    { key: 'familyWords',    localKey: 'family_words' },
  willsEstate:    { key: 'willsEstate',    localKey: 'family_wills_estate' },
  travelTimeline: { key: 'travelTimeline', localKey: 'family_travel_timeline' },
  settings:       { key: 'settings',       localKey: 'family_settings' },
  inMemory:       { key: 'inMemory',       localKey: 'family_in_memory' },
  documents:      { key: 'documents',      localKey: 'family_documents' },
  shopping:       { key: 'shopping',       localKey: 'family_shopping' },
  recipes:        { key: 'recipes',        localKey: 'family_recipes' },
  slips:          { key: 'slips',          localKey: 'family_slips' },
  anniversaries:  { key: 'anniversaries',  localKey: 'family_anniversaries' },
  extendedBirthdays: { key: 'extendedBirthdays', localKey: 'family_extended_birthdays' },
} as const satisfies Record<string, SharedDocMeta>;

export type SharedDocName = keyof typeof SHARED_DOCS;

/**
 * Watch a shared reference document. `cb` receives the server's value (null
 * when the document does not exist) plus a `commit` callback the subscriber
 * MUST call once it has adopted that value into its own state — that is what
 * makes it the merge base for the subscriber's next write.
 *
 * Returns an unsubscribe function. Safe to call when signed out (no-op).
 */
// Used via hooks/useSharedDoc.ts, mounted for the lifetime of ~13 views
// (VehiclesView, FinancesView, ImportantInfo, etc.) — NOT the family_members
// collection, which has no equivalent subscription (see saveFamilyMembers).
/* Live subscription to a shared reference doc.
 *
 * DECRYPTS HERE. 'household' and 'finances' carry app-layer-encrypted fields
 * (door code, wifi password, IBANs — see saveReferenceDoc/loadReferenceDoc),
 * and this function used to hand the caller the raw Firestore snapshot with a
 * comment telling each subscriber to decrypt it themselves. Both subscribers
 * were written without doing that, which is what a warning comment buys you:
 * loadHousehold() painted the real door code, then the first remote write from
 * another device replaced it, live and in front of the user, with
 * `enc:2:…` — and any Save from that screen would then have written the
 * ciphertext BACK as if it were the plaintext value, encrypting it twice.
 *
 * So the decrypt is part of the subscription now and cannot be forgotten. The
 * sequence guard matters because decryption is async: snapshots can resolve out
 * of order, and applying a stale one would silently revert a newer edit. */
export function subscribeReferenceDoc<T>(
  name: SharedDocName,
  cb: (value: T | null, commit: () => void) => void,
): () => void {
  if (!auth.currentUser) return () => { /* not signed in: nothing to watch */ };
  const { key, localKey } = SHARED_DOCS[name];
  const scopedKey = `${localKey}_${FAMILY_ID}`;
  const docRef = doc(db, 'families', FAMILY_ID, 'reference', key);

  const decrypt = async (value: any): Promise<any> => {
    if (value === null) return null;
    if (name === 'household') return (await revealHousehold(value, revealSharedSecrets)) ?? value;
    if (name === 'finances') return (await revealFinances(value, revealSharedSecrets)) ?? value;
    return value;
  };

  let seq = 0;
  let applied = 0;
  let stopped = false;

  const unsubscribe = onSnapshot(
    docRef,
    (snap) => {
      const mine = ++seq;
      const raw = snap.exists() ? (snap.data() as T) : null;
      void decrypt(raw).then((value) => {
        // A slower earlier snapshot must never overwrite a newer one, and
        // nothing is applied after the caller unsubscribed.
        if (stopped || mine <= applied) return;
        applied = mine;
        cb(value as T | null, () => {
          if (value === null) return;
          noteSeen(key, value);
          // The cache holds the DECRYPTED value, matching what loadHousehold /
          // loadFinances write there — one shape in that key, not two.
          try { localStorage.setItem(scopedKey, JSON.stringify(value)); } catch { /* quota */ }
        });
      }).catch((err) => {
        // Decryption failing (offline, key rotation) must not blank the screen:
        // keep whatever the view already had rather than showing ciphertext or
        // nothing at all.
        console.error(`Could not decrypt live update for ${key}:`, err);
      });
    },
    (error) => console.error(`Live updates for ${key} stopped:`, error),
  );

  return () => { stopped = true; unsubscribe(); };
}

// Every save below takes an OPTIONAL `base` — the exact value the caller's
// state was built from. Passing it makes the three-way merge exact; omitting it
// falls back to the last value this client loaded/applied for that document,
// which is what every existing call site already effectively has (they all
// load-mutate-save). No call site had to change.
export const saveHousehold = (h: HouseholdInfo, base?: HouseholdInfo) =>
  saveReferenceDoc('household', h, 'family_household', base,
    (v) => protectHousehold(v, protectSecrets).then(r => r ?? v),
    (v) => revealHousehold(v, revealSharedSecrets).then(r => r ?? v));
export const loadHousehold = () =>
  loadReferenceDoc<HouseholdInfo>('household', 'family_household',
    (v) => revealHousehold(v, revealSharedSecrets).then(r => r ?? v),
    (v) => protectHousehold(v, protectSecrets).then(r => r ?? v));

export const saveFinances = (f: FinancesInfo, base?: FinancesInfo) =>
  saveReferenceDoc('finances', f, 'family_finances', base,
    (v) => protectFinances(v, protectSecrets).then(r => r ?? v),
    (v) => revealFinances(v, revealSharedSecrets).then(r => r ?? v));
export const loadFinances = () =>
  loadReferenceDoc<FinancesInfo>('finances', 'family_finances',
    (v) => revealFinances(v, revealSharedSecrets).then(r => r ?? v),
    (v) => protectFinances(v, protectSecrets).then(r => r ?? v));

export const saveTimeline = (t: FamilyTimeline, base?: FamilyTimeline) => saveReferenceDoc('timeline', t, 'family_timeline', base);
export const loadTimeline = () => loadReferenceDoc<FamilyTimeline>('timeline', 'family_timeline');

// Family Dictionary (invented/mangled words the family adopted) — family-level.
export const saveFamilyWords = (w: FamilyWordsDoc, base?: FamilyWordsDoc) => saveReferenceDoc('familyWords', w, 'family_words', base);
export const loadFamilyWords = () => loadReferenceDoc<FamilyWordsDoc>('familyWords', 'family_words');

// Wills & estate — family-wide, store-and-recall only (see WillsEstateView).
export const saveWillsEstate = (w: WillsEstateDoc, base?: WillsEstateDoc) => saveReferenceDoc('willsEstate', w, 'family_wills_estate', base);
export const loadWillsEstate = () => loadReferenceDoc<WillsEstateDoc>('willsEstate', 'family_wills_estate');

/* Who else may open it. DELIBERATELY NOT a saveReferenceDoc/loadReferenceDoc
 * pair like everything above: those cache to localStorage and fall back to the
 * cache when the network is unavailable, and an access list served from a stale
 * local copy is an access list that can be wrong in the permissive direction on
 * exactly the device you'd least want that. Straight to Firestore, or nothing.
 *
 * Reads return null on any failure — the caller treats that as "no extra
 * readers", which is the closed-fail direction. */
export async function loadWillsAccess(): Promise<WillsAccessDoc | null> {
  if (!auth.currentUser) return null;
  try {
    const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'reference', 'willsAccess'));
    if (!snap.exists()) return null;
    const data = snap.data() as WillsAccessDoc;
    return { ...data, readerUids: Array.isArray(data.readerUids) ? data.readerUids : [] };
  } catch (error) {
    console.error('Error loading willsAccess:', error);
    return null;
  }
}

/**
 * Drop this device's cached plaintext copy of the will.
 *
 * loadReferenceDoc purges the cache when the SERVER refuses a read — but from
 * v230 a locked-out member never makes that request at all, because the app
 * stops asking (hidden nav, skipped nudges, skipped readiness, no AI context).
 * The refusal that would have cleaned up never happens, so a member who could
 * open the will yesterday keeps a readable copy in their own localStorage
 * indefinitely, reachable from devtools. Called by useWillsAccess the moment
 * the answer comes back "no".
 *
 * Deliberately unconditional and silent: there is no case where a device that
 * may not read this document should keep a copy of it.
 */
export function purgeLocalWillsEstate() {
  try {
    localStorage.removeItem(`${SHARED_DOCS.willsEstate.localKey}_${FAMILY_ID}`);
  } catch { /* private mode */ }
  // A pending write we are no longer allowed to make would otherwise be
  // retried on every load, forever.
  clearDirty(SHARED_DOCS.willsEstate.key, FAMILY_ID);
}

/** Admins only — the rule rejects everyone else. Returns false if it did. */
export async function saveWillsAccess(readerUids: string[], updatedBy?: string): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    await setDoc(
      doc(db, 'families', FAMILY_ID, 'reference', 'willsAccess'),
      { readerUids, updatedAt: new Date().toISOString(), updatedBy: updatedBy || '' },
    );
    return true;
  } catch (error) {
    console.error('Error saving willsAccess:', error);
    return false;
  }
}

export const saveTravelTimeline = (t: TravelTimelineDoc, base?: TravelTimelineDoc) => saveReferenceDoc('travelTimeline', t, 'family_travel_timeline', base);
export const loadTravelTimeline = () => loadReferenceDoc<TravelTimelineDoc>('travelTimeline', 'family_travel_timeline');

export const saveSettings = (s: HubSettings, base?: HubSettings) => saveReferenceDoc('settings', s, 'family_settings', base);
export const loadSettings = () => loadReferenceDoc<HubSettings>('settings', 'family_settings');

// In Memory: an archive of deceased parents/grandparents — their documents and
// a few remembered things. Family-level, one shared reference doc like every
// other feature here.
export const saveInMemory = (v: InMemoryDoc, base?: InMemoryDoc) => saveReferenceDoc('inMemory', v, 'family_in_memory', base);
export const loadInMemory = () => loadReferenceDoc<InMemoryDoc>('inMemory', 'family_in_memory');

// Business Milestones (business spaces only) — the company growth timeline
// (one-off milestones + headcount log), alongside the founding date already
// on FamilyInfoDoc.foundingDate. Same shared-reference-doc convention as
// every other feature above; readable/writable by any adult in the space
// (mirrors WillsEstate/Slips — not admin-gated the way the founding date is,
// since a milestone is a shared team memory, not a legal space setting).
export const saveBusinessMilestones = (v: BusinessMilestonesDoc) => saveReferenceDoc('businessMilestones', v, 'family_business_milestones');
export const loadBusinessMilestones = () => loadReferenceDoc<BusinessMilestonesDoc>('businessMilestones', 'family_business_milestones');

// --- Asset photos: extra photos live in Firebase Storage (NOT inline base64) so
// an asset can hold many pictures without hitting Firestore's ~1 MiB per-doc
// limit. Takes a (compressed) data URL, returns the download URL to store in
// AssetItem.photos[]. The primary photo stays inline for fast thumbnails. ---
export async function uploadAssetPhoto(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const storagePath = `families/${FAMILY_ID}/asset-photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  return getDownloadURL(r);
}

// --- Chat attachments: uploaded to Storage (not kept as inline base64 in chat
// history) so a scan/photo a user attached stays available after a reload —
// previously the raw dataURL was stripped from every persisted message
// (localStorage AND Firestore) to avoid bloating storage, which meant an
// attached scan was silently gone the moment the app reloaded, breaking any
// "save it anyway" follow-up on an older message. ---
export async function uploadChatAttachment(dataUrl: string, mimeType: string, uid: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const storagePath = `families/${FAMILY_ID}/chat-attachments/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: mimeType || blob.type || 'application/octet-stream' });
  return getDownloadURL(r);
}

// Best-effort delete of a Storage-backed asset photo by its download URL.
// ref(storage, url) resolves an https download URL to its object. Legacy inline
// base64 photos aren't in Storage, so they're skipped.
export async function deleteAssetPhoto(url: string): Promise<void> {
  if (!url || !/^https?:/i.test(url)) return;
  try {
    await deleteObject(ref(storage, url));
  } catch (e) {
    console.error('Asset photo delete failed (reference will still be removed):', e);
  }
}

// --- Document Vault: files in Firebase Storage, metadata in Firestore ---
export async function uploadVaultFile(file: File, docId: string): Promise<{ storagePath: string; downloadUrl: string }> {
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g, '_');
  const storagePath = `families/${FAMILY_ID}/documents/${docId}/${safeName}`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

export async function deleteVaultFile(storagePath: string): Promise<void> {
  // An empty path means this document does not OWN its bytes — it adopted a
  // chat-attachment object that other documents may also point at (see the
  // case-2 branch of fileScans in AIChatbot.tsx). Deleting by empty path would
  // resolve to the bucket root, so refuse outright: metadata-only removal is
  // the correct behaviour here, not a best-effort delete.
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    console.error('Vault file delete failed (metadata will still be removed):', e);
  }
}

// Bulk photo import (Photos / Google Photos picker on device): takes an
// already-compressed data URL (compressImageToAvatar) and uploads it under
// the SAME families/{FAMILY_ID}/documents/{docId}/... prefix uploadVaultFile
// already writes to, so no storage.rules change is needed. Modeled on
// uploadVaultFile exactly, just skipping the File object in favour of a data URL.
export async function uploadVaultPhoto(dataUrl: string, docId: string): Promise<{ storagePath: string; downloadUrl: string }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const storagePath = `families/${FAMILY_ID}/documents/${docId}/photo.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

// --- Travel timeline photos: real Storage files, only the URL lives in the
// shared travelTimeline reference doc (all entries share ONE Firestore doc —
// inlining base64 there like Assets does would blow the ~1MB doc cap after a
// handful of photos). Takes a compressed data URL (post-EXIF-parse, see
// utils/travelGeo.ts) and uploads it, mirroring uploadVaultFile exactly.
export async function uploadTravelPhoto(dataUrl: string, entryId: string): Promise<{ storagePath: string; downloadUrl: string }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const storagePath = `families/${FAMILY_ID}/travel-photos/${entryId}.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

export async function deleteTravelPhoto(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    console.error('Travel photo delete failed (entry will still be removed):', e);
  }
}

// --- In Memory portraits: real Storage files, only the URL lives in the
// shared inMemory reference doc — same reasoning as uploadTravelPhoto (many
// people share ONE Firestore doc, so no inline base64). Documents for a
// departed relative reuse uploadVaultFile/deleteVaultFile unmodified.
export async function uploadInMemoryPhoto(dataUrl: string, personId: string): Promise<{ storagePath: string; downloadUrl: string }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const storagePath = `families/${FAMILY_ID}/in-memory-photos/${personId}.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

export async function deleteInMemoryPhoto(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    console.error('In Memory photo delete failed (entry will still be removed):', e);
  }
}

// --- Birthday photos (growing-up timelapse): image bytes in Storage, only the
// download URL + metadata on the member record. Modeled on uploadVaultFile so it
// shares the same families/{FAMILY_ID}/… path convention and 20MB rules cap. ---
export async function uploadBirthdayPhoto(
  dataUrl: string,
  memberId: string,
  year: number,
): Promise<{ url: string; storagePath: string }> {
  // Turn the compressed base64 data URL into a Blob for a compact binary upload.
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const rand = Math.random().toString(36).slice(2, 8);
  const storagePath = `families/${FAMILY_ID}/birthday-photos/${memberId}/${year}-${rand}.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  const url = await getDownloadURL(r);
  return { url, storagePath };
}

export async function deleteBirthdayPhoto(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    // Best-effort: a missing/denied object must not block removing the metadata.
    console.error('Birthday photo delete failed (metadata will still be removed):', e);
  }
}

// --- Referrals & Results: real Storage files, only the URL + metadata sit on
// the member record. Modeled on uploadBirthdayPhoto exactly — same per-member
// families/{FAMILY_ID}/… Storage prefix convention, same 20MB rules cap, two
// upload variants (File vs a captured data: URL) mirroring uploadVaultFile /
// uploadVaultPhoto. recordId is folded into the path so re-uploading a
// replacement for the same record can't collide with an unrelated one. ---
export async function uploadReferralFile(
  file: File,
  memberId: string,
  recordId: string,
): Promise<{ storagePath: string; downloadUrl: string }> {
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g, '_');
  const storagePath = `families/${FAMILY_ID}/referrals/${memberId}/${recordId}-${safeName}`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream' });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

// Data-URL variant (camera scan via DocumentScannerModal) — mirrors
// uploadVaultPhoto's relationship to uploadVaultFile.
export async function uploadReferralPhoto(
  dataUrl: string,
  memberId: string,
  recordId: string,
  contentType: string,
): Promise<{ storagePath: string; downloadUrl: string }> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = contentType === 'application/pdf' ? 'pdf' : 'jpg';
  const storagePath = `families/${FAMILY_ID}/referrals/${memberId}/${recordId}.${ext}`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: contentType || blob.type || 'application/octet-stream' });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

export async function deleteReferralFile(storagePath: string): Promise<void> {
  // No path means there is nothing in Storage to remove — never attempt to
  // resolve an empty path (that would target the bucket root). Mirrors
  // deleteVaultFile's guard, which exists because of exactly that bug before.
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    // Best-effort: a missing/denied object must not block removing the metadata.
    console.error('Referral file delete failed (metadata will still be removed):', e);
  }
}

export const saveDocuments = (docs: VaultDocument[], base?: VaultDocument[]) =>
  saveReferenceDoc('documents', { docs }, 'family_documents', base ? { docs: base } : undefined);
export async function loadDocuments(): Promise<VaultDocument[]> {
  const data = await loadReferenceDoc<{ docs: VaultDocument[] }>('documents', 'family_documents');
  return data?.docs || [];
}

export const DEFAULT_EVENTS: CalendarEvent[] = [];
export const DEFAULT_FAMILY: FamilyMember[] = [];

// --- Shopping list ---
export const saveShopping = (items: ShoppingItem[], base?: ShoppingItem[]) =>
  saveReferenceDoc('shopping', { items }, 'family_shopping', base ? { items: base } : undefined);
export async function loadShopping(): Promise<ShoppingItem[]> {
  const data = await loadReferenceDoc<{ items: ShoppingItem[] }>('shopping', 'family_shopping');
  return data?.items || [];
}

// --- Recipe Book: one shared doc for the whole household, same shape as
// documents/shopping above. ---
export const saveRecipes = (recipes: Recipe[], base?: Recipe[]) =>
  saveReferenceDoc('recipes', { recipes }, 'family_recipes', base ? { recipes: base } : undefined);
export async function loadRecipes(): Promise<Recipe[]> {
  const data = await loadReferenceDoc<RecipeBookDoc>('recipes', 'family_recipes');
  return data?.recipes || [];
}

// Recipe photo (the original card/page): uploaded to Firebase Storage rather
// than embedded as base64, so a growing recipe collection never risks the
// 1MiB Firestore document cap the way a base64-per-recipe doc would.
// Takes EITHER a base64 data: URL (fresh attachment) or an https Storage
// download URL (a chat attachment that was already uploaded on send, which is
// what an Apply after a reload hands us). fetch() handles both; the previous
// atob(dataUrl.split(',')[1]) decoded an https URL to an EMPTY string and
// silently uploaded a zero-byte recipe photo.
export async function uploadRecipePhoto(dataUrl: string): Promise<string> {
  const id = Date.now().toString() + Math.floor(Math.random() * 1000);
  const blob = await (await fetch(dataUrl)).blob();
  const storagePath = `families/${FAMILY_ID}/recipe-photos/${id}.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  return await getDownloadURL(r);
}

// --- Anniversaries & Special Days: one shared doc for the whole household,
// same shape as recipes/documents/shopping above. No photo upload (unlike
// recipes) — these are dates + who they're about, not a scanned card. ---
export const saveAnniversaries = (anniversaries: AnniversaryRecord[], base?: AnniversaryRecord[]) =>
  saveReferenceDoc('anniversaries', { anniversaries }, 'family_anniversaries', base ? { anniversaries: base } : undefined);
export async function loadAnniversaries(): Promise<AnniversaryRecord[]> {
  const data = await loadReferenceDoc<AnniversariesDoc>('anniversaries', 'family_anniversaries');
  return data?.anniversaries || [];
}

// --- Extended Family & Friends' Birthdays: same shape/convention as
// Anniversaries above — one shared doc for the whole household. ---
export const saveExtendedBirthdays = (extendedBirthdays: ExtendedBirthday[], base?: ExtendedBirthday[]) =>
  saveReferenceDoc('extendedBirthdays', { extendedBirthdays }, 'family_extended_birthdays', base ? { extendedBirthdays: base } : undefined);
export async function loadExtendedBirthdays(): Promise<ExtendedBirthday[]> {
  const data = await loadReferenceDoc<ExtendedBirthdaysDoc>('extendedBirthdays', 'family_extended_birthdays');
  return data?.extendedBirthdays || [];
}

// --- Slips ("Keep the slip"): one shared doc for the whole household, same
// shape as recipes/documents/shopping above. Metadata only — the receipt
// photo itself lives in Storage (see uploadSlipPhoto), never inlined as
// base64, so a fast-accumulating pile of slips never risks the ~1MB
// Firestore document cap. ---
export const saveSlips = (slips: SlipItem[], base?: SlipItem[]) =>
  saveReferenceDoc('slips', { slips }, 'family_slips', base ? { slips: base } : undefined);
export async function loadSlips(): Promise<SlipItem[]> {
  const data = await loadReferenceDoc<SlipsDoc>('slips', 'family_slips');
  return data?.slips || [];
}

// Slip photo (the receipt/till slip itself): uploaded to Firebase Storage
// rather than embedded as base64 — mirrors uploadRecipePhoto's self-contained
// id (decoupled from the slip's own id, since the AI-chat path uploads the
// photo before a SlipItem id even exists) but also returns the storage path
// so a replaced/deleted slip can clean up its old file, like uploadTravelPhoto.
export async function uploadSlipPhoto(dataUrl: string): Promise<{ url: string; storagePath: string }> {
  const id = Date.now().toString() + Math.floor(Math.random() * 1000);
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const storagePath = `families/${FAMILY_ID}/slip-photos/${id}.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  const url = await getDownloadURL(r);
  return { url, storagePath };
}

export async function deleteSlipPhoto(storagePath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    console.error('Slip photo delete failed (entry will still be removed):', e);
  }
}

// --- User profile (users/{uid}) ---

export async function loadUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    return null;
  } catch (error) {
    console.error('Error loading user profile:', error);
    return null;
  }
}

// Narrowed to exactly the keys firestore.rules' self-update branch allows
// (users/{uid}'s hasOnly([...]) list) — familyId/role are NOT in it and can
// only ever be written server-side (Admin SDK). A caller passing them here
// would have the write silently denied by rules; narrowing the type instead
// of Partial<UserProfile> catches that at compile time (persistence audit,
// 2026-07 — dead code today, but the signature invited the mistake).
export async function saveUserProfile(
  uid: string,
  data: Partial<Pick<UserProfile, 'displayName' | 'email' | 'chatHistory' | 'aiConsent' | 'tourSeenAt' | 'interviewSeenAt' | 'interviewStep'>>,
): Promise<void> {
  await setDoc(doc(db, 'users', uid), data, { merge: true });
}

// --- Family management ---

/**
 * Create a brand-new family. Takes a human-readable name.
 * Uses auth.currentUser for uid/email/displayName.
 * Writes: families/{id}/info/info, families/{id}/roles/{uid}, users/{uid}.
 * Returns the new familyId.
 */
export async function createFamily(familyName: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to create a family');

  // Server-side: Firestore rules block clients from writing users/roles docs
  // (that's what stops strangers from granting themselves roles).
  const token = await user.getIdToken();
  const res = await fetch('/api/create-family', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: familyName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not create the family. Please try again.');

  await user.getIdToken(true); // pick up the new familyId custom claim for Storage
  setFamilyId(data.familyId);
  return data.familyId;
}

/**
 * Create a new BUSINESS (or other non-family) space — the caller becomes its
 * admin, and it becomes their active space. Mirrors createFamily exactly
 * (server-only writer, forced getIdToken(true) refresh) — a Business space is
 * the same families/{id}/* document tree as a Family space, just tagged with
 * a different `type`, so every existing view (Vehicles, Documents, Insurance,
 * Passwords, members-as-team) works inside it unmodified.
 */
export interface NewBusinessExtra {
  address?: string;
  registrationNumber?: string;
  industry?: string;
}

export async function createSpace(name: string, type: 'business' | 'personal' = 'business', extra?: NewBusinessExtra): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to create a space');

  const token = await user.getIdToken();
  const res = await fetch('/api/create-space', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: name.trim(), type, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not create the space. Please try again.');

  await user.getIdToken(true); // pick up the new familyId custom claim for Storage
  setFamilyId(data.spaceId);
  return data.spaceId;
}

// Best-effort prefill for the "create a business" form: asks the server to
// scan the caller's CURRENT space (chat history + family-member records) for
// an explicitly-mentioned business name/address/registration-or-VAT number/
// industry. Deliberately NEVER throws — every caller treats this as pure
// enhancement, so any failure (signed out, network, rate-limited, AI not
// configured, nothing found) just means "no suggestion", not an error the
// create-business flow has to handle.
export async function suggestBusinessInfo(): Promise<NewBusinessExtra & { name?: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    const res = await fetch('/api/suggest-business-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    if (!res.ok) return {};
    const data = await res.json().catch(() => ({}));
    return (data && typeof data.suggestion === 'object' && data.suggestion) || {};
  } catch {
    return {};
  }
}

// Reads the caller's ACTIVE space's AI usage this month — a GET to
// /api/ai-usage (server-computed, from families/{id}/usage/{YYYY-MM} +
// families/{id}/info/info.plan). Used ONLY for the honest usage indicator
// ("12 of 30 AI actions used this month") — never for enforcement, which
// happens server-side on every AI endpoint regardless of what this returns.
// Never throws: a failed/loading read just means the indicator doesn't show
// yet, same "pure enhancement" contract as suggestBusinessInfo above.
export async function loadAiUsage(): Promise<AiUsage | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    const res = await fetch('/api/ai-usage', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || typeof data.used !== 'number' || typeof data.limit !== 'number') return null;
    return { plan: data.plan === 'paid' ? 'paid' : 'free', used: data.used, limit: data.limit, resetsOn: String(data.resetsOn || '') };
  } catch {
    return null;
  }
}

// --- Babysitter / carer share links ---
export interface CarerShareSnapshot {
  children: { name: string; age?: string; allergies?: string; medications?: string; conditions?: string; doctor?: string; school?: string; notes?: string }[];
  contacts: { name: string; phone?: string; relation?: string }[];
  householdNote?: string;
}

export async function createCarerShare(snapshot: CarerShareSnapshot, hours: number): Promise<{ token: string; url: string; expiresAt: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first.');
  const token = await user.getIdToken();
  const res = await fetch('/api/carer-share/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ snapshot, hours }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not create the link. Please try again.');
  return { token: data.token, url: `${window.location.origin}${data.path}`, expiresAt: data.expiresAt };
}

export async function revokeCarerShare(shareToken: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first.');
  const token = await user.getIdToken();
  const res = await fetch('/api/carer-share/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: shareToken }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not turn off the link.');
  }
}

/**
 * Switch the caller's ACTIVE space to a different one they already belong to
 * (a family or business they're a member of — see SpaceMembership). Mirrors
 * createFamily/joinFamily exactly: the server is the ONLY writer of familyId/
 * role on users/{uid} (Firestore rules block clients from writing that), and
 * it verifies real membership via the authoritative families/{id}/roles/{uid}
 * doc — never trusts a client-supplied role. Throws with a human-readable
 * message on failure; on success the caller must reload (the whole app tree
 * reads FAMILY_ID/role from one active pointer, same as after create/join).
 */
export async function switchSpace(spaceId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to switch spaces');
  const trimmed = spaceId.trim();
  if (!trimmed) throw new Error('Missing space id');

  const token = await user.getIdToken();
  const res = await fetch('/api/switch-space', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ spaceId: trimmed }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not switch space. Please try again.');

  await user.getIdToken(true); // pick up the new familyId custom claim for Storage
  setFamilyId(data.familyId || trimmed);
}

/**
 * Rename the caller's ACTIVE space (families/{id}/info/info.name). Admin-only
 * server-side; also propagates the new name into every member's cached
 * users/{uid}.spaces[] entry so the space switcher shows it for everyone.
 */
export async function renameSpace(name: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to rename a space');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Missing name');

  const token = await user.getIdToken();
  const res = await fetch('/api/rename-space', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: trimmed }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not rename the space. Please try again.');
}

/**
 * Read the caller's ACTIVE space's info doc (families/{id}/info/info) directly
 * — name/type/address/registrationNumber/industry/foundingDate/milestoneNote.
 * Distinct from loadFamilyInfo() above, which reads families/{id}/reference/info
 * (the unrelated FamilyInfo numbers/contacts/providers doc — same "info" word,
 * different collection). Read-only: every writer of this doc is a server
 * endpoint (create-family/create-space/rename-space/set-founding-date/
 * business-milestone-note) going through the Admin SDK; firestore.rules only
 * needs to allow the read here (`allow read: if signedIn()` at info/{doc}).
 */
export async function loadSpaceInfo(): Promise<FamilyInfoDoc | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'info', 'info'));
    return snap.exists() ? (snap.data() as FamilyInfoDoc) : null;
  } catch (error) {
    console.error('Error loading space info:', error);
    return null;
  }
}

/**
 * Set the founding date on the caller's ACTIVE space (Business Milestones).
 * Admin-only and business-only, both re-verified server-side — mirrors
 * renameSpace's fetch/error-handling exactly.
 */
export async function saveFoundingDate(foundingDate: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to set a founding date');
  const trimmed = foundingDate.trim();
  if (!trimmed) throw new Error('Missing founding date');

  const token = await user.getIdToken();
  const res = await fetch('/api/set-founding-date', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ foundingDate: trimmed }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save the founding date. Please try again.');
}

/**
 * Set the family-level "don't suggest religious celebrations" switch
 * (families/{id}/info/info.suppressReligiousSuggestions). Admin-only,
 * re-verified server-side — mirrors saveFoundingDate exactly. Suggestion
 * surfaces (suggestLocal, the research endpoint) read this; celebrations the
 * family already confirmed are their own facts and are never touched by it.
 */
export async function saveSuppressReligiousSuggestions(suppress: boolean): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to change suggestion preferences');

  const token = await user.getIdToken();
  const res = await fetch('/api/set-suggestion-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ suppressReligiousSuggestions: suppress }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save the preference. Please try again.');
}

/**
 * PERMANENTLY delete the caller's ACTIVE space and everything in it — every
 * member, document/photo file, calendar event, and record. Server-side
 * (/api/delete-family) re-verifies admin status against the authoritative
 * roles doc and independently re-checks confirmName against the real family
 * name — this client call is a thin wrapper, not the actual safety check.
 * There is no undo. See server.js for the full authorization writeup.
 */
export async function deleteFamily(confirmName: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to delete a family');

  const token = await user.getIdToken();
  const res = await fetch('/api/delete-family', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirmName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not delete the family. Please try again.');
}

/**
 * Leave the caller's ACTIVE space — removes only their own access; every
 * other member's data is untouched. Server-side refuses if the caller is the
 * family's only admin (or its only member), so a family can never be left
 * unmanageable or orphaned.
 */
export async function leaveFamily(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to leave a family');

  const token = await user.getIdToken();
  const res = await fetch('/api/leave-family', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not leave the family. Please try again.');
}

// Ask the server to (re)stamp the familyId/familyIds custom claims, then
// refresh the local token so Storage rules see them. No-op if it fails — AI
// calls backfill too.
export async function ensureFamilyClaim(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const current = await user.getIdTokenResult();
    // Require BOTH claims, not just familyId: an account that already has the
    // legacy single claim but not the new familyIds array (i.e. every account
    // that existed before Business Hub shipped) would otherwise skip the
    // refresh forever and never pick up the array claim. This is the one
    // forced refresh that migrates already-signed-in sessions.
    if (current.claims.familyId && current.claims.familyIds) return;
    const res = await fetch('/api/refresh-claims', {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.token}` },
    });
    if (res.ok) await user.getIdToken(true);
  } catch (e) {
    console.warn('ensureFamilyClaim failed (non-fatal):', e);
  }
}

/**
 * Join an existing family by its familyId UUID code.
 * Throws with a human-readable message on failure.
 */
export async function joinFamily(familyId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to join a family');

  const trimmedId = familyId.trim();
  if (!trimmedId) throw new Error('Please enter a join code');

  // Use server-side join so admin SDK bypasses Firestore security rules.
  // Firestore client-side rules block non-members from writing roles docs.
  const token = await user.getIdToken();
  const res = await fetch('/api/join-family', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ familyId: trimmedId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not join family. Please try again.');

  await user.getIdToken(true); // pick up the new familyId custom claim for Storage
  setFamilyId(data.familyId || trimmedId);
}

// --- Family roles ---

/**
 * Load all members from families/{familyId}/roles collection.
 * Each document ID is the member's uid; document data is FamilyMemberRole.
 */
export async function loadFamilyRoles(familyId: string): Promise<Record<string, FamilyMemberRole>> {
  try {
    const rolesCol = collection(db, 'families', familyId, 'roles');
    const snap = await getDocs(rolesCol);
    const result: Record<string, FamilyMemberRole> = {};
    snap.forEach((d) => {
      result[d.id] = d.data() as FamilyMemberRole;
    });
    return result;
  } catch (error) {
    console.error('Error loading family roles:', error);
    return {};
  }
}

/**
 * Remove someone from the caller's ACTIVE space. Server-only (the Admin SDK
 * deletes the authoritative families/{id}/roles/{uid} doc, rewrites their
 * users/{uid} mirror and re-mints their custom claims) — Firestore rules block
 * clients from doing any of that. Admin-only and self-removal-proof, both
 * enforced server-side. Throws with a human-readable message on failure.
 */
export async function removeFamilyMember(targetUid: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in to remove a member');
  const trimmed = targetUid.trim();
  if (!trimmed) throw new Error('Missing member');

  const token = await user.getIdToken();
  const res = await fetch('/api/remove-member', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ uid: trimmed }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not remove that member. Please try again.');
}

/**
 * Update a family member's role in Firestore.
 * Callers must prevent admin self-demotion before calling this.
 */
export async function setFamilyMemberRole(
  familyId: string,
  targetUid: string,
  newRole: FamilyRole,
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', familyId, 'roles', targetUid), { role: newRole }, { merge: true });
  batch.set(doc(db, 'users', targetUid), { role: newRole }, { merge: true });
  await batch.commit();
}

// --- Chat history (stored per-space: families/{FAMILY_ID}/chat/{uid}) ---
// Scoped by FAMILY_ID — same convention as every other per-space collection
// above — so a login's AI conversation in the Family space and in any
// Business space(s) it also belongs to (Business Hub) never mix. This used
// to live at users/{uid}.chatHistory, the one data domain that broke the
// families/{FAMILY_ID}/... scoping pattern: because it was keyed only by
// uid, switching the active space (a full page reload) re-hydrated the SAME
// transcript regardless of which space was now active, leaking a previous
// space's conversation — including AI edit cards referencing that space's
// own members/documents — verbatim into the new one. Old unscoped data at
// users/{uid}.chatHistory is deliberately left orphaned, not migrated.
// Keep edits + applied so an already-applied card stays "Applied" after a reload
// or on a second device. images/sourceImages are Storage download URLs by the
// time this is called (AIChatbot.tsx's slimForCloud already stripped anything
// still a raw base64 data: URL) — small strings, safe to persist.
type StoredAttachment = { name: string; mimeType: string; dataUrl: string };
type StoredChatMessage = {
  role: string;
  text: string;
  edits?: unknown[];
  applied?: boolean;
  images?: string[];
  sourceImages?: StoredAttachment[];
  undo?: unknown[]; // undo manifest (ids of records an Apply created) — must survive cloud persist so "Undo" still works after a reload / on another device
};

export async function loadChatHistory(uid: string): Promise<StoredChatMessage[]> {
  try {
    const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'chat', uid));
    if (snap.exists()) {
      return (snap.data().messages as StoredChatMessage[]) || [];
    }
    return [];
  } catch (error) {
    console.error('Error loading chat history:', error);
    return [];
  }
}

export async function saveChatHistory(
  uid: string,
  messages: StoredChatMessage[],
): Promise<void> {
  const slim = messages.slice(-50).map(({ role, text, edits, applied, images, sourceImages, undo }) => {
    const m: StoredChatMessage = { role, text };
    if (edits) m.edits = edits;
    if (applied) m.applied = applied;
    if (images) m.images = images;
    if (sourceImages) m.sourceImages = sourceImages;
    if (undo) m.undo = undo;
    return m;
  });
  await setDoc(doc(db, 'families', FAMILY_ID, 'chat', uid), { messages: slim }, { merge: true });
}

// ── Assets ──
export async function loadAssets(): Promise<AssetItem[]> {
  const snap = await getDocs(collection(db, 'families', FAMILY_ID, 'assets'));
  const items = snap.docs.map(d => d.data() as AssetItem);
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveAsset(asset: AssetItem): Promise<boolean> {
  try {
    await setDoc(doc(db, 'families', FAMILY_ID, 'assets', asset.id), asset);
    return true;
  } catch (error) {
    console.error('Error saving asset:', error);
    return false;
  }
}

export async function deleteAsset(id: string): Promise<void> {
  await deleteDoc(doc(db, 'families', FAMILY_ID, 'assets', id));
}

// ── Secrets-vault encryption ──
// Round-trip secret values through the server, which holds the encryption key
// (Secret Manager). protectSecrets FAILS CLOSED (throws) so we never silently
// store plaintext; revealSecrets fails safe (returns input) so a blip never
// blocks reading. Legacy plaintext passes through untouched, then encrypts on
// its next save.
export async function protectSecrets(values: string[]): Promise<string[]> {
  const clean = values.map(v => v ?? '');
  if (clean.every(v => v === '')) return clean;
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const token = await user.getIdToken();
  const res = await fetch('/api/vault/protect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ values: clean }),
  });
  if (!res.ok) throw new Error("Couldn't secure the password — check your connection and try again.");
  const data = await res.json();
  if (!Array.isArray(data.values) || data.values.length !== clean.length) throw new Error("Couldn't secure the password.");
  return data.values;
}

export async function revealSecrets(values: string[]): Promise<string[]> {
  if (!values.length) return values;
  const user = auth.currentUser;
  if (!user) return values;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/vault/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) return values;
    const data = await res.json();
    return Array.isArray(data.values) && data.values.length === values.length ? data.values : values;
  } catch {
    return values;
  }
}

// Same round-trip as revealSecrets, but for SHARED family records (identity
// numbers, household codes, bank details) rather than personal credentials —
// see /api/vault/reveal-shared's comment for why that endpoint has no
// admin-only gate. Kept as a separate function (not a parameter) so call
// sites are unambiguous about which class of data they're touching.
export async function revealSharedSecrets(values: string[]): Promise<string[]> {
  if (!values.length) return values;
  const user = auth.currentUser;
  if (!user) return values;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/vault/reveal-shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) return values;
    const data = await res.json();
    return Array.isArray(data.values) && data.values.length === values.length ? data.values : values;
  } catch {
    return values;
  }
}

// ── Passwords ── (admin-only; rules deny reads to members/children)
export async function loadPasswords(): Promise<PasswordEntry[]> {
  try {
    const snap = await getDocs(collection(db, 'families', FAMILY_ID, 'passwords'));
    const entries = snap.docs.map(d => d.data() as PasswordEntry);
    const revealed = await revealSecrets(entries.map(e => e.password || ''));
    return entries
      .map((e, i) => ({ ...e, password: revealed[i] }))
      .sort((a, b) => a.service.localeCompare(b.service));
  } catch (e) {
    // A non-admin should never reach this view, but if they do, a permission
    // denial must not throw — just show an empty vault.
    console.warn('loadPasswords denied or failed:', e);
    return [];
  }
}

export async function savePassword(entry: PasswordEntry): Promise<void> {
  const [enc] = await protectSecrets([entry.password || '']);
  await setDoc(doc(db, 'families', FAMILY_ID, 'passwords', entry.id), { ...entry, password: enc });
}

export async function deletePassword(id: string): Promise<void> {
  await deleteDoc(doc(db, 'families', FAMILY_ID, 'passwords', id));
}

// ── Delete a document EVERYWHERE ──────────────────────────────────────────
// A document can exist in two stores that historically knew nothing about each
// other: the shared vault (families/{FAMILY_ID}/reference/documents) and the
// per-member copy on member.documents. Deleting from one screen only ever
// cleaned up that screen's store, so a scan the user deleted from a profile
// survived in the vault — and the AI's duplicate check (checkDocDuplicates in
// AIChatbot.tsx) reads THE VAULT, so re-adding a fresh copy was refused as a
// "duplicate" of a document the user was certain they had deleted. That is a
// trust bug, so both delete paths now go through this ONE function; keeping the
// logic in two places is exactly how the two stores drifted apart originally.

// Is this per-member document the same real-world file as this vault document?
// Ordered strongest-signal-first, and deliberately conservative: deletion is
// irreversible and spans two stores, so a false positive would destroy a
// document the user never asked to remove.
function linksToVaultDoc(memberDoc: FamilyDocument, vaultDoc: VaultDocument): boolean {
  // 1. Provenance: fileScans() in AIChatbot.tsx mints the member copy's id as
  //    'doc-' + the vault id, so this pair is certain when it matches.
  if (memberDoc.id === 'doc-' + vaultDoc.id) return true;
  // 2. The member copy points straight at the vault file's download URL
  //    (fileScans stores the URL, not base64, to keep the member doc small).
  if (memberDoc.fileData && memberDoc.fileData === vaultDoc.downloadUrl) return true;
  // 3. Identical bytes. Both hashes must be present — an absent hash is not a
  //    match, it's an unknown (documents saved before contentHash existed).
  if (memberDoc.contentHash && vaultDoc.contentHash && memberDoc.contentHash === vaultDoc.contentHash) return true;
  // 4. Last resort for that pre-contentHash legacy data only: same filename and
  //    same exact byte count. Never used when either side HAS a hash, because
  //    then a hash mismatch has already told us they are different files.
  if (!memberDoc.contentHash && !vaultDoc.contentHash
    && memberDoc.fileName && memberDoc.fileName === vaultDoc.fileName
    && memberDoc.fileSize === vaultDoc.fileSize) return true;
  return false;
}

export interface DeleteEverywhereResult {
  /** The members array with every matched copy stripped. Callers must persist it. */
  members: FamilyMember[];
  membersChanged: boolean;
  vaultRemoved: number;       // vault rows removed
  memberDocsRemoved: number;  // per-member copies removed (across all members)
  /** true when the vault metadata write failed — the file is gone locally but the cloud still lists it. */
  vaultSaveFailed: boolean;
  /** Human-readable notes for anything that could NOT be cleaned up, so a caller never fails silently. */
  notes: string[];
}

/**
 * Remove a document from the vault, from every member profile that holds a copy,
 * and from Firebase Storage — no matter which screen the delete was started on.
 * Pass whichever record the caller has (`vaultDoc` from the Document Vault,
 * `memberDoc` + `memberId` from a member's Documents tab); the counterpart in
 * the other store is found via linksToVaultDoc().
 *
 * A document that has no counterpart is normal, not an error — documents
 * uploaded in MemberDocuments.tsx are base64 on the member record and never
 * enter the vault at all. In that case we delete what we can and say so in
 * `notes`; the caller decides whether that is worth surfacing.
 */
export async function deleteDocumentEverywhere(opts: {
  vaultDoc?: VaultDocument;
  memberDoc?: FamilyDocument;
  memberId?: string;
  members: FamilyMember[];
}): Promise<DeleteEverywhereResult> {
  const { vaultDoc, memberDoc, memberId, members } = opts;
  const notes: string[] = [];

  let vault: VaultDocument[] = [];
  let vaultReadable = true;
  try {
    vault = await loadDocuments();
  } catch (e) {
    // A vault we cannot read is a vault we must not rewrite — saving here would
    // persist an empty list over everyone's documents.
    vaultReadable = false;
    console.error('Vault read failed during delete (member copy will still be removed):', e);
    notes.push("Couldn't reach the shared vault — its copy may still be there.");
  }

  const vaultTargets = vault.filter(v =>
    (vaultDoc && v.id === vaultDoc.id) || (memberDoc ? linksToVaultDoc(memberDoc, v) : false),
  );
  if (vaultReadable && vaultDoc && !vaultTargets.some(v => v.id === vaultDoc.id)) {
    // The row was already gone from the stored list (another device deleted it,
    // or this view is stale) — still delete its Storage object below.
    notes.push('That vault entry had already been removed.');
  }

  // Best-effort Storage cleanup. deleteVaultFile already swallows its own
  // errors on purpose: a missing or permission-denied object must never block
  // removing the metadata, otherwise the user is stuck with an undeletable row.
  const storagePaths = new Set<string>(vaultTargets.map(v => v.storagePath).filter(Boolean));
  if (vaultDoc?.storagePath) storagePaths.add(vaultDoc.storagePath);
  for (const path of storagePaths) await deleteVaultFile(path);

  // Match member copies against whatever we know about the vault side. When the
  // vault row is already gone (or unreadable) fall back to the caller's own copy
  // of it, so a stale list can't strand the member copies.
  const matchAgainst: VaultDocument[] = vaultTargets.length ? vaultTargets : (vaultDoc ? [vaultDoc] : []);
  let memberDocsRemoved = 0;
  const nextMembers = members.map(m => {
    const docs = m.documents || [];
    const keep = docs.filter(d => {
      const isTheClickedOne = !!memberDoc && m.id === memberId && d.id === memberDoc.id;
      // Strip the copy from EVERY member, not just the one being viewed: the
      // underlying Storage object is gone now, so any other profile holding it
      // would be left pointing at a broken file.
      const isCounterpart = matchAgainst.some(v => linksToVaultDoc(d, v));
      return !(isTheClickedOne || isCounterpart);
    });
    if (keep.length !== docs.length) {
      memberDocsRemoved += docs.length - keep.length;
      return { ...m, documents: keep };
    }
    return m;
  });

  let vaultSaveFailed = false;
  if (vaultTargets.length) {
    const removedIds = new Set(vaultTargets.map(v => v.id));
    const ok = await saveDocuments(vault.filter(v => !removedIds.has(v.id)));
    if (!ok) {
      vaultSaveFailed = true;
      notes.push("Removed here, but the shared vault couldn't be updated in the cloud.");
    }
  } else if (memberDoc && vaultReadable) {
    notes.push('No copy of this document was found in the shared vault.');
  }

  return {
    members: nextMembers,
    membersChanged: memberDocsRemoved > 0,
    vaultRemoved: vaultTargets.length,
    memberDocsRemoved,
    vaultSaveFailed,
    notes,
  };
}

// Same upload as uploadChatAttachment above, but ALSO returns the storage path.
// Filing a scanned document used to depend on the chat message still holding a
// usable image at Apply time — a chain (optimistic render -> upload -> setMessages
// patch -> localStorage -> Firestore -> reload -> 50-message truncation) where any
// broken link lost the ability to file at all. The path lets the caller stamp a
// permanent Storage reference onto the document EDIT itself, so Apply needs
// nothing from chat history. Kept as a separate export rather than changing
// uploadChatAttachment's return type, so existing callers are untouched.
export async function uploadChatAttachmentWithPath(
  dataUrl: string, mimeType: string, uid: string,
): Promise<{ url: string; storagePath: string }> {
  const blob = await (await fetch(dataUrl)).blob();
  const storagePath = `families/${FAMILY_ID}/chat-attachments/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: mimeType || blob.type || 'application/octet-stream' });
  const url = await getDownloadURL(r);
  return { url, storagePath };
}

// --- Web Push subscriptions -------------------------------------------------
// These are thin authed-fetch wrappers, NOT direct Firestore writes. The server
// (see /api/push/subscribe + /api/push/unsubscribe in server.js) does the actual
// write to families/{FAMILY_ID}/pushSubscriptions/{sha256(endpoint)} via
// firebase-admin. Doing it server-side means the new pushSubscriptions
// collection is never touched by the client SDK, so firestore.rules needs no
// change, and the endpoint is keyed by a stable hash of the endpoint URL so
// re-subscribing the same device overwrites rather than duplicates.
//
// (Most subscribe/unsubscribe callers use utils/pushClient.ts directly, which
// owns the pushManager dance; these exports mirror the module's fetch style for
// any caller that already holds a PushSubscription and just needs the persist.)

/** Persist a raw PushSubscription for the current device (server writes it). */
export async function savePushSubscription(sub: PushSubscriptionJSON): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  const token = await user.getIdToken();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: sub }),
  });
  return res.ok;
}

/** Delete this device's stored subscription, keyed by its endpoint URL. */
export async function deletePushSubscription(endpoint: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  const token = await user.getIdToken();
  const res = await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint }),
  });
  return res.ok;
}
