import type { FamilyMember, IdCountry } from '../types';

const EMERGENCY_PACK_KEY = 'teluva.emergencyPack.v1';

export interface EmergencyPack {
  version: 1;
  savedAt: string;
  country: IdCountry;
  members: FamilyMember[];
}

export function buildEmergencyPack(members: FamilyMember[], country: IdCountry, savedAt = new Date().toISOString()): EmergencyPack {
  return {
    version: 1,
    savedAt,
    country,
    members: members.map(member => ({
      id: member.id,
      name: member.name,
      nickname: member.nickname,
      role: member.role,
      birthdate: member.birthdate,
      avatarColor: member.avatarColor,
      clothingSizes: {},
      documents: [],
      emergencyContactName: member.emergencyContactName,
      emergencyContactPhone: member.emergencyContactPhone,
      identity: member.identity,
      medical: member.medical,
      employer: member.employer,
      jobTitle: member.jobTitle,
      workPhone: member.workPhone,
      workAddress: member.workAddress,
    })),
  };
}

export function saveEmergencyPack(members: FamilyMember[], country: IdCountry): EmergencyPack {
  const pack = buildEmergencyPack(members, country);
  localStorage.setItem(EMERGENCY_PACK_KEY, JSON.stringify(pack));
  return pack;
}

export function loadEmergencyPack(): EmergencyPack | null {
  try {
    const value = JSON.parse(localStorage.getItem(EMERGENCY_PACK_KEY) || 'null') as Partial<EmergencyPack> | null;
    if (!value || value.version !== 1 || !Array.isArray(value.members) || typeof value.savedAt !== 'string') return null;
    return value as EmergencyPack;
  } catch {
    return null;
  }
}

export function removeEmergencyPack(): void {
  localStorage.removeItem(EMERGENCY_PACK_KEY);
}
