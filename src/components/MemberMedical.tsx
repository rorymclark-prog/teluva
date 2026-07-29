import React, { useState, useEffect } from 'react';
import { FamilyMember, MedicalRecord, Vaccination, IdCountry, CalendarEvent } from '../types';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import HealthInsuranceRow from './HealthInsuranceRow';
import MemberReferrals from './MemberReferrals';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import MemberAppointments from './MemberAppointments';

interface MemberMedicalProps {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
  country?: IdCountry;
  /** The shared family calendar — this screen READS booked appointments from it, never stores them. */
  events?: readonly CalendarEvent[];
  onOpenCalendar?: () => void;
}

function newId() {
  return Date.now().toString() + Math.floor(Math.random() * 1000);
}

const initMedical = (member: FamilyMember): MedicalRecord => ({
  bloodGroup: member.medical?.bloodGroup || '',
  allergies: member.medical?.allergies || '',
  medications: member.medical?.medications || '',
  conditions: member.medical?.conditions || '',
  vaccinations: member.medical?.vaccinations || [],
  surgeries: member.medical?.surgeries || '',
  emergencyMedication: member.medical?.emergencyMedication || '',
  organDonor: member.medical?.organDonor || false,
  familyHistory: member.medical?.familyHistory || '',
  preferredPharmacy: member.medical?.preferredPharmacy || '',
  notes: member.medical?.notes || '',
});

