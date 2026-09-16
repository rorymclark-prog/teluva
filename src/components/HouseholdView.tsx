import React, { useState, useEffect, useRef } from 'react';
import { HouseholdInfo, UtilityProvider, BusinessLocation, HomeServiceRecord, HouseholdVendor, VendorTrade, MeterReading, IdCountry, AssetItem, VaultDocument } from '../types';
import {
  UTILITY_KINDS, utilityVocabulary, usesSupplySchedule, contractWatch,
  DEFAULT_NOTICE_DAYS, type UtilityKind,
} from '../utils/utilityFields';
import { loadHousehold, saveHousehold, loadFamilyInfo, loadAssets } from '../utils/db';
import { AttachServiceDoc, ServiceDocChips, useVaultDocs } from './ServiceDocs';
import { serviceDocName, serviceVerb, homeEntrySubject, withDocId } from '../utils/serviceDocs';
import { appConfirm } from '../utils/appConfirm';
import { useSharedDoc } from '../hooks/useSharedDoc';
import EmptyState from './EmptyState';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import {
  Home, Plug, Plus, Trash2, Pencil, Check, X,
  Cloud, CloudOff, MapPin, Building2, KeyRound, Info, Wrench, ShieldCheck,
  PhoneCall, Gauge, CalendarClock, AlertTriangle, ChevronDown, ChevronRight, Package,
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
  /** Drives the utility vocabulary — a Zählpunkt in Vienna is an MPAN in Leeds. */
  country?: IdCountry;
  refreshKey?: number;
  openAddSignal?: number;
  emberMode?: boolean;
  /** Demo space: receipts attached to the work log stay in this tab only. */
  demo?: boolean;
}

export default function HouseholdView({ isBusinessSpace, country = 'AT', refreshKey, openAddSignal = 0, emberMode = false, demo = false }: HouseholdViewProps) {
  const [info, setInfo] = useState<HouseholdInfo>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  // The tradespeople directory lives in the OTHER shared document (Important
  // info → vendors). Read here, never written: it only populates the "who did
  // it" picker on the work log below, so a family that has already filed their
  // plumber doesn't retype the name. A failed load just means a free-text box.
  const [vendors, setVendors] = useState<HouseholdVendor[]>([]);
  // Belongings, read-only, for the work log's "Which appliance or item?"
  // picker — Rory: "imagine i had a dishwasher service where do we keep it?".
  // A failed load just means no picker; the log itself never depends on it.
  const [assets, setAssets] = useState<AssetItem[]>([]);
  // The vault, for receipts filed on work-log entries (see ServiceDocs.tsx).
  const vault = useVaultDocs(demo);

  useEffect(() => {
    if (demo) return;
    let active = true;
    loadAssets().then((a) => { if (active) setAssets(a || []); }).catch(() => {});
    return () => { active = false; };
  }, [demo, refreshKey]);

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
            <p>{info.homeServiceLog?.length ? 'The practical history is here when somebody needs to step in.' : (isBusinessSpace ? 'Start with one useful detail; the location record can grow slowly.' : 'Start with one useful detail; the home record can grow slowly.')}</p>
          </div>
          <div className="ember-house-vitals">
            <span><b>{info.utilities?.length || 0}</b><small>utilities connected</small></span>
            <span><b>{info.homeServiceLog?.length || 0}</b><small>jobs remembered</small></span>
            <span><b>{info.wifiName ? 'Ready' : 'Open'}</b><small>{isBusinessSpace ? 'site network record' : 'home network record'}</small></span>
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
          onDelete={async (id) => { if (await appConfirm('Remove this location? This can’t be undone.', { danger: true, confirmLabel: 'Remove' })) persist({ ...info, locations: (info.locations ?? []).filter(x => x.id !== id) }); }}
        />
      )}

      {/* Utilities */}
      <UtilitiesSection
        country={country}
        entries={info.utilities ?? []}
        openAddSignal={openAddSignal}
        onAdd={(u) => persist({ ...info, utilities: [...(info.utilities ?? []), u] })}
        onUpdate={(u) => persist({ ...info, utilities: (info.utilities ?? []).map(x => x.id === u.id ? u : x) })}
        onDelete={async (id) => { if (await appConfirm('Remove this utility? This can’t be undone.', { danger: true, confirmLabel: 'Remove' })) persist({ ...info, utilities: (info.utilities ?? []).filter(x => x.id !== id) }); }}
      />

      {/* Work done on the property. Not gated on isBusinessSpace — an office
          has a plumber too, and the same question ("who fixed this last time?")
          is asked of premises exactly as it is of a home. */}
      <HomeServiceSection
        entries={info.homeServiceLog ?? []}
        vendors={vendors}
        assets={assets}
        docs={vault.docs}
        onAdoptDoc={vault.adopt}
        demo={demo}
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

