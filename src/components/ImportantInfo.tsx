import React, { useState, useEffect } from 'react';
import { FamilyInfo, InfoEntry, ContactEntry, HealthcareProvider, ProviderType, FamilyInfoDoc } from '../types';
import { loadFamilyInfo, saveFamilyInfo, loadSpaceInfo } from '../utils/db';
import { auth } from '../lib/firebase';
import { yearsSinceFounding, ordinal } from '../utils/businessMilestone';
import {
  Hash, Phone, Mail, Plus, Trash2, Pencil, Check, X,
  IdCard, Users, Search, Cloud, CloudOff, Stethoscope, Star, PartyPopper, Dices, Loader2
} from 'lucide-react';

const EMPTY: FamilyInfo = { numbers: [], contacts: [], providers: [] };

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

interface ImportantInfoProps {
  isBusinessSpace?: boolean;
  refreshKey?: number;
  onContactsChange?: (contacts: ContactEntry[]) => void;
}

export default function ImportantInfo({ isBusinessSpace, refreshKey, onContactsChange }: ImportantInfoProps) {
  const [info, setInfo] = useState<FamilyInfo>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadFamilyInfo();
      if (active) {
        const next = data && (data.numbers || data.contacts || data.providers) ? { numbers: data.numbers || [], contacts: data.contacts || [], providers: data.providers || [] } : EMPTY;
        setInfo(next);
        setLoaded(true);
        onContactsChange?.(next.contacts);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const persist = async (next: FamilyInfo) => {
    setInfo(next);
    const ok = await saveFamilyInfo(next);
    setCloudSynced(ok);
    onContactsChange?.(next.contacts);
  };

  // --- Business Milestones: founding date + AI-written anniversary note.
  // Reads families/{id}/info/info directly (distinct doc from the FamilyInfo
  // above). The note is generated+persisted server-side by
  // /api/business-milestone-note (mirrors the astrology-blurb pattern) — this
  // component only triggers it and shows the result, same as MemberOverview's
  // "shuffle" dice button does for astrology.
  const [spaceInfo, setSpaceInfo] = useState<FamilyInfoDoc | null>(null);
  const [spaceInfoLoaded, setSpaceInfoLoaded] = useState(false);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!isBusinessSpace) { setSpaceInfo(null); setSpaceInfoLoaded(false); return; }
    setSpaceInfoLoaded(false);
    loadSpaceInfo().then((s) => { if (active) { setSpaceInfo(s); setSpaceInfoLoaded(true); } });
    return () => { active = false; };
  }, [refreshKey, isBusinessSpace]);

  const handleGenerateMilestoneNote = async () => {
    setNoteLoading(true);
    setNoteError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in first.');
      const token = await user.getIdToken();
      const res = await fetch('/api/business-milestone-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not generate a note right now.');
      setSpaceInfo((prev) => (prev ? { ...prev, milestoneNote: data.note } : prev));
    } catch (e: any) {
      setNoteError(e?.message || 'Could not generate a note right now.');
    } finally {
      setNoteLoading(false);
    }
  };

  const q = search.trim().toLowerCase();
  const numbers = q
    ? info.numbers.filter(n => `${n.label} ${n.value} ${n.note || ''}`.toLowerCase().includes(q))
    : info.numbers;
  const contacts = q
    ? info.contacts.filter(c => `${c.name} ${c.relation || ''} ${c.phone || ''} ${c.email || ''} ${c.note || ''}`.toLowerCase().includes(q))
    : info.contacts;
  const providers = q
    ? (info.providers || []).filter(p => `${p.name} ${p.type} ${p.specialty || ''} ${p.practiceName || ''} ${p.phone || ''} ${p.forMember || ''} ${p.note || ''}`.toLowerCase().includes(q))
    : (info.providers || []);

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

      {isBusinessSpace && spaceInfoLoaded && (
        <MilestoneSection
          spaceInfo={spaceInfo}
          noteLoading={noteLoading}
          noteError={noteError}
          onGenerateNote={handleGenerateMilestoneNote}
        />
      )}

      {!isBusinessSpace && (
        <ProvidersSection
          entries={providers}
          onAdd={(p) => persist({ ...info, providers: [...(info.providers || []), p] })}
          onUpdate={(p) => persist({ ...info, providers: (info.providers || []).map(x => x.id === p.id ? p : x) })}
          onDelete={(id) => persist({ ...info, providers: (info.providers || []).filter(p => p.id !== id) })}
        />
      )}

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

/* ---------------- Business Milestones ---------------- */

