import type { AssetItem } from '../types';

const DAY_MS = 86_400_000;

/** Reject impossible dates instead of rolling them into another month. */
export function assetDateMs(value?: string): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

export function isIncidentAsset(item: AssetItem): boolean {
  return ['stolen', 'lost', 'damaged'].includes(item.status || 'owned');
}

export function validateAssetRegister(item: AssetItem): string | null {
  for (const cover of item.warranties || []) {
    if (cover.startDate && assetDateMs(cover.startDate) === null) return 'Enter a valid warranty start date.';
    if (cover.endDate && assetDateMs(cover.endDate) === null) return 'Enter a valid warranty end date.';
    if (cover.startDate && cover.endDate && cover.startDate > cover.endDate) return 'A warranty must end on or after its start date.';
  }
  return null;
}

export interface AssetReminder {
  id: string;
  assetId: string;
  label: string;
  date: string;
  days: number;
}

export function assetReminders(items: readonly AssetItem[], now = new Date()): AssetReminder[] {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const out: AssetReminder[] = [];
  for (const item of items) {
    if (item.status && item.status !== 'owned' && item.status !== 'damaged') continue;
    const add = (id: string, date: string | undefined, label: string, lead: number) => {
      const ms = assetDateMs(date);
      if (ms === null) return;
      const days = Math.round((ms - today) / DAY_MS);
      if (days >= 0 && days <= lead) out.push({ id: `${item.id}-${id}`, assetId: item.id, label, date: date!, days });
    };
    for (const cover of item.warranties || []) {
      const lead = cover.reminderDays ?? [30, 7];
      if (!lead.length) continue;
      const kind = cover.kind === 'extended' ? 'Extended cover' : cover.kind === 'retailer' ? 'Retailer warranty' : 'Manufacturer warranty';
      add(cover.id, cover.endDate, `${item.name}: ${kind} ends`, Math.max(...lead.filter(n => Number.isFinite(n) && n >= 0), 0));
    }
    // A pre-existing expiry remains visible without labelling its provider or type.
    if (!(item.warranties || []).some(c => c.endDate === item.warrantyUntil)) {
      add('legacy', item.warrantyUntil, `${item.name}: recorded warranty ends`, 30);
    }
    add('return', item.returnByDate, `${item.name}: recorded return window ends`, 7);
  }
  return out.sort((a, b) => a.days - b.days || a.label.localeCompare(b.label));
}

/** A filing checklist, never an assertion that an insurer will pay. */
export function assetRecordChecklist(item: AssetItem): { label: string; recorded: boolean }[] {
  return [
    { label: 'Identifying details', recorded: !!(item.serialNumber || (item.make && item.model)) },
    { label: 'Item photos', recorded: !!(item.photoDataUrl || item.photos?.length) },
    { label: 'Purchase date', recorded: !!item.purchaseDate },
    { label: 'Purchase proof or linked evidence', recorded: !!(item.receiptDataUrl || item.documentIds?.length || item.slipIds?.length) },
    { label: 'Replacement value', recorded: !!item.replacementValue?.trim() },
    { label: 'Owner and location', recorded: !!(item.ownerName && item.location) },
  ];
}

export function replacementReviewDue(item: AssetItem, now = new Date()): boolean {
  if (!item.replacementValue || (item.status && item.status !== 'owned' && item.status !== 'damaged')) return false;
  const checked = assetDateMs(item.replacementValueCheckedAt);
  if (checked === null) return true;
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - checked >= 365 * DAY_MS;
}
