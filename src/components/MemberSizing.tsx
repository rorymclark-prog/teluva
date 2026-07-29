import React, { useState, useEffect, useRef } from 'react';
import { ClothingSizes, FamilyMember, IdCountry } from '../types';
import { Save, Copy, Check, TrendingUp, Clock, Camera, RefreshCcw, AlertCircle } from 'lucide-react';
import { loadSettings } from '../utils/db';
import { compressImageToAvatar } from '../utils/imageCompress';
import {
  toCanonicalHeightCm, toCanonicalWeightKg, fromCanonicalHeightCm, fromCanonicalWeightKg,
  unitSystemForCountry, heightUnitFor, weightUnitFor, shoeSystemForCountry, HeightUnit, WeightUnit,
} from '../utils/measurementUnits';
import { getUnitSystemOverride, setUnitSystemOverride } from '../utils/unitPreference';
import { measureFromPhoto, isInterpolatedSource, MeasureResult } from '../utils/measurePhoto';
import { sizeStaleness } from '../utils/sizeStaleness';

interface MemberSizingProps {
  member: FamilyMember;
  onUpdateSizes: (id: string, sizes: ClothingSizes) => void;
}

// Age calculator helper
function calculateAgeInMonths(birthdate?: string): number {
  if (!birthdate) return -1;
  const today = new Date(); // Bug fix #2: was hardcoded new Date('2026-05-22')
  const birth = new Date(birthdate);
  const diffTime = Math.abs(today.getTime() - birth.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 30.4375);
}

// Bug fix #3: date-only helper
const todayLocal = () => new Date().toLocaleDateString('en-CA');

// Get Size Suggestions based on age and role using EU standards (height in cm, EU shoes).
// NOTE: this table is EU-only — a UK/US/SA family sees the SAME numbers, just
// labelled "EU sizing" in the UI below (see the Suggestion Engine block), per
// the deliberate scope decision not to build a full 4-country conversion
// table (shoe/clothing sizing conventions genuinely diverge by brand, gender
// and child-vs-adult, unlike the exact cm<->in / kg<->lb height/weight
// conversions in measurementUnits.ts).
function getSizeSuggestions(ageMonths: number, role: string) {
  if (ageMonths < 0) return null;
  const ageYears = ageMonths / 12;

  if (role === 'Parent' || ageYears > 14) {
    return { tops: 'EU 36 - 48 (S - XL)', bottoms: 'EU 36 - 48', shoes: 'EU 38 - 45', height: '160 - 188 cm', weight: '50 - 85 kg' };
  }

  if (ageMonths <= 3) {
    return { tops: 'EU 56/62 (0-3M)', bottoms: 'EU 56/62', shoes: 'EU 15-16', height: '56 - 62 cm', weight: '3 - 5.5 kg' };
  } else if (ageMonths <= 6) {
    return { tops: 'EU 62/68 (3-6M)', bottoms: 'EU 62/68', shoes: 'EU 17-18', height: '62 - 68 cm', weight: '5.5 - 7.5 kg' };
  } else if (ageMonths <= 12) {
    return { tops: 'EU 68/80 (6-12M)', bottoms: 'EU 68/80', shoes: 'EU 19-20', height: '68 - 80 cm', weight: '7.5 - 10 kg' };
  } else if (ageMonths <= 18) {
    return { tops: 'EU 80/86 (12-18M)', bottoms: 'EU 80/86', shoes: 'EU 21-22', height: '80 - 86 cm', weight: '10 - 11.5 kg' };
  } else if (ageMonths <= 24) {
    return { tops: 'EU 86/92 (18-24M)', bottoms: 'EU 86/92', shoes: 'EU 23-24', height: '86 - 92 cm', weight: '11.5 - 13 kg' };
  } else if (ageYears <= 3) {
    return { tops: 'EU 98 (2-3 Years)', bottoms: 'EU 98', shoes: 'EU 24-25', height: '92 - 98 cm', weight: '13 - 15.5 kg' };
  } else if (ageYears <= 4) {
    return { tops: 'EU 104 (3-4 Years)', bottoms: 'EU 104', shoes: 'EU 26-27', height: '98 - 104 cm', weight: '15 - 17.5 kg' };
  } else if (ageYears <= 5) {
    return { tops: 'EU 110 (4-5 Years)', bottoms: 'EU 110', shoes: 'EU 27-28', height: '104 - 110 cm', weight: '17 - 20 kg' };
  } else if (ageYears <= 6) {
    return { tops: 'EU 116 (5-6 Years)', bottoms: 'EU 116', shoes: 'EU 28-29', height: '110 - 116 cm', weight: '19 - 22.5 kg' };
  } else if (ageYears <= 7) {
    return { tops: 'EU 122 (6-7 Years)', bottoms: 'EU 122', shoes: 'EU 30-31', height: '116 - 122 cm', weight: '21 - 25 kg' };
  } else if (ageYears <= 9) {
    return { tops: 'EU 128/134 (7-9 Years)', bottoms: 'EU 128/134', shoes: 'EU 31-33', height: '122 - 134 cm', weight: '24 - 30 kg' };
  } else if (ageYears <= 12) {
    return { tops: 'EU 140/146 (9-11 Years)', bottoms: 'EU 140/146', shoes: 'EU 34-36', height: '134 - 146 cm', weight: '30 - 40 kg' };
  } else {
    return { tops: 'EU 152/158 (12-13 Years)', bottoms: 'EU 152/158', shoes: 'EU 36-38', height: '146 - 158 cm', weight: '40 - 50 kg' };
  }
}

