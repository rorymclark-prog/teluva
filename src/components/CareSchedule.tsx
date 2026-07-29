import React, { useState, useEffect } from 'react';
import { CareSchedule as CareItem, FamilyMember } from '../types';
import { CARE_KINDS, careNextDue, careDueLabel } from '../utils/care';
import {
  Stethoscope, Plus, Pencil, Check, X,
} from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import EmptyState from './EmptyState';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

interface CareScheduleProps {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
}

/* ---- Due chip ---- */
function DueChip({ item }: { item: CareItem }) {
  const due = careNextDue(item);
  const label = careDueLabel(due);

  const cls =
    due.status === 'overdue' ? 'chip bg-rosa-100 text-rosa-700' :
    due.status === 'due-soon' ? 'chip bg-honey-100 text-honey-700' :
    due.status === 'ok' ? 'chip bg-sage-100 text-sage-700' :
    'chip bg-cream-200 text-ink-500';

  return <span className={cls}>{label}</span>;
}

/* ---- Care form (add / edit) ---- */
function CareForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: CareItem;
  onSave: (v: CareItem) => void;
  onCancel: () => void;
}) {
  const isPreset = (k: string) => CARE_KINDS.some(c => c.kind === k);

  const [kind, setKind] = useState(
    initial && isPreset(initial.kind) ? initial.kind : 'Other'
  );
  const [customKind, setCustomKind] = useState(
    initial && !isPreset(initial.kind) ? initial.kind : ''
  );
  const [provider, setProvider] = useState(initial?.provider || '');
  const [lastVisit, setLastVisit] = useState(initial?.lastVisit || '');
  const [intervalMonths, setIntervalMonths] = useState(
    initial?.intervalMonths != null ? String(initial.intervalMonths) : '12'
  );
  const [nextDue, setNextDue] = useState(initial?.nextDue || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const handleKindChange = (value: string) => {
    setKind(value);
    const preset = CARE_KINDS.find(k => k.kind === value);
    if (preset) setIntervalMonths(String(preset.defaultInterval));
  };

  const [formError, setFormError] = useState<string | null>(null);
  const save = () => {
    const finalKind = (kind === 'Other' && customKind.trim()) ? customKind.trim() : kind;
    if (!finalKind.trim()) { setFormError('Choose or type what this is'); return; }
    setFormError(null);
    const interval = parseInt(intervalMonths, 10);
    onSave({
      id: initial?.id || newId(),
      kind: finalKind,
      provider: provider.trim() || undefined,
      lastVisit: lastVisit || undefined,
      intervalMonths: Number.isFinite(interval) && interval > 0 ? interval : 12,
      nextDue: nextDue || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <select
          autoFocus
          className="field"
          value={kind}
          onChange={e => handleKindChange(e.target.value)}
        >
          {CARE_KINDS.map(k => (
            <option key={k.kind} value={k.kind}>{k.kind}</option>
          ))}
        </select>
        <input
          className="field"
          placeholder="Provider (e.g. Dr. Müller)"
          value={provider}
          onChange={e => setProvider(e.target.value)}
        />
      </div>

      {kind === 'Other' && (
        <input
          className="field"
          placeholder="Specify appointment type"
          value={customKind}
          onChange={e => setCustomKind(e.target.value)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Last visit</label>
          <input
            type="date"
            className="field"
            value={lastVisit}
            onChange={e => setLastVisit(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Every N months</label>
          <input
            type="number"
            min={1}
            className="field"
            value={intervalMonths}
            onChange={e => setIntervalMonths(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="field-label">Next appointment (optional — overrides the estimate)</label>
        <input
          type="date"
          className="field"
          value={nextDue}
          onChange={e => setNextDue(e.target.value)}
        />
      </div>

      <input
        className="field"
        placeholder="Notes (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />

      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
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

/* ---- Main component ---- */
export default function CareSchedule({ member, onUpdate }: CareScheduleProps) {
  const [items, setItems] = useState<CareItem[]>(() => member.careSchedule || []);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Reset when selected member changes
  useEffect(() => {
    setItems(member.careSchedule || []);
    setAdding(false);
    setEditId(null);
  }, [member.id]);

  const save = (v: CareItem) => {
    const exists = items.find(x => x.id === v.id);
    const next = exists ? items.map(x => x.id === v.id ? v : x) : [...items, v];
    setItems(next);
    onUpdate({ careSchedule: next });
    setAdding(false);
    setEditId(null);
  };

  const remove = (id: string) => {
    const next = items.filter(x => x.id !== id);
    setItems(next);
    onUpdate({ careSchedule: next });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-cream-200">
        <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
          <Stethoscope className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold text-ink-900">
            Care &amp; check-ups
          </h3>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Recurring appointments — we'll remind you when the next one is due for {member.name}.
          </p>
        </div>
      </div>

      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5">
            <Stethoscope className="w-3.5 h-3.5" /> Appointments
          </h4>
          <button
            onClick={() => { setAdding(true); setEditId(null); }}
            className="btn-primary text-xs px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {adding && (
          <CareForm
            onSave={save}
            onCancel={() => setAdding(false)}
          />
        )}

        {items.length === 0 && !adding ? (
          <EmptyState
            size="sm"
            title="No appointments tracked yet — add a dentist, check-up, or eye test and we'll work out when the next one is due."
          />
        ) : (
          <div className="space-y-2.5">
            {items.map(item =>
              editId === item.id ? (
                <div key={item.id}>
                  <CareForm
                    initial={item}
                    onSave={save}
                    onCancel={() => setEditId(null)}
                  />
                </div>
              ) : (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl border border-cream-200 bg-white flex flex-wrap items-start justify-between gap-3 hover:bg-cream-50 hover:border-cream-300 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-ink-900">{item.kind}</p>
                      <DueChip item={item} />
                    </div>
                    {item.provider && (
                      <p className="text-[13px] text-ink-600">{item.provider}</p>
                    )}
                    {item.lastVisit && (
                      <p className="text-[12px] text-ink-500">
                        Last visit: <span className="tabular-nums">{new Date(item.lastVisit).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}</span>
                      </p>
                    )}
                    <p className="text-[12px] text-ink-500">
                      Every <span className="tabular-nums">{item.intervalMonths}</span> month{item.intervalMonths !== 1 ? 's' : ''}
                    </p>
                    {item.notes && (
                      <p className="text-[12px] text-ink-400">{item.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditId(item.id); setAdding(false); }}
                      className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <ConfirmDeleteButton
                      onConfirm={() => remove(item.id)}
                      ariaLabel={`Delete ${item.kind || 'this'} care schedule entry`}
                    />
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}
