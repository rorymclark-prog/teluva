/* Teluva service worker — push notifications + an explicit emergency shell.
 *
 * Deliberately minimal: this SW exists so iOS/Android can deliver Web Push
 * while the app is closed. The versioned shell cache exists only so a family
 * that explicitly saved an Emergency pack can reopen /emergency-pack without
 * a signal. Navigation stays network-first and hashed assets are versioned, so
 * this cannot silently pin an old build while online.
 *
 * Vite copies public/* to the dist root at build, so this is served at /sw.js
 * (registration scope "/") alongside /manifest.webmanifest and /icons/*.
 */

// Activate a new SW immediately rather than waiting for every tab to close,
// so a push-handler fix reaches devices on the next visit.
const SHELL_CACHE = 'teluva-emergency-shell-v348';
const SHELL_VERSION = 'v348';

/* Web Share Target. These four values are duplicated in
 * src/utils/sharedInbox.ts and MUST stay identical — this file is plain
 * unbundled JavaScript and that one is TypeScript compiled by Vite, so they
 * cannot import each other. shareTarget.test.ts reads both files and fails if
 * they drift, because a mismatch here does not throw: the share appears to
 * succeed, the app opens, and the document is simply not there. */
const SHARE_CACHE = 'teluva-shared-inbox';
const SHARE_ENTRY_PREFIX = '/__shared__/';
const SHARE_FILENAME_HEADER = 'x-teluva-filename';
const SHARE_TARGET_PATH = '/share-target';

async function prepareEmergencyShell() {
  const cache = await caches.open(SHELL_CACHE);
  const response = await fetch('/', { cache: 'no-store' });
  if (!response.ok) throw new Error(`App shell returned ${response.status}`);
  const html = await response.clone().text();
  const paths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/assets/') || path.startsWith('/icons/') || path === '/manifest.webmanifest');
  const coreAssets = paths.filter((path) => path.startsWith('/assets/'));
  if (!coreAssets.some((path) => path.endsWith('.js')) || !coreAssets.some((path) => path.endsWith('.css'))) {
    throw new Error('Built app assets were not discoverable');
  }
  await cache.put('/', response);
  await Promise.all([...new Set(paths)].map((path) => cache.add(path)));
  const cached = await Promise.all(['/', ...coreAssets].map((path) => cache.match(path)));
  if (cached.some((entry) => !entry)) throw new Error('Required app assets were not cached');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try { await prepareEmergencyShell(); } catch { /* explicit Save will retry and report failure */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('teluva-emergency-shell-') && name !== SHELL_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PREPARE_EMERGENCY_SHELL') return;
  const reply = event.ports?.[0];
  event.waitUntil((async () => {
    try {
      await prepareEmergencyShell();
      reply?.postMessage({ ok: true, version: SHELL_VERSION });
    } catch (error) {
      reply?.postMessage({ ok: false, version: SHELL_VERSION, error: error instanceof Error ? error.message : 'Offline preparation failed' });
    }
  })());
});

/* Receive a file shared into Teluva from the OS share sheet.
 *
 * The share arrives as a real multipart POST to SHARE_TARGET_PATH. It must
 * never reach the server: the files belong in the browser, the server has no
 * session for this request, and a POST that returns HTML would leave the SPA.
 * So we take the files, keep them, and answer with a redirect to the app.
 *
 * 303 specifically, not 302. A 302 preserves the method, so the browser would
 * re-issue the navigation as a POST to "/" and the app would never load. 303
 * is the one that says "go and GET this instead", which is exactly the
 * situation.
 *
 * Every failure path still redirects. If the cache write fails there is
 * nothing useful to show a person standing in another app's share sheet, and
 * an error page there is worse than opening Teluva with nothing filed — they
 * can see immediately that the document is not there and try again.
 */
async function handleSharedFiles(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && 'size' in f && f.size > 0);
    if (files.length) {
      const cache = await caches.open(SHARE_CACHE);
      await Promise.all(files.map((file, i) => cache.put(
        new Request(`${SHARE_ENTRY_PREFIX}${Date.now()}-${i}`),
        new Response(file, {
          headers: {
            // The blob's own type, not the form part's — some senders post
            // application/octet-stream and the file itself knows better.
            'content-type': file.type || 'application/octet-stream',
            // encodeURIComponent because a header cannot carry a non-ASCII
            // filename, and "Meldezettel Müller.pdf" is exactly the kind of
            // name this has to survive.
            [SHARE_FILENAME_HEADER]: encodeURIComponent(file.name || ''),
          },
        }),
      )));
    }
  } catch (err) {
    // Deliberately swallowed — see the header comment. Logged so a device
    // that never files anything can be told apart from one that was never
    // shared to.
    console.warn('[sw] share-target could not keep the files:', err);
  }
  return Response.redirect('/?shared=1', 303);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  /* Before the GET guard below, deliberately: a share is the one POST this
   * worker must answer, and the guard would drop it. */
  if (request.method === 'POST' && new URL(request.url).pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleSharedFiles(request));
    return;
  }

  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) (await caches.open(SHELL_CACHE)).put('/', response.clone());
          return response;
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
        if (response.ok) (await caches.open(SHELL_CACHE)).put(request, response.clone());
        return response;
      })),
    );
  }
});

// A push arrives as an opaque blob; the server sends JSON {title, body, url, tag}.
// Parse defensively — a malformed/absent payload must still surface *something*
// rather than throw and drop the notification.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'Teluva';
  const body = data.body || '';
  const url = data.url || '/';
  // A stable tag makes repeated pushes for the same occasion collapse into one
  // notification instead of stacking (e.g. if the cron ever double-fires).
  const tag = data.tag || 'tresa-celebration';

  const options = {
    body,
    tag,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification: focus an already-open Teluva tab if there is one,
// otherwise open a fresh window at the target url.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // Focus any existing same-origin window (its exact path doesn't
          // matter — the app is a SPA and the user just wants it foregrounded).
          if ('focus' in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      }),
  );
});
