import React, { useEffect, useState } from 'react';
import { Cake, Plus, Pencil, Trash2, X } from 'lucide-react';
import { ExtendedBirthday } from '../types';
import { loadExtendedBirthdays, saveExtendedBirthdays } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { useFamilyCtx } from '../contexts/FamilyContext';
import SheetGrabber from './SheetGrabber';
import EmptyState from './EmptyState';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { isValidNameDay, formatNameDay, daysUntilNameDay } from '../utils/nameDay';
import { todayIsoLocal, relativeDayLabel } from '../utils/memberAppointments';

// Extended Family & Friends' Birthdays — Rory (2026-08-19, live screenshot
// of the Birthdays panel): a grandparent, aunt/uncle or close family friend
// who isn't a FamilyMember (no profile, no documents, no medical record —
// just a birthday worth remembering) had nowhere to go. Deliberately NOT a
// FamilyMember — see ExtendedBirthday in types.ts. Otherwise a near copy of
// AnniversariesView.tsx: same shared-doc pattern, same 'MM-DD' recurring
// date math, same optional origin-year age count. No member tagging here —
// the whole point of this list is people who AREN'T a member.

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

// A handful of common relationships, offered as one-tap chips — still a free
// text field underneath, so nothing here is a closed list.
const RELATIONSHIP_SUGGESTIONS = ['Grandparent', 'Aunt/Uncle', 'Godparent', 'Cousin', 'Family friend'];

/** The next occurrence of a 'MM-DD' date as a full 'YYYY-MM-DD', or null if invalid. */
function nextOccurrenceIso(monthDay: string): string | null {
  const days = daysUntilNameDay(monthDay);
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayIsoLocal(d);
}

/** "18 years" next to the date — powered by originalYear, omitted when unset. */
function ageLabel(monthDay: string, originalYear?: number): string | null {
  if (!originalYear) return null;
  const iso = nextOccurrenceIso(monthDay);
  if (!iso) return null;
  const age = Number(iso.slice(0, 4)) - originalYear;
  return age > 0 ? `turns ${age}` : null;
}

interface ExtendedBirthdayForm {
  id: string;
  name: string;
  relationship: string;
  date: string;          // 'MM-DD', free text while typing
  originalYear: string;  // kept as text for the input; parsed on save
  notes: string;
  createdAt: string;
}

const BLANK_FORM: ExtendedBirthdayForm = {
  id: '', name: '', relationship: '', date: '', originalYear: '', notes: '', createdAt: '',
};

function toForm(b: ExtendedBirthday): ExtendedBirthdayForm {
  return {
    id: b.id,
    name: b.name,
    relationship: b.relationship || '',
    date: b.date,
    originalYear: b.originalYear ? String(b.originalYear) : '',
    notes: b.notes || '',
    createdAt: b.createdAt,
  };
}

/* onChange keeps the home screen's "Needs attention" and "On this day" cards in
 * step. Dashboard loads this list once per space, so without it a birthday
 * added here would sit correctly on this screen while the home screen went on
 * showing the old list until the next reload — the same class of split the
 * whole extended-birthday rework exists to close. Same shape as
 * ImportantInfo's onContactsChange. */
