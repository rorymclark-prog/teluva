import React, { useState, useEffect, useRef } from 'react';
import { HouseholdInfo, UtilityProvider, BusinessLocation, HomeServiceRecord, HouseholdVendor, VendorTrade } from '../types';
import { loadHousehold, saveHousehold, loadFamilyInfo } from '../utils/db';
import { useSharedDoc } from '../hooks/useSharedDoc';
import EmptyState from './EmptyState';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import {
  Home, Plug, Plus, Trash2, Pencil, Check, X,
  Cloud, CloudOff, MapPin, Building2, KeyRound, Info, Wrench, ShieldCheck,
} from 'lucide-react';

const EMPTY: HouseholdInfo = {
  address: '',
  doorCode: '',
  garageCode: '',
  wifiName: '',
  wifiPassword: '',
  lockBrand: '',
  keyCardNumber: '',
  spareKeyWith: '',
  safeBrand: '',
  safeSerial: '',
  alarmProvider: '',
  alarmCode: '',
  utilities: [],
  vehicles: [],
  pets: [],
  locations: [],
  homeServiceLog: [],
};

// The vendor directory's vocabulary, reused verbatim so a logged job and the
// tradesperson's directory row can never describe the same trade differently.
// Sourced from VendorTrade in types.ts; aiApply.matchVendorTrade maps whatever
// the assistant says onto the same list.
const TRADES: VendorTrade[] = [
  'Plumber', 'Electrician', 'Boiler / heating', 'Locksmith', 'Handyman',
  'Cleaner', 'Gardener', 'Appliance repair', 'Pest control',
  'Neighbour (spare key)', 'Other',
];

const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

interface HouseholdViewProps {
  isBusinessSpace?: boolean;
  refreshKey?: number;
  openAddSignal?: number;
  emberMode?: boolean;
}

