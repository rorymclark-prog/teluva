import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck, Shield, Plus, Pencil, Trash2, X, CalendarClock, Users, Package,
} from 'lucide-react';
import { FamilyMember, FinancesInfo, InsurancePolicy, InsuranceCoverage, AssetItem } from '../types';
import { loadFinances, saveFinances, loadAssets } from '../utils/db';

const EMPTY_FINANCES: FinancesInfo = { banks: [], insurance: [], benefits: [] };

const POLICY_TYPES = [
  'Home contents', 'Building', 'Health', 'Health supplement', 'Car (liability)',
  'Car (comprehensive)', 'Travel', 'Life', 'Liability', 'Valuables', 'Other',
];
const CURRENCIES = ['EUR', 'GBP', 'USD', 'ZAR', 'CHF'];
const PREMIUM_FREQUENCIES = ['Monthly', 'Quarterly', 'Semi-annual', 'Annual'];
const STATUSES: { value: NonNullable<InsurancePolicy['status']>; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'lapsed', label: 'Lapsed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const RENEWAL_WINDOW_DAYS = 42;

function newId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 8);
}

// Parse a date-only 'YYYY-MM-DD' string as LOCAL midnight — new Date(str) parses
// as UTC and can shift the displayed day by one depending on timezone.
function parseDateOnly(value: string): Date | null {
  const parts = value.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(p => parseInt(p, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function todayLocalMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysUntil(dateStr: string): number | null {
  const target = parseDateOnly(dateStr);
  if (!target) return null;
  const diffMs = target.getTime() - todayLocalMidnight().getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// Subtract N days from a 'YYYY-MM-DD' string, returning a 'YYYY-MM-DD' string.
function subtractDays(dateStr: string, days: number): string | null {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function renewalLabel(days: number): string {
  if (days < 0) return `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'renews today';
  return `renews in ${days} day${days === 1 ? '' : 's'}`;
}

const BLANK_POLICY: InsurancePolicy = {
  id: '', provider: '', type: '', policyNumber: '', renewalDate: '', notes: '',
  claimsPhone: '', claimsNotes: '', broker: '', sumInsured: '', currency: 'EUR',
  excess: '', premium: '', premiumFrequency: '', startDate: '', geographicScope: '',
  cancellationNoticeDays: undefined, status: 'active', coverage: [],
  coveredMemberIds: [], coveredAssetIds: [],
};

export default function InsuranceView({ members }: { members: FamilyMember[] }) {
  const [finances, setFinances] = useState<FinancesInfo>(EMPTY_FINANCES);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPolicy, setEditingPolicy] = useState<InsurancePolicy | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      // allSettled: a failure of either load (e.g. offline) must not hang the
      // whole view on its spinner, and one failing shouldn't block the other.
      const [finRes, astRes] = await Promise.allSettled([loadFinances(), loadAssets()]);
      if (!active) return;
      const financesData = finRes.status === 'fulfilled' ? finRes.value : null;
      const assetsData = astRes.status === 'fulfilled' ? astRes.value : [];
      setFinances(financesData
        ? { banks: financesData.banks || [], insurance: financesData.insurance || [], benefits: financesData.benefits || [] }
        : EMPTY_FINANCES);
      setAssets(assetsData || []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const policies = finances.insurance || [];

  // NEVER drop banks/benefits when persisting — only the insurance array changes here.
  const persistPolicies = async (nextPolicies: InsurancePolicy[]) => {
    const next: FinancesInfo = { ...finances, insurance: nextPolicies };
    setFinances(next);
    await saveFinances(next);
  };

  const openNewForm = () => {
    setEditingPolicy({ ...BLANK_POLICY, id: '' });
    setFormError(null);
    setIsFormOpen(true);
  };
  const openEditForm = (policy: InsurancePolicy) => {
    setEditingPolicy({ ...BLANK_POLICY, ...policy });
    setFormError(null);
    setIsFormOpen(true);
  };
  const closeForm = () => { setIsFormOpen(false); setEditingPolicy(null); setFormError(null); };

  const patch = (p: Partial<InsurancePolicy>) => setEditingPolicy(prev => (prev ? { ...prev, ...p } : prev));

  const toggleMember = (memberId: string) => setEditingPolicy(prev => {
    if (!prev) return prev;
    const current = prev.coveredMemberIds || [];
    const next = current.includes(memberId) ? current.filter(id => id !== memberId) : [...current, memberId];
    return { ...prev, coveredMemberIds: next };
  });

  const toggleAsset = (assetId: string) => setEditingPolicy(prev => {
    if (!prev) return prev;
    const current = prev.coveredAssetIds || [];
    const next = current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId];
    return { ...prev, coveredAssetIds: next };
  });

  const addCoverageRow = () => setEditingPolicy(prev => {
    if (!prev) return prev;
    const row: InsuranceCoverage = { id: newId(), name: '', limit: '', notes: '' };
    return { ...prev, coverage: [...(prev.coverage || []), row] };
  });
  const updateCoverageRow = (id: string, p: Partial<InsuranceCoverage>) => setEditingPolicy(prev => {
    if (!prev) return prev;
    return { ...prev, coverage: (prev.coverage || []).map(c => (c.id === id ? { ...c, ...p } : c)) };
  });
  const removeCoverageRow = (id: string) => setEditingPolicy(prev => {
    if (!prev) return prev;
    return { ...prev, coverage: (prev.coverage || []).filter(c => c.id !== id) };
  });

  const handleSave = async () => {
    if (!editingPolicy) return;
    if (!editingPolicy.provider.trim()) { setFormError('Insurer is required'); return; }
    setFormError(null); setSaving(true);
    const isNew = !editingPolicy.id;
    const id = isNew ? newId() : editingPolicy.id;
    const toSave: InsurancePolicy = { ...editingPolicy, id, provider: editingPolicy.provider.trim() };
    const nextPolicies = isNew
      ? [...policies, toSave]
      : policies.map(p => (p.id === id ? toSave : p));
    await persistPolicies(nextPolicies);
    setSaving(false);
    closeForm();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this insurance policy? This cannot be undone.')) return;
    await persistPolicies(policies.filter(p => p.id !== id));
    if (editingPolicy?.id === id) closeForm();
  };

  const sortedPolicies = useMemo(() => {
    return [...policies].sort((a, b) => {
      if (a.renewalDate && b.renewalDate) return a.renewalDate.localeCompare(b.renewalDate);
      if (a.renewalDate) return -1;
      if (b.renewalDate) return 1;
      return (a.provider || '').localeCompare(b.provider || '');
    });
  }, [policies]);

  const renewalsSoon = useMemo(() => {
    return policies
      .filter(p => p.status !== 'cancelled' && p.status !== 'lapsed' && p.renewalDate)
      .map(p => ({ policy: p, days: daysUntil(p.renewalDate!) }))
      .filter((entry): entry is { policy: InsurancePolicy; days: number } => entry.days !== null && entry.days <= RENEWAL_WINDOW_DAYS)
      .sort((a, b) => a.days - b.days);
  }, [policies]);

  if (loading) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  const editing = editingPolicy;

  return (
    <div className="max-w-lg space-y-4">
      {/* Header */}
      <div className="card p-5 sm:p-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-sage-100 text-sage-700 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Insurance</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              {policies.length === 0 ? 'No policies yet' : `${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}`}
            </p>
          </div>
        </div>
        <button onClick={openNewForm} className="btn-primary text-xs px-3 py-2 shrink-0">
          <Plus className="w-3.5 h-3.5" /> Add policy
        </button>
      </div>

      {/* Renewals soon */}
      {renewalsSoon.length > 0 && (
        <div className="card p-4 sm:p-5 space-y-2.5">
          <h3 className="section-label flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" /> Renewals coming up
          </h3>
          <div className="space-y-2">
            {renewalsSoon.map(({ policy, days }) => {
              const cancelBy = policy.cancellationNoticeDays && policy.renewalDate
                ? subtractDays(policy.renewalDate, policy.cancellationNoticeDays)
                : null;
              return (
                <button
                  key={policy.id}
                  onClick={() => openEditForm(policy)}
                  className={`w-full text-left p-3 rounded-2xl border flex items-start justify-between gap-3 transition-colors ${
                    days < 0 ? 'bg-rosa-50 border-rosa-100 hover:bg-rosa-100/70' : 'bg-honey-50 border-honey-100 hover:bg-honey-100/70'
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-[13px] font-semibold ${days < 0 ? 'text-rosa-700' : 'text-honey-900'}`}>
                      {policy.provider}{policy.type ? ` · ${policy.type}` : ''} {renewalLabel(days)}
                    </p>
                    <p className="text-[11.5px] text-ink-500 mt-0.5">
                      {cancelBy
                        ? `Cancel by ${cancelBy} to avoid auto-renewal`
                        : 'Austrian notice is usually 1–3 months — check your policy.'}
                    </p>
                  </div>
                  <span className="chip bg-white/70 text-ink-600 shrink-0 tabular-nums">{policy.renewalDate}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Policy list */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:p-5">
          {sortedPolicies.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
                <Shield className="w-8 h-8" />
              </div>
              <p className="text-[14px] font-medium text-ink-700">No insurance policies yet</p>
              <p className="text-[12px] text-ink-500 mt-1">Home, health, car, travel, life…</p>
              <button onClick={openNewForm} className="btn-primary mt-5 text-xs px-4 py-2"><Plus className="w-3.5 h-3.5" /> Add policy</button>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedPolicies.map(policy => {
                const memberCount = (policy.coveredMemberIds || []).length;
                const assetCount = (policy.coveredAssetIds || []).length;
                const days = policy.renewalDate ? daysUntil(policy.renewalDate) : null;
                return (
                  <button
                    key={policy.id}
                    onClick={() => openEditForm(policy)}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-cream-100 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-ink-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-800 text-[14px] leading-tight truncate flex items-center gap-1.5">
                        {policy.provider || 'Unnamed'}
                        {policy.type && <span className="text-ink-400 font-normal">· {policy.type}</span>}
                        {policy.status && policy.status !== 'active' && (
                          <span className="chip bg-ink-100 text-ink-500 text-[10px] px-1.5 py-0">{policy.status}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        {policy.policyNumber && <p className="text-[11px] text-ink-500 font-mono truncate">{policy.policyNumber}</p>}
                        {(memberCount > 0 || assetCount > 0) && (
                          <span className="text-[11px] text-ink-400 flex items-center gap-2">
                            {memberCount > 0 && <span className="flex items-center gap-0.5"><Users className="w-3 h-3" />{memberCount}</span>}
                            {assetCount > 0 && <span className="flex items-center gap-0.5"><Package className="w-3 h-3" />{assetCount}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {policy.renewalDate && (
                        <span className={`chip tabular-nums ${days !== null && days <= RENEWAL_WINDOW_DAYS ? (days < 0 ? 'bg-rosa-100 text-rosa-700' : 'bg-honey-100 text-honey-700') : 'bg-sage-100 text-sage-700'}`}>
                          {policy.renewalDate}
                        </span>
                      )}
                      {policy.sumInsured && (
                        <span className="text-[12px] text-ink-500 tabular-nums hidden sm:inline">
                          {policy.currency || 'EUR'} {policy.sumInsured}
                        </span>
                      )}
                      <Pencil className="w-3.5 h-3.5 text-ink-300 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit modal */}
      {isFormOpen && editing && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-cream-400 sm:hidden" />
            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">{editing.id ? 'Edit policy' : 'New policy'}</h3>
              <button onClick={closeForm} className="btn-quiet p-2"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-6 space-y-5">
              {/* Insurer + type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Insurer <span className="text-rosa-600">*</span></label>
                  <input type="text" placeholder="e.g. Allianz" value={editing.provider} onChange={e => patch({ provider: e.target.value })} className="field w-full" />
                  {formError && <p className="text-[11px] text-rosa-600 mt-1">{formError}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Type</label>
                  <select value={editing.type || ''} onChange={e => patch({ type: e.target.value })} className="field w-full">
                    <option value="">—</option>
                    {POLICY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Policy number + status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Policy number</label>
                  <input type="text" placeholder="e.g. 123.456.789" value={editing.policyNumber || ''} onChange={e => patch({ policyNumber: e.target.value })} className="field w-full font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Status</label>
                  <select value={editing.status || 'active'} onChange={e => patch({ status: e.target.value as InsurancePolicy['status'] })} className="field w-full">
                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Sum insured + currency + excess */}
              <div className="grid grid-cols-[1fr_5rem_1fr] gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Sum insured</label>
                  <input type="text" inputMode="decimal" placeholder="e.g. 50000" value={editing.sumInsured || ''} onChange={e => patch({ sumInsured: e.target.value })} className="field w-full tabular-nums" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Cur.</label>
                  <select value={editing.currency || 'EUR'} onChange={e => patch({ currency: e.target.value })} className="field w-full">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Excess</label>
                  <input type="text" inputMode="decimal" placeholder="e.g. 150" value={editing.excess || ''} onChange={e => patch({ excess: e.target.value })} className="field w-full tabular-nums" />
                </div>
              </div>

              {/* Premium + frequency */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Premium</label>
                  <input type="text" inputMode="decimal" placeholder="e.g. 42.50" value={editing.premium || ''} onChange={e => patch({ premium: e.target.value })} className="field w-full tabular-nums" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Frequency</label>
                  <select value={editing.premiumFrequency || ''} onChange={e => patch({ premiumFrequency: e.target.value })} className="field w-full">
                    <option value="">—</option>
                    {PREMIUM_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              {/* Start date + renewal date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Start date</label>
                  <input type="date" value={editing.startDate || ''} onChange={e => patch({ startDate: e.target.value })} className="field w-full" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Renewal date</label>
                  <input type="date" value={editing.renewalDate || ''} onChange={e => patch({ renewalDate: e.target.value })} className="field w-full" />
                </div>
              </div>

              {/* Cancellation notice + geographic scope */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Cancellation notice (days)</label>
                  <input
                    type="number"
                    min={0}
                    placeholder="e.g. 90"
                    value={editing.cancellationNoticeDays ?? ''}
                    onChange={e => patch({ cancellationNoticeDays: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="field w-full tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Geographic scope</label>
                  <input type="text" placeholder="e.g. Worldwide" value={editing.geographicScope || ''} onChange={e => patch({ geographicScope: e.target.value })} className="field w-full" />
                </div>
              </div>

              {/* Claims phone + notes */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Claims phone</label>
                <input type="text" placeholder="24h claims line" value={editing.claimsPhone || ''} onChange={e => patch({ claimsPhone: e.target.value })} className="field w-full" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Claims notes</label>
                <textarea rows={2} placeholder="How to claim / portal URL…" value={editing.claimsNotes || ''} onChange={e => patch({ claimsNotes: e.target.value })} className="field w-full resize-none" />
              </div>

              {/* Broker + notes */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Broker</label>
                <input type="text" placeholder="e.g. Independent broker name" value={editing.broker || ''} onChange={e => patch({ broker: e.target.value })} className="field w-full" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5">Notes</label>
                <textarea rows={3} placeholder="Anything else worth recording…" value={editing.notes || ''} onChange={e => patch({ notes: e.target.value })} className="field w-full resize-none" />
              </div>

              {/* Covered people */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Covered people
                </label>
                {members.length === 0 ? (
                  <p className="text-[12px] text-ink-400">No family members yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {members.map(m => {
                      const active = (editing.coveredMemberIds || []).includes(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleMember(m.id)}
                          className={`chip cursor-pointer transition-colors ${active ? 'bg-sage-500 text-white' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}
                        >
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Covered items */}
              <div>
                <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Covered items
                </label>
                {assets.length === 0 ? (
                  <p className="text-[12px] text-ink-400">No assets yet — add them in Assets.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {assets.map(a => {
                      const active = (editing.coveredAssetIds || []).includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => toggleAsset(a.id)}
                          className={`chip cursor-pointer transition-colors ${active ? 'bg-clay-500 text-white' : 'bg-cream-100 text-ink-500 hover:bg-cream-200'}`}
                        >
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Coverage breakdown */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider">Coverage breakdown</label>
                  <button type="button" onClick={addCoverageRow} className="btn-quiet text-[11px] px-2.5 py-1.5"><Plus className="w-3 h-3" /> Add peril</button>
                </div>
                {(editing.coverage || []).length === 0 ? (
                  <p className="text-[12px] text-ink-400">e.g. Fire, Water, Theft, Away-from-home…</p>
                ) : (
                  <div className="space-y-2">
                    {(editing.coverage || []).map(row => (
                      <div key={row.id} className="flex items-start gap-2">
                        <input
                          type="text"
                          placeholder="Peril (e.g. Fire)"
                          value={row.name}
                          onChange={e => updateCoverageRow(row.id, { name: e.target.value })}
                          className="field flex-1"
                        />
                        <input
                          type="text"
                          placeholder="Limit"
                          value={row.limit || ''}
                          onChange={e => updateCoverageRow(row.id, { limit: e.target.value })}
                          className="field w-24 tabular-nums"
                        />
                        <input
                          type="text"
                          placeholder="Notes"
                          value={row.notes || ''}
                          onChange={e => updateCoverageRow(row.id, { notes: e.target.value })}
                          className="field flex-1"
                        />
                        <button type="button" onClick={() => removeCoverageRow(row.id)} className="p-2.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 p-6 pt-0">
              <div>
                {editing.id && (
                  <button onClick={() => handleDelete(editing.id)} className="btn-quiet text-rosa-600 hover:text-rosa-700 text-xs px-3 py-2"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={closeForm} className="btn-quiet text-xs px-4 py-2">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
