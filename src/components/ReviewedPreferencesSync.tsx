import { useEffect } from 'react';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth } from '../lib/firebase';
import { FAMILY_ID } from '../utils/db';
import { createImportInboxClient } from '../utils/importInboxClient';
import { applyReviewedPreferences } from '../utils/reviewedPreferences';

export default function ReviewedPreferencesSync() {
  const { uid, familyId, role, loading } = useFamilyCtx();
  useEffect(() => {
    if (loading || !uid || !familyId || !['admin', 'member'].includes(role)) return;
    let active = true;
    const api = createImportInboxClient({ getUser: () => auth.currentUser, getSpace: () => FAMILY_ID, getGeneration: () => active });
    void api.preferences().then(({ preferences }) => {
      if (active && auth.currentUser?.uid === uid && FAMILY_ID === familyId) applyReviewedPreferences(preferences, preferences.reviewedAt);
    }).catch(() => { /* saved device preferences remain usable offline */ });
    return () => { active = false; };
  }, [uid, familyId, role, loading]);
  return null;
}
