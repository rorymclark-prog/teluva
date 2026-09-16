import React, { useRef, useState } from 'react';
import { Home, MapPin, Pencil, Plus } from 'lucide-react';
import type { FamilyMember, PreviousAddress } from '../types';
import ConfirmDeleteButton from './ConfirmDeleteButton';

export default function MemberAddresses({ member, canEdit, onUpdate }: {
  key?: string; member: FamilyMember; canEdit: boolean; onUpdate: (patch: Partial<FamilyMember>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PreviousAddress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(member); latest.current = member;
  const addresses = [...(member.addressHistory || [])].sort((a, b) => (b.endDate || b.startDate || '').localeCompare(a.endDate || a.startDate || ''));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !canEdit || busy) return;
    if (!draft.address.trim()) { setError('Please enter an address.'); return; }
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) { setError('Move-out date must be on or after move-in date.'); return; }
    setBusy(true); setError('');
    try {
      const record = { ...draft, address: draft.address.trim(), label: draft.label?.trim() || '', notes: draft.notes?.trim() || '' };
      const existing = latest.current.addressHistory || [];
      await onUpdate({ addressHistory: existing.some(a => a.id === record.id) ? existing.map(a => a.id === record.id ? record : a) : [...existing, record] });
      setDraft(null);
    } catch { setError('Could not save this address. Please try again.'); }
    finally { setBusy(false); }
  };
  const date = (value?: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unknown';
  return <div className="space-y-5">
    <div className="rounded-2xl border border-clay-100 bg-clay-50 p-5">
      <h3 className="text-lg font-semibold text-ink-900 flex items-center gap-2"><MapPin className="w-5 h-5 text-clay-600" /> Addresses</h3>
      <p className="text-sm text-ink-600 mt-2">The places {member.name.split(' ')[0]} has called home, kept with the dates and details you remember.</p>
      {member.address && <div className="mt-4"><p className="field-label">Current address</p><p className="text-sm text-ink-800 whitespace-pre-wrap">{member.address}</p></div>}
      <p className="text-xs text-ink-500 mt-3">Current address is managed in Edit profile. Previous addresses stay here as a separate history.</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="section-label">Previous addresses · {addresses.length}</h4>
      {canEdit && !draft && <button className="btn-primary text-sm" onClick={() => { setError(''); setDraft({ id: crypto.randomUUID(), address: '' }); }}><Plus className="w-4 h-4" /> Add previous address</button>}
    </div>
    {draft && canEdit && <form onSubmit={save} className="card p-5 space-y-4">
      <h4 className="font-semibold text-ink-900">{addresses.some(a => a.id === draft.id) ? 'Edit previous address' : 'Add previous address'}</h4>
      <fieldset disabled={busy} className="space-y-3 min-w-0">
        <label className="block"><span className="field-label">Name (optional)</span><input className="field" placeholder="Our first flat, childhood home…" maxLength={200} value={draft.label || ''} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
        <label className="block"><span className="field-label">Address *</span><textarea className="field" rows={3} required maxLength={2000} value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label><span className="field-label">Moved in (optional)</span><input type="date" className="field" value={draft.startDate || ''} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
          <label><span className="field-label">Moved out (optional)</span><input type="date" className="field" value={draft.endDate || ''} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></label>
        </div>
        <p className="text-xs text-ink-500">Leave dates blank if you don’t know them. The timeline will keep the address under Undated.</p>
        <label className="block"><span className="field-label">Notes</span><textarea className="field" rows={3} maxLength={10000} value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
        {error && <p className="text-sm text-rosa-700" role="alert">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-quiet text-sm" onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="btn-primary text-sm">{busy ? 'Saving…' : 'Save address'}</button></div>
      </fieldset>
    </form>}
    {!addresses.length && !draft && <div className="card p-6 text-center"><Home className="w-7 h-7 text-clay-500 mx-auto mb-3" /><p className="font-medium text-ink-800">Keep the places in your story</p><p className="text-sm text-ink-500 mt-2">Save former homes for future forms, family memories and your timeline.</p></div>}
    {addresses.map(a => <article className="card p-5" key={a.id}>
      <div className="flex justify-between items-start gap-3"><div className="min-w-0"><h4 className="font-semibold text-ink-900 break-words">{a.label || 'Previous home'}</h4><p className="text-sm whitespace-pre-wrap break-words text-ink-700 mt-2">{a.address}</p></div>
        {canEdit && !draft && <div className="flex shrink-0"><button className="btn-quiet p-2" aria-label={`Edit ${a.label || a.address}`} onClick={() => { setError(''); setDraft(a); }}><Pencil className="w-4 h-4" /></button>
          <ConfirmDeleteButton ariaLabel={`Delete ${a.label || a.address}`} onConfirm={async () => { await onUpdate({ addressHistory: (latest.current.addressHistory || []).filter(x => x.id !== a.id) }); }} />
        </div>}
      </div>
      <p className="text-xs text-ink-500 mt-3">{date(a.startDate)} — {date(a.endDate)}</p>
      {a.notes && <p className="text-sm text-ink-600 whitespace-pre-wrap break-words mt-3">{a.notes}</p>}
    </article>)}
  </div>;
}
