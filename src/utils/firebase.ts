import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { silentAccessToken, interactiveAccessToken, chooseAccountAccessToken, tokenIsFresh } from './googleToken';
import { GOOGLE_SCOPES } from './googleScopes';

// Single shared Firebase app — initialized once in lib/firebase.ts.
export { auth, db };

const provider = new GoogleAuthProvider();
// Scoped to exactly what the app's code does with the token — see
// GoogleDriveSync.tsx and FamilyCalendar.tsx (reads/writes events on the
// primary calendar only, never manages calendars themselves).
//
// The Drive scope is CONDITIONAL — see googleScopes.ts for why. Short
// version: drive.readonly is a Google "restricted" scope requiring an
// annual CASA security assessment, kept only until GoogleDriveSync.tsx's
// Picker integration has its API key configured; drive.file (narrow,
// non-sensitive, no CASA requirement) takes over automatically once it does.
//
// Removed: auth/drive (full read+write+delete of every file — nothing in
// this app ever creates/updates/deletes a Drive file), auth/calendar (full
// calendar management, including deleting calendars — this app only ever
// touches events on the user's "primary" calendar via calendar.events).
GOOGLE_SCOPES.forEach((scope) => provider.addScope(scope));

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

// When the last silent attempt failed. Retrying on every getAccessToken() call
// achieves nothing — if Google wouldn't mint a token a moment ago it won't now
// — and each attempt writes a blocked-popup error to the console. Observed on
// the deployed app: two identical GSI popup failures on a plain page load.
let silentFailedAt = 0;
const SILENT_RETRY_MS = 5 * 60_000;

// WHY DISCONNECT NEEDS A PERSISTED FLAG AND NOT JUST A CLEARED TOKEN.
//
// Clearing cachedAccessToken alone is a disconnect that undoes itself. The
// GRANT still exists at Google, so the very next getAccessToken() — an
// automatic sync, a reload, anything — re-mints a token silently and the
// connection is simply back, without anybody pressing a thing. The person
// pressed Disconnect, watched it say Offline, reopened the app and found it
// Connected again: worse than having no button at all, because it looks like
// the app ignored them.
//
// Keyed by uid, so two people sharing a laptop do not inherit each other's
// choice, and cleared the moment someone deliberately presses Connect.
const DISCONNECT_KEY = 'teluva.gcal.disconnected';

function readDisconnected(uid: string | undefined | null): boolean {
  if (!uid) return false;
  try { return localStorage.getItem(`${DISCONNECT_KEY}.${uid}`) === '1'; } catch { return false; }
}

function writeDisconnected(uid: string | undefined | null, off: boolean) {
  if (!uid) return;
  // A browser that refuses storage (private mode) still gets the in-memory
  // clear below for this session — it just cannot remember the choice across
  // a reload. Losing the preference is acceptable; throwing here would abort
  // the disconnect itself, which is not.
  try {
    if (off) localStorage.setItem(`${DISCONNECT_KEY}.${uid}`, '1');
    else localStorage.removeItem(`${DISCONNECT_KEY}.${uid}`);
  } catch { /* no storage: session-only disconnect */ }
}

/**
 * Try to re-mint the Google API token without any UI. Returns null if that
 * isn't possible, which means "the user needs to press Connect" — not an error.
 */
async function trySilentToken(): Promise<string | null> {
  // No signed-in user means there is nobody to mint a token FOR. Without this
  // guard the signed-out login screen fired a Google token request of its own,
  // which the browser then blocked as an uninvited popup.
  if (!auth.currentUser) return null;
  // The deliberate disconnect. Checked here rather than in getAccessToken so
  // that EVERY silent path is covered, including initAuth's own on reload.
  if (readDisconnected(auth.currentUser.uid)) return null;
  if (silentInFlight) return silentInFlight;
  if (Date.now() - silentFailedAt < SILENT_RETRY_MS) return null;

  silentInFlight = (async () => {
    try {
      const r = await silentAccessToken();
      if (r) {
        setToken(r.token, r.expiresAt);
        silentFailedAt = 0;
        return r.token;
      }
      silentFailedAt = Date.now();
      return null;
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
export const connectGoogleAccess = async (
  options?: { chooseAccount?: boolean },
): Promise<string | null> => {
  // Pressing Connect IS the un-disconnect, and the flag must be cleared before
  // the silent attempt below — trySilentToken refuses to mint while it is set.
  writeDisconnected(auth.currentUser?.uid, false);
  // `chooseAccount` skips the silent path on purpose: a silent mint would hand
  // back the account already attached, which is the one the person is trying
  // to move away from.
  if (!options?.chooseAccount) {
    const silent = await trySilentToken();
    if (silent) return silent;
  }
  const r = options?.chooseAccount
    ? await chooseAccountAccessToken()
    : await interactiveAccessToken();
  if (!r) return null;
  setToken(r.token, r.expiresAt);
  return r.token;
};

/**
 * Detach the Google account from calendar sync, and MEAN it — see
 * DISCONNECT_KEY above for why clearing the token alone is not enough.
 *
 * Deliberately not a Google-side revoke: the same grant covers Drive import,
 * and someone turning off calendar sync has not asked to lose that too. Nothing
 * further is read or written until they connect again.
 */
export const disconnectGoogleAccess = () => {
  writeDisconnected(auth.currentUser?.uid, true);
  setToken(null, null);
  silentFailedAt = 0;
};

/** Whether the CURRENT user chose to stay disconnected. */
export const isGoogleDisconnected = (): boolean => readDisconnected(auth.currentUser?.uid);

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
  // A 401 means the token died, which is precisely the case a silent re-mint
  // is for — so clear the back-off rather than sitting out the next five
  // minutes with no token at all.
  silentFailedAt = 0;
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
