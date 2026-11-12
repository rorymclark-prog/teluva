/** Device-local recovery, never localStorage or an unload-only backup. */
export interface ScanScope { uid: string; spaceId: string }
export interface ScanDraftFile { data: string; name: string; type: string; size: number; draftId?: string }
export interface ScanDraftPage { id: number; image: string; original: string; originalName?: string }
export interface ScanSnapshot {
  pickedType: 'id' | 'passport' | 'document' | null;
  pages: ScanDraftPage[];
  originalCapture: string | null;
  originalName?: string;
  pristinePhoto: string | null;
  capturedPhoto: string | null;
  turns: number;
  enhanceMode: 'off' | 'color' | 'grayscale' | 'bw';
  side: 'front' | 'back';
  sourceFile?: ScanDraftFile;
  file?: ScanDraftFile;
}
export interface ScanDraftSummary {
  key: string; scope: string; id: string; title: string; updatedAt: string;
  pages: number; ready: boolean; fileName?: string;
}
interface StoredDraft extends ScanDraftSummary { writer: string; snapshot: ScanSnapshot }
export const SCAN_DRAFT_EVENT = 'teluva-scan-drafts-changed';
const DB_NAME = 'teluva-scan-drafts';
export const emptyScan = (): ScanSnapshot => ({ pickedType: null, pages: [], originalCapture: null, pristinePhoto: null, capturedPhoto: null, turns: 0, enhanceMode: 'color', side: 'front' });
export const scanScopeKey = (scope: ScanScope) => JSON.stringify([scope.uid, scope.spaceId]);
const keyFor = (scope: ScanScope, id: string) => JSON.stringify([scope.uid, scope.spaceId, id]);
const hasCapture = (s: ScanSnapshot) => !!(s.pages.length || s.originalCapture || s.sourceFile || s.file);

function storageError(error?: unknown): Error {
  if (error instanceof Error && error.message.startsWith('This scan')) return error;
  return new Error('This scan could not be saved on this device. Keep this window open, download a backup, and retry saving. Device storage may be full or unavailable.');
}

export class ScanDraftStore {
  constructor(private factory: IDBFactory | undefined = globalThis.indexedDB) {}
  private async database(): Promise<IDBDatabase> {
    if (!this.factory) throw storageError();
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let abandoned = false;
      try { request = this.factory!.open(DB_NAME, 1); } catch (e) { reject(storageError(e)); return; }
      request.onupgradeneeded = () => {
        request.result.createObjectStore('drafts', { keyPath: 'key' });
        request.result.createObjectStore('summaries', { keyPath: 'key' }).createIndex('scope', 'scope');
      };
      request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () => { abandoned = true; reject(storageError()); };
    });
  }
  private async transaction<T>(write: boolean, work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await this.database();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(['drafts', 'summaries'], write ? 'readwrite' : 'readonly', { durability: 'strict' }); }
      catch { try { tx = db.transaction(['drafts', 'summaries'], write ? 'readwrite' : 'readonly'); } catch (e) { db.close(); reject(storageError(e)); return; } }
      let value: T, problem: Error | undefined;
      const fail = (error: Error) => { problem = error; try { tx.abort(); } catch { /* already aborted */ } };
      tx.oncomplete = () => { db.close(); resolve(value); if (write && typeof window !== 'undefined') window.dispatchEvent(new Event(SCAN_DRAFT_EVENT)); };
      tx.onabort = tx.onerror = () => { db.close(); reject(problem || storageError(tx.error)); };
      try { work(tx, next => { value = next; }, fail); } catch (e) { fail(storageError(e)); }
    });
  }
  async list(scope: ScanScope): Promise<ScanDraftSummary[]> {
    return this.transaction(false, (tx, done) => {
      const request = tx.objectStore('summaries').index('scope').getAll(scanScopeKey(scope));
      request.onsuccess = () => done(request.result.sort((a: ScanDraftSummary, b: ScanDraftSummary) => b.updatedAt.localeCompare(a.updatedAt)));
    });
  }
  async read(scope: ScanScope, id: string): Promise<ScanSnapshot | null> {
    return this.transaction(false, (tx, done) => {
      const request = tx.objectStore('drafts').get(keyFor(scope, id));
      request.onsuccess = () => done(request.result?.snapshot || null);
    });
  }
  async claim(scope: ScanScope, id: string, writer: string): Promise<ScanSnapshot> {
    return this.transaction(true, (tx, done, fail) => {
      const store = tx.objectStore('drafts'), request = store.get(keyFor(scope, id));
      request.onsuccess = () => {
        try {
        const row = request.result as StoredDraft | undefined;
        if (!row) { fail(new Error('This scan is no longer available in this account and space.')); return; }
        store.put({ ...row, writer }); done(row.snapshot);
        } catch (error) { fail(storageError(error)); }
      };
    });
  }
  async write(scope: ScanScope, id: string, writer: string, title: string, snapshot: ScanSnapshot, create: boolean): Promise<void> {
    if (!scope.uid || !scope.spaceId) throw new Error('Sign in to save scan drafts.');
    await this.transaction<void>(true, (tx, done, fail) => {
      const drafts = tx.objectStore('drafts'), key = keyFor(scope, id), request = drafts.get(key);
      request.onsuccess = () => {
        try {
        const previous = request.result as StoredDraft | undefined;
        if ((!previous && !create) || (previous && previous.writer !== writer)) {
          fail(new Error('This scan was discarded or opened in another window. Your current picture is still here; download a backup before closing.')); return;
        }
        const summary: ScanDraftSummary = { key, scope: scanScopeKey(scope), id, title, updatedAt: new Date().toISOString(), pages: snapshot.pages.length + (snapshot.originalCapture ? 1 : 0), ready: !!snapshot.file, fileName: snapshot.file?.name || snapshot.sourceFile?.name };
        drafts.put({ ...summary, writer, snapshot });
        tx.objectStore('summaries').put(summary); done(undefined);
        } catch (error) { fail(storageError(error)); }
      };
    });
  }
  async discard(scope: ScanScope, id: string): Promise<void> {
    await this.transaction<void>(true, (tx, done) => {
      const key = keyFor(scope, id); tx.objectStore('drafts').delete(key); tx.objectStore('summaries').delete(key); done(undefined);
    });
  }
}

