import { readCalendarBaselines, storeCalendarBaseline } from './calendarBaselines';
import { FamilyMember, CalendarEvent, FamilyInfo, HouseholdInfo, FinancesInfo, FamilyTimeline, VaultDocument, HubSettings, ShoppingItem, FamilyRole, FamilyMemberRole, UserProfile, FamilyInfoDoc, AssetItem, PasswordEntry, FamilyWordsDoc, Recipe, RecipeBookDoc, TravelTimelineDoc, InMemoryDoc, WillsEstateDoc, SlipItem, SlipsDoc, FamilyDocument, BusinessMilestonesDoc, AiUsage, AnniversaryRecord, AnniversariesDoc, ExtendedBirthday, ExtendedBirthdaysDoc, KinLink, FamilyTreeDoc, WillsAccessDoc, PendingWillReader, HiddenDatePerson, PersonalPrefsDoc, FamilyActionsDoc } from '../types';
import { db, auth, storage } from '../lib/firebase';
import { doc, getDoc, getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, writeBatch, runTransaction, onSnapshot, arrayRemove } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject, fetchFileBlob } from './storageClient';
import { calendarWriteBatches, canAdoptCalendarRead, evictGoogleMergeBases, mergeCalendarWrite, reconcileCalendarIndex, withCalendarWriteLock, type CalendarSaveOptions } from './calendarPersistence';
import { mergeShared, mergeIdList, deepEqual } from './mergeShared';
import { filePathFromReference, newProfileFileBindings, normalizeFileReferences } from './fileReferences';
import { setVaultAccessScope, reportVaultAccessIssue } from './vaultAccess';
import {
  isLoggableKind, visibilityFor, visibilitiesFor, orderActivity, shouldLog,
  DEDUPE_WINDOW_MS, type ActivityEntry,
} from './activity';
import { readGoogleRemovals, rememberGoogleRemovals, acknowledgeGoogleRemovals, markDirty, clearDirty, isDirty } from './pendingSync';
import {
  protectIdentity, revealIdentity, protectPassports, revealPassports,
  protectVisas, revealVisas, protectIdentifiers, revealIdentifiers,
  protectFinancialAccounts, revealFinancialAccounts,
  protectHousehold, revealHousehold, protectFinances, revealFinances, setSharedRevealEnabled,
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
  setVaultAccessScope(id, auth.currentUser?.uid || null);
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
async function revealMemberSensitive(raw: FamilyMember, spaceId = FAMILY_ID): Promise<FamilyMember> {
  const reveal = (values: string[]) => revealSharedSecrets(values, spaceId);
  raw = normalizeFileReferences(raw);
  return {
    ...raw,
    identity: await revealIdentity(raw.identity, reveal),
    passports: await revealPassports(raw.passports, reveal),
    travel: raw.travel
      ? { ...raw.travel, visas: await revealVisas(raw.travel.visas, reveal) }
      : raw.travel,
    identifiers: await revealIdentifiers(raw.identifiers, reveal),
    financialAccounts: await revealFinancialAccounts(raw.financialAccounts, reveal),
  };
}

async function protectMemberSensitive(merged: FamilyMember, spaceId = FAMILY_ID): Promise<FamilyMember> {
  const protect = (values: string[]) => protectSharedSecrets(values, spaceId);
  merged = normalizeFileReferences(merged);
  return {
    ...merged,
    identity: await protectIdentity(merged.identity, protect),
    passports: await protectPassports(merged.passports, protect),
    travel: merged.travel
      ? { ...merged.travel, visas: await protectVisas(merged.travel.visas, protect) }
      : merged.travel,
    identifiers: await protectIdentifiers(merged.identifiers, protect),
    financialAccounts: await protectFinancialAccounts(merged.financialAccounts, protect),
  };
}

export async function saveFamilyMembers(members: FamilyMember[]): Promise<boolean> {
  members = normalizeFileReferences(members);
  const user = auth.currentUser;
  const spaceAtStart = FAMILY_ID;
  const localKey = membersKey();
  const current = () => FAMILY_ID === spaceAtStart && auth.currentUser?.uid === user?.uid;
  const localIds = members.map(m => m.id).filter(Boolean);
  const targets = members.filter(m => m.id);
  const memberBases = new Map(targets.map(m => [m.id, getSeen<FamilyMember>(memberSeenKey(m.id))]));
  const indexBase = getSeen<string[]>(MEMBER_IDS_KEY);
  let cloudOk = false;

  if (user) {
    try {
      if (accountRole === 'admin') {
        const bindings = newProfileFileBindings(members, id => memberBases.get(id), spaceAtStart);
        if (bindings.length) {
          const token = await user.getIdToken();
          for (let index = 0; index < bindings.length; index += 400) {
            if (FAMILY_ID !== spaceAtStart || auth.currentUser?.uid !== user.uid) throw new Error('Your space changed. Please save the profile again.');
            const response = await fetch('/api/files/bind-profile', {
              method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ spaceId: spaceAtStart, bindings: bindings.slice(index, index + 400) }),
            });
            if (!response.ok) throw new Error('Could not protect the new profile files. Please try saving again.');
          }
          if (FAMILY_ID !== spaceAtStart || auth.currentUser?.uid !== user.uid) throw new Error('Your space changed. Please save the profile again.');
        }
      }
      if (!current()) throw new Error('Your account or space changed. Please save again.');
      const metaRef = doc(db, 'families', spaceAtStart, 'metadata', 'members');
      const memberRefs = targets.map(m => doc(db, 'families', spaceAtStart, 'family_members', m.id));

      let written: { name: string; isNew: boolean }[] = [];
      const { mergedIds, mergedMembers } = await runTransaction(db, async (tx) => {
        // ALL reads before ANY write — the metadata index and every member
        // doc being touched, read together up front.
        const metaSnap = await tx.get(metaRef);
        const memberSnaps = await Promise.all(memberRefs.map(r => tx.get(r)));

        const serverIds = (metaSnap.exists() ? (metaSnap.data().ids as string[]) : undefined) || [];
        const ids = mergeIdList(indexBase, localIds, serverIds);

        // Decrypt every server copy up front (concurrently, not one member
        // after another — same concurrency style the old encrypt-before-write
        // here used to have).
        const servers = await Promise.all(memberSnaps.map(async (snap) => {
          if (!snap.exists()) return undefined;
          return revealMemberSensitive(snap.data() as FamilyMember, spaceAtStart);
        }));

        if (!current()) throw new Error('Your account or space changed. Please save again.');
        const mergedMembers = targets.map((local, i) =>
          mergeShared<FamilyMember>(memberBases.get(local.id), local, servers[i]));

        // Only re-encrypt + write docs that actually changed vs. the server's
        // (decrypted) copy — a member nobody touched costs nothing here.
        const toWrite = mergedMembers
          .map((merged, i) => ({ merged, ref: memberRefs[i], server: servers[i] }))
          .filter(({ merged, server }) => server === undefined || !deepEqual(merged, server));
        // Reported out of the transaction, never logged inside it — a retry
        // would otherwise write the same trail entries twice.
        written = toWrite.map(({ merged, server }) => ({
          name: String((merged as FamilyMember).name || 'Someone'),
          isNew: server === undefined,
        }));
        const protectedWrites = await Promise.all(toWrite.map(async ({ merged, ref }) => ({
          ref,
          value: await protectMemberSensitive(merged, spaceAtStart),
        })));
        if (!current()) throw new Error('Your account or space changed. Please save again.');
        for (const { ref, value } of protectedWrites) tx.set(ref, value as any);

        tx.set(metaRef, { ids });
        return { mergedIds: ids, mergedMembers };
      });

      if (current()) {
      noteSeen(MEMBER_IDS_KEY, mergedIds);
      for (const m of mergedMembers) noteSeen(memberSeenKey(m.id), m);
      /* `written` comes from the same filter tx.set() used, so a save that
       * touched nobody logs nothing — and a save that touched three people
       * logs three lines, named, rather than one anonymous "profiles updated".
       * First name only: the trail is read by children, and in a business
       * space a members entry is admin-tier anyway (see visibilityFor). */
      for (const w of written) {
        recordActivity('members', w.isNew ? 'added' : 'updated', w.name.split(/\s+/)[0] || w.name);
      }
      }
      cloudOk = true;
    } catch (error) {
      console.error('Error saving to Firestore:', error);
    }
  }

  if (auth.currentUser?.uid !== user?.uid) return cloudOk;
  // Always keep the original space cache updated for fast loading
  try {
    localStorage.setItem(localKey, JSON.stringify(members));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }

  // See pendingSync.ts: a write that didn't reach Firestore must not be
  // silently discarded the next time this device successfully LOADS members
  // (loadFamilyMembers checks this before it would overwrite localStorage).
  if (cloudOk) clearDirty('members', spaceAtStart); else markDirty('members', spaceAtStart);

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
    const parsed = normalizeFileReferences(JSON.parse(raw));
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
            const pending = normalizeFileReferences(JSON.parse(pendingRaw)) as FamilyMember[];
            if (Array.isArray(pending)) {
              const backedUp = await saveFamilyMembers(pending);
              if (!backedUp) return pending.length > 0 ? pending : null;
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
        /* allSettled, NOT all — one refused document must not blank the app.
         *
         * In a BUSINESS space firestore.rules only lets an employee read their
         * own record (a colleague's is an HR file, not a profile). The index at
         * metadata/members still lists everybody, because the index is not
         * secret and the roster has to work; so an employee's load asks for
         * documents it will be refused. Promise.all rejects on the first of
         * those and takes the entire member list with it — every screen in the
         * app empty, for a permission boundary working exactly as designed.
         *
         * A refusal here is an ordinary outcome, not an error. What comes back
         * is what this account may see. */
        const membersReqs = ids.map(id => getDoc(doc(db, 'families', FAMILY_ID, 'family_members', id)));
        const settled = await Promise.allSettled(membersReqs);
        const refused = settled.filter(r => r.status === 'rejected').length;
        if (refused) {
          console.info(`[members] ${refused} of ${ids.length} records are not readable by this account`);
        }
        const rawMembers = settled
          .flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
          .map(s => s.data() as FamilyMember)
          .filter(Boolean);

        // Decrypt ID numbers/passport/visa numbers (see revealMemberSensitive
        // above). The underlying reveal* calls use a local ciphertext cache
        // internally, so a value seen once stays readable offline (see
        // vaultFields.ts) — this is what keeps a screen like Emergency
        // essentials usable without signal after first sync.
        const members = await Promise.all(rawMembers.map(member => revealMemberSensitive(member)));

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
          const localMembers = normalizeFileReferences(JSON.parse(local)) as FamilyMember[];
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
      return normalizeFileReferences(JSON.parse(local));
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

// Imported source records can be re-read authoritatively. Keeping a second copy
// of thousands of recurring instances exhausts localStorage and blocks the cache.
function cacheCalendarEvents(key: string, events: CalendarEvent[]): void {
  const prefix = `family_mergeBase_${auth.currentUser?.uid || 'anon'}_${FAMILY_ID}::event:gcal-`;
  for (const storedKey of Object.keys(localStorage)) {
    if (!storedKey.startsWith(prefix)) continue;
    try {
      const value = normalizeFileReferences(JSON.parse(localStorage.getItem(storedKey)!));
      const key = storedKey.slice(`family_mergeBase_${auth.currentUser?.uid || 'anon'}_`.length);
      if (!lastSeen.has(key)) lastSeen.set(key, value);
      void storeCalendarBaseline(storedKey, value);
    } catch { /* corrupt redundant baseline */ }
  }
  evictGoogleMergeBases(localStorage, auth.currentUser?.uid || 'anon', FAMILY_ID);
  localStorage.setItem(key, JSON.stringify(events));
}

let calendarBackupError: string | null = null;
export function getCalendarBackupError(): string | null { return calendarBackupError; }

export async function saveCalendarEvents(events: CalendarEvent[], options: CalendarSaveOptions = {}): Promise<boolean> {
  events = normalizeFileReferences(events);
  const user = auth.currentUser;
  const spaceAtStart = FAMILY_ID;
  const localKey = calendarKey();
  const removedGoogleIds = rememberGoogleRemovals(spaceAtStart, options.removedGoogleIds || []);
  // Preserve intent before any awaited network call, including when the tab closes.
  try { cacheCalendarEvents(localKey, events); } catch (error) { console.error('Local calendar save failed', error); }
  markDirty('calendar', spaceAtStart);
  calendarBackupError = null;
  let cloudOk = false;
  const localIds = events.map(e => e.id).filter(Boolean);
  const targets = events.filter(e => e.id);
  const bases = new Map(targets.flatMap(e => { const base = getSeen<CalendarEvent>(eventSeenKey(e.id)); return base ? [[e.id, base] as const] : []; }));
  const indexBase = getSeen<string[]>(EVENT_IDS_KEY);

  await withCalendarWriteLock(spaceAtStart, async () => {
  if (user && auth.currentUser?.uid === user.uid) {
    try {
      const metaRef = doc(db, 'families', spaceAtStart, 'metadata', 'events');

      // A single edit must not fan out into thousands of reads of unchanged
      // recurring instances. Bound each transaction, then publish its index.

      let eventsWritten = 0;
      for (const chunk of calendarWriteBatches(targets, bases)) {
        const refs = chunk.map(e => doc(db, 'families', spaceAtStart, 'calendar_events', e.id));
        const merged = await runTransaction(db, async tx => {
          const snaps = [];
          for (let i = 0; i < refs.length; i += 10) snaps.push(...await Promise.all(refs.slice(i, i + 10).map(r => tx.get(r))));
          const values = chunk.map((local, i) => mergeCalendarWrite(local, bases.get(local.id) || (FAMILY_ID === spaceAtStart ? getSeen<CalendarEvent>(eventSeenKey(local.id)) : undefined), snaps[i].exists() ? normalizeFileReferences(snaps[i].data() as CalendarEvent) : undefined));
          values.forEach((value, i) => { if (!snaps[i].exists() || !deepEqual(value, snaps[i].data())) tx.set(refs[i], value); });
          return values;
        });
        if (FAMILY_ID === spaceAtStart) for (const event of merged) noteSeen(eventSeenKey(event.id), event);
        eventsWritten += merged.length;
      }
      const mergedIds = await runTransaction(db, async tx => {
        const snap = await tx.get(metaRef);
        const serverIds = snap.exists() ? (snap.data().ids as string[]) || [] : [];
        const ids = reconcileCalendarIndex(indexBase, localIds, serverIds, removedGoogleIds);
        tx.set(metaRef, { ids });
        return ids;
      });
      if (FAMILY_ID === spaceAtStart) noteSeen(EVENT_IDS_KEY, mergedIds);
      /* One line for the sitting, not one per event. A calendar save routinely
       * carries the whole list, and a sync that touched six events is still one
       * thing the person did. Counted inside the transaction and reset on each
       * attempt, so a retry does not accumulate. */
      if (eventsWritten > 0) recordActivity('calendar', 'updated');
      cloudOk = true;
    } catch (error) {
      calendarBackupError = (error as { code?: string }).code === 'unavailable' ? 'The family cloud is unavailable. Keep your local data and retry when the connection recovers.' : error instanceof Error ? error.message : 'Calendar cloud backup failed.';
      console.error('Error saving to Firestore:', error);
    }
  }

  });

  try {
    if (cloudOk && localStorage.getItem(localKey) === JSON.stringify(events)) {
      acknowledgeGoogleRemovals(spaceAtStart, removedGoogleIds);
      if (!readGoogleRemovals(spaceAtStart).length) clearDirty('calendar', spaceAtStart);
      else return false;
    }
    else if (cloudOk) return false; // a newer local edit is still pending
  } catch { /* pending stays if storage is unavailable */ }
  return cloudOk;
}

/** Family profile changes are also shared live; encrypted fields are revealed before painting. */
export function subscribeFamilyMembers(cb: (members: FamilyMember[]) => void, onError: (error: unknown) => void): () => void {
  const space = FAMILY_ID;
  let ids: string[] | undefined;
  let records: Map<string, FamilyMember> | undefined;
  let sequence = 0;
  let stopped = false;
  const apply = async () => {
    const mine = ++sequence;
    if (space !== FAMILY_ID || !ids || !records || isDirty('members', space) || !ids.every(id => records!.has(id))) return;
    const idSnapshot = [...ids];
    const members = await Promise.all(idSnapshot.map(id => revealMemberSensitive(records!.get(id)!)));
    if (stopped || mine !== sequence || space !== FAMILY_ID || isDirty('members', space)) return;
    noteSeen(MEMBER_IDS_KEY, idSnapshot);
    for (const member of members) noteSeen(memberSeenKey(member.id), member);
    try { localStorage.setItem(membersKey(), JSON.stringify(members)); } catch { /* best effort */ }
    cb(members);
  };
  const changed = () => { void apply().catch(onError); };
  const stopMembers = onSnapshot(collection(db, 'families', space, 'family_members'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
    records = new Map(snapshot.docs.map(s => [s.id, normalizeFileReferences(s.data() as FamilyMember)])); changed();
  }, onError);
  const stopIds = onSnapshot(doc(db, 'families', space, 'metadata', 'members'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
    ids = snapshot.exists() ? snapshot.data().ids || [] : []; changed();
  }, onError);
  return () => { stopped = true; stopMembers(); stopIds(); };
}

/** Calendar updates from other devices. Never replace pending local edits. */
export function subscribeCalendarEvents(cb: (events: CalendarEvent[]) => void, onError: (error: unknown) => void): () => void {
  const space = FAMILY_ID;
  let ids: string[] | undefined;
  let records: Map<string, CalendarEvent> | undefined;
  const apply = () => {
    if (space !== FAMILY_ID || !ids || !records || isDirty('calendar', space) || !ids.every(id => records!.has(id))) return;
    const events = ids.map(id => records!.get(id)!);
    noteSeen(EVENT_IDS_KEY, ids);
    for (const event of events) noteSeen(eventSeenKey(event.id), event);
    try { cacheCalendarEvents(calendarKey(), events); } catch { /* best effort */ }
    cb(events);
  };
  const stopEvents = onSnapshot(collection(db, 'families', space, 'calendar_events'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
    records = new Map(snapshot.docs.map(s => [s.id, normalizeFileReferences(s.data() as CalendarEvent)])); apply();
  }, onError);
  const stopIds = onSnapshot(doc(db, 'families', space, 'metadata', 'events'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
    ids = snapshot.exists() ? snapshot.data().ids || [] : []; apply();
  }, onError);
  return () => { stopEvents(); stopIds(); };
}

export function readCachedCalendarEvents(): CalendarEvent[] | null {
  try { const raw = localStorage.getItem(calendarKey()); const events = raw ? normalizeFileReferences(JSON.parse(raw)) : null; return Array.isArray(events) ? events : null; } catch { return null; }
}

export async function loadCalendarEvents(): Promise<CalendarEvent[] | null> {
  const user = auth.currentUser;
  const spaceAtStart = FAMILY_ID;
  const localKey = calendarKey();

  if (user) {
    const prefix = `family_mergeBase_${user.uid}_${spaceAtStart}::event:gcal-`;
    for (const [storedKey, value] of await readCalendarBaselines(prefix)) {
      if (FAMILY_ID !== spaceAtStart || auth.currentUser?.uid !== user.uid) return readCachedCalendarEvents();
      const key = storedKey.slice(`family_mergeBase_${user.uid}_`.length);
      if (!lastSeen.has(key)) lastSeen.set(key, value);
    }
    try {
      // See loadFamilyMembers above for why this guard exists.
      if (isDirty('calendar', FAMILY_ID)) {
        const pendingRaw = localStorage.getItem(calendarKey());
        if (pendingRaw) {
          try {
            const pending = normalizeFileReferences(JSON.parse(pendingRaw)) as CalendarEvent[];
            if (Array.isArray(pending)) {
              const backedUp = await saveCalendarEvents(pending);
              if (!backedUp) return readCachedCalendarEvents() || pending;
            }
          } catch { /* corrupt local cache — fall through to a normal load */ }
        }
        // saveCalendarEvents owns acknowledgment; a newer edit may have arrived.
        if (isDirty('calendar', spaceAtStart)) return readCachedCalendarEvents();
      }

      const cacheAtReadStart = localStorage.getItem(localKey);
      const canAdoptRead = () => canAdoptCalendarRead(
        { space: spaceAtStart, uid: user.uid, cache: cacheAtReadStart },
        { space: FAMILY_ID, uid: auth.currentUser?.uid, dirty: isDirty('calendar', spaceAtStart), cache: localStorage.getItem(localKey) });
      const metaRef = doc(db, 'families', spaceAtStart, 'metadata', 'events');
      const metaSnap = await getDocFromServer(metaRef);

      if (metaSnap.exists()) {
        const ids = metaSnap.data().ids as string[];
        const snapshot = await getDocsFromServer(collection(db, 'families', spaceAtStart, 'calendar_events'));
        const wanted = new Set(ids);
        const events = snapshot.docs.filter(s => wanted.has(s.id)).map(s => normalizeFileReferences(s.data() as CalendarEvent));

        // A cloud read begun before a local save must never restore its older cache.
        if (!canAdoptRead()) return readCachedCalendarEvents();
        calendarBackupError = null;
        noteSeen(EVENT_IDS_KEY, ids);
        // Merge base for the next per-event write (see saveCalendarEvents).
        for (const e of events) noteSeen(eventSeenKey(e.id), e);

        cacheCalendarEvents(calendarKey(), events);
        return events.length > 0 ? events : null;
      }

      // Shared vault empty: migrate this device's local events up — ONLY ONCE
      // per space, ever (see the members loader above for why: without the
      // flag, a deliberate server-side delete gets silently undone on the
      // next load from a stale local cache).
      if (!canAdoptRead()) return readCachedCalendarEvents();
      const migratedKey = migratedFlagKey('events');
      if (!localStorage.getItem(migratedKey)) {
        const local = localStorage.getItem(calendarKey());
        if (local) {
          const localEvents = normalizeFileReferences(JSON.parse(local)) as CalendarEvent[];
          if (Array.isArray(localEvents) && localEvents.length > 0) {
            await saveCalendarEvents(localEvents);
            localStorage.setItem(migratedKey, '1');
            return localEvents;
          }
        }
        localStorage.setItem(migratedKey, '1');
      }
    } catch (error) {
      calendarBackupError = 'Could not verify the latest family calendar with the cloud. Your local copy is preserved; retry when connected.';
      console.error('Error loading events from Firestore:', error);
    }
  }

  const local = localStorage.getItem(calendarKey());
  if (local) {
    try {
      return normalizeFileReferences(JSON.parse(local));
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
  lastSeen.set(seenKey(key), normalizeFileReferences(value));
  if (auth.currentUser && key.startsWith('event:gcal-')) {
    void storeCalendarBaseline(`family_mergeBase_${auth.currentUser.uid}_${seenKey(key)}`, value);
  }
  if (auth.currentUser && !key.startsWith('event:gcal-')) {
    try { localStorage.setItem(`family_mergeBase_${auth.currentUser?.uid || 'anon'}_${seenKey(key)}`, JSON.stringify(value)); } catch { /* best effort */ }
  }
}

function getSeen<T>(key: string): T | undefined {
  if (lastSeen.has(seenKey(key))) return lastSeen.get(seenKey(key)) as T;
  if (auth.currentUser) {
    try { const raw = localStorage.getItem(`family_mergeBase_${auth.currentUser?.uid || 'anon'}_${seenKey(key)}`); if (raw) return normalizeFileReferences(JSON.parse(raw)) as T; } catch { /* no persisted baseline */ }
  }
  return undefined;
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
  const spaceAtStart = FAMILY_ID;
  const current = () => FAMILY_ID === spaceAtStart && auth.currentUser?.uid === user?.uid;
  let cloudOk = false;
  // What actually ends up stored — the merge may legitimately differ from
  // `value` (it can carry another device's items), and the local cache must
  // hold the merged truth, not this device's half of it.
  value = normalizeFileReferences(value);
  if (base !== undefined) base = normalizeFileReferences(base);
  let persisted: T = value;

  if (user) {
    const mergeBase = base !== undefined ? base : getSeen<T>(key);
    try {
      const docRef = doc(db, 'families', spaceAtStart, 'reference', key);
      /* Set inside the transaction, read after it. A transaction can RETRY —
       * writing the trail entry in there would log the same change twice on a
       * contended save, which is the one thing a "what changed" list must not
       * do. So the transaction only reports, and the entry is written once,
       * below, on the value that actually landed. */
      let existed = false;
      let changed = true;
      persisted = await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!current()) throw new Error('Your account or space changed. Please save again.');
        const serverRaw = snap.exists() ? normalizeFileReferences(snap.data() as T) : undefined;
        const server = serverRaw !== undefined ? await reveal(serverRaw) : undefined;
        if (!current()) throw new Error('Your account or space changed. Please save again.');
        const merged = mergeShared<T>(mergeBase, value, server);
        existed = server !== undefined;
        changed = server === undefined || !deepEqual(merged as unknown, server as unknown);
        const secured = await protect(merged);
        if (!current()) throw new Error('Your account or space changed. Please save again.');
        tx.set(docRef, secured as any);
        return merged;
      });
      cloudOk = true;
      if (current()) noteSeen(key, persisted);
      /* A save that merged to exactly what was already there is not news. This
       * matters more than it looks: several screens save on mount to migrate a
       * shape, and a trail that recorded those would report a household
       * editing itself every morning. */
      if (changed && current()) recordActivity(key, existed ? 'updated' : 'added');
    } catch (error) {
      console.error(`Error saving ${key}:`, error);
      persisted = value;
    }
  }

  if (auth.currentUser?.uid !== user?.uid) return cloudOk;
  try {
    localStorage.setItem(`${localKey}_${spaceAtStart}`, JSON.stringify(persisted));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }

  // See pendingSync.ts / saveFamilyMembers above for why this exists.
  if (cloudOk) clearDirty(key, spaceAtStart); else markDirty(key, spaceAtStart);

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
            const pending = normalizeFileReferences(JSON.parse(pendingRaw)) as T;   // plaintext — local cache always is
            const backedUp = await saveReferenceDoc(key, pending, localKey, undefined, protect, reveal);
            if (!backedUp) return pending;
          } catch { /* corrupt local cache — fall through to a normal load */ }
        }
        clearDirty(key, FAMILY_ID);
      }

      const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'reference', key));
      if (snap.exists()) {
        const data = normalizeFileReferences(await reveal(snap.data() as T));
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
      const parsed = normalizeFileReferences(JSON.parse(local)) as T;   // plaintext — local cache always is
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
  actions:        { key: 'actions',        localKey: 'family_actions' },
  recipes:        { key: 'recipes',        localKey: 'family_recipes' },
  slips:          { key: 'slips',          localKey: 'family_slips' },
  anniversaries:  { key: 'anniversaries',  localKey: 'family_anniversaries' },
  extendedBirthdays: { key: 'extendedBirthdays', localKey: 'family_extended_birthdays' },
} as const satisfies Record<string, SharedDocMeta>;

