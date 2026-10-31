import type { FamilyRole } from '../types';

export function accountRoleFromData(data: { role?: unknown } | null | undefined): FamilyRole | null {
  return data && (data.role === 'admin' || data.role === 'member' || data.role === 'child') ? data.role : null;
}

export function profileWithAuthoritativeRole<T extends { role?: unknown }>(profile: T, roleData: { role?: unknown } | null | undefined): T & { role: FamilyRole } {
  const role = accountRoleFromData(roleData);
  if (!role) throw new Error('Your access to this space has changed. Reload to choose an available space.');
  return { ...profile, role };
}

export interface RoleSnapshot { exists: boolean; role?: unknown; fromCache?: boolean }
interface WatchOptions {
  initialRole: FamilyRole;
  subscribe: (next: (snapshot: RoleSnapshot) => void, error: (error: { code?: string }) => void) => () => void;
  onChange: (role: FamilyRole) => void;
  onRemoved: () => void;
  onTransientError?: (error: { code?: string }) => void;
  schedule?: (callback: () => void) => unknown;
  cancel?: (timer: unknown) => void;
}

/** Ignore cached capability grants and every callback from an old account or
 * space subscription. A terminal listener error is retried without treating
 * a network failure as proof that the member has been removed. */
export function watchAccountRole(options: WatchOptions): () => void {
  const schedule = options.schedule || (callback => setTimeout(callback, 1500));
  const cancel = options.cancel || (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let active = true;
  let generation = 0;
  let stop = () => {};
  let retry: unknown;
  const finish = (callback: () => void) => {
    if (!active) return;
    active = false;
    generation += 1;
    stop();
    if (retry !== undefined) cancel(retry);
    callback();
  };
  const start = () => {
    if (!active) return;
    const mine = ++generation;
    const unsubscribe = options.subscribe(snapshot => {
      if (!active || mine !== generation || snapshot.fromCache) return;
      const role = snapshot.exists ? accountRoleFromData(snapshot) : null;
      if (!role) finish(options.onRemoved);
      else if (role !== options.initialRole) finish(() => options.onChange(role));
    }, error => {
      if (!active || mine !== generation) return;
      if (error.code === 'permission-denied' || error.code === 'firestore/permission-denied') return finish(options.onRemoved);
      generation += 1;
      stop();
      options.onTransientError?.(error);
      retry = schedule(() => { retry = undefined; start(); });
    });
    if (!active || mine !== generation) unsubscribe();
    else stop = unsubscribe;
  };
  start();
  return () => {
    active = false;
    generation += 1;
    stop();
    if (retry !== undefined) cancel(retry);
  };
}

/** Remove app data at a real authorization change, retaining migration guards
 * so an old local copy can never be re-uploaded as a first-run migration. */
export function purgeAccountRoleCaches(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, spaceId: string, uid: string): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => key !== null);
  for (const key of keys) {
    if ((key.startsWith('family_') && key.endsWith(`_${spaceId}`) && !key.startsWith('family_migrated_'))
      || key.startsWith(`family_mergeBase_${uid}_${spaceId}::`)
      || key.startsWith('family_vault_reveal') || key.startsWith('vault_reveal_cache')) storage.removeItem(key);
  }
}

export function applyAccountRoleChange(role: FamilyRole | null, effects: {
  setRole: (role: FamilyRole | null) => void; purge: () => void; reload: () => void;
}): void {
  effects.setRole(role);
  effects.purge();
  effects.reload();
}
