import React, { useState, useEffect } from 'react';
import { HouseholdInfo, Pet, PetHealthRecord } from '../types';
import { loadHousehold, saveHousehold } from '../utils/db';
import { isDeceased, nextVaccinationDate, petAgeLabel, petDeadlines, petLabel, sortHealthLog } from '../utils/pet';
import { useSharedDoc } from '../hooks/useSharedDoc';
import EmptyState from './EmptyState';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import {
  PawPrint, Plus, Pencil, Trash2, Check, X, Cloud, CloudOff,
  Cake, Fingerprint, Stethoscope, CalendarClock, ShieldCheck,
} from 'lucide-react';

// Pets get their own section rather than living at the bottom of Household.
//
// Rory (2026-08-21): "should we not have pets in menu as well? seems logical?"
// — and it is. Household is where you look for a boiler service or a door
// code; it is not where anyone thinks to look for the dog. The spec for the
// whole pets feature was "pets to a lot of families are just as important as
// children", and children are one tap from the menu.
//
// The DATA does not move: pets are still HouseholdInfo.pets, still saved
// through saveHousehold, still merged by the same three-way merge. Only the
// door changed. A second store for the same list is how two screens start
// disagreeing about the same dog.

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

export default function PetsView({ refreshKey }: { refreshKey?: number }) {
  const [info, setInfo] = useState<HouseholdInfo | null>(null);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadHousehold();
      if (active) setInfo(data || {});
    })();
    return () => { active = false; };
  }, [refreshKey]);

  // Another family member adding a pet on their phone shows up here without a
  // reload. Applied silently — the add/edit form holds its own draft state.
  useSharedDoc<HouseholdInfo>('household', (h) => setInfo(h || {}));

  const persist = async (next: HouseholdInfo) => {
    setInfo(next);
    setCloudSynced(await saveHousehold(next));
  };

  if (!info) {
    return (
      <div className="card flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" />
      </div>
    );
  }

  const pets = info.pets ?? [];

  return (
    <div className="space-y-6 font-sans">
      <div className="card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-sage-100 text-sage-700 shrink-0">
            <PawPrint className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Pets</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              Birthdays, microchips, the vet, insurance and their whole medical history.
            </p>
          </div>
        </div>
      </div>

      <PetsSection
        entries={pets}
        onAdd={(p) => persist({ ...info, pets: [...pets, p] })}
        onUpdate={(p) => persist({ ...info, pets: pets.map(x => x.id === p.id ? p : x) })}
        onDelete={(id) => persist({ ...info, pets: pets.filter(x => x.id !== id) })}
      />

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

/* ─── Pets ───────────────────────────────────────────────────────────────── */

function PetsSection({ entries, onAdd, onUpdate, onDelete }: {
  entries: Pet[];
  onAdd: (p: Pet) => void;
  onUpdate: (p: Pet) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5"><PawPrint className="w-3.5 h-3.5" /> Pets</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <PetForm
          onSave={(p) => { onAdd(p); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <EmptyState icon={PawPrint} title="No pets yet \u2014 dogs, cats, birds, fish\u2026" description="Birthday, breed, microchip, vet, insurance and their whole medical history. A birthday here shows on the family calendar." />
      ) : (
        <div className="space-y-2.5">
          {entries.map(p => editId === p.id ? (
            <div key={p.id}>
              <PetForm
                initial={p}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={p.id} className={`p-3.5 rounded-2xl border flex items-start justify-between gap-3 transition-colors ${isDeceased(p) ? 'border-cream-200 bg-cream-50/70' : 'border-cream-200 bg-white hover:bg-cream-50 hover:border-cream-300'}`}>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[14px] font-semibold text-ink-900 truncate">
                  {petLabel(p)}
                  {p.species && <span className="chip bg-sage-100 text-sage-700 ml-2">{p.species}</span>}
                  {isDeceased(p) && <span className="chip bg-cream-200 text-ink-500 ml-2">In memory</span>}
                </p>
                {(p.breed || petAgeLabel(p) || p.sex) && (
                  <p className="text-[12px] text-ink-500">
                    {[p.breed, petAgeLabel(p), p.sex].filter(Boolean).join(' \u00b7 ')}
                  </p>
                )}
                {/* Deadlines first: this is the half of the record that is
                    actionable today. petDeadlines returns [] for a pet with a
                    deceasedDate, so nothing here has to check for that. */}
                {petDeadlines(p).filter(d => d.days <= 60).map(d => (
                  <p key={d.kind} className={`text-[12px] font-medium ${d.days < 0 ? 'text-rosa-700' : 'text-honey-800'}`}>
                    {d.label} {d.days < 0 ? `\u2014 overdue since ${d.date}` : d.days === 0 ? '\u2014 today' : `in ${d.days} days`}
                  </p>
                ))}
                {p.vet && <p className="text-[12px] text-ink-500">Vet: {p.vet}{p.vetPhone ? ` \u00b7 ${p.vetPhone}` : ''}</p>}
                {p.microchip && (
                  <p className="font-mono tabular-nums text-[11px] text-ink-400">
                    Microchip: {p.microchip}{p.chipRegistry ? ` \u00b7 ${p.chipRegistry}` : ''}
                  </p>
                )}
                {(p.allergies || p.conditions || p.medications) && (
                  <p className="text-[12px] text-ink-500">
                    {[p.conditions, p.allergies && `Allergies: ${p.allergies}`, p.medications].filter(Boolean).join(' \u00b7 ')}
                  </p>
                )}
                {p.vaccinations && <p className="text-[12px] text-ink-500">Vaccinations: {p.vaccinations}</p>}
                {(p.healthLog || []).length > 0 && (
                  <p className="text-[12px] text-ink-400">
                    {(p.healthLog || []).length} {(p.healthLog || []).length === 1 ? 'entry' : 'entries'} in their medical history
                  </p>
                )}
                {p.notes && <p className="text-[12px] text-ink-500">{p.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(p.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <ConfirmDeleteButton
                  onConfirm={() => onDelete(p.id)}
                  ariaLabel={`Remove ${petLabel(p)}`}
                  confirmLabel="Remove"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// The pet record, in full.
//
// GROUPED, not one long column of inputs. A pet now carries roughly as many
// fields as a vehicle, and VehiclesView already established how this app shows
// that many: labelled boxes, each answering one question you would actually
// ask ("who's the vet?", "what's it cost?", "what's due?"). The alternative —
// twenty-five bare placeholders in a stack — is the shape the old six-field
// form would have grown into, and it reads as a tax return.
//
// `patch` over a single draft object rather than one useState per field: at
// this width the per-field version is ~25 hooks whose only job is to be
// reassembled on save, and every new field is then four edits instead of one.
function PetForm({ initial, onSave, onCancel }: {
  initial?: Pet;
  onSave: (p: Pet) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Pet>(() => initial ?? { id: newId(), name: '' });
  const [addingHealth, setAddingHealth] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const patch = (bits: Partial<Pet>) => setDraft(d => ({ ...d, ...bits }));

  // Trim on the way out, and drop anything empty so a blank field never
  // becomes an empty string in Firestore that later reads as "answered".
  const clean = (v?: string) => {
    const t = (v || '').trim();
    return t || undefined;
  };

  const save = () => {
    if (!clean(draft.name)) { setFormError('Name is required'); return; }
    setFormError(null);
    onSave({
      ...draft,
      id: draft.id || newId(),
      name: (draft.name || '').trim(),
      species: clean(draft.species),
      breed: clean(draft.breed),
      sex: clean(draft.sex),
      colour: clean(draft.colour),
      birthdate: clean(draft.birthdate),
      birthdateEstimated: draft.birthdateEstimated || undefined,
      adoptedDate: clean(draft.adoptedDate),
      deceasedDate: clean(draft.deceasedDate),
      microchip: clean(draft.microchip),
      chipRegistry: clean(draft.chipRegistry),
      passportNumber: clean(draft.passportNumber),
      licenceNumber: clean(draft.licenceNumber),
      licenceExpiry: clean(draft.licenceExpiry),
      vet: clean(draft.vet),
      vetPhone: clean(draft.vetPhone),
      vetAddress: clean(draft.vetAddress),
      weight: clean(draft.weight),
      allergies: clean(draft.allergies),
      conditions: clean(draft.conditions),
      medications: clean(draft.medications),
      diet: clean(draft.diet),
      vaccinations: clean(draft.vaccinations),
      nextVaccinationDue: clean(draft.nextVaccinationDue),
      nextTreatmentDue: clean(draft.nextTreatmentDue),
      insurer: clean(draft.insurer),
      policyNumber: clean(draft.policyNumber),
      insuranceRenewal: clean(draft.insuranceRenewal),
      notes: clean(draft.notes),
      healthLog: (draft.healthLog || []).length ? draft.healthLog : undefined,
    });
  };

  const addHealthRecord = (r: PetHealthRecord) => {
    patch({ healthLog: [...(draft.healthLog || []), r] });
    setAddingHealth(false);
  };
  const removeHealthRecord = (id: string) => {
    patch({ healthLog: (draft.healthLog || []).filter(r => r.id !== id) });
  };

  const derivedVaccination = nextVaccinationDate(draft);

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-3">
      {/* Who they are */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div><label className="field-label">Name</label><input autoFocus className="field w-full" placeholder="e.g. Buddy" value={draft.name || ''} onChange={e => patch({ name: e.target.value })} /></div>
        <div><label className="field-label">Species</label><input className="field w-full" placeholder="Dog, Cat, Rabbit…" value={draft.species || ''} onChange={e => patch({ species: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div><label className="field-label">Breed</label><input className="field w-full" placeholder="e.g. Border Collie" value={draft.breed || ''} onChange={e => patch({ breed: e.target.value })} /></div>
        <div><label className="field-label">Sex</label><input className="field w-full" placeholder="e.g. Male (neutered)" value={draft.sex || ''} onChange={e => patch({ sex: e.target.value })} /></div>
        <div><label className="field-label">Colour &amp; markings</label><input className="field w-full" placeholder="What you'd put on a poster" value={draft.colour || ''} onChange={e => patch({ colour: e.target.value })} /></div>
      </div>

      {/* Dates */}
      <div className="rounded-2xl border border-cream-200 bg-white/70 p-3.5 space-y-3">
        <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><Cake className="w-3.5 h-3.5" /> Their dates</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Birthday</label>
            <input type="date" className="field w-full" value={draft.birthdate || ''} onChange={e => patch({ birthdate: e.target.value })} />
            <p className="text-[11px] text-ink-400 mt-1">Puts their birthday on the family calendar, like anyone else&apos;s.</p>
          </div>
          <div><label className="field-label">Came home</label><input type="date" className="field w-full" value={draft.adoptedDate || ''} onChange={e => patch({ adoptedDate: e.target.value })} /></div>
        </div>
        {/* Rescues. Without this the app prints "turns 7" over a vet's guess. */}
        <label className="flex items-start gap-2 text-[12px] text-ink-600">
          <input type="checkbox" className="mt-0.5" checked={!!draft.birthdateEstimated} onChange={e => patch({ birthdateEstimated: e.target.checked })} />
          <span>That birthday is an estimate <span className="text-ink-400">— common with rescues. Everywhere it shows, we&apos;ll say &ldquo;about 7&rdquo; rather than &ldquo;turns 7&rdquo;.</span></span>
        </label>
        <div>
          <label className="field-label">If they&apos;ve passed away</label>
          <input type="date" className="field w-full" value={draft.deceasedDate || ''} onChange={e => patch({ deceasedDate: e.target.value })} />
          <p className="text-[11px] text-ink-400 mt-1">Keeps everything on this page and stops all their reminders and birthdays. You never have to delete them.</p>
        </div>
      </div>

      {/* Identification */}
      <div className="rounded-2xl border border-cream-200 bg-white/70 p-3.5 space-y-3">
        <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5" /> If they&apos;re ever lost</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div><label className="field-label">Microchip number</label><input className="field w-full font-mono" value={draft.microchip || ''} onChange={e => patch({ microchip: e.target.value })} /></div>
          <div>
            <label className="field-label">Registered with</label>
            <input className="field w-full" placeholder="e.g. Petmaxx, Animaldata" value={draft.chipRegistry || ''} onChange={e => patch({ chipRegistry: e.target.value })} />
            <p className="text-[11px] text-ink-400 mt-1">A chip number is a key into one particular database — whoever finds them needs to know which.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div><label className="field-label">Pet passport no.</label><input className="field w-full font-mono" value={draft.passportNumber || ''} onChange={e => patch({ passportNumber: e.target.value })} /></div>
          <div><label className="field-label">Licence / registration</label><input className="field w-full font-mono" value={draft.licenceNumber || ''} onChange={e => patch({ licenceNumber: e.target.value })} /></div>
          <div><label className="field-label">Licence renews</label><input type="date" className="field w-full" value={draft.licenceExpiry || ''} onChange={e => patch({ licenceExpiry: e.target.value })} /></div>
        </div>
      </div>

      {/* Vet & health */}
      <div className="rounded-2xl border border-cream-200 bg-white/70 p-3.5 space-y-3">
        <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5" /> Vet &amp; health</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div><label className="field-label">Vet / practice</label><input className="field w-full" value={draft.vet || ''} onChange={e => patch({ vet: e.target.value })} /></div>
          <div><label className="field-label">Vet phone</label><input type="tel" className="field w-full" value={draft.vetPhone || ''} onChange={e => patch({ vetPhone: e.target.value })} /></div>
        </div>
        <div><label className="field-label">Vet address</label><input className="field w-full" value={draft.vetAddress || ''} onChange={e => patch({ vetAddress: e.target.value })} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Weight</label>
            <input className="field w-full" placeholder="e.g. 24 kg" value={draft.weight || ''} onChange={e => patch({ weight: e.target.value })} />
            <p className="text-[11px] text-ink-400 mt-1">Doses are worked out by weight — it&apos;s the first thing a vet asks.</p>
          </div>
          <div><label className="field-label">Allergies</label><input className="field w-full" value={draft.allergies || ''} onChange={e => patch({ allergies: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div><label className="field-label">Ongoing conditions</label><input className="field w-full" value={draft.conditions || ''} onChange={e => patch({ conditions: e.target.value })} /></div>
          <div><label className="field-label">Medications</label><input className="field w-full" value={draft.medications || ''} onChange={e => patch({ medications: e.target.value })} /></div>
        </div>
        <div><label className="field-label">Food &amp; feeding</label><input className="field w-full" placeholder="What, how much, how often" value={draft.diet || ''} onChange={e => patch({ diet: e.target.value })} /></div>
        {/* LEGACY: shown only when it already holds something. New detail goes
            in the medical history below, but a family whose prose is in here
            must not watch it disappear. */}
        {!!(draft.vaccinations || '').trim() && (
          <div>
            <label className="field-label">Vaccinations (older note)</label>
            <input className="field w-full" value={draft.vaccinations || ''} onChange={e => patch({ vaccinations: e.target.value })} />
            <p className="text-[11px] text-ink-400 mt-1">Kept from before. New jabs are better recorded in the medical history below, where they can carry a next-due date.</p>
          </div>
        )}
      </div>

      {/* Reminders */}
      <div className="rounded-2xl border border-cream-200 bg-white/70 p-3.5 space-y-3">
        <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" /> What&apos;s due</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="field-label">Next vaccination</label>
            <input type="date" className="field w-full" value={draft.nextVaccinationDue || ''} onChange={e => patch({ nextVaccinationDue: e.target.value })} />
            {/* The two stores for this one fact, said out loud rather than
                left for someone to discover. nextVaccinationDate() is the
                resolver; this line just reports what it decided. */}
            {!draft.nextVaccinationDue && derivedVaccination && (
              <p className="text-[11px] text-ink-400 mt-1">Using {derivedVaccination} from their medical history. Fill this in to override it.</p>
            )}
          </div>
          <div><label className="field-label">Next flea / worm treatment</label><input type="date" className="field w-full" value={draft.nextTreatmentDue || ''} onChange={e => patch({ nextTreatmentDue: e.target.value })} /></div>
        </div>
      </div>

      {/* Insurance */}
      <div className="rounded-2xl border border-cream-200 bg-white/70 p-3.5 space-y-3">
        <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Insurance</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div><label className="field-label">Insurer</label><input className="field w-full" value={draft.insurer || ''} onChange={e => patch({ insurer: e.target.value })} /></div>
          <div><label className="field-label">Policy no.</label><input className="field w-full font-mono" value={draft.policyNumber || ''} onChange={e => patch({ policyNumber: e.target.value })} /></div>
          <div><label className="field-label">Renews</label><input type="date" className="field w-full" value={draft.insuranceRenewal || ''} onChange={e => patch({ insuranceRenewal: e.target.value })} /></div>
        </div>
      </div>

      {/* Medical history — the thing Rory actually named. */}
      <div className="rounded-2xl border border-cream-200 bg-white/70 p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><Stethoscope className="w-3.5 h-3.5" /> Medical history</label>
          <button type="button" onClick={() => setAddingHealth(true)} className="btn-quiet text-[11px] px-2.5 py-1"><Plus className="w-3 h-3" /> Add entry</button>
        </div>

        {sortHealthLog(draft.healthLog || []).map(r => (
          <div key={r.id} className="p-2.5 rounded-xl border border-cream-200 bg-cream-50/70 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-ink-900">
                {r.what}
                {r.type && <span className="chip bg-sage-100 text-sage-700 ml-2">{r.type}</span>}
              </p>
              <p className="text-[11px] text-ink-400 tabular-nums">
                {[r.date, r.vet, r.cost, r.nextDue ? `next due ${r.nextDue}` : null].filter(Boolean).join(' · ')}
              </p>
              {r.notes && <p className="text-[11.5px] text-ink-500 mt-0.5">{r.notes}</p>}
            </div>
            <button type="button" onClick={() => removeHealthRecord(r.id)} className="p-1 text-ink-400 hover:text-rosa-500 rounded-lg shrink-0" title="Remove entry">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {addingHealth ? (
          <PetHealthForm onSave={addHealthRecord} onCancel={() => setAddingHealth(false)} />
        ) : (draft.healthLog || []).length === 0 && (
          <p className="text-[12px] text-ink-400">
            Jabs, check-ups, illnesses, operations, dentals — with the date the next one is due, so nobody has to find the booklet.
          </p>
        )}
      </div>

      <div><label className="field-label">Notes</label><input className="field w-full" value={draft.notes || ''} onChange={e => patch({ notes: e.target.value })} /></div>

      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

const PET_HEALTH_TYPES = ['Vaccination', 'Check-up', 'Illness', 'Injury', 'Surgery', 'Dental', 'Parasite treatment', 'Other'];

// One entry in the history. `what` is the only required field, for the same
// reason HomeServiceRecord.work is: the family is recording something that
// already happened, and refusing the record because they cannot remember the
// exact cost is how a log stops being kept.
function PetHealthForm({ onSave, onCancel }: {
  onSave: (r: PetHealthRecord) => void;
  onCancel: () => void;
}) {
  const [r, setR] = useState<PetHealthRecord>({ id: newId(), date: '', what: '' });
  const [err, setErr] = useState<string | null>(null);
  const patch = (bits: Partial<PetHealthRecord>) => setR(x => ({ ...x, ...bits }));

  const save = () => {
    if (!r.what.trim()) { setErr('Say what happened'); return; }
    setErr(null);
    const t = (v?: string) => { const s2 = (v || '').trim(); return s2 || undefined; };
    onSave({
      id: r.id,
      date: (r.date || '').trim(),
      what: r.what.trim(),
      type: t(r.type),
      vet: t(r.vet),
      cost: t(r.cost),
      nextDue: t(r.nextDue),
      notes: t(r.notes),
    });
  };

  return (
    <div className="p-3 rounded-xl border border-clay-200 bg-clay-50/70 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div><label className="field-label">What happened</label><input autoFocus className="field w-full" placeholder="e.g. Rabies booster" value={r.what} onChange={e => patch({ what: e.target.value })} /></div>
        <div>
          <label className="field-label">Kind</label>
          <select className="field w-full" value={r.type || ''} onChange={e => patch({ type: e.target.value })}>
            <option value="">—</option>
            {PET_HEALTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div><label className="field-label">Date</label><input type="date" className="field w-full" value={r.date} onChange={e => patch({ date: e.target.value })} /></div>
        <div>
          <label className="field-label">Next one due</label>
          <input type="date" className="field w-full" value={r.nextDue || ''} onChange={e => patch({ nextDue: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div><label className="field-label">Vet / clinic</label><input className="field w-full" value={r.vet || ''} onChange={e => patch({ vet: e.target.value })} /></div>
        <div><label className="field-label">Cost</label><input className="field w-full" value={r.cost || ''} onChange={e => patch({ cost: e.target.value })} /></div>
      </div>
      <div><label className="field-label">Notes</label><input className="field w-full" value={r.notes || ''} onChange={e => patch({ notes: e.target.value })} /></div>
      {err && <p role="alert" className="text-[11px] text-rosa-600">{err}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-[11px] px-2.5 py-1"><X className="w-3 h-3" /> Cancel</button>
        <button onClick={save} className="btn-primary text-[11px] px-2.5 py-1"><Check className="w-3 h-3" /> Add</button>
      </div>
    </div>
  );
}
