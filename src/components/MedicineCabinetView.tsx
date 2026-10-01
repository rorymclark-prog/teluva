import React, { useState, useEffect, useMemo } from 'react';
import { HouseholdInfo, MedicineCabinetItem, MedicineCategory } from '../types';
import { loadHousehold, saveHousehold, loadShopping, saveShopping } from '../utils/db';
import {
  MEDICINE_CATEGORIES, coerceCount, expiryLabel, expiryToMonthInput,
  groupByCategory, itemStatus, normaliseExpiry, remainingSuggestions, restockNames, summarise,
  CabinetStatus,
} from '../utils/medicineCabinet';
import { useSharedDoc } from '../hooks/useSharedDoc';
import EmptyState from './EmptyState';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import {
  BriefcaseMedical, Plus, Pencil, Check, X, Cloud, CloudOff, Minus, ShoppingCart, AlertTriangle, CalendarClock, MapPin,
} from 'lucide-react';

// The Medicine Cabinet: the household's must-have medicines and first-aid
// supplies, listed once, for everybody in the house.
//
// Rory, 2026-09-21: "make a medical box hoem medical supplies (name it
// properly) for teluva where we can have our must hhaves and list them".
//
// The DATA lives in the shared household doc (HouseholdInfo.medicineCabinet),
// exactly like pets: same three-way merge, same live updates, no second store.
//
// What this is NOT: anybody's personal medication. That is on each member's
// Medical tab, where there is one writer per fact. A shelf item here has no
// "for whom" and no dose — it is "we keep this in the house".
//
// Status (out / low / expired / expiring soon) is worked out on every render
// from what was typed and today's date (see utils/medicineCabinet.ts); nothing
// here stores it, so topping the box up can never leave a stale "low" behind.

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

const PILL: Record<CabinetStatus['state'], { label: string; cls: string } | null> = {
  expired: { label: 'Expired', cls: 'bg-rosa-100 text-rosa-800' },
  out: { label: 'Out', cls: 'bg-rosa-100 text-rosa-800' },
  low: { label: 'Running low', cls: 'bg-honey-100 text-honey-800' },
  expiring: { label: 'Expiring soon', cls: 'bg-honey-100 text-honey-800' },
  ok: null,
};

