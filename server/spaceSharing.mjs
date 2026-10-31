// Family sharing features must not turn business HR records into public data.
// Consult the current authoritative space type even for already-issued links.
export function includesCalendarOccasions(spaceInfo, publication) {
  return !!spaceInfo && spaceInfo.type !== 'business'
    && publication?.includeOccasions === true && publication?.mode !== 'busy';
}

export async function loadCalendarPublicationSources(publication, dependencies) {
  const { readSpaceInfo, readEvents, readOccasions, readHiddenLists } = dependencies;
  // This read must finish before any HR-derived source is requested. A failed
  // lookup throws rather than treating an unknown business as a family.
  const spaceInfo = await readSpaceInfo(publication.familyId);
  const [events, occasionSources, hiddenLists] = await Promise.all([
    readEvents(publication.familyId),
    includesCalendarOccasions(spaceInfo, publication) ? readOccasions(publication.familyId) : null,
    readHiddenLists(publication.familyId, publication.createdBy),
  ]);
  return { spaceInfo, events, occasionSources, hiddenLists };
}

export async function carerManagementAccess(caller, operation, readSpaceInfo) {
  if (caller.role === 'child' && operation !== 'list') {
    return { status: 403, error: 'This account can view family carer links but cannot change them.' };
  }
  const spaceInfo = await readSpaceInfo(caller.familyId);
  return !spaceInfo || spaceInfo.type === 'business'
    ? { status: 403, error: 'Carer links are only available in family spaces.' }
    : null;
}

export async function carerPublicAccess(record, readSpaceInfo, now = Date.now()) {
  if (!record) return 404;
  // A legacy business token must stop working without waiting for expiry or
  // requiring a bulk rewrite of previously issued bearer links.
  const spaceInfo = await readSpaceInfo(record.familyId);
  if (!spaceInfo || spaceInfo.type === 'business') return 404;
  const expired = !!(record.expiresAt && new Date(record.expiresAt).getTime() < now);
  return record.revoked || expired ? 410 : 200;
}