/** Dirty markers survive reloads. Only a confirmed write clears one. */
export function pendingCloudBackupKeys(): string[] {
  const keys = ['members', 'calendar', ...Object.values(SHARED_DOCS).map(d => d.key), 'familyTree', 'businessMilestones', 'assets', 'passwords'];
  return keys.filter(key => isDirty(key, FAMILY_ID));
}

export async function retryPendingCloudBackups(): Promise<string[]> {
  if (!auth.currentUser) return pendingCloudBackupKeys();
  const space = FAMILY_ID;
  if (isDirty('members', space)) await loadFamilyMembers();
  if (space !== FAMILY_ID) return pendingCloudBackupKeys();
  if (isDirty('calendar', space)) await loadCalendarEvents();
  for (const entry of Object.values(SHARED_DOCS)) {
    if (space !== FAMILY_ID) break;
    if (!isDirty(entry.key, space)) continue;
    // The normal loaders preserve encryption and existing merge semantics.
    if (entry.key === 'household') await loadHousehold();
    else if (entry.key === 'finances') await loadFinances();
    else await loadReferenceDoc(entry.key, entry.localKey);
  }
  return pendingCloudBackupKeys();
}

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
      const raw = snap.exists() ? normalizeFileReferences(snap.data() as T) : null;
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
    (v) => protectHousehold(v, protectSharedSecrets).then(r => r ?? v),
    (v) => revealHousehold(v, revealSharedSecrets).then(r => r ?? v));