// heightCm/weightKg here hold a DISPLAY-unit string (whatever `heightUnit`/
// `weightUnit` currently is), NOT necessarily canonical cm/kg — converted at
// the boundary in handleSave/applySuggestions/the photo-reading handlers
// below. Every OTHER field is free text and unit-agnostic.
const initSizes = (member: FamilyMember, heightUnit: HeightUnit, weightUnit: WeightUnit): ClothingSizes => ({
  tops: member.clothingSizes.tops || '',
  bottoms: member.clothingSizes.bottoms || '',
  shoes: member.clothingSizes.shoes || '',
  outerwear: member.clothingSizes.outerwear || '',
  underwear: member.clothingSizes.underwear || '',
  hatValue: member.clothingSizes.hatValue || '',
  heightCm: member.clothingSizes.heightCm ? String(fromCanonicalHeightCm(Number(member.clothingSizes.heightCm), heightUnit)) : '',
  weightKg: member.clothingSizes.weightKg ? String(fromCanonicalWeightKg(Number(member.clothingSizes.weightKg), weightUnit)) : '',
  notes: member.clothingSizes.notes || '',
});

export default function MemberSizing({ member, onUpdateSizes }: MemberSizingProps) {
  // This app's one existing locale signal (HubSettings.country, set in
  // FamilySettings.tsx) drives the default unit system — self-loaded here the
  // same way NeedsAttention.tsx self-loads its own extra data, so no new prop
  // is needed on this component. A per-device override (localStorage, not
  // synced) lets e.g. a US grandparent read/type in their own units without
  // changing what the family itself sees.
  const [country, setCountry] = useState<IdCountry | undefined>(undefined);
  const [override, setOverride] = useState(() => getUnitSystemOverride());
  useEffect(() => {
    let cancelled = false;
    loadSettings().then((s) => { if (!cancelled) setCountry(s?.country); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const unitSystem = override ?? unitSystemForCountry(country);
  const heightUnit: HeightUnit = heightUnitFor(unitSystem);
  const weightUnit: WeightUnit = weightUnitFor(unitSystem);
  const shoeSystem = shoeSystemForCountry(country);
  const toggleUnitOverride = () => {
    const next = unitSystem === 'imperial' ? 'metric' : 'imperial';
    setUnitSystemOverride(next);
    setOverride(next);
  };

  const [sizes, setSizes] = useState<ClothingSizes>(() => initSizes(member, heightUnit, weightUnit));

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  // Bug fix #1: re-sync when member.id changes — also re-syncs when the
  // resolved unit re-derives (country finishes loading shortly after mount),
  // so the displayed number always matches the unit label next to it.
  useEffect(() => {
    setSizes(initSizes(member, heightUnit, weightUnit));
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id, heightUnit, weightUnit]);

  const ageMonths = member.birthdate ? calculateAgeInMonths(member.birthdate) : -1;
  const suggestions = getSizeSuggestions(ageMonths, member.role);
  const staleness = sizeStaleness(member.clothingSizes, member.birthdate, todayLocal());

  /* Typed-but-unsaved values used to vanish on tab-switch: the only way to
     persist was the "Save essentials" button, and nothing said so. `dirty`
     gates the blur-commit so that merely TABBING THROUGH an untouched form
     can't restamp lastUpdated — that would silently mark stale sizes fresh and
     clear the "sizes may be out of date" nudge without anyone measuring
     anything. */
  const dirty = useRef(false);

  const handleFieldChange = (field: keyof ClothingSizes, value: string) => {
    setSizes((prev) => ({ ...prev, [field]: value }));
    dirty.current = true;
    setSaved(false);
  };

  const commitIfDirty = () => {
    if (!dirty.current) return;
    handleSave();
  };

  const handleSave = () => {
    const heightCanonical = sizes.heightCm ? toCanonicalHeightCm(Number(sizes.heightCm), heightUnit) : null;
    const weightCanonical = sizes.weightKg ? toCanonicalWeightKg(Number(sizes.weightKg), weightUnit) : null;
    onUpdateSizes(member.id, {
      ...sizes,
      heightCm: heightCanonical != null ? String(heightCanonical) : '',
      weightKg: weightCanonical != null ? String(weightCanonical) : '',
      lastUpdated: todayLocal(), // Bug fix #3: date-only string
    });
    dirty.current = false;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopy = () => {
    const textParts = [
      `Clothing Sizes for ${member.name}:`,
      sizes.tops ? `• Tops: ${sizes.tops}` : null,
      sizes.bottoms ? `• Bottoms: ${sizes.bottoms}` : null,
      sizes.shoes ? `• Shoes: ${sizes.shoes}` : null,
      sizes.outerwear ? `• Outerwear: ${sizes.outerwear}` : null,
      sizes.underwear ? `• Underwear: ${sizes.underwear}` : null,
      sizes.hatValue ? `• Hat: ${sizes.hatValue}` : null,
      sizes.heightCm ? `• Height: ${sizes.heightCm} ${heightUnit}` : null,
      sizes.weightKg ? `• Weight: ${sizes.weightKg} ${weightUnit}` : null,
      sizes.notes ? `• Notes: ${sizes.notes}` : null,
      sizes.lastUpdated ? `(Updated: ${sizes.lastUpdated})` : null,
    ].filter(Boolean);

    navigator.clipboard.writeText(textParts.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const applySuggestions = () => {
    if (!suggestions) return;
    // Bug fix #4: extract first number only, not all digits concatenated.
    // The table is metric (EU/cm/kg) — convert to the current display unit.
    const suggestedHeightCm = Number(suggestions.height.match(/[\d.]+/)?.[0] || '');
    const suggestedWeightKg = Number(suggestions.weight.match(/[\d.]+/)?.[0] || '');
    setSizes((prev) => ({
      ...prev,
      tops: suggestions.tops,
      bottoms: suggestions.bottoms,
      shoes: suggestions.shoes,
      heightCm: Number.isFinite(suggestedHeightCm) && suggestedHeightCm > 0 ? String(fromCanonicalHeightCm(suggestedHeightCm, heightUnit)) : prev.heightCm,
      weightKg: Number.isFinite(suggestedWeightKg) && suggestedWeightKg > 0 ? String(fromCanonicalWeightKg(suggestedWeightKg, weightUnit)) : prev.weightKg,
    }));
  };

  // --- "Measure from a photo" — AI reading state. Nothing here is ever
  // saved automatically: a reading only pre-fills the fields above, which
  // still require the existing "Save essentials" tap to persist. ---
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<MeasureResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [checkHeight, setCheckHeight] = useState(''); // editable pending value for a ruler/growth-chart height reading, in `heightUnit`
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aiResult?.readings.heightCm != null && isInterpolatedSource(aiResult.sourceKind)) {
      setCheckHeight(String(fromCanonicalHeightCm(aiResult.readings.heightCm, heightUnit)));
    }
  }, [aiResult, heightUnit]);

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setAiError(null);
    setAiResult(null);
    setAiBusy(true);
    try {
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read the photo file.'));
        reader.readAsDataURL(file);
      });
      const compressed = await compressImageToAvatar(rawDataUrl, 1024, 0.85);
      const result = await measureFromPhoto(compressed);
      setAiResult(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Something went wrong reading the photo.');
    } finally {
      setAiBusy(false);
    }
  };

  const applyHeight = (cm: number) => setSizes((p) => ({ ...p, heightCm: String(fromCanonicalHeightCm(cm, heightUnit)) }));
  const applyWeight = (kg: number) => setSizes((p) => ({ ...p, weightKg: String(fromCanonicalWeightKg(kg, weightUnit)) }));
  const applyShoe = (v: string) => setSizes((p) => ({ ...p, shoes: v }));
  const applyClothing = (field: 'tops' | 'bottoms', v: string) => setSizes((p) => ({ ...p, [field]: v }));
  const insertCheckedHeight = () => {
    if (!checkHeight) return;
    setSizes((p) => ({ ...p, heightCm: checkHeight }));
  };

  return (
    <div className="space-y-6">
      {/* Sizing Stats Grid */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="section-label mb-1.5">Shirt size</p>
          <p className="text-2xl font-light text-ink-900 tabular-nums">
            {sizes.tops || <span className="text-ink-400 font-extralight">—</span>}
          </p>
        </div>
        <div className="card p-5">
          <p className="section-label mb-1.5">Shoe size</p>
          <p className="text-2xl font-light text-ink-900 tabular-nums">
            {sizes.shoes || <span className="text-ink-400 font-extralight">—</span>}
          </p>
        </div>
        <div className="card p-5">
          <p className="section-label mb-1.5">Pant size</p>
          <p className="text-2xl font-light text-ink-900 tabular-nums">
            {sizes.bottoms || <span className="text-ink-400 font-extralight">—</span>}
          </p>
        </div>
        <div className="card p-5">
          <p className="section-label mb-1.5">Height &amp; weight</p>
          <p className="text-xl font-light text-ink-900 truncate tabular-nums">
            {sizes.heightCm ? `${sizes.heightCm} ${heightUnit}` : <span className="text-ink-400 font-extralight">—</span>}
            {sizes.weightKg && <span className="text-xs text-ink-500 font-normal ml-1">({sizes.weightKg} {weightUnit})</span>}
          </p>
        </div>
      </section>

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cream-200 pb-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink-900 flex flex-wrap items-center gap-2">
            <span className="w-1.5 h-3.5 bg-dusk-500 rounded-full inline-block"></span>
            <span>Clothing &amp; fit values</span>
            <span className="chip bg-dusk-100 text-dusk-700">
              🇪🇺 EU standard
            </span>
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">Configure complete sizing for seamless family orders or wardrobe upgrades (EU Standard EN 13402).</p>
          <button
            type="button"
            onClick={toggleUnitOverride}
            className="text-[11.5px] text-ink-400 hover:text-ink-700 underline underline-offset-2 mt-1 cursor-pointer"
          >
            Height/weight shown in {unitSystem === 'imperial' ? 'imperial (in / lb)' : 'metric (cm / kg)'} — switch to {unitSystem === 'imperial' ? 'metric' : 'imperial'}
          </button>
        </div>

        <div className="flex items-center flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={aiBusy}
            className="btn-quiet text-sm px-3 py-1.5 disabled:opacity-50"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Measure from photo</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="btn-quiet text-sm px-3 py-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-sage-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy to clipboard'}</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary text-sm px-4 py-1.5"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saved ? 'Saved!' : 'Save'}</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoSelected}
        />
      </div>

      {/* AI photo-reading status */}
      {aiBusy && (
        <div className="p-3.5 rounded-xl bg-cream-100 border border-cream-300 text-[13px] text-ink-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4 animate-spin text-clay-500" />
          <span>Reading the photo…</span>
        </div>
      )}

      {aiError && (
        <div className="p-3.5 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
          <span>{aiError}</span>
        </div>
      )}

      {aiResult && (() => {
        const { heightCm, weightKg, shoeSize, clothingSize } = aiResult.readings;
        const nothingRead = heightCm == null && weightKg == null && !shoeSize && !clothingSize;
        const interpolatedHeight = heightCm != null && isInterpolatedSource(aiResult.sourceKind);
        return (
          <div className={`p-3.5 rounded-xl space-y-2.5 bg-honey-50 border ${interpolatedHeight ? 'border-2 border-honey-500' : 'border-honey-200'}`}>
            <p className="text-[13px] text-ink-700"><span className="font-semibold">What I saw:</span> {aiResult.sawText || aiResult.note || 'Nothing measurable found.'}</p>
            {nothingRead ? (
              <p className="text-[12.5px] text-ink-500">{aiResult.note || "Couldn't get a confident reading — please enter the values by hand."}</p>
            ) : (
              <div className="space-y-2">
                {interpolatedHeight ? (
                  <div className="space-y-1.5">
                    <p className="text-[12.5px] font-semibold text-honey-900">
                      Read from a ruler/growth chart — this is an estimate. Please check it against the wall before using it.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-[12.5px] font-semibold text-ink-600 shrink-0">Height ({heightUnit}) — check &amp; edit:</label>
                      <input type="number" step="0.1" value={checkHeight} onChange={(e) => setCheckHeight(e.target.value)} className="field w-28" />
                      <button type="button" onClick={insertCheckedHeight} className="btn-primary text-[12.5px] px-3 py-1.5 shrink-0">Insert</button>
                    </div>
                  </div>
                ) : heightCm != null && (
                  <div className="flex items-center gap-2 text-[12.5px] flex-wrap">
                    <span className="chip bg-white border border-honey-200 text-ink-700">Height: {fromCanonicalHeightCm(heightCm, heightUnit)} {heightUnit}</span>
                    <button type="button" onClick={() => applyHeight(heightCm)} className="btn-quiet text-[11.5px] px-2 py-1">Apply</button>
                  </div>
                )}

                {weightKg != null && (
                  <div className="flex items-center gap-2 text-[12.5px] flex-wrap">
                    <span className="chip bg-white border border-honey-200 text-ink-700">Weight: {fromCanonicalWeightKg(weightKg, weightUnit)} {weightUnit}</span>
                    <button type="button" onClick={() => applyWeight(weightKg)} className="btn-quiet text-[11.5px] px-2 py-1">Apply</button>
                  </div>
                )}

                {shoeSize && (
                  <div className="flex items-center gap-2 text-[12.5px] flex-wrap">
                    <span className="chip bg-white border border-honey-200 text-ink-700">Shoe size: {shoeSize}</span>
                    <button type="button" onClick={() => applyShoe(shoeSize)} className="btn-quiet text-[11.5px] px-2 py-1">Apply</button>
                  </div>
                )}

                {clothingSize && (
                  <div className="flex items-center gap-2 text-[12.5px] flex-wrap">
                    <span className="chip bg-white border border-honey-200 text-ink-700">Clothing size: {clothingSize}</span>
                    <button type="button" onClick={() => applyClothing('tops', clothingSize)} className="btn-quiet text-[11.5px] px-2 py-1">Apply to tops</button>
                    <button type="button" onClick={() => applyClothing('bottoms', clothingSize)} className="btn-quiet text-[11.5px] px-2 py-1">Apply to bottoms</button>
                  </div>
                )}

                {aiResult.confidence === 'medium' && (
                  <p className="text-[11.5px] text-honey-700 italic">Medium confidence — double-check before saving.</p>
                )}
              </div>
            )}
            <div className="flex justify-end pt-0.5">
              <button type="button" onClick={() => setAiResult(null)} className="btn-quiet text-[12.5px] px-3 py-1.5">Done</button>
            </div>
          </div>
        );
      })()}

      {/* Suggestion Engine */}
      {suggestions && (
        <div className={staleness.stale
          ? 'rounded-2xl border-2 border-honey-500 bg-honey-50 p-4 flex items-start space-x-3 shadow-soft'
          : 'card p-4 flex items-start space-x-3'}>
          <div className="p-1.5 rounded-xl bg-honey-100 text-honey-700 mt-0.5">
            {staleness.stale ? <Clock className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
          </div>
          <div className="flex-1">
            <h4 className="text-[13px] font-semibold text-ink-900 flex items-center gap-1.5 flex-wrap">
              Smart fit estimator
              <span className="chip bg-dusk-100 text-dusk-700 text-[10px]">{shoeSystem} sizing</span>
            </h4>
            <p className="text-[13px] text-ink-500 mt-0.5">
              {staleness.stale
                ? `${member.name}'s sizes were last updated ${staleness.monthsSince != null ? `${staleness.monthsSince} month${staleness.monthsSince === 1 ? '' : 's'} ago` : 'a while ago'} — here's what's typical for age ${Math.max(0, Math.floor(ageMonths / 12))}:`
                : `Standard sizing recommendation based on ${member.name}'s birthdate:`}
            </p>
            {shoeSystem !== 'EU' && (
              <p className="text-[11px] text-ink-400 italic mt-0.5">
                Shown in EU sizing — convert to {shoeSystem} sizing for your country.
              </p>
            )}
            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-white p-2 rounded-xl border border-cream-200">
                <span className="section-label block mb-0.5">Tops/pants</span>
                <span className="font-semibold text-ink-800 tabular-nums">{suggestions.tops}</span>
              </div>
              <div className="bg-white p-2 rounded-xl border border-cream-200">
                <span className="section-label block mb-0.5">Shoes</span>
                <span className="font-semibold text-ink-800 tabular-nums">{suggestions.shoes}</span>
              </div>
              <div className="bg-white p-2 rounded-xl border border-cream-200">
                <span className="section-label block mb-0.5">Height</span>
                <span className="font-semibold text-ink-800 tabular-nums">{suggestions.height}</span>
              </div>
              <div className="bg-white p-2 rounded-xl border border-cream-200">
                <span className="section-label block mb-0.5">Weight</span>
                <span className="font-semibold text-ink-800 tabular-nums">{suggestions.weight}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={applySuggestions}
              className="mt-3 text-[13px] font-semibold text-ink-700 hover:text-ink-900 flex items-center gap-1 cursor-pointer underline underline-offset-2"
            >
              Apply estimated standard sizes
            </button>
          </div>
        </div>
      )}

      {/* Sizing Form Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Metric Height / Weight */}
        <div className="card p-4 grid grid-cols-2 gap-4 col-span-1 sm:col-span-2">
          <div>
            <label className="field-label">Height ({heightUnit})</label>
            <input
              type="number"
              placeholder={heightUnit === 'in' ? 'e.g. 45.9' : 'e.g. 116'}
              value={sizes.heightCm}
              onChange={(e) => handleFieldChange('heightCm', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Weight ({weightUnit})</label>
            <input
              type="number"
              placeholder={weightUnit === 'lb' ? 'e.g. 46.3' : 'e.g. 21'}
              value={sizes.weightKg}
              onChange={(e) => handleFieldChange('weightKg', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
        </div>

        {/* Basic Clothes Sizes */}
        <div className="space-y-4">
          <div>
            <label className="field-label">Tops / shirts size (EU)</label>
            <input
              type="text"
              placeholder="e.g. EU 140, EU 38 (M), Medium"
              value={sizes.tops}
              onChange={(e) => handleFieldChange('tops', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Bottoms / pants size (EU)</label>
            <input
              type="text"
              placeholder="e.g. EU 140, EU 38 / 30W"
              value={sizes.bottoms}
              onChange={(e) => handleFieldChange('bottoms', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Shoe size</label>
            <input
              type="text"
              placeholder="e.g. EU 35, UK 2, US 3"
              value={sizes.shoes}
              onChange={(e) => handleFieldChange('shoes', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="field-label">Outerwear / coats (EU)</label>
            <input
              type="text"
              placeholder="e.g. EU 140, EU 40 (M)"
              value={sizes.outerwear}
              onChange={(e) => handleFieldChange('outerwear', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Underwear (EU)</label>
            <input
              type="text"
              placeholder="e.g. EU 140, M"
              value={sizes.underwear}
              onChange={(e) => handleFieldChange('underwear', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Hat / head circumference</label>
            <input
              type="text"
              placeholder="e.g. 54 cm, 58 cm"
              value={sizes.hatValue}
              onChange={(e) => handleFieldChange('hatValue', e.target.value)}
              onBlur={commitIfDirty}
              className="field"
            />
          </div>
        </div>

        {/* Brand Preferences & fit notes */}
        <div className="col-span-1 sm:col-span-2">
          <label className="field-label">Brand preferences, allergies, or fit notes</label>
          <textarea
            rows={2}
            placeholder="e.g. Prefers tagless designs, prefers organic cotton. Target brand runs small, size up."
            value={sizes.notes}
            onChange={(e) => handleFieldChange('notes', e.target.value)}
              onBlur={commitIfDirty}
            className="field font-sans"
          />
        </div>
      </div>

      {member.clothingSizes.lastUpdated && (
        <p className="text-right text-xs text-ink-400 font-mono tabular-nums">
          Last updated: {member.clothingSizes.lastUpdated}
        </p>
      )}
    </div>
  );
}
