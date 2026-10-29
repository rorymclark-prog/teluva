import { FILE_BUCKET, fileContentUrl, filePathFromReference, isFamilyFilePath, normalizeFileReference } from './fileReferences';

export interface FileUser { uid: string; getIdToken: (forceRefresh?: boolean) => Promise<string> }
interface Options { getUser: () => FileUser | null; fetch?: typeof fetch; bucket?: string }
export interface StorageClient { getUser: Options['getUser']; fetch: typeof fetch; bucket: string }
interface FileReference { storage: StorageClient; fullPath: string }

export const createStorageClient = (options: Options): StorageClient => ({
  getUser: options.getUser, fetch: options.fetch || globalThis.fetch.bind(globalThis), bucket: options.bucket || FILE_BUCKET,
});

export function ref(storage: StorageClient, pathOrUrl: string): FileReference {
  const path = isFamilyFilePath(pathOrUrl) ? pathOrUrl : filePathFromReference(pathOrUrl, storage.bucket);
  if (!path) throw new Error('That file reference is not available in this vault.');
  return { storage, fullPath: path };
}

async function authorizedRequest(target: FileReference, method: 'PUT' | 'DELETE', body?: Blob, contentType?: string, shared = false) {
  const user = target.storage.getUser();
  if (!user) throw new Error('Sign in before changing a vault file.');
  const token = await user.getIdToken();
  if (target.storage.getUser()?.uid !== user.uid) throw new Error('Your account changed. Please try again.');
  const response = await target.storage.fetch(fileContentUrl(target.fullPath), {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}), ...(shared ? { 'x-teluva-file-scope': 'shared' } : {}) },
    ...(body ? { body } : {}),
  });
  if (!response.ok) {
    const error = Object.assign(new Error(response.status === 403 ? 'You cannot change files in this space.'
      : response.status === 401 ? 'Your session expired. Sign in again.' : 'The file could not be saved. Please try again.'),
    { code: response.status === 404 ? 'storage/object-not-found' : response.status === 403 ? 'storage/unauthorized' : 'storage/request-failed' });
    throw error;
  }
  return response;
}

export async function uploadBytes(target: FileReference, bytes: Blob, metadata?: { contentType?: string; shared?: boolean }) {
  if (bytes.size >= 20 * 1024 * 1024) throw new Error('Choose a file smaller than 20 MB.');
  await authorizedRequest(target, 'PUT', bytes, metadata?.contentType || bytes.type || 'application/octet-stream', metadata?.shared === true);
  return { ref: target, metadata: { fullPath: target.fullPath } };
}

export async function getDownloadURL(target: FileReference): Promise<string> {
  return fileContentUrl(target.fullPath);
}

export async function deleteObject(target: FileReference): Promise<void> {
  await authorizedRequest(target, 'DELETE');
}

/** Never turn an authorization error's JSON into a newly uploaded image. */
export async function fetchFileBlob(source: string, request: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Blob> {
  const response = await request(normalizeFileReference(source), { credentials: 'same-origin' });
  if (!response.ok) throw new Error('The source file is unavailable or you no longer have permission to open it.');
  return response.blob();
}

export type FileSessionLock = <T>(run: () => Promise<T>) => Promise<T>;
export interface FileSessionIntent { uid: string | null; generation: string }
export interface FileSessionIntentStore { read: () => FileSessionIntent | null; write: (intent: FileSessionIntent) => void }
interface SessionOptions extends Options { withLock?: FileSessionLock; intentStore?: FileSessionIntentStore }
const INTENT_KEY = 'teluva.file-session.identity.v1';
const browserIntents: FileSessionIntentStore = {
  read: () => {
    const raw = localStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || (value.uid !== null && typeof value.uid !== 'string') || typeof value.generation !== 'string') return null;
    return value;
  },
  write: value => localStorage.setItem(INTENT_KEY, JSON.stringify(value)),
};
const browserLock: FileSessionLock = run => {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    return Promise.reject(new Error('This browser cannot open protected files safely. Update your browser, then reload and sign in again.'));
  }
  return navigator.locks.request('teluva-file-session-v1', { mode: 'exclusive' }, run);
};

