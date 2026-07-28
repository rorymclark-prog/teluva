// Pure unit conversions + locale defaults for the "measure from a photo"
// feature and for typing height/weight in by hand. Canonical STORAGE is
// always metric (GrowthLog.heightCm/weightKg, ClothingSizes.heightCm/weightKg)
// — these functions convert at the edges (a reading coming in, a text field
// being typed, a value being displayed) and never introduce a second stored
// unit, so there is exactly one source of truth per measurement.
import { IdCountry } from '../types';

export type HeightUnit = 'cm' | 'in';
export type WeightUnit = 'kg' | 'lb';
export type UnitSystem = 'metric' | 'imperial';
export type ShoeSystem = 'EU' | 'UK' | 'US';

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.453592;

const round1 = (n: number): number => Math.round(n * 10) / 10;

// value -> canonical cm. Returns null for a non-finite/non-positive value or
// an unrecognised unit — callers must treat null as "could not convert",
// never as zero.
export function toCanonicalHeightCm(value: number, unit: HeightUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 'cm') return round1(value);
  if (unit === 'in') return round1(value * CM_PER_IN);
  return null;
}

export function toCanonicalWeightKg(value: number, unit: WeightUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 'kg') return round1(value);
  if (unit === 'lb') return round1(value * KG_PER_LB);
  return null;
}

// canonical cm/kg -> a display value in the requested unit, for showing a
// stored (always-metric) value back to a family in their own units. Never
// itself stored.
export function fromCanonicalHeightCm(cm: number, unit: HeightUnit): number {
  return unit === 'in' ? round1(cm / CM_PER_IN) : round1(cm);
}

export function fromCanonicalWeightKg(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? round1(kg / KG_PER_LB) : round1(kg);
}

// Which unit system a family most likely uses, derived from the app's one
// existing locale signal — HubSettings.country (set in FamilySettings.tsx) —
// rather than adding a new setting. Only the US is imperial-by-default among
// the app's supported countries: the UK, South Africa and Austria (and the
// 'other' fallback) all use metric height/weight in the medical/growth-chart
// context this feature lives in, even though the UK still uses stone/lb
// casually for adult body weight in everyday conversation.
export function unitSystemForCountry(country?: IdCountry): UnitSystem {
  return country === 'US' ? 'imperial' : 'metric';
}

export function heightUnitFor(system: UnitSystem): HeightUnit {
  return system === 'imperial' ? 'in' : 'cm';
}

export function weightUnitFor(system: UnitSystem): WeightUnit {
  return system === 'imperial' ? 'lb' : 'kg';
}

// Which shoe-size system is the local convention — LABELLING only. A shoe
// size is never numerically converted between systems here (no exact,
// brand-independent formula exists — see measureReading.ts), so this only
// drives what the "Smart fit estimator" suggestion calls itself.
export function shoeSystemForCountry(country?: IdCountry): ShoeSystem {
  if (country === 'US') return 'US';
  if (country === 'UK' || country === 'ZA') return 'UK';
  return 'EU'; // AT, 'other', and the unset default
}
