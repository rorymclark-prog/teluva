import type { AssetItem, AssetWarranty, HouseholdInfo, InsurancePolicy, SlipItem, VaultDocument } from '../types';
import { parseAmount } from './money';
import { fileContentUrl, isFamilyFilePath, normalizeFileReference } from './fileReferences';
import { fetchFileBlob } from './storageClient';
import { isIncidentAsset } from './assetRegister';
import { serviceHistoryForAsset } from './serviceDocs';
export { isIncidentAsset } from './assetRegister';

export type AssetClaimScope = 'all' | 'incident';
export const CLAIM_COVERAGE_NOTE = 'Recorded policies and values are supporting information. Insurance coverage, claim eligibility and payout are not confirmed by this pack.';
export const CLAIM_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
export const CLAIM_PACK_LIMIT_BYTES = 100 * 1024 * 1024;
class ClaimEvidenceLimitError extends Error {}

export interface AssetClaimReferences {
  documents: readonly VaultDocument[];
  slips: readonly SlipItem[];
  policies: readonly InsurancePolicy[];
  household?: HouseholdInfo;
  policyDetailsUnavailable?: boolean;
}

export interface ClaimCurrencyTotal {
  currency: string;
  items: number;
  recordedValue: number;
  unpriced: number;
}

export interface ClaimEvidence {
  kind: 'photo' | 'receipt' | 'document';
  label: string;
  recordId?: string;
  status: 'not checked' | 'included' | 'unavailable';
  archivePath?: string;
  bytes?: number;
  reason?: string;
}

export interface ClaimAssetRecord {
  id: string;
  name: string;
  details: Record<string, string>;
  warranties: Record<string, string>[];
  policies: Record<string, string>[];
  receipts: Record<string, string>[];
  serviceHistory: Record<string, string>[];
  evidence: ClaimEvidence[];
}

export interface AssetClaimManifest {
  format: 'Teluva asset evidence pack';
  version: 1;
  generatedAt: string;
  spaceType: 'family' | 'business';
  scope: AssetClaimScope;
  coverageNote: string;
  valueNote: string;
  totals: ClaimCurrencyTotal[];
  assets: ClaimAssetRecord[];
  warnings: string[];
}

type EvidenceRequest = { asset: ClaimAssetRecord; evidence: ClaimEvidence; source?: string; fileName: string };
type ClaimInput = {
  items: readonly AssetItem[];
  scope: AssetClaimScope;
  references?: AssetClaimReferences;
  isBusinessSpace?: boolean;
  generatedAt?: string;
};

export function scopedClaimAssets(items: readonly AssetItem[], scope: AssetClaimScope): AssetItem[] {
  return scope === 'incident' ? items.filter(isIncidentAsset) : [...items];
}

