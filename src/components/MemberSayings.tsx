import { useState } from 'react';
import { Quote, Plus, X, Trash2, Pencil, Star, CalendarDays } from 'lucide-react';
import { FamilyMember, Saying } from '../types';
import { ageLabelAt, todayISO } from '../utils/age';
import EmptyState from './EmptyState';

interface Props {
  member: FamilyMember;
  onUpdateMember: (updatedMember: FamilyMember) => void;
  canEdit?: boolean;
}

const newId = () => 'say-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const BLANK = { text: '', said: '', context: '', milestone: false };

export default function MemberSayings({ member, onUpdateMember, canEdit = false }: Props) {
  const canWrite = canEdit;
  const sayings = member.sayings || [];
  const first = member.name.split(/\s+/)[0] || member.name;

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ text: string; said: string; context: string; milestone: boolean }>({ ...BLANK });

  const sorted = [...sayings].sort((a, b) => (b.said || '').localeCompare(a.said || ''));

  const openAdd = () => { setEditingId(null); setForm({ ...BLANK, said: todayISO() }); setIsOpen(true); };
  const openEdit = (s: Saying) => {
    setEditingId(s.id);
    setForm({ text: s.text, said: s.said || todayISO(), context: s.context || '', milestone: !!s.milestone });
    setIsOpen(true);
  };
  const close = () => { setIsOpen(false); setEditingId(null); setForm({ ...BLANK }); };

  const save = () => {
    const text = form.text.trim();
    if (!text) return;
    const entry: Saying = {
      id: editingId || newId(),
      text,
      said: form.said || todayISO(),
      context: form.context.trim() || undefined,
      milestone: form.milestone || undefined,
    };
    const next = editingId
      ? sayings.map((s) => (s.id === editingId ? entry : s))
      : [...sayings, entry];
    onUpdateMember({ ...member, sayings: next });
    close();
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this saying?')) return;
    onUpdateMember({ ...member, sayings: sayings.filter((s) => s.id !== id) });
    if (editingId === id) close();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cream-200 pb-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-ink-900 flex items-center gap-2">
            <span className="w-1.5 h-3.5 bg-clay-500 rounded-full inline-block" />
            Sayings
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">The funny &amp; wise things {first} said — captured before they&apos;re forgotten.</p>
        </div>
        {canWrite && (
          <button onClick={isOpen ? close : openAdd} className="btn-primary shrink-0">
            {isOpen ? <><X className="w-3.5 h-3.5" /> Cancel</> : <><Plus className="w-3.5 h-3.5" /> Add a saying</>}
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {isOpen && canWrite && (
        <div className="bg-cream-100 border border-cream-300 rounded-2xl p-5 space-y-4">
          <div>
            <label className="field-label">What did {first} say? <span className="text-rosa-600">*</span></label>
            <textarea
              rows={2}
              autoFocus
              placeholder={`e.g. "I'm not tired, my eyes are just having a hug."`}
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              className="field w-full resize-none"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">When</label>
              <input type="date" value={form.said} max={todayISO()} onChange={(e) => setForm({ ...form, said: e.target.value })} className="field w-full" />
              {ageLabelAt(member.birthdate, form.said) && (
                <p className="text-[11px] text-ink-400 mt-1">{first} was {ageLabelAt(member.birthdate, form.said)}</p>
              )}
            </div>
            <div>
              <label className="field-label">Context <span className="normal-case text-ink-300 font-normal">· optional</span></label>
              <input type="text" placeholder="e.g. at bedtime, in the car" value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} className="field w-full" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={form.milestone} onChange={(e) => setForm({ ...form, milestone: e.target.checked })} className="rounded border-cream-300 text-clay-500 focus:ring-clay-400 w-4 h-4 cursor-pointer" />
            <span className="text-[13px] font-medium text-ink-700 flex items-center gap-1"><Star className="w-3.5 h-3.5 text-honey-500" /> Mark as a treasured one</span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={close} className="btn-quiet">Cancel</button>
            <button onClick={save} disabled={!form.text.trim()} className="btn-primary disabled:opacity-40">{editingId ? 'Save' : 'Add saying'}</button>
          </div>
        </div>
      )}

      {/* List */}
      {sorted.length === 0 ? (
        <EmptyState
          icon={Quote}
          title="No sayings yet"
          description="Kids say the best things — and forget them by next week. Catch one here and you'll have it forever."
          action={canWrite ? { label: `Add ${first}'s first saying`, onClick: openAdd } : undefined}
          dashed
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((s) => {
            const ageLabel = ageLabelAt(member.birthdate, s.said);
            return (
              <div key={s.id} className="group bg-white border border-cream-300/70 rounded-2xl p-4 shadow-soft hover:shadow-lift transition-all">
                <div className="flex items-start gap-3">
                  <Quote className="w-4 h-4 text-clay-300 shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] text-ink-900 leading-snug font-medium">
                      &ldquo;{s.text}&rdquo;
                      {s.milestone && <Star className="w-3.5 h-3.5 text-honey-500 fill-honey-400 inline-block ml-1.5 -mt-0.5" />}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-2 text-[11.5px] text-ink-400">
                      {ageLabel && <span className="chip bg-clay-100 text-clay-700">{ageLabel}</span>}
                      {s.said && <span className="flex items-center gap-1 tabular-nums"><CalendarDays className="w-3 h-3" />{s.said}</span>}
                      {s.context && <span className="italic">· {s.context}</span>}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-1 shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(s)} className="btn-quiet p-1.5" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(s.id)} className="btn-quiet p-1.5 text-ink-400 hover:text-rosa-500" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
