import React, { useState, useEffect } from 'react';
import { FamilyMember, PassportRecord, IdentityRecord } from '../types';
import {
  Plus, Pencil, Trash2, Check, X, Globe, ShieldCheck, Car, MapPin, BookOpen,
} from 'lucide-react';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

/* ─── expiry chip helper ─────────────────────────────────────────── */

function expiryChip(dateStr: string | undefined): React.ReactNode {
  if (!dateStr) return null;
  const today = new Date();
  const expiry = new Date(dateStr);
  const diffMs = expiry.getTime() - today.getTime();
  if (diffMs < 0) {
    return <span className="chip bg-rosa-100 text-rosa-700">Expired</span>;
  }
  const months = diffMs / (1000 * 60 * 60 * 24 * 30.4375);
  if (months <= 9) {
    const rounded = Math.max(1, Math.round(months));
    return <span className="chip bg-honey-100 text-honey-700">Expires in ~{rounded} month{rounded !== 1 ? 's' : ''}</span>;
  }
  return <span className="chip bg-sage-100 text-sage-700">Valid</span>;
}

/* ─── Props ──────────────────────────────────────────────────────── */

interface MemberIDsProps {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
}

/* ─── Passport form ──────────────────────────────────────────────── */

interface PassportFormState {
  country: string;
  number: string;
  expiryDate: string;
  issueDate: string;
  notes: string;
}

const emptyPassportForm = (): PassportFormState => ({
  country: '',
  number: '',
  expiryDate: '',
  issueDate: '',
  notes: '',
});

const passportToForm = (p: PassportRecord): PassportFormState => ({
  country: p.country,
  number: p.number,
  expiryDate: p.expiryDate || '',
  issueDate: p.issueDate || '',
  notes: p.notes || '',
});

function PassportForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: PassportRecord;
  onSave: (p: PassportRecord) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PassportFormState>(
    initial ? passportToForm(initial) : emptyPassportForm()
  );

  const set = (k: keyof PassportFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const save = () => {
    if (!form.country.trim() && !form.number.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      country: form.country.trim(),
      number: form.number.trim(),
      expiryDate: form.expiryDate || undefined,
      issueDate: form.issueDate || undefined,
      notes: form.notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          autoFocus
          className="field"
          placeholder="Country  (e.g. Austria, South Africa)"
          value={form.country}
          onChange={set('country')}
        />
        <input
          className="field font-mono"
          placeholder="Passport number"
          value={form.number}
          onChange={set('number')}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Issue date</label>
          <input type="date" className="field" value={form.issueDate} onChange={set('issueDate')} />
        </div>
        <div>
          <label className="field-label">Expiry date</label>
          <input type="date" className="field" value={form.expiryDate} onChange={set('expiryDate')} />
        </div>
      </div>
      <input className="field" placeholder="Notes (optional)" value={form.notes} onChange={set('notes')} />
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

/* ─── Passports section ──────────────────────────────────────────── */

function PassportsSection({
  passports,
  onChange,
}: {
  passports: PassportRecord[];
  onChange: (next: PassportRecord[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const handleAdd = (p: PassportRecord) => {
    onChange([...passports, p]);
    setAdding(false);
  };

  const handleUpdate = (p: PassportRecord) => {
    onChange(passports.map(x => x.id === p.id ? p : x));
    setEditId(null);
  };

  const handleDelete = (id: string) => {
    onChange(passports.filter(x => x.id !== id));
  };

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" /> Passports
        </h3>
        <button
          onClick={() => { setAdding(true); setEditId(null); }}
          className="btn-primary text-xs px-3 py-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <PassportForm
          onSave={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}

      {passports.length === 0 && !adding ? (
        <p className="text-[13px] text-ink-400 py-6 text-center">
          No passports yet — add one for each nationality.
        </p>
      ) : (
        <div className="space-y-2.5">
          {passports.map(p => editId === p.id ? (
            <div key={p.id}>
              <PassportForm
                initial={p}
                onSave={handleUpdate}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={p.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14px] font-semibold text-ink-900">{p.country || 'Unknown country'}</p>
                  {expiryChip(p.expiryDate)}
                </div>
                <p className="font-mono text-[13px] text-ink-600 break-all">{p.number || '—'}</p>
                {(p.issueDate || p.expiryDate) && (
                  <p className="text-[12px] text-ink-400">
                    {p.issueDate ? `Issued ${p.issueDate}` : ''}
                    {p.issueDate && p.expiryDate ? ' · ' : ''}
                    {p.expiryDate ? `Expires ${p.expiryDate}` : ''}
                  </p>
                )}
                {p.notes && <p className="text-[12px] text-ink-500">{p.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setEditId(p.id); setAdding(false); }}
                  className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg"
                  title="Delete"
                >
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

/* ─── Identity section ───────────────────────────────────────────── */

function IdentitySection({
  identity,
  onChange,
}: {
  identity: IdentityRecord;
  onChange: (next: IdentityRecord) => void;
}) {
  const set = (k: keyof IdentityRecord) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => onChange({ ...identity, [k]: e.target.value || undefined });

  const val = (k: keyof IdentityRecord) => identity[k] as string | undefined ?? '';

  return (
    <section className="card p-5 space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-2 pb-3 border-b border-cream-200">
        <ShieldCheck className="w-4 h-4 text-dusk-500" />
        <h3 className="section-label">Austrian &amp; national IDs</h3>
      </div>

      {/* Austria */}
      <div className="space-y-3">
        <p className="section-label flex items-center gap-1.5 text-clay-600">
          <MapPin className="w-3 h-3" /> Austria
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">e-Card number</label>
            <input
              className="field font-mono"
              placeholder="e.g. 1234 010090 AT"
              value={val('eCardNumber')}
              onChange={set('eCardNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">Sozialversicherungsnummer (SV)</label>
            <input
              className="field font-mono"
              placeholder="e.g. 1234 010190"
              value={val('svNumber')}
              onChange={set('svNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">Tax number</label>
            <input
              className="field font-mono"
              placeholder="Steuernummer"
              value={val('taxNumber')}
              onChange={set('taxNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">Student number</label>
            <input
              className="field font-mono"
              placeholder="Matrikelnummer"
              value={val('studentNumber')}
              onChange={set('studentNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">School registration number</label>
            <input
              className="field font-mono"
              placeholder="Schülerausweis-Nr"
              value={val('schoolRegNumber')}
              onChange={set('schoolRegNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
        </div>
      </div>

      {/* Residence & national */}
      <div className="space-y-3">
        <p className="section-label flex items-center gap-1.5 text-dusk-700">
          <BookOpen className="w-3 h-3" /> Residence &amp; national
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Residence permit number</label>
            <input
              className="field font-mono"
              placeholder="Aufenthaltstitel-Nr"
              value={val('residencePermitNumber')}
              onChange={set('residencePermitNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">
              Residence permit expiry
              {identity.residencePermitExpiry && (
                <span className="ml-2">{expiryChip(identity.residencePermitExpiry)}</span>
              )}
            </label>
            <input
              type="date"
              className="field"
              value={val('residencePermitExpiry')}
              onChange={set('residencePermitExpiry')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">National ID number</label>
            <input
              className="field font-mono"
              placeholder="e.g. SA ID number"
              value={val('nationalIdNumber')}
              onChange={set('nationalIdNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">Citizenship certificate number</label>
            <input
              className="field font-mono"
              placeholder="Staatsbürgerschaftsnachweis"
              value={val('citizenshipCertNumber')}
              onChange={set('citizenshipCertNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
        </div>
      </div>

      {/* Driving */}
      <div className="space-y-3">
        <p className="section-label flex items-center gap-1.5 text-sage-700">
          <Car className="w-3 h-3" /> Driving
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="field-label">Driver's licence number</label>
            <input
              className="field font-mono"
              placeholder="Führerschein-Nr"
              value={val('driversLicenseNumber')}
              onChange={set('driversLicenseNumber')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
          <div>
            <label className="field-label">
              Driver's licence expiry
              {identity.driversLicenseExpiry && (
                <span className="ml-2">{expiryChip(identity.driversLicenseExpiry)}</span>
              )}
            </label>
            <input
              type="date"
              className="field"
              value={val('driversLicenseExpiry')}
              onChange={set('driversLicenseExpiry')}
              onBlur={() => onChange({ ...identity })}
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="field-label">Notes</label>
        <textarea
          rows={3}
          className="field font-sans"
          placeholder="Any other ID notes…"
          value={val('notes')}
          onChange={set('notes')}
          onBlur={() => onChange({ ...identity })}
        />
      </div>
    </section>
  );
}

/* ─── Main export ────────────────────────────────────────────────── */

// Fold a legacy single passport (member.passport, from the old separate Passport
// tab) into the plural passports[] list so nothing is lost now the tabs are merged.
// Deduped by passport number, so it never shows twice.
function foldPassports(member: FamilyMember): PassportRecord[] {
  const list = [...(member.passports ?? [])];
  const lg = member.passport;
  if (lg?.passportNumber && !list.some(p => p.number === lg.passportNumber)) {
    list.push({
      id: 'legacy-' + lg.passportNumber,
      country: lg.issuingCountry || '',
      number: lg.passportNumber,
      expiryDate: lg.expiryDate || undefined,
      issueDate: lg.issueDate || undefined,
      notes: [lg.fullName ? `Name: ${lg.fullName}` : '', lg.notes || ''].filter(Boolean).join(' · ') || undefined,
    });
  }
  return list;
}

export default function MemberIDs({ member, onUpdate }: MemberIDsProps) {
  const [passports, setPassports] = useState<PassportRecord[]>(() => foldPassports(member));
  const [identity, setIdentity] = useState<IdentityRecord>(member.identity ?? {});

  // Reset when switching members
  useEffect(() => {
    setPassports(foldPassports(member));
    setIdentity(member.identity ?? {});
  }, [member.id]);

  const handlePassportsChange = (next: PassportRecord[]) => {
    setPassports(next);
    onUpdate({ passports: next });
  };

  const handleIdentityChange = (next: IdentityRecord) => {
    setIdentity(next);
    onUpdate({ identity: next });
  };

  return (
    <div className="space-y-6 font-sans">
      <PassportsSection
        passports={passports}
        onChange={handlePassportsChange}
      />
      <IdentitySection
        identity={identity}
        onChange={handleIdentityChange}
      />
    </div>
  );
}
