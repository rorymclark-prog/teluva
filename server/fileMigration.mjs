import { isEstateFile, sourceMemberIds, sharedFileNamespace } from './files.mjs';

/** Metadata-only plan. No file bytes are read; callers log counts only. */
export function fileRetirementPlan(path, info, snapshot, bucketName) {
  const previous = info.metadata || {};
  const estate = isEstateFile(path, info, snapshot.estate, snapshot.documents, bucketName);
  const profileIds = new Set();
  try { for (const id of JSON.parse(previous.teluvaProfileIds || '[]')) if (typeof id === 'string') profileIds.add(id); } catch { /* recover from authoritative sources */ }
  // Existing immutable ownership wins. Re-running a migration must not add
  // grants from a member's later editable copy of someone else's file URL.
  const hasTrustedOwners = profileIds.size > 0 || !!previous.teluvaOwnerUid;
  if (!hasTrustedOwners) {
    for (const id of sourceMemberIds(path, snapshot.members || [], bucketName)) profileIds.add(id);
  }
  const custom = { ...previous, firebaseStorageDownloadTokens: null };
  if (estate) custom.teluvaAccess = 'estate';
  if (profileIds.size) custom.teluvaProfileIds = JSON.stringify([...profileIds].sort());
  const ambiguousBusiness = snapshot.spaceInfo?.type === 'business'
    && (previous.teluvaProfileBinding === 'inventory-ambiguous' || (!hasTrustedOwners && profileIds.size > 1));
  if (ambiguousBusiness) custom.teluvaProfileBinding = 'inventory-ambiguous';
  if (sharedFileNamespace(path)) custom.teluvaScope = 'shared';
  return {
    hasDownloadTokens: typeof previous.firebaseStorageDownloadTokens === 'string' && previous.firebaseStorageDownloadTokens.length > 0,
    estate, profileBound: profileIds.size > 0, ambiguousBusiness,
    unknownBusiness: snapshot.spaceInfo?.type === 'business' && !profileIds.size && !previous.teluvaOwnerUid && custom.teluvaScope !== 'shared',
    publicAcl: (info.acl || []).some(entry => ['allUsers', 'allAuthenticatedUsers'].includes(entry.entity)),
    metadata: { metadata: custom, cacheControl: 'private, no-store, max-age=0' },
    preconditions: { ifMetagenerationMatch: String(info.metageneration) },
  };
}