export const loadHousehold = () =>
  loadReferenceDoc<HouseholdInfo>('household', 'family_household',
    (v) => revealHousehold(v, revealSharedSecrets).then(r => r ?? v),
    (v) => protectHousehold(v, protectSharedSecrets).then(r => r ?? v));

export const saveFinances = (f: FinancesInfo, base?: FinancesInfo) =>
  saveReferenceDoc('finances', f, 'family_finances', base,
    (v) => protectFinances(v, protectSharedSecrets).then(r => r ?? v),
    (v) => revealFinances(v, revealSharedSecrets).then(r => r ?? v));
export const loadFinances = () =>
  loadReferenceDoc<FinancesInfo>('finances', 'family_finances',
    (v) => revealFinances(v, revealSharedSecrets).then(r => r ?? v),
    (v) => protectFinances(v, protectSharedSecrets).then(r => r ?? v));

export const saveTimeline = (t: FamilyTimeline, base?: FamilyTimeline) => saveReferenceDoc('timeline', t, 'family_timeline', base);
export const loadTimeline = () => loadReferenceDoc<FamilyTimeline>('timeline', 'family_timeline');

export const saveActions = (actions: FamilyActionsDoc, base?: FamilyActionsDoc) =>
  saveReferenceDoc('actions', actions, 'family_actions', base);