export default function HouseholdView({ isBusinessSpace, refreshKey, openAddSignal = 0, emberMode = false }: HouseholdViewProps) {
  const [info, setInfo] = useState<HouseholdInfo>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  // The tradespeople directory lives in the OTHER shared document (Important
  // info → vendors). Read here, never written: it only populates the "who did
  // it" picker on the work log below, so a family that has already filed their
  // plumber doesn't retype the name. A failed load just means a free-text box.
  const [vendors, setVendors] = useState<HouseholdVendor[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await loadHousehold();
      if (active) {
        setInfo(data ? { ...EMPTY, ...data } : EMPTY);
        setLoaded(true);
      }
      const fam = await loadFamilyInfo().catch(() => null);
      if (active && fam?.vendors) setVendors(fam.vendors);
    })();
    return () => { active = false; };
  }, [refreshKey]);

  // Live updates from other family members. Applied silently: the add/edit
  // forms for utilities, vehicles, pets and locations are child components with
  // their own draft state, so refreshing the lists never disturbs a typed form.
  useSharedDoc<HouseholdInfo>('household', (h) => setInfo({ ...EMPTY, ...h }));

  const persist = async (next: HouseholdInfo) => {
    setInfo(next);
    const ok = await saveHousehold(next);
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
      {/* Header */}
      <div className="card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-sage-100 text-sage-700 shrink-0">
            <Home className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink-900">{isBusinessSpace ? 'Locations' : 'Household'}</h2>
            <p className="text-[13px] text-ink-500 font-medium">
              {isBusinessSpace
                ? 'Business premises, access details and utilities — all in one shared place.'
                : 'Property details, utilities and the work log — all in one shared place.'}
            </p>
          </div>
        </div>
      </div>

      {emberMode && (
        <section className="ember-house-scene">
          <div>
            <span className="pulse-eyebrow">{isBusinessSpace ? 'Main place' : 'Our home'}</span>
            <h2>{info.address?.split('\n')[0] || (isBusinessSpace ? 'The main location' : 'Home base')}</h2>
            <p>{info.homeServiceLog?.length ? 'The practical history is here when somebody needs to step in.' : 'Start with one useful detail; the home record can grow slowly.'}</p>
          </div>
          <div className="ember-house-vitals">
            <span><b>{info.utilities?.length || 0}</b><small>utilities connected</small></span>
            <span><b>{info.homeServiceLog?.length || 0}</b><small>jobs remembered</small></span>
            <span><b>{info.wifiName ? 'Ready' : 'Open'}</b><small>home network record</small></span>
          </div>
        </section>
      )}

      {/* Property */}
      <section className="card p-5 space-y-4">
        <div className="flex items-center gap-1.5 pb-3 border-b border-cream-200">
          <h3 className="section-label flex items-center gap-1.5"><Home className="w-3.5 h-3.5" /> {isBusinessSpace ? 'Main location' : 'Property'}</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className="field-label">Address</label>
            <textarea
              className="field resize-none"
              rows={2}
              placeholder="Street, city, postcode…"
              value={info.address ?? ''}
              onChange={(e) => setInfo({ ...info, address: e.target.value })}
              onBlur={() => persist(info)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Door code</label>
              <input
                className="field font-mono"
                type="text"
                placeholder="e.g. #1234"
                value={info.doorCode ?? ''}
                onChange={(e) => setInfo({ ...info, doorCode: e.target.value })}
                onBlur={() => persist(info)}
              />
            </div>
            <div>
              <label className="field-label">Garage code</label>
              <input
                className="field font-mono"
                type="text"
                placeholder="e.g. #5678"
                value={info.garageCode ?? ''}
                onChange={(e) => setInfo({ ...info, garageCode: e.target.value })}
                onBlur={() => persist(info)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label">Wi-Fi network name</label>
              <input
                className="field"
                type="text"
                placeholder="Network SSID"
                value={info.wifiName ?? ''}
                onChange={(e) => setInfo({ ...info, wifiName: e.target.value })}
                onBlur={() => persist(info)}
              />
            </div>
            <div>
              <label className="field-label">Wi-Fi password</label>
              <input
                className="field font-mono"
                type="text"
                placeholder="Password"
                value={info.wifiPassword ?? ''}
                onChange={(e) => setInfo({ ...info, wifiPassword: e.target.value })}
                onBlur={() => persist(info)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Keys, locks & the safe — the "we're locked out and the locksmith is
          asking questions" section. Everything here is deliberately in
          Household rather than on Wills & Estate (which v230 locked to admins
          plus named readers): being at your own front door at 11pm is when
          any adult in the house needs it. */}
      {!isBusinessSpace && (
        <section className="card p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-xl bg-ink-100 text-ink-700 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Keys, locks &amp; the safe</h2>
              <p className="text-[13px] text-ink-400 font-medium">What a locksmith asks for when you&rsquo;re locked out.</p>
            </div>
          </div>

          <div className="rounded-xl bg-cream-50 border border-cream-200 p-3 flex items-start gap-2.5 my-4">
            <Info className="w-4 h-4 text-ink-400 mt-0.5 shrink-0" />
            <p className="text-[12px] text-ink-500 leading-relaxed">
              A locksmith won&rsquo;t cut a copy of a security key without the card number, and can&rsquo;t open a safe
              without its make and serial. Both live on a card in a drawer that nobody can find at 11pm &mdash; so put
              them here. Your locksmith&rsquo;s own number goes with the plumber and electrician, under
              <span className="font-semibold text-ink-600"> Important info</span>.
            </p>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Lock make</label>
                <input
                  className="field"
                  type="text"
                  placeholder="e.g. EVVA, ABUS, Kaba"
                  value={info.lockBrand ?? ''}
                  onChange={(e) => setInfo({ ...info, lockBrand: e.target.value })}
                  onBlur={() => persist(info)}
                />
              </div>
              <div>
                <label className="field-label">Security card number</label>
                <input
                  className="field font-mono"
                  type="text"
                  placeholder="From the Sicherheitskarte"
                  value={info.keyCardNumber ?? ''}
                  onChange={(e) => setInfo({ ...info, keyCardNumber: e.target.value })}
                  onBlur={() => persist(info)}
                />
              </div>
            </div>
            <div>
              <label className="field-label">Who has a spare key</label>
              <input
                className="field"
                type="text"
                placeholder="e.g. Oma, and the neighbour at no. 4"
                value={info.spareKeyWith ?? ''}
                onChange={(e) => setInfo({ ...info, spareKeyWith: e.target.value })}
                onBlur={() => persist(info)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Safe make</label>
                <input
                  className="field"
                  type="text"
                  placeholder="e.g. Burg-Wächter"
                  value={info.safeBrand ?? ''}
                  onChange={(e) => setInfo({ ...info, safeBrand: e.target.value })}
                  onBlur={() => persist(info)}
                />
              </div>
              <div>
                <label className="field-label">Safe serial number</label>
                <input
                  className="field font-mono"
                  type="text"
                  placeholder="Off the plate or the door edge"
                  value={info.safeSerial ?? ''}
                  onChange={(e) => setInfo({ ...info, safeSerial: e.target.value })}
                  onBlur={() => persist(info)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">Alarm company</label>
                <input
                  className="field"
                  type="text"
                  placeholder="Who monitors it"
                  value={info.alarmProvider ?? ''}
                  onChange={(e) => setInfo({ ...info, alarmProvider: e.target.value })}
                  onBlur={() => persist(info)}
                />
              </div>
              <div>
                <label className="field-label">Alarm code</label>
                <input
                  className="field font-mono"
                  type="text"
                  placeholder="To disarm it"
                  value={info.alarmCode ?? ''}
                  onChange={(e) => setInfo({ ...info, alarmCode: e.target.value })}
                  onBlur={() => persist(info)}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Additional locations (business only — a multi-site business tracks
          more than one address; a family only ever needs the one above) */}
      {isBusinessSpace && (
        <LocationsSection
          entries={info.locations ?? []}
          onAdd={(l) => persist({ ...info, locations: [...(info.locations ?? []), l] })}
          onUpdate={(l) => persist({ ...info, locations: (info.locations ?? []).map(x => x.id === l.id ? l : x) })}
          onDelete={(id) => { if (window.confirm('Remove this location? This can’t be undone.')) persist({ ...info, locations: (info.locations ?? []).filter(x => x.id !== id) }); }}
        />
      )}

      {/* Utilities */}
      <UtilitiesSection
        entries={info.utilities ?? []}
        openAddSignal={openAddSignal}
        onAdd={(u) => persist({ ...info, utilities: [...(info.utilities ?? []), u] })}
        onUpdate={(u) => persist({ ...info, utilities: (info.utilities ?? []).map(x => x.id === u.id ? u : x) })}
        onDelete={(id) => { if (window.confirm('Remove this utility? This can’t be undone.')) persist({ ...info, utilities: (info.utilities ?? []).filter(x => x.id !== id) }); }}
      />

      {/* Work done on the property. Not gated on isBusinessSpace — an office
          has a plumber too, and the same question ("who fixed this last time?")
          is asked of premises exactly as it is of a home. */}
      <HomeServiceSection
        entries={info.homeServiceLog ?? []}
        vendors={vendors}
        isBusinessSpace={isBusinessSpace}
        onAdd={(r) => persist({ ...info, homeServiceLog: [...(info.homeServiceLog ?? []), r] })}
        onUpdate={(r) => persist({ ...info, homeServiceLog: (info.homeServiceLog ?? []).map(x => x.id === r.id ? r : x) })}
        onDelete={(id) => persist({ ...info, homeServiceLog: (info.homeServiceLog ?? []).filter(x => x.id !== id) })}
      />

      {/* Vehicles moved to their own dedicated "Vehicles" section (with inspection,
          insurance & service reminders). See VehiclesView. */}

      {/* Pets have their own section (see PetsView) — they are family, not
          household plant, and Household is where you look for a door code.
          The DATA is still HouseholdInfo.pets, saved through this same
          document; only the screen moved. */}

      {/* Footer sync status */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {cloudSynced === false ? (
            <><CloudOff className="w-3.5 h-3.5 text-honey-700" /><span>Saved on this device — not backed up to the cloud</span></>
          ) : (
            <><Cloud className="w-3.5 h-3.5 text-sage-600" /><span>Shared with your {isBusinessSpace ? 'team' : 'family'}{cloudSynced ? ' · synced' : ''}</span></>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Locations (business) ──────────────────────────────────────────────── */

function LocationsSection({ entries, onAdd, onUpdate, onDelete }: {
  entries: BusinessLocation[];
  onAdd: (l: BusinessLocation) => void;
  onUpdate: (l: BusinessLocation) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Additional locations</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <LocationForm
          onSave={(l) => { onAdd(l); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <EmptyState icon={MapPin} title="No other locations yet — branches, sites, warehouses…" />
      ) : (
        <div className="space-y-2.5">
          {entries.map(l => editId === l.id ? (
            <div key={l.id}>
              <LocationForm
                initial={l}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={l.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold text-ink-900 truncate">{l.label || 'Untitled location'}</p>
                  {l.type && <span className="chip bg-cream-200 text-ink-600 capitalize">{l.type}</span>}
                </div>
                <p className="text-[13px] text-ink-600 whitespace-pre-line mt-0.5">{l.address || '—'}</p>
                {l.notes && <p className="text-[12px] text-ink-500 mt-0.5">{l.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(l.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(l.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
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

function LocationForm({ initial, onSave, onCancel }: {
  initial?: BusinessLocation;
  onSave: (l: BusinessLocation) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [type, setType] = useState<BusinessLocation['type']>(initial?.type ?? 'branch');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const [formError, setFormError] = useState<string | null>(null);
  const save = () => {
    if (!label.trim() && !address.trim()) { setFormError('Add a label or an address'); return; }
    setFormError(null);
    onSave({
      id: initial?.id ?? newId(),
      label: label.trim(),
      address: address.trim(),
      type,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input autoFocus className="field" placeholder="Label  (e.g. Cape Town branch)" value={label} onChange={e => setLabel(e.target.value)} />
        <select className="field" value={type} onChange={e => setType(e.target.value as BusinessLocation['type'])}>
          <option value="hq">Head office</option>
          <option value="branch">Branch</option>
          <option value="site">Site</option>
          <option value="other">Other</option>
        </select>
      </div>
      <textarea className="field resize-none" rows={2} placeholder="Street, city, postcode…" value={address} onChange={e => setAddress(e.target.value)} />
      <input className="field" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
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

/* ─── Utilities ─────────────────────────────────────────────────────────── */

function UtilitiesSection({ entries, openAddSignal = 0, onAdd, onUpdate, onDelete }: {
  entries: UtilityProvider[];
  openAddSignal?: number;
  onAdd: (u: UtilityProvider) => void;
  onUpdate: (u: UtilityProvider) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openAddSignal) return;
    setAdding(true);
    setEditId(null);
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [openAddSignal]);

  return (
    <section ref={sectionRef} className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5"><Plug className="w-3.5 h-3.5" /> Utilities</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {adding && (
        <UtilityForm
          onSave={(u) => { onAdd(u); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <EmptyState icon={Plug} title="No utilities yet — electricity, gas, internet, water…" />
      ) : (
        <div className="space-y-2.5">
          {entries.map(u => editId === u.id ? (
            <div key={u.id}>
              <UtilityForm
                initial={u}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={u.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{u.type || 'Utility'}</p>
                <p className="text-[14px] font-semibold text-ink-900 truncate">{u.provider || '—'}</p>
                {u.accountNumber && <p className="font-mono text-[12px] text-ink-500 mt-0.5">Account: {u.accountNumber}</p>}
                {u.notes && <p className="text-[12px] text-ink-500 mt-0.5">{u.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(u.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(u.id)} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
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

/* ─── Work done on the property ──────────────────────────────────────────── */

/**
 * The house's service history — the counterpart to a vehicle's serviceLog.
 *
 * Newest first, because the only question anyone ever brings to this list is
 * "when did we last…" — a chronological-ascending log answers that last.
 *
 * Long lists collapse to the most recent six. A house accumulates decades of
 * this, and a wall of 1998 boiler services buries the one entry from last
 * month that someone actually opened the screen to check.
 */
function HomeServiceSection({ entries, vendors, isBusinessSpace, onAdd, onUpdate, onDelete }: {
  entries: HomeServiceRecord[];
  vendors: HouseholdVendor[];
  isBusinessSpace?: boolean;
  onAdd: (r: HomeServiceRecord) => void;
  onUpdate: (r: HomeServiceRecord) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sorted = [...entries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const visible = showAll ? sorted : sorted.slice(0, 6);
  const place = isBusinessSpace ? 'the premises' : 'the house';
  const today = new Date().toLocaleDateString('en-CA');

  return (
    <section className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> Work done on {place}</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Log work
        </button>
      </div>

      {adding && (
        <HomeServiceForm
          vendors={vendors}
          onSave={(r) => { onAdd(r); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {entries.length === 0 && !adding ? (
        <EmptyState
          icon={Wrench}
          title={`Nothing logged yet — the plumber, the electrician, the boiler service, anyone who's worked on ${place}`}
        />
      ) : (
        <div className="space-y-2.5">
          {visible.map(r => editId === r.id ? (
            <div key={r.id}>
              <HomeServiceForm
                initial={r}
                vendors={vendors}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <div key={r.id} className="p-3.5 rounded-2xl border border-cream-200 bg-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {r.date && <span className="tabular-nums">{r.date}</span>}
                  {r.trade && <span className="text-clay-700">{r.trade}</span>}
                  {r.area && <span>{r.area}</span>}
                </div>
                <p className="text-[14px] font-semibold text-ink-900 mt-0.5">{r.work}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[12px] text-ink-500">
                  {r.by && <span>{r.by}</span>}
                  {r.cost && <span className="font-semibold text-ink-700 tabular-nums">{r.cost}</span>}
                  {/* A guarantee is only worth surfacing while it still runs —
                      an expired one is history, not something to act on. */}
                  {r.warrantyUntil && (
                    r.warrantyUntil >= today
                      ? <span className="text-sage-700 font-medium tabular-nums">Guaranteed to {r.warrantyUntil}</span>
                      : <span className="tabular-nums">Guarantee ended {r.warrantyUntil}</span>
                  )}
                </div>
                {r.notes && <p className="text-[12px] text-ink-500 mt-0.5 italic">“{r.notes}”</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(r.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <ConfirmDeleteButton
                  onConfirm={() => onDelete(r.id)}
                  ariaLabel={`Delete log entry: ${r.work}`}
                  hint="Removes this entry from the history. The tradesperson stays in your vendor list."
                />
              </div>
            </div>
          ))}
          {sorted.length > visible.length && (
            <button onClick={() => setShowAll(true)} className="btn-quiet text-xs px-3 py-1.5 w-full justify-center">
              Show {sorted.length - visible.length} older {sorted.length - visible.length === 1 ? 'entry' : 'entries'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function HomeServiceForm({ initial, vendors, onSave, onCancel }: {
  initial?: HomeServiceRecord;
  vendors: HouseholdVendor[];
  onSave: (r: HomeServiceRecord) => void;
  onCancel: () => void;
}) {
  const [work, setWork] = useState(initial?.work ?? '');
  // Defaults to today rather than blank: work is nearly always logged the day
  // it happened or the evening after, and a blank date sorts the entry to the
  // bottom of a list whose entire purpose is chronology.
  const [date, setDate] = useState(initial?.date ?? new Date().toLocaleDateString('en-CA'));
  const [by, setBy] = useState(initial?.by ?? '');
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? '');
  const [trade, setTrade] = useState<string>(initial?.trade ?? '');
  const [area, setArea] = useState(initial?.area ?? '');
  const [cost, setCost] = useState(initial?.cost ?? '');
  const [warrantyUntil, setWarrantyUntil] = useState(initial?.warrantyUntil ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  // Picking a saved vendor fills the name and trade but leaves both editable —
  // the usual plumber can turn up to do something outside their trade, and the
  // record has to say what actually happened, not what the directory says.
  const pickVendor = (id: string) => {
    setVendorId(id);
    const v = vendors.find(x => x.id === id);
    if (!v) return;
    setBy(v.name);
    if (v.trade) setTrade(v.trade);
  };

  const save = () => {
    if (!work.trim()) { setFormError('Say what was done'); return; }
    setFormError(null);
    // vendorId is dropped when the name has been typed over — a link to Hofer
    // on a record that now reads "his apprentice" is worse than no link.
    const linked = vendors.find(v => v.id === vendorId);
    const keepLink = linked && linked.name.trim().toLowerCase() === by.trim().toLowerCase();
    onSave({
      id: initial?.id ?? newId(),
      date: date || new Date().toLocaleDateString('en-CA'),
      work: work.trim(),
      by: by.trim() || undefined,
      trade: (trade as VendorTrade) || undefined,
      vendorId: keepLink ? vendorId : undefined,
      area: area.trim() || undefined,
      cost: cost.trim() || undefined,
      warrantyUntil: warrantyUntil || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <input autoFocus className="field" placeholder="What was done  (e.g. replaced the boiler valve)" value={work} onChange={e => setWork(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className="field-label">When</label>
          <input type="date" className="field" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Trade</label>
          <select className="field" value={trade} onChange={e => setTrade(e.target.value)}>
            <option value="">—</option>
            {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      {vendors.length > 0 && (
        <div>
          <label className="field-label">Who did it</label>
          <select className="field" value={vendorId} onChange={e => pickVendor(e.target.value)}>
            <option value="">Someone else / type a name below</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.trade ? ` · ${v.trade}` : ''}</option>)}
          </select>
        </div>
      )}
      <input className="field" placeholder={vendors.length ? 'Name (or override the one picked above)' : 'Who did it  (e.g. Installateur Hofer)'} value={by} onChange={e => { setBy(e.target.value); }} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input className="field" placeholder="Where / what  (e.g. Boiler, Roof)" value={area} onChange={e => setArea(e.target.value)} />
        <input className="field" placeholder="Cost" value={cost} onChange={e => setCost(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Guaranteed until (optional)</label>
        <input type="date" className="field" value={warrantyUntil} onChange={e => setWarrantyUntil(e.target.value)} />
      </div>
      <input className="field" placeholder="Notes  (what they said, parts used, what to watch)" value={notes} onChange={e => setNotes(e.target.value)} />
      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

function UtilityForm({ initial, onSave, onCancel }: {
  initial?: UtilityProvider;
  onSave: (u: UtilityProvider) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState(initial?.type ?? '');
  const [provider, setProvider] = useState(initial?.provider ?? '');
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const [formError, setFormError] = useState<string | null>(null);
  const save = () => {
    if (!type.trim() && !provider.trim()) { setFormError('Add a type or a provider'); return; }
    setFormError(null);
    onSave({
      id: initial?.id ?? newId(),
      type: type.trim(),
      provider: provider.trim() || undefined,
      accountNumber: accountNumber.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input autoFocus className="field" placeholder="Type  (e.g. Electricity, Internet)" value={type} onChange={e => setType(e.target.value)} />
        <input className="field" placeholder="Provider  (e.g. Wien Energie)" value={provider} onChange={e => setProvider(e.target.value)} />
      </div>
      <input className="field font-mono" placeholder="Account number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
      <input className="field" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}
