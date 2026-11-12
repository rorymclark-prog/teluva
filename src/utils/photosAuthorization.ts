import { GOOGLE_OAUTH_CLIENT_ID, loadGis } from './googleToken';
import { PHOTOS_PICKER_SCOPE } from './googlePhotosPicker';

export { loadGis as preparePhotosAuthorization };
/** Call directly from a button click after GIS has loaded. This grant is
 * independent of Teluva's Drive/Calendar token and is never persisted. */
export function authorizePhotos(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth = window.google?.accounts?.oauth2;
    if (!oauth) { reject(new Error('Google sign-in is still loading. Try Connect Google Photos again in a moment.')); return; }
    let settled = false;
    const finish = (token?: string, message?: string) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
      if (token && !signal.aborted) resolve(token); else reject(new Error(message || 'Google Photos connection cancelled.'));
    };
    const cancel = () => finish();
    const timer = setTimeout(() => finish(undefined, 'Google Photos connection timed out. Try again.'), 120_000);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const client = oauth.initTokenClient({
        client_id: GOOGLE_OAUTH_CLIENT_ID, scope: PHOTOS_PICKER_SCOPE, include_granted_scopes: false,
        callback: response => finish(response.access_token, 'Google Photos permission was not granted. You can use selected photo files instead.'),
        error_callback: () => finish(undefined, 'Google sign-in did not finish. Allow the sign-in popup and try again.'),
      });
      client.requestAccessToken({ prompt: 'select_account' });
    } catch { finish(undefined, 'Google Photos could not connect. Try again or import selected photo files.'); }
  });
}
