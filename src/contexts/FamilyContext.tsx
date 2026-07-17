import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { FamilyRole, UserProfile, FamilyMemberRole } from '../types';
import { setFamilyId, ensureFamilyClaim } from '../utils/db';

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
          loading: false,
        });
      }
    });

    return unsub;
  }, []);

  return (
    <FamilyContext.Provider value={value}>
      {children}
    </FamilyContext.Provider>
  );
}
