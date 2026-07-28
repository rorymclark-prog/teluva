/* Teluva service worker — push notifications only.
 *
 * Deliberately minimal: this SW exists so iOS/Android can deliver Web Push
 * while the app is closed. It intentionally does NOT cache app shell / assets —
 * the Express server already sends correct caching headers (hashed bundles are
 * long-cached, index.html revalidates), and an offline cache here would risk
 * silently pinning an old build. Keep this file about push + click only.
 *
 * Vite copies public/* to the dist root at build, so this is served at /sw.js
 * (registration scope "/") alongside /manifest.webmanifest and /icons/*.
 */

// Activate a new SW immediately rather than waiting for every tab to close,
// so a push-handler fix reaches devices on the next visit.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
