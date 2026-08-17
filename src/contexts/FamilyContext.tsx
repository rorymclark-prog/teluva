import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { FamilyRole, UserProfile, FamilyMemberRole, AiConsent, SpaceMembership } from '../types';
import { setFamilyId, ensureFamilyClaim } from '../utils/db';
import { AI_CONSENT_VERSION, hasValidAiConsent } from '../utils/aiConsent';

// AI is only ever offered to adults (admin/member) — child accounts never use it.
const isAdultRole = (r: FamilyRole | null) => r === 'admin' || r === 'member';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { FamilyRole };

export interface FamilyCtxValue {
  familyId: string | null;  // null while loading, no family assigned, OR the lookup failed — see loadError
  role: FamilyRole | null;  // null while loading — the caller's role in the ACTIVE space
  uid: string | null;       // firebase auth uid
  email: string | null;
  isAdmin: boolean;         // role === 'admin'
  canWrite: boolean;        // role === 'admin' || role === 'member'
  aiEligible: boolean;      // adult (admin/member) — child accounts never get AI
  aiConsent: boolean;       // has a valid, current AI opt-in
  setAiConsent: (granted: boolean) => Promise<void>;  // grant / withdraw
  spaces: SpaceMembership[]; // every space (family/business) this user belongs to — always has at
                             // least the active one, even for accounts written before spaces[] existed
  loading: boolean;
  // Set only when the users/{uid} lookup itself THREW (network blip, quota
  // exhaustion, cold-start hiccup) — as opposed to the lookup succeeding and
  // simply finding no doc. Both cases leave familyId null, but they must not
  // be shown the same screen: a real "you're new here, create a family"
  // never happened for this signed-in person, and FamilyOnboarding's create/
  // join flow can WRITE a brand-new family doc, which would silently orphan
  // an existing account from its real vault if submitted while the read path
  // is broken. App.tsx must check this before falling through to onboarding.
  loadError: string | null;
}

// ---------------------------------------------------------------------------
// Bootstrap map: these emails get auto-assigned to the 'household' family
// ---------------------------------------------------------------------------

/*
 * Seed roles by email address. DELIBERATELY EMPTY.
 *
 * This shipped with three real Gmail addresses hardcoded, which meant they were
 * compiled into the JavaScript bundle that every visitor downloads — personal
 * addresses handed to anyone who opened devtools.
 *
 * Emptying them costs nothing, because firestore.rules already makes both paths
 * inert: `families/{id}/roles/{uid}` is `allow create: if false`, and its update
 * rule requires isAdminOf() — so the "promote me to admin" write only succeeds
 * for someone who is already an admin. Roles are assigned server-side and by
 * invite; that is the only path that has ever actually worked.
 *
 * If a bootstrap is ever needed again, it belongs in a deploy-time environment
 * variable read by the server, not in client source.
 */
const BOOTSTRAP_EMAILS: Record<string, FamilyRole> = {};

const FORCE_ADMIN = new Set<string>([]);

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
  spaces: [],
  loading: true,
  loadError: null,
};

// Every account has at least one space (its active one) even if `spaces[]`
// hasn't been backfilled server-side yet — synthesize it client-side so no
// migration script is needed before this field can be relied on.
function withSpacesFallback(profile: { familyId: string; role: FamilyRole; spaces?: SpaceMembership[] }): SpaceMembership[] {
  if (profile.spaces && profile.spaces.length > 0) return profile.spaces;
  return [{ id: profile.familyId, role: profile.role, type: 'family' }];
}

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
          spaces: [],
          loading: false,
          loadError: null,
        });
        return;
      }

      const email = user.email ?? '';
      const uid = user.uid;
      const displayName = user.displayName ?? email;

      /* Publish the identity the moment auth resolves, before the profile read
         below goes to the network. Everything after this point is a Firestore
         round trip with no local cache behind it, so on a cold start — the one
         right after an update, when the service worker has just been replaced —
         it can hang for a long time. While it hung, `uid` was still null, and a
         null uid is what the app uses to decide you are a stranger. So a signed-
         in person sat looking at the sign-in screen until the read came back.
         `loading` stays true, so the app shows its spinner rather than a
         half-populated dashboard. */
      setValue(v => ({ ...v, uid, email }));

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
            spaces: withSpacesFallback(profile),
            loading: false,
            loadError: null,
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
            spaces: [{ id: familyId, role: bootstrapRole, type: 'family' }],
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
            spaces: profile.spaces!,
            loading: false,
            loadError: null,
          });
          return;
        }

        // Unknown email, and the lookup itself succeeded (we definitively
        // know there's no users/{uid} doc) — this really is a new person.
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
          spaces: [],
          loading: false,
          loadError: null,
        });
      } catch (err) {
        // The lookup ITSELF failed — network blip, cold-start hiccup, a
        // Firestore quota error, etc. We have no idea whether this account
        // has a family or not. Do NOT let this collapse into the same state
        // as "confirmed new user": that sends people to FamilyOnboarding,
        // whose create-family flow can WRITE a brand-new family doc — for an
        // existing member that would silently orphan their real vault the
        // moment they submit it while looking at what reads as a normal
        // "let's get you set up" screen. Surface loadError instead; App.tsx
        // shows a retry screen, not onboarding, whenever this is set.
        const message = err instanceof Error ? err.message : String(err);
        console.error('FamilyProvider: error resolving user doc', err);
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
          spaces: [],
          loading: false,
          loadError: message,
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