export default function ExtendedBirthdaysView({ onChange }: { onChange?: (list: ExtendedBirthday[]) => void } = {}) {
  const { canWrite } = useFamilyCtx();
  const [birthdays, setBirthdays] = useState<ExtendedBirthday[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExtendedBirthdayForm | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(!!viewingId);
  useBodyScrollLock(isFormOpen);

  useEffect(() => {
    loadExtendedBirthdays().then(data => {
      setBirthdays(data);
      setLoading(false);
    });
  }, []);

  // Live updates from other family members, held while the form is open —
  // same pattern as AnniversariesView.
  const remoteWaiting = useSharedDoc<{ extendedBirthdays: ExtendedBirthday[] }>(
    'extendedBirthdays',
    (v) => { setBirthdays(v.extendedBirthdays || []); onChange?.(v.extendedBirthdays || []); },
    { hold: isFormOpen },
  );

  const persist = async (updated: ExtendedBirthday[]) => {
    setBirthdays(updated);
    onChange?.(updated);
    await saveExtendedBirthdays(updated);
  };

  // ── Open/close ──

  const openNewForm = () => {
    setForm({ ...BLANK_FORM });
    setError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (b: ExtendedBirthday) => {
    setForm(toForm(b));
    setError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setForm(null);
  };

  // ── Save / delete ──

  const handleSave = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setError('Give them a name');
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
    const record: ExtendedBirthday = {
      id,
      name: form.name.trim(),
      relationship: form.relationship.trim() || undefined,
      date: form.date,
      originalYear,
      notes: form.notes.trim() || undefined,
      createdAt,
    };

    const next = isNew ? [...birthdays, record] : birthdays.map(b => (b.id === id ? record : b));
    await persist(next);
    closeForm();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this? This cannot be undone.')) return;
    await persist(birthdays.filter(b => b.id !== id));
    if (form?.id === id) closeForm();
    if (viewingId === id) setViewingId(null);
  };

  // Soonest-upcoming first — same reasoning as AnniversariesView.
  const sorted = [...birthdays].sort((a, b) => {
    const da = daysUntilNameDay(a.date) ?? Infinity;
    const db = daysUntilNameDay(b.date) ?? Infinity;
    return da !== db ? da - db : a.name.localeCompare(b.name);
  });
  const viewing = birthdays.find(b => b.id === viewingId) || null;

  const todayIso = todayIsoLocal();

  const dateLine = (b: ExtendedBirthday) => {
    const iso = nextOccurrenceIso(b.date);
    const rel = iso ? relativeDayLabel(iso, todayIso) : '';
    const age = ageLabel(b.date, b.originalYear);
    // A relative imported from a family tree may have no birthday on record.
    // Say so, rather than leaving a blank line that reads like a broken row.
    return [formatNameDay(b.date), rel, age].filter(Boolean).join(' · ') || 'Birthday not recorded';
  };

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-dusk-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      {/* Header card */}
      <div className="card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-dusk-100 text-dusk-600 shrink-0">
              <Cake className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Extended Birthdays</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                {birthdays.length === 0 ? 'Nobody added yet' : `${birthdays.length} ${birthdays.length !== 1 ? 'people' : 'person'}`}
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
          {birthdays.length === 0 ? (
            <EmptyState
              icon={Cake}
              tone="dusk"
              title="Nobody added yet"
              description="Grandparents, aunts and uncles, godparents, close friends — anyone whose birthday matters but who isn't a family member here"
              action={canWrite ? { label: 'Add someone', onClick: openNewForm, icon: Plus } : undefined}
            />
          ) : (
            <div className="space-y-1">
              {sorted.map(b => (
                <div
                  key={b.id}
                  onClick={() => setViewingId(b.id)}
                  className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-dusk-50 flex items-center justify-center">
                    <Cake className="w-4 h-4 text-dusk-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-800 text-[14px] leading-tight truncate">{b.name}</p>
                    <p className="text-[12px] text-ink-400 mt-0.5 truncate">{dateLine(b)}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {b.relationship && <span className="chip bg-cream-200 text-ink-600">{b.relationship}</span>}
                    {canWrite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(b); }}
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
                <h3 className="font-display text-xl font-semibold text-ink-900">{viewing.name}</h3>
                <p className="text-[13px] text-ink-500 mt-1">{dateLine(viewing)}</p>
                {viewing.relationship && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className="chip bg-dusk-100 text-dusk-700">{viewing.relationship}</span>
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
                {form.id ? 'Edit' : 'New extended birthday'}
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

              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Name <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Grandma Sue"
                  value={form.name}
                  onChange={e => setForm(prev => (prev ? { ...prev, name: e.target.value } : prev))}
                  className="field w-full"
                />
              </div>

              {/* Relationship */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Relationship
                </label>
                <input
                  type="text"
                  placeholder="e.g. Grandmother, Family friend"
                  value={form.relationship}
                  onChange={e => setForm(prev => (prev ? { ...prev, relationship: e.target.value } : prev))}
                  className="field w-full"
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {RELATIONSHIP_SUGGESTIONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setForm(prev => (prev ? { ...prev, relationship: r } : prev))}
                      className="chip bg-cream-200 text-ink-600 hover:bg-cream-300 transition-colors cursor-pointer"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date + Year */}
              <div className="grid grid-cols-2 gap-3">
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
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                    Birth year (optional)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 1958"
                    value={form.originalYear}
                    onChange={e => setForm(prev => (prev ? { ...prev, originalYear: e.target.value.replace(/[^0-9]/g, '') } : prev))}
                    className="field w-full"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">
                  Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Anything worth remembering — gift ideas, address, phone number"
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