export const scanDraftStore = new ScanDraftStore();

/** Synchronous edits, serial durable checkpoints, and a per-open writer fence. */
export class ScanDraftSession {
  id: string = crypto.randomUUID();
  private writer = crypto.randomUUID();
  private created = false;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private closed = false;
  private listeners = new Set<() => void>();
  private view = { snapshot: emptyScan(), status: 'empty' as 'empty' | 'saving' | 'saved' | 'error', error: '' };
  constructor(readonly scope: ScanScope, readonly title: string, private store = scanDraftStore) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.view;
  private emit() { for (const listener of this.listeners) listener(); }
  async restore(id: string): Promise<void> {
    const snapshot = await this.store.claim(this.scope, id, this.writer);
    this.id = id; this.created = true;
    this.view = { snapshot, status: 'saved', error: '' }; this.emit();
  }
  change(patch: Partial<ScanSnapshot>, invalidateFile = false): Promise<void> {
    if (this.closed) return Promise.reject(new Error('This scan has been discarded.'));
    const snapshot = { ...this.view.snapshot, ...(invalidateFile ? { file: undefined } : {}), ...patch };
    const mine = ++this.generation;
    this.view = { snapshot, status: hasCapture(snapshot) ? 'saving' : 'empty', error: '' }; this.emit();
    if (!hasCapture(snapshot) && !this.created) return Promise.resolve();
    const pending = this.queue.catch(() => {}).then(async () => {
      await this.store.write(this.scope, this.id, this.writer, this.title, snapshot, !this.created);
      this.created = true;
      if (mine === this.generation) { this.view = { snapshot, status: 'saved', error: '' }; this.emit(); }
    });
    this.queue = pending;
    // Attach a rejection handler immediately even when a React setter ignores the promise.
    void pending.catch(error => { if (mine === this.generation) { this.view = { ...this.view, status: 'error', error: storageError(error).message }; this.emit(); } });
    return pending;
  }
  flush = () => this.queue;
  retry = () => this.change({});
  async discard() {
    this.closed = true; ++this.generation;
    await this.queue.catch(() => {});
    await this.store.discard(this.scope, this.id);
  }
}

/** Downloadable recovery bundle preserves every original in its recorded order. */
export async function scanDraftBackup(snapshot: ScanSnapshot): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const originals = [...snapshot.pages.map(p => ({ data: p.original, name: p.originalName })), ...(snapshot.originalCapture ? [{ data: snapshot.originalCapture, name: snapshot.originalName }] : [])];
  originals.forEach((p, i) => { const ext = /^data:image\/jpeg/.test(p.data) ? 'jpg' : /^data:image\/png/.test(p.data) ? 'png' : 'bin'; zip.file(`original-${String(i + 1).padStart(2, '0')}-${(p.name || `capture.${ext}`).replace(/[^\w. -]/g, '_')}`, p.data.split(',')[1], { base64: true }); });
  if (snapshot.sourceFile) zip.file('source-' + snapshot.sourceFile.name.replace(/[^\w. -]/g, '_'), snapshot.sourceFile.data.split(',')[1], { base64: true });
  if (snapshot.file) zip.file(snapshot.file.name.replace(/[^\w. -]/g, '_'), snapshot.file.data.split(',')[1], { base64: true });
  zip.file('recovery.json', JSON.stringify(snapshot));
  return zip.generateAsync({ type: 'blob' });
}

export function downloadScanBackup(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
