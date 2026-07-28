import React, { useState, useEffect } from 'react';
import { FamilyTimeline, TimelineEntry } from '../types';
import { loadTimeline, saveTimeline } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import {
  CalendarHeart, Plus, Pencil, Check, X,
  Cloud, CloudOff
} from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';

const EMPTY: FamilyTimeline = { entries: [] };

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

const TIMELINE_TYPES = ['Birth', 'Wedding', 'Graduation', 'Milestone', 'Memory', 'Other'] as const;

const TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Birth: { bg: 'bg-rosa-50', text: 'text-rosa-700', dot: 'bg-rosa-500' },
  Wedding: { bg: 'bg-dusk-50', text: 'text-dusk-700', dot: 'bg-dusk-500' },
  Graduation: { bg: 'bg-sage-100', text: 'text-sage-700', dot: 'bg-sage-500' },
  Milestone: { bg: 'bg-honey-50', text: 'text-honey-900', dot: 'bg-honey-500' },
  Memory: { bg: 'bg-cream-100', text: 'text-ink-700', dot: 'bg-ink-500' },
  Other: { bg: 'bg-clay-50', text: 'text-clay-700', dot: 'bg-clay-500' },
};

export default function TimelineView() {
  const [timeline, setTimeline] = useState<FamilyTimeline>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadTimeline();
      if (active) {
        setTimeline(data && data.entries ? { entries: data.entries } : EMPTY);
        setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, []);

  // Live updates from other family members. Applied silently: the add/edit
  // forms live in the child rows below and keep their own draft state, so a
  // list refresh never disturbs what someone is typing.
  useSharedDoc<FamilyTimeline>('timeline', (v) => setTimeline({ entries: v.entries || [] }));

  const persist = async (next: FamilyTimeline) => {
    setTimeline(next);
    const ok = await saveTimeline(next);
    setCloudSynced(ok);
  };

  if (!loaded) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      <div className="card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-clay-100 text-clay-700 shrink-0">
            <CalendarHeart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Family timeline</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              Births, weddings, graduations, milestones and memories.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-5 sm:p-6 space-y-6">
        <TimelineSection
          entries={timeline.entries}
          onAdd={(e) => persist({ entries: [...timeline.entries, e] })}
          onUpdate={(e) => persist({ entries: timeline.entries.map(en => en.id === e.id ? e : en) })}
          onDelete={(id) => persist({ entries: timeline.entries.filter(en => en.id !== id) })}
        />
      </div>

      <div className="text-center">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {cloudSynced === false ? (
            <><CloudOff className="w-3.5 h-3.5 text-honey-700" /><span>Saved on this device — cloud sync unavailable</span></>
          ) : (
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your family{cloudSynced ? ' · synced' : ''}</span></>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Timeline Section --- */

function TimelineSection({ entries, onAdd, onUpdate, onDelete }: {
  entries: TimelineEntry[];
  onAdd: (e: TimelineEntry) => void;
  onUpdate: (e: TimelineEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const sorted = [...entries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <>
      <div className="flex items-center justify-between pb-4 border-b border-cream-200">
        <h3 className="section-label">Moments</h3>
        <button
          onClick={() => { setAdding(true); setEditId(null); }}
          className="btn-primary text-xs px-3 py-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add moment
        </button>
      </div>

      {adding && (
        <div className="mb-6">
          <TimelineForm
            onSave={(e) => { onAdd(e); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {sorted.length === 0 && !adding ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center mx-auto mb-3">
            <CalendarHeart className="w-5 h-5" />
          </div>
          <p className="text-[13px] text-ink-400">
            No moments yet — add births, anniversaries, graduations, and memories to build your family story.
          </p>
        </div>
      ) : (
        <div className="relative space-y-4 pt-2">
          {sorted.map((entry, idx) => (
            <div key={entry.id} className="relative">
              {/* Vertical line connecting dots */}
              {idx < sorted.length - 1 && (
                <div className="absolute left-[11px] top-12 w-0.5 h-12 bg-cream-300" />
              )}

              {editId === entry.id ? (
                <TimelineForm
                  initial={entry}
                  onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                  onCancel={() => setEditId(null)}
                />
              ) : (
                <div className="flex gap-4">
                  {/* Timeline dot and line */}
                  <div className="flex flex-col items-center pt-1 shrink-0">
                    <div className={`w-6 h-6 rounded-full border-2 border-white shadow-soft ${(TYPE_COLORS[entry.type || 'Other'] ?? TYPE_COLORS.Other).dot}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-2 pt-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono tabular-nums text-[12px] font-semibold text-ink-500">
                            {new Date(entry.date).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                          {entry.type && (
                            <span className={`chip ${(TYPE_COLORS[entry.type] ?? TYPE_COLORS.Other).bg} ${(TYPE_COLORS[entry.type] ?? TYPE_COLORS.Other).text}`}>
                              {entry.type}
                            </span>
                          )}
                        </div>
                        <p className="text-[15px] font-display font-semibold text-ink-900 mb-1">
                          {entry.title}
                        </p>
                        {entry.note && (
                          <p className="text-[13px] text-ink-600 leading-relaxed">
                            {entry.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { setEditId(entry.id); setAdding(false); }}
                          className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <ConfirmDeleteButton
                          onConfirm={() => onDelete(entry.id)}
                          ariaLabel={`Delete "${entry.title || 'this'}" from the timeline`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* --- Timeline Form --- */

function TimelineForm({ initial, onSave, onCancel }: {
  initial?: TimelineEntry;
  onSave: (e: TimelineEntry) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(initial?.date || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [type, setType] = useState(initial?.type || 'Memory');
  const [note, setNote] = useState(initial?.note || '');

  const save = () => {
    if (!date.trim() || !title.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      date: date.trim(),
      title: title.trim(),
      type: type || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Date</label>
          <input
            autoFocus
            type="date"
            className="field"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Type</label>
          <select
            className="field"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {TIMELINE_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="field-label">Title</label>
        <input
          className="field"
          placeholder="e.g. Mia's graduation"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="field-label">Note (optional)</label>
        <textarea
          className="field resize-none"
          placeholder="Add any details, memories, or context…"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5">
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5">
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>
    </div>
  );
}