export default function MemberMedical({ member, onUpdate, country = 'AT', events = [], onOpenCalendar }: MemberMedicalProps) {
  const [medical, setMedical] = useState<MedicalRecord>(() => initMedical(member));

  // Reset local state when member.id changes
  useEffect(() => {
    setMedical(initMedical(member));
  }, [member.id]);

  const handleFieldChange = (field: keyof MedicalRecord, value: string | boolean) => {
    const updated = { ...medical, [field]: value };
    setMedical(updated);
  };

  const handleFieldBlur = (field: keyof MedicalRecord) => {
    onUpdate({ medical });
  };

  const handleToggleOrganDonor = (checked: boolean) => {
    const updated = { ...medical, organDonor: checked };
    setMedical(updated);
    onUpdate({ medical: updated });
  };

  const handleAddVaccination = (vaccination: Vaccination) => {
    const updated = { ...medical, vaccinations: [...(medical.vaccinations || []), vaccination] };
    setMedical(updated);
    onUpdate({ medical: updated });
  };

  const handleUpdateVaccination = (id: string, vaccination: Vaccination) => {
    const updated = {
      ...medical,
      vaccinations: (medical.vaccinations || []).map(v => v.id === id ? vaccination : v),
    };
    setMedical(updated);
    onUpdate({ medical: updated });
  };

  const handleDeleteVaccination = (id: string) => {
    const updated = {
      ...medical,
      vaccinations: (medical.vaccinations || []).filter(v => v.id !== id),
    };
    setMedical(updated);
    onUpdate({ medical: updated });
  };

  return (
    <div className="space-y-6">
      {/* Booked appointments, read from the shared calendar.
          This tab is where people look for "when is the doctor?" — it was the
          first place checked when an appointment added by voice seemed to have
          disappeared, and there was nothing here to find because Medical has
          no appointments of its own and never will (see
          utils/memberAppointments.ts). Renders nothing when there is nothing
          booked, so it stays out of the way on an already-long screen. */}
      <MemberAppointments
        variant="compact"
        memberId={member.id}
        memberName={member.name}
        events={events}
        onOpenCalendar={onOpenCalendar}
      />

      {/* Emergency essentials card — honey/rosa tinted */}
      <section className="space-y-4">
        <h3 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
          <span className="w-1.5 h-3.5 bg-ink-800 rounded-full inline-block"></span>
          Emergency essentials
        </h3>
        <div className="card p-5 space-y-4 border-l-4 border-l-honey-500">
          {/* Health-insurance identifier FIRST — the number an ambulance crew or
              admissions desk asks for before anything else. Country-driven, and
              read-only here: it is edited on the ID & Passports tab only. */}
          <HealthInsuranceRow member={member} country={country} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">Blood group</label>
              <input
                type="text"
                placeholder="e.g. O+, A-, AB"
                value={medical.bloodGroup || ''}
                onChange={(e) => handleFieldChange('bloodGroup', e.target.value)}
                onBlur={() => handleFieldBlur('bloodGroup')}
                className="field uppercase placeholder:normal-case"
              />
            </div>

            <div>
              <label className="field-label">Emergency medication</label>
              <input
                type="text"
                placeholder="e.g. Epinephrine auto-injector (EpiPen)"
                value={medical.emergencyMedication || ''}
                onChange={(e) => handleFieldChange('emergencyMedication', e.target.value)}
                onBlur={() => handleFieldBlur('emergencyMedication')}
                className="field"
              />
            </div>
          </div>

          <div>
            <label className="field-label">Allergies</label>
            <textarea
              rows={2}
              placeholder="e.g. Penicillin (severe rash), peanuts (anaphylaxis), shellfish"
              value={medical.allergies || ''}
              onChange={(e) => handleFieldChange('allergies', e.target.value)}
              onBlur={() => handleFieldBlur('allergies')}
              className="field font-sans"
            />
          </div>

          <div>
            <label className="field-label">Chronic conditions</label>
            <textarea
              rows={2}
              placeholder="e.g. Type 1 diabetes, asthma, hypertension"
              value={medical.conditions || ''}
              onChange={(e) => handleFieldChange('conditions', e.target.value)}
              onBlur={() => handleFieldBlur('conditions')}
              className="field font-sans"
            />
          </div>

          <div className="flex items-center space-x-2.5 p-3 rounded-xl bg-honey-50 border border-honey-100">
            <input
              type="checkbox"
              id={`organDonor-${member.id}`}
              checked={medical.organDonor || false}
              onChange={(e) => handleToggleOrganDonor(e.target.checked)}
              className="w-4 h-4 border-cream-300 rounded focus:ring-honey-300 focus:outline-none accent-honey-500"
            />
            <label htmlFor={`organDonor-${member.id}`} className="text-[13px] font-semibold text-ink-700 select-none cursor-pointer">
              Registered organ donor
            </label>
          </div>
        </div>
      </section>

      {/* Health details section */}
      <section className="space-y-4">
        <h3 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
          <span className="w-1.5 h-3.5 bg-ink-800 rounded-full inline-block"></span>
          Health details
        </h3>
        <p className="text-[12.5px] text-ink-400 -mt-2">
          Doctors, specialists, and the family GP are kept in <span className="font-semibold text-ink-500">Info → Doctors &amp; Specialists</span>.
        </p>
        <div className="card p-5 space-y-4">
          <div>
            <label className="field-label">Medications</label>
            <textarea
              rows={2}
              placeholder="e.g. Metformin 1000mg twice daily, Ventolin inhaler as needed"
              value={medical.medications || ''}
              onChange={(e) => handleFieldChange('medications', e.target.value)}
              onBlur={() => handleFieldBlur('medications')}
              className="field font-sans"
            />
          </div>

          <div>
            <label className="field-label">Preferred pharmacy <span className="normal-case text-ink-300 font-normal">· optional</span></label>
            <input
              type="text"
              placeholder="If different from the household default"
              value={medical.preferredPharmacy || ''}
              onChange={(e) => handleFieldChange('preferredPharmacy', e.target.value)}
              onBlur={() => handleFieldBlur('preferredPharmacy')}
              className="field"
            />
          </div>

          <div>
            <label className="field-label">Surgeries</label>
            <textarea
              rows={2}
              placeholder="e.g. Appendectomy (2015), wisdom tooth extraction (2018), ACL reconstruction (2020)"
              value={medical.surgeries || ''}
              onChange={(e) => handleFieldChange('surgeries', e.target.value)}
              onBlur={() => handleFieldBlur('surgeries')}
              className="field font-sans"
            />
          </div>

          <div>
            <label className="field-label">Family medical history</label>
            <textarea
              rows={2}
              placeholder="e.g. Diabetes (father), heart disease (grandfather), cancer (maternal aunt)"
              value={medical.familyHistory || ''}
              onChange={(e) => handleFieldChange('familyHistory', e.target.value)}
              onBlur={() => handleFieldBlur('familyHistory')}
              className="field font-sans"
            />
          </div>

          <div>
            <label className="field-label">Additional notes</label>
            <textarea
              rows={2}
              placeholder="e.g. Currently undergoing physical therapy, seasonal allergies in spring"
              value={medical.notes || ''}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              onBlur={() => handleFieldBlur('notes')}
              className="field font-sans"
            />
          </div>
        </div>
      </section>

      {/* Vaccinations section */}
      <VaccinationsSection
        vaccinations={medical.vaccinations || []}
        onAdd={handleAddVaccination}
        onUpdate={handleUpdateVaccination}
        onDelete={handleDeleteVaccination}
      />

      {/* Referrals & Results — referral letters, imaging, lab results, specialist
          letters and sick notes. Own component (MemberReferrals.tsx) since it
          carries real Storage-backed files, not just plain fields. */}
      <MemberReferrals member={member} onUpdate={onUpdate} />
    </div>
  );
}

