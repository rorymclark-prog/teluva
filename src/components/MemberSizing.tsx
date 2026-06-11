import React, { useState } from 'react';
import { ClothingSizes, FamilyMember } from '../types';
import { Save, Copy, Check, Info, TrendingUp, Scissors } from 'lucide-react';

interface MemberSizingProps {
  member: FamilyMember;
  onUpdateSizes: (id: string, sizes: ClothingSizes) => void;
}

// Age calculator helper
function calculateAgeInMonths(birthdate?: string): number {
  if (!birthdate) return -1;
  const today = new Date('2026-05-22'); // Fix to the current metadata date
  const birth = new Date(birthdate);
  const diffTime = Math.abs(today.getTime() - birth.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 30.4375);
}

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

export default function MemberSizing({ member, onUpdateSizes }: MemberSizingProps) {
  const [sizes, setSizes] = useState<ClothingSizes>({
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

  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const ageMonths = member.birthdate ? calculateAgeInMonths(member.birthdate) : -1;
  const suggestions = getSizeSuggestions(ageMonths, member.role);

  const handleFieldChange = (field: keyof ClothingSizes, value: string) => {
    setSizes((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    onUpdateSizes(member.id, {
      ...sizes,
      lastUpdated: new Date().toISOString().split('T')[0],
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopy = () => {
    const textParts = [
      `👕 Clothing Sizes for ${member.name}:`,
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
      heightCm: suggestions.height.replace(/[^\d.]/g, ''),
      weightKg: suggestions.weight.split(' ')[0],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Sizing Stats Grid (Responsive adaptation of Design HTML) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs">
          <p className="text-[10px] uppercase tracking-widest text-gray-450 font-bold mb-1.5">Shirt Size</p>
          <p className="text-2xl font-light text-gray-900">
            {sizes.tops || <span className="text-gray-300 font-extralight">—</span>}
          </p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs">
          <p className="text-[10px] uppercase tracking-widest text-gray-450 font-bold mb-1.5">Shoe Size</p>
          <p className="text-2xl font-light text-gray-900">
            {sizes.shoes || <span className="text-gray-300 font-extralight">—</span>}
          </p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs">
          <p className="text-[10px] uppercase tracking-widest text-gray-450 font-bold mb-1.5">Pant Size</p>
          <p className="text-2xl font-light text-gray-900">
            {sizes.bottoms || <span className="text-gray-300 font-extralight">—</span>}
          </p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs">
          <p className="text-[10px] uppercase tracking-widest text-gray-450 font-bold mb-1.5">Height &amp; Weight</p>
          <p className="text-xl font-light text-gray-900 truncate">
            {sizes.heightCm ? `${sizes.heightCm} cm` : <span className="text-gray-300 font-extralight">—</span>}
            {sizes.weightKg && <span className="text-xs text-gray-400 font-normal ml-1">({sizes.weightKg} kg)</span>}
          </p>
        </div>
      </section>

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex flex-wrap items-center gap-2 uppercase tracking-wider">
            <span className="w-1.5 h-3.5 bg-blue-600 rounded-full inline-block"></span>
            <span>Clothing &amp; Fit Values</span>
            <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700 border border-blue-200">
              🇪🇺 EU Standard Active
            </span>
          </h3>
          <p className="text-xs text-gray-500 mt-1">Configure complete sizing specifications for seamless family orders or wardrobe upgrades (EU Standard EN 13402).</p>
        </div>
        
        <div className="flex items-center space-x-2 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-gray-650 bg-white border border-gray-250 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer shadow-xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied Details!' : 'Copy to Clipboard'}</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-gray-950 hover:bg-black rounded-xl transition-all shadow-sm cursor-pointer"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saved ? 'Saved Successfully!' : 'Save Essentials'}</span>
          </button>
        </div>
      </div>

      {/* Suggestion Engine Alert */}
      {suggestions && (
        <div className="p-4 rounded-2xl bg-gray-50 border border-gray-150 flex items-start space-x-3 shadow-xs">
          <div className="p-1.5 rounded-xl bg-gray-100 text-gray-700 mt-0.5">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h4 className="text-[10px] font-bold text-gray-950 tracking-wider uppercase">Smart Fit Estimator</h4>
            <p className="text-xs text-gray-600 mt-0.5">
              Consistent standard sizing recommendation based on {member.name}&apos;s birthdate:
            </p>
            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-white p-2 rounded-xl border border-gray-150">
                <span className="text-[9px] text-gray-400 block font-semibold uppercase tracking-wider">Tops/Pants</span>
                <span className="font-semibold text-gray-800">{suggestions.tops}</span>
              </div>
              <div className="bg-white p-2 rounded-xl border border-gray-150">
                <span className="text-[9px] text-gray-400 block font-semibold uppercase tracking-wider">Shoes</span>
                <span className="font-semibold text-gray-800">{suggestions.shoes}</span>
              </div>
              <div className="bg-white p-2 rounded-xl border border-gray-150">
                <span className="text-[9px] text-gray-400 block font-semibold uppercase tracking-wider">Height</span>
                <span className="font-semibold text-gray-800">{suggestions.height}</span>
              </div>
              <div className="bg-white p-2 rounded-xl border border-gray-150">
                <span className="text-[9px] text-gray-400 block font-semibold uppercase tracking-wider">Weight</span>
                <span className="font-semibold text-gray-800">{suggestions.weight}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={applySuggestions}
              className="mt-3 text-xs font-bold text-gray-900 hover:text-black flex items-center gap-1 cursor-pointer underline underline-offset-2"
            >
              Apply Estimated Standard Sizes
            </button>
          </div>
        </div>
      )}

      {/* Sizing Form Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Metric Height / Weight */}
        <div className="p-4 rounded-2xl bg-gray-50 border border-gray-150 grid grid-cols-2 gap-4 col-span-1 sm:col-span-2 shadow-xs">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              Height (cm)
            </label>
            <input
              type="number"
              placeholder="e.g. 116"
              value={sizes.heightCm}
              onChange={(e) => handleFieldChange('heightCm', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
              Weight (kg)
            </label>
            <input
              type="number"
              placeholder="e.g. 21"
              value={sizes.weightKg}
              onChange={(e) => handleFieldChange('weightKg', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900"
            />
          </div>
        </div>

        {/* Basic Clothes Sizes */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
              Tops / Shirts Size (EU)
            </label>
            <input
              type="text"
              placeholder="e.g. EU 140, EU 38 (M), Medium"
              value={sizes.tops}
              onChange={(e) => handleFieldChange('tops', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
              Bottoms / Pants Size (EU)
            </label>
            <input
              type="text"
              placeholder="e.g. EU 140, EU 38 / 30W"
              value={sizes.bottoms}
              onChange={(e) => handleFieldChange('bottoms', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
              Shoe Size (EU)
            </label>
            <input
              type="text"
              placeholder="e.g. EU 35, EU 43"
              value={sizes.shoes}
              onChange={(e) => handleFieldChange('shoes', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
              Outerwear / Coats (EU)
            </label>
            <input
              type="text"
              placeholder="e.g. EU 140, EU 40 (M)"
              value={sizes.outerwear}
              onChange={(e) => handleFieldChange('outerwear', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
              Underwear (EU)
            </label>
            <input
              type="text"
              placeholder="e.g. EU 140, M"
              value={sizes.underwear}
              onChange={(e) => handleFieldChange('underwear', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
              Hat / Head Circumference
            </label>
            <input
              type="text"
              placeholder="e.g. 54 cm, 58 cm"
              value={sizes.hatValue}
              onChange={(e) => handleFieldChange('hatValue', e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors"
            />
          </div>
        </div>

        {/* Brand Preferences & fit notes */}
        <div className="col-span-1 sm:col-span-2">
          <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
            Brand preferences, allergies, or fit notes
          </label>
          <textarea
            rows={2}
            placeholder="e.g. Prefers tagless designs, prefers organic cotton. Target brand runs small, size up."
            value={sizes.notes}
            onChange={(e) => handleFieldChange('notes', e.target.value)}
            className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 transition-colors font-sans"
          />
        </div>
      </div>

      {member.clothingSizes.lastUpdated && (
        <p className="text-right text-[10px] text-gray-400 font-mono">
          Last updated: {member.clothingSizes.lastUpdated}
        </p>
      )}
    </div>
  );
}