/**
 * A utility used to be four boxes: type, provider, account number, notes.
 * That is enough to write "Electricity / Wien Energie" and not enough to
 * answer any of the three questions a household actually brings here — the
 * power is off and who do I ring, we are moving and what do they need, the
 * fixed price ends when.
 *
 * See utilityFields.ts for the vocabulary and for why the fault number
 * belongs to the grid operator rather than the supplier. This file only
 * renders it.
 *
 * OLD ROWS MUST KEEP WORKING. Everything past `notes` is optional, `kind` is
 * new alongside the free-text `type` rather than replacing it, and a row
 * saved in 2025 renders exactly as it did.
 */

const KIND_OF = (u: UtilityProvider): UtilityKind => {
  if (u.kind) return u.kind;
  // Infer for a row saved before kinds existed, so it still gets the right
  // labels and the right emergency number. Never written back — inference is
  // a display convenience, and guessing into stored data is how a wrong guess
  // becomes permanent.
  const t = (u.type || '').toLowerCase();
  if (/electric|strom|power|eskom/.test(t)) return 'electricity';
  if (/\bgas\b|erdgas/.test(t)) return 'gas';
  if (/water|wasser|aqua/.test(t)) return 'water';
  if (/heat|fernwärme|wärme/.test(t)) return 'heating';
  if (/internet|broadband|fibre|fiber|telekom|wifi/.test(t)) return 'internet';
  if (/mobile|handy|phone|sim/.test(t)) return 'mobile';
  if (/waste|müll|rubbish|refuse/.test(t)) return 'waste';
  return 'other';
};

const kindLabel = (k: UtilityKind) => UTILITY_KINDS.find(x => x.id === k)?.label || 'Utility';
const telHref = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;