function MilestoneSection({ spaceInfo, noteLoading, noteError, onGenerateNote }: {
  spaceInfo: FamilyInfoDoc | null;
  noteLoading: boolean;
  noteError: string | null;
  onGenerateNote: () => void;
}) {
  const foundingDate = spaceInfo?.foundingDate;
  const years = foundingDate ? yearsSinceFounding(foundingDate) : null;
  // Only trust a stored note if it was generated for the CURRENT founding
  // date — an admin can change the date, which should clear the old note
  // from view rather than show a now-mismatched year count.
  const note = spaceInfo?.milestoneNote?.forFoundingDate === foundingDate ? spaceInfo?.milestoneNote : undefined;

  return (
    <section className="card p-5 space-y-3">
      <h3 className="section-label flex items-center gap-1.5"><PartyPopper className="w-3.5 h-3.5" /> Milestone</h3>

      {!foundingDate ? (
        <p className="text-[13px] text-ink-400">
          No founding date set yet — add one in Business Settings to see your anniversary here and on the calendar.
        </p>
      ) : (
        <>
          <p className="text-[13px] text-ink-500">
            {spaceInfo?.name || 'This business'} was founded{' '}
            <span className="font-semibold text-ink-800">
              {new Date(foundingDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            {years !== null && years > 0 ? ` — coming up on its ${ordinal(years)} anniversary.` : ' — not yet a year old.'}
          </p>
          <div className="p-3.5 rounded-2xl border border-cream-200 bg-white space-y-2">
            {note?.text ? (
              <p className="text-[13.5px] text-ink-800 leading-relaxed">{note.text}</p>
            ) : (
              <p className="text-[13px] text-ink-400">No milestone note yet — write a short AI note for this anniversary.</p>
            )}
            {noteError && <p className="text-xs text-rosa-700 bg-rosa-50 rounded-xl px-3 py-2">{noteError}</p>}
            <button
              onClick={onGenerateNote}
              disabled={noteLoading}
              className="btn-quiet text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {noteLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Dices className="w-3.5 h-3.5" />}
              {note?.text ? 'Write a new one' : 'Write a note'}
            </button>
          </div>
        </>
      )}
    </section>
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
  const [birthdate, setBirthdate] = useState(initial?.birthdate || '');

  const save = () => {
    if (!name.trim() && !phone.trim() && !email.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      relation: relation.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      note: note.trim() || undefined,
      birthdate: birthdate || undefined,
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
      <div>
        <label className="text-[11px] font-semibold text-ink-500 mb-1 block">Birthday (optional) — gets a reminder here even without a full profile</label>
        <input type="date" className="field" value={birthdate} onChange={e => setBirthdate(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

/* ---------------- Doctors & Specialists ---------------- */

const PROVIDER_TYPES: ProviderType[] = ['GP practice', 'Dentist', 'Optician', 'Specialist', 'Pharmacy', 'Other'];

function ProvidersSection({ entries, onAdd, onUpdate, onDelete }: {
  entries: HealthcareProvider[];
  onAdd: (p: HealthcareProvider) => void;
  onUpdate: (p: HealthcareProvider) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <div>
          <h3 className="section-label flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5" /> Doctors & Specialists</h3>
          <p className="text-[12px] text-ink-400 mt-0.5">Your family's GP, dentist, and specialists — one place to find who to call.</p>
        </div>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5 shrink-0">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <ProviderForm
          onSave={(p) => { onAdd(p); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <div className="text-center py-6">
          <div className="w-10 h-10 rounded-2xl bg-rosa-50 text-rosa-600 flex items-center justify-center mx-auto mb-2">
            <Stethoscope className="w-5 h-5" />
          </div>
          <p className="text-[13px] text-ink-400">
            No doctors or specialists yet — your GP, dentist, paediatrician, or any specialist a family member sees.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {entries.map(p => editId === p.id ? (
            <div key={p.id} className="sm:col-span-2">
              <ProviderForm
                initial={p}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={p.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="chip bg-rosa-100 text-rosa-700">{p.type}</span>
                  {p.isPrimary && <Star className="w-3.5 h-3.5 text-honey-500 fill-honey-400" />}
                </div>
                <p className="text-[14px] font-semibold text-ink-900 truncate mt-1">{p.name || 'Unnamed'}</p>
                {(p.specialty || p.practiceName) && (
                  <p className="text-[12.5px] text-ink-500">{[p.specialty, p.practiceName].filter(Boolean).join(' · ')}</p>
                )}
                <div className="mt-1 space-y-0.5">
                  {p.phone && (
                    <a href={`tel:${p.phone.replace(/\s+/g, '')}`} className="flex items-center gap-1.5 text-[13px] font-mono tabular-nums text-sage-700 hover:underline">
                      <Phone className="w-3 h-3 shrink-0" /> {p.phone}
                    </a>
                  )}
                  {p.afterHoursPhone && (
                    <a href={`tel:${p.afterHoursPhone.replace(/\s+/g, '')}`} className="flex items-center gap-1.5 text-[13px] font-mono tabular-nums text-honey-700 hover:underline">
                      <Phone className="w-3 h-3 shrink-0" /> {p.afterHoursPhone} <span className="text-ink-400 font-sans not-italic">after-hours</span>
                    </a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 text-[13px] text-dusk-700 hover:underline break-all">
                      <Mail className="w-3 h-3 shrink-0" /> {p.email}
                    </a>
                  )}
                  {p.address && <p className="text-[12px] text-ink-500">{p.address}</p>}
                  {p.networksAccepted && <p className="text-[12px] text-ink-500">Networks: {p.networksAccepted}</p>}
                  {p.practiceNumber && <p className="text-[12px] text-ink-400 font-mono">{p.practiceNumber}</p>}
                  {p.referredBy && <p className="text-[12px] text-ink-400">Referred by {p.referredBy}</p>}
                  {p.forMember && <span className="chip bg-cream-100 text-ink-600">{p.forMember}</span>}
                  {p.note && <p className="text-[12px] text-ink-500">{p.note}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(p.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(p.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
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

function ProviderForm({ initial, onSave, onCancel }: {
  initial?: HealthcareProvider;
  onSave: (p: HealthcareProvider) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState<ProviderType>(initial?.type || 'GP practice');
  const [specialty, setSpecialty] = useState(initial?.specialty || '');
  const [practiceName, setPracticeName] = useState(initial?.practiceName || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [afterHoursPhone, setAfterHoursPhone] = useState(initial?.afterHoursPhone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [networksAccepted, setNetworksAccepted] = useState(initial?.networksAccepted || '');
  const [practiceNumber, setPracticeNumber] = useState(initial?.practiceNumber || '');
  const [referredBy, setReferredBy] = useState(initial?.referredBy || '');
  const [forMember, setForMember] = useState(initial?.forMember || '');
  const [isPrimary, setIsPrimary] = useState(initial?.isPrimary || false);
  const [note, setNote] = useState(initial?.note || '');

  const save = () => {
    if (!name.trim() && !practiceName.trim() && !phone.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      type,
      specialty: specialty.trim() || undefined,
      practiceName: practiceName.trim() || undefined,
      phone: phone.trim() || undefined,
      afterHoursPhone: afterHoursPhone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      networksAccepted: networksAccepted.trim() || undefined,
      practiceNumber: practiceNumber.trim() || undefined,
      referredBy: referredBy.trim() || undefined,
      forMember: forMember.trim() || undefined,
      isPrimary,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input autoFocus className="field" placeholder="Name  (e.g. Dr. Naidoo, or practice name)" value={name} onChange={e => setName(e.target.value)} />
        <select className="field" value={type} onChange={e => setType(e.target.value as ProviderType)}>
          {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {type !== 'Pharmacy' && (
        <input className="field" placeholder="Specialty  (e.g. Paediatrician, Cardiologist)" value={specialty} onChange={e => setSpecialty(e.target.value)} />
      )}
      <input className="field" placeholder="Practice / clinic / hospital name" value={practiceName} onChange={e => setPracticeName(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input className="field" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
        <input className="field" placeholder="After-hours / emergency phone" value={afterHoursPhone} onChange={e => setAfterHoursPhone(e.target.value)} />
      </div>
      <input className="field" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input className="field" placeholder="Address" value={address} onChange={e => setAddress(e.target.value)} />
      <input className="field" placeholder="Insurance / medical aid networks accepted (optional)" value={networksAccepted} onChange={e => setNetworksAccepted(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input className="field" placeholder="Practice / NPI number (optional)" value={practiceNumber} onChange={e => setPracticeNumber(e.target.value)} />
        <input className="field" placeholder="Referred by (optional)" value={referredBy} onChange={e => setReferredBy(e.target.value)} />
      </div>
      <input className="field" placeholder="For  (optional — e.g. Mia; blank = whole family)" value={forMember} onChange={e => setForMember(e.target.value)} />
      <label className="flex items-center gap-2 text-[13px] text-ink-600 cursor-pointer select-none">
        <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} className="rounded" />
        This is our usual GP / primary provider
      </label>
      <input className="field" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}
