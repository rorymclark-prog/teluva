import { Bike, Car, Caravan, Motorbike, Truck, Zap, type LucideIcon } from 'lucide-react';
import type { Vehicle, VehicleKind } from '../types';
import { parseDateOnly } from './age';

/* ---------------------------------------------------------------------------
 * Vehicle KINDS — bicycles, scooters and the rest.
 *
 * Rory, 2026-09-12: "with vehicls in the app family app can we add scooters,
 * bicycles etc i just had a bicycle service". A bike has a service history,
 * insurance and a frame number just like a car has a service history,
 * insurance and a VIN, so it is a Vehicle with a kind rather than a new list.
 *
 * ABSENT MEANS CAR. Every vehicle saved before `kind` existed is a car and is
 * never rewritten to say so — normalizeVehicleKind is the ONE place that
 * decides, so a reader can never disagree with the form about what an old
 * record is.
 * ------------------------------------------------------------------------- */

export type VehicleProfile = 'motor' | 'moped' | 'bike';

export interface VehicleKindMeta {
  kind: VehicleKind;
  label: string;
  icon: LucideIcon;
  profile: VehicleProfile;
}

// Order is the order of the picker: the common cases first.
export const VEHICLE_KINDS: VehicleKindMeta[] = [
  { kind: 'car', label: 'Car', icon: Car, profile: 'motor' },
  { kind: 'bicycle', label: 'Bicycle', icon: Bike, profile: 'bike' },
  { kind: 'e_bike', label: 'E-bike', icon: Bike, profile: 'bike' },
  { kind: 'e_scooter', label: 'E-scooter', icon: Zap, profile: 'bike' },
  { kind: 'moped', label: 'Moped / scooter', icon: Motorbike, profile: 'moped' },
  { kind: 'motorbike', label: 'Motorbike', icon: Motorbike, profile: 'motor' },
  { kind: 'van', label: 'Van / camper', icon: Caravan, profile: 'motor' },
  { kind: 'cargo_bike', label: 'Cargo bike', icon: Bike, profile: 'bike' },
  { kind: 'other', label: 'Other', icon: Truck, profile: 'motor' },
];

const KIND_SET = new Set<string>(VEHICLE_KINDS.map((k) => k.kind));

/* Anything a person or the assistant might call a kind, onto the closed set.
 * Unknown / empty → undefined, which every reader treats as 'car'. Loose on
 * purpose: the assistant will say "bike", "scooter", "e bike". */
export function normalizeVehicleKind(raw: unknown): VehicleKind | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return undefined;
  if (KIND_SET.has(s)) return s as VehicleKind;
  if (/^(e_?bike|ebike|pedelec|electric_bi(ke|cycle))$/.test(s)) return 'e_bike';
  if (/^(e_?scooter|kick_?scooter|electric_scooter|scooter_electric)$/.test(s)) return 'e_scooter';
  if (/^(cargo|cargo_?bi(ke|cycle)|lastenrad|bakfiets)$/.test(s)) return 'cargo_bike';
  if (/^(bike|bicycle|cycle|push_?bike|fahrrad|rad|mountain_?bike|road_?bike)$/.test(s)) return 'bicycle';
  if (/^(moped|scooter|vespa|mofa|motorroller)$/.test(s)) return 'moped';
  if (/^(motor_?bike|motorcycle|motorrad)$/.test(s)) return 'motorbike';
  if (/^(van|camper|campervan|motorhome|minibus|transporter)$/.test(s)) return 'van';
  if (/^(car|auto|pkw|suv)$/.test(s)) return 'car';
  return 'other';
}

/** The kind a record IS — absent/unknown reads as car. */
export function vehicleKindOf(v: Pick<Vehicle, 'kind'>): VehicleKind {
  return normalizeVehicleKind(v.kind) ?? 'car';
}

