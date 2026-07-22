// Web Push client helpers — service-worker registration, eligibility checks and
// the subscribe/unsubscribe dance. Kept separate from db.ts so the push feature
// is entirely self-contained and can never break the rest of the app: every
// entry point here is defensive and returns a result rather than throwing at
// the call site that matters (registration in particular NEVER throws).
//
// The actual Firestore write of the subscription is done SERVER-side (via
// firebase-admin) — see /api/push/subscribe in server.js. The client only ever
// posts the raw PushSubscription JSON to that endpoint. This avoids granting
// the client SDK write access to a new pushSubscriptions collection (no
// firestore.rules change needed).

import { auth } from '../lib/firebase';

// Only run push in a real deployed build. In dev there is no server VAPID key
// wired up and no installed PWA, so registering the SW just adds noise.
const IS_PROD = import.meta.env.PROD;

/**
 * Register the service worker. Safe to call unconditionally on app start:
 * - no-ops when serviceWorker is unsupported or we're not in production,
 * - swallows every error (a failed registration must never break the app).
 * Returns the registration on success, or null.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (!IS_PROD) return null;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    // Intentionally silent — push is a bonus, not core functionality.
    return null;
  }
}

/**
 * Whether this device/browser can actually subscribe to push right now.
 * iOS ONLY permits push for a web app added to the Home Screen (standalone
 * display mode), so we gate on that as well as PushManager support and the
 * permission not being hard-denied. When this is false the UI shows an
 * "Add to Home Screen first" helper instead of a dead button.
 */
export function isPushEligible(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    // iOS Safari exposes this legacy flag when launched from the Home Screen.
    (navigator as any).standalone === true;
  const hasPushManager = 'PushManager' in window;
  const notDenied =
    typeof Notification !== 'undefined' && Notification.permission !== 'denied';
  return standalone && hasPushManager && notDenied;
}

/** True once the browser already holds a push subscription for this SW. */
export async function isSubscribed(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

// The applicationServerKey must be a Uint8Array; the server hands us the VAPID
// public key as a base64url string. Standard conversion (per the Web Push spec
// examples).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function idToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in first.');
  return user.getIdToken();
}

/**
 * Full opt-in flow, driven by a real user gesture (required for
 * Notification.requestPermission on iOS). Ordering matters:
 *   1. ensure the SW is registered,
 *   2. request notification permission,
 *   3. fetch the VAPID public key from the server (never hardcoded),
 *   4. subscribe via pushManager,
 *   5. POST the subscription JSON to the server, which stores it.
 * Throws with a user-facing message on any failure so the UI can show it.
 */
export async function enablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error('This browser does not support notifications.');
  }
  const reg =
    (await navigator.serviceWorker.getRegistration()) ||
    (await navigator.serviceWorker.register('/sw.js'));

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are turned off. Allow them to get reminders.');
  }

  // Reuse an existing subscription if the browser already has one, otherwise
  // create a fresh one with the server's VAPID public key.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const keyRes = await fetch('/api/push/public-key');
    if (!keyRes.ok) throw new Error('Reminders are not available right now.');
    const { key } = await keyRes.json().catch(() => ({}));
    if (!key) throw new Error('Reminders are not available right now.');
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }

  const token = await idToken();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not save your reminder settings.');
  }
}

/**
 * Turn reminders off for THIS device: unsubscribe locally and tell the server
 * to delete the stored subscription. Best-effort on both halves — we still
 * report success if the local unsubscribe worked even if the server delete
 * hiccups (the server also self-heals by pruning dead endpoints on send).
 */
export async function disablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});

  try {
    const token = await idToken();
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // Server-side cleanup will catch a leftover on the next failed send.
  }
}
