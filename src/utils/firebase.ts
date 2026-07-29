import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { silentAccessToken, interactiveAccessToken, tokenIsFresh } from './googleToken';

// Single shared Firebase app — initialized once in lib/firebase.ts.
export { auth, db };

const provider = new GoogleAuthProvider();
// Scoped to exactly what the app's code does with the token — see
// GoogleDriveSync.tsx (read-only Drive browsing, no create/update/delete
// calls) and FamilyCalendar.tsx (reads/writes events on the primary
// calendar only, never manages calendars themselves).
//
// drive.readonly is a Google "restricted" scope (requires an annual CASA
// security assessment before this app can go public) because it grants
// read access to the user's ENTIRE Drive, not just files they hand to the
// app. It is kept because the folder browser in GoogleDriveSync.tsx lists
// arbitrary folders, which drive.file (narrow, non-sensitive) cannot do.
// Removing that CASA requirement would mean rebuilding Drive access around
// the Google Picker (user browses in Google's own UI, app only gets
// drive.file access to what they pick) — a real UX rewrite, not done here.
//
// Removed: auth/drive (full read+write+delete of every file — nothing in
// this app ever creates/updates/deletes a Drive file), auth/drive.file
// (redundant — no Picker, no app-created files, so drive.readonly already
// covers every current use), auth/calendar (full calendar management,
// including deleting calendars — this app only ever touches events on the
// user's "primary" calendar via calendar.events).
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/calendar.events');

// No `prompt: 'consent'`. Forcing it meant Google re-ran the full consent
// screen on EVERY sign-in — reviewing Drive and calendar permissions again to
// get back to where you already were. Once the user has granted these scopes,
// Google will reissue an access token without asking, and that is what we want.
//
// `access_type: 'offline'` went with it: it asks Google for a refresh token,
// which is only useful to a server that can exchange it using the client
// secret. Nothing here does that, so it bought nothing and added a line to the
// consent screen.
provider.setCustomParameters({});

let isSigningIn = false;
let cachedAccessToken: string | null = null;
// When the cached token dies. Google access tokens last an hour; before this
// was tracked, the first request after that hour simply failed and the user was
// asked to reconnect mid-session.
let tokenExpiresAt: number | null = null;
// One silent request at a time — several components ask for the token at once
// on load, and they should share one attempt rather than race.
let silentInFlight: Promise<string | null> | null = null;

function setToken(token: string | null, expiresAt: number | null) {
  cachedAccessToken = token;
  tokenExpiresAt = token ? expiresAt : null;
}

/**
 * Try to re-mint the Google API token without any UI. Returns null if that
 * isn't possible, which means "the user needs to press Connect" — not an error.
 */
async function trySilentToken(): Promise<string | null> {
  if (silentInFlight) return silentInFlight;
  silentInFlight = (async () => {
    try {
      const r = await silentAccessToken();
      if (r) setToken(r.token, r.expiresAt);
      return r ? r.token : null;
    } finally {
      silentInFlight = null;
    }
  })();
  return silentInFlight;
}

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken && tokenIsFresh(tokenExpiresAt)) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        // Signed in but holding no usable API token — the state that used to
        // put the "reconnect Google" prompt back on screen after every reload.
        // Ask for one silently first; only fall through if Google won't.
        const token = await trySilentToken();
        if (token && onAuthSuccess) onAuthSuccess(user, token);
        else if (!token && onAuthFailure) onAuthFailure();
      }
    } else {
      setToken(null, null);
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }
    // Firebase doesn't tell us when this token expires, so assume Google's
    // standard hour. Being wrong the safe way just costs one silent re-mint.
    setToken(credential.accessToken, Date.now() + 3600_000);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken && tokenIsFresh(tokenExpiresAt)) return cachedAccessToken;
  // Either we never had one (a reload) or the hour is up. Both used to surface
  // as "reconnect Google"; both are now a silent request first.
  return trySilentToken();
};

/**
 * Get a token, asking the user if that's the only way. For the explicit
 * "Connect Google Calendar" button, where a popup is expected.
 *
 * Returns null if GIS is unavailable — the caller should then fall back to
 * googleSignIn(), which is the pre-existing path and still works.
 */
export const connectGoogleAccess = async (): Promise<string | null> => {
  const silent = await trySilentToken();
  if (silent) return silent;
  const r = await interactiveAccessToken();
  if (!r) return null;
  setToken(r.token, r.expiresAt);
  return r.token;
};

// Clears the cached Google OAuth access token WITHOUT signing the user out
// of Firebase Auth (that's logout() below, a much bigger action). Exists for
// exactly one reason: this token is read from more than one place now
// (FamilyCalendar.tsx's own connect/import/export UI, and Dashboard.tsx's
// automatic outbound calendar sync — see googleCalendarSync.ts), and a 401
// from the Google Calendar API means the token is dead everywhere, not just
// wherever happened to notice first. Whichever call site discovers the
// expiry calls this so every other reader of getAccessToken() immediately
// sees null too, instead of every reader independently retrying the same
// already-known-bad token until it individually hits its own 401.
export const invalidateAccessToken = () => {
  setToken(null, null);
};

export const logout = async () => {
  await auth.signOut();
  setToken(null, null);
};

// Firestore error handling as required by Firebase skill
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
