// Silent re-acquisition of the Google API access token.
//
// THE PROBLEM
// Firebase Auth keeps the user signed IN across reloads, but the Google OAuth
// *access token* — the thing Drive and Calendar actually need — was only ever
// held in a module variable (firebase.ts's cachedAccessToken). Reload the page
// and it is gone, so the app showed "connect Google Calendar" again, and
// `prompt: 'consent'` meant that reconnect was the full consent screen rather
// than a click. The same thing happened silently after an hour, because that is
// how long a Google access token lives.
//
// THE FIX
// Google Identity Services can mint a fresh access token with no UI at all,
// provided the user has already granted these scopes to this OAuth client —
// which they have, because that is exactly what the Firebase sign-in popup did.
// `prompt: ''` means "only if you can do it silently"; if consent is genuinely
// needed, it fails and we fall back to the existing interactive flow.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// It does not persist the token to localStorage. A Google access token is a
// bearer credential for the user's entire Drive and calendar; this app also
// holds medical records, and putting a live credential in storage readable by
// any script on the origin is not a trade worth making to save one silent
// network call. The token stays in memory and is re-minted when needed.
//
// FAILURE IS NON-FATAL BY DESIGN. If the GIS script is blocked, the origin is
// not registered on the OAuth client, or the user has not consented, every
// function here resolves to null and the app behaves exactly as it did before
// this file existed.
//
// OBSERVED BEHAVIOUR (checked against the deployed app, not assumed):
//   - The script loads from our own origin and initTokenClient() succeeds, so
//     nothing about this project's CSP or OAuth client blocks it.
//   - `prompt: ''` is "silent IF POSSIBLE", not "silent or nothing". With no
//     Google session in the browser it tries to open a popup instead, which
//     reports back as error_callback type `popup_failed_to_open` — because a
//     popup we did not open from a click is blocked by the browser anyway.
//     That is the desired outcome, not a bug: no window appears uninvited, the
//     call resolves null, and the user sees the ordinary Connect button. The
//     silent path is for the normal case, where the user is signed in to
//     Google and has already granted these scopes.

import { GOOGLE_SCOPES } from './googleScopes';

// The OAuth client Firebase auto-created for this project's Google sign-in.
// A client ID is public information — it is visible in every OAuth request the
// app already makes. (Its client SECRET is not, and appears nowhere in this
// repo.) Overridable so a different deployment can point at its own client.
const CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined) ||
  '1000796646145-mdg6rjnq1st5viudretgquthrm42f2fp.apps.googleusercontent.com';

// Must match the scopes requested in firebase.ts, or the silent request asks
// for something the user never granted and falls back to a prompt every time.
// Sourced from googleScopes.ts — the single place that decides, so this file
// can't drift from firebase.ts's list.
const SCOPES = GOOGLE_SCOPES.join(' ');

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Google access tokens last an hour. Treat one as spent a minute early so a
// request never leaves with a token that expires in flight.
const EXPIRY_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
  callback: (r: TokenResponse) => void;
  error_callback?: (e: { type?: string; message?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type?: string; message?: string }) => void;
          }) => TokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<boolean> | null = null;

/** Load the GIS script once. Resolves false — never rejects — if it can't. */
function loadGis(): Promise<boolean> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    if (typeof document === 'undefined') return resolve(false);

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(!!window.google?.accounts?.oauth2));
      existing.addEventListener('error', () => resolve(false));
      // Already finished loading before we attached the listener.
      if (window.google?.accounts?.oauth2) resolve(true);
      return;
    }

    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(!!window.google?.accounts?.oauth2);
    s.onerror = () => {
      // Blocked by an extension, offline, or a restrictive network. Not an
      // error the user needs to see — they just get the Connect button.
      console.warn('[googleToken] GIS script did not load; falling back to interactive connect');
      resolve(false);
    };
    document.head.appendChild(s);
  });

  return scriptPromise;
}

let client: TokenClient | null = null;

async function getClient(): Promise<TokenClient | null> {
  if (client) return client;
  if (!(await loadGis())) return null;
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return null;
  try {
    client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      // Both are replaced per-request in requestToken() below; GIS requires
      // them at construction time, so these are placeholders.
      callback: () => {},
      error_callback: () => {},
    });
    return client;
  } catch (e) {
    console.warn('[googleToken] could not create a token client', e);
    return null;
  }
}

// GIS's requestAccessToken is callback-based and fires at most one of its two
// callbacks. Wrapping it in a promise needs a guard so a misbehaving double
// callback can't settle twice, and a timeout so a silent request that simply
// never answers doesn't leave the caller hanging forever.
function requestToken(c: TokenClient, prompt: string): Promise<{ token: string; expiresAt: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { token: string; expiresAt: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const timer = setTimeout(() => {
      console.warn('[googleToken] token request timed out');
      finish(null);
    }, 20_000);

    c.callback = (r: TokenResponse) => {
      clearTimeout(timer);
      if (r?.access_token) {
        const ttl = (Number(r.expires_in) || 3600) * 1000;
        finish({ token: r.access_token, expiresAt: Date.now() + ttl });
      } else {
        // The expected outcome when consent really is required.
        finish(null);
      }
    };
    c.error_callback = (e) => {
      clearTimeout(timer);
      console.warn('[googleToken] token request failed:', e?.type || e?.message || 'unknown');
      finish(null);
    };

    try {
      c.requestAccessToken({ prompt });
    } catch (e) {
      clearTimeout(timer);
      console.warn('[googleToken] token request threw', e);
      finish(null);
    }
  });
}

/**
 * Try to get a token with no user interaction whatsoever.
 * Returns null whenever that isn't possible — which the caller should treat as
 * "show the Connect button", not as an error.
 */
export async function silentAccessToken(): Promise<{ token: string; expiresAt: number } | null> {
  const c = await getClient();
  if (!c) return null;
  return requestToken(c, '');
}

/**
 * Ask for a token, showing Google's consent UI if it's needed. Used when the
 * user has explicitly clicked Connect, so a popup is expected rather than
 * intrusive.
 */
export async function interactiveAccessToken(): Promise<{ token: string; expiresAt: number } | null> {
  const c = await getClient();
  if (!c) return null;
  return requestToken(c, 'consent');
}

/** Is a token with this expiry still worth sending? */
export function tokenIsFresh(expiresAt: number | null): boolean {
  return expiresAt !== null && Date.now() < expiresAt - EXPIRY_MARGIN_MS;
}

export const GOOGLE_TOKEN_SCOPES = SCOPES;
export const EXPIRY_MARGIN = EXPIRY_MARGIN_MS;
