import { useState, useEffect, useMemo } from 'react';
import { Car, Plus, Pencil, Trash2, X, CalendarClock, User, Gauge, ShieldCheck, Wrench, MapPin, Sparkles } from 'lucide-react';
import { FamilyMember, HouseholdInfo, Vehicle, ServiceRecord } from '../types';
import { loadHousehold, saveHousehold } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import RemoteChangeHint from './RemoteChangeHint';
import { vehicleDeadlines, vehicleLabel, VehicleDeadline } from '../utils/vehicle';
import SheetGrabber from './SheetGrabber';

const FUEL_TYPES = ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'Plug-in Hybrid', 'LPG', 'Other'];
const DEADLINE_WINDOW = 42; // days
const newId = () => Date.now().toString() + Math.random().toString(36).slice(2, 8);

const BLANK: Vehicle = {
  id: '', name: '', make: '', model: '', year: '', registration: '', vin: '', fuelType: '',
  assignedMember: '', odometer: '', insurer: '', insuranceNumber: '', insuranceRenewal: '',
  inspectionExpiry: '', vignetteExpiry: '', lastService: '', serviceIntervalMonths: undefined,
  nextServiceDue: '', serviceLog: [], parkingPermit: '', parkingPermitExpiry: '', parkingSpot: '', notes: '',
};

const BLANK_RECORD = { date: '', work: '', odometer: '', cost: '', garage: '', notes: '' };

const DEADLINE_STYLE = (days: number) =>
  days < 0 ? 'bg-rosa-100 text-rosa-700' : days <= DEADLINE_WINDOW ? 'bg-honey-100 text-honey-700' : 'bg-sage-100 text-sage-700';

function deadlineLabel(d: VehicleDeadline): string {
  if (d.days < 0) return `${d.label} overdue by ${Math.abs(d.days)}d`;
  if (d.days === 0) return `${d.label} today`;
  return `${d.label} in ${d.days}d`;
}

