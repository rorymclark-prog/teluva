import React, { useState, useEffect } from 'react';
import { FamilyInfo, InfoEntry, ContactEntry } from '../types';
import { loadFamilyInfo, saveFamilyInfo } from '../utils/db';
import {
  Hash, Phone, Mail, Plus, Trash2, Pencil, Check, X,
  IdCard, Users, Search, Cloud, CloudOff
} from 'lucide-react';

const EMPTY: FamilyInfo = { numbers: [], contacts: [] };

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

interface ImportantInfoProps {
  isBusinessSpace?: boolean;
  refreshKey?: number;
}

export default function ImportantInfo({ isBusinessSpace, refreshKey }: ImportantInfoProps) {
  const [info, setInfo] = useState<FamilyInfo>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadFamilyInfo();
      if (active) {
        setInfo(data && (data.numbers || data.contacts) ? { numbers: data.numbers || [], contacts: data.contacts || [] } : EMPTY);
        setLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  const persist = async (next: FamilyInfo) => {
    setInfo(next);
    const ok = await saveFamilyInfo(next);
    setCloudSynced(ok);
  };

  const q = search.trim().toLowerCase();
  const numbers = q
    ? info.numbers.filter(n => `${n.label} ${n.value} ${n.note || ''}`.toLowerCase().includes(q))
    : info.numbers;
  const contacts = q
    ? info.contacts.filter(c => `${c.name} ${c.relation || ''} ${c.phone || ''} ${c.email || ''} ${c.note || ''}`.toLowerCase().includes(q))
    : info.contacts;

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
              <IdCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink-900">{isBusinessSpace ? 'Compliance' : 'Important info'}</h2>
              <p className="text-[13px] text-ink-500 font-medium">
                {isBusinessSpace
                  ? 'Registration numbers, licenses, permits, and key business contacts — everything in one shared place.'
                  : 'Numbers, school & teacher contacts, friends — everything in one shared place.'}
              </p>
            </div>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search info…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="field pl-10"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <NumbersSection
          entries={numbers}
          onAdd={(e) => persist({ ...info, numbers: [...info.numbers, e] })}
          onUpdate={(e) => persist({ ...info, numbers: info.numbers.map(n => n.id === e.id ? e : n) })}
          onDelete={(id) => persist({ ...info, numbers: info.numbers.filter(n => n.id !== id) })}
          isBusinessSpace={isBusinessSpace}
        />
        <ContactsSection
          entries={contacts}
          onAdd={(c) => persist({ ...info, contacts: [...info.contacts, c] })}
          onUpdate={(c) => persist({ ...info, contacts: info.contacts.map(x => x.id === c.id ? c : x) })}
          onDelete={(id) => persist({ ...info, contacts: info.contacts.filter(c => c.id !== id) })}
          isBusinessSpace={isBusinessSpace}
        />
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

/* ---------------- Numbers ---------------- */

function NumbersSection({ entries, onAdd, onUpdate, onDelete, isBusinessSpace }: {
  entries: InfoEntry[];
  onAdd: (e: InfoEntry) => void;
  onUpdate: (e: InfoEntry) => void;
  onDelete: (id: string) => void;
  isBusinessSpace?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" /> Key numbers</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <NumberForm
          onSave={(e) => { onAdd(e); setAdding(false); }}
          onCancel={() => setAdding(false)}
          isBusinessSpace={isBusinessSpace}
        />
      )}

      {entries.length === 0 && !adding ? (
        <div className="text-center py-6">
          <div className="w-10 h-10 rounded-2xl bg-sage-50 text-sage-600 flex items-center justify-center mx-auto mb-2">
            <Hash className="w-5 h-5" />
          </div>
          <p className="text-[13px] text-ink-400">
            {isBusinessSpace
              ? 'No numbers yet — CIPC registration, SARS tax ref, UIF, COIDA, policy numbers…'
              : 'No numbers yet — passports, social security, insurance, policy numbers…'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(e => editId === e.id ? (
            <div key={e.id}>
              <NumberForm
                initial={e}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
                isBusinessSpace={isBusinessSpace}
              />
            </div>
          ) : (
            <div key={e.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{e.label || 'Untitled'}</p>
                <p className="font-mono tabular-nums text-[15px] text-ink-900 break-all">{e.value || '—'}</p>
                {e.note && <p className="text-[12px] text-ink-500 mt-0.5">{e.note}</p>}
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

function NumberForm({ initial, onSave, onCancel, isBusinessSpace }: {
  initial?: InfoEntry;
  onSave: (e: InfoEntry) => void;
  onCancel: () => void;
  isBusinessSpace?: boolean;
}) {
  const [label, setLabel] = useState(initial?.label || '');
  const [value, setValue] = useState(initial?.value || '');
  const [note, setNote] = useState(initial?.note || '');

  const save = () => {
    if (!label.trim() && !value.trim()) { onCancel(); return; }
    onSave({ id: initial?.id || newId(), label: label.trim(), value: value.trim(), note: note.trim() || undefined });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input
        autoFocus
        className="field"
        placeholder={isBusinessSpace ? 'Label  (e.g. CIPC registration, SARS tax ref)' : 'Label  (e.g. Mia – Social security)'}
        value={label}
        onChange={e => setLabel(e.target.value)}
      />
      <input className="field font-mono" placeholder="Number / value" value={value} onChange={e => setValue(e.target.value)} />
      <input className="field" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

/* ---------------- Contacts ---------------- */

function ContactsSection({ entries, onAdd, onUpdate, onDelete, isBusinessSpace }: {
  entries: ContactEntry[];
  onAdd: (c: ContactEntry) => void;
  onUpdate: (c: ContactEntry) => void;
  onDelete: (id: string) => void;
  isBusinessSpace?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Contacts</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <ContactForm
          onSave={(c) => { onAdd(c); setAdding(false); }}
          onCancel={() => setAdding(false)}
          isBusinessSpace={isBusinessSpace}
        />
      )}

      {entries.length === 0 && !adding ? (
        <div className="text-center py-6">
          <div className="w-10 h-10 rounded-2xl bg-dusk-50 text-dusk-600 flex items-center justify-center mx-auto mb-2">
            <Users className="w-5 h-5" />
          </div>
          <p className="text-[13px] text-ink-400">
            {isBusinessSpace
              ? 'No contacts yet — accountant, labour consultant, landlord, Dept of Labour…'
              : 'No contacts yet — school office, teachers, doctor, friends, emergency…'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map(c => editId === c.id ? (
            <div key={c.id}>
              <ContactForm
                initial={c}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
                isBusinessSpace={isBusinessSpace}
              />
            </div>
          ) : (
            <div key={c.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-ink-900 truncate">
                  {c.name || 'Unnamed'}
                  {c.relation && <span className="chip bg-dusk-100 text-dusk-700 ml-2">{c.relation}</span>}
                </p>
                <div className="mt-1 space-y-0.5">
                  {c.phone && (
                    <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="flex items-center gap-1.5 text-[13px] font-mono tabular-nums text-sage-700 hover:underline">
                      <Phone className="w-3 h-3 shrink-0" /> {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 text-[13px] text-dusk-700 hover:underline break-all">
                      <Mail className="w-3 h-3 shrink-0" /> {c.email}
                    </a>
                  )}
                  {c.note && <p className="text-[12px] text-ink-500">{c.note}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(c.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(c.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
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

function ContactForm({ initial, onSave, onCancel, isBusinessSpace }: {
  initial?: ContactEntry;
  onSave: (c: ContactEntry) => void;
  onCancel: () => void;
  isBusinessSpace?: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [relation, setRelation] = useState(initial?.relation || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [note, setNote] = useState(initial?.note || '');

  const save = () => {
    if (!name.trim() && !phone.trim() && !email.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      relation: relation.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input
        autoFocus
        className="field"
        placeholder={isBusinessSpace ? 'Name  (e.g. Sipho Dlamini / ABC Accounting)' : 'Name  (e.g. Frau Müller / Volksschule)'}
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <input
        className="field"
        placeholder={isBusinessSpace ? 'Relation  (e.g. Accountant, Labour consultant, Landlord)' : 'Relation  (e.g. Class teacher 3b, Doctor, Friend)'}
        value={relation}
        onChange={e => setRelation(e.target.value)}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input className="field" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
        <input className="field" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <input className="field" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}
