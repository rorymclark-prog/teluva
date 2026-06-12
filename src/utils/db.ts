import { FamilyMember, CalendarEvent } from '../types';
import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';

const MEMBERS_KEY = 'family_members';
const CALENDAR_KEY = 'family_calendar';

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
        const docRef = doc(db, 'users', user.uid, 'family_members', member.id);
        batch.set(docRef, member, { merge: true });
      }

      // Handle deleted members by maintaining a list of active IDs in a metadata doc
      const metaRef = doc(db, 'users', user.uid, 'metadata', 'members');
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
      const metaRef = doc(db, 'users', user.uid, 'metadata', 'members');
      const metaSnap = await getDoc(metaRef);
      
      if (metaSnap.exists()) {
        const ids = metaSnap.data().ids as string[];
        const membersReqs = ids.map(id => getDoc(doc(db, 'users', user.uid, 'family_members', id)));
        const snaps = await Promise.all(membersReqs);
        const members = snaps.map(s => s.data() as FamilyMember).filter(Boolean);
        
        // Cache locally
        localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
        return members.length > 0 ? members : null;
      }
    } catch (error) {
      console.error('Error loading from Firestore:', error);
    }
  }
  
  // Fallback to local
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
        const docRef = doc(db, 'users', user.uid, 'calendar_events', event.id);
        batch.set(docRef, event, { merge: true });
      }

      const metaRef = doc(db, 'users', user.uid, 'metadata', 'events');
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
      const metaRef = doc(db, 'users', user.uid, 'metadata', 'events');
      const metaSnap = await getDoc(metaRef);
      
      if (metaSnap.exists()) {
        const ids = metaSnap.data().ids as string[];
        const eventReqs = ids.map(id => getDoc(doc(db, 'users', user.uid, 'calendar_events', id)));
        const snaps = await Promise.all(eventReqs);
        const events = snaps.map(s => s.data() as CalendarEvent).filter(Boolean);
        
        localStorage.setItem(CALENDAR_KEY, JSON.stringify(events));
        return events.length > 0 ? events : null;
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

export const DEFAULT_EVENTS: CalendarEvent[] = [];
export const DEFAULT_FAMILY: FamilyMember[] = [];