export const loadActions = () => loadReferenceDoc<FamilyActionsDoc>('actions', 'family_actions');

// Family Dictionary (invented/mangled words the family adopted) — family-level.
export const saveFamilyWords = (w: FamilyWordsDoc, base?: FamilyWordsDoc) => saveReferenceDoc('familyWords', w, 'family_words', base);
export const loadFamilyWords = () => loadReferenceDoc<FamilyWordsDoc>('familyWords', 'family_words');

// Wills & estate — family-wide, store-and-recall only (see WillsEstateView).
export async function saveWillsEstate(w: WillsEstateDoc, base?: WillsEstateDoc): Promise<boolean> {
  const spaceAtStart = FAMILY_ID;
  const user = auth.currentUser;
  const linkedIds = new Set((w.records || []).flatMap(record => record.linkedDocIds || []));
  if (linkedIds.size) {
    if (!user) throw new Error('Sign in before saving protected estate documents.');
    const docs = await loadDocuments();
    const paths = [...new Set(docs.filter(document => linkedIds.has(document.id)).flatMap(document => {
      const path = document.storagePath || filePathFromReference(document.downloadUrl);
      return path ? [path] : [];
    }))];
    if (paths.length) {
      const token = await user.getIdToken();
      if (FAMILY_ID !== spaceAtStart || auth.currentUser?.uid !== user.uid) throw new Error('Your space changed. Please save the estate record again.');
      const response = await fetch('/api/files/protect-estate', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (!response.ok) throw new Error('Could not protect the linked estate files. Please try again before saving.');
    }
  }
  if (FAMILY_ID !== spaceAtStart || (user && auth.currentUser?.uid !== user.uid)) throw new Error('Your space changed. Please save the estate record again.');
  return saveReferenceDoc('willsEstate', w, 'family_wills_estate', base);
}
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
    return {
      ...data,
      readerUids: Array.isArray(data.readerUids) ? data.readerUids : [],
      // Written only by the server (estate invites). Absent on every doc
      // created before v233, and on every space that has never sent one.
      pendingReaders: Array.isArray(data.pendingReaders) ? data.pendingReaders : [],
    };
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

/**
 * Admins only — the rule rejects everyone else. Returns false if it did.
 *
 * MERGE, not overwrite. `pendingReaders` on this same document is written by
 * the server (estate invites, see server/willsInvite.mjs) and is never sent
 * from here; a full overwrite would silently delete a pending estate invite
 * the moment an admin toggled anybody's access — the one grant nobody would be
 * around to notice was missing.
 */
export async function saveWillsAccess(readerUids: string[], updatedBy?: string): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    await setDoc(
      doc(db, 'families', FAMILY_ID, 'reference', 'willsAccess'),
      { readerUids, updatedAt: new Date().toISOString(), updatedBy: updatedBy || '' },
      { merge: true },
    );
    /* Who may read the will is the single most consequential switch in this
     * app, and until now it changed with no record anywhere. Admin-tier, like
     * the document itself — and no names in the entry: WHO was added is the
     * disclosure, THAT the list changed is the alarm. */
    recordActivity('willsAccess', 'updated');
    return true;
  } catch (error) {
    console.error('Error saving willsAccess:', error);
    return false;
  }
}

