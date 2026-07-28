// A lightweight, per-device override for metric/imperial display — NOT synced
// to Firestore or family data (deliberately: this is "this browser prefers
// inches" for whoever is looking at the screen right now, not a family
// setting). Falls back to the country-derived default
// (measurementUnits.ts's unitSystemForCountry) when unset, so e.g. a US
// grandparent viewing an Austrian family's data on their own phone can still
// read/type in the units they're used to, without changing what the family
// itself sees.
import { UnitSystem } from './measurementUnits';

const KEY = 'fv_unit_system_override';

export function getUnitSystemOverride(): UnitSystem | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'metric' || v === 'imperial' ? v : null;
  } catch {
    return null;
  }
}

export function setUnitSystemOverride(system: UnitSystem | null): void {
  try {
    if (system) localStorage.setItem(KEY, system);
    else localStorage.removeItem(KEY);
  } catch {
    // private browsing / storage disabled — override just won't persist
  }
}
