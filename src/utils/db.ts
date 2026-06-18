import { FamilyMember, CalendarEvent, FamilyInfo } from '../types';
import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';

const MEMBERS_KEY = 'family_members';
const CALENDAR_KEY = 'family_calendar';
const INFO_KEY = 'family_info';

// One shared vault for the whole household. Every authorised family account
// (see firestore.rules) reads and writes this same path, so Mama, Papa and the
// kids all see the same family — instead of each Google account getting its own
// private island.
export const FAMILY_ID = 'household';

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

export const DEFAULT_EVENTS: CalendarEvent[] = [];
export const DEFAULT_FAMILY: FamilyMember[] = [];
