import type { FamilyActionsDoc } from '../types';
import { mergeShared } from './mergeShared';

export interface ActionSyncState {
  doc: FamilyActionsDoc;
  loading: boolean;
  saving: boolean;
  pendingRemote: boolean;
  notice: string;
}

interface Dependencies {
  load: () => Promise<FamilyActionsDoc | null>;
  save: (doc: FamilyActionsDoc, base: FamilyActionsDoc) => Promise<boolean>;
  subscribe: (receive: (doc: FamilyActionsDoc | null, commit: () => void) => void) => () => void;
  hasPendingLocal?: () => boolean;
}

/** One Actions subscription and save lifecycle, isolated from React/Firebase
 * so snapshot/read-back races can be exercised with deferred promises. */
export function createActionSync(deps: Dependencies, options: { enabled: boolean; demoDoc?: FamilyActionsDoc }) {
  const empty = (): FamilyActionsDoc => ({ items: [] });
  let state: ActionSyncState = { doc: empty(), loading: true, saving: false, pendingRemote: false, notice: '' };
  let base = empty();
  let active = false, editing = false, busy = false, pendingLocal = false, generation = 0, revision = 0;
  let held: { doc: FamilyActionsDoc; commit: () => void; revision: number } | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ActionSyncState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const adoptRemote = (doc: FamilyActionsDoc, commit: () => void) => {
    if (pendingLocal) {
      // A failed save is still local intent. Keep it across incoming snapshots,
      // and never let their commit callback replace the dirty device cache.
      const merged = mergeShared(base, state.doc, doc);
      base = doc;
      update({ doc: merged });
    } else {
      base = doc;
      update({ doc });
      commit();
    }
  };
  const flush = () => {
    if (!active || state.loading || editing || busy || !held) return;
    const next = held;
    held = null;
    adoptRemote(next.doc, next.commit);
    update({ pendingRemote: false });
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hold: (value: boolean) => { editing = value; },
    flush,
    start() {
      const mine = ++generation;
      active = true; busy = false; pendingLocal = false; revision = 0; held = null; base = empty();
      update({ doc: empty(), loading: true, saving: false, pendingRemote: false, notice: '' });
      const current = () => active && mine === generation;
      let unsubscribe = () => {};
      if (options.demoDoc) {
        base = options.demoDoc;
        update({ doc: options.demoDoc, loading: false });
      } else if (!options.enabled) update({ loading: false });
      else {
        const startRevision = revision;
        unsubscribe = deps.subscribe((doc, commit) => {
          if (!current() || !doc) return;
          revision += 1;
          if (state.loading || editing || busy) {
            held = { doc, commit, revision };
            update({ pendingRemote: true });
          } else adoptRemote(doc, commit);
        });
        void deps.load().then(doc => {
          if (!current()) return;
          if (doc && deps.hasPendingLocal?.()) {
            // Load retries existing dirty cache entries. If that retry is
            // still offline, their local intent outranks a live server copy.
            const remote = held?.doc || empty();
            base = remote;
            pendingLocal = true;
            held = null;
            update({ doc: mergeShared<FamilyActionsDoc>(undefined, doc, remote), pendingRemote: false,
              notice: 'Saved on this device. Cloud sync is pending; reload when you are online to retry.' });
          } else if (revision === startRevision) { base = doc || empty(); update({ doc: base }); }
          update({ loading: false });
          flush();
        }).catch(() => {
          if (current()) {
            update({ loading: false, ...(revision === startRevision ? { notice: 'Actions could not be loaded. Reload to try again.' } : {}) });
            flush();
          }
        });
      }
      return () => { active = false; generation += 1; held = null; unsubscribe(); };
    },
    async persist(items: FamilyActionsDoc['items']): Promise<boolean> {
      if (!active || busy || state.loading || (!options.enabled && !options.demoDoc)) return false;
      const mine = generation;
      const current = () => active && mine === generation;
      const next = { items }, saveBase = base;
      busy = true;
      update({ saving: true, notice: '' });
      try {
        if (options.demoDoc) { base = next; update({ doc: next }); return true; }
        const cloudOk = await deps.save(next, saveBase);
        if (!current()) return false;
        if (!cloudOk) {
          const remote = held?.doc;
          const pending = remote ? mergeShared(saveBase, next, remote) : next;
          base = remote || saveBase;
          pendingLocal = true;
          held = null;
          update({ doc: pending, pendingRemote: false, notice: 'Saved on this device. Cloud sync is pending; reload when you are online to retry.' });
          return true;
        }
        const readRevision = revision;
        let merged: FamilyActionsDoc;
        let refreshFailed = false;
        try { merged = await deps.load() || next; }
        catch { merged = held ? mergeShared(saveBase, next, held.doc) : next; refreshFailed = true; }
        if (!current()) return false;
        // A snapshot arriving DURING read-back can be newer than its result.
        // Older queued snapshots cannot undo the save we just confirmed.
        const newer = held && held.revision > readRevision ? held : null;
        held = null;
        pendingLocal = false;
        base = newer?.doc || merged;
        update({ doc: base, pendingRemote: false, ...(refreshFailed ? { notice: 'Saved. The latest shared list could not be refreshed; reload to check for updates.' } : {}) });
        newer?.commit();
        return true;
      } catch {
        if (current()) update({ notice: 'The action could not be saved. Your form is still here; try again.' });
        return false;
      } finally {
        if (current()) { busy = false; update({ saving: false }); flush(); }
      }
    },
  };
}
