// Types + pure logic for a "measure from a photo" reading (server.js's
// POST /api/measure). Deliberately has NO firebase import (unlike
// measurePhoto.ts, which does the actual network call) so this file — and the
// one genuinely load-bearing decision in it — can be unit tested in plain
// Node without booting the Firebase SDK.

export type MeasureSourceKind = 'scale' | 'size_label' | 'ruler_or_growth_chart' | 'tape_measure' | 'unknown';
export type MeasureConfidence = 'high' | 'medium' | 'low';

export interface MeasureReadings {
  heightCm?: number;
  heightRaw?: { value: number; unit: 'cm' | 'in' };   // exactly as read, before conversion — shown so a parent can sanity-check the reading against what they actually photographed
  weightKg?: number;
  weightRaw?: { value: number; unit: 'kg' | 'lb' };
  shoeSize?: string;      // every system actually printed on the label, e.g. "EU 32 / UK 13 / US 1" — NEVER a computed cross-system conversion (no exact, brand-independent formula exists)
  clothingSize?: string;  // as printed on the garment label, e.g. "7-8 Years · 128cm"
}

export interface MeasureResult {
  sourceKind: MeasureSourceKind;
  confidence: MeasureConfidence;
  sawText: string; // what the model read/saw — for a ruler/tape-measure reading, a description of the mark's position, not a bare number
  note: string;
  readings: MeasureReadings;
}

// Reading a printed/displayed digit (a scale readout, a size label) is a
// fundamentally more reliable read than interpolating a pencil mark against a
// ruler/growth-chart's printed numbers — verified against real photos during
// development, where the model self-reported "high" confidence on the latter
// while being a centimetre off the true mark. server.js already clamps
// confidence for these two source kinds to at most "medium" (defense in
// depth — never trust the model's own self-report); callers use this to ALSO
// change how the reading is PRESENTED — an editable value the parent is asked
// to check against the wall, not a one-tap "Use these" accept.
export function isInterpolatedSource(sourceKind: MeasureSourceKind): boolean {
  return sourceKind === 'ruler_or_growth_chart' || sourceKind === 'tape_measure';
}