/* ---------------- Vaccinations section ---------------- */

function VaccinationsSection({
  vaccinations,
  onAdd,
  onUpdate,
  onDelete,
}: {
  vaccinations: Vaccination[];
  onAdd: (v: Vaccination) => void;
  onUpdate: (id: string, v: Vaccination) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <h3 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
        <span className="w-1.5 h-3.5 bg-ink-800 rounded-full inline-block"></span>
        Vaccinations
      </h3>
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h3 className="section-label">Vaccination history</h3>
          <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Add vaccination
          </button>
        </div>

        {adding && (
          <VaccinationForm
            onSave={(v) => { onAdd(v); setAdding(false); }}
            onCancel={() => setAdding(false)}
          />
        )}

        {vaccinations.length === 0 && !adding ? (
          <div className="py-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-clay-50 text-clay-600 mb-3">
              <Plus className="w-5 h-5" />
            </div>
            <p className="text-[13px] text-ink-400">No vaccinations recorded — add dates and notes for all vaccines.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {vaccinations.map(v => editId === v.id ? (
              <div key={v.id}>
                <VaccinationForm
                  initial={v}
                  onSave={(upd) => { onUpdate(v.id, upd); setEditId(null); }}
                  onCancel={() => setEditId(null)}
                />
              </div>
            ) : (
              <div key={v.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3 hover:bg-cream-50 hover:border-cream-300 transition-colors">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-ink-900">{v.name || 'Unnamed vaccine'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {v.date && (
                      <span className="chip bg-sage-100 text-sage-700 text-[11px] tabular-nums">{v.date}</span>
                    )}
                  </div>
                  {v.notes && <p className="text-[12px] text-ink-500 mt-1.5">{v.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { setEditId(v.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <ConfirmDeleteButton onConfirm={() => onDelete(v.id)} ariaLabel="Delete this record" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function VaccinationForm({ initial, onSave, onCancel }: {
  initial?: Vaccination;
  onSave: (v: Vaccination) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [date, setDate] = useState(initial?.date || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!name.trim()) { onCancel(); return; }
    onSave({ id: initial?.id || newId(), name: name.trim(), date: date || undefined, notes: notes.trim() || undefined });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="Vaccine name  (e.g. COVID-19, Polio, MMR)" value={name} onChange={e => setName(e.target.value)} />
      <input type="date" className="field" placeholder="Date" value={date} onChange={e => setDate(e.target.value)} />
      <input className="field" placeholder="Notes (optional, e.g. dose 2 of 3)" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}
