import { useState, useEffect } from 'react';
import { BookHeart, Plus, X, Trash2, Pencil, Sparkles, CalendarDays } from 'lucide-react';
import { FamilyMember, FamilyWord } from '../types';
import { loadFamilyWords, saveFamilyWords } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { ageLabelAt, todayISO } from '../utils/age';

const newId = () => 'word-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const BLANK = { word: '', meaning: '', coinedBy: '', approxDate: '', stillUsed: false };

export default function FamilyWordsView({ members, canEdit = false, demo = false, refreshKey = 0 }: { members: FamilyMember[]; canEdit?: boolean; demo?: boolean; refreshKey?: number }) {
  const canWrite = canEdit;
  const [words, setWords] = useState<FamilyWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ word: string; meaning: string; coinedBy: string; approxDate: string; stillUsed: boolean }>({ ...BLANK });

  useEffect(() => {
    // Demo is an ephemeral sandbox: never read the real family's reference doc
    // (nor the localStorage fallback) — start empty so demo edits stay local.
    if (demo) { setWords([]); setLoading(false); return; }
    let active = true;
    loadFamilyWords()
      .then((doc) => { if (active) setWords(doc?.words || []); })
      .catch(() => { if (active) setWords([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo, refreshKey]);

  // Live updates, held back while the add/edit sheet is open so the list cannot
  // change under an open form. Whatever arrived lands the moment it closes.
  // Never in demo mode — that sandbox must not touch the real family's data.
  const remoteWaiting = useSharedDoc<{ words: FamilyWord[] }>(
    'familyWords',
    (v) => setWords(v.words || []),
    { hold: isOpen, disabled: demo },
  );

  const sorted = [...words].sort((a, b) => a.word.localeCompare(b.word));

  const persist = async (next: FamilyWord[]) => {
    setWords(next);
    if (demo) return; // demo edits are local only — never touch real Firestore
    setSaving(true); setError(null);
    try {
      const ok = await saveFamilyWords({ words: next });
      if (!ok) setError('Saved on this device, but syncing to your family didn’t go through — check your connection.');
    } finally { setSaving(false); }
  };

  const openAdd = () => { setEditingId(null); setForm({ ...BLANK }); setIsOpen(true); };
  const openEdit = (w: FamilyWord) => {
    setEditingId(w.id);
    setForm({ word: w.word, meaning: w.meaning, coinedBy: w.coinedBy || '', approxDate: w.approxDate || '', stillUsed: !!w.stillUsed });
    setIsOpen(true);
  };
  const close = () => { setIsOpen(false); setEditingId(null); setForm({ ...BLANK }); };

  const save = async () => {
    const word = form.word.trim();
    const meaning = form.meaning.trim();
    if (!word || !meaning) return;
    const entry: FamilyWord = {
      id: editingId || newId(),
      word,
      meaning,
      coinedBy: form.coinedBy.trim() || undefined,
      approxDate: form.approxDate || undefined,
      stillUsed: form.stillUsed || undefined,
    };
    const next = editingId ? words.map((w) => (w.id === editingId ? entry : w)) : [...words, entry];
    await persist(next);
    close();
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this word?')) return;
    await persist(words.filter((w) => w.id !== id));
    if (editingId === id) close();
  };

  // Age hint: only when the coiner matches a family member with a birthdate + a date.
  const ageHint = (w: FamilyWord): string | null => {
    if (!w.coinedBy || !w.approxDate) return null;
    const m = members.find((mm) => mm.name.trim().toLowerCase() === w.coinedBy!.trim().toLowerCase());
    return m ? ageLabelAt(m.birthdate, w.approxDate) : null;
  };

  if (loading) {
    return <div className="card flex items-center justify-center py-24"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" /></div>;
  }

  return (
    <div className="max-w-lg space-y-4">
      {/* Header */}
      <div className="card p-5 sm:p-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0"><BookHeart className="w-5 h-5" /></div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Family Words</h2>
            <p className="text-[13px] text-ink-500 font-medium">{words.length === 0 ? 'Your family’s private language' : `${words.length} word${words.length === 1 ? '' : 's'}`}</p>
          </div>
        </div>
        {canWrite && (
          <button onClick={isOpen ? close : openAdd} className="btn-primary text-xs px-3 py-2 shrink-0">
            {isOpen ? <><X className="w-3.5 h-3.5" /> Cancel</> : <><Plus className="w-3.5 h-3.5" /> Add word</>}
          </button>
        )}
      </div>

      {error && <div className="rounded-xl bg-honey-50 border border-honey-200 text-honey-800 text-[12px] px-4 py-2.5">{error}</div>}

      {/* Add / edit form */}
      {isOpen && canWrite && (
        <div className="card p-5 space-y-4">
          <RemoteChangeHint show={remoteWaiting} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">The word <span className="text-rosa-600">*</span></label>
              <input type="text" autoFocus placeholder="e.g. boo-blerries" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} className="field w-full" />
            </div>
            <div>
              <label className="field-label">What it means <span className="text-rosa-600">*</span></label>
              <input type="text" placeholder="e.g. blueberries" value={form.meaning} onChange={(e) => setForm({ ...form, meaning: e.target.value })} className="field w-full" />
            </div>
          </div>

          <div>
            <label className="field-label">Who coined it? <span className="normal-case text-ink-300 font-normal">· optional</span></label>
            {members.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const active = form.coinedBy.trim().toLowerCase() === m.name.trim().toLowerCase();
                  return (
                    <button key={m.id} type="button" onClick={() => setForm({ ...form, coinedBy: active ? '' : m.name })}
                      className={`chip cursor-pointer transition-colors ${active ? 'bg-dusk-500 text-white' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}>
                      {m.name.split(/\s+/)[0]}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input type="text" placeholder="Name" value={form.coinedBy} onChange={(e) => setForm({ ...form, coinedBy: e.target.value })} className="field w-full" />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <label className="field-label">Roughly when <span className="normal-case text-ink-300 font-normal">· optional</span></label>
              <input type="date" value={form.approxDate} max={todayISO()} onChange={(e) => setForm({ ...form, approxDate: e.target.value })} className="field w-full" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none pb-2.5">
              <input type="checkbox" checked={form.stillUsed} onChange={(e) => setForm({ ...form, stillUsed: e.target.checked })} className="rounded border-cream-300 text-dusk-500 focus:ring-dusk-400 w-4 h-4 cursor-pointer" />
              <span className="text-[13px] font-medium text-ink-700">We still use it</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={close} className="btn-quiet">Cancel</button>
            <button onClick={save} disabled={!form.word.trim() || !form.meaning.trim() || saving} className="btn-primary disabled:opacity-40">{editingId ? 'Save' : 'Add word'}</button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:p-5">
          {sorted.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-dusk-50 text-dusk-600 flex items-center justify-center"><BookHeart className="w-8 h-8" /></div>
              <p className="text-[14px] font-medium text-ink-700">No family words yet</p>
              <p className="text-[12px] text-ink-500 mt-1">Every family invents a few — the mangled words that stuck.</p>
              {canWrite && <button onClick={openAdd} className="btn-primary mt-5 text-xs px-4 py-2"><Plus className="w-3.5 h-3.5" /> Add your first word</button>}
            </div>
          ) : (
            <div className="space-y-1">
              {sorted.map((w) => {
                const hint = ageHint(w);
                return (
                  <div key={w.id} className="group flex items-start gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-dusk-50 text-dusk-600 flex items-center justify-center shrink-0"><Sparkles className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-ink-900 leading-tight">
                        {w.word} <span className="text-ink-400 font-normal">— {w.meaning}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-[11.5px] text-ink-400">
                        {w.coinedBy && <span>coined by <span className="text-ink-600 font-medium">{w.coinedBy.split(/\s+/)[0]}</span></span>}
                        {hint && <span className="chip bg-dusk-100 text-dusk-700">{hint}</span>}
                        {w.approxDate && <span className="flex items-center gap-1 tabular-nums"><CalendarDays className="w-3 h-3" />{w.approxDate}</span>}
                        {w.stillUsed && <span className="chip bg-sage-100 text-sage-700">still used</span>}
                      </div>
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-1 shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(w)} className="btn-quiet p-1.5" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => remove(w.id)} className="btn-quiet p-1.5 text-ink-400 hover:text-rosa-500" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
