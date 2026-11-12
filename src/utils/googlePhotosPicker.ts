import type { FileOperationScope } from './fileOperationScope';

export const PHOTOS_PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const API = 'https://photospicker.googleapis.com/v1';
const MAX_BYTES = 20 * 1024 * 1024;
interface PickingSession { id: string; pickerUri: string; mediaItemsSet?: boolean; expireTime?: string; pollingConfig?: { pollInterval?: string; timeoutIn?: string } }
interface PickedPhoto { id: string; type: string; createTime?: string; mediaFile: { baseUrl: string; mimeType?: string; filename?: string } }
export interface GoogleAtlasPhoto { file: File; captureTime?: string }
export function safePickerUri(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'photos.google.com' || url.port || url.username || url.password || !/^\/(?:u\/\d+\/)?picker\//.test(url.pathname)) throw new Error('Google returned an unexpected photo picker address.');
  return url.href;
}
export function safePhotoDownload(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^lh\d+\.googleusercontent\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash) throw new Error('Google returned an unexpected photo address.');
  return `${url.href}=d`;
}
export function googleDuration(value: string | undefined, fallback: number): number {
  return value && /^\d+(?:\.\d+)?s$/.test(value) ? Number(value.slice(0, -1)) * 1000 : fallback;
}
export function waitForPhotos(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Photo selection cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  });
}
async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('The selected photo is too large. Choose a photo smaller than 20 MB.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Could not read Google Photos response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('The selected photo is too large. Choose a photo smaller than 20 MB.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** Token and temporary Google URLs remain in this operation's memory only.
 * No app storage write happens until the Atlas review is explicitly saved. */
export async function pickGooglePhotos(options: {
  token: string; scope: FileOperationScope; signal: AbortSignal;
  onPicker: (uri: string) => void; onStatus?: (message: string) => void;
  fetch?: typeof fetch; wait?: typeof waitForPhotos; now?: () => number;
}): Promise<GoogleAtlasPhoto[]> {
  const request = options.fetch || fetch, wait = options.wait || waitForPhotos, now = options.now || Date.now;
  const check = () => { options.scope.check(); options.signal.throwIfAborted(); };
  const headers = { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' };
  const call = async (path: string, init: RequestInit = {}) => {
    check();
    const response = await options.scope.step(() => request(API + path, { ...init, headers, signal: AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' }));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 401 ? 'Google Photos access expired. Connect again.' : response.status === 403
        ? 'Google Photos access is unavailable. Check permission or ask the Teluva administrator to enable the Photos Picker API and OAuth scope. You can still import selected photo files.'
        : `Google Photos could not complete the selection (${response.status}). Try again.`);
    }
    const bytes = await options.scope.step(() => boundedBytes(response, 512 * 1024));
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  let sessionId: string | undefined;
  try {
    const created = await call('/sessions', { method: 'POST', body: JSON.stringify({ pickingConfig: { maxItemCount: '20' } }) }) as PickingSession;
    if (!created.id || typeof created.id !== 'string') throw new Error('Google did not create a photo selection session.');
    sessionId = created.id;
    const uri = safePickerUri(created.pickerUri);
    check(); options.onPicker(uri); options.onStatus?.('Open Google Photos, choose up to 20 photos, then press Done.');
    let session = created;
    let deadline = now() + Math.min(600_000, googleDuration(session.pollingConfig?.timeoutIn, 600_000));
    while (!session.mediaItemsSet) {
      if (session.expireTime) deadline = Math.min(deadline, Date.parse(session.expireTime) || deadline);
      deadline = Math.min(deadline, now() + googleDuration(session.pollingConfig?.timeoutIn, 600_000));
      if (now() >= deadline) throw new Error('Photo selection timed out. Reopen Google Photos to try again.');
      await wait(Math.min(Math.max(1000, googleDuration(session.pollingConfig?.pollInterval, 5000)), deadline - now()), options.signal);
      check(); session = await call(`/sessions/${encodeURIComponent(sessionId)}`);
    }
    const items: PickedPhoto[] = []; let pageToken: string | undefined;
    const seenPages = new Set<string>();
    do {
      const query = new URLSearchParams({ sessionId, pageSize: '20', ...(pageToken ? { pageToken } : {}) });
      const page = await call(`/mediaItems?${query}`);
      if (page.mediaItems && !Array.isArray(page.mediaItems)) throw new Error('Google returned an invalid selection.');
      items.push(...(page.mediaItems || []));
      if (items.length > 20) throw new Error('Choose up to 20 photos per import.');
      pageToken = page.nextPageToken;
      if (pageToken && (typeof pageToken !== 'string' || seenPages.has(pageToken) || seenPages.size >= 20)) throw new Error('Google returned an invalid selection page.');
      if (pageToken) seenPages.add(pageToken);
    } while (pageToken);
    if (items.some(item => item.type !== 'PHOTO' || !item.mediaFile?.mimeType?.startsWith('image/'))) throw new Error('This Atlas import supports photos. Choose photos without videos and try again.');
    const photos: GoogleAtlasPhoto[] = [];
    for (const item of items) {
      check(); options.onStatus?.(`Reading selected photo ${photos.length + 1} of ${items.length}…`);
      const response = await options.scope.step(() => request(safePhotoDownload(item.mediaFile.baseUrl), { headers: { Authorization: `Bearer ${options.token}` }, signal: AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]), redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }));
      if (!response.ok) { await response.body?.cancel(); throw new Error('A selected photo could not be downloaded. Reopen Google Photos or use a photo export.'); }
      const bytes = await options.scope.step(() => boundedBytes(response, MAX_BYTES));
      // Google excludes location metadata from downloads. Leave GPS unknown.
      const file = new File([bytes as BlobPart], item.mediaFile.filename || 'Google Photos image.jpg', { type: item.mediaFile.mimeType });
      photos.push({ file, captureTime: item.createTime });
    }
    check(); return photos;
  } finally {
    // Cleanup is pinned to the exact Google session/token, even if the Teluva
    // account changed. It cannot read or write anything in another space.
    if (sessionId) await request(`${API}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000) }).then(response => response.body?.cancel()).catch(() => {});
  }
}
