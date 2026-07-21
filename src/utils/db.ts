import { FamilyMember, CalendarEvent, FamilyInfo, HouseholdInfo, FinancesInfo, FamilyTimeline, VaultDocument, HubSettings, ShoppingItem, FamilyRole, FamilyMemberRole, UserProfile, FamilyInfoDoc, AssetItem, PasswordEntry, FamilyWordsDoc, Recipe, RecipeBookDoc, TravelTimelineDoc, InMemoryDoc, WillsEstateDoc } from '../types';
import { db, auth, storage } from '../lib/firebase';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

// One shared vault for the whole household. Every authorised family account
// (see firestore.rules) reads and writes this same path, so Mama, Papa and the
// kids all see the same family — instead of each Google account getting its own
// private island.
export let FAMILY_ID = 'household';

/** Called by FamilyProvider once it resolves the user's familyId. */
export function setFamilyId(id: string): void {
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
const infoKey = () => `family_info_v2_${FAMILY_ID}`;
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
export async function saveFamilyMembers(members: FamilyMember[]): Promise<boolean> {
  const user = auth.currentUser;
  let cloudOk = false;

  if (user) {
    try {
      const batch = writeBatch(db);

      for (const member of members) {
        if (!member.id) continue;
        const docRef = doc(db, 'families', FAMILY_ID, 'family_members', member.id);
        batch.set(docRef, member, { merge: true });
      }

      // Handle deleted members by maintaining a list of active IDs in a metadata doc
      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'members');
      batch.set(metaRef, { ids: members.map(m => m.id) });

      await batch.commit();
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

  return cloudOk;
}

export async function loadFamilyMembers(): Promise<FamilyMember[] | null> {
  const user = auth.currentUser;

  if (user) {
    try {
      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'members');
      const metaSnap = await getDoc(metaRef);

      if (metaSnap.exists()) {
        const ids = metaSnap.data().ids as string[];
        const membersReqs = ids.map(id => getDoc(doc(db, 'families', FAMILY_ID, 'family_members', id)));
        const snaps = await Promise.all(membersReqs);
        const members = snaps.map(s => s.data() as FamilyMember).filter(Boolean);

        // Cache locally
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

export async function saveCalendarEvents(events: CalendarEvent[]): Promise<boolean> {
  const user = auth.currentUser;
  let cloudOk = false;

  if (user) {
    try {
      const batch = writeBatch(db);

      for (const event of events) {
        if (!event.id) continue;
        const docRef = doc(db, 'families', FAMILY_ID, 'calendar_events', event.id);
        batch.set(docRef, event, { merge: true });
      }

      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'events');
      batch.set(metaRef, { ids: events.map(e => e.id) });

      await batch.commit();
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

  return cloudOk;
}

export async function loadCalendarEvents(): Promise<CalendarEvent[] | null> {
  const user = auth.currentUser;

  if (user) {
    try {
      const metaRef = doc(db, 'families', FAMILY_ID, 'metadata', 'events');
      const metaSnap = await getDoc(metaRef);

      if (metaSnap.exists()) {
        const ids = metaSnap.data().ids as string[];
        const eventReqs = ids.map(id => getDoc(doc(db, 'families', FAMILY_ID, 'calendar_events', id)));
        const snaps = await Promise.all(eventReqs);
        const events = snaps.map(s => s.data() as CalendarEvent).filter(Boolean);

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
export async function saveFamilyInfo(info: FamilyInfo): Promise<boolean> {
  const user = auth.currentUser;
  let cloudOk = false;

  if (user) {
    try {
      await setDoc(doc(db, 'families', FAMILY_ID, 'reference', 'info'), info);
      cloudOk = true;
    } catch (error) {
      console.error('Error saving family info:', error);
    }
  }

  try {
    localStorage.setItem(infoKey(), JSON.stringify(info));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }

  return cloudOk;
}

export async function loadFamilyInfo(): Promise<FamilyInfo | null> {
  const user = auth.currentUser;

  if (user) {
    try {
      const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'reference', 'info'));
      if (snap.exists()) {
        const info = snap.data() as FamilyInfo;
        localStorage.setItem(infoKey(), JSON.stringify(info));
        return info;
      }
    } catch (error) {
      console.error('Error loading family info:', error);
    }
  }

  const local = localStorage.getItem(infoKey());
  if (local) {
    try {
      return JSON.parse(local);
    } catch (e) {
      return null;
    }
  }
  return null;
}

// --- Generic shared single-doc reference store (household / finances / timeline) ---
// Each lives at families/{FAMILY_ID}/reference/{key}, shared across the household.
// localKey is scoped by FAMILY_ID internally (see membersKey/calendarKey/infoKey
// above for why) — callers keep passing their existing plain 'family_household'-
// style constant, no call-site change needed.
async function saveReferenceDoc<T>(key: string, value: T, localKey: string): Promise<boolean> {
  const user = auth.currentUser;
  let cloudOk = false;
  if (user) {
    try {
      await setDoc(doc(db, 'families', FAMILY_ID, 'reference', key), value as any);
      cloudOk = true;
    } catch (error) {
      console.error(`Error saving ${key}:`, error);
    }
  }
  try {
    localStorage.setItem(`${localKey}_${FAMILY_ID}`, JSON.stringify(value));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }
  return cloudOk;
}

async function loadReferenceDoc<T>(key: string, localKey: string): Promise<T | null> {
  const scopedKey = `${localKey}_${FAMILY_ID}`;
  const user = auth.currentUser;
  if (user) {
    try {
      const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'reference', key));
      if (snap.exists()) {
        const data = snap.data() as T;
        localStorage.setItem(scopedKey, JSON.stringify(data));
        return data;
      }
    } catch (error) {
      console.error(`Error loading ${key}:`, error);
    }
  }
  const local = localStorage.getItem(scopedKey);
  if (local) {
    try { return JSON.parse(local); } catch (e) { return null; }
  }
  return null;
}

export const saveHousehold = (h: HouseholdInfo) => saveReferenceDoc('household', h, 'family_household');
export const loadHousehold = () => loadReferenceDoc<HouseholdInfo>('household', 'family_household');

export const saveFinances = (f: FinancesInfo) => saveReferenceDoc('finances', f, 'family_finances');
export const loadFinances = () => loadReferenceDoc<FinancesInfo>('finances', 'family_finances');

export const saveTimeline = (t: FamilyTimeline) => saveReferenceDoc('timeline', t, 'family_timeline');
export const loadTimeline = () => loadReferenceDoc<FamilyTimeline>('timeline', 'family_timeline');

// Family Dictionary (invented/mangled words the family adopted) — family-level.
export const saveFamilyWords = (w: FamilyWordsDoc) => saveReferenceDoc('familyWords', w, 'family_words');
export const loadFamilyWords = () => loadReferenceDoc<FamilyWordsDoc>('familyWords', 'family_words');

// Wills & estate — family-wide, store-and-recall only (see WillsEstateView).
export const saveWillsEstate = (w: WillsEstateDoc) => saveReferenceDoc('willsEstate', w, 'family_wills_estate');
export const loadWillsEstate = () => loadReferenceDoc<WillsEstateDoc>('willsEstate', 'family_wills_estate');

export const saveTravelTimeline = (t: TravelTimelineDoc) => saveReferenceDoc('travelTimeline', t, 'family_travel_timeline');
export const loadTravelTimeline = () => loadReferenceDoc<TravelTimelineDoc>('travelTimeline', 'family_travel_timeline');

export const saveSettings = (s: HubSettings) => saveReferenceDoc('settings', s, 'family_settings');
export const loadSettings = () => loadReferenceDoc<HubSettings>('settings', 'family_settings');

// In Memory: an archive of deceased parents/grandparents — their documents and
// a few remembered things. Family-level, one shared reference doc like every
// other feature here.
export const saveInMemory = (v: InMemoryDoc) => saveReferenceDoc('inMemory', v, 'family_in_memory');
export const loadInMemory = () => loadReferenceDoc<InMemoryDoc>('inMemory', 'family_in_memory');

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

export const saveDocuments = (docs: VaultDocument[]) => saveReferenceDoc('documents', { docs }, 'family_documents');
export async function loadDocuments(): Promise<VaultDocument[]> {
  const data = await loadReferenceDoc<{ docs: VaultDocument[] }>('documents', 'family_documents');
  return data?.docs || [];
}

export const DEFAULT_EVENTS: CalendarEvent[] = [];
export const DEFAULT_FAMILY: FamilyMember[] = [];

// --- Shopping list ---
export const saveShopping = (items: ShoppingItem[]) => saveReferenceDoc('shopping', { items }, 'family_shopping');
export async function loadShopping(): Promise<ShoppingItem[]> {
  const data = await loadReferenceDoc<{ items: ShoppingItem[] }>('shopping', 'family_shopping');
  return data?.items || [];
}

// --- Recipe Book: one shared doc for the whole household, same shape as
// documents/shopping above. ---
export const saveRecipes = (recipes: Recipe[]) => saveReferenceDoc('recipes', { recipes }, 'family_recipes');
export async function loadRecipes(): Promise<Recipe[]> {
  const data = await loadReferenceDoc<RecipeBookDoc>('recipes', 'family_recipes');
  return data?.recipes || [];
}

// Recipe photo (the original card/page): uploaded to Firebase Storage rather
// than embedded as base64, so a growing recipe collection never risks the
// 1MiB Firestore document cap the way a base64-per-recipe doc would.
export async function uploadRecipePhoto(dataUrl: string): Promise<string> {
  const id = Date.now().toString() + Math.floor(Math.random() * 1000);
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  const storagePath = `families/${FAMILY_ID}/recipe-photos/${id}.jpg`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: mime });
  return await getDownloadURL(r);
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

export async function saveUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
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
  const slim = messages.slice(-50).map(({ role, text, edits, applied, images, sourceImages }) => {
    const m: StoredChatMessage = { role, text };
    if (edits) m.edits = edits;
    if (applied) m.applied = applied;
    if (images) m.images = images;
    if (sourceImages) m.sourceImages = sourceImages;
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
