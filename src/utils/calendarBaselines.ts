// Google recurrence baselines are too large to duplicate in localStorage.
// IndexedDB preserves their merge history without consuming its small quota.
let opened: Promise<IDBDatabase | null> | undefined;
function open(): Promise<IDBDatabase | null> {
  return opened ||= new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open('teluva-calendar-baselines', 1); } catch { return resolve(null); }
    request.onupgradeneeded = () => request.result.createObjectStore('baselines');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
export async function storeCalendarBaseline(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction('baselines', 'readwrite');
      tx.objectStore('baselines').put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}
export async function readCalendarBaselines(prefix: string): Promise<Array<[string, unknown]>> {
  const db = await open();
  if (!db) return [];
  return new Promise(resolve => {
    const rows: Array<[string, unknown]> = [];
    try {
      const tx = db.transaction('baselines', 'readonly');
      const request = tx.objectStore('baselines').openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { rows.push([String(cursor.key), cursor.value]); cursor.continue(); } };
      tx.oncomplete = () => resolve(rows); tx.onerror = () => resolve([]); tx.onabort = () => resolve([]);
    } catch { resolve([]); }
  });
}
