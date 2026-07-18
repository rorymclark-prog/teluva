import React, { useState, useEffect } from 'react';
import { ClothingSizes, FamilyMember } from '../types';
import { Save, Copy, Check, TrendingUp } from 'lucide-react';

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

// Get Size Suggestions based on age and role using EU standards (height in cm, EU shoes)
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

const initSizes = (member: FamilyMember): ClothingSizes => ({
  tops: member.clothingSizes.tops || '',
  bottoms: member.clothingSizes.bottoms || '',
  shoes: member.clothingSizes.shoes || '',
  outerwear: member.clothingSizes.outerwear || '',
  underwear: member.clothingSizes.underwear || '',
  hatValue: member.clothingSizes.hatValue || '',
  heightCm: member.clothingSizes.heightCm || '',
  weightKg: member.clothingSizes.weightKg || '',
  notes: member.clothingSizes.notes || '',
});

export default function MemberSizing({ member, onUpdateSizes }: MemberSizingProps) {
  const [sizes, setSizes] = useState<ClothingSizes>(() => initSizes(member));

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  // Bug fix #1: re-sync when member.id changes
  useEffect(() => {
    setSizes(initSizes(member));
    setSaved(false);
  }, [member.id]);

  const ageMonths = member.birthdate ? calculateAgeInMonths(member.birthdate) : -1;
  const suggestions = getSizeSuggestions(ageMonths, member.role);

  const handleFieldChange = (field: keyof ClothingSizes, value: string) => {
    setSizes((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    onUpdateSizes(member.id, {
      ...sizes,
      lastUpdated: todayLocal(), // Bug fix #3: date-only string
    });
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
      sizes.heightCm ? `• Height: ${sizes.heightCm} cm` : null,
      sizes.weightKg ? `• Weight: ${sizes.weightKg} kg` : null,
      sizes.notes ? `• Notes: ${sizes.notes}` : null,
      sizes.lastUpdated ? `(Updated: ${sizes.lastUpdated})` : null,
    ].filter(Boolean);

    navigator.clipboard.writeText(textParts.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const applySuggestions = () => {
    if (!suggestions) return;
    setSizes((prev) => ({
      ...prev,
      tops: suggestions.tops,
      bottoms: suggestions.bottoms,
      shoes: suggestions.shoes,
      // Bug fix #4: extract first number only, not all digits concatenated
      heightCm: suggestions.height.match(/[\d.]+/)?.[0] || '',
      weightKg: suggestions.weight.match(/[\d.]+/)?.[0] || '',
    }));
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
            {sizes.heightCm ? `${sizes.heightCm} cm` : <span className="text-ink-400 font-extralight">—</span>}
            {sizes.weightKg && <span className="text-xs text-ink-500 font-normal ml-1">({sizes.weightKg} kg)</span>}
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
        </div>

        <div className="flex items-center space-x-2 shrink-0">
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
            <span>{saved ? 'Saved!' : 'Save essentials'}</span>
          </button>
        </div>
      </div>

      {/* Suggestion Engine */}
      {suggestions && (
        <div className="card p-4 flex items-start space-x-3">
          <div className="p-1.5 rounded-xl bg-honey-100 text-honey-700 mt-0.5">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h4 className="text-[13px] font-semibold text-ink-900">Smart fit estimator</h4>
            <p className="text-[13px] text-ink-500 mt-0.5">
              Standard sizing recommendation based on {member.name}&apos;s birthdate:
            </p>
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
            <label className="field-label">Height (cm)</label>
            <input
              type="number"
              placeholder="e.g. 116"
              value={sizes.heightCm}
              onChange={(e) => handleFieldChange('heightCm', e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Weight (kg)</label>
            <input
              type="number"
              placeholder="e.g. 21"
              value={sizes.weightKg}
              onChange={(e) => handleFieldChange('weightKg', e.target.value)}
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
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Shoe size (EU)</label>
            <input
              type="text"
              placeholder="e.g. EU 35, EU 43"
              value={sizes.shoes}
              onChange={(e) => handleFieldChange('shoes', e.target.value)}
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
