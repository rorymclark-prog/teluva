import React, { useState, useEffect } from 'react';
import { FinancesInfo, BankAccount, InsurancePolicy, BenefitInfo } from '../types';
import { loadFinances, saveFinances } from '../utils/db';
import {
  Landmark, Plus, Trash2, Pencil, Check, X,
  Cloud, CloudOff
} from 'lucide-react';

const EMPTY: FinancesInfo = { banks: [], insurance: [], benefits: [] };

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

export default function FinancesView() {
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
  }, []);

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <BankAccountsSection
          entries={finances.banks || []}
          onAdd={(e) => persist({ ...finances, banks: [...(finances.banks || []), e] })}
          onUpdate={(e) => persist({ ...finances, banks: (finances.banks || []).map(b => b.id === e.id ? e : b) })}
          onDelete={(id) => persist({ ...finances, banks: (finances.banks || []).filter(b => b.id !== id) })}
        />
        <div className="space-y-6">
          <InsuranceSection
            entries={finances.insurance || []}
            onAdd={(e) => persist({ ...finances, insurance: [...(finances.insurance || []), e] })}
            onUpdate={(e) => persist({ ...finances, insurance: (finances.insurance || []).map(i => i.id === e.id ? e : i) })}
            onDelete={(id) => persist({ ...finances, insurance: (finances.insurance || []).filter(i => i.id !== id) })}
          />
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
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your family{cloudSynced ? ' · synced' : ''}</span></>
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
            <div key={e.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
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
                <button onClick={() => onDelete(e.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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

  const save = () => {
    if (!bankName.trim() && !iban.trim()) { onCancel(); return; }
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
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

/* ---------------- Insurance Policies ---------------- */

function InsuranceSection({ entries, onAdd, onUpdate, onDelete }: {
  entries: InsurancePolicy[];
  onAdd: (e: InsurancePolicy) => void;
  onUpdate: (e: InsurancePolicy) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5">Insurance</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <InsuranceForm
          onSave={(e) => { onAdd(e); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <div className="text-center py-8 px-4 rounded-2xl bg-clay-50">
          <p className="text-[13px] text-clay-600 font-medium">No insurance policies yet</p>
          <p className="text-[12px] text-clay-500 mt-1">home, health, car, travel…</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(e => editId === e.id ? (
            <div key={e.id}>
              <InsuranceForm
                initial={e}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={e.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink-900">{e.provider || 'Unnamed'}</p>
                {e.type && <span className="chip bg-sage-100 text-sage-700 mt-1">{e.type}</span>}
                {e.policyNumber && <p className="font-mono text-[13px] text-ink-700 break-all mt-1 tabular-nums">{e.policyNumber}</p>}
                {e.renewalDate && (
                  <div className="mt-1">
                    <span className="chip bg-honey-100 text-honey-700 tabular-nums">{e.renewalDate}</span>
                  </div>
                )}
                {e.notes && <p className="text-[12px] text-ink-500 mt-1">{e.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(e.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(e.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function InsuranceForm({ initial, onSave, onCancel }: {
  initial?: InsurancePolicy;
  onSave: (e: InsurancePolicy) => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState(initial?.provider || '');
  const [type, setType] = useState(initial?.type || '');
  const [policyNumber, setPolicyNumber] = useState(initial?.policyNumber || '');
  const [renewalDate, setRenewalDate] = useState(initial?.renewalDate || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!provider.trim() && !policyNumber.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      provider: provider.trim() || undefined,
      type: type.trim() || undefined,
      policyNumber: policyNumber.trim() || undefined,
      renewalDate: renewalDate.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="Provider  (e.g. Allianz, Generali)" value={provider} onChange={e => setProvider(e.target.value)} />
      <input className="field" placeholder="Type  (e.g. Home, Health, Car)" value={type} onChange={e => setType(e.target.value)} />
      <input className="field font-mono" placeholder="Policy number" value={policyNumber} onChange={e => setPolicyNumber(e.target.value)} />
      <input type="date" className="field" placeholder="Renewal date (optional)" value={renewalDate} onChange={e => setRenewalDate(e.target.value)} />
      <input className="field" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
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
            <div key={e.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink-900">{e.name || 'Unnamed'}</p>
                {e.reference && <p className="font-mono text-[13px] text-ink-700 break-all mt-1 tabular-nums">{e.reference}</p>}
                {e.notes && <p className="text-[12px] text-ink-500 mt-1">{e.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(e.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(e.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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

  const save = () => {
    if (!name.trim() && !reference.trim()) { onCancel(); return; }
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
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}
