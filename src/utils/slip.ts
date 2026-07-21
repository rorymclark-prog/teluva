// "Keep the slip" — pure date/archival helpers for purchase slips. A slip
// carries TWO SEPARATE clocks that must never be conflated:
//   1. RETURN window — short, usually ~30 days, set by shop policy (change of
//      mind). This is NOT a statutory right — phrase everything descriptively.
//   2. WARRANTY — much longer, typically 12/24 months, for defects.
// Reuses utils/vehicle.ts's daysUntil (same local-time-safe date math) rather
// than duplicating it — everything else here is slip-specific.
import { SlipItem } from '../types';
import { daysUntil } from './vehicle';
import { parseDateOnly } from './age';

const DEFAULT_RETURN_WINDOW_DAYS = 30;

// Local-time YYYY-MM-DD formatter — same reasoning as NeedsAttention.tsx's own
// toISODate/vehicle.ts's toISO: avoids the off-by-one-day bug from
// Date#toISOString() (UTC conversion) in a timezone ahead of UTC (Vienna).
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Editable default for the "return by" field in the add/edit form — purchase
// date + N days (default 30, the commonest shop policy). Purely a starting
// point the user can change; never presented as a guaranteed entitlement.
export function suggestReturnBy(purchaseDate?: string, days: number = DEFAULT_RETURN_WINDOW_DAYS): string | undefined {
  const d = parseDateOnly(purchaseDate);
  if (!d) return undefined;
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return toISODate(copy);
}

// The return clock is "closed" once the user marked it returned, or once the
// return-by date itself has passed. No returnByDate recorded → not closed,
// because it was never open in the first place (distinct from "closed").
export function slipReturnClosed(s: SlipItem): boolean {
  if (s.returned) return true;
  if (!s.returnByDate) return false;
  const days = daysUntil(s.returnByDate);
  return days !== null && days < 0;
}

// The warranty clock is "closed" once its expiry date has passed.
export function slipWarrantyClosed(s: SlipItem): boolean {
  if (!s.warrantyUntil) return false;
  const days = daysUntil(s.warrantyUntil);
  return days !== null && days < 0;
}

// A slip auto-archives once EVERY date it actually has is closed, AND it has
// at least one date recorded. A freshly-logged slip with no dates yet is NOT
// archived — it just hasn't started a clock. This keeps the vault from
// filling with dead paper (slips accumulate fast) while never hiding an
// undated slip the family still means to fill in.
export function slipIsArchived(s: SlipItem): boolean {
  const hasAnyDate = !!s.returnByDate || !!s.warrantyUntil;
  if (!hasAnyDate) return false;
  const returnClosed = !s.returnByDate || slipReturnClosed(s);
  const warrantyClosed = !s.warrantyUntil || slipWarrantyClosed(s);
  return returnClosed && warrantyClosed;
}