/**
 * Mint an invite that carries access to Wills & Estate (admins only).
 *
 * The same /api/create-invite Settings uses, with willReader set — so the
 * person joins the vault as a member AND lands on the estate reader list the
 * moment they sign in, without the admin having to come back and name them.
 * That "without having to come back" is the entire point: the day this matters
 * is the day they can't.
 *
 * `replacePendingId` re-sends an invite that expired unredeemed, replacing the
 * old row instead of stacking a second one for the same person.
 */
/* This family's forward-to-file address, if inbound mail is switched on.
 *
 * Returns null for every "not available" case — feature dormant, signed out,
 * server unreachable — because the caller's only decision is whether to show
 * a row. A thrown error here would take down the vault screen over a feature
 * that is, in production today, deliberately off (see docs/INBOUND-MAIL.md).
 *
 * The address is derived server-side from the CALLER'S OWN family. It is a
 * write capability into that family's vault, so it is never accepted from,
 * or computed on, the client.
 */
export async function fetchInboundMailAddress(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/inbound-mail/address', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.enabled && typeof data.address === 'string' ? data.address : null;
  } catch {
    return null;
  }
}

/* ── The Gmail bridge ───────────────────────────────────────────────────────
 *
 * Teluva cannot read Gmail: every scope that can is a Google RESTRICTED scope
 * needing an annual CASA assessment (the same regime googleScopes.ts avoids
 * for Drive). Instead an Apps Script runs in the person's OWN account, reads
 * their own mailbox, and posts attachments here — see
 * apps-script/teluva-gmail-bridge.
 *
 * A bridge token is a WRITE CAPABILITY into the family vault: anyone holding
 * it can put documents in. So the raw token is returned by the server exactly
 * ONCE, at creation, and never again — only its hash is stored. If it is lost,
 * the answer is to create a new one, which revokes the old.
 */

export type GmailBridgeStatus = {
  connected: boolean;
  createdAt?: string;
  createdBy?: string;
  lastUsedAt?: string | null;
  filedCount?: number;
};

export async function fetchGmailBridgeStatus(): Promise<GmailBridgeStatus | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/gmail-bridge/status', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && typeof data.connected === 'boolean' ? (data as GmailBridgeStatus) : null;
  } catch {
    return null;
  }
}

