import { useState } from 'react';
import { Feather, Plus, X, Trash2, Pencil } from 'lucide-react';
import { FamilyMember, FavoriteQuote } from '../types';
import EmptyState from './EmptyState';

interface Props {
  member: FamilyMember;
  onUpdateMember: (updatedMember: FamilyMember) => void;
  canEdit?: boolean;
}

const newId = () => 'fq-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const todayISO = () => new Date().toLocaleDateString('en-CA');

const BLANK = { text: '', source: '', note: '' };

// Quotes a family member LOVES — from a book, a song, a grandparent, a film.
// This is the OPPOSITE direction from MemberSayings.tsx: a Saying is dated
// (age-at-the-time is the point), a favorite quote is never dated in the
// card — whose words they were is the point, not when they read/heard them.
export default function MemberFavoriteQuotes({ member, onUpdateMember, canEdit = false }: Props) {
  const canWrite = canEdit;
  const quotes = member.favoriteQuotes || [];
  const first = member.name.split(/\s+/)[0] || member.name;

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ text: string; source: string; note: string }>({ ...BLANK });

  const sorted = [...quotes].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  const openAdd = () => { setEditingId(null); setForm({ ...BLANK }); setIsOpen(true); };
  const openEdit = (q: FavoriteQuote) => {
    setEditingId(q.id);
    setForm({ text: q.text, source: q.source || '', note: q.note || '' });
    setIsOpen(true);
  };
  const close = () => { setIsOpen(false); setEditingId(null); setForm({ ...BLANK }); };

  const save = () => {
    const text = form.text.trim();
    if (!text) return;
    const existing = editingId ? quotes.find((q) => q.id === editingId) : undefined;
    const entry: FavoriteQuote = {
      id: editingId || newId(),
      text,
      source: form.source.trim() || undefined,
      note: form.note.trim() || undefined,
      addedAt: existing?.addedAt || todayISO(),
    };
    const next = editingId
      ? quotes.map((q) => (q.id === editingId ? entry : q))
      : [...quotes, entry];
    onUpdateMember({ ...member, favoriteQuotes: next });
    close();
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this favorite quote?')) return;
    onUpdateMember({ ...member, favoriteQuotes: quotes.filter((q) => q.id !== id) });
    if (editingId === id) close();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cream-200 pb-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-ink-900 flex items-center gap-2">
            <span className="w-1.5 h-3.5 bg-dusk-500 rounded-full inline-block" />
            Quotes {first} loves
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">Words from books, songs, films, or people {first} admires — not their own, but ones that stuck.</p>
        </div>
        {canWrite && (
          <button onClick={isOpen ? close : openAdd} className="btn-primary shrink-0">
            {isOpen ? <><X className="w-3.5 h-3.5" /> Cancel</> : <><Plus className="w-3.5 h-3.5" /> Add a quote</>}
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {isOpen && canWrite && (
        <div className="bg-cream-100 border border-cream-300 rounded-2xl p-5 space-y-4">
          <div>
            <label className="field-label">The quote <span className="text-rosa-500">*</span></label>
            <textarea
              rows={2}
              autoFocus
              placeholder={`e.g. "Not all those who wander are lost."`}
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              className="field w-full resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">Source <span className="normal-case text-ink-400 font-normal">· who said/wrote it, or where it's from</span></label>
              <input type="text" placeholder="e.g. J.R.R. Tolkien, or Grandma" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="field w-full" />
            </div>
            <div>
              <label className="field-label">Note <span className="normal-case text-ink-400 font-normal">· optional</span></label>
              <input type="text" placeholder="Why it matters to them" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="field w-full" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={close} className="btn-quiet">Cancel</button>
            <button onClick={save} disabled={!form.text.trim()} className="btn-primary disabled:opacity-40">{editingId ? 'Save' : 'Add quote'}</button>
          </div>
        </div>
      )}

      {/* List */}
      {sorted.length === 0 ? (
        <EmptyState
          icon={Feather}
          dashed
          title="No favorite quotes yet"
          description={<>A line from a book, a lyric, something Grandma always says — the words {first} keeps coming back to.</>}
          action={canWrite ? { label: `Add ${first}'s first favorite quote`, onClick: openAdd } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((q) => (
            <div key={q.id} className="group bg-white border border-cream-300/70 rounded-2xl p-4 shadow-soft hover:shadow-lift transition-all">
              <div className="flex items-start gap-3">
                <Feather className="w-4 h-4 text-dusk-500/60 shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] text-ink-900 leading-snug font-medium italic">
                    &ldquo;{q.text}&rdquo;
                    {q.source && <span className="not-italic font-normal text-ink-500"> — {q.source}</span>}
                  </p>
                  {q.note && (
                    <p className="text-[12.5px] text-ink-400 mt-1.5">{q.note}</p>
                  )}
                  {!q.source && (
                    <p className="text-[11px] text-ink-400 italic mt-1.5">source not given</p>
                  )}
                </div>
                {canWrite && (
                  <div className="flex items-center gap-1 shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(q)} className="btn-quiet p-1.5" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(q.id)} className="btn-quiet p-1.5 text-ink-400 hover:text-rosa-500" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
