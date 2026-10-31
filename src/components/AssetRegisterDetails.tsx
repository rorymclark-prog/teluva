import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Building2, ChevronDown, ClipboardList, Loader2, Plus, RefreshCw, ShieldCheck, Shield, TrendingUp } from 'lucide-react';
import type { AssetItem, AssetWarranty, FinancesInfo, InsurancePolicy } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useSharedDoc } from '../hooks/useSharedDoc';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { demoSpaceType, isDemoMode } from '../utils/demoData';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import { ServiceDocChips, useVaultDocs } from './ServiceDocs';

interface Props {
  item: AssetItem;
  onChange?: (patch: Partial<AssetItem>) => void;
}

const WARRANTY_KINDS: { value: AssetWarranty['kind']; label: string }[] = [
  { value: 'manufacturer', label: 'Manufacturer warranty' },
  { value: 'retailer', label: 'Retailer warranty' },
  { value: 'extended', label: 'Extended warranty' },
];
const PURCHASE_CONTEXT = { consumer: 'Consumer purchase', business: 'Business purchase', unknown: 'Not specified' };
const REMINDER_CHOICES = [90, 30, 14, 7, 1, 0];

/** Adding a record never guesses a legal entitlement, duration or start date. */
export function addAssetWarranty(records: readonly AssetWarranty[], id = crypto.randomUUID()): AssetWarranty[] {
  return [...records, { id, kind: 'manufacturer', reminderDays: [30, 7] }];
}

export function patchAssetWarranty(records: readonly AssetWarranty[], id: string, patch: Partial<AssetWarranty>): AssetWarranty[] {
  return records.map(record => record.id === id ? { ...record, ...patch, id: record.id } : record);
}

function dateLabel(value?: string): string {
  if (!value) return 'Not recorded';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : null;
  const valid = date && Number.isFinite(date.getTime()) && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value;
  return valid
    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
    : value;
}

function Section({ title, note, summary, icon, children, open = false }: {
  title: string; note: string; summary?: string; icon: ReactNode; children: ReactNode; open?: boolean;
}) {
  return <details open={open || undefined} className="group rounded-2xl border border-cream-300 bg-white overflow-hidden">
    <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-clay-500">
      <span className="shrink-0 rounded-xl bg-cream-100 p-2 text-clay-600" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-ink-900">{title}</span>
        <span className="block mt-0.5 text-[11.5px] leading-snug text-ink-500">{summary || note}</span>
      </span>
      <ChevronDown className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="space-y-4 border-t border-cream-200 px-4 py-4">
      {summary && <p className="text-[12px] leading-relaxed text-ink-500">{note}</p>}
      {children}
    </div>
  </details>;
}

function Field({ label, value, onChange, placeholder, type = 'text', multiline = false, hint, invalid = false, min }: {
  label: string; value?: string; onChange?: (value: string) => void; placeholder?: string;
  type?: 'text' | 'date'; multiline?: boolean; hint?: string; invalid?: boolean; min?: string;
}) {
  const id = useId();
  if (!onChange) return <div className="min-w-0">
    <p className="text-[11px] font-semibold text-ink-400">{label}</p>
    <p className={`mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed ${value ? 'text-ink-800' : 'text-ink-400'}`}>
      {type === 'date' ? dateLabel(value) : value || 'Not recorded'}
    </p>
  </div>;
  return <label htmlFor={id} className="block min-w-0">
    <span className="field-label">{label}</span>
    {multiline ? <textarea id={id} rows={3} className="field w-full resize-y" value={value || ''} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
      : <input id={id} type={type} className="field min-h-[44px] w-full" value={value || ''} placeholder={placeholder} min={min} aria-invalid={invalid || undefined} aria-describedby={hint ? `${id}-hint` : undefined} onChange={event => onChange(event.target.value)} />}
    {hint && <span id={`${id}-hint`} className={`mt-1 block text-[11.5px] leading-snug ${invalid ? 'text-rosa-700' : 'text-ink-400'}`}>{hint}</span>}
  </label>;
}

type PolicyOption = Pick<InsurancePolicy, 'id' | 'provider' | 'type' | 'policyNumber' | 'status' | 'coveredAssetIds'>;
function policyOptions(value: FinancesInfo | null): PolicyOption[] {
  return (value?.insurance || []).filter(policy => typeof policy.id === 'string' && policy.id).map(({ id, provider, type, policyNumber, status, coveredAssetIds }) => ({ id, provider, type, policyNumber, status, coveredAssetIds }));
}

