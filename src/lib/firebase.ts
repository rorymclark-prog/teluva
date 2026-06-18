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
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const provider = new GoogleAuthProvider();

// iOS Safari blocks the sign-in popup and partitions its storage, so popup
// sign-in silently fails there. Detect iOS and use a full-page redirect, which
// works reliably. (Desktop keeps the smoother popup.)
const isIOS = typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports as Mac, so also catch touch-capable "Mac"
    (/Macintosh/.test(navigator.userAgent) && typeof document !== 'undefined' && 'ontouchend' in document));

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