export default function VehiclesView(
  { members, canEdit = false, demo = false, refreshKey = 0, canUseAI = false }: { members: FamilyMember[]; canEdit?: boolean; demo?: boolean; refreshKey?: number; canUseAI?: boolean },
) {
  const [household, setHousehold] = useState<HouseholdInfo>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (demo) { setHousehold({ vehicles: [] }); setLoading(false); return; }
    let active = true;
    loadHousehold()
      .then((h) => { if (active) setHousehold(h || {}); })
      .catch(() => { if (active) setHousehold({}); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo, refreshKey]);

  // Live updates for the shared household document (this view owns its
  // `vehicles` array; HouseholdView owns the rest of the same document — the
  // merge in utils/db.ts keeps both). Held while the vehicle form is open.
  const remoteWaiting = useSharedDoc<HouseholdInfo>(
    'household', (h) => setHousehold(h || {}), { hold: isFormOpen, disabled: demo },
  );

  const vehicles = household.vehicles || [];

  const persist = async (next: Vehicle[]) => {
    const nextHousehold: HouseholdInfo = { ...household, vehicles: next };
    setHousehold(nextHousehold);
    if (demo) return; // demo edits stay local
    setSaving(true); setSaveError(null);
    try {
      const ok = await saveHousehold(nextHousehold);
      if (!ok) setSaveError('Saved on this device, but syncing to your family didn’t go through — check your connection.');
    } finally { setSaving(false); }
  };

  const openNew = () => { setEditing({ ...BLANK }); setFormError(null); setIsFormOpen(true); };
  const openEdit = (v: Vehicle) => { setEditing({ ...BLANK, ...v }); setFormError(null); setIsFormOpen(true); };
  const close = () => { setIsFormOpen(false); setEditing(null); setFormError(null); setRecordDraft({ ...BLANK_RECORD }); };
  const patch = (p: Partial<Vehicle>) => setEditing((prev) => (prev ? { ...prev, ...p } : prev));

  // Service & repair log
  const [recordDraft, setRecordDraft] = useState<{ date: string; work: string; odometer: string; cost: string; garage: string; notes: string }>({ ...BLANK_RECORD });
  const addRecord = () => {
    const work = recordDraft.work.trim();
    if (!work) return;
    const rec: ServiceRecord = {
      id: newId(),
      date: recordDraft.date || new Date().toLocaleDateString('en-CA'),
      work,
      odometer: recordDraft.odometer.trim() || undefined,
      cost: recordDraft.cost.trim() || undefined,
      garage: recordDraft.garage.trim() || undefined,
      notes: recordDraft.notes.trim() || undefined,
    };
    setEditing((prev) => {
      if (!prev) return prev;
      const log = [...(prev.serviceLog || []), rec];
      // Logging a service also freshens "last service" so the next-due reminder stays accurate.
      const lastService = (!prev.lastService || rec.date > prev.lastService) ? rec.date : prev.lastService;
      return { ...prev, serviceLog: log, lastService };
    });
    setRecordDraft({ ...BLANK_RECORD });
  };
  const removeRecord = (id: string) => setEditing((prev) => (prev ? { ...prev, serviceLog: (prev.serviceLog || []).filter((r) => r.id !== id) } : prev));

  const handleSave = async () => {
    if (!editing) return;
    const label = (editing.name || editing.make || editing.model || '').trim();
    if (!label) { setFormError('Give the vehicle a name (or a make/model)'); return; }
    setFormError(null);
    const isNew = !editing.id;
    const id = isNew ? newId() : editing.id;
    const toSave: Vehicle = { ...editing, id, name: (editing.name || `${editing.make || ''} ${editing.model || ''}`).trim() };
    const next = isNew ? [...vehicles, toSave] : vehicles.map((v) => (v.id === id ? toSave : v));
    await persist(next);
    close();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this vehicle? This can’t be undone.')) return;
    await persist(vehicles.filter((v) => v.id !== id));
    if (editing?.id === id) close();
  };

  const upcoming = useMemo(() => {
    const rows: { vehicle: Vehicle; deadline: VehicleDeadline }[] = [];
    for (const v of vehicles) {
      for (const d of vehicleDeadlines(v)) {
        if (d.days <= DEADLINE_WINDOW) rows.push({ vehicle: v, deadline: d });
      }
    }
    return rows.sort((a, b) => a.deadline.days - b.deadline.days);
  }, [vehicles]);

  const sorted = useMemo(() => {
    return [...vehicles].sort((a, b) => {
      const da = vehicleDeadlines(a)[0]?.days ?? Infinity;
      const db = vehicleDeadlines(b)[0]?.days ?? Infinity;
      if (da !== db) return da - db;
      return vehicleLabel(a).localeCompare(vehicleLabel(b));
    });
  }, [vehicles]);

  if (loading) {
    return <div className="card flex items-center justify-center py-24"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-clay-500" /></div>;
  }

  const v = editing;

  return (
    <div className="max-w-lg space-y-4">
      {/* Header */}
      <div className="card p-5 sm:p-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-dusk-100 text-dusk-700 shrink-0"><Car className="w-5 h-5" /></div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">Vehicles</h2>
            <p className="text-[13px] text-ink-500 font-medium">{vehicles.length === 0 ? 'No vehicles yet' : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}</p>
          </div>
        </div>
        {canEdit && <button onClick={openNew} className="btn-primary text-xs px-3 py-2 shrink-0"><Plus className="w-3.5 h-3.5" /> Add vehicle</button>}
      </div>

      {saveError && <div className="rounded-xl bg-honey-50 border border-honey-200 text-honey-800 text-[12px] px-4 py-2.5">{saveError}</div>}

      {/* Scan-instead-of-typing hint — only when the assistant (the scan pipeline)
          is actually available. Points to the working path: snap the document in
          the assistant and it extracts the fields / adds the service history. */}
      {canEdit && canUseAI && !demo && (
        <div className="card p-4 sm:p-5 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-clay-50 text-clay-600 shrink-0"><Sparkles className="w-4 h-4" /></div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-800">Scan it instead of typing</p>
            <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">
              Open the assistant (the <span className="font-semibold text-clay-600">✦</span> button, bottom-right) and photograph your <span className="font-medium text-ink-700">registration</span> (Zulassungsschein) to fill in a vehicle, or a <span className="font-medium text-ink-700">service booklet or workshop invoice</span> to add its service history — no re-typing.
            </p>
          </div>
        </div>
      )}

      {/* Deadlines coming up */}
      {upcoming.length > 0 && (
        <div className="card p-4 sm:p-5 space-y-2.5">
          <h3 className="section-label flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" /> Coming up</h3>
          <div className="space-y-2">
            {upcoming.map(({ vehicle, deadline }) => (
              <button key={vehicle.id + deadline.kind} onClick={() => openEdit(vehicle)}
                className={`w-full text-left p-3 rounded-2xl border flex items-start justify-between gap-3 transition-colors ${deadline.days < 0 ? 'bg-rosa-50 border-rosa-100 hover:bg-rosa-100/70' : 'bg-honey-50 border-honey-100 hover:bg-honey-100/70'}`}>
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold ${deadline.days < 0 ? 'text-rosa-700' : 'text-honey-900'}`}>{vehicleLabel(vehicle)}: {deadlineLabel(deadline)}</p>
                  <p className="text-[11.5px] text-ink-500 mt-0.5">{vehicle.registration || 'no plate on file'}</p>
                </div>
                <span className="chip bg-white/70 text-ink-600 shrink-0 tabular-nums">{deadline.date}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Vehicle list */}
      <div className="card overflow-hidden">
        <div className="p-4 sm:p-5">
          {sorted.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-dusk-50 text-dusk-600 flex items-center justify-center"><Car className="w-8 h-8" /></div>
              <p className="text-[14px] font-medium text-ink-700">No vehicles yet</p>
              <p className="text-[12px] text-ink-500 mt-1">Car, motorbike, e-bike… track inspection, insurance &amp; service.</p>
              {canEdit && <button onClick={openNew} className="btn-primary mt-5 text-xs px-4 py-2"><Plus className="w-3.5 h-3.5" /> Add vehicle</button>}
            </div>
          ) : (
            <div className="space-y-1">
              {sorted.map((vehicle) => {
                const soonest = vehicleDeadlines(vehicle)[0];
                return (
                  <button key={vehicle.id} onClick={() => openEdit(vehicle)}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors text-left">
                    <div className="w-10 h-10 rounded-lg bg-dusk-50 text-dusk-600 flex items-center justify-center shrink-0"><Car className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-800 text-[14px] leading-tight truncate">
                        {vehicleLabel(vehicle)}
                        {vehicle.year && <span className="text-ink-400 font-normal"> · {vehicle.year}</span>}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[11px] text-ink-400">
                        {vehicle.registration && <span className="font-mono">{vehicle.registration}</span>}
                        {vehicle.assignedMember && <span className="flex items-center gap-0.5"><User className="w-3 h-3" />{vehicle.assignedMember.split(/\s+/)[0]}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {soonest && <span className={`chip tabular-nums ${DEADLINE_STYLE(soonest.days)}`}>{deadlineLabel(soonest)}</span>}
                      <Pencil className="w-3.5 h-3.5 text-ink-300 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add / edit modal */}
      {isFormOpen && v && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto anim-fade">
          <div className="w-full max-w-lg mt-12 mb-8 rounded-2xl bg-white shadow-xl anim-pop">
            <SheetGrabber onClose={close} />
            <RemoteChangeHint show={remoteWaiting} className="mx-6 mt-4" />
            <div className="flex items-center justify-between p-6 border-b border-cream-200">
              <h3 className="font-display text-lg font-semibold text-ink-900">{v.id ? 'Edit vehicle' : 'New vehicle'}</h3>
              <button onClick={close} className="btn-quiet p-2"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-6 space-y-5">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Name <span className="normal-case text-ink-300 font-normal">· or make/model</span></label>
                  <input type="text" placeholder="e.g. Family car" value={v.name || ''} onChange={(e) => patch({ name: e.target.value })} className="field w-full" />
                  {formError && <p className="text-[11px] text-rosa-600 mt-1">{formError}</p>}
                </div>
                <div>
                  <label className="field-label">Number plate</label>
                  <input type="text" placeholder="e.g. W-12345X" value={v.registration || ''} onChange={(e) => patch({ registration: e.target.value })} className="field w-full font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="field-label">Make</label><input type="text" placeholder="VW" value={v.make || ''} onChange={(e) => patch({ make: e.target.value })} className="field w-full" /></div>
                <div><label className="field-label">Model</label><input type="text" placeholder="Golf" value={v.model || ''} onChange={(e) => patch({ model: e.target.value })} className="field w-full" /></div>
                <div><label className="field-label">Year</label><input type="text" inputMode="numeric" placeholder="2019" value={v.year || ''} onChange={(e) => patch({ year: e.target.value })} className="field w-full tabular-nums" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Fuel</label>
                  <select value={v.fuelType || ''} onChange={(e) => patch({ fuelType: e.target.value })} className="field w-full">
                    <option value="">—</option>
                    {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div><label className="field-label flex items-center gap-1"><Gauge className="w-3 h-3" /> Odometer (km)</label><input type="text" inputMode="numeric" placeholder="e.g. 84000" value={v.odometer || ''} onChange={(e) => patch({ odometer: e.target.value })} className="field w-full tabular-nums" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="field-label">VIN / chassis no.</label><input type="text" placeholder="WVWZZZ…" value={v.vin || ''} onChange={(e) => patch({ vin: e.target.value })} className="field w-full font-mono" /></div>
                <div>
                  <label className="field-label flex items-center gap-1"><User className="w-3 h-3" /> Main driver</label>
                  {members.length > 0 ? (
                    <select value={v.assignedMember || ''} onChange={(e) => patch({ assignedMember: e.target.value })} className="field w-full">
                      <option value="">—</option>
                      {members.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>
                  ) : (
                    <input type="text" placeholder="Name" value={v.assignedMember || ''} onChange={(e) => patch({ assignedMember: e.target.value })} className="field w-full" />
                  )}
                </div>
              </div>

              {/* Deadlines */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" /> Reminders</label>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="field-label">Inspection (§57a / MOT)</label><input type="date" value={v.inspectionExpiry || ''} onChange={(e) => patch({ inspectionExpiry: e.target.value })} className="field w-full" /></div>
                  <div><label className="field-label">Vignette expiry</label><input type="date" value={v.vignetteExpiry || ''} onChange={(e) => patch({ vignetteExpiry: e.target.value })} className="field w-full" /></div>
                </div>
              </div>

              {/* Insurance */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Insurance</label>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="field-label">Insurer</label><input type="text" placeholder="e.g. Allianz" value={v.insurer || ''} onChange={(e) => patch({ insurer: e.target.value })} className="field w-full" /></div>
                  <div><label className="field-label">Policy no.</label><input type="text" value={v.insuranceNumber || ''} onChange={(e) => patch({ insuranceNumber: e.target.value })} className="field w-full font-mono" /></div>
                </div>
                <div><label className="field-label">Renewal date</label><input type="date" value={v.insuranceRenewal || ''} onChange={(e) => patch({ insuranceRenewal: e.target.value })} className="field w-full" /></div>
              </div>

              {/* Parking */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Parking</label>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="field-label">Permit (Parkpickerl)</label><input type="text" placeholder="e.g. Zone 1010" value={v.parkingPermit || ''} onChange={(e) => patch({ parkingPermit: e.target.value })} className="field w-full" /></div>
                  <div><label className="field-label">Permit expiry</label><input type="date" value={v.parkingPermitExpiry || ''} onChange={(e) => patch({ parkingPermitExpiry: e.target.value })} className="field w-full" /></div>
                </div>
                <div><label className="field-label">Spot / location</label><input type="text" placeholder="e.g. Garage bay 14" value={v.parkingSpot || ''} onChange={(e) => patch({ parkingSpot: e.target.value })} className="field w-full" /></div>
              </div>

              {/* Service */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> Service</label>
                <div className="grid grid-cols-[1fr_1fr] gap-4">
                  <div><label className="field-label">Last service</label><input type="date" value={v.lastService || ''} onChange={(e) => patch({ lastService: e.target.value })} className="field w-full" /></div>
                  <div><label className="field-label">Every (months)</label><input type="number" min={0} placeholder="12" value={v.serviceIntervalMonths ?? ''} onChange={(e) => patch({ serviceIntervalMonths: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} className="field w-full tabular-nums" /></div>
                </div>
                <div><label className="field-label">Or a specific next-service date</label><input type="date" value={v.nextServiceDue || ''} onChange={(e) => patch({ nextServiceDue: e.target.value })} className="field w-full" /></div>
              </div>

              {/* Service & repair log */}
              <div className="rounded-2xl border border-cream-200 bg-cream-50/60 p-4 space-y-3">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wider flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> Service &amp; repair log</label>
                {(v.serviceLog || []).length > 0 && (
                  <div className="space-y-2">
                    {[...(v.serviceLog || [])].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((r) => (
                      <div key={r.id} className="flex items-start gap-2 rounded-xl bg-white border border-cream-200 p-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-ink-800">{r.work}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-ink-400">
                            {r.date && <span className="tabular-nums">{r.date}</span>}
                            {r.odometer && <span>{r.odometer} km</span>}
                            {r.garage && <span>· {r.garage}</span>}
                            {r.cost && <span className="text-ink-600 font-medium">{r.cost}</span>}
                          </div>
                          {r.notes && <p className="text-[11.5px] text-ink-500 mt-1 italic">“{r.notes}”</p>}
                        </div>
                        <button type="button" onClick={() => removeRecord(r.id)} className="p-1 text-ink-300 hover:text-rosa-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="rounded-xl bg-white border border-cream-200 p-2.5 space-y-2">
                  <input type="text" placeholder="What was done / the issue (e.g. brake pads replaced)" value={recordDraft.work} onChange={(e) => setRecordDraft({ ...recordDraft, work: e.target.value })} className="field w-full text-[13px]" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={recordDraft.date} onChange={(e) => setRecordDraft({ ...recordDraft, date: e.target.value })} className="field w-full text-[12px]" />
                    <input type="text" inputMode="numeric" placeholder="km" value={recordDraft.odometer} onChange={(e) => setRecordDraft({ ...recordDraft, odometer: e.target.value })} className="field w-full text-[12px] tabular-nums" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="Garage" value={recordDraft.garage} onChange={(e) => setRecordDraft({ ...recordDraft, garage: e.target.value })} className="field w-full text-[12px]" />
                    <input type="text" placeholder="Cost" value={recordDraft.cost} onChange={(e) => setRecordDraft({ ...recordDraft, cost: e.target.value })} className="field w-full text-[12px]" />
                  </div>
                  <input type="text" placeholder="Notes — the mechanic's comments…" value={recordDraft.notes} onChange={(e) => setRecordDraft({ ...recordDraft, notes: e.target.value })} className="field w-full text-[12px]" />
                  <button type="button" onClick={addRecord} disabled={!recordDraft.work.trim()} className="btn-quiet text-[11px] px-3 py-1.5 disabled:opacity-40"><Plus className="w-3 h-3" /> Add to log</button>
                </div>
              </div>

              <div>
                <label className="field-label">Notes</label>
                <textarea rows={2} placeholder="Tyre sizes, service garage, anything else…" value={v.notes || ''} onChange={(e) => patch({ notes: e.target.value })} className="field w-full resize-none" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 p-6 pt-0">
              <div>{v.id && <button onClick={() => handleDelete(v.id)} className="btn-quiet text-rosa-600 hover:text-rosa-700 text-xs px-3 py-2"><Trash2 className="w-3.5 h-3.5" /> Delete</button>}</div>
              <div className="flex items-center gap-3">
                <button onClick={close} className="btn-quiet text-xs px-4 py-2">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-5 py-2 disabled:opacity-60">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
