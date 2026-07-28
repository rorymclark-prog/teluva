import React, { useState, useEffect } from 'react';
import { FamilyMember, EmployeePreferences } from '../types';
import { Coffee, Utensils, Shirt, Megaphone, BellOff, UserCircle } from 'lucide-react';

// The business-appropriate equivalent of MemberPreferences.tsx (family
// "Likes"). Deliberately a NARROWER field set — see EmployeePreferences in
// types.ts for why each field made the cut (and what was left out on
// purpose: no favourite movies/games/colours, nothing GDPR "special
// category"). The "no fuss, please" toggle writes to member.noCelebrations
// directly (a top-level FamilyMember field, not nested under
// employeePreferences) so it also suppresses the birthday celebration, not
// just this form.

interface Props {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
  canEdit?: boolean;
}

const initPrefs = (member: FamilyMember): EmployeePreferences => ({
  preferredName: member.employeePreferences?.preferredName || '',
  coffeeOrTea: member.employeePreferences?.coffeeOrTea || '',
  dietaryRequirements: member.employeePreferences?.dietaryRequirements || '',
  kitSize: member.employeePreferences?.kitSize || '',
  recognitionStyle: member.employeePreferences?.recognitionStyle || '',
  notes: member.employeePreferences?.notes || '',
});

export default function MemberEmployeePreferences({ member, onUpdate, canEdit = true }: Props) {
  const [prefs, setPrefs] = useState<EmployeePreferences>(() => initPrefs(member));
  const first = member.name.split(/\s+/)[0] || member.name;

  useEffect(() => {
    setPrefs(initPrefs(member));
  }, [member.id]);

  const handleFieldChange = (field: keyof EmployeePreferences, value: string) => {
    setPrefs((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = () => {
    // Drop empty strings so a cleared field doesn't linger as '' forever.
    const cleaned: EmployeePreferences = {};
    (Object.keys(prefs) as (keyof EmployeePreferences)[]).forEach((k) => {
      const v = prefs[k];
      if (v && v.trim()) cleaned[k] = v.trim();
    });
    onUpdate({ employeePreferences: cleaned });
  };

  const toggleNoFuss = () => {
    onUpdate({ noCelebrations: !member.noCelebrations });
  };

  return (
    <div className="space-y-6 font-sans">
      <p className="text-[13px] text-ink-500 -mt-1">
        The things worth remembering about {first} at work — how to address them, a drink order,
        what to know for shared meals, and what kind of fuss (if any) they'd actually like made of them.
      </p>

      {/* How to address them */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
            <UserCircle className="w-4 h-4" />
          </div>
          <h3 className="section-label">How to address them</h3>
        </div>
        <div>
          <label className="field-label">Preferred name</label>
          <input
            type="text"
            placeholder={`If different from "${member.name}"`}
            value={prefs.preferredName}
            onChange={(e) => handleFieldChange('preferredName', e.target.value)}
            onBlur={handleBlur}
            className="field"
            disabled={!canEdit}
          />
        </div>
      </section>

      {/* Team meals / catering */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-honey-100 text-honey-700 shrink-0">
            <Coffee className="w-4 h-4" />
          </div>
          <h3 className="section-label">Drink &amp; catering</h3>
        </div>
        <div>
          <label className="field-label">Coffee / tea order</label>
          <input
            type="text"
            placeholder="e.g. Flat white, no sugar"
            value={prefs.coffeeOrTea}
            onChange={(e) => handleFieldChange('coffeeOrTea', e.target.value)}
            onBlur={handleBlur}
            className="field"
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className="field-label flex items-center gap-1.5"><Utensils className="w-3 h-3" /> Dietary requirements</label>
          <textarea
            rows={2}
            placeholder="e.g. Vegetarian, nut allergy, halal — for shared meals and team events"
            value={prefs.dietaryRequirements}
            onChange={(e) => handleFieldChange('dietaryRequirements', e.target.value)}
            onBlur={handleBlur}
            className="field font-sans"
            disabled={!canEdit}
          />
        </div>
      </section>

      {/* Kit / uniform */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-sage-100 text-sage-700 shrink-0">
            <Shirt className="w-4 h-4" />
          </div>
          <h3 className="section-label">Company kit</h3>
        </div>
        <div>
          <label className="field-label">T-shirt / uniform size</label>
          <input
            type="text"
            placeholder="e.g. Medium, EU 42"
            value={prefs.kitSize}
            onChange={(e) => handleFieldChange('kitSize', e.target.value)}
            onBlur={handleBlur}
            className="field"
            disabled={!canEdit}
          />
        </div>
      </section>

      {/* Recognition */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-clay-50 text-clay-600 shrink-0">
            <Megaphone className="w-4 h-4" />
          </div>
          <h3 className="section-label">Recognition</h3>
        </div>
        <div>
          <label className="field-label">What they'd like recognised</label>
          <textarea
            rows={2}
            placeholder="e.g. Loves a shout-out in the team chat, or prefers a quiet word — their call"
            value={prefs.recognitionStyle}
            onChange={(e) => handleFieldChange('recognitionStyle', e.target.value)}
            onBlur={handleBlur}
            className="field font-sans"
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className="field-label">Anything else worth remembering</label>
          <textarea
            rows={2}
            placeholder="In their own words"
            value={prefs.notes}
            onChange={(e) => handleFieldChange('notes', e.target.value)}
            onBlur={handleBlur}
            className="field font-sans"
            disabled={!canEdit}
          />
        </div>

        {/* No fuss, please — the explicit opt-out. Writes to member.noCelebrations
            directly, not employeePreferences, so it also mutes the birthday
            confetti overlay, not just anything shown from this tab. */}
        <label className={`flex items-start gap-3 p-3.5 rounded-2xl border transition-colors ${member.noCelebrations ? 'bg-cream-100 border-cream-300' : 'bg-white border-cream-200'} ${canEdit ? 'cursor-pointer' : ''}`}>
          <input
            type="checkbox"
            checked={!!member.noCelebrations}
            onChange={canEdit ? toggleNoFuss : undefined}
            disabled={!canEdit}
            className="mt-0.5 rounded border-cream-300 text-clay-500 focus:ring-clay-400 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
          />
          <span>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
              <BellOff className="w-3.5 h-3.5 text-ink-400" /> No fuss, please
            </span>
            <span className="block text-[12px] text-ink-500 mt-0.5">
              Skips the birthday and work-anniversary confetti moment and its reminder for {first} — everyone else is unaffected.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
