import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { FamilyRole, UserProfile, FamilyMemberRole, AiConsent } from '../types';
import { setFamilyId, ensureFamilyClaim } from '../utils/db';
import { AI_CONSENT_VERSION, hasValidAiConsent } from '../utils/aiConsent';

// AI is only ever offered to adults (admin/member) — child accounts never use it.
const isAdultRole = (r: FamilyRole | null) => r === 'admin' || r === 'member';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { FamilyRole };

export interface FamilyCtxValue {
  familyId: string | null;  // null while loading or no family assigned
  role: FamilyRole | null;  // null while loading
  uid: string | null;       // firebase auth uid
  email: string | null;
  isAdmin: boolean;         // role === 'admin'
  canWrite: boolean;        // role === 'admin' || role === 'member'
  aiEligible: boolean;      // adult (admin/member) — child accounts never get AI
  aiConsent: boolean;       // has a valid, current AI opt-in
  setAiConsent: (granted: boolean) => Promise<void>;  // grant / withdraw
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Bootstrap map: these emails get auto-assigned to the 'household' family
// ---------------------------------------------------------------------------

const BOOTSTRAP_EMAILS: Record<string, FamilyRole> = {
  'rorymclark@gmail.com': 'admin',
  'partner@example.com': 'admin',
  'child@example.com': 'child',
};

// Emails that must always be admin — runs as a migration if doc already exists with a lower role.
const FORCE_ADMIN = new Set(['rorymclark@gmail.com', 'partner@example.com']);

// ---------------------------------------------------------------------------
// Context setup
// ---------------------------------------------------------------------------

const defaultValue: FamilyCtxValue = {
  familyId: null,
  role: null,
  uid: null,
  email: null,
  isAdmin: false,
  canWrite: false,
  aiEligible: false,
  aiConsent: false,
  setAiConsent: async () => {},
  loading: true,
};

export const FamilyContext = createContext<FamilyCtxValue>(defaultValue);

export function useFamilyCtx(): FamilyCtxValue {
  const ctx = useContext(FamilyContext);
  if (ctx === undefined) {
    throw new Error('useFamilyCtx must be used inside <FamilyProvider>');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function FamilyProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [value, setValue] = useState<FamilyCtxValue>(defaultValue);

  // Grant or withdraw AI consent — writes the user's own record and reflects it
  // immediately. Only adults can hold a positive flag (server + rules enforce too).
  const setAiConsent = useCallback(async (granted: boolean) => {
    const u = auth.currentUser;
    if (!u) return;
    const consent: AiConsent = { granted, at: new Date().toISOString(), version: AI_CONSENT_VERSION };
    await setDoc(doc(db, 'users', u.uid), { aiConsent: consent }, { merge: true });
    setValue(v => ({ ...v, aiConsent: granted && v.aiEligible }));
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setValue({
          familyId: null,
          role: null,
          uid: null,
          email: null,
          isAdmin: false,
          canWrite: false,
          aiEligible: false,
          aiConsent: false,
          setAiConsent,
          loading: false,
        });
        return;
      }

      const email = user.email ?? '';
      const uid = user.uid;
      const displayName = user.displayName ?? email;

      try {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          // User doc already exists — use stored familyId and role
          let profile = userSnap.data() as UserProfile;

          // Migration: upgrade role if email is in FORCE_ADMIN and not already admin
          if (FORCE_ADMIN.has(email) && profile.role !== 'admin') {
            profile = { ...profile, role: 'admin' };
            await setDoc(userRef, { role: 'admin' }, { merge: true });
            const rolesRef = doc(db, 'families', profile.familyId, 'roles', uid);
            await setDoc(rolesRef, { role: 'admin' }, { merge: true });
          }

          setFamilyId(profile.familyId);
          // Storage rules need the familyId custom claim — backfill it for
          // accounts created before claims existed (fire-and-forget).
          void ensureFamilyClaim();
          setValue({
            familyId: profile.familyId,
            role: profile.role,
            uid,
            email,
            isAdmin: profile.role === 'admin',
            canWrite: profile.role === 'admin' || profile.role === 'member',
            aiEligible: isAdultRole(profile.role),
            aiConsent: isAdultRole(profile.role) && hasValidAiConsent(profile.aiConsent),
            setAiConsent,
            loading: false,
          });
          return;
        }

        // No user doc yet — check bootstrap map
        const bootstrapRole = BOOTSTRAP_EMAILS[email] ?? null;

        if (bootstrapRole !== null) {
          const familyId = 'household';
          const profile: UserProfile = {
            familyId,
            role: bootstrapRole,
            email,
            displayName,
          };

          // Write users/{uid}
          await setDoc(userRef, profile);

          // Update families/{familyId}/roles with this user's entry
          const rolesRef = doc(db, 'families', familyId, 'roles', uid);
          const memberRole: FamilyMemberRole = {
            role: bootstrapRole,
            email,
            displayName,
          };
          await setDoc(rolesRef, memberRole, { merge: true });

          // Ensure info/info doc exists so the join flow can validate this family
          const infoRef = doc(db, 'families', familyId, 'info', 'info');
          await setDoc(infoRef, { name: 'Our Family', createdAt: new Date().toISOString() }, { merge: true });

          setFamilyId(familyId);
          setValue({
            familyId,
            role: bootstrapRole,
            uid,
            email,
            isAdmin: bootstrapRole === 'admin',
            canWrite: bootstrapRole === 'admin' || bootstrapRole === 'member',
            aiEligible: isAdultRole(bootstrapRole),
            aiConsent: isAdultRole(bootstrapRole) && hasValidAiConsent(profile.aiConsent),
            setAiConsent,
            loading: false,
          });
          return;
        }

        // Unknown email — send to onboarding
        setValue({
          familyId: null,
          role: null,
          uid,
          email,
          isAdmin: false,
          canWrite: false,
          aiEligible: false,
          aiConsent: false,
          setAiConsent,
          loading: false,
        });
      } catch (err) {
        console.error('FamilyProvider: error resolving user doc', err);
        // Fail safe — clear loading but leave familyId null
        setValue({
          familyId: null,
          role: null,
          uid,
          email,
          isAdmin: false,
          canWrite: false,
          aiEligible: false,
          aiConsent: false,
          setAiConsent,
          loading: false,
        });
      }
    });

    return unsub;
  }, [setAiConsent]);

  return (
    <FamilyContext.Provider value={value}>
      {children}
    </FamilyContext.Provider>
  );
}
