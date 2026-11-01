import type { AssetItem, VaultCategory } from '../types';

export type ImportProposal = { kind: 'asset'; asset: Partial<AssetItem> } | { kind: 'document'; document: { name: string; category: VaultCategory; docDate?: string; notes?: string } };
export interface ImportInboxItem {
  id: string; spaceId: string; createdBy: string;
  status: 'pending' | 'applied' | 'dismissed';
  source: { documentId?: string; contentHash?: string; sourceName?: string; sourceText?: string };
  proposal?: ImportProposal;
  analysis: { status: 'idle' | 'running' | 'ready' | 'failed'; error?: string; startedAt?: string; leaseUntil?: string; extractedText?: string; evidenceQuotes?: unknown[] };
  revision: number; createdAt: string; updatedAt: string; appliedRecordId?: string;
}
export interface ConnectorGrant { id: string; clientName: string; spaceId: string; scopes: string[]; documentIds: string[]; createdAt: number | string; expiresAt: number | string }
export interface ConnectorRequest { id: string; clientName: string; redirectHost?: string; scopes: string[]; expiresAt: number }
interface User { uid: string; getIdToken: () => Promise<string> }
interface Options { getUser: () => User | null; getSpace: () => string | null; getGeneration?: () => unknown; fetch?: typeof fetch }
export class InboxRequestError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: { candidates?: { id: string; name?: string; serialNumber?: string; model?: string }[] }) { super(message); }
}
export const MCP_URL = 'https://teluva-x3k4bua7pq-nw.a.run.app/mcp';
const spacePattern = /^[A-Za-z0-9_-]{1,128}$/;

/** All calls capture account, visible/selected space and panel generation before
 * token refresh. Neither an old token nor a late JSON response can fill a new view. */
export function createImportInboxClient(options: Options) {
  const request = async <T,>(path: string, method: string, body?: Record<string, unknown>, scoped = true, echo = true): Promise<T> => {
    const user = options.getUser();
    const space = options.getSpace();
    const generation = options.getGeneration?.();
    if (!user) throw new Error('Sign in to continue.');
    if (scoped && (!space || !spacePattern.test(space))) throw new Error('Choose an available space first.');
    const check = () => {
      if (options.getUser()?.uid !== user.uid || options.getSpace() !== space || options.getGeneration?.() !== generation) throw new Error('Your account, space or panel changed. Reopen it before trying again.');
    };
    const token = await user.getIdToken(); check();
    const url = scoped ? `${path}${path.includes('?') ? '&' : '?'}spaceId=${encodeURIComponent(space!)}` : path;
    const response = await (options.fetch || fetch)(url, {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    check();
    const data = await response.json().catch(() => null); check();
    if (!response.ok) {
      const code = typeof data?.code === 'string' ? data.code : typeof data?.error === 'string' ? data.error : undefined;
      const detail = typeof data?.error_description === 'string' ? data.error_description : typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : 'The request could not be completed. Please try again.';
      throw new InboxRequestError(detail, response.status, code, data?.details);
    }
    if (!data || (scoped && echo && data.spaceId !== space)) throw new Error('The space response could not be verified. Reload before trying again.');
    return data as T;
  };
  const itemRoute = (id: string) => `/api/import-inbox/${encodeURIComponent(id)}`;
  return {
    list: () => request<{ spaceId: string; items: ImportInboxItem[] }>('/api/import-inbox', 'GET'),
    create: (input: { documentId?: string; sourceText?: string; sourceName?: string; proposal?: ImportProposal; requestId: string }) => request<{ spaceId: string; item: ImportInboxItem }>('/api/import-inbox', 'POST', input),
    patch: (id: string, proposal: ImportProposal, expectedRevision: number) => request<{ spaceId: string; item: ImportInboxItem }>(itemRoute(id), 'PATCH', { proposal, expectedRevision }),
    act: (id: string, action: 'analyze' | 'apply' | 'dismiss', expectedRevision: number) => request<{ spaceId: string; item: ImportInboxItem }>(`${itemRoute(id)}/${action}`, 'POST', { expectedRevision }),
    connections: () => request<{ spaceId: string; connectors: ConnectorGrant[] }>('/api/connectors', 'GET'),
    revoke: (id: string) => request<{ ok: boolean }>(`/api/connectors/${encodeURIComponent(id)}`, 'DELETE', undefined, true, false),
    authorization: (id: string) => request<ConnectorRequest>(`/api/connectors/authorization/${encodeURIComponent(id)}`, 'GET', undefined, false),
    decide: (id: string, input: { approve: boolean; spaceId?: string; documentIds?: string[]; scopes?: string[] }) => request<{ redirectUrl: string }>(`/api/connectors/authorization/${encodeURIComponent(id)}`, 'POST', input, false),
  };
}

/** Keep redirects on the OAuth callback paths supported by the server, including
 * explicit-port local MCP clients. No relative URLs, credentials or lookalikes. */
export function validatedConnectorRedirect(value: string, expectedHost?: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('The connector returned an invalid callback.'); }
  const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && !!url.port && url.pathname.startsWith('/');
  const hosted = url.protocol === 'https:' && !url.port && (
    (url.hostname === 'claude.ai' && url.pathname === '/api/mcp/auth_callback') ||
    (url.hostname === 'chatgpt.com' && (url.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname)))
  );
  if ((!hosted && !loopback) || url.username || url.password || url.hash || (expectedHost && expectedHost !== url.host && expectedHost !== url.hostname)) throw new Error('The connector callback could not be verified. Return to the chatbot and reconnect.');
  return url.href;
}
export function importStatusLabel(item: ImportInboxItem): string {
  if (item.status === 'applied') return 'Added';
  if (item.status === 'dismissed') return 'Dismissed';
  if (item.analysis.status === 'running') {
    const lease = Date.parse(item.analysis.leaseUntil || '') || (Date.parse(item.analysis.startedAt || '') + 5 * 60_000);
    return Number.isFinite(lease) && lease <= Date.now() ? 'Analysis can be retried' : 'Analyzing';
  }
  if (item.analysis.status === 'failed') return 'Needs attention';
  return item.proposal ? 'Ready to review' : 'Awaiting review';
}
export function importErrorMessage(error: unknown): string {
  if (error instanceof InboxRequestError && (error.code === 'SOURCE_CHANGED' || error.message.includes('SOURCE_CHANGED'))) return 'The source document changed. Analyze it again before adding a record.';
  if (error instanceof InboxRequestError && (error.code === 'DUPLICATE_ASSET' || error.message.includes('DUPLICATE_ASSET'))) return 'A matching asset already exists. Review the matching records below; this import has not overwritten them.';
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
}

