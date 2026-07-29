import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// iOS Safari blocks the sign-in popup and partitions its storage, so popup
// sign-in silently fails there. Detect iOS and use a full-page redirect, which
// works reliably. (Desktop keeps the smoother popup.)
const isIOS = typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports as Mac, so also catch touch-capable "Mac"
    (/Macintosh/.test(navigator.userAgent) && typeof document !== 'undefined' && 'ontouchend' in document));

// Bulletproof iOS sign-in: serve Firebase's auth handler from OUR OWN origin
// (nginx proxies /__/auth -> the Firebase auth domain) so the OAuth handshake is
// same-origin and Safari's tracking prevention can't block it. Only iOS is
// switched — desktop keeps the proven firebaseapp.com authDomain + popup, so it
// can't regress. Requires the app domain to be an authorised domain (it is) and
// {origin}/__/auth/handler registered as an OAuth redirect URI (Firebase
// auto-syncs this from the authorised-domains list).
/* An INSTALLED app window (Add to Home Screen, or "Install" on a desktop
 * browser) needs the same treatment as iOS, for a different reason.
 *
 * Its sign-in popup is a child of an app window rather than a browser tab, and
 * password managers largely refuse to work there: on macOS the Apple Passwords
 * menu appears, and then closes without filling anything when you pick an
 * entry. Nothing on Google's page is ours to fix — but which window that page
 * opens in IS. A redirect keeps sign-in in the app's own top-level window,
 * where autofill and passkeys behave normally.
 *
 * Same-origin authDomain comes along with it, which also stops Google's consent
 * screen announcing "to continue to gen-lang-client-0384516171.firebaseapp.com"
 * — a string that reads as a phishing page to anyone being asked to trust the
 * app with their passport. */
const isStandalone = typeof window !== 'undefined' && (
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true
);

const useSameOriginAuth = (isIOS || isStandalone) && typeof window !== 'undefined';

const config = useSameOriginAuth
  ? { ...firebaseConfig, authDomain: window.location.host }
  : firebaseConfig;

const app = initializeApp(config);
export const auth = getAuth(app);

// ignoreUndefinedProperties: optional fields left blank (no birthdate, no photo)
// arrive as `undefined`, which Firestore otherwise REJECTS — that silently failed
// every new-member save, so added members vanished on refresh. Dropping undefined
// fields instead makes all writes (add/edit) robust.
export const db = initializeFirestore(
  app,
  { ignoreUndefinedProperties: true },
  firebaseConfig.firestoreDatabaseId
);

// Firebase Storage — the Document Vault stores real files here (not base64 in
// Firestore), so passports/certificates/scans of any size work.
export const storage = getStorage(app);

export const provider = new GoogleAuthProvider();

// Complete any pending redirect sign-in (the iOS path) when the app loads.
getRedirectResult(auth).catch((error) => {
  console.error('Redirect sign-in could not be completed', error);
});

/** Plain English for the failures a person can actually do something about. */
function signInMessage(code: string): string {
  switch (code) {
    case 'auth/unauthorized-domain':
      return `This address (${location.hostname}) isn't on the app's approved sign-in list, so Google refused the request. It needs adding under Authentication → Settings → Authorized domains.`;
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this app and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The sign-in window closed before it finished. Try again.';
    case 'auth/network-request-failed':
      return "Couldn't reach Google. Check your connection and try again.";
    case 'auth/web-storage-unsupported':
      return 'This browser is blocking the storage sign-in needs. Turn off private browsing or allow cookies for this app.';
    default:
      return `Sign-in failed${code ? ` (${code})` : ''}. Please try again.`;
  }
};

/**
 * Sign in, and SAY SO when it doesn't work.
 *
 * Every failure here used to end at console.error, so a person tapped the
 * button, nothing happened, and the app looked broken with no clue why — which
 * is exactly how it presented in the installed Mac app. The caller now gets a
 * message to put on screen.
 *
 * A redirect is tried whenever the popup path fails for any reason, not just
 * for a hand-listed set of codes: an installed PWA window is its own top-level
 * context and popups behave differently there than in a tab.
 *
 * @returns null on success (or when a redirect is under way), otherwise a
 *          human-readable reason.
 */
export const loginWithGoogle = async (): Promise<string | null> => {
  try {
    // iOS blocks the popup outright; an installed window opens it but strands
    // the password manager inside it. Both want the redirect.
    if (isIOS || isStandalone) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    await signInWithPopup(auth, provider);
    return null;
  } catch (error: any) {
    const code = error?.code || '';
    console.error('Popup sign-in failed', code, error);

    // A domain Google won't accept fails the same way through either path, so
    // there is nothing to gain by bouncing the user out to a redirect first.
    if (code !== 'auth/unauthorized-domain') {
      try {
        await signInWithRedirect(auth, provider);
        return null;
      } catch (redirectError: any) {
        console.error('Redirect sign-in failed', redirectError?.code, redirectError);
        return signInMessage(redirectError?.code || code);
      }
    }
    return signInMessage(code);
  }
};

export const logout = async () => {
  await signOut(auth);
  // Clear this device's cached family data so a different account signing in on
  // the same browser never sees the previous family's cache. Keeps 'fv_lang'
  // (device language) and Firebase's own auth keys untouched.
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('family_'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* non-fatal */ }
};
