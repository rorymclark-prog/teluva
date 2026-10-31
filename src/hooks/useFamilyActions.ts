import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { FamilyActionsDoc } from '../types';
import { FAMILY_ID, loadActions, saveActions, subscribeReferenceDoc } from '../utils/db';
import { demoActions } from '../utils/demoActions';
import { createActionSync } from '../utils/actionSync';
import { isDirty } from '../utils/pendingSync';

/** One live worklist shared by Pulse and People. A scope change discards both
 * the visible state and held snapshots; stale async work cannot enter a new hub.
 * The editor holds incoming snapshots so its exact merge base stays intact. */
export function useFamilyActions({ scope, enabled, demo, editing, isBusinessSpace = false }: {
  scope: string; enabled: boolean; demo: boolean; editing: boolean; isBusinessSpace?: boolean;
}) {
  // A scope change creates an immediately empty, loading store during render;
  // neither a previous hub's rows nor its save callback can enter the next one.
  const store = useMemo(() => {
    const spaceId = FAMILY_ID;
    return createActionSync({
      load: loadActions,
      save: saveActions,
      subscribe: receive => subscribeReferenceDoc<FamilyActionsDoc>('actions', receive),
      hasPendingLocal: () => isDirty('actions', spaceId),
    }, { enabled, ...(demo ? { demoDoc: demoActions(isBusinessSpace) } : {}) });
  }, [scope, enabled, demo, isBusinessSpace]);
  store.hold(editing);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => store.start(), [store]);
  useEffect(() => { store.flush(); }, [store, editing]);
  return { actions: state.doc.items, loading: state.loading, saving: state.saving, pendingRemote: state.pendingRemote, notice: state.notice, persist: store.persist };
}
