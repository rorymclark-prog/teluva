import { useEffect, useRef, useState } from 'react';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { auth } from '../lib/firebase';
import { filePathFromReference, normalizeFileReference } from '../utils/fileReferences';
import { readProtectedPreview } from '../utils/protectedPreview';

export function useProtectedPreview(source: string) {
  const { uid, familyId, role } = useFamilyCtx();
  const scope = useRef({ uid, familyId, role }); scope.current = { uid, familyId, role };
  const [attempt, setAttempt] = useState(0);
  const protectedFile = !!filePathFromReference(source);
  const key = JSON.stringify([source, uid, familyId, role, attempt]);
  const [state, setState] = useState<{ key: string; source?: string; type?: string; error?: string }>({ key: '' });
  useEffect(() => {
    if (!protectedFile) return;
    let active = true, objectUrl: string | undefined;
    const controller = new AbortController();
    void readProtectedPreview(source, { getUser: () => auth.currentUser?.uid === scope.current.uid && scope.current.role === role ? auth.currentUser : null, getSpace: () => scope.current.familyId, signal: controller.signal }).then(blob => {
      if (!active || scope.current.uid !== uid || scope.current.familyId !== familyId || scope.current.role !== role) return;
      objectUrl = URL.createObjectURL(blob); setState({ key, source: objectUrl, type: blob.type });
    }).catch(error => { if (active) setState({ key, error: error instanceof Error ? error.message : 'Could not open this original. Try again.' }); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, protectedFile]);
  return { source: protectedFile ? (state.key === key ? state.source : undefined) : normalizeFileReference(source), type: protectedFile && state.key === key ? state.type : undefined, error: !source ? 'No original file is attached to this record.' : protectedFile && state.key === key ? state.error : undefined, loading: protectedFile && (state.key !== key || !state.source && !state.error), retry: () => setAttempt(value => value + 1) };
}
