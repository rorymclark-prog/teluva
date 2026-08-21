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
const SHELL_CACHE = 'teluva-emergency-shell-v252';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const response = await fetch('/');
      if (response.ok) {
        const html = await response.clone().text();
        await cache.put('/', response);
        const paths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((match) => match[1])
          .filter((path) => path.startsWith('/assets/') || path.startsWith('/icons/') || path === '/manifest.webmanifest');
        await Promise.all([...new Set(paths)].map((path) => cache.add(path).catch(() => undefined)));
      }
    } catch { /* online install will retry on the next service-worker update */ }
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
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