/** Mints a token and returns the RAW value — the only time it is ever available. */
export async function createGmailBridgeToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in');
  const token = await user.getIdToken();
  const res = await fetch('/api/gmail-bridge/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(data.error || 'Could not create the token. Please try again.');
  return data.token as string;
}

export async function revokeGmailBridgeToken(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in');
  const token = await user.getIdToken();
  const res = await fetch('/api/gmail-bridge/token', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not disconnect. Please try again.');
  }
}

export async function createEstateInvite(
  forName: string,
  replacePendingId?: string,
): Promise<{ code: string; pendingId: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in');
  const token = await user.getIdToken();
  const res = await fetch('/api/create-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ willReader: true, forName, replacePendingId: replacePendingId || null }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.code) throw new Error(data.error || 'Could not create the invite. Please try again.');
  return { code: data.code, pendingId: data.pendingId };
}

/**
 * Withdraw an estate invite that hasn't been redeemed yet (admins only).
 *
 * arrayRemove rather than "read, filter, write the whole array": the server
 * appends to this same field when an invite is sent, and a read-modify-write
 * from here could drop one that landed in between. Requires the exact stored
 * object, so callers must pass the entry straight from loadWillsAccess without
 * reshaping it.
 *
 * Removing the row is the whole cancellation — redemption looks the id up here
 * and grants nothing when it is gone (server/willsInvite.mjs). The invite code
 * itself still works as an ordinary invite until it expires; that is
 * deliberate, "I didn't mean to give them the will" is not the same as "I
 * didn't mean to invite them", and revoking membership is a separate, existing
 * action in Members & roles.
 */
export async function cancelPendingWillReader(entry: PendingWillReader): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    await updateDoc(
      doc(db, 'families', FAMILY_ID, 'reference', 'willsAccess'),
      { pendingReaders: arrayRemove(entry), updatedAt: new Date().toISOString() },
    );
    return true;
  } catch (error) {
    console.error('Error cancelling estate invite:', error);
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/asset-photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/chat-attachments/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: mimeType || blob.type || 'application/octet-stream' });
  return getDownloadURL(r);
}

// Best-effort delete of a Storage-backed asset photo by its download URL.
// ref(storage, url) resolves an https download URL to its object. Legacy inline
// base64 photos aren't in Storage, so they're skipped.
export async function deleteAssetPhoto(url: string): Promise<void> {
  if (!url || !filePathFromReference(url)) return;
  try {
    await deleteObject(ref(storage, url));
  } catch (e) {
    console.error('Asset photo delete failed (reference will still be removed):', e);
  }
}

// --- Document Vault: files in Firebase Storage, metadata in Firestore ---
export async function uploadVaultFile(file: File, docId: string, options: { shared?: boolean } = {}): Promise<{ storagePath: string; downloadUrl: string }> {
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g, '_');
  const storagePath = `families/${spaceAtStart}/documents/${docId}/${safeName}`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
  const r = ref(storage, storagePath);
  await uploadBytes(r, file, { contentType: file.type || 'application/octet-stream', shared: options.shared });
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
export async function uploadVaultPhoto(dataUrl: string, docId: string, options: { shared?: boolean } = {}): Promise<{ storagePath: string; downloadUrl: string }> {
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/documents/${docId}/photo.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg', shared: options.shared });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

// --- Travel timeline photos: real Storage files, only the URL lives in the
// shared travelTimeline reference doc (all entries share ONE Firestore doc —
// inlining base64 there like Assets does would blow the ~1MB doc cap after a
// handful of photos). Takes a compressed data URL (post-EXIF-parse, see
// utils/travelGeo.ts) and uploads it, mirroring uploadVaultFile exactly.
export async function uploadTravelPhoto(dataUrl: string, entryId: string): Promise<{ storagePath: string; downloadUrl: string }> {
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/travel-photos/${entryId}.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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

// --- Life timeline photos: same reasoning as travel photos — the timeline is
// ONE shared Firestore doc, so a photo is a Storage file and only its URL is
// stored. `photoId` is unique per photo (a moment can have several).
export async function uploadTimelinePhoto(dataUrl: string, photoId: string): Promise<{ storagePath: string; downloadUrl: string }> {
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/timeline-photos/${photoId}.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: blob.type || 'image/jpeg' });
  const downloadUrl = await getDownloadURL(r);
  return { storagePath, downloadUrl };
}

export async function deleteTimelinePhoto(storagePath: string): Promise<void> {
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    console.error('Timeline photo delete failed (the moment is still saved):', e);
  }
}

// --- In Memory portraits: real Storage files, only the URL lives in the
// shared inMemory reference doc — same reasoning as uploadTravelPhoto (many
// people share ONE Firestore doc, so no inline base64). Documents for a
// departed relative reuse uploadVaultFile/deleteVaultFile unmodified.
export async function uploadInMemoryPhoto(dataUrl: string, personId: string): Promise<{ storagePath: string; downloadUrl: string }> {
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/in-memory-photos/${personId}.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  // Turn the compressed base64 data URL into a Blob for a compact binary upload.
  const blob = await fetchFileBlob(dataUrl);
  const rand = Math.random().toString(36).slice(2, 8);
  const storagePath = `families/${spaceAtStart}/birthday-photos/${memberId}/${year}-${rand}.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g, '_');
  const storagePath = `families/${spaceAtStart}/referrals/${memberId}/${recordId}-${safeName}`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const ext = contentType === 'application/pdf' ? 'pdf' : 'jpg';
  const storagePath = `families/${spaceAtStart}/referrals/${memberId}/${recordId}.${ext}`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const id = Date.now().toString() + Math.floor(Math.random() * 1000);
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/recipe-photos/${id}.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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

// --- Family tree: the kin edges. One shared doc holding a flat list of links,
// same shape/convention as the two above. The PEOPLE are not stored here —
// they already live in members / extendedBirthdays / inMemory, and this
// document holds only the edges between them (see types.ts KinLink). ---
export const saveFamilyTree = (links: KinLink[], base?: KinLink[]) =>
  saveReferenceDoc('familyTree', { links }, 'family_tree', base ? { links: base } : undefined);
export async function loadFamilyTree(): Promise<KinLink[]> {
  const data = await loadReferenceDoc<FamilyTreeDoc>('familyTree', 'family_tree');
  return data?.links || [];
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const id = Date.now().toString() + Math.floor(Math.random() * 1000);
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/slip-photos/${id}.jpg`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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
    // Narrowed against the same allowlist the server uses — an unrecognised
    // tier name must display as 'free' (the most conservative reading), never
    // be trusted through as-is.
    const plan = data.plan === 'paid' ? 'paid' : data.plan === 'trial' ? 'trial' : 'free';
    return { plan, used: data.used, limit: data.limit, resetsOn: String(data.resetsOn || '') };
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
    const info = snap.exists() ? normalizeFileReferences(snap.data() as FamilyInfoDoc) : null;
    /* Remembered so recordActivity can classify a profile edit without an
     * extra read on every save. It only ever decides WHO SEES a trail entry
     * about a member record — family news in a household, an HR matter in a
     * business — and when it has never been written, recordActivity assumes
     * business, which is the narrower answer. */
    try { localStorage.setItem(spaceTypeKey(), info?.type === 'business' ? 'business' : 'family'); } catch { /* private mode */ }
    return info;
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
      return normalizeFileReferences((snap.data().messages as StoredChatMessage[]) || []);
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
  const slim = normalizeFileReferences(messages).slice(-50).map(({ role, text, edits, applied, images, sourceImages, undo }) => {
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

// ── Personal prefs: one account's own settings in one space ──
// families/{FAMILY_ID}/prefs/{uid}, readable and writable by that account only
// (firestore.rules). Today it holds one thing: the people whose dates THIS
// person has chosen not to see (utils/hiddenPeople.ts). The family's shared
// list is HubSettings.hiddenDatePeople instead.
export async function loadPersonalPrefs(uid: string): Promise<PersonalPrefsDoc> {
  try {
    const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'prefs', uid));
    return snap.exists() ? (snap.data() as PersonalPrefsDoc) : {};
  } catch (error) {
    console.error('Error loading personal prefs:', error);
    return {};
  }
}

/**
 * Change this account's hidden-dates list. `change` is applied to the list as
 * it is on the server right now, inside a transaction, so hiding someone on
 * the phone and showing someone else again on the laptop both survive.
 * Returns the list as saved, or null if the write failed.
 */
export async function updatePersonalHiddenDates(
  uid: string,
  change: (list: HiddenDatePerson[]) => HiddenDatePerson[],
): Promise<HiddenDatePerson[] | null> {
  try {
    const prefsRef = doc(db, 'families', FAMILY_ID, 'prefs', uid);
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(prefsRef);
      const cur = (snap.exists() ? (snap.data() as PersonalPrefsDoc).hiddenDatePeople : undefined) || [];
      const next = change(Array.isArray(cur) ? cur : []);
      tx.set(prefsRef, { hiddenDatePeople: next }, { merge: true });
      return next;
    });
  } catch (error) {
    console.error('Error saving personal prefs:', error);
    return null;
  }
}

