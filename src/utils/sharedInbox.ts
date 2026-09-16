/* The handoff between a Web Share Target POST and the running app.
 *
 * WHAT SHARING INTO AN APP ACTUALLY DOES. When someone picks Teluva from the
 * OS share sheet, the browser does not open the app and hand it a file. It
 * sends a real multipart POST to the URL named in the manifest's
 * `share_target.action`. That POST never reaches our server: the service
 * worker intercepts it, keeps the files, and answers with a redirect to the
 * app. So the file arrives in the SERVICE WORKER, and the page that opens a
 * moment later has to go and find it. This module is that meeting point.
 *
 * WHY THE CACHE API AND NOT IndexedDB. Both are available in a worker and in
 * a page, so either could carry the files. The Cache API wins because the
 * service worker is plain, unbundled JavaScript in public/sw.js and this file
 * is TypeScript compiled by Vite — they cannot import each other, so whatever
 * the store is, its access code exists TWICE. IndexedDB's version/upgrade
 * dance duplicated in two languages in two files is a schema mismatch waiting
 * to happen; `caches.open(name)` and `cache.put(request, response)` are two
 * lines on each side with nothing to drift except the name and the paths.
 * Those are asserted identical across both files by shareTarget.test.ts.
 *
 * A Response also carries headers, which is how the filename survives: a Blob
 * on its own has a type but no name, and a document filed as "blob" instead of
 * "Meldezettel 2026.pdf" is a document nobody finds again.
 */

/** Cache name. MUST match SHARE_CACHE in public/sw.js. */
export const SHARE_CACHE = 'teluva-shared-inbox';

/** URL prefix each shared file is stored under. MUST match public/sw.js. */
export const SHARE_ENTRY_PREFIX = '/__shared__/';

/** Header carrying the original filename, URI-encoded. MUST match public/sw.js. */
export const SHARE_FILENAME_HEADER = 'x-teluva-filename';

/** The query flag the service worker redirects back with. MUST match public/sw.js. */
export const SHARE_FLAG = 'shared';

/* Not a security boundary — the OS decides what it lets you share — but a
 * dropped 200MB video should not sit in a cache forever waiting for a vault
 * upload that would reject it anyway. Matches the vault's own 20MB cap. */
export const SHARE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Take everything the service worker stashed, and CLEAR it.
 *
 * Take, not read: the files exist to be filed once. If the page reads them and
 * leaves them in place, every later launch of the app re-opens the upload form
 * holding a document the person already filed — and a vault that keeps
 * offering to file the same passport is worse than one that lost it, because
 * the second one you notice. Deletion happens after the Blob is in hand, so a
 * crash mid-read loses nothing.
 */
export async function takeSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return [];
  let cache: Cache;
  try {
    cache = await caches.open(SHARE_CACHE);
  } catch {
    return [];   // private mode, storage denied — sharing simply did not happen
  }

  const requests = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith(SHARE_ENTRY_PREFIX));
  const files: File[] = [];

  for (const request of requests) {
    try {
      const response = await cache.match(request);
      if (!response) continue;
      const blob = await response.blob();
      if (!blob.size || blob.size > SHARE_MAX_BYTES) { await cache.delete(request); continue; }
      files.push(new File([blob], filenameFrom(response, blob), { type: blob.type || 'application/octet-stream' }));
      await cache.delete(request);
    } catch {
      /* One unreadable entry must not strand the others — drop it and move on.
       * Deleting is deliberate: an entry that cannot be read will not become
       * readable later, and leaving it means retrying this forever. */
      try { await cache.delete(request); } catch { /* nothing left to try */ }
    }
  }
  return files;
}

/**
 * The filename the sharing app gave us, or an honest invented one.
 *
 * Exported for the test, because getting this wrong is silent: a share that
 * loses the name still files a document, just one named "shared-file" that
 * nobody searching for "Meldezettel" will ever turn up.
 */
export function filenameFrom(response: { headers: { get(name: string): string | null } }, blob: { type?: string }): string {
  const raw = response.headers.get(SHARE_FILENAME_HEADER);
  if (raw) {
    try {
      const decoded = decodeURIComponent(raw).trim();
      /* Strip any path the sender put in the name. A share is not a filesystem
       * write, so this cannot escape anywhere — but the name goes into a
       * document title people read, and "…/Downloads/scan.pdf" is not a title. */
      const base = decoded.split(/[\\/]/).pop();
      if (base) return base.slice(0, 200);
    } catch { /* a malformed encoding falls through to the invented name */ }
  }
  const ext = (blob.type || '').includes('pdf') ? 'pdf'
    : (blob.type || '').startsWith('image/') ? (blob.type as string).slice(6).split('+')[0]
    : 'bin';
  return `shared-document.${ext}`;
}

/**
 * How this page load relates to a share, if at all.
 *
 * Read from the URL rather than the cache so the app can decide where to
 * navigate BEFORE doing async storage work — and so an ordinary launch never
 * pays for a cache open at all.
 *
 * 'lost' is the case worth having a value for. The service worker answers the
 * share POST and redirects with `?shared=1`; if the worker was evicted or has
 * not activated, the POST reaches the server instead, which redirects with
 * `?shared=lost` (see the /share-target route in server.js). Those bytes are
 * genuinely unrecoverable — a multipart body arriving at a server with no
 * session for it cannot be filed to anyone. The distinction exists so the app
 * can SAY the share was lost, rather than opening on a normal-looking home
 * screen with the document nowhere and no explanation.
 */
export type ShareOutcome = 'files' | 'lost' | null;

export function shareOutcome(search: string): ShareOutcome {
  try {
    const v = new URLSearchParams(search).get(SHARE_FLAG);
    if (v === '1') return 'files';
    if (v === 'lost') return 'lost';
    return null;
  } catch {
    return null;
  }
}

/** Convenience for the common branch. */
export function launchedFromShare(search: string): boolean {
  return shareOutcome(search) === 'files';
}

/**
 * Strip the share flag from the address bar.
 *
 * Same reasoning as the manifest `shortcuts` handler in Dashboard.tsx: a
 * refresh must not replay the action, and the parameter must not survive into
 * a link someone copies out of the address bar.
 */
export function clearShareFlag(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SHARE_FLAG)) return;
    url.searchParams.delete(SHARE_FLAG);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch { /* the address bar is a nicety here, never worth throwing over */ }
}
