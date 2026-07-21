import React, { useEffect, useRef, useState } from 'react';
import { ChefHat, Plus, Pencil, Trash2, Camera, X, Loader2, Tag } from 'lucide-react';
import { Recipe } from '../types';
import { loadRecipes, saveRecipes, uploadRecipePhoto } from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { compressImageToAvatar } from '../utils/imageCompress';

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

// Ingredients/steps are edited as plain textareas (one per line) and stored
// as string[] — the form keeps them as text and splits/joins on save/load.
interface RecipeForm {
  id: string;
  title: string;
  ingredientsText: string;
  stepsText: string;
  tags: string[];
  photoUrl: string;
  createdAt: string;
}

const BLANK_FORM: RecipeForm = {
  id: '', title: '', ingredientsText: '', stepsText: '', tags: [], photoUrl: '', createdAt: '',
};

function toForm(r: Recipe): RecipeForm {
  return {
    id: r.id,
    title: r.title,
    ingredientsText: (r.ingredients || []).join('\n'),
    stepsText: (r.steps || []).join('\n'),
    tags: r.tags || [],
    photoUrl: r.photoUrl || '',
    createdAt: r.createdAt,
  };
}

export default function RecipeBook() {
  const { canWrite } = useFamilyCtx();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<RecipeForm | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadRecipes().then(data => {
      setRecipes(data);
      setLoading(false);
    });
  }, []);

  const persist = async (updated: Recipe[]) => {
    setRecipes(updated);
    await saveRecipes(updated);
  };

  // ── Open/close ──

  const openNewForm = () => {
    setForm({ ...BLANK_FORM });
    setTagDraft('');
    setError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (r: Recipe) => {
    setForm(toForm(r));
    setTagDraft('');
    setError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setForm(null);
  };

  // ── Tags ──

  const addTag = () => {
    const t = tagDraft.trim();
    if (!t || !form) return;
    if (!form.tags.includes(t)) setForm({ ...form, tags: [...form.tags, t] });
    setTagDraft('');
  };

  const removeTag = (t: string) => {
    if (!form) return;
    setForm({ ...form, tags: form.tags.filter(x => x !== t) });
  };

  // ── Photo (of the original card/page) ──

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !form) return;
    setPhotoUploading(true);
    setError(null);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = ev => resolve(ev.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const compressed = await compressImageToAvatar(dataUrl, 1600, 0.85);
      const url = await uploadRecipePhoto(compressed);
      setForm(prev => (prev ? { ...prev, photoUrl: url } : prev));
    } catch {
      setError("Couldn't upload that photo — please try again.");
    } finally {
      setPhotoUploading(false);
    }
  };

  // ── Save / delete ──

  const handleSave = async () => {
    if (!form) return;
    if (!form.title.trim()) {
      setError('Give the recipe a name');
      return;
    }
    setError(null);

    const isNew = !form.id;
    const id = isNew ? newId() : form.id;
    const createdAt = isNew ? new Date().toISOString().slice(0, 10) : form.createdAt;
    const recipe: Recipe = {
      id,
      title: form.title.trim(),
      ingredients: form.ingredientsText.split('\n').map(s => s.trim()).filter(Boolean),
      steps: form.stepsText.split('\n').map(s => s.trim()).filter(Boolean),
      tags: form.tags.length ? form.tags : undefined,
      photoUrl: form.photoUrl || undefined,
      createdAt,
    };

    const next = isNew ? [...recipes, recipe] : recipes.map(r => (r.id === id ? recipe : r));
    await persist(next);
    closeForm();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this recipe? This cannot be undone.')) return;
    await persist(recipes.filter(r => r.id !== id));
    if (form?.id === id) closeForm();
    if (viewingId === id) setViewingId(null);
  };

  const sorted = [...recipes].sort((a, b) => a.title.localeCompare(b.title));
  const viewing = recipes.find(r => r.id === viewingId) || null;

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <input ref={photoFileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} />

      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-honey-100 text-honey-700 shrink-0">
              <ChefHat className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Recipe Book</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                {recipes.length === 0 ? 'No recipes yet' : `${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          {canWrite && (
            <button onClick={openNewForm} className="btn-primary text-xs px-3 py-2 shrink-0">
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          )}
        </div>

        {/* List */}
        <div className="p-4 sm:p-5">
          {recipes.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
                <ChefHat className="w-8 h-8" />
              </div>
              <p className="text-[14px] font-medium text-ink-700">No recipes yet</p>
              <p className="text-[12px] text-ink-500 mt-1">
                Photograph a recipe card, or tell the assistant one to file it here
              </p>
              {canWrite && (
                <button onClick={openNewForm} className="btn-primary mt-5 text-xs px-4 py-2">
                  <Plus className="w-3.5 h-3.5" />
                  Add a recipe
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {sorted.map(r => (
                <div
                  key={r.id}
                  onClick={() => setViewingId(r.id)}
                  className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors cursor-pointer"
                >
                  {r.photoUrl ? (
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 ring-1 ring-cream-200">
                      <img src={r.photoUrl} alt={r.title} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                      <ChefHat className="w-4 h-4 text-ink-300" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-800 text-[14px] leading-tight truncate">{r.title}</p>
                    {r.tags && r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {r.tags.map(t => (
                          <span key={t} className="chip bg-cream-200 text-ink-600">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-ink-400 tabular-nums">
                      {r.ingredients.length} ingredient{r.ingredients.length !== 1 ? 's' : ''}
                    </span>
                    {canWrite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(r); }}
                        className="btn-quiet p-1.5 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail modal — clean read view for browsing ── */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade"
          onClick={() => setViewingId(null)}
        >
          <div
            className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-cream-400 sm:hidden" />
            {viewing.photoUrl && (
              <img src={viewing.photoUrl} alt={viewing.title} className="w-full max-h-64 object-cover" />
            )}
            <div className="flex items-start justify-between p-6 pb-3 gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-xl font-semibold text-ink-900">{viewing.title}</h3>
                {viewing.tags && viewing.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {viewing.tags.map(t => (
                      <span key={t} className="chip bg-honey-100 text-honey-700">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canWrite && (
                  <button onClick={() => { setViewingId(null); openEditForm(viewing); }} className="btn-quiet p-2">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setViewingId(null)} className="btn-quiet p-2">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 space-y-5">
              {viewing.ingredients.length > 0 && (
                <div>
                  <p className="section-label mb-2">Ingredients</p>
                  <ul className="space-y-1.5">
                    {viewing.ingredients.map((ing, i) => (
                      <li key={i} className="text-[14px] text-ink-700 flex items-start gap-2">
                        <span className="mt-2 w-1 h-1 rounded-full bg-clay-400 shrink-0" />
                        <span>{ing}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {viewing.steps.length > 0 && (
                <div>
                  <p className="section-label mb-2">Method</p>
                  <ol className="space-y-2.5">
                    {viewing.steps.map((step, i) => (
                      <li key={i} className="text-[14px] text-ink-700 flex items-start gap-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-cream-200 text-ink-600 text-[11px] font-bold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {viewing.ingredients.length === 0 && viewing.steps.length === 0 && (
                <p className="text-[13px] text-ink-400">No ingredients or steps recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add/edit form modal ── */}
      {isFormOpen && form && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-cream-400 sm:hidden" />

            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {form.id ? 'Edit recipe' : 'New recipe'}
              </h3>
              <button onClick={closeForm} className="btn-quiet p-2">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="flex items-center justify-between gap-2 bg-rosa-500/10 rounded-xl px-4 py-3">
                  <p className="text-[12px] text-rosa-600">{error}</p>
                  <button onClick={() => setError(null)}>
                    <X className="w-3.5 h-3.5 text-rosa-600" />
                  </button>
                </div>
              )}

              {/* Photo row */}
              <div className="flex items-center gap-4">
                {form.photoUrl ? (
                  <div className="relative shrink-0">
                    <img
                      src={form.photoUrl}
                      alt="Recipe"
                      className="w-24 h-24 object-cover rounded-xl border border-cream-200"
                    />
                    <button
                      onClick={() => setForm(prev => (prev ? { ...prev, photoUrl: '' } : prev))}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink-800 text-white flex items-center justify-center hover:bg-rosa-500 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-xl border-2 border-dashed border-cream-300 flex items-center justify-center shrink-0">
                    <ChefHat className="w-6 h-6 text-ink-200" />
                  </div>
                )}
                <button
                  onClick={() => photoFileRef.current?.click()}
                  disabled={photoUploading}
                  className="btn-quiet text-xs px-3 py-2 disabled:opacity-60"
                >
                  {photoUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  {photoUploading ? 'Uploading…' : form.photoUrl ? 'Replace photo' : 'Add photo of the card'}
                </button>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Name <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Mama's apple strudel"
                  value={form.title}
                  onChange={e => setForm(prev => (prev ? { ...prev, title: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Ingredients */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Ingredients
                </label>
                <textarea
                  rows={5}
                  placeholder={'One per line, e.g.\n500g flour\n2 eggs\n1 tsp salt'}
                  value={form.ingredientsText}
                  onChange={e => setForm(prev => (prev ? { ...prev, ingredientsText: e.target.value } : prev))}
                  className="field w-full resize-none"
                />
              </div>

              {/* Steps */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Method
                </label>
                <textarea
                  rows={6}
                  placeholder={'One step per line, e.g.\nMix flour and salt\nKnead for 10 minutes\nRest for 1 hour'}
                  value={form.stepsText}
                  onChange={e => setForm(prev => (prev ? { ...prev, stepsText: e.target.value } : prev))}
                  className="field w-full resize-none"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Tags
                </label>
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.tags.map(t => (
                      <span key={t} className="chip bg-cream-200 text-ink-600">
                        {t}
                        <button onClick={() => removeTag(t)} className="ml-1 hover:text-rosa-600" title="Remove tag">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Mama's, Christmas, dessert"
                    value={tagDraft}
                    onChange={e => setTagDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
                    }}
                    className="field flex-1"
                  />
                  <button onClick={addTag} className="btn-quiet text-xs px-3 py-2" title="Add tag">
                    <Tag className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 p-6 pt-0">
              <div>
                {form.id && (
                  <button
                    onClick={() => handleDelete(form.id)}
                    className="btn-quiet text-rosa-600 hover:text-rosa-700 text-xs px-3 py-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={closeForm} className="btn-quiet text-xs px-4 py-2">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={photoUploading} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