// ── Assets ──
export async function loadAssets(): Promise<AssetItem[]> {
  const snap = await getDocs(collection(db, 'families', FAMILY_ID, 'assets'));
  const items = snap.docs.map(d => normalizeFileReferences(d.data() as AssetItem));
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveAsset(asset: AssetItem): Promise<boolean> {
  try {
    await setDoc(doc(db, 'families', FAMILY_ID, 'assets', asset.id), normalizeFileReferences(asset));
    recordActivity('assets', 'updated', asset.name);
    return true;
  } catch (error) {
    console.error('Error saving asset:', error);
    return false;
  }
}

export async function deleteAsset(id: string): Promise<void> {
  await deleteDoc(doc(db, 'families', FAMILY_ID, 'assets', id));
  // No name here — this function is given an id, and reading the doc back
  // purely to label a trail entry is not worth a round trip on a delete.
  recordActivity('assets', 'removed');
}

// ── Secrets-vault encryption ──
// Capture the space before any await. Another tab changing the account's active
// pointer must never cause this tab to encrypt one space's data for another.
async function vaultValues(route: string, values: string[], protecting: boolean, spaceId = FAMILY_ID): Promise<string[]> {
  let reason: 'admin-refresh' | 'unavailable' = 'unavailable';
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in again.');
    const token = await user.getIdToken();
    const res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ values, spaceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data.values) || data.values.length !== values.length
      || data.values.some((value: unknown) => typeof value !== 'string')) {
      if (data.code === 'VAULT_ADMIN_REFRESH_REQUIRED') reason = 'admin-refresh';
      throw new Error(data.error || 'Could not open the protected records. Try again.');
    }
    return data.values;
  } catch (error) {
    if (!protecting) reportVaultAccessIssue(reason, spaceId);
    throw error;
  }
}

// Personal credentials have an admin-only endpoint and cryptographic purpose.
export async function protectSecrets(values: string[]): Promise<string[]> {
  const clean = values.map(value => value ?? '');
  if (clean.every(value => value === '')) return clean;
  return vaultValues('/api/vault/protect', clean, true);
}

// Every shared ID/household/bank field uses the shared-purpose endpoint.
export async function protectSharedSecrets(values: string[], spaceId = FAMILY_ID): Promise<string[]> {
  const clean = values.map(value => value ?? '');
  if (clean.every(value => value === '')) return clean;
  return vaultValues('/api/vault/protect-shared', clean, true, spaceId);
}

export async function revealSecrets(values: string[]): Promise<string[]> {
  if (!values.length) return values;
  try { return await vaultValues('/api/vault/reveal', values, false); }
  catch {
    return values; // retain ciphertext, never overwrite a saved secret with a blank
  }
}

export async function revealSharedSecrets(values: string[], spaceId = FAMILY_ID): Promise<string[]> {
  if (!values.length) return values;
  try { return await vaultValues('/api/vault/reveal-shared', values, false, spaceId); }
  catch {
    return values;
  }
}

// Keep the production child masking policy. The server independently denies child reveals.
let accountRole: string | null = null;
export function setAccountRole(role: string | null): void {
  accountRole = role;
  setSharedRevealEnabled(role !== 'child');
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
  /* Deliberately unnamed. The entry's LABEL is half the secret — "Revolut",
   * "the safe" — and a passwords entry is admin-tier anyway, so naming it
   * would buy nothing and risk exactly the thing this collection exists to
   * protect. That a password changed, and who changed it, is the whole point
   * of logging it at all. */
  recordActivity('passwords', 'updated');
}

