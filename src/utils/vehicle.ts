import { Vehicle } from '../types';
import { parseDateOnly } from './age';

// The dated obligations that make a vehicle worth tracking — each becomes a
// reminder. Austrian context: 'inspection' = §57a Begutachtung (Pickerl),
// 'vignette' = motorway toll sticker. Shared by VehiclesView + NeedsAttention.
export interface VehicleDeadline {
  kind: 'inspection' | 'insurance' | 'service' | 'vignette';
  label: string;
  date: string;   // YYYY-MM-DD
  days: number;   // days until (negative = overdue)
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysUntil(dateStr?: string): number | null {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// Next service date: an explicit override, else lastService + interval, else the
// legacy serviceDate field.
export function nextServiceDate(v: Vehicle): string | null {
  if (v.nextServiceDue) return v.nextServiceDue;
  if (v.lastService && v.serviceIntervalMonths && v.serviceIntervalMonths > 0) {
    const d = parseDateOnly(v.lastService);
    if (d) { d.setMonth(d.getMonth() + v.serviceIntervalMonths); return toISO(d); }
  }
  return v.serviceDate || null;
}

export function vehicleDeadlines(v: Vehicle): VehicleDeadline[] {
  const out: VehicleDeadline[] = [];
  const push = (kind: VehicleDeadline['kind'], label: string, date?: string | null) => {
    if (!date) return;
    const days = daysUntil(date);
    if (days === null) return;
    out.push({ kind, label, date, days });
  };
  push('inspection', 'Inspection (§57a / MOT)', v.inspectionExpiry);
  push('insurance', 'Insurance renewal', v.insuranceRenewal);
  push('vignette', 'Vignette', v.vignetteExpiry);
  push('service', 'Service due', nextServiceDate(v));
  return out.sort((a, b) => a.days - b.days);
}

export function vehicleLabel(v: Vehicle): string {
  if (v.name && v.name.trim()) return v.name.trim();
  const mk = [v.make, v.model].filter(Boolean).join(' ').trim();
  return mk || 'Vehicle';
}
