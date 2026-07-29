import React, { useState, useEffect } from 'react';
import { FinancesInfo, BankAccount, BenefitInfo } from '../types';
import { loadFinances, saveFinances } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import {
  Landmark, Plus, Pencil, Check, X,
  Cloud, CloudOff
} from 'lucide-react';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import PrivacyNote from './PrivacyNote';

const EMPTY: FinancesInfo = { banks: [], insurance: [], benefits: [] };

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

interface FinancesViewProps {
  isBusinessSpace?: boolean;
  refreshKey?: number;
  onOpenPrivacy?: () => void;
}

export default function FinancesView({ isBusinessSpace, refreshKey, onOpenPrivacy }: FinancesViewProps) {
  const [finances, setFinances] = useState<FinancesInfo>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadFinances();
      if (active) {
        setFinances(data && (data.banks || data.insurance || data.benefits) ? { banks: data.banks || [], insurance: data.insurance || [], benefits: data.benefits || [] } : EMPTY);
        setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  // Live updates from other family members (and from InsuranceView, which
  // writes the `insurance` array of this same shared document). Applied
  // silently — the bank/benefit forms are child components with their own
  // draft state, so a list refresh never disturbs a typed form.
  useSharedDoc<FinancesInfo>('finances', (f) =>
    setFinances({ banks: f.banks || [], insurance: f.insurance || [], benefits: f.benefits || [] }));

  const persist = async (next: FinancesInfo) => {
    setFinances(next);
    const ok = await saveFinances(next);
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
          <div className="p-2.5 rounded-2xl bg-sage-100 text-sage-700 shrink-0">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Finances</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              Reference details — account numbers and policies, never passwords.
            </p>
          </div>
        </div>
      </div>

      <PrivacyNote onOpenPrivacy={onOpenPrivacy}>
        Only signed-in members of your family can see this — it's stored securely and isolated to your family space.
      </PrivacyNote>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <BankAccountsSection
          entries={finances.banks || []}
          onAdd={(e) => persist({ ...finances, banks: [...(finances.banks || []), e] })}
          onUpdate={(e) => persist({ ...finances, banks: (finances.banks || []).map(b => b.id === e.id ? e : b) })}
          onDelete={(id) => persist({ ...finances, banks: (finances.banks || []).filter(b => b.id !== id) })}
        />
        <div className="space-y-6">
          {/* Insurance moved to its own dedicated Insurance view (richer policy records). */}
          <BenefitsSection
            entries={finances.benefits || []}
            onAdd={(e) => persist({ ...finances, benefits: [...(finances.benefits || []), e] })}
            onUpdate={(e) => persist({ ...finances, benefits: (finances.benefits || []).map(b => b.id === e.id ? e : b) })}
            onDelete={(id) => persist({ ...finances, benefits: (finances.benefits || []).filter(b => b.id !== id) })}
          />
        </div>
      </div>

      <div className="text-center">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {cloudSynced === false ? (
            <><CloudOff className="w-3.5 h-3.5 text-honey-700" /><span>Saved on this device — cloud sync unavailable</span></>
          ) : (
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your {isBusinessSpace ? 'team' : 'family'}{cloudSynced ? ' · synced' : ''}</span></>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Bank Accounts ---------------- */

function BankAccountsSection({ entries, onAdd, onUpdate, onDelete }: {
  entries: BankAccount[];
  onAdd: (e: BankAccount) => void;
  onUpdate: (e: BankAccount) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5">Bank accounts</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <BankAccountForm
          onSave={(e) => { onAdd(e); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <div className="text-center py-8 px-4 rounded-2xl bg-clay-50">
          <p className="text-[13px] text-clay-600 font-medium">No bank accounts yet</p>
          <p className="text-[12px] text-clay-500 mt-1">IBAN, BIC, account details…</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(e => editId === e.id ? (
            <div key={e.id}>
              <BankAccountForm
                initial={e}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={e.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink-900">{e.bankName || 'Unnamed'}</p>
                {e.accountHolder && <p className="text-[12px] text-ink-500 mt-0.5">{e.accountHolder}</p>}
                {e.iban && <p className="font-mono text-[13px] text-ink-700 break-all mt-1 tabular-nums">{e.iban}</p>}
                {e.bic && <p className="font-mono text-[12px] text-ink-600 mt-0.5 tabular-nums">{e.bic}</p>}
                {e.notes && <p className="text-[12px] text-ink-500 mt-1">{e.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(e.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <ConfirmDeleteButton
                  onConfirm={() => onDelete(e.id)}
                  ariaLabel={`Delete ${e.bankName || 'this bank account'}`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BankAccountForm({ initial, onSave, onCancel }: {
  initial?: BankAccount;
  onSave: (e: BankAccount) => void;
  onCancel: () => void;
}) {
  const [bankName, setBankName] = useState(initial?.bankName || '');
  const [accountHolder, setAccountHolder] = useState(initial?.accountHolder || '');
  const [iban, setIban] = useState(initial?.iban || '');
  const [bic, setBic] = useState(initial?.bic || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const [formError, setFormError] = useState<string | null>(null);
  const save = () => {
    if (!bankName.trim() && !iban.trim()) { setFormError('Add a bank name or an IBAN'); return; }
    setFormError(null);
    onSave({
      id: initial?.id || newId(),
      bankName: bankName.trim() || undefined,
      accountHolder: accountHolder.trim() || undefined,
      iban: iban.trim() || undefined,
      bic: bic.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="Bank name  (e.g. Erste Bank)" value={bankName} onChange={e => setBankName(e.target.value)} />
      <input className="field" placeholder="Account holder" value={accountHolder} onChange={e => setAccountHolder(e.target.value)} />
      <input className="field font-mono" placeholder="IBAN" value={iban} onChange={e => setIban(e.target.value)} />
      <input className="field font-mono" placeholder="BIC (optional)" value={bic} onChange={e => setBic(e.target.value)} />
      <input className="field" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

/* ---------------- Benefits ---------------- */

function BenefitsSection({ entries, onAdd, onUpdate, onDelete }: {
  entries: BenefitInfo[];
  onAdd: (e: BenefitInfo) => void;
  onUpdate: (e: BenefitInfo) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5">Benefits</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <BenefitForm
          onSave={(e) => { onAdd(e); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <div className="text-center py-8 px-4 rounded-2xl bg-clay-50">
          <p className="text-[13px] text-clay-600 font-medium">No benefits yet</p>
          <p className="text-[12px] text-clay-500 mt-1">Familienbeihilfe, child benefit, subsidies…</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(e => editId === e.id ? (
            <div key={e.id}>
              <BenefitForm
                initial={e}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={e.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink-900">{e.name || 'Unnamed'}</p>
                {e.reference && <p className="font-mono text-[13px] text-ink-700 break-all mt-1 tabular-nums">{e.reference}</p>}
                {e.notes && <p className="text-[12px] text-ink-500 mt-1">{e.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(e.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <ConfirmDeleteButton
                  onConfirm={() => onDelete(e.id)}
                  ariaLabel={`Delete ${e.name || 'this benefit'}`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BenefitForm({ initial, onSave, onCancel }: {
  initial?: BenefitInfo;
  onSave: (e: BenefitInfo) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [reference, setReference] = useState(initial?.reference || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const [formError, setFormError] = useState<string | null>(null);
  const save = () => {
    if (!name.trim() && !reference.trim()) { setFormError('Add a name or a reference'); return; }
    setFormError(null);
    onSave({
      id: initial?.id || newId(),
      name: name.trim() || undefined,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="Benefit name  (e.g. Familienbeihilfe)" value={name} onChange={e => setName(e.target.value)} />
      <input className="field font-mono" placeholder="Reference number (optional)" value={reference} onChange={e => setReference(e.target.value)} />
      <input className="field" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}
