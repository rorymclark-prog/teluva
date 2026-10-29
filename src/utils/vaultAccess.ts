// Non-sensitive state only. A failed reveal must not become a blank editable
// record or a ciphertext-looking password. The app pauses record display until
// the account can safely open it; the standalone offline emergency route is
// deliberately independent of this state.
export type VaultAccessReason = 'admin-refresh' | 'unavailable';
export interface VaultAccessIssue { spaceId: string; reason: VaultAccessReason }
let currentSpace: string | null = null;
let currentOwner: string | null = null;
let issue: VaultAccessIssue | null = null;
const listeners = new Set<() => void>();

export function setVaultAccessScope(spaceId: string, ownerUid: string | null = null): void {
  const previous = issue;
  if (currentOwner !== ownerUid || issue?.spaceId !== spaceId) issue = null;
  currentSpace = spaceId;
  currentOwner = ownerUid;
  if (previous !== issue) listeners.forEach(listener => listener());
}

export const getVaultCacheScope = (): string | null => currentSpace && currentOwner
  ? `${encodeURIComponent(currentOwner)}:${encodeURIComponent(currentSpace)}` : null;

export function reportVaultAccessIssue(reason: VaultAccessReason, spaceId = currentSpace): void {
  if (!spaceId || spaceId !== currentSpace || (issue?.spaceId === spaceId && (issue.reason === reason || issue.reason === 'admin-refresh'))) return;
  issue = { spaceId, reason };
  listeners.forEach(listener => listener());
}

export const subscribeVaultAccess = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getVaultAccessIssue = (): VaultAccessIssue | null => issue;