export function vehicleKindMeta(kind: VehicleKind | undefined): VehicleKindMeta {
  return VEHICLE_KINDS.find((k) => k.kind === (kind ?? 'car')) ?? VEHICLE_KINDS[0];
}

export const isPedalKind = (kind: VehicleKind | undefined) => vehicleKindMeta(kind).profile === 'bike';

/* Which fields the form asks for, per kind. A bike has no number plate, no
 * fuel, no vignette, no §57a Pickerl and no Parkpickerl; its "VIN" is the
 * frame number stamped under the bottom bracket.
 *
 * `false` means "do not ASK", never "delete": the form still shows a hidden
 * field whenever it already holds a value (see showVehicleField), so switching
 * a car to 'bicycle' by mistake and back loses nothing. */
export interface VehicleFieldProfile {
  plate: boolean;
  fuel: boolean;
  inspection: boolean;
  vignette: boolean;
  parkingPermit: boolean;
  vinLabel: string;
  vinPlaceholder: string;
  driverLabel: string;
  odometerLabel: string;
  spotLabel: string;
}

export function vehicleFieldProfile(kind: VehicleKind | undefined): VehicleFieldProfile {
  const k = kind ?? 'car';
  const profile = vehicleKindMeta(k).profile;
  if (profile === 'bike') {
    return {
      plate: false, fuel: false, inspection: false, vignette: false, parkingPermit: false,
      vinLabel: k === 'e_scooter' ? 'Serial / frame no.' : 'Frame no.',
      vinPlaceholder: k === 'e_scooter' ? 'On the deck or stem' : 'Under the pedals, e.g. WTU123C4567D',
      driverLabel: 'Main rider',
      odometerLabel: 'Distance (km) · optional',
      spotLabel: 'Where it’s kept',
    };
  }
  if (profile === 'moped') {
    // Mopeds carry a plate and a §57a inspection in Austria, but may not use
    // the motorway (no vignette) and need no Parkpickerl.
    return {
      plate: true, fuel: true, inspection: true, vignette: false, parkingPermit: false,
      vinLabel: 'VIN / chassis no.', vinPlaceholder: 'On the registration', driverLabel: 'Main rider',
      odometerLabel: 'Odometer (km)', spotLabel: 'Spot / location',
    };
  }
  return {
    plate: true, fuel: true, inspection: true, vignette: true, parkingPermit: true,
    vinLabel: 'VIN / chassis no.', vinPlaceholder: 'WVWZZZ…',
    driverLabel: k === 'motorbike' ? 'Main rider' : 'Main driver',
    odometerLabel: 'Odometer (km)', spotLabel: 'Spot / location',
  };
}

/** Show a field if the kind asks for it OR it already holds something. */
export function showVehicleField(asked: boolean, value: unknown): boolean {
  if (asked) return true;
  if (value === undefined || value === null) return false;
  return String(value).trim() !== '';
}

// The dated obligations that make a vehicle worth tracking — each becomes a
// reminder. Austrian context: 'inspection' = §57a Begutachtung (Pickerl),
// 'vignette' = motorway toll sticker. Shared by VehiclesView + NeedsAttention.
export interface VehicleDeadline {
  kind: 'inspection' | 'insurance' | 'service' | 'vignette' | 'parking';
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
  push('parking', 'Parking permit', v.parkingPermitExpiry);
  push('service', 'Service due', nextServiceDate(v));
  return out.sort((a, b) => a.days - b.days);
}

export function vehicleLabel(v: Vehicle): string {
  if (v.name && v.name.trim()) return v.name.trim();
  const mk = [v.make, v.model].filter(Boolean).join(' ').trim();
  // A nameless bike reads "Bicycle", not "Vehicle". Absent kind → "Car"
  // would change what every old unnamed record has always said, so the
  // generic word stays for cars.
  if (mk) return mk;
  const kind = vehicleKindOf(v);
  return kind === 'car' ? 'Vehicle' : vehicleKindMeta(kind).label;
}
