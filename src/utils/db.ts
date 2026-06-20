import { FamilyMember, CalendarEvent, FamilyInfo, HouseholdInfo, FinancesInfo, FamilyTimeline, VaultDocument, HubSettings, ShoppingItem, FamilyRole, FamilyMemberRole, UserProfile, FamilyInfoDoc, AssetItem, PasswordEntry } from '../types';
import { db, auth, storage } from '../lib/firebase';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

const MEMBERS_KEY = 'family_members';
const CALENDAR_KEY = 'family_calendar';
const INFO_KEY = 'family_info';

// One shared vault for the whole household. Every authorised family account
// (see firestore.rules) reads and writes this same path, so Mama, Papa and the
// kids all see the same family — instead of each Google account getting its own
// private island.
export let FAMILY_ID = 'household';

/** Called by FamilyProvider once it resolves the user's familyId. */
export function setFamilyId(id: string): void {
  FAMILY_ID = id;
}

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
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
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
        localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
        return members.length > 0 ? members : null;
      }

      // Shared vault is empty: migrate whatever this device saved locally (e.g.
      // data entered before sharing existed) up into the family vault, once.
      const local = localStorage.getItem(MEMBERS_KEY);
      if (local) {
        const localMembers = JSON.parse(local) as FamilyMember[];
        if (Array.isArray(localMembers) && localMembers.length > 0) {
          await saveFamilyMembers(localMembers);
          return localMembers;
        }
      }
    } catch (error) {
      console.error('Error loading from Firestore:', error);
    }
  }

  // Fallback to local (not signed in)
  const local = localStorage.getItem(MEMBERS_KEY);
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
    localStorage.setItem(CALENDAR_KEY, JSON.stringify(events));
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

        localStorage.setItem(CALENDAR_KEY, JSON.stringify(events));
        return events.length > 0 ? events : null;
      }

      // Shared vault empty: migrate this device's local events up, once.
      const local = localStorage.getItem(CALENDAR_KEY);
      if (local) {
        const localEvents = JSON.parse(local) as CalendarEvent[];
        if (Array.isArray(localEvents) && localEvents.length > 0) {
          await saveCalendarEvents(localEvents);
          return localEvents;
        }
      }
    } catch (error) {
      console.error('Error loading events from Firestore:', error);
    }
  }

  const local = localStorage.getItem(CALENDAR_KEY);
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
    localStorage.setItem(INFO_KEY, JSON.stringify(info));
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
        localStorage.setItem(INFO_KEY, JSON.stringify(info));
        return info;
      }
    } catch (error) {
      console.error('Error loading family info:', error);
    }
  }

  const local = localStorage.getItem(INFO_KEY);
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
    localStorage.setItem(localKey, JSON.stringify(value));
  } catch (e) {
    console.error('LocalStorage fallback failed', e);
  }
  return cloudOk;
}

async function loadReferenceDoc<T>(key: string, localKey: string): Promise<T | null> {
  const user = auth.currentUser;
  if (user) {
    try {
      const snap = await getDoc(doc(db, 'families', FAMILY_ID, 'reference', key));
      if (snap.exists()) {
        const data = snap.data() as T;
        localStorage.setItem(localKey, JSON.stringify(data));
        return data;
      }
    } catch (error) {
      console.error(`Error loading ${key}:`, error);
    }
  }
  const local = localStorage.getItem(localKey);
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

export const saveSettings = (s: HubSettings) => saveReferenceDoc('settings', s, 'family_settings');
export const loadSettings = () => loadReferenceDoc<HubSettings>('settings', 'family_settings');

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

  const newFamilyId = crypto.randomUUID();
  const now = new Date().toISOString().slice(0, 10);
  const email = user.email ?? '';
  const displayName = user.displayName ?? email;
  const uid = user.uid;

  const batch = writeBatch(db);

  batch.set(doc(db, 'families', newFamilyId, 'info', 'info'), {
    name: familyName,
    createdAt: now,
    adminUid: uid,
  } satisfies FamilyInfoDoc);

  batch.set(doc(db, 'families', newFamilyId, 'roles', uid), {
    role: 'admin' as FamilyRole,
    email,
    displayName,
  } satisfies FamilyMemberRole);

  batch.set(doc(db, 'users', uid), {
    familyId: newFamilyId,
    role: 'admin' as FamilyRole,
    email,
    displayName,
  } satisfies UserProfile);

  await batch.commit();
  setFamilyId(newFamilyId);
  return newFamilyId;
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

  setFamilyId(trimmedId);
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

// --- Chat history (stored on the user doc) ---
// Keep edits + applied so an already-applied card stays "Applied" after a reload
// or on a second device. NEVER persist image/sourceImage (base64 — bloats the doc).
type StoredChatMessage = { role: string; text: string; edits?: unknown[]; applied?: boolean };

export async function loadChatHistory(uid: string): Promise<StoredChatMessage[]> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      return (snap.data().chatHistory as StoredChatMessage[]) || [];
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
  // Defensive: strip any heavy/base64 fields before they reach Firestore.
  const slim = messages.slice(-50).map(({ role, text, edits, applied }) => {
    const m: StoredChatMessage = { role, text };
    if (edits) m.edits = edits;
    if (applied) m.applied = applied;
    return m;
  });
  await setDoc(doc(db, 'users', uid), { chatHistory: slim }, { merge: true });
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

// ── Passwords ── (admin-only; rules deny reads to members/children)
export async function loadPasswords(): Promise<PasswordEntry[]> {
  try {
    const snap = await getDocs(collection(db, 'families', FAMILY_ID, 'passwords'));
    const entries = snap.docs.map(d => d.data() as PasswordEntry);
    return entries.sort((a, b) => a.service.localeCompare(b.service));
  } catch (e) {
    // A non-admin should never reach this view, but if they do, a permission
    // denial must not throw — just show an empty vault.
    console.warn('loadPasswords denied or failed:', e);
    return [];
  }
}

export async function savePassword(entry: PasswordEntry): Promise<void> {
  await setDoc(doc(db, 'families', FAMILY_ID, 'passwords', entry.id), entry);
}

export async function deletePassword(id: string): Promise<void> {
  await deleteDoc(doc(db, 'families', FAMILY_ID, 'passwords', id));
}
