import { isFamilyActionsDoc } from './actions';
import { fileContentUrl, isFamilyFilePath } from './fileReferences';
import type { AssetItem, FamilyMember } from '../types';

const ARRAY_SECTIONS = ['members', 'calendarEvents', 'documents', 'assets', 'slips', 'recipes', 'shopping'] as const;
const OBJECT_SECTIONS = ['info', 'household', 'finances', 'timeline', 'businessMilestones', 'willsEstate', 'inMemory', 'actions', 'settings'] as const;
export type BackupSection = typeof ARRAY_SECTIONS[number] | typeof OBJECT_SECTIONS[number];

/** Validate every section before starting writes, including old JSON-only backups. */
export function backupRestorePlan(data: unknown): { section: BackupSection; value: any }[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid-backup');
  const backup = data as Record<string, unknown>;
  const plan: { section: BackupSection; value: any }[] = [];
  for (const section of [...ARRAY_SECTIONS, ...OBJECT_SECTIONS]) {
    const value = backup[section];
    if (value === undefined || value === null) continue;
    const valid = (ARRAY_SECTIONS as readonly string[]).includes(section)
      ? Array.isArray(value)
      : typeof value === 'object' && !Array.isArray(value);
    if (!valid || (section === 'actions' && !isFamilyActionsDoc(value))) throw new Error(`invalid-backup-${section}`);
    if (section === 'assets' && !(value as any[]).every(asset => asset && typeof asset.id === 'string' && asset.id && typeof asset.name === 'string')) throw new Error('invalid-backup-assets');
    // The backup intentionally omits bearer download URLs. Existing objects
    // remain usable through their authenticated path after a same-space restore.
    const restored = section === 'documents' ? (value as any[]).map(document => ({
      ...document,
      ...(!document.downloadUrl && typeof document.storagePath === 'string' && isFamilyFilePath(document.storagePath)
        ? { downloadUrl: fileContentUrl(document.storagePath) } : {}),
    })) : value;
    plan.push({ section, value: restored });
  }
  if (!plan.length) throw new Error('invalid-backup');
  return plan;
}

/** Profile CV/work files and asset evidence are not necessarily in the shared Vault. */
export function profileAndAssetBackupFiles(data: { members?: FamilyMember[]; assets?: AssetItem[] }): { src: string; name: string }[] {
  const items: { src: string; name: string }[] = [];
  const leaf = (value: string) => value.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+$/, '_') || 'file';
  for (const member of data.members || []) {
    for (const document of member.documents || []) {
      if (document.fileData && document.fileData !== 'PLACEHOLDER') items.push({ src: document.fileData, name: `profiles/${leaf(member.name)}/${leaf(document.fileName || document.name)}` });
    }
    for (const referral of member.referrals || []) {
      if (referral.downloadUrl) items.push({ src: referral.downloadUrl, name: `profiles/${leaf(member.name)}/results/${leaf(referral.fileName || referral.id)}` });
    }
  }
  for (const asset of data.assets || []) {
    const sources = [asset.photoDataUrl, ...(asset.photos || []), asset.receiptDataUrl].filter((value): value is string => !!value);
    [...new Set(sources)].forEach((src, index) => items.push({ src, name: `assets/${leaf(asset.name)}/evidence-${index + 1}` }));
  }
  return items;
}

/** A pending save is reported, and changing space/account stops the remaining writes. */
export async function restoreBackupRecords(
  data: unknown,
  save: (section: BackupSection, value: any) => Promise<boolean | void>,
  isCurrent: () => boolean,
): Promise<BackupSection[]> {
  const plan = backupRestorePlan(data);
  const pending: BackupSection[] = [];
  for (const { section, value } of plan) {
    if (!isCurrent()) throw new Error('backup-scope-changed');
    if (await save(section, value) === false) pending.push(section);
    if (!isCurrent()) throw new Error('backup-scope-changed');
  }
  return pending;
}
