import React, { useEffect, useState } from 'react';
import { HeartHandshake, Plus, Pencil, Trash2, X, Sparkles } from 'lucide-react';
import { AnniversaryRecord, AnniversaryKind, FamilyMember } from '../types';
import { loadAnniversaries, saveAnniversaries } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { useFamilyCtx } from '../contexts/FamilyContext';
import SheetGrabber from './SheetGrabber';
import EmptyState from './EmptyState';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { isValidNameDay, formatNameDay, daysUntilNameDay } from '../utils/nameDay';
import { todayIsoLocal, relativeDayLabel } from '../utils/memberAppointments';

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

const KINDS: AnniversaryKind[] = ['Wedding', 'Engagement', 'Adoption', 'Anniversary', 'Other'];

// --- Quick-add ("one-click") chips ------------------------------------------
// Pre-fills the form's title/date/kind for a handful of well-known recurring
// days — the user still confirms and taps Save, nothing is created on click.
// Valentine's Day and New Year's Eve are genuinely fixed 'MM-DD' dates.
// Mother's/Father's Day are NOT — they move by country and year (UK Mothering
// Sunday differs from the US convention below entirely) — so rather than
// build the same movable-date machinery Name Celebrations has (out of scope
// here), this computes the UK/US convention (2nd Sunday of May / 3rd Sunday of
// June) fresh, for the CURRENT year only, at the moment the chip is clicked.
// The form shows an honest caveat so the family can adjust it.
type QuickAddKey = 'valentines' | 'mothers' | 'fathers' | 'nye';

const QUICK_ADDS: { key: QuickAddKey; label: string; title: string }[] = [
  { key: 'valentines', label: "Valentine's Day", title: "Valentine's Day" },
  { key: 'mothers', label: "Mother's Day", title: "Mother's Day" },
  { key: 'fathers', label: "Father's Day", title: "Father's Day" },
  { key: 'nye', label: "New Year's Eve", title: "New Year's Eve" },
];

