import React, { useState, useEffect } from 'react';
import { FamilyMember, TravelInfo, VisaRecord, TransitPass } from '../types';
import {
  Plane, Plus, Trash2, Pencil, Check, X, ShieldCheck, TrainFront, Maximize2,
} from 'lucide-react';
import ShowCardModal from './ShowCardModal';

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

interface MemberTravelProps {
  member: FamilyMember;
  onUpdate: (patch: Partial<FamilyMember>) => void;
}

const initTravel = (member: FamilyMember): TravelInfo => ({
  frequentFlyer: member.travel?.frequentFlyer || '',
  travelInsuranceNumber: member.travel?.travelInsuranceNumber || '',
  etiasStatus: member.travel?.etiasStatus || '',
  emergencyTravelContact: member.travel?.emergencyTravelContact || '',
  preferences: member.travel?.preferences || '',
  visas: member.travel?.visas || [],
  transitPasses: member.travel?.transitPasses || [],
});

/* ---- Expiry chip ---- */
function ExpiryChip({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return null;

  const today = new Date();
  const expiry = new Date(expiryDate);
  const diffMs = expiry.getTime() - today.getTime();

  if (diffMs < 0) {
    return <span className="chip bg-rosa-100 text-rosa-700">Expired</span>;
  }

  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const monthsLeft = diffDays / 30.4375;

  if (monthsLeft <= 6) {
    return <span className="chip bg-honey-100 text-honey-700">Expires soon</span>;
  }

  return <span className="chip bg-sage-100 text-sage-700">Valid</span>;
}

/* ---- Visa form (add / edit) ---- */
function VisaForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: VisaRecord;
  onSave: (v: VisaRecord) => void;
  onCancel: () => void;
}) {
  const [country, setCountry] = useState(initial?.country || '');
  const [number, setNumber] = useState(initial?.number || '');
  const [expiryDate, setExpiryDate] = useState(initial?.expiryDate || '');
  const [permitType, setPermitType] = useState(initial?.permitType || '');
  const [issuingAuthority, setIssuingAuthority] = useState(initial?.issuingAuthority || '');
  const [sponsor, setSponsor] = useState(initial?.sponsor || '');
  const [status, setStatus] = useState<VisaRecord['status'] | ''>(initial?.status || '');
  const [conditions, setConditions] = useState(initial?.conditions || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!country.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      country: country.trim(),
      number: number.trim() || undefined,
      expiryDate: expiryDate || undefined,
      permitType: permitType.trim() || undefined,
      issuingAuthority: issuingAuthority.trim() || undefined,
      sponsor: sponsor.trim() || undefined,
      status: status || undefined,
      conditions: conditions.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input
        autoFocus
        className="field"
        placeholder="Country / territory (e.g. United States)"
        value={country}
        onChange={e => setCountry(e.target.value)}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          className="field font-mono tabular-nums"
          placeholder="Visa / stamp number (optional)"
          value={number}
          onChange={e => setNumber(e.target.value)}
        />
        <input
          type="date"
          className="field"
          title="Expiry date"
          value={expiryDate}
          onChange={e => setExpiryDate(e.target.value)}
        />
      </div>
      {/* Work-permit details — optional, matters most for a foreign employee at
          a multi-location business; a plain travel visa can skip these. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          className="field"
          placeholder="Permit type  (e.g. Critical Skills, Work Visa) — optional"
          value={permitType}
          onChange={e => setPermitType(e.target.value)}
        />
        <select
          className="field"
          value={status}
          onChange={e => setStatus(e.target.value as VisaRecord['status'] | '')}
        >
          <option value="">Status — optional</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="expired">Expired</option>
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          className="field"
          placeholder="Issuing authority — optional"
          value={issuingAuthority}
          onChange={e => setIssuingAuthority(e.target.value)}
        />
        <input
          className="field"
          placeholder="Sponsor / employer of record — optional"
          value={sponsor}
          onChange={e => setSponsor(e.target.value)}
        />
      </div>
      <input
        className="field"
        placeholder="Conditions  (e.g. employer-tied) — optional"
        value={conditions}
        onChange={e => setConditions(e.target.value)}
      />
      <input
        className="field"
        placeholder="Notes (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />
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

/* ---- Transit pass form (add / edit) ---- */
function TransitPassForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: TransitPass;
  onSave: (p: TransitPass) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [operator, setOperator] = useState(initial?.operator || '');
  const [cardNumber, setCardNumber] = useState(initial?.cardNumber || '');
  const [zone, setZone] = useState(initial?.zone || '');
  const [validFrom, setValidFrom] = useState(initial?.validFrom || '');
  const [validUntil, setValidUntil] = useState(initial?.validUntil || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const save = () => {
    if (!name.trim()) { onCancel(); return; }
    onSave({
      id: initial?.id || newId(),
      name: name.trim(),
      operator: operator.trim() || undefined,
      cardNumber: cardNumber.trim() || undefined,
      zone: zone.trim() || undefined,
      validFrom: validFrom || undefined,
      validUntil: validUntil || undefined,
      scanDocId: initial?.scanDocId,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input
        autoFocus
        className="field"
        placeholder="Pass name (e.g. Wiener Linien Jahreskarte)"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          className="field"
          placeholder="Operator (e.g. Wiener Linien)"
          value={operator}
          onChange={e => setOperator(e.target.value)}
        />
        <input
          className="field font-mono tabular-nums"
          placeholder="Card number (optional)"
          value={cardNumber}
          onChange={e => setCardNumber(e.target.value)}
        />
      </div>
      <input
        className="field"
        placeholder="Zone (e.g. Wien Kernzone)"
        value={zone}
        onChange={e => setZone(e.target.value)}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">Valid from</label>
          <input
            type="date"
            className="field"
            title="Valid from"
            value={validFrom}
            onChange={e => setValidFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">Valid until</label>
          <input
            type="date"
            className="field"
            title="Valid until"
            value={validUntil}
            onChange={e => setValidUntil(e.target.value)}
          />
        </div>
      </div>
      <input
        className="field"
        placeholder="Notes (optional)"
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />
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

/* ---- Main component ---- */
export default function MemberTravel({ member, onUpdate }: MemberTravelProps) {
  const [travel, setTravel] = useState<TravelInfo>(() => initTravel(member));
  const [addingVisa, setAddingVisa] = useState(false);
  const [editVisaId, setEditVisaId] = useState<string | null>(null);
  const [addingPass, setAddingPass] = useState(false);
  const [editPassId, setEditPassId] = useState<string | null>(null);
  const [showPass, setShowPass] = useState<TransitPass | null>(null);

  // Reset when selected member changes
  useEffect(() => {
    setTravel(initTravel(member));
    setAddingVisa(false);
    setEditVisaId(null);
    setAddingPass(false);
    setEditPassId(null);
    setShowPass(null);
  }, [member.id]);

  /* Free-text field helpers */
  const setField = <K extends keyof TravelInfo>(key: K, value: TravelInfo[K]) => {
    setTravel(prev => ({ ...prev, [key]: value }));
  };

  const blurField = <K extends keyof TravelInfo>(key: K, value: TravelInfo[K]) => {
    const next = { ...travel, [key]: value };
    setTravel(next);
    onUpdate({ travel: next });
  };

  /* Visa list helpers */
  const saveVisa = (v: VisaRecord) => {
    const visas = travel.visas || [];
    const exists = visas.find(x => x.id === v.id);
    const nextVisas = exists ? visas.map(x => x.id === v.id ? v : x) : [...visas, v];
    const next = { ...travel, visas: nextVisas };
    setTravel(next);
    onUpdate({ travel: next });
    setAddingVisa(false);
    setEditVisaId(null);
  };

  const deleteVisa = (id: string) => {
    const nextVisas = (travel.visas || []).filter(v => v.id !== id);
    const next = { ...travel, visas: nextVisas };
    setTravel(next);
    onUpdate({ travel: next });
  };

  const visas = travel.visas || [];

  /* Transit pass list helpers */
  const savePass = (p: TransitPass) => {
    const passes = travel.transitPasses || [];
    const exists = passes.find(x => x.id === p.id);
    const nextPasses = exists ? passes.map(x => x.id === p.id ? p : x) : [...passes, p];
    const next = { ...travel, transitPasses: nextPasses };
    setTravel(next);
    onUpdate({ travel: next });
    setAddingPass(false);
    setEditPassId(null);
  };

  const deletePass = (id: string) => {
    const nextPasses = (travel.transitPasses || []).filter(p => p.id !== id);
    const next = { ...travel, transitPasses: nextPasses };
    setTravel(next);
    onUpdate({ travel: next });
  };

  const transitPasses = travel.transitPasses || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-cream-200">
        <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0">
          <Plane className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold text-ink-900">
            Travel info
          </h3>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Frequent flyer, insurance, visas, and travel preferences for {member.name}.
          </p>
        </div>
      </div>

      {/* Top fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="field-label">Frequent flyer number</label>
          <input
            type="text"
            className="field font-mono tabular-nums"
            placeholder="e.g. LH 123456789"
            value={travel.frequentFlyer || ''}
            onChange={e => setField('frequentFlyer', e.target.value)}
            onBlur={e => blurField('frequentFlyer', e.target.value)}
          />
        </div>

        <div>
          <label className="field-label">Travel insurance number</label>
          <input
            type="text"
            className="field font-mono tabular-nums"
            placeholder="e.g. TI-98765432"
            value={travel.travelInsuranceNumber || ''}
            onChange={e => setField('travelInsuranceNumber', e.target.value)}
            onBlur={e => blurField('travelInsuranceNumber', e.target.value)}
          />
        </div>

        <div>
          <label className="field-label">ESTA / ETIAS status</label>
          <input
            type="text"
            className="field"
            placeholder="e.g. ESTA approved — expires 2027-03-15"
            value={travel.etiasStatus || ''}
            onChange={e => setField('etiasStatus', e.target.value)}
            onBlur={e => blurField('etiasStatus', e.target.value)}
          />
        </div>

        <div>
          <label className="field-label">Emergency travel contact</label>
          <input
            type="text"
            className="field"
            placeholder="e.g. Rory +43 123 456 789"
            value={travel.emergencyTravelContact || ''}
            onChange={e => setField('emergencyTravelContact', e.target.value)}
            onBlur={e => blurField('emergencyTravelContact', e.target.value)}
          />
        </div>

        <div className="col-span-1 sm:col-span-2">
          <label className="field-label">Travel preferences — seats, meals, etc.</label>
          <textarea
            rows={3}
            className="field font-sans"
            placeholder="e.g. Window seat, vegetarian meal, no middle seats, priority boarding"
            value={travel.preferences || ''}
            onChange={e => setField('preferences', e.target.value)}
            onBlur={e => blurField('preferences', e.target.value)}
          />
        </div>
      </div>

      {/* Visas section */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Visas &amp; work permits
          </h4>
          <button
            onClick={() => { setAddingVisa(true); setEditVisaId(null); }}
            className="btn-primary text-xs px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {addingVisa && (
          <VisaForm
            onSave={saveVisa}
            onCancel={() => setAddingVisa(false)}
          />
        )}

        {visas.length === 0 && !addingVisa ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-2 w-12 h-12 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <p className="text-[13px] text-ink-400">
              No visas added yet — track entry visas, work permits, and tourist stamps here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {visas.map(v =>
              editVisaId === v.id ? (
                <div key={v.id}>
                  <VisaForm
                    initial={v}
                    onSave={saveVisa}
                    onCancel={() => setEditVisaId(null)}
                  />
                </div>
              ) : (
                <div
                  key={v.id}
                  className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-ink-900">{v.country}</p>
                      {v.permitType && <span className="chip bg-cream-200 text-ink-600">{v.permitType}</span>}
                      {v.status && (
                        <span className={`chip ${v.status === 'active' ? 'bg-sage-100 text-sage-700' : v.status === 'pending' ? 'bg-honey-100 text-honey-700' : 'bg-rosa-100 text-rosa-700'} capitalize`}>{v.status}</span>
                      )}
                      <ExpiryChip expiryDate={v.expiryDate} />
                    </div>
                    {v.number && (
                      <p className="font-mono tabular-nums text-[13px] text-ink-600 break-all">{v.number}</p>
                    )}
                    {v.expiryDate && (
                      <p className="tabular-nums text-[12px] text-ink-500">
                        Expires {new Date(v.expiryDate).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </p>
                    )}
                    {(v.issuingAuthority || v.sponsor) && (
                      <p className="text-[12px] text-ink-500">
                        {v.issuingAuthority}{v.issuingAuthority && v.sponsor ? ' · ' : ''}{v.sponsor && `Sponsor: ${v.sponsor}`}
                      </p>
                    )}
                    {v.conditions && (
                      <p className="text-[12px] text-ink-500">{v.conditions}</p>
                    )}
                    {v.notes && (
                      <p className="text-[12px] text-ink-400">{v.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditVisaId(v.id); setAddingVisa(false); }}
                      className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteVisa(v.id)}
                      className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </section>

      {/* Season tickets & travel passes section */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-cream-200">
          <h4 className="section-label flex items-center gap-1.5">
            <TrainFront className="w-3.5 h-3.5" /> Season tickets & travel passes
          </h4>
          <button
            onClick={() => { setAddingPass(true); setEditPassId(null); }}
            className="btn-primary text-xs px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {addingPass && (
          <TransitPassForm
            onSave={savePass}
            onCancel={() => setAddingPass(false)}
          />
        )}

        {transitPasses.length === 0 && !addingPass ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-2 w-12 h-12 rounded-2xl bg-clay-50 text-clay-600 flex items-center justify-center">
              <TrainFront className="w-5 h-5" />
            </div>
            <p className="text-[13px] text-ink-400">
              No season tickets added yet — track a Wiener Linien Jahreskarte, ÖBB Klimaticket, or other travel pass here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {transitPasses.map(p =>
              editPassId === p.id ? (
                <div key={p.id}>
                  <TransitPassForm
                    initial={p}
                    onSave={savePass}
                    onCancel={() => setEditPassId(null)}
                  />
                </div>
              ) : (
                <div
                  key={p.id}
                  className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-ink-900">{p.name}</p>
                      <ExpiryChip expiryDate={p.validUntil} />
                    </div>
                    {p.operator && (
                      <p className="text-[13px] text-ink-600">{p.operator}</p>
                    )}
                    {p.cardNumber && (
                      <p className="font-mono tabular-nums text-[13px] text-ink-600 break-all">{p.cardNumber}</p>
                    )}
                    {p.zone && (
                      <p className="text-[12px] text-ink-500">{p.zone}</p>
                    )}
                    {p.validUntil && (
                      <p className="tabular-nums text-[12px] text-ink-500">
                        Valid until {new Date(p.validUntil).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </p>
                    )}
                    {p.notes && (
                      <p className="text-[12px] text-ink-400">{p.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setShowPass(p)}
                      className="p-1.5 text-ink-400 hover:text-dusk-600 hover:bg-cream-100 rounded-lg flex items-center gap-1 text-[12px] font-medium"
                      title="Show"
                    >
                      <Maximize2 className="w-3.5 h-3.5" /> Show
                    </button>
                    <button
                      onClick={() => { setEditPassId(p.id); setAddingPass(false); }}
                      className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deletePass(p.id)}
                      className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </section>

      <ShowCardModal
        open={!!showPass}
        onClose={() => setShowPass(null)}
        title={showPass?.name || ''}
        subtitle={member.name}
        fields={showPass ? [
          { label: 'Card number', value: showPass.cardNumber || '—', mono: true, big: true },
          { label: 'Zone', value: showPass.zone || '—' },
          {
            label: 'Valid until',
            value: showPass.validUntil
              ? new Date(showPass.validUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              : '—',
          },
        ] : []}
      />
    </div>
  );
}