function InsuranceFields({ item, onChange, mayRead, business, demo, spaceId, accountUid }: Props & { mayRead: boolean; business: boolean; demo: boolean; spaceId: string | null; accountUid: string | null }) {
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [retry, setRetry] = useState(0);
  const liveVersion = useRef(0);
  const direct = item.insurancePolicyIds || [];
  const listed = policies.filter(policy => policy.coveredAssetIds?.includes(item.id)).map(policy => policy.id);
  const selected = [...new Set([...direct, ...listed])];
  useEffect(() => {
    if (!mayRead || demo) { setPolicies([]); setStatus('ready'); return; }
    if (!spaceId || !accountUid || auth.currentUser?.uid !== accountUid) { setPolicies([]); setStatus('unavailable'); return; }
    let active = true;
    const version = liveVersion.current;
    setStatus('loading');
    // A cached/null fallback cannot distinguish "no policies" from a failed
    // server lookup. Read only the current authorized space and keep failures
    // visible; no bank fields are decrypted or projected into this component.
    void getDocFromServer(doc(db, 'families', spaceId, 'reference', 'finances')).then(snapshot => {
      if (active && auth.currentUser?.uid === accountUid && liveVersion.current === version) {
        setPolicies(policyOptions(snapshot.exists() ? snapshot.data() as FinancesInfo : null));
        setStatus('ready');
      }
    }).catch(() => { if (active && auth.currentUser?.uid === accountUid && liveVersion.current === version) setStatus('unavailable'); });
    return () => { active = false; };
  }, [mayRead, demo, retry, spaceId, accountUid]);
  useSharedDoc<FinancesInfo>('finances', value => {
    liveVersion.current += 1;
    setPolicies(policyOptions(value));
    setStatus('ready');
  }, { disabled: !mayRead || demo });

  const unknown = selected.filter(id => !policies.some(policy => policy.id === id));
  const label = (policy: PolicyOption) => [policy.provider || 'Unnamed insurer', policy.type, policy.policyNumber].filter(Boolean).join(' · ');
  const toggle = (id: string) => {
    if (listed.includes(id)) return;
    onChange?.({ insurancePolicyIds: direct.includes(id) ? direct.filter(value => value !== id) : [...direct, id] });
  };

  return <>
    {!mayRead || demo ? <p className="text-[12px] leading-relaxed text-ink-500">
      {selected.length ? `${selected.length} linked ${selected.length === 1 ? 'policy record' : 'policy records'}. ` : 'No policy details are shown here. '}
      {demo ? 'Insurance records stay outside this preview.' : business ? 'An admin can review and link the business insurance policies.' : 'An adult in this space can review and link insurance policies.'}
    </p> : <>
      {status === 'loading' && <p role="status" className="flex items-center gap-2 text-[12px] text-ink-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading policies…</p>}
      {status === 'unavailable' && <div className="rounded-xl bg-cream-50 p-3 text-[12px] text-ink-500" role="status">
        <p>Policy details could not be loaded. Existing links are kept.</p>
        <button type="button" onClick={() => setRetry(value => value + 1)} className="btn-quiet mt-2 min-h-[44px] text-xs"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry policies</button>
      </div>}
      {policies.length > 0 && <fieldset className="space-y-2">
        <legend className="field-label mb-2">{onChange ? 'Link existing policies' : 'Linked policies'}</legend>
        {(onChange ? policies : policies.filter(policy => selected.includes(policy.id))).map(policy => <label key={policy.id} className={`flex min-h-[44px] items-start gap-3 rounded-xl border p-3 ${selected.includes(policy.id) ? 'border-sage-200 bg-sage-50' : 'border-cream-200 bg-white'} ${onChange ? 'cursor-pointer' : ''}`}>
          {onChange && <input type="checkbox" checked={selected.includes(policy.id)} disabled={status !== 'ready' || listed.includes(policy.id)} onChange={() => toggle(policy.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-clay-600" />}
          <span className="min-w-0 text-[12.5px] leading-relaxed text-ink-700">{label(policy)}
            {policy.status && policy.status !== 'active' && <span className="ml-2 text-[11px] capitalize text-ink-400">{policy.status}</span>}
            {selected.includes(policy.id) && <span className="mt-0.5 block text-[11px] text-ink-500">{listed.includes(policy.id) ? 'Listed on this policy · manage in Insurance' : 'Linked for reference'}</span>}
          </span>
        </label>)}
      </fieldset>}
      {status === 'ready' && policies.length === 0 && <p className="text-[12px] text-ink-400">No policies are recorded in Insurance yet.</p>}
      {!onChange && status === 'ready' && policies.length > 0 && selected.length === 0 && <p className="text-[12px] text-ink-400">No policy linked to this item.</p>}
      {unknown.length > 0 && <div className="space-y-2">
        {unknown.map((id, index) => <div key={id} className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-cream-200 px-3 py-2">
          <span className="text-[12px] text-ink-500">{status === 'ready' ? 'Previously linked policy' : 'Linked policy'}{unknown.length > 1 ? ` ${index + 1}` : ''}{status === 'ready' ? ' · details unavailable' : ''}</span>
          {onChange && <button type="button" onClick={() => toggle(id)} className="btn-quiet min-h-[44px] text-xs" aria-label={`Unlink unavailable policy ${index + 1}`}>Unlink</button>}
        </div>)}
      </div>}
    </>}
    <Field label="Insurance notes for this item" value={item.insuranceNotes} onChange={onChange ? value => onChange({ insuranceNotes: value }) : undefined} multiline placeholder="Item-specific limits, required evidence or where to find the relevant wording" />
  </>;
}

function AssetRegisterDetailsBody({ item, onChange }: Props) {
  const { familyId, uid, spaces, isAdmin, canWrite, loading } = useFamilyCtx();
  const demo = isDemoMode();
  const business = demo ? demoSpaceType() === 'business' : spaces.find(space => space.id === familyId)?.type === 'business';
  const mayReadPolicies = !loading && !!familyId && !!uid && (business ? isAdmin : canWrite);
  const vault = useVaultDocs(demo || loading || !familyId || !uid);
  const warranties = item.warranties || [];
  const update = (id: string, patch: Partial<AssetWarranty>) => onChange?.({ warranties: patchAssetWarranty(warranties, id, patch) });
  const owner = item.ownerName;
  const purchaseSummary = [owner, item.location].filter(Boolean).join(' · ');

  return <div className="space-y-3" data-asset-register-details>
    <Section title="Ownership & purchase details" note="The purchase reference, delivery and return dates behind this item." summary={purchaseSummary || undefined} icon={<Building2 className="h-4 w-4" />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Legal owner" value={owner} onChange={onChange ? value => onChange({ ownerName: value }) : undefined} placeholder={business ? 'Company or person that owns the item' : 'Person or household that owns the item'} />
        <Field label="Where it is kept" value={item.location} onChange={onChange ? value => onChange({ location: value }) : undefined} placeholder={business ? 'North office · meeting room' : 'Living room · upstairs'} />
        <Field label="Order or invoice reference" value={item.purchaseReference} onChange={onChange ? value => onChange({ purchaseReference: value }) : undefined} placeholder="Order, invoice or purchase reference" />
        <Field label="Delivered on" value={item.deliveryDate} type="date" onChange={onChange ? value => onChange({ deliveryDate: value }) : undefined} />
        <Field label="Country of purchase" value={item.purchaseCountry} onChange={onChange ? value => onChange({ purchaseCountry: value }) : undefined} placeholder="Country shown on the purchase records" />
        {onChange ? <label className="block"><span className="field-label">Bought as</span><select className="field min-h-[44px] w-full" value={item.purchaseContext || 'unknown'} onChange={event => onChange({ purchaseContext: event.target.value as AssetItem['purchaseContext'] })}>
          {Object.entries(PURCHASE_CONTEXT).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label> : <Field label="Bought as" value={PURCHASE_CONTEXT[item.purchaseContext || 'unknown']} />}
        <Field label="Retailer contact" value={item.retailerContact} onChange={onChange ? value => onChange({ retailerContact: value }) : undefined} placeholder="Customer service, email or phone" />
        <Field label="Shop return deadline" value={item.returnByDate} type="date" onChange={onChange ? value => onChange({ returnByDate: value }) : undefined} hint="Record the date from the shop’s policy or your paperwork." />
      </div>
    </Section>

    <Section title="Warranties" note="Keep manufacturer, retailer and extended cover as separate records, using the dates and terms in their paperwork." summary={warranties.length ? `${warranties.length} separate ${warranties.length === 1 ? 'warranty record' : 'warranty records'}` : item.warrantyUntil ? `Earlier date recorded · ${dateLabel(item.warrantyUntil)}` : undefined} icon={<ShieldCheck className="h-4 w-4" />}>
      {item.warrantyUntil && <div className="flex items-start gap-2 rounded-xl bg-cream-50 p-3 text-[12px] leading-relaxed text-ink-500"><ClipboardList className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>Earlier warranty date: <span className="font-semibold text-ink-700">{dateLabel(item.warrantyUntil)}</span>. This date is retained alongside the separate records below.</p></div>}
      {warranties.length === 0 && <p className="text-[12px] leading-relaxed text-ink-400">No separate warranty records yet.{onChange ? ' Add the provider and dates from each warranty.' : ''}</p>}
      {warranties.map((warranty, index) => {
        const kind = WARRANTY_KINDS.find(option => option.value === warranty.kind)?.label || 'Warranty';
        const days = warranty.reminderDays || [];
        const choices = [...new Set([...REMINDER_CHOICES, ...days.filter(day => Number.isFinite(day) && day >= 0)])].sort((a, b) => b - a);
        const invalidDates = !!warranty.startDate && !!warranty.endDate && warranty.endDate < warranty.startDate;
        return <fieldset key={warranty.id} className="min-w-0 space-y-4 rounded-xl border border-cream-300 p-3 sm:p-4">
          <legend className="sr-only">{kind} {index + 1}</legend>
          <div className="flex items-start justify-between gap-3"><div><p className="text-[13px] font-semibold text-ink-800">{kind}</p><p className="mt-0.5 text-[11px] text-ink-400">{warranty.provider || `Record ${index + 1}`}</p></div>
            {onChange && <ConfirmDeleteButton onConfirm={() => onChange({ warranties: warranties.filter(record => record.id !== warranty.id) })} ariaLabel={`Remove ${kind.toLowerCase()} ${index + 1}`} hint="Removes this warranty record. Linked evidence documents stay in the Document Vault." />}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {onChange && <label className="block"><span className="field-label">Warranty type</span><select className="field min-h-[44px] w-full" value={warranty.kind} onChange={event => update(warranty.id, { kind: event.target.value as AssetWarranty['kind'] })}>{WARRANTY_KINDS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
            <Field label="Provider" value={warranty.provider} onChange={onChange ? value => update(warranty.id, { provider: value }) : undefined} placeholder="Who provides this warranty" />
            <Field label="Starts on" value={warranty.startDate} type="date" onChange={onChange ? value => update(warranty.id, { startDate: value }) : undefined} />
            <Field label="Ends on" value={warranty.endDate} type="date" onChange={onChange ? value => update(warranty.id, { endDate: value }) : undefined} min={warranty.startDate} invalid={invalidDates} hint={invalidDates ? 'End date is before the start date.' : undefined} />
            <Field label="Warranty reference" value={warranty.reference} onChange={onChange ? value => update(warranty.id, { reference: value }) : undefined} placeholder="Certificate, plan or agreement number" />
            <Field label="Contact" value={warranty.contact} onChange={onChange ? value => update(warranty.id, { contact: value }) : undefined} placeholder="Phone, email or claims contact" />
          </div>
          <Field label="Terms and useful details" value={warranty.terms} onChange={onChange ? value => update(warranty.id, { terms: value }) : undefined} multiline placeholder="The recorded terms, exclusions and what to do if the item needs repair" />
          {onChange ? <fieldset>
            <legend className="field-label">Remind me before the end date</legend>
            <div className="mt-2 flex flex-wrap gap-2">{choices.map(day => <label key={day} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-[12px] ${days.includes(day) ? 'border-clay-300 bg-clay-50 text-clay-700' : 'border-cream-200 text-ink-500'}`}><input type="checkbox" className="h-4 w-4 accent-clay-600" checked={days.includes(day)} onChange={() => update(warranty.id, { reminderDays: days.includes(day) ? days.filter(value => value !== day) : [...days, day].sort((a, b) => b - a) })} />{day === 0 ? 'On end date' : `${day} ${day === 1 ? 'day' : 'days'}`}</label>)}</div>
            {!warranty.endDate && <p className="mt-2 text-[11.5px] text-ink-400">Add an end date to use these reminders.</p>}
            <p className="mt-2 text-[11.5px] text-ink-400">Enable notifications to receive push reminders for the recorded end date.</p>
          </fieldset> : <div><p className="text-[11px] font-semibold text-ink-400">Reminders</p><p className="mt-1 text-[12px] text-ink-700">{days.length ? days.map(day => day === 0 ? 'On the end date' : `${day} days before`).join(' · ') : 'None recorded'}</p></div>}
          <fieldset className="space-y-2">
            <legend className="field-label mb-2">Proof for this warranty</legend>
            {onChange && <>
              <p className="text-[11.5px] leading-relaxed text-ink-500">Attach originals to this item, then choose the paperwork for this warranty.</p>
              <div className="space-y-2">{vault.docs.filter(document => item.documentIds?.includes(document.id)).map(document => <label key={document.id} className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-cream-200 px-3 py-2 text-[12px] text-ink-700">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-clay-600" checked={!!warranty.documentIds?.includes(document.id)} onChange={() => update(warranty.id, { documentIds: warranty.documentIds?.includes(document.id) ? warranty.documentIds.filter(id => id !== document.id) : [...(warranty.documentIds || []), document.id] })} />
                <span className="min-w-0 break-words">{document.name}</span>
              </label>)}</div>
              {!item.documentIds?.length && <p className="text-[11.5px] text-ink-400">No original documents attached to this item yet.</p>}
            </>}
            <ServiceDocChips ids={warranty.documentIds?.filter(id => vault.docs.some(document => document.id === id))} docs={vault.docs} ownerLabel={business ? 'the business' : 'the household'} onRemove={onChange ? id => update(warranty.id, { documentIds: warranty.documentIds?.filter(value => value !== id) }) : undefined} />
            {(warranty.documentIds || []).filter(id => !vault.docs.some(document => document.id === id)).map((id, missingIndex) => <div key={id} className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-cream-200 px-3 py-2">
              <span className="text-[11.5px] text-ink-500">Linked proof document{(warranty.documentIds?.length || 0) > 1 ? ` ${missingIndex + 1}` : ''} · unavailable here</span>
              {onChange && <button type="button" className="btn-quiet min-h-[44px] text-xs" onClick={() => update(warranty.id, { documentIds: warranty.documentIds?.filter(value => value !== id) })} aria-label={`Unlink unavailable warranty proof ${missingIndex + 1}`}>Unlink</button>}
            </div>)}
            {!warranty.documentIds?.length && !onChange && <p className="text-[12px] text-ink-400">No proof document linked to this warranty.</p>}
          </fieldset>
        </fieldset>;
      })}
      {onChange && <button type="button" onClick={() => onChange({ warranties: addAssetWarranty(warranties) })} className="btn-quiet min-h-[44px] w-full justify-center text-xs"><Plus className="h-4 w-4" aria-hidden="true" /> Add warranty</button>}
    </Section>

    <Section title="Insurance links" note="Link the existing policy you would refer to for this item, and keep any item-specific notes together." icon={<Shield className="h-4 w-4" />}>
      <InsuranceFields item={item} onChange={onChange} mayRead={mayReadPolicies} business={business} demo={demo} spaceId={familyId} accountUid={uid} />
    </Section>

    <Section title="Replacement value reference" note="Keep the date and source behind the replacement value recorded for this item." summary={item.replacementValueCheckedAt ? `Last checked ${dateLabel(item.replacementValueCheckedAt)}` : undefined} icon={<TrendingUp className="h-4 w-4" />}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Value checked on" value={item.replacementValueCheckedAt} type="date" onChange={onChange ? value => onChange({ replacementValueCheckedAt: value }) : undefined} />
        <Field label="Source of replacement value" value={item.replacementValueSource} onChange={onChange ? value => onChange({ replacementValueSource: value }) : undefined} placeholder="Retailer, quote, appraisal or product page" />
      </div>
    </Section>
  </div>;
}

/** Remount readers when the account, space or item changes. In-flight policy
 * and vault reads from the previous scope cannot populate the next record. */
export default function AssetRegisterDetails(props: Props) {
  const { familyId, uid } = useFamilyCtx();
  return <div key={`${uid || ''}:${familyId || ''}:${props.item.id}`}><AssetRegisterDetailsBody {...props} /></div>;
}
