// Shared field vocabulary for AssetItem — used by Assets.tsx (the full list +
// scan/add flow) and AssetDetailModal.tsx (the click-to-open detail view
// reached from a member's own Belongings card). Kept in one place so the two
// surfaces can't drift apart on what a "category" or "condition" is allowed
// to be.
import type { AssetItem } from '../types';

export const CATEGORIES: AssetItem['category'][] = [
  'Electronics', 'Bike', 'Sporting', 'Vehicle', 'Jewellery', 'Furniture', 'Other',
];

export const IDENTIFIER_TYPES = ['Serial', 'IMEI', 'VIN', 'Frame no.', 'ISBN', 'Certificate no.', 'Other'];
export const CONDITIONS = ['New', 'Excellent', 'Good', 'Fair', 'Poor'];
export const STORAGE_OPTIONS = ['In the home', 'Locked away', 'In a safe', 'With the person', 'Other'];
export const CURRENCIES = ['EUR', 'GBP', 'USD', 'ZAR', 'CHF'];
export const STATUSES: { value: NonNullable<AssetItem['status']>; label: string }[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'stolen', label: 'Stolen' },
  { value: 'lost', label: 'Lost' },
  { value: 'sold', label: 'Sold' },
  { value: 'disposed', label: 'Disposed' },
];
export const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', GBP: '£', USD: '$', ZAR: 'R', CHF: 'CHF ' };

// Sensible default identifier per category (user can override).
export function suggestIdentifier(cat: AssetItem['category']): string {
  switch (cat) {
    case 'Bike': return 'Frame no.';
    case 'Vehicle': return 'VIN';
    case 'Jewellery': return 'Certificate no.';
    case 'Electronics':
    case 'Sporting': return 'Serial';
    default: return 'Serial';
  }
}

// All of an item's pictures, labelled, for the gallery viewer.
export function itemImages(item: AssetItem): { src: string; label: string }[] {
  const out: { src: string; label: string }[] = [];
  if (item.photoDataUrl) out.push({ src: item.photoDataUrl, label: 'Photo' });
  (item.photos || []).forEach((s, i) => out.push({ src: s, label: `Photo ${i + 2}` }));
  if (item.receiptDataUrl) out.push({ src: item.receiptDataUrl, label: 'Receipt' });
  return out;
}