/** The Nth Sunday of `month` (1-12) in `year`, as 'MM-DD'. */
function nthSundayOfMonth(year: number, month: number, n: number): string {
  const first = new Date(year, month - 1, 1);
  const firstSunday = 1 + ((7 - first.getDay()) % 7);
  const day = new Date(year, month - 1, firstSunday + (n - 1) * 7);
  return `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function quickAddDate(key: QuickAddKey): string {
  const year = new Date().getFullYear();
  switch (key) {
    case 'valentines': return '02-14';
    case 'nye': return '12-31';
    case 'mothers': return nthSundayOfMonth(year, 5, 2);  // 2nd Sunday of May
    case 'fathers': return nthSundayOfMonth(year, 6, 3);  // 3rd Sunday of June
  }
}

// --- Display helpers ---------------------------------------------------------
// A 'MM-DD' recurring date is exactly what a name day already is, so this
// reuses nameDay.ts's date math (isValidNameDay/formatNameDay/daysUntilNameDay)
// rather than re-deriving the same leap-year-safe "next occurrence" logic —
// the function names say "name day" but nothing about the math is specific to
// one.

/** The next occurrence of a 'MM-DD' date as a full 'YYYY-MM-DD', or null if invalid. */
function nextOccurrenceIso(monthDay: string): string | null {
  const days = daysUntilNameDay(monthDay);
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayIsoLocal(d);
}

/** "18 years" next to the date — powered by originalYear, omitted when unset. */
function yearsLabel(monthDay: string, originalYear?: number): string | null {
  if (!originalYear) return null;
  const iso = nextOccurrenceIso(monthDay);
  if (!iso) return null;
  const years = Number(iso.slice(0, 4)) - originalYear;
  return years > 0 ? `${years} year${years === 1 ? '' : 's'}` : null;
}

interface AnniversaryForm {
  id: string;
  title: string;
  kind: AnniversaryKind;
  date: string;          // 'MM-DD', free text while typing
  originalYear: string;  // kept as text for the input; parsed on save
  memberIds: string[];
  notes: string;
  createdAt: string;
}

const BLANK_FORM: AnniversaryForm = {
  id: '', title: '', kind: 'Other', date: '', originalYear: '', memberIds: [], notes: '', createdAt: '',
};

function toForm(a: AnniversaryRecord): AnniversaryForm {
  return {
    id: a.id,
    title: a.title,
    kind: a.kind,
    date: a.date,
    originalYear: a.originalYear ? String(a.originalYear) : '',
    memberIds: a.memberIds || [],
    notes: a.notes || '',
    createdAt: a.createdAt,
  };
}

export default function AnniversariesView({ members }: { members: FamilyMember[] }) {
  const { canWrite } = useFamilyCtx();
  const [anniversaries, setAnniversaries] = useState<AnniversaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<AnniversaryForm | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Two independent overlays live in this component (detail view + add/edit
  // form) — each locks background scroll only while it is itself open, same
  // pattern as RecipeBook.
  useBodyScrollLock(!!viewingId);
  useBodyScrollLock(isFormOpen);

  useEffect(() => {
    loadAnniversaries().then(data => {
      setAnniversaries(data);
      setLoading(false);
    });
  }, []);

  // Live updates from other family members, held while the form is open so a
  // long edit is never disturbed mid-typing — lands automatically on close.
  const remoteWaiting = useSharedDoc<{ anniversaries: AnniversaryRecord[] }>(
    'anniversaries',
    (v) => setAnniversaries(v.anniversaries || []),
    { hold: isFormOpen },
  );

  const persist = async (updated: AnniversaryRecord[]) => {
    setAnniversaries(updated);
    await saveAnniversaries(updated);
  };

  // ── Open/close ──

  const openNewForm = () => {
    setForm({ ...BLANK_FORM });
    setError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (a: AnniversaryRecord) => {
    setForm(toForm(a));
    setError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setForm(null);
  };

  // ── Quick-add chips ──

  const applyQuickAdd = (qa: typeof QUICK_ADDS[number]) => {
    setForm(prev => (prev ? { ...prev, title: qa.title, date: quickAddDate(qa.key), kind: 'Other' } : prev));
  };

  // ── Members ──

  const toggleMember = (id: string) => {
    if (!form) return;
    setForm({
      ...form,
      memberIds: form.memberIds.includes(id) ? form.memberIds.filter(x => x !== id) : [...form.memberIds, id],
    });
  };

  const memberName = (id: string) => {
    const m = members.find(x => x.id === id);
    return m ? (m.nickname || m.name) : null;
  };

  // ── Save / delete ──

  const handleSave = async () => {
    if (!form) return;
    if (!form.title.trim()) {
      setError('Give it a name');
      return;
    }
    if (!isValidNameDay(form.date)) {
      setError('Use MM-DD, e.g. 06-14 for 14 June');
      return;
    }
    let originalYear: number | undefined;
    if (form.originalYear.trim()) {
      const y = Number(form.originalYear.trim());
      const thisYear = new Date().getFullYear();
      if (!Number.isInteger(y) || y < 1900 || y > thisYear) {
        setError(`Year should be between 1900 and ${thisYear}`);
        return;
      }
      originalYear = y;
    }
    setError(null);

    const isNew = !form.id;
    const id = isNew ? newId() : form.id;
    const createdAt = isNew ? new Date().toISOString().slice(0, 10) : form.createdAt;
    const record: AnniversaryRecord = {
      id,
      title: form.title.trim(),
      kind: form.kind,
      date: form.date,
      originalYear,
      memberIds: form.memberIds.length ? form.memberIds : undefined,
      notes: form.notes.trim() || undefined,
      createdAt,
    };

    const next = isNew ? [...anniversaries, record] : anniversaries.map(a => (a.id === id ? record : a));
    await persist(next);
    closeForm();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this? This cannot be undone.')) return;
    await persist(anniversaries.filter(a => a.id !== id));
    if (form?.id === id) closeForm();
    if (viewingId === id) setViewingId(null);
  };

  // Soonest-upcoming first — the whole point of this screen is "what's coming
  // up", not an alphabetical list a user has to scan.
  const sorted = [...anniversaries].sort((a, b) => {
    const da = daysUntilNameDay(a.date) ?? Infinity;
    const db = daysUntilNameDay(b.date) ?? Infinity;
    return da !== db ? da - db : a.title.localeCompare(b.title);
  });
  const viewing = anniversaries.find(a => a.id === viewingId) || null;

  const todayIso = todayIsoLocal();

  const dateLine = (a: AnniversaryRecord) => {
    const iso = nextOccurrenceIso(a.date);
    const rel = iso ? relativeDayLabel(iso, todayIso) : '';
    const years = yearsLabel(a.date, a.originalYear);
    return [formatNameDay(a.date), rel, years].filter(Boolean).join(' · ');
  };

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rosa-100 text-rosa-600 shrink-0">
              <HeartHandshake className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Anniversaries & Special Days</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                {anniversaries.length === 0 ? 'Nothing saved yet' : `${anniversaries.length} date${anniversaries.length !== 1 ? 's' : ''}`}
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
          {anniversaries.length === 0 ? (
            <EmptyState
              icon={HeartHandshake}
              tone="rosa"
              title="Nothing saved yet"
              description="Wedding anniversaries, Valentine's Day and other yearly dates — saved here so you don't have to hunt for them in the calendar"
              action={canWrite ? { label: 'Add a date', onClick: openNewForm, icon: Plus } : undefined}
            />
          ) : (
            <div className="space-y-1">
              {sorted.map(a => (
                <div
                  key={a.id}
                  onClick={() => setViewingId(a.id)}
                  className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-rosa-50 flex items-center justify-center">
                    <HeartHandshake className="w-4 h-4 text-rosa-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-800 text-[14px] leading-tight truncate">{a.title}</p>
                    <p className="text-[12px] text-ink-400 mt-0.5 truncate">{dateLine(a)}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="chip bg-cream-200 text-ink-600">{a.kind}</span>
                    {canWrite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(a); }}
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
            <SheetGrabber onClose={() => setViewingId(null)} />
            <div className="flex items-start justify-between p-6 pb-3 gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-xl font-semibold text-ink-900">{viewing.title}</h3>
                <p className="text-[13px] text-ink-500 mt-1">{dateLine(viewing)}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="chip bg-rosa-100 text-rosa-700">{viewing.kind}</span>
                  {(viewing.memberIds || []).map(id => memberName(id)).filter(Boolean).map(name => (
                    <span key={name} className="chip bg-cream-200 text-ink-600">{name}</span>
                  ))}
                </div>
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

            <div className="px-6 pb-6 space-y-4">
              {viewing.notes ? (
                <div>
                  <p className="section-label mb-2">Notes</p>
                  <p className="text-[14px] text-ink-700 whitespace-pre-wrap">{viewing.notes}</p>
                </div>
              ) : (
                <EmptyState size="sm" title="No notes added yet" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Add/edit form modal ── */}
      {isFormOpen && form && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <SheetGrabber onClose={closeForm} />
            <RemoteChangeHint show={remoteWaiting} className="mx-6 mt-4" />

            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {form.id ? 'Edit' : 'New anniversary or special day'}
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

              {/* Quick-add: pre-fills the fields below — still needs Save. */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  <Sparkles className="w-3 h-3 inline -mt-0.5 mr-1" />
                  Quick add
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_ADDS.map(qa => (
                    <button
                      key={qa.key}
                      type="button"
                      onClick={() => applyQuickAdd(qa)}
                      className="chip bg-cream-200 text-ink-600 hover:bg-cream-300 transition-colors cursor-pointer"
                    >
                      {qa.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink-400 mt-1.5">
                  Mother's & Father's Day move each year — the date filled in is for this year, adjust if needed.
                </p>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Name <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rory & Maria's wedding anniversary"
                  value={form.title}
                  onChange={e => setForm(prev => (prev ? { ...prev, title: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Kind + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                    Type
                  </label>
                  <select
                    value={form.kind}
                    onChange={e => setForm(prev => (prev ? { ...prev, kind: e.target.value as AnniversaryKind } : prev))}
                    className="field w-full"
                  >
                    {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                    Date (MM-DD) <span className="text-rosa-600">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="MM-DD, e.g. 06-14"
                    value={form.date}
                    onChange={e => setForm(prev => (prev ? { ...prev, date: e.target.value } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Original year */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Year it started (optional)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 2012 — powers an “N years” count. Leave blank for Valentine's Day etc."
                  value={form.originalYear}
                  onChange={e => setForm(prev => (prev ? { ...prev, originalYear: e.target.value.replace(/[^0-9]/g, '') } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Members */}
              {members.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                    Who it's about (optional)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleMember(m.id)}
                        className={`chip transition-colors cursor-pointer ${
                          form.memberIds.includes(m.id) ? 'bg-rosa-100 text-rosa-700 ring-1 ring-rosa-300' : 'bg-cream-200 text-ink-600'
                        }`}
                      >
                        {m.nickname || m.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Anything worth remembering about it"
                  value={form.notes}
                  onChange={e => setForm(prev => (prev ? { ...prev, notes: e.target.value } : prev))}
                  className="field w-full resize-none"
                />
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
                <button onClick={handleSave} className="btn-primary text-xs px-5 py-2">
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
