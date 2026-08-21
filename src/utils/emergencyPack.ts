import type { FamilyMember, IdCountry, IdentityRecord, MedicalRecord } from '../types';

const PACK_VERSION = 2 as const;
export const EMERGENCY_SHELL_VERSION = 'v252';
const ACTIVE_SCOPE_KEY = 'teluva.emergencyPack.active.v2';
const LEGACY_PACK_KEY = 'teluva.emergencyPack.v1';
const PACK_KEY_PREFIX = 'teluva.emergencyPack.v2:';

export interface EmergencyPackScope {
  ownerUid: string;
  spaceId: string;
  spaceName: string;
}

export interface EmergencyPack extends EmergencyPackScope {
  version: typeof PACK_VERSION;
  savedAt: string;
  shellVerifiedAt?: string;
  shellVersion?: string;
  country: IdCountry;
  members: FamilyMember[];
}

type EmergencyMedical = Pick<MedicalRecord,
  'bloodGroup' | 'allergies' | 'medications' | 'conditions' | 'emergencyMedication' | 'organDonor'
>;
type EmergencyIdentity = Pick<IdentityRecord, 'svNumber' | 'eCardNumber'>;

function storageKey(scope: Pick<EmergencyPackScope, 'ownerUid' | 'spaceId'>): string {
  return `${PACK_KEY_PREFIX}${encodeURIComponent(scope.ownerUid)}:${encodeURIComponent(scope.spaceId)}`;
}

function sameScope(a: Pick<EmergencyPackScope, 'ownerUid' | 'spaceId'>, b: Pick<EmergencyPackScope, 'ownerUid' | 'spaceId'>): boolean {
  return a.ownerUid === b.ownerUid && a.spaceId === b.spaceId;
}

function medicalAllowlist(record?: MedicalRecord): EmergencyMedical | undefined {
  if (!record) return undefined;
  return {
    bloodGroup: record.bloodGroup,
    allergies: record.allergies,
    medications: record.medications,
    conditions: record.conditions,
    emergencyMedication: record.emergencyMedication,
    organDonor: record.organDonor,
  };
}

function identityAllowlist(record?: IdentityRecord): EmergencyIdentity | undefined {
  if (!record) return undefined;
  return { svNumber: record.svNumber, eCardNumber: record.eCardNumber };
}

export function buildEmergencyPack(
  members: FamilyMember[],
  country: IdCountry,
  scope: EmergencyPackScope,
  savedAt = new Date().toISOString(),
): EmergencyPack {
  return {
    version: PACK_VERSION,
    savedAt,
    country,
    ...scope,
    members: members.map(member => ({
      id: member.id,
      name: member.name,
      role: member.role,
      birthdate: member.birthdate,
      avatarColor: member.avatarColor,
      clothingSizes: {},
      documents: [],
      emergencyContactName: member.emergencyContactName,
      emergencyContactPhone: member.emergencyContactPhone,
      medical: medicalAllowlist(member.medical),
      identity: identityAllowlist(member.identity),
      employer: member.employer,
      jobTitle: member.jobTitle,
      workPhone: member.workPhone,
      workAddress: member.workAddress,
    })),
  };
}

export function activateEmergencyPackScope(scope: EmergencyPackScope): void {
  try {
    localStorage.removeItem(LEGACY_PACK_KEY);
    localStorage.setItem(ACTIVE_SCOPE_KEY, JSON.stringify(scope));
  } catch { /* storage can be denied */ }
}

export function saveEmergencyPack(members: FamilyMember[], country: IdCountry, scope: EmergencyPackScope): EmergencyPack {
  const pack = buildEmergencyPack(members, country, scope);
  localStorage.setItem(storageKey(scope), JSON.stringify(pack));
  activateEmergencyPackScope(scope);
  return pack;
}

function readScope(): EmergencyPackScope | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_SCOPE_KEY) || 'null') as Partial<EmergencyPackScope> | null;
    if (!value || typeof value.ownerUid !== 'string' || typeof value.spaceId !== 'string' || typeof value.spaceName !== 'string') return null;
    return value as EmergencyPackScope;
  } catch {
    return null;
  }
}

export function loadEmergencyPack(scope?: EmergencyPackScope): EmergencyPack | null {
  try {
    localStorage.removeItem(LEGACY_PACK_KEY);
    const requestedScope = scope || readScope();
    if (!requestedScope) return null;
    const value = JSON.parse(localStorage.getItem(storageKey(requestedScope)) || 'null') as Partial<EmergencyPack> | null;
    if (
      !value || value.version !== PACK_VERSION || !Array.isArray(value.members) ||
      typeof value.savedAt !== 'string' || typeof value.ownerUid !== 'string' ||
      typeof value.spaceId !== 'string' || typeof value.spaceName !== 'string' ||
      !sameScope(value as EmergencyPackScope, requestedScope)
    ) return null;
    return value as EmergencyPack;
  } catch {
    return null;
  }
}

export function markEmergencyPackVerified(scope: EmergencyPackScope, verifiedAt = new Date().toISOString()): EmergencyPack | null {
  const pack = loadEmergencyPack(scope);
  if (!pack) return null;
  const verified = { ...pack, shellVerifiedAt: verifiedAt, shellVersion: EMERGENCY_SHELL_VERSION };
  localStorage.setItem(storageKey(scope), JSON.stringify(verified));
  return verified;
}

export function isEmergencyPackOfflineReady(pack: EmergencyPack | null): boolean {
  return !!pack?.shellVerifiedAt && pack.shellVersion === EMERGENCY_SHELL_VERSION;
}

export function removeEmergencyPack(scope: EmergencyPackScope): void {
  localStorage.removeItem(storageKey(scope));
  const active = readScope();
  if (active && sameScope(active, scope)) localStorage.removeItem(ACTIVE_SCOPE_KEY);
}

export async function prepareEmergencyShell(timeoutMs = 15000): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('Offline opening is not supported by this browser.');
  }

  const registration = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js'));
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Offline preparation timed out.')), timeoutMs)),
  ]);
  const worker = ready.active || registration.active;
  if (!worker) throw new Error('The offline helper is not active yet.');

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => reject(new Error('Offline preparation timed out.')), timeoutMs);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      if (event.data?.ok && event.data?.version === EMERGENCY_SHELL_VERSION) resolve();
      else reject(new Error(event.data?.error || 'The offline shell could not be verified.'));
    };
    worker.postMessage({ type: 'PREPARE_EMERGENCY_SHELL' }, [channel.port2]);
  });
}
