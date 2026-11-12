import type { PersonalRecordHistoryEntry } from '../types';

export const RECORD_KINDS = { phone: 'Phone number', email: 'Email address', 'medical-aid': 'Medical-aid membership', 'health-insurance': 'Health-insurance number', insurance: 'Insurance membership', other: 'Other reference number' } as const;
export const RECORD_STATUSES = { previous: 'Previous / no longer used', current: 'Still current', unknown: 'Status not confirmed' } as const;
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const limits = { id: 100, value: 200, label: 180, provider: 180, notes: 4000, sourceName: 500, sourceUrl: 2000, evidenceQuote: 2000, startDate: 10, endDate: 10, observedDate: 10 };
export function recordHistoryKey(row: PersonalRecordHistoryEntry): string { return `${row.kind}:${normalize(row.value)}:${normalize(row.provider || '')}:${row.startDate || ''}:${row.endDate || ''}`; }
export function maskedHistoryValue(value: string): string { return value.startsWith('enc:') ? 'Protected value unavailable' : value.length > 4 ? `•••• ${value.slice(-4)}` : '••••'; }
export function safeHistorySource(value?: string): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function validateHistoryRecord(input: unknown, evidenceRequired = false): PersonalRecordHistoryEntry {
  if (!plain(input) || Object.keys(input).some(key => !['kind', 'status', ...Object.keys(limits)].includes(key))) throw Error('Use supported record-history fields.');
  const row: Record<string, string> = {};
  for (const [key, max] of Object.entries(limits)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || input[key].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input[key])) throw Error('A record field is invalid or too long.');
    row[key] = input[key].trim();
  }
  if (!Object.hasOwn(RECORD_KINDS, String(input.kind)) || !Object.hasOwn(RECORD_STATUSES, String(input.status))) throw Error('Choose a record type and status.');
  if (!row.value || row.value.startsWith('enc:')) throw Error('Enter a readable number or reference.');
  if (row.id && !/^[A-Za-z0-9_-]{1,100}$/.test(row.id)) throw Error('The record identifier is invalid.');
  for (const key of ['startDate', 'endDate', 'observedDate']) if (row[key]) {
    const value = row[key]; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw Error('Use a real calendar date or leave it blank.');
  }
  if (row.startDate && row.endDate && row.endDate < row.startDate) throw Error('The end date must be on or after the start date.');
  if (row.sourceUrl && !safeHistorySource(row.sourceUrl)) throw Error('Use an HTTPS source link without credentials.');
  if (evidenceRequired && (!row.sourceName || !row.evidenceQuote || !normalize(row.evidenceQuote).includes(normalize(row.value)))) throw Error('Each imported number needs a named source and an excerpt containing that number.');
  return { ...row, id: row.id || crypto.randomUUID(), kind: input.kind, status: input.status } as PersonalRecordHistoryEntry;
}
export function parseHistoryImport(text: string, memberName: string): PersonalRecordHistoryEntry[] {
  if (new TextEncoder().encode(text).length > 128_000) throw Error('Choose a history file smaller than 128 KB.');
  let data: unknown; try { data = JSON.parse(text); } catch { throw Error('Choose a valid record-history JSON file.'); }
  if (!plain(data) || Object.keys(data).some(key => !['version', 'personName', 'records'].includes(key)) || data.version !== 1 || typeof data.personName !== 'string' || normalize(data.personName) !== normalize(memberName)) throw Error('This file must name the person whose profile is open.');
  if (!Array.isArray(data.records) || !data.records.length || data.records.length > 50) throw Error('Review between 1 and 50 records at a time.');
  // Ignore supplied IDs: a file can append reviewed history, never replace an
  // existing record by choosing its identifier.
  return data.records.map(value => validateHistoryRecord({ ...(plain(value) ? value : {}), id: crypto.randomUUID() }, true));
}
export function appendHistoryRecords(existing: PersonalRecordHistoryEntry[], incoming: PersonalRecordHistoryEntry[]): PersonalRecordHistoryEntry[] {
  const keys = new Set(existing.map(recordHistoryKey)); const result = [...existing];
  for (const row of incoming) if (!keys.has(recordHistoryKey(row))) { result.push(row); keys.add(recordHistoryKey(row)); }
  if (result.length > 200) throw Error('Keep up to 200 history entries per person.');
  return result;
}