function amount(raw?: string): number | null {
  if (!raw?.trim() || !/\d/.test(raw) || /[-−]/.test(raw)) return null;
  const parsed = parseAmount(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assetCurrency(item: Pick<AssetItem, 'currency'>): string {
  const currency = item.currency?.trim().toUpperCase();
  return !currency ? 'EUR' : /^[A-Z]{3}$/.test(currency) ? currency : 'Unspecified';
}

export function claimCurrencyTotals(items: readonly AssetItem[]): ClaimCurrencyTotal[] {
  const groups = new Map<string, ClaimCurrencyTotal>();
  for (const item of items) {
    const currency = assetCurrency(item);
    const total = groups.get(currency) || { currency, items: 0, recordedValue: 0, unpriced: 0 };
    const value = amount(item.replacementValue) ?? amount(item.purchasePrice);
    total.items++;
    if (value === null) total.unpriced++;
    else total.recordedValue = Math.round((total.recordedValue + value) * 100) / 100;
    groups.set(currency, total);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function formatClaimMoney(value: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`; }
}

/** Exported records must never carry a live file credential or inline bytes. */
export function claimText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/(?:data:|blob:)[^\s<>"']+/gi, '[file reference omitted]')
    .replace(/(?:https?:\/\/[^\s<>"']+|\/api\/files\/(?:content|connected)\?[^\s<>"']+)/gi, url => {
      if (url.startsWith('/api/files/')) return '[file reference omitted]';
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'firebasestorage.googleapis.com' || parsed.hostname === 'storage.googleapis.com' || parsed.hostname.endsWith('.storage.googleapis.com') || parsed.pathname.startsWith('/api/files/')
          || [...parsed.searchParams.keys()].some(key => /^(token|downloadtoken|access_token|authkey|sig|signature|x-goog-signature|x-amz-signature|x-goog-credential|x-amz-credential)$/i.test(key))) return '[file reference omitted]';
      } catch { /* a malformed public link stays ordinary text */ }
      return url;
    });
}

const record = (values: Record<string, unknown>): Record<string, string> => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, claimText(value)]).filter(([, value]) => value !== ''));
const unique = (values?: readonly string[]) => [...new Set(values || [])];

function warrantyRecord(warranty: AssetWarranty): Record<string, string> {
  return record({ Kind: warranty.kind, Provider: warranty.provider, Start: warranty.startDate, End: warranty.endDate,
    Reference: warranty.reference, Contact: warranty.contact, Terms: warranty.terms,
    'Reminder days': warranty.reminderDays, 'Linked document IDs': unique(warranty.documentIds).join(', ') });
}

function projectClaim(input: ClaimInput): { manifest: AssetClaimManifest; requests: EvidenceRequest[] } {
  const selected = scopedClaimAssets(input.items, input.scope);
  const references = input.references;
  const documentById = new Map(references?.documents.map(document => [document.id, document]));
  const slipById = new Map(references?.slips.map(slip => [slip.id, slip]));
  const policyById = new Map(references?.policies.map(policy => [policy.id, policy]));
  const warnings: string[] = references ? [] : ['Linked document, receipt and policy records have not been checked.'];
  if (references && !references.household) warnings.push('Service history records have not been checked.');
  if (references?.policyDetailsUnavailable) warnings.push('Insurance policy links could not be checked for this account. Coverage is not confirmed.');
  const requests: EvidenceRequest[] = [];
  const assets = selected.map(item => {
    const services = serviceHistoryForAsset(references?.household, item.id);
    const asset: ClaimAssetRecord = {
      id: claimText(item.id), name: claimText(item.name),
      details: record({
        Category: item.category, Make: item.make, Model: item.model,
        'Identifier type': item.identifierType, 'Serial / identifier': item.serialNumber,
        Owner: item.ownerName, 'Assigned to': item.assignedMember, Location: item.location,
        Currency: assetCurrency(item), 'Purchase date': item.purchaseDate, 'Purchase price': item.purchasePrice,
        Seller: item.purchaseLocation, 'Purchase reference': item.purchaseReference, 'Delivery date': item.deliveryDate,
        'Purchase country': item.purchaseCountry, 'Purchase context': item.purchaseContext,
        'Retailer contact': item.retailerContact, 'Return by': item.returnByDate,
        'Replacement value': item.replacementValue, 'Value checked at': item.replacementValueCheckedAt,
        'Value source': item.replacementValueSource, Condition: item.condition,
        'Storage / security': item.storageSecurity, Status: item.status || 'owned', Notes: item.notes,
        'Legacy warranty until': item.warrantyUntil, 'Insurance notes': item.insuranceNotes,
        ...(isIncidentAsset(item) ? { 'Incident type': item.status, 'Incident date': item.incident?.date,
          'Police reference': item.incident?.policeReference, 'Incident notes': item.incident?.notes } : {}),
      }),
      warranties: (item.warranties || []).map(warrantyRecord), policies: [], receipts: [], evidence: [],
      serviceHistory: services.map(service => record({ ID: service.id, Date: service.date, Work: service.work,
        'Carried out by': service.by, Trade: service.trade, Area: service.area, Cost: service.cost,
        'Work warranty until': service.warrantyUntil, Notes: service.notes, 'Linked document IDs': unique(service.docIds).join(', ') })),
    };
    const add = (kind: ClaimEvidence['kind'], label: string, source: string | undefined, fileName: string, recordId?: string, reason?: string) => {
      const evidence: ClaimEvidence = { kind, label: claimText(label), ...(recordId ? { recordId: claimText(recordId) } : {}),
        status: reason ? 'unavailable' : 'not checked', ...(reason ? { reason } : {}) };
      asset.evidence.push(evidence);
      requests.push({ asset, evidence, source, fileName });
    };
    if (item.photoDataUrl) add('photo', 'Primary photo', item.photoDataUrl, 'primary-photo');
    unique(item.photos).filter(source => source !== item.photoDataUrl).forEach((source, index) => add('photo', `Additional photo ${index + 1}`, source, `photo-${index + 1}`));
    if (item.receiptDataUrl) add('receipt', 'Attached receipt', item.receiptDataUrl, 'receipt');
    const documentIds = unique([...(item.documentIds || []), ...(item.warranties || []).flatMap(warranty => warranty.documentIds || []), ...services.flatMap(service => service.docIds || [])]);
    for (const id of documentIds) {
      const document = documentById.get(id);
      const source = document?.downloadUrl || (document?.storagePath && isFamilyFilePath(document.storagePath) ? fileContentUrl(document.storagePath) : undefined);
      add('document', document?.name || `Linked document ${id}`, source, document?.fileName || document?.name || 'document', id,
        !references ? 'Linked records were not checked.' : !document ? 'Linked document record is unavailable.' : !source ? 'The document record has no file attached.' : undefined);
    }
    for (const id of unique(item.slipIds)) {
      const slip = slipById.get(id);
      if (slip) asset.receipts.push(record({ ID: slip.id, Item: slip.item, Seller: slip.shop, Date: slip.purchaseDate, Amount: slip.amount,
        Currency: slip.currency || 'EUR', 'Return by': slip.returnByDate, 'Warranty until': slip.warrantyUntil, Notes: slip.notes }));
      add('receipt', slip ? `Receipt: ${slip.item || slip.shop || id}` : `Linked receipt ${id}`, slip?.photoUrl, `receipt-${slip?.item || id}`, id,
        !references ? 'Linked records were not checked.' : !slip ? 'Linked receipt record is unavailable.' : !slip.photoUrl ? 'The receipt record has no image attached.' : undefined);
    }
    const policyIds = unique([...(item.insurancePolicyIds || []), ...(references?.policies || []).filter(policy => policy.coveredAssetIds?.includes(item.id)).map(policy => policy.id)]);
    for (const id of policyIds) {
      const policy = policyById.get(id);
      if (policy) asset.policies.push(record({ ID: policy.id, Provider: policy.provider, Type: policy.type, 'Policy number': policy.policyNumber,
        Status: policy.status, 'Claims phone': policy.claimsPhone, 'Claims notes': policy.claimsNotes, Broker: policy.broker,
        'Sum insured': policy.sumInsured, Currency: policy.currency || 'EUR', Excess: policy.excess, Notes: policy.notes }));
      else warnings.push(`${asset.name}: linked insurance policy ${claimText(id)} ${references?.policyDetailsUnavailable ? 'is not readable by this account' : 'is unavailable'}. Coverage is not confirmed.`);
    }
    return asset;
  });
  return { requests, manifest: {
    format: 'Teluva asset evidence pack', version: 1, generatedAt: input.generatedAt || new Date().toISOString(),
    spaceType: input.isBusinessSpace ? 'business' : 'family', scope: input.scope,
    coverageNote: CLAIM_COVERAGE_NOTE,
    valueNote: 'Recorded estimates use replacement value when entered, otherwise purchase price. Currencies are separate; no exchange rate or payout calculation is applied. Unpriced items are excluded from totals.',
    totals: claimCurrencyTotals(selected), assets, warnings,
  } };
}

export function assetClaimSummary(input: ClaimInput): AssetClaimManifest { return projectClaim(input).manifest; }

export function claimCsvCell(value: string): string {
  const text = claimText(value);
  const safe = /^[\s\u0000-\u001f\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

const CSV_FIELDS = ['Category', 'Make', 'Model', 'Identifier type', 'Serial / identifier', 'Owner', 'Assigned to', 'Location',
  'Currency', 'Purchase date', 'Purchase price', 'Seller', 'Purchase reference', 'Delivery date', 'Purchase country', 'Purchase context',
  'Retailer contact', 'Return by', 'Replacement value', 'Value checked at', 'Value source', 'Condition', 'Storage / security', 'Status', 'Notes',
  'Legacy warranty until', 'Insurance notes', 'Incident type', 'Incident date', 'Police reference', 'Incident notes'];
const joinedRecords = (values: Record<string, string>[]) => values.map(value => Object.entries(value).map(([key, text]) => `${key}: ${text}`).join('; ')).join('\n');

export function assetClaimCsv(manifest: AssetClaimManifest): string {
  const rows = [['Item', 'Asset ID', ...CSV_FIELDS, 'Warranties', 'Linked insurance policies (coverage unconfirmed)', 'Linked purchase slips', 'Service and repair history', 'Evidence']];
  for (const asset of manifest.assets) rows.push([asset.name, asset.id, ...CSV_FIELDS.map(key => asset.details[key] || ''),
    joinedRecords(asset.warranties), joinedRecords(asset.policies), joinedRecords(asset.receipts), joinedRecords(asset.serviceHistory),
    asset.evidence.map(evidence => `${evidence.label}: ${evidence.status}${evidence.archivePath ? ` (${evidence.archivePath})` : ''}${evidence.reason ? ` — ${evidence.reason}` : ''}`).join('\n')]);
  return '\uFEFF' + rows.map(row => row.map(claimCsvCell).join(',')).join('\r\n');
}

export const escapeClaimHtml = (value: string) => claimText(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function assetClaimHtml(manifest: AssetClaimManifest): string {
  const esc = escapeClaimHtml;
  const details = (values: Record<string, string>) => `<dl>${Object.entries(values).map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
  const list = (title: string, values: Record<string, string>[]) => values.length ? `<h3>${esc(title)}</h3>${values.map(details).join('')}` : '';
  const evidence = manifest.assets.flatMap(asset => asset.evidence);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Asset evidence pack</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#252525;max-width:1000px;margin:auto;padding:32px}h1,h2,h3{line-height:1.2}h2{margin-top:30px}p,li,dd{overflow-wrap:anywhere;white-space:pre-wrap}dl{display:grid;grid-template-columns:minmax(140px,1fr) 3fr;gap:5px 18px;border-bottom:1px solid #ddd;padding:12px 0}dt{font-weight:600}dd{margin:0}.note{padding:15px;background:#f4f1e9;border:1px solid #d7d1c3}.missing{color:#9b2c22}@media print{body{padding:0;font-size:11px}section{break-inside:avoid}a{color:inherit}}</style></head><body>
  <h1>${manifest.spaceType === 'business' ? 'Business' : 'Household'} asset evidence pack</h1>
  <p>Generated ${esc(manifest.generatedAt)} · ${manifest.scope === 'incident' ? 'Stolen, lost or damaged items' : 'All recorded items'} · ${manifest.assets.length} items</p>
  <p class="note">${esc(manifest.coverageNote)}</p><p>${esc(manifest.valueNote)}</p>
  <h2>Recorded values by currency</h2><ul>${manifest.totals.map(total => `<li>${esc(formatClaimMoney(total.recordedValue, total.currency))} · ${total.items} items${total.unpriced ? ` · ${total.unpriced} unpriced` : ''}</li>`).join('')}</ul>
  <p>Evidence: ${evidence.filter(file => file.status === 'included').length} included, ${evidence.filter(file => file.status === 'unavailable').length} unavailable, ${evidence.filter(file => file.status === 'not checked').length} not checked. Original files are separate attachments; this summary does not authenticate them.</p>
  ${manifest.warnings.length ? `<h2>Items to check</h2><ul>${manifest.warnings.map(warning => `<li class="missing">${esc(warning)}</li>`).join('')}</ul>` : ''}
  ${manifest.assets.map(asset => `<section><h2>${esc(asset.name)}</h2><p>Asset ID: ${esc(asset.id)}</p>${details(asset.details)}${list('Warranties as recorded', asset.warranties)}${list('Linked insurance records — coverage unconfirmed', asset.policies)}${list('Linked purchase slips', asset.receipts)}${list('Service and repair history', asset.serviceHistory)}<h3>Evidence</h3>${asset.evidence.length ? `<ul>${asset.evidence.map(file => `<li${file.status === 'unavailable' ? ' class="missing"' : ''}>${esc(file.label)} — ${esc(file.status)}${file.archivePath ? `: <a href="${esc(file.archivePath.split('/').map(encodeURIComponent).join('/'))}">${esc(file.archivePath)}</a>` : ''}${file.reason ? `: ${esc(file.reason)}` : ''}</li>`).join('')}</ul>` : '<p>No evidence is linked to this item.</p>'}</section>`).join('')}
  </body></html>`;
}

export function safeClaimFileName(value: string, fallback = 'file'): string {
  let name = claimText(value).normalize('NFKC').replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  if (!name) name = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  const encoder = new TextEncoder();
  if (encoder.encode(name).length > 120) {
    const extension = /\.[a-z0-9]{1,10}$/i.exec(name)?.[0] || '';
    let prefix = '';
    for (const character of name.slice(0, name.length - extension.length)) {
      if (encoder.encode(prefix + character + extension).length > 120) break;
      prefix += character;
    }
    name = prefix + extension;
  }
  return name;
}

const MIME_EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif', 'text/plain': 'txt', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };

export async function buildAssetClaimArchive(input: ClaimInput & {
  fetchBlob?: (source: string) => Promise<Blob>;
  isCurrent?: () => boolean;
  onProgress?: (finished: number, total: number) => void;
  limits?: { fileBytes?: number; totalBytes?: number };
}): Promise<{ blob: Blob; manifest: AssetClaimManifest; partial: boolean; fileName: string }> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const { manifest, requests } = projectClaim(input);
  const check = () => { if (input.isCurrent && !input.isCurrent()) throw new Error('Your account, space or selected assets changed. Reopen the export and try again.'); };
  const files = new Map<string, { archivePath: string; bytes: number }>();
  let originalBytes = 0;
  const positiveLimit = (value: number | undefined, fallback: number) => Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, fallback) : fallback;
  const fileLimit = positiveLimit(input.limits?.fileBytes, CLAIM_FILE_LIMIT_BYTES);
  const packLimit = positiveLimit(input.limits?.totalBytes, CLAIM_PACK_LIMIT_BYTES);
  const used = new Set<string>();
  const allocate = (path: string) => {
    let name = path, counter = 2;
    while (used.has(name.toLowerCase())) { const dot = path.lastIndexOf('.'); name = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)} (${counter++})${path.slice(dot)}` : `${path} (${counter++})`; }
    used.add(name.toLowerCase()); return name;
  };
  check();
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    check();
    if (request.source && request.evidence.status !== 'unavailable') {
      try {
        const source = normalizeFileReference(request.source);
        let included = files.get(source);
        if (!included) {
          if (originalBytes >= packLimit) throw new ClaimEvidenceLimitError('The archive size limit was reached. Download this original separately from the Vault.');
          const blob = await (input.fetchBlob || fetchFileBlob)(source);
          check();
          if (!blob.size) throw new Error('empty-file');
          if (blob.size > fileLimit) throw new ClaimEvidenceLimitError('This original exceeds the per-file archive size limit. Download it separately from the Vault.');
          if (originalBytes + blob.size > packLimit) throw new ClaimEvidenceLimitError('This original would exceed the archive size limit. Download it separately from the Vault.');
          let fileName = safeClaimFileName(request.fileName);
          if (!/\.[a-z0-9]{1,10}$/i.test(fileName)) fileName += '.' + (MIME_EXT[blob.type.split(';')[0].toLowerCase()] || 'bin');
          const path = allocate(`evidence/${safeClaimFileName(request.asset.name)}-${safeClaimFileName(request.asset.id)}/${fileName}`);
          const bytes = await blob.arrayBuffer();
          check();
          zip.file(path, bytes);
          originalBytes += bytes.byteLength;
          included = { archivePath: path, bytes: bytes.byteLength };
          files.set(source, included);
        }
        Object.assign(request.evidence, { status: 'included', ...included });
      } catch (failure) {
        check();
        request.evidence.status = 'unavailable';
        request.evidence.reason = failure instanceof ClaimEvidenceLimitError ? failure.message : 'The original file could not be downloaded. It may be missing or unreadable by this account. Retry before relying on this evidence.';
      }
    }
    input.onProgress?.(index + 1, requests.length);
  }
  const unavailable = manifest.assets.flatMap(asset => asset.evidence.filter(file => file.status === 'unavailable').map(file => `${asset.name}: ${file.label} — ${file.reason}`));
  const partial = unavailable.length > 0 || manifest.warnings.length > 0;
  zip.file('Summary.html', assetClaimHtml(manifest));
  zip.file('Assets.csv', assetClaimCsv(manifest));
  zip.file('Manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('README.txt', `${partial ? 'PARTIAL EVIDENCE PACK — check the unavailable items below.' : 'Asset evidence pack'}\n\n${manifest.coverageNote}\n${manifest.valueNote}\n\nOpen Summary.html for the readable record, Assets.csv for a spreadsheet, and Manifest.json for structured data. Original files are under evidence/.\n\n${[...manifest.warnings, ...unavailable].join('\n') || 'Every linked file in the selected records was downloaded.'}\n`);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  check();
  return { blob: new Blob([bytes as BlobPart], { type: 'application/zip' }), manifest, partial,
    fileName: `${input.isBusinessSpace ? 'business' : 'household'}-assets-${input.scope === 'incident' ? 'incidents' : 'register'}${partial ? '-PARTIAL' : ''}.zip` };
}
