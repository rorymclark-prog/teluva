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
const config = isIOS && typeof window !== 'undefined'
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

export const loginWithGoogle = async () => {
  try {
    if (isIOS) {
      await signInWithRedirect(auth, provider);
      return;
    }
    await signInWithPopup(auth, provider);
  } catch (error: any) {
    const code = error?.code || '';
    const popupFailed = [
      'auth/popup-blocked',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/operation-not-supported-in-this-environment',
      'auth/web-storage-unsupported',
    ].includes(code);

    if (popupFailed) {
      // Popup was blocked (common on mobile/in-app browsers) — fall back to redirect.
      try {
        await signInWithRedirect(auth, provider);
        return;
      } catch (redirectError) {
        console.error('Redirect sign-in failed', redirectError);
      }
    }
    console.error('Login failed', error);
  }
};

export const logout = async () => {
  await signOut(auth);
};