function UtilitiesSection({ entries, country = 'AT', openAddSignal = 0, onAdd, onUpdate, onDelete }: {
  entries: UtilityProvider[];
  country?: IdCountry;
  openAddSignal?: number;
  onAdd: (u: UtilityProvider) => void;
  onUpdate: (u: UtilityProvider) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openAddSignal) return;
    setAdding(true);
    setEditId(null);
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [openAddSignal]);

  /* Contracts that need notice soon, hoisted to the top of the section. The
     whole point of storing an end date is that somebody is told before it
     passes; buried inside a collapsed row it would be told nobody. */
  const dueSoon = entries
    .map(u => ({ u, w: contractWatch(u.contractEnd, u.noticeDays ?? DEFAULT_NOTICE_DAYS) }))
    .filter(x => x.w && (x.w.due || x.w.missed));

  return (
    <section ref={sectionRef} className="card p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-cream-200">
        <h3 className="section-label flex items-center gap-1.5"><Plug className="w-3.5 h-3.5" /> Utilities</h3>
        <button onClick={() => { setAdding(true); setEditId(null); }} className="btn-primary text-xs px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {dueSoon.map(({ u, w }) => (
        <div key={`due-${u.id}`} className="rounded-2xl border border-clay-300 bg-clay-50 px-3.5 py-3">
          <p className="text-[13px] font-bold text-ink-900 flex items-start gap-2">
            <CalendarClock className="w-4 h-4 text-clay-600 shrink-0 mt-0.5" />
            <span>
              {u.provider || kindLabel(KIND_OF(u))}
              {w!.missed
                ? ` — the notice window closed on ${w!.lastNoticeDate}. It will roll over on ${u.contractEnd}.`
                : ` — give notice by ${w!.lastNoticeDate} if you are changing, or it rolls over on ${u.contractEnd}.`}
            </span>
          </p>
        </div>
      ))}

      {adding && (
        <UtilityForm
          country={country}
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
                country={country}
                onSave={(upd) => { onUpdate(upd); setEditId(null); }}
                onCancel={() => setEditId(null)}
              />
            </div>
          ) : (
            <UtilityCard
              key={u.id}
              utility={u}
              country={country}
              open={openId === u.id}
              onToggle={() => setOpenId(openId === u.id ? null : u.id)}
              onEdit={() => { setEditId(u.id); setAdding(false); }}
              onDelete={() => onDelete(u.id)}
              onAddReading={(r) => onUpdate({ ...u, readings: [r, ...(u.readings ?? [])].slice(0, 60) })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** One stored row. Collapsed it answers "who do I ring"; open it has the rest. */
const UtilityCard: React.FC<{
  utility: UtilityProvider;
  country: IdCountry;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddReading: (r: MeterReading) => void;
}> = ({ utility: u, country, open, onToggle, onEdit, onDelete, onAddReading }) => {
  const kind = KIND_OF(u);
  const v = utilityVocabulary(kind, country);
  const watch = contractWatch(u.contractEnd, u.noticeDays ?? DEFAULT_NOTICE_DAYS);
  const readings = u.readings ?? [];
  const [addingReading, setAddingReading] = useState(false);

  /* The national line and the operator's own line are DIFFERENT numbers and
     both can be right. 128 reaches Gasgebrechen anywhere in Austria; your
     Netzbetreiber's Störungsdienst is who fixes your street. Show whichever
     exist, labelled, rather than picking one and hiding the other. */
  const faultChips: Array<{ number: string; label: string }> = [];
  if (v.fault) faultChips.push(v.fault);
  if (u.faultPhone) faultChips.push({ number: u.faultPhone, label: u.gridOperator ? `${u.gridOperator} — faults` : 'Fault line' });

  return (
    <div className="rounded-2xl border border-cream-200 bg-white overflow-hidden">
      <div className="p-3.5 flex items-start justify-between gap-3">
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left cursor-pointer" aria-expanded={open}>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 flex items-center gap-1">
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {u.type?.trim() || kindLabel(kind)}
          </p>
          <p className="text-[14px] font-semibold text-ink-900 truncate">{u.provider || '—'}</p>
          {u.gridOperator && (
            <p className="text-[12px] text-ink-500 mt-0.5 truncate">Network: {u.gridOperator}</p>
          )}
          {u.accountNumber && <p className="font-mono text-[12px] text-ink-500 mt-0.5">Account: {u.accountNumber}</p>}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Always visible, collapsed or not. The moment you need this you are
          standing in the dark and are not going to expand a card. */}
      {faultChips.length > 0 && (
        <div className="px-3.5 pb-3 flex flex-wrap gap-1.5">
          {faultChips.map((f, i) => (
            <a
              key={`${f.number}-${i}`}
              href={telHref(f.number)}
              className="inline-flex items-center gap-1.5 rounded-full bg-rosa-50 border border-rosa-200 text-rosa-700 px-3 py-1.5 text-[12.5px] font-bold hover:bg-rosa-100 cursor-pointer"
            >
              <PhoneCall className="w-3.5 h-3.5" /> {f.number}
              <span className="font-normal text-[11.5px] text-rosa-600 hidden sm:inline">· {f.label}</span>
            </a>
          ))}
        </div>
      )}

      {v.safetyNote && (
        <p className="mx-3.5 mb-3 text-[12px] text-ink-600 flex items-start gap-1.5 rounded-xl bg-cream-50 border border-cream-200 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-clay-600 shrink-0 mt-0.5" /> {v.safetyNote}
        </p>
      )}

      {watch && (
        <div className="px-3.5 pb-3">
          <span className={`chip ${watch.missed ? 'bg-rosa-100 text-rosa-700' : watch.due ? 'bg-clay-100 text-clay-700' : 'bg-cream-100 text-ink-600'}`}>
            <CalendarClock className="w-3 h-3" />
            {watch.daysUntilEnd < 0
              ? `Contract ended ${u.contractEnd}`
              : `${u.contractType === 'fixed' ? 'Fixed' : 'Contract'} until ${u.contractEnd} · notice by ${watch.lastNoticeDate}`}
          </span>
        </div>
      )}

      {open && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-cream-100 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {u.meterPointNumber && (
              <Detail label={v.pointLabel || 'Metering point'} value={u.meterPointNumber} mono
                hint="Belongs to the address — this is the one a switch or a move asks for." />
            )}
            {u.meterNumber && (
              <Detail label={v.meterLabel || 'Meter number'} value={u.meterNumber} mono
                hint="On the meter itself. It changes if the meter is replaced." />
            )}
            {u.meterLocation && <Detail label="Where the meter is" value={u.meterLocation} />}
            {u.supplySchedule && <Detail label="Loadshedding block" value={u.supplySchedule} />}
            {u.tariffName && <Detail label="Tariff" value={u.tariffName} />}
            {typeof u.monthlyAmount === 'number' && (
              <Detail label="Monthly" value={`${u.currency || ''} ${u.monthlyAmount}`.trim()} />
            )}
            {u.supplierPhone && <Detail label="Supplier" value={u.supplierPhone} tel />}
            {u.contractStart && <Detail label="Started" value={u.contractStart} />}
          </div>

          {u.supplierWebsite && (
            <p className="text-[12.5px] break-all">
              <a href={u.supplierWebsite} target="_blank" rel="noopener noreferrer" className="text-clay-600 hover:underline">
                {u.supplierWebsite}
              </a>
            </p>
          )}

          {u.notes && <p className="text-[12.5px] text-ink-600 whitespace-pre-wrap">{u.notes}</p>}

          {/* READINGS. The reason to keep them is an estimated bill you think
              is wrong: two of your own readings and a date beat an argument. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-400 flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" /> Readings
              </p>
              <button onClick={() => setAddingReading(true)} className="btn-quiet text-[11px] px-2.5 py-1">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {addingReading && (
              <ReadingForm
                onSave={(r) => { onAddReading(r); setAddingReading(false); }}
                onCancel={() => setAddingReading(false)}
              />
            )}
            {readings.length === 0 && !addingReading ? (
              <p className="text-[12px] text-ink-400">Nothing noted yet.</p>
            ) : (
              <ul className="space-y-1">
                {readings.slice(0, 6).map(r => (
                  <li key={r.id} className="flex items-center gap-2 text-[12.5px] text-ink-700">
                    <span className="tabular-nums text-ink-400 shrink-0">{r.date}</span>
                    <span className="font-mono font-semibold">{r.value}{r.unit ? ` ${r.unit}` : ''}</span>
                    {r.source === 'estimate' && <span className="chip bg-cream-100 text-ink-500">estimated</span>}
                    {r.source === 'operator' && <span className="chip bg-cream-100 text-ink-500">theirs</span>}
                    {r.note && <span className="text-ink-500 truncate">{r.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function Detail({ label, value, hint, mono, tel }: {
  label: string; value: string; hint?: string; mono?: boolean; tel?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400">{label}</p>
      {tel ? (
        <a href={telHref(value)} className="text-[13px] font-semibold text-clay-600 hover:underline break-all">{value}</a>
      ) : (
        <p className={`text-[13px] text-ink-900 break-all ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</p>
      )}
      {hint && <p className="text-[11px] text-ink-400 leading-snug mt-0.5">{hint}</p>}
    </div>
  );
}

function ReadingForm({ onSave, onCancel }: { onSave: (r: MeterReading) => void; onCancel: () => void }) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [date, setDate] = useState(iso);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [source, setSource] = useState<MeterReading['source']>('self');
  return (
    <div className="p-3 rounded-xl border border-clay-200 bg-clay-50/60 space-y-2 mb-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input type="date" className="field" value={date} onChange={e => setDate(e.target.value)} />
        <input autoFocus className="field font-mono" placeholder="Reading" value={value} onChange={e => setValue(e.target.value)} />
        <input className="field" placeholder="kWh / m³" value={unit} onChange={e => setUnit(e.target.value)} />
        <select className="field" value={source} onChange={e => setSource(e.target.value as MeterReading['source'])}>
          <option value="self">I read it</option>
          <option value="operator">They read it</option>
          <option value="estimate">Estimated</option>
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button
          onClick={() => { if (value.trim()) onSave({ id: newId(), date, value: value.trim(), unit: unit.trim() || undefined, source }); }}
          className="btn-primary text-xs px-3 py-1.5"
        ><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
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
function HomeServiceSection({ entries, vendors, assets, docs, onAdoptDoc, demo, isBusinessSpace, onAdd, onUpdate, onDelete }: {
  entries: HomeServiceRecord[];
  vendors: HouseholdVendor[];
  assets: AssetItem[];
  docs: VaultDocument[];
  onAdoptDoc: (doc: VaultDocument, all?: VaultDocument[]) => void;
  demo: boolean;
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
  const formProps = { vendors, assets, docs, onAdoptDoc, demo };
  const owner = isBusinessSpace ? 'the team' : 'the family';

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
          {...formProps}
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
                {...formProps}
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
                {/* The appliance it was about — only while that item still
                    exists in Belongings (assetId may dangle). */}
                {(() => {
                  const item = r.assetId ? assets.find(a => a.id === r.assetId) : undefined;
                  return item ? (
                    <p className="text-[11.5px] text-ink-500 mt-1 flex items-center gap-1"><Package className="w-3 h-3" /> {item.name}</p>
                  ) : null;
                })()}
                <ServiceDocChips ids={r.docIds} docs={docs} ownerLabel={owner} className="mt-1.5" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(r.id); setAdding(false); }} className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-cream-100 rounded-lg" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <ConfirmDeleteButton
                  onConfirm={() => onDelete(r.id)}
                  ariaLabel={`Delete log entry: ${r.work}`}
                  hint={`Removes this entry from the history. The tradesperson stays in your vendor list${r.docIds?.length ? ', and attached receipts stay in the Document Vault' : ''}.`}
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

function HomeServiceForm({ initial, vendors, assets, docs, onAdoptDoc, demo, onSave, onCancel }: {
  initial?: HomeServiceRecord;
  vendors: HouseholdVendor[];
  assets: AssetItem[];
  docs: VaultDocument[];
  onAdoptDoc: (doc: VaultDocument, all?: VaultDocument[]) => void;
  demo: boolean;
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
  const [docIds, setDocIds] = useState<string[]>(initial?.docIds ?? []);
  const [assetId, setAssetId] = useState(initial?.assetId ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  // Belongings sorted appliances-first: the dishwasher is the likely answer.
  const pickable = [...assets].sort((a, b) =>
    (a.category === 'Appliance' ? 0 : 1) - (b.category === 'Appliance' ? 0 : 1) || a.name.localeCompare(b.name));
  const assetMissing = !!assetId && assets.length > 0 && !assets.some(a => a.id === assetId);

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
    // `...initial` FIRST: this form rebuilds the whole record, and a key it
    // does not list would otherwise be deleted on every edit — which is
    // exactly how a receipt link or an appliance link written by a newer
    // build (or the assistant) would silently vanish. "A forgotten key in a
    // rebuilt shared doc is a DELETE."
    onSave({
      ...initial,
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
      docIds: docIds.length ? docIds : undefined,
      assetId: assetId || undefined,
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
      {(pickable.length > 0 || assetId) && (
        <div>
          <label className="field-label">Which appliance or item? (optional)</label>
          <select className="field" value={assetId} onChange={e => setAssetId(e.target.value)}>
            <option value="">Not about one item</option>
            {assetMissing && <option value={assetId}>An item no longer in Assets</option>}
            {pickable.map(a => <option key={a.id} value={a.id}>{a.name}{a.category ? ` · ${a.category}` : ''}</option>)}
          </select>
          <p className="text-[10.5px] text-ink-400 mt-1">Shows this job in the item’s own service history, in Assets.</p>
        </div>
      )}
      <div className="space-y-1.5">
        <ServiceDocChips ids={docIds} docs={docs} onRemove={(id) => setDocIds(prev => prev.filter(x => x !== id))} />
        <AttachServiceDoc
          docs={docs}
          ids={docIds}
          onAdopt={onAdoptDoc}
          onAttach={(id) => setDocIds(prev => withDocId(prev, id))}
          autoName={() => serviceDocName(
            homeEntrySubject({ id: '', date, work, area, assetId: assetId || undefined }, assets),
            serviceVerb(work),
            date || new Date().toLocaleDateString('en-CA'),
          )}
          demo={demo}
        />
      </div>
      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

function UtilityForm({ initial, country = 'AT', onSave, onCancel }: {
  initial?: UtilityProvider;
  country?: IdCountry;
  onSave: (u: UtilityProvider) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<UtilityKind>(initial ? KIND_OF(initial) : 'electricity');
  const [type, setType] = useState(initial?.type ?? '');
  const [provider, setProvider] = useState(initial?.provider ?? '');
  const [supplierPhone, setSupplierPhone] = useState(initial?.supplierPhone ?? '');
  const [supplierWebsite, setSupplierWebsite] = useState(initial?.supplierWebsite ?? '');
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? '');
  const [gridOperator, setGridOperator] = useState(initial?.gridOperator ?? '');
  const [faultPhone, setFaultPhone] = useState(initial?.faultPhone ?? '');
  const [meterPointNumber, setMeterPointNumber] = useState(initial?.meterPointNumber ?? '');
  const [meterNumber, setMeterNumber] = useState(initial?.meterNumber ?? '');
  const [meterLocation, setMeterLocation] = useState(initial?.meterLocation ?? '');
  const [supplySchedule, setSupplySchedule] = useState(initial?.supplySchedule ?? '');
  const [tariffName, setTariffName] = useState(initial?.tariffName ?? '');
  const [contractType, setContractType] = useState<'' | 'fixed' | 'variable'>(initial?.contractType ?? '');
  const [contractStart, setContractStart] = useState(initial?.contractStart ?? '');
  const [contractEnd, setContractEnd] = useState(initial?.contractEnd ?? '');
  const [noticeDays, setNoticeDays] = useState(initial?.noticeDays != null ? String(initial.noticeDays) : '');
  const [monthlyAmount, setMonthlyAmount] = useState(initial?.monthlyAmount != null ? String(initial.monthlyAmount) : '');
  const [currency, setCurrency] = useState(initial?.currency ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const v = utilityVocabulary(kind, country);
  const [formError, setFormError] = useState<string | null>(null);

  const num = (s: string): number | undefined => {
    const n = Number(s.replace(',', '.'));
    return s.trim() && Number.isFinite(n) ? n : undefined;
  };

  const save = () => {
    if (!provider.trim() && !type.trim() && kind === 'other') { setFormError('Add a name or a type'); return; }
    if (contractEnd && !/^\d{4}-\d{2}-\d{2}$/.test(contractEnd)) { setFormError('Contract end needs to be a full date'); return; }
    setFormError(null);
    onSave({
      id: initial?.id ?? newId(),
      kind,
      // `type` is what an older row displayed and what the assistant writes,
      // so it is kept in step with the picker rather than left to drift.
      type: type.trim() || kindLabel(kind),
      provider: provider.trim() || undefined,
      supplierPhone: supplierPhone.trim() || undefined,
      supplierWebsite: supplierWebsite.trim() || undefined,
      accountNumber: accountNumber.trim() || undefined,
      gridOperator: gridOperator.trim() || undefined,
      faultPhone: faultPhone.trim() || undefined,
      meterPointNumber: meterPointNumber.trim() || undefined,
      meterNumber: meterNumber.trim() || undefined,
      meterLocation: meterLocation.trim() || undefined,
      supplySchedule: supplySchedule.trim() || undefined,
      tariffName: tariffName.trim() || undefined,
      contractType: contractType || undefined,
      contractStart: contractStart || undefined,
      contractEnd: contractEnd || undefined,
      noticeDays: num(noticeDays),
      monthlyAmount: num(monthlyAmount),
      currency: currency.trim() || undefined,
      // Readings belong to the row, not to this form — never drop them.
      readings: initial?.readings,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="p-3.5 rounded-2xl border border-clay-200 bg-clay-50/60 space-y-3.5">
      <div>
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400 mb-1.5">What is it</p>
        <div className="flex flex-wrap gap-1.5">
          {UTILITY_KINDS.map(k => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={`chip cursor-pointer ${kind === k.id ? 'bg-clay-500 text-white' : 'bg-white text-ink-600 border border-cream-200 hover:border-clay-300'}`}
            >{k.label}</button>
          ))}
        </div>
        {kind === 'other' && (
          <input className="field mt-2" placeholder="Call it what you like" value={type} onChange={e => setType(e.target.value)} />
        )}
      </div>

      <FormBlock label="Who you pay" hint={v.supplierHint}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input autoFocus className="field" placeholder={v.supplierLabel} value={provider} onChange={e => setProvider(e.target.value)} />
          <input className="field font-mono" placeholder="Account number" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
          <input className="field" placeholder="Their phone" value={supplierPhone} onChange={e => setSupplierPhone(e.target.value)} />
          <input className="field" placeholder="Their website" value={supplierWebsite} onChange={e => setSupplierWebsite(e.target.value)} />
        </div>
      </FormBlock>

      {/* The half nobody fills in until the day they need it, which is why the
          hint says out loud that this is a different company. */}
      {v.splitSupply && (
        <FormBlock label={v.operatorLabel || 'Network operator'} hint={v.operatorHint}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input className="field" placeholder={v.operatorLabel} value={gridOperator} onChange={e => setGridOperator(e.target.value)} />
            <input className="field" placeholder="Their fault number" value={faultPhone} onChange={e => setFaultPhone(e.target.value)} />
          </div>
          {v.fault && (
            <p className="text-[11.5px] text-ink-500 mt-1.5">
              <b className="text-ink-700">{v.fault.number}</b> — {v.fault.label}. Already on the card; you do not need to type it.
            </p>
          )}
          {v.faultHint && <p className="text-[11.5px] text-ink-500 mt-1.5">{v.faultHint}</p>}
        </FormBlock>
      )}

      {v.splitSupply && (
        <FormBlock label="The numbers on the bill">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <input className="field font-mono w-full" placeholder={v.pointLabel} value={meterPointNumber} onChange={e => setMeterPointNumber(e.target.value)} />
              {v.pointHint && <p className="text-[11px] text-ink-400 leading-snug mt-1">{v.pointHint}</p>}
            </div>
            <div>
              <input className="field font-mono w-full" placeholder={v.meterLabel} value={meterNumber} onChange={e => setMeterNumber(e.target.value)} />
              {v.meterHint && <p className="text-[11px] text-ink-400 leading-snug mt-1">{v.meterHint}</p>}
            </div>
          </div>
          <input className="field mt-2.5" placeholder="Where the meter is (cellar, stairwell, cupboard…)" value={meterLocation} onChange={e => setMeterLocation(e.target.value)} />
          {usesSupplySchedule(country) && kind === 'electricity' && (
            <input className="field mt-2.5" placeholder="Loadshedding block (e.g. Block 7)" value={supplySchedule} onChange={e => setSupplySchedule(e.target.value)} />
          )}
        </FormBlock>
      )}

      <FormBlock
        label="The contract"
        hint="A fixed price that quietly rolls onto a standard tariff is the most expensive thing on this page. Put the end date in and the app will say something before it passes."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input className="field" placeholder="Tariff name" value={tariffName} onChange={e => setTariffName(e.target.value)} />
          <select className="field" value={contractType} onChange={e => setContractType(e.target.value as 'fixed' | 'variable' | '')}>
            <option value="">Fixed or variable?</option>
            <option value="fixed">Fixed price</option>
            <option value="variable">Variable</option>
          </select>
          <label className="text-[11px] text-ink-500">Started
            <input type="date" className="field w-full" value={contractStart} onChange={e => setContractStart(e.target.value)} />
          </label>
          <label className="text-[11px] text-ink-500">Ends
            <input type="date" className="field w-full" value={contractEnd} onChange={e => setContractEnd(e.target.value)} />
          </label>
          <input className="field" type="number" min="0" placeholder={`Notice needed, in days (${DEFAULT_NOTICE_DAYS} if blank)`} value={noticeDays} onChange={e => setNoticeDays(e.target.value)} />
          <div className="grid grid-cols-2 gap-2.5">
            <input className="field" type="number" step="0.01" min="0" placeholder="Monthly" value={monthlyAmount} onChange={e => setMonthlyAmount(e.target.value)} />
            <input className="field" placeholder="EUR / ZAR" value={currency} onChange={e => setCurrency(e.target.value)} />
          </div>
        </div>
      </FormBlock>

      <input className="field" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {formError && <p role="alert" className="text-[11px] text-rosa-600">{formError}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet text-xs px-3 py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
        <button onClick={save} className="btn-primary text-xs px-3 py-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
      </div>
    </div>
  );
}

function FormBlock({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/70 border border-cream-200 p-3">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400">{label}</p>
      {hint && <p className="text-[11.5px] text-ink-500 leading-snug mt-0.5 mb-2">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}