export async function deletePassword(id: string): Promise<void> {
  await deleteDoc(doc(db, 'families', FAMILY_ID, 'passwords', id));
  recordActivity('passwords', 'removed');
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
  if (memberDoc?.storagePath) storagePaths.add(memberDoc.storagePath);
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
  const spaceAtStart = FAMILY_ID;
  const accountAtStart = auth.currentUser?.uid;
  const blob = await fetchFileBlob(dataUrl);
  const storagePath = `families/${spaceAtStart}/chat-attachments/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!accountAtStart || auth.currentUser?.uid !== accountAtStart) throw new Error('Your account changed. Please upload the file again.');
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

/* ── Releasing the will: the doorbell ────────────────────────────────────────
 *
 * All four go through the server because willsAccess is admin-write-only in
 * firestore.rules, and the whole point is that a NON-admin can ring the bell.
 * The rule is not loosened to let them: the server holds the pen, and it checks
 * eligibility from the roles collection rather than from anything the caller
 * sends. See server/willsRelease.mjs for the decisions themselves.
 */

export interface ReleaseRequestRow {
  id: string;
  requestedBy: string;
  requestedByName?: string;
  requestedAt: string;
  approvals?: string[];
  declinedAt?: string;
  declinedBy?: string;
  releasedAt?: string;
  releasedBecause?: string;
}

/** Rung one: who holds the signed will. Mirrors projectFindability's output. */
export interface FindabilityEntry {
  kind: string;
  heldBy?: string;
  notaryName?: string;
  registered?: 'registered';
  registryName?: string;
  originalLocation?: string;
  /** Nothing at all was recorded — said plainly so they can ask while they can. */
  unrecorded?: boolean;
}

export interface ReleaseState {
  requests: ReleaseRequestRow[];
  youMayRead: boolean;
  /** An estate invite named them. They still cannot read it — see v329. */
  youAreNamed?: boolean;
  findability?: FindabilityEntry[] | null;
}

/* One authenticated POST to our own API, with the strict parse below.
 * Named for what it is rather than for the wills-release endpoints it was
 * written for — the staff directory uses it too, and anything else that must
 * not mistake the SPA's catch-all for an answer should. */
async function authedPost<T>(path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in');
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  /* An UNKNOWN /api path does not 404 here — the SPA catch-all answers it with
   * index.html and a 200. Parsing that leniently would hand the caller `{}`:
   * a doorbell that silently reports no requests and no access, which is the
   * worst possible refusal on this particular screen. So a non-JSON body is an
   * error even when the status is 200. */
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new Error(
      (data && typeof data.error === 'string' && data.error)
        || 'Something went wrong. Please try again.',
    );
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Could not reach the vault. Please try again.');
  }
  return data as T;
}

/* ── THE ACTIVITY TRAIL ──────────────────────────────────────────────────── */

const spaceTypeKey = () => `teluva.spaceType_${FAMILY_ID}`;
const activitySeenKey = () => `teluva.activitySeen_${FAMILY_ID}`;

/**
 * Write down that something changed. Fire-and-forget, and deliberately so.
 *
 * NEVER AWAITED BY A SAVE, AND NEVER ABLE TO FAIL ONE. The trail is a record
 * of work, not the work. A save that succeeded and then reported failure
 * because its diary entry did not write would be a strictly worse app than one
 * with no trail at all, and the person it would confuse is the one who just
 * typed something important.
 *
 * NO VALUES. `what` names the thing — a first name, a document title — and
 * never what it was changed to. That rule is what lets an entry be readable by
 * more people than the document it describes.
 */
export function recordActivity(
  kind: string,
  action: 'added' | 'updated' | 'removed',
  what?: string,
): void {
  void (async () => {
    try {
      const user = auth.currentUser;
      if (!user || !isLoggableKind(kind)) return;

      /* Autosave means one act of editing arrives as many saves. Collapsed
       * against a small local record of what this device last wrote — local,
       * because the dedupe is about one person's editing session, not about
       * what the household did. */
      const signature = `${kind}|${what || ''}|${action}`;
      let seen: Record<string, number> = {};
      try { seen = JSON.parse(localStorage.getItem(activitySeenKey()) || '{}'); } catch { seen = {}; }
      if (!shouldLog(signature, seen)) return;

      let businessSpace = true;   // unknown → the narrower answer
      try { businessSpace = localStorage.getItem(spaceTypeKey()) !== 'family'; } catch { /* private mode */ }

      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const entry: ActivityEntry = {
        id,
        at: new Date().toISOString(),
        actorUid: user.uid,
        // First name only. The trail is read by children and, in a business,
        // by colleagues; a full email address in it would be a disclosure the
        // entry never needed to make.
        actorName: (user.displayName || user.email || 'Someone').trim().split(/[\s@]+/)[0] || 'Someone',
        kind,
        action,
        visibility: visibilityFor(kind, businessSpace),
      };
      if (what) entry.what = what.trim().slice(0, 80);

      await setDoc(doc(db, 'families', FAMILY_ID, 'activity', id), entry);

      seen[signature] = Date.now();
      /* Keep the local dedupe record from growing without bound — anything
       * older than the window can never suppress anything again. */
      const cutoff = Date.now() - DEDUPE_WINDOW_MS;
      for (const [k, t] of Object.entries(seen)) if (!(typeof t === 'number' && t > cutoff)) delete seen[k];
      try { localStorage.setItem(activitySeenKey(), JSON.stringify(seen)); } catch { /* private mode */ }
    } catch {
      /* Swallowed on purpose — see the doc comment. A trail entry is never
       * worth a toast, and never worth failing the save it describes. */
    }
  })();
}

/**
 * Read the trail, as much of it as this role may see.
 *
 * THE FILTER IS NOT BELT-AND-BRACES, IT IS THE ONLY WAY THE QUERY SUCCEEDS.
 * firestore.rules gates each entry on its own `visibility`, and Firestore
 * fails a WHOLE list when one returned document fails the rule — so a member
 * asking for the collection unfiltered gets nothing at all, not a filtered
 * subset. Asking for exactly the tiers this role may read means every returned
 * document passes, which is what makes the query legal. The emulator asserts
 * both halves of that contract.
 *
 * Sorted here rather than by Firestore: `where in` plus `orderBy` on a
 * different field needs a composite index, and this collection is small and
 * capped by the cron's retention sweep.
 */
export async function loadActivity(role: string | null | undefined): Promise<ActivityEntry[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const col = collection(db, 'families', FAMILY_ID, 'activity');
    const snap = role === 'admin'
      ? await getDocs(col)
      : await getDocs(query(col, where('visibility', 'in', visibilitiesFor(role))));
    return orderActivity(snap.docs.map((d) => d.data() as ActivityEntry));
  } catch (error) {
    console.error('Error loading activity:', error);
    return [];
  }
}

/** One colleague as the team directory shows them. Mirrors DIRECTORY_FIELDS. */
export interface DirectoryEntry {
  id: string;
  name: string;
  role?: string;
  jobTitle?: string;
  workPhone?: string;
  workAddress?: string;
  employer?: string;
  startDate?: string;
  avatarColor?: string;
}

/**
 * Who works here — business spaces only.
 *
 * Goes through the server because it HAS to: firestore.rules refuses an
 * employee every colleague document (v330), and rules gate documents, not
 * fields, so there is no version of this the client could read directly
 * without reopening the HR file. server/directory.mjs holds the allowlist.
 */
export const loadBusinessDirectory = () =>
  authedPost<{ members: DirectoryEntry[] }>('/api/business/directory');

/** Settle any request whose seven days have run out, and report the state. */
export const loadReleaseState = () =>
  authedPost<ReleaseState>('/api/wills-release/state');

export const requestWillRelease = () =>
  authedPost<{ reason: string; requests: ReleaseRequestRow[] }>('/api/wills-release/request');

export const approveWillRelease = (requestId: string) =>
  authedPost<{ reason: string; released: boolean; requests: ReleaseRequestRow[] }>(
    '/api/wills-release/approve', { requestId },
  );

export const declineWillRelease = (requestId: string) =>
  authedPost<{ reason: string; requests: ReleaseRequestRow[] }>(
    '/api/wills-release/decline', { requestId },
  );

/**
 * "I am still here", from an admin's device, at most once a day.
 *
 * Throttled in localStorage rather than by asking the server, because the point
 * is to avoid the write, not to avoid the answer. Failure is SILENT and that is
 * correct: not recording a heartbeat can only make the fast door slower, and an
 * error toast about a background write nobody asked for is worse than the miss.
 */
const HEARTBEAT_KEY = 'teluva:ownerHeartbeatAt';
export async function recordOwnerStillHere(): Promise<void> {
  try {
    const last = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
    if (Number.isFinite(last) && Date.now() - last < 24 * 3600 * 1000) return;
    await authedPost('/api/wills-release/still-here');
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  } catch {
    /* see the doc comment: a missed heartbeat is safe, a toast is not */
  }
}
