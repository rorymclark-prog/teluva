import type { AssetItem, SlipItem } from '../types';
import { assetDateMs } from './assetRegister';
import { filePathFromReference, normalizeFileReference } from './fileReferences';

const missing = (value?: string) => !value || !value.trim();

/** Explicit copying fills blanks only. Never re-label an existing price, or
 * copy a receipt amount under a different currency already on the asset. */
export function missingAssetPurchaseDetails(item: AssetItem, slip: SlipItem): Partial<AssetItem> {
  const patch: Partial<AssetItem> = {};
  if (missing(item.purchaseDate) && slip.purchaseDate && assetDateMs(slip.purchaseDate) !== null) patch.purchaseDate = slip.purchaseDate;
  if (missing(item.purchaseLocation) && !missing(slip.shop)) patch.purchaseLocation = slip.shop;
  const currency = (slip.currency || 'EUR').trim().toUpperCase();
  const compatibleCurrency = missing(item.currency) || item.currency!.trim().toUpperCase() === currency;
  if (missing(item.purchasePrice) && !missing(slip.amount) && compatibleCurrency) {
    patch.purchasePrice = slip.amount;
    if (missing(item.currency)) patch.currency = currency;
  }
  return patch;
}

export function receiptCurrencyConflict(item: AssetItem, slip: SlipItem): boolean {
  return missing(item.purchasePrice) && !missing(slip.amount) && !missing(item.currency)
    && item.currency!.trim().toUpperCase() !== (slip.currency || 'EUR').trim().toUpperCase();
}

/** Existing receipts are already in the current protected store or are legacy
 * inline images. An unrelated space reference must not be presented as proof. */
export function assetReceiptSource(value: string | undefined, spaceId: string): string | null {
  if (!value) return null;
  const path = filePathFromReference(value);
  if (path) return path.startsWith(`families/${spaceId}/`) ? normalizeFileReference(value) : null;
  return /^data:image\/(?:jpeg|png|gif|webp|bmp|avif);base64,/i.test(value) ? value : null;
}

export const linkAssetEvidence = (ids: string[] | undefined, id: string): string[] => [...new Set([...(ids || []), id])];
export const unlinkAssetEvidence = (ids: string[] | undefined, id: string): string[] => (ids || []).filter(value => value !== id);
