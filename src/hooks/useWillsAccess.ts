import { useCallback, useEffect, useState } from 'react';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { loadWillsAccess, purgeLocalWillsEstate } from '../utils/db';
import { canReadWills, canWriteWills, shouldPurgeLocalWills } from '../utils/willsAccess';
import type { WillsAccessDoc } from '../types';

/*
 * "Am I allowed to open Wills & Estate?" — asked in five places.
 *
 * WillsEstateView is the obvious one, but four other things read the estate
 * document without ever rendering that screen: the readiness score, the
 * needs-attention nudges, the AI chat context, and the AI apply path. Each of
 * those would otherwise fire a request the rule refuses, which is not just
 * noise — a nudge that says "your will hasn't been reviewed in 3 years" tells
 * a locked-out member the will exists and when it was last touched.
 *
 * The answer is a single doc read, so it is cached per (space, user) and
 * shared. Keyed by uid as well as familyId because this is a household app
 * on shared devices: signing out and back in as someone else must not inherit
 * the previous person's answer.
 *
 * THE RULE IS THE BOUNDARY, NOT THIS HOOK. See utils/willsAccess.ts.
 */

let cache: { key: string; promise: Promise<WillsAccessDoc | null> } | null = null;

/** Drop the cached answer — call after an admin changes who can open it. */
export function invalidateWillsAccess() {
  cache = null;
}

function fetchAccess(key: string): Promise<WillsAccessDoc | null> {
  if (!cache || cache.key !== key) {
    cache = { key, promise: loadWillsAccess().catch(() => null) };
  }
  return cache.promise;
}

export interface WillsAccessState {
  /** True until the answer is known. Treat as "not yet allowed", never as "allowed". */
  loading: boolean;
  mayRead: boolean;
  mayWrite: boolean;
  access: WillsAccessDoc | null;
  refresh: () => void;
}

export function useWillsAccess(): WillsAccessState {
  const { role, uid, familyId } = useFamilyCtx();
  const [access, setAccess] = useState<WillsAccessDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAccess(`${familyId}|${uid || ''}`).then((a) => {
      if (!active) return;
      setAccess(a);
      setLoading(false);
      // The lock has to reach the devices that already had the data. Nothing
      // else will clear it: from v230 a locked-out member never requests the
      // document, so the server never refuses, so loadReferenceDoc's own purge
      // never runs — see purgeLocalWillsEstate.
      if (shouldPurgeLocalWills(role, uid, a)) purgeLocalWillsEstate();
    });
    return () => { active = false; };
  }, [familyId, uid, role, nonce]);

  const refresh = useCallback(() => {
    invalidateWillsAccess();
    setNonce(n => n + 1);
  }, []);

  return {
    loading,
    access,
    mayRead: !loading && canReadWills(role, uid, access),
    mayWrite: !loading && canWriteWills(role),
    refresh,
  };
}