/** Cookie responses are serialized across the entire origin, not only this
 * tab. Only real auth transitions publish identity intent; hourly refreshes
 * cannot replace a newer account selected in another tab. */
export function createFileSession(options: SessionOptions) {
  const request = options.fetch || globalThis.fetch.bind(globalThis);
  const withLock = options.withLock || browserLock;
  const intents = options.intentStore || browserIntents;
  let queue: Promise<unknown> = Promise.resolve();
  let desiredUid: string | null = null, readyUid: string | null = null, generation = 0;
  let readyAt = 0;
  let identity: FileSessionIntent | null = null;
  let inFlight: { uid: string; promise: Promise<void> } | null = null;
  const readyFor = (uid: string): boolean => {
    try { return readyUid === uid && desiredUid === uid && Date.now() - readyAt < 55 * 60_000 && sameIntent(intents.read()); }
    catch { return false; }
  };
  const enqueue = <T,>(run: () => Promise<T>): Promise<T> => {
    const task = queue.catch(() => {}).then(() => withLock(run));
    queue = task.catch(() => {});
    return task;
  };
  const sameIntent = (candidate: FileSessionIntent | null) => !!identity && candidate?.uid === identity.uid && candidate.generation === identity.generation;
  const publishIdentity = (uid: string | null) => {
    const current = intents.read();
    const next = current?.uid === uid ? current : { uid, generation: crypto.randomUUID() };
    intents.write(next);
    identity = next;
  };
  const clearCookie = async () => {
    const response = await request('/api/files/session', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Could not close the protected file session. Check your connection and try again.');
  };
  const ensure = (user: FileUser, force = false): Promise<void> => {
    if (desiredUid === user.uid && inFlight?.uid === user.uid) return inFlight.promise;
    if (!force && readyFor(user.uid)) return Promise.resolve();
    const changedAccount = desiredUid !== user.uid || readyUid !== user.uid;
    desiredUid = user.uid;
    const mine = ++generation;
    readyUid = null;
    const promise = enqueue(async () => {
      // Firebase's current identity is re-read AFTER acquiring the global lock.
      if (mine !== generation || options.getUser()?.uid !== user.uid) throw new Error('Your account changed. Please reload and try again.');
      const current = intents.read();
      if (!identity) {
        if (current && current.uid !== user.uid) throw new Error('Your account changed in another tab. Reload or sign out and sign in again.');
        identity = current || { uid: user.uid, generation: crypto.randomUUID() };
        if (!current) intents.write(identity);
      }
      if (!sameIntent(intents.read())) throw new Error('Your account changed in another tab. Reload or sign out and sign in again.');
      if (changedAccount) await clearCookie();
      const token = await user.getIdToken();
      if (mine !== generation || options.getUser()?.uid !== user.uid || !sameIntent(intents.read())) throw new Error('Your account changed. Please reload and try again.');
      const response = await request('/api/files/session', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Could not open the protected file session. Check your connection and reload.');
      if (mine !== generation || options.getUser()?.uid !== user.uid || !sameIntent(intents.read())) throw new Error('Your account changed. Please reload and try again.');
      readyUid = user.uid;
      readyAt = Date.now();
    });
    inFlight = { uid: user.uid, promise };
    void promise.finally(() => { if (inFlight?.promise === promise) inFlight = null; }).catch(() => {});
    return promise;
  };
  const clear = async (): Promise<void> => {
    publishIdentity(null);
    const clearingIntent = identity;
    desiredUid = null; readyUid = null; generation += 1; inFlight = null;
    return enqueue(async () => {
      const current = intents.read();
      // A newer login owns the next cookie. Its own handshake clears the old
      // cookie before setting a new one; a delayed logout must not clear it.
      if (current?.generation !== clearingIntent?.generation || current?.uid !== null) return;
      await clearCookie();
    });
  };
  return {
    ensure,
    changeIdentity: async (user: FileUser | null): Promise<void> => {
      if (!user) return clear();
      publishIdentity(user.uid);
      desiredUid = null; readyUid = null; generation += 1; inFlight = null;
      return ensure(user, true);
    },
    isReadyFor: readyFor,
    clear,
  };
}
