import { fileContentUrl, filePathFromReference } from './fileReferences';
interface User { uid: string; getIdToken: (forceRefresh?: boolean) => Promise<string> }
interface Options { getUser: () => User | null; getSpace: () => string | null; fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number }
const MAX_BYTES = 20 * 1024 * 1024;
const stopped = () => new Error('Opening the file was stopped or timed out. Try again.');

function tokenUntilAbort(token: Promise<string>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(stopped()); };
    if (signal.aborted) { void token.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    token.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Read the original using current authorization, independently of a stale
 * media cookie. Never attach tokens to external or provider download URLs. */
export async function readProtectedPreview(source: string, options: Options): Promise<Blob> {
  const path = filePathFromReference(source), user = options.getUser(), space = options.getSpace();
  if (!path || !user || !space) throw new Error('Sign in to open this protected file.');
  if (!path.startsWith(`families/${space}/`)) throw new Error('This original belongs to a different space. Switch to that space to open it.');
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, options.timeoutMs ?? 20_000);
  options.signal?.addEventListener('abort', stop, { once: true });
  const check = () => {
    if (controller.signal.aborted || options.signal?.aborted) throw stopped();
    if (options.getUser() !== user || options.getSpace() !== space) throw new Error('Your account or space changed. Reopen the file.');
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      check(); const token = await tokenUntilAbort(user.getIdToken(attempt > 0), controller.signal); check();
      response = await (options.fetch || fetch)(fileContentUrl(path), { credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      check();
      if (response.status !== 401 || attempt > 0) break;
      await response.body?.cancel();
    }
    if (!response.ok) throw new Error(response.status === 403 ? 'You no longer have permission to open this original.' : response.status === 404 ? 'The original file was not found. Its record has been kept.' : response.status === 401 ? 'Your session expired. Sign in again to open the original.' : 'The original could not be loaded. Try again.');
    const type = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    if (type === 'application/json' || type === 'text/html') throw new Error('The server did not return a document. Try again.');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Download this original to view it; it is too large for an in-app preview.');
    if (!response.body) throw new Error('The original returned no file data. Try again.');
    reader = response.body.getReader();
    controller.signal.addEventListener('abort', () => { void reader?.cancel().catch(() => {}); }, { once: true });
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const chunk = await reader.read(); check(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('Download this original to view it; it is too large for an in-app preview.');
      chunks.push(chunk.value);
    }
    if (!bytes) throw new Error('The original returned an empty file. Its record has been kept.');
    check(); return new Blob(chunks, { type });
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', stop);
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    else controller.abort();
  }
}