export default function MedicineCabinetView({ refreshKey, canEdit = true }: { refreshKey?: number; canEdit?: boolean }) {
  const [info, setInfo] = useState<HouseholdInfo | null>(null);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Partial<MedicineCabinetItem> | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadHousehold();
      if (active) setInfo(data || {});
    })();
    return () => { active = false; };
  }, [refreshKey]);

  // Another family member updating the box on their phone shows up here
  // without a reload. Applied silently — the form holds its own draft state.
  useSharedDoc<HouseholdInfo>('household', (h) => setInfo(h || {}));

  const items = info?.medicineCabinet ?? [];
  const summary = useMemo(() => summarise(items), [items]);
  const groups = useMemo(() => groupByCategory(items), [items]);
  const suggestions = useMemo(() => remainingSuggestions(items), [items]);

  if (!info) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  // Every write spreads the household doc: a forgotten key in a rebuilt doc is
  // a DELETE of that key for the whole family.
  const persist = async (next: HouseholdInfo) => {
    setInfo(next);
    setCloudSynced(await saveHousehold(next));
  };
  const setItems = (list: MedicineCabinetItem[]) => persist({ ...info, medicineCabinet: list });

  const addToShoppingList = async () => {
    const current = await loadShopping();
    const names = restockNames(items, current);
    if (names.length === 0) {
      setShopMsg('Everything that needs buying is already on the shopping list.');
      return;
    }
    const addedAt = new Date().toISOString().slice(0, 10);
    const added = names.map(name => ({ id: newId(), name, checked: false, addedAt }));
    const ok = await saveShopping([...current, ...added], current);
    // saveReferenceDoc keeps the write on this device and returns false when the
    // cloud copy could not be updated. The items ARE on the list either way, so
    // the message must not say otherwise — it says where they are.
    const added_ = `Added ${names.length} ${names.length === 1 ? 'item' : 'items'} to the shopping list.`;
    setShopMsg(ok === false ? `${added_} Saved on this device — not backed up to the cloud yet.` : added_);
  };

  const step = (it: MedicineCabinetItem, delta: number) => {
    const q = Math.max(0, (it.quantity ?? 0) + delta);
    setItems(items.map(x => x.id === it.id ? { ...x, quantity: q } : x));
  };

  const startAdd = (seed?: Partial<MedicineCabinetItem>) => {
    setPrefill(seed ?? null);
    setAdding(true);
    setEditId(null);
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-sage-100 text-sage-700 shrink-0">
            <BriefcaseMedical className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Medicine Cabinet</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              The medicines, first-aid and supplies you always want in the house.
            </p>
          </div>
        </div>
      </div>

      {items.length > 0 && (summary.restock > 0 || summary.expiring > 0) && (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-3" role="status">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold">
            {summary.restock > 0 && (
              <span className="flex items-center gap-1.5 text-rosa-700">
                <AlertTriangle className="w-4 h-4" /> {summary.restock} {summary.restock === 1 ? 'thing needs' : 'things need'} restocking
              </span>
            )}
            {summary.expiring > 0 && (
              <span className="flex items-center gap-1.5 text-honey-800">
                <CalendarClock className="w-4 h-4" /> {summary.expiring} expiring soon
              </span>
            )}
          </div>
          {canEdit && summary.restock > 0 && (
            <button onClick={addToShoppingList} className="btn-primary text-xs px-3 py-1.5">
              <ShoppingCart className="w-3.5 h-3.5" /> Add to shopping list
            </button>
          )}
        </div>
      )}
      {shopMsg && <p role="status" className="text-[12px] text-ink-500 -mt-3 px-1">{shopMsg}</p>}

      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h3 className="section-label flex items-center gap-1.5">
            <BriefcaseMedical className="w-3.5 h-3.5" /> Must-haves {items.length > 0 && <span className="text-ink-400 font-medium">· {items.length}</span>}
          </h3>
          {canEdit && (
            <button onClick={() => startAdd()} className="btn-primary text-xs px-3 py-1.5">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
        </div>

        {adding && (
          // Keyed wrapper: tapping a second suggestion chip while the form is open
          // must start a fresh form, not keep the first one's draft.
          <div key={prefill?.name ?? 'blank'}>
            <ItemForm
              initial={prefill ? { id: newId(), name: '', ...prefill } : undefined}
              onSave={(it) => { setItems([...items, it]); setAdding(false); setPrefill(null); }}
              onCancel={() => { setAdding(false); setPrefill(null); }}
            />
          </div>
        )}

        {items.length === 0 && !adding ? (
          <EmptyState
            icon={BriefcaseMedical}
            title="Nothing on the shelf yet"
            description="List the medicines and first-aid supplies you always want in the house, how many, and when they expire. Pick from the common essentials below or add your own."
          />
        ) : (
          <div className="space-y-5">
            {groups.map(g => (
              <div key={g.category} className="space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{g.category}</p>
                {g.items.map(it => (
                  <div key={it.id}>
                    {editId === it.id ? (
                      <ItemForm
                        initial={it}
                        onSave={(upd) => { setItems(items.map(x => x.id === upd.id ? upd : x)); setEditId(null); }}
                        onCancel={() => setEditId(null)}
                      />
                    ) : (
                      <ItemRow
                        item={it}
                        canEdit={canEdit}
                        onStep={(d) => step(it, d)}
                        onEdit={() => { setEditId(it.id); setAdding(false); }}
                        onDelete={() => setItems(items.filter(x => x.id !== it.id))}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {canEdit && suggestions.length > 0 && (
        <section className="card p-5 space-y-3">
          <h3 className="section-label">Common essentials</h3>
          <p className="text-[12px] text-ink-500">
            A starting shelf — add what your family actually uses, then rename it to the product you trust.
          </p>
          {[false, true].map(kids => {
            const list = suggestions.filter(s => !!s.forChildren === kids);
            if (list.length === 0) return null;
            return (
              <div key={String(kids)} className="space-y-1.5">
                {kids && <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400">For children</p>}
                <div className="flex flex-wrap gap-2">
                  {list.map(s => (
                    <button
                      key={s.name}
                      onClick={() => startAdd({ name: s.name, category: s.category, quantity: 1, minimum: s.minimum })}
                      className="chip bg-cream-100 text-ink-700 hover:bg-cream-200 px-3 py-1.5 text-[12px] font-semibold"
                    >
                      <Plus className="w-3 h-3" /> {s.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="card p-5 space-y-1.5 text-[12px] text-ink-500">
        <h3 className="section-label">Keeping the box</h3>
        <p>Keep it somewhere cool and dry — the bathroom and the kitchen are too warm and damp — and out of children’s reach.</p>
        <p>Check it at least once a year, and replace what has expired. Most pharmacies take expired medicines back; check locally.</p>
        <p>Your own regular medication belongs on your Medical tab, not here.</p>
      </section>

      <div className="text-center">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {cloudSynced === false ? (
            <><CloudOff className="w-3.5 h-3.5 text-honey-700" /><span>Saved on this device — not backed up to the cloud</span></>
          ) : (
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your family</span></>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── One row ────────────────────────────────────────────────────────────── */

function ItemRow({ item, canEdit, onStep, onEdit, onDelete }: {
  item: MedicineCabinetItem;
  canEdit: boolean;
  onStep: (delta: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = itemStatus(item);
  const pill = PILL[status.state];
  const problem = status.state === 'expired' || status.state === 'out';
  const counting = item.quantity !== undefined;

  return (
    <div className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 transition-colors ${problem ? 'border-rosa-200 bg-rosa-50/50' : 'border-cream-200 bg-white hover:bg-cream-50 hover:border-cream-300'}`}>
      <div className="min-w-0 space-y-0.5">
        <p className="text-[14px] font-semibold text-ink-900">
          {item.name}
          {pill && <span className={`chip ml-2 ${pill.cls}`}>{pill.label}</span>}
        </p>
        <p className="text-[12px] text-ink-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {counting && (
            <span className="tabular-nums">
              {item.quantity} in the box{item.minimum !== undefined ? ` · keep at least ${item.minimum}` : ''}
            </span>
          )}
          {item.expiry && (
            <span className={`tabular-nums ${status.state === 'expired' ? 'text-rosa-700 font-medium' : status.state === 'expiring' ? 'text-honey-800 font-medium' : ''}`}>
              {status.state === 'expired' ? 'Expired' : 'Expires'} {expiryLabel(item.expiry)}
            </span>
          )}
          {item.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.location}</span>}
        </p>
        {item.notes && <p className="text-[12px] text-ink-500">{item.notes}</p>}
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
          {counting && (
            <div className="flex items-center gap-0.5 mr-1">
              <button
                onClick={() => onStep(-1)}
                disabled={(item.quantity ?? 0) <= 0}
                className="p-1.5 text-ink-500 hover:bg-cream-100 rounded-lg disabled:opacity-30"
                aria-label={`One fewer ${item.name}`}
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onStep(1)}
                className="p-1.5 text-ink-500 hover:bg-cream-100 rounded-lg"
                aria-label={`One more ${item.name}`}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button onClick={onEdit} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit" aria-label={`Edit ${item.name}`}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <ConfirmDeleteButton onConfirm={onDelete} ariaLabel={`Remove ${item.name}`} confirmLabel="Remove" />
        </div>
      )}
    </div>
  );
}

/* ─── Add / edit ─────────────────────────────────────────────────────────── */

function ItemForm({ initial, onSave, onCancel }: {
  initial?: Partial<MedicineCabinetItem>;
  onSave: (it: MedicineCabinetItem) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<MedicineCategory | ''>(initial?.category ?? '');
  const [quantity, setQuantity] = useState(initial?.quantity !== undefined ? String(initial.quantity) : (initial ? '' : '1'));
  const [minimum, setMinimum] = useState(initial?.minimum !== undefined ? String(initial.minimum) : (initial ? '' : '1'));
  const [expiry, setExpiry] = useState(expiryToMonthInput(initial?.expiry));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    const q = quantity.trim() === '' ? undefined : coerceCount(quantity);
    const m = minimum.trim() === '' ? undefined : coerceCount(minimum);
    if (quantity.trim() !== '' && q === undefined) { setError('“In the box” must be a whole number, like 2'); return; }
    if (minimum.trim() !== '' && m === undefined) { setError('“Keep at least” must be a whole number, like 1'); return; }
    // The month picker hands over YYYY-MM; normaliseExpiry turns that into the
    // LAST day of the month, because a pack stamped 03/2027 is good to the 31st.
    const exp = expiry ? normaliseExpiry(expiry) : undefined;
    if (expiry && !exp) { setError('That expiry date is not valid'); return; }
    setError(null);
    onSave({
      // Spread first: an edit keeps any field this form does not show.
      ...(initial as MedicineCabinetItem | undefined),
      id: initial?.id || newId(),
      name: trimmed,
      category: category || undefined,
      quantity: q,
      minimum: m,
      expiry: exp,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Name</label>
          <input autoFocus className="field w-full" placeholder="e.g. Plasters" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Group</label>
          <select className="field w-full" value={category} onChange={e => setCategory(e.target.value as MedicineCategory | '')}>
            <option value="">Not sorted yet</option>
            {MEDICINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div>
          <label className="field-label">In the box</label>
          <input inputMode="numeric" className="field w-full" placeholder="e.g. 2" value={quantity} onChange={e => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Keep at least</label>
          <input inputMode="numeric" className="field w-full" placeholder="e.g. 1" value={minimum} onChange={e => setMinimum(e.target.value)} />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="field-label">Soonest expiry</label>
          <input type="month" className="field w-full" value={expiry} onChange={e => setExpiry(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Where it lives</label>
          <input className="field w-full" placeholder="e.g. Hall cupboard, top shelf" value={location} onChange={e => setLocation(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Notes</label>
          <input className="field w-full" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className="text-[11px] text-rosa-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-[11px] px-2.5 py-1"><X className="w-3 h-3" /> Cancel</button>
        <button onClick={save} className="btn-primary text-[11px] px-2.5 py-1"><Check className="w-3 h-3" /> Save</button>
      </div>
    </div>
  );
}
