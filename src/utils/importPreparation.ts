import { InboxRequestError, importErrorMessage, type ImportBatchEntry, type ImportInboxItem } from './importInboxClient';
import type { FileOperationScope } from './fileOperationScope';

export interface DraftPreparationProgress {
  id: string;
  name: string;
  status: 'queued' | 'analyzing' | 'ready' | 'failed' | 'skipped' | 'stopped';
  message?: string;
}
export type DraftPreparationOutcome = 'completed' | 'stopped' | 'halted';

/** Only the originals explicitly queued in this panel are eligible. Existing
 * proposals, including manual reviews, must never be overwritten by a batch. */
export function canPrepareImport(entry: ImportBatchEntry, item: ImportInboxItem | undefined, now = Date.now()): boolean {
  if (entry.status !== 'done' || !entry.inboxItemId || !entry.documentId || !item
    || entry.inboxItemId !== item.id || entry.documentId !== item.source.documentId
    || item.status !== 'pending' || item.proposal) return false;
  if (item.analysis.status !== 'running') return true;
  const expiry = Date.parse(item.analysis.leaseUntil || '') || Date.parse(item.analysis.startedAt || '') + 5 * 60_000;
  return Number.isFinite(expiry) && expiry <= now;
}

/** Prepare evidence-backed drafts sequentially using the existing analysis
 * endpoint. There is deliberately no apply/write-to-register capability here. */
export async function prepareImportDrafts(entries: ImportBatchEntry[], options: {
  scope: FileOperationScope;
  getItem: (id: string) => ImportInboxItem | undefined;
  analyze: (id: string, expectedRevision: number) => Promise<ImportInboxItem>;
  onItem: (item: ImportInboxItem) => void;
  onProgress: (progress: DraftPreparationProgress[]) => void;
  isHeld?: (id: string) => boolean;
  stopRequested?: () => boolean;
  now?: () => number;
}): Promise<DraftPreparationOutcome> {
  if (entries.length > 20) throw new Error('Prepare up to 20 selected originals at a time.');
  const unique = entries.filter((entry, index) => entry.inboxItemId && entries.findIndex(other => other.inboxItemId === entry.inboxItemId) === index);
  let progress: DraftPreparationProgress[] = unique.map(entry => {
    const item = options.getItem(entry.inboxItemId!);
    return options.isHeld?.(entry.inboxItemId!)
      ? { id: entry.inboxItemId!, name: entry.name, status: 'skipped', message: 'Your manual review was kept. Save it before preparing this original.' }
      : { id: entry.inboxItemId!, name: entry.name, status: item?.status === 'pending' && item.proposal && item.analysis.status === 'ready' ? 'ready' : 'queued' };
  });
  const publish = () => { options.scope.check(); options.onProgress(progress.map(item => ({ ...item }))); };
  const update = (id: string, status: DraftPreparationProgress['status'], message?: string) => {
    progress = progress.map(item => item.id === id ? { ...item, status, message } : item); publish();
  };
  const stop = (message: string) => { progress = progress.map(item => item.status === 'queued' ? { ...item, status: 'stopped', message } : item); publish(); };
  publish();
  for (const entry of unique) {
    options.scope.check();
    if (options.stopRequested?.()) { stop('Stopped. Your originals and drafts were kept.'); return 'stopped'; }
    if (options.isHeld?.(entry.inboxItemId!)) {
      update(entry.inboxItemId!, 'skipped', 'Your manual review was kept. Save it before preparing this original.'); continue;
    }
    const item = options.getItem(entry.inboxItemId!);
    if (!canPrepareImport(entry, item, options.now?.())) {
      update(entry.inboxItemId!, item?.status === 'pending' && item.proposal && item.analysis.status === 'ready' ? 'ready' : 'skipped', 'Already prepared, being analyzed, or no longer available.'); continue;
    }
    update(item!.id, 'analyzing');
    try {
      const result = await options.scope.step(() => options.analyze(item!.id, item!.revision));
      if (result.id !== item!.id || result.spaceId !== item!.spaceId || result.source.documentId !== entry.documentId) throw new Error('The draft response could not be verified. Refresh your inbox.');
      options.onItem(result);
      if (result.status === 'pending' && result.analysis.status === 'ready' && result.proposal) update(result.id, 'ready');
      else if (result.analysis.status === 'failed') {
        update(result.id, 'failed', result.analysis.error || 'Could not prepare this draft.');
        // Only per-file format/size/readability failures can continue safely.
        // Unknown failures may be an allowance, consent or service problem.
        if (![413, 415, 422].includes(result.analysis.errorStatus || 0)) { stop('Preparation stopped. Check the error before continuing.'); return 'halted'; }
      } else update(result.id, 'skipped', 'This draft changed elsewhere. Its latest state was kept.');
    } catch (error) {
      if (!options.scope.isCurrent()) throw error;
      update(item!.id, 'failed', importErrorMessage(error));
      if (!(error instanceof InboxRequestError) || ![404, 409].includes(error.status)) {
        stop('Preparation stopped. Check the error before continuing.'); return 'halted';
      }
    }
  }
  return 'completed';
}