export interface ImportBatchEntry { id: string; name: string; requestId: string; file?: File; documentId?: string; status: 'queued' | 'uploading' | 'saving' | 'done' | 'error'; error?: string }
/** Sequential bounded intake keeps each original and idempotency key after a
 * partial failure. A retry never uploads bytes again when they already saved. */
export async function processImportBatch(entries: ImportBatchEntry[], options: {
  scope: { check: () => void; isCurrent: () => boolean; step: <T>(fn: () => T | Promise<T>) => Promise<T> };
  upload: (file: File) => Promise<string>;
  create: (input: { documentId: string; requestId: string }) => Promise<ImportInboxItem>;
  onEntry: (entry: ImportBatchEntry) => void;
  onItem: (item: ImportInboxItem) => void;
}): Promise<void> {
  if (entries.length > 20) throw new Error('Choose up to 20 originals per batch.');
  for (const original of entries) {
    options.scope.check();
    if (original.status === 'done') continue;
    let entry = { ...original, error: undefined };
    const update = (patch: Partial<ImportBatchEntry>) => { options.scope.check(); entry = { ...entry, ...patch }; options.onEntry(entry); };
    try {
      if (!entry.documentId) {
        if (!entry.file) throw new Error('Choose the original file again.');
        update({ status: 'uploading' });
        const documentId = await options.scope.step(() => options.upload(entry.file!));
        update({ documentId });
      }
      update({ status: 'saving' });
      const item = await options.scope.step(() => options.create({ documentId: entry.documentId!, requestId: entry.requestId }));
      options.onItem(item); update({ status: 'done' });
    } catch (error) {
      if (!options.scope.isCurrent()) throw error;
      update({ status: 'error', error: importErrorMessage(error) });
    }
  }
}
