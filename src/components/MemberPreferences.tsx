import React, { useState, useEffect } from 'react';
import { FamilyMember, Preferences } from '../types';
import { Utensils, Film, Activity, Shirt } from 'lucide-react';

interface MemberPreferencesProps {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
}

const initPreferences = (member: FamilyMember): Preferences => ({
  favoriteMeals: member.preferences?.favoriteMeals || '',
  dislikedFoods: member.preferences?.dislikedFoods || '',
  dietaryRestrictions: member.preferences?.dietaryRestrictions || '',
  favoriteMovies: member.preferences?.favoriteMovies || '',
  favoriteBooks: member.preferences?.favoriteBooks || '',
  favoriteGames: member.preferences?.favoriteGames || '',
  favoriteMusic: member.preferences?.favoriteMusic || '',
  sports: member.preferences?.sports || '',
  hobbies: member.preferences?.hobbies || '',
  clothingBrands: member.preferences?.clothingBrands || '',
  colorPreferences: member.preferences?.colorPreferences || '',
});

export default function MemberPreferences({ member, onUpdate }: MemberPreferencesProps) {
  const [prefs, setPrefs] = useState<Preferences>(() => initPreferences(member));

  // Reset local state when member.id changes (member-tab pattern)
  useEffect(() => {
    setPrefs(initPreferences(member));
  }, [member.id]);

  const handleFieldChange = (field: keyof Preferences, value: string) => {
    setPrefs((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = () => {
    onUpdate({ preferences: prefs });
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Food preferences */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-honey-100 text-honey-700 shrink-0">
            <Utensils className="w-4 h-4" />
          </div>
          <h3 className="section-label">Food</h3>
        </div>

        <div>
          <label className="field-label">Favorite meals</label>
          <textarea
            rows={2}
            placeholder="e.g. Pasta, pizza, curry, sushi…"
            value={prefs.favoriteMeals}
            onChange={(e) => handleFieldChange('favoriteMeals', e.target.value)}
            onBlur={handleBlur}
            className="field font-sans"
          />
        </div>

        <div>
          <label className="field-label">Disliked foods</label>
          <textarea
            rows={2}
            placeholder="e.g. Olives, mushrooms, spicy foods…"
            value={prefs.dislikedFoods}
            onChange={(e) => handleFieldChange('dislikedFoods', e.target.value)}
            onBlur={handleBlur}
            className="field font-sans"
          />
        </div>

        <div>
          <label className="field-label">Dietary restrictions</label>
          <textarea
            rows={2}
            placeholder="e.g. Vegetarian, nut allergy, gluten-free, kosher…"
            value={prefs.dietaryRestrictions}
            onChange={(e) => handleFieldChange('dietaryRestrictions', e.target.value)}
            onBlur={handleBlur}
            className="field font-sans"
          />
        </div>
      </section>

      {/* Entertainment preferences */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
            <Film className="w-4 h-4" />
          </div>
          <h3 className="section-label">Entertainment</h3>
        </div>

        <div>
          <label className="field-label">Favorite movies</label>
          <input
            type="text"
            placeholder="e.g. Spirited Away, The Dark Knight, Frozen…"
            value={prefs.favoriteMovies}
            onChange={(e) => handleFieldChange('favoriteMovies', e.target.value)}
            onBlur={handleBlur}
            className="field"
          />
        </div>

        <div>
          <label className="field-label">Favorite books</label>
          <input
            type="text"
            placeholder="e.g. Percy Jackson, Harry Potter, Educated…"
            value={prefs.favoriteBooks}
            onChange={(e) => handleFieldChange('favoriteBooks', e.target.value)}
            onBlur={handleBlur}
            className="field"
          />
        </div>

        <div>
          <label className="field-label">Favorite games</label>
          <input
            type="text"
            placeholder="e.g. Minecraft, Fortnite, Chess, D&D…"
            value={prefs.favoriteGames}
            onChange={(e) => handleFieldChange('favoriteGames', e.target.value)}
            onBlur={handleBlur}
            className="field"
          />
        </div>

        <div>
          <label className="field-label">Favorite music</label>
          <input
            type="text"
            placeholder="e.g. Taylor Swift, Lo-fi hip hop, Classical…"
            value={prefs.favoriteMusic}
            onChange={(e) => handleFieldChange('favoriteMusic', e.target.value)}
            onBlur={handleBlur}
            className="field"
          />
        </div>
      </section>

      {/* Hobbies & interests */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-sage-100 text-sage-700 shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <h3 className="section-label">Hobbies & interests</h3>
        </div>

        <div>
          <label className="field-label">Sports</label>
          <input
            type="text"
            placeholder="e.g. Football, tennis, swimming, rock climbing…"
            value={prefs.sports}
            onChange={(e) => handleFieldChange('sports', e.target.value)}
            onBlur={handleBlur}
            className="field"
          />
        </div>

        <div>
          <label className="field-label">Hobbies</label>
          <textarea
            rows={2}
            placeholder="e.g. Photography, drawing, cooking, coding, gardening…"
            value={prefs.hobbies}
            onChange={(e) => handleFieldChange('hobbies', e.target.value)}
            onBlur={handleBlur}
            className="field font-sans"
          />
        </div>
      </section>

      {/* Style preferences */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
          <div className="p-2 rounded-2xl bg-rosa-100 text-rosa-700 shrink-0">
            <Shirt className="w-4 h-4" />
          </div>
          <h3 className="section-label">Style</h3>
        </div>

        <div>
          <label className="field-label">Clothing brands</label>
          <input
            type="text"
            placeholder="e.g. Nike, Zara, H&M, Uniqlo…"
            value={prefs.clothingBrands}
            onChange={(e) => handleFieldChange('clothingBrands', e.target.value)}
            onBlur={handleBlur}
            className="field"
          />
        </div>

        <div>
          <label className="field-label">Color preferences</label>
          <input
            type="text"
            placeholder="e.g. Navy, pastels, earth tones, bright colors…"
            value={prefs.colorPreferences}
            onChange={(e) => handleFieldChange('colorPreferences', e.target.value)}
            onBlur={handleBlur}
            className="field"
          />
        </div>
      </section>
    </div>
  );
}
