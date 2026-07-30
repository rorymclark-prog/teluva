// The single source of truth for which Google OAuth scopes this app requests.
//
// firebase.ts (the sign-in popup) and googleToken.ts (silent re-acquisition)
// MUST request the exact same scope set — a silent request for a scope the
// user never granted just fails and falls back to an interactive prompt every
// time. Duplicating the list in both files is how that invariant breaks
// quietly; this file exists so there is exactly one place to get it right.
//
// DRIVE SCOPE IS CONDITIONAL, not a constant, and that is the whole point of
// this file. `drive.readonly` is a Google "restricted" scope — it grants read
// access to the user's ENTIRE Drive and requires an annual CASA security
// assessment before the app can go public. `drive.file` is narrow and
// non-sensitive: the app only ever sees files the user explicitly hands it,
// one at a time, through Google's own Picker UI.
//
// The two are not interchangeable at the UI layer, though: `drive.file`
// cannot power an arbitrary folder browser (GoogleDriveSync.tsx's old
// breadcrumb explorer), because the app has no standing access to list a
// folder it wasn't handed. It only works once the Picker widget is wired up
// to hand the app what the user picked — and the Picker widget needs its own
// Google Cloud API key (a public, referrer-restricted credential, not a
// secret) to run at all.
//
// So: scope tracks whether that key exists. Until it does, the app keeps
// requesting drive.readonly and the old folder browser keeps working exactly
// as it does today. The moment the key is set, new sign-ins request
// drive.file instead and GoogleDriveSync.tsx switches its UI to the Picker.
// Existing sessions fall back to an interactive reconnect the first time a
// silent token request meets the new scope, which is the normal, documented
// behaviour in googleToken.ts — not a bug introduced here.
//
// HARDCODED DEFAULT, same pattern as CLIENT_ID in googleToken.ts, and for the
// same reason: this key is restricted to the Picker API and locked by HTTP
// referrer to this app's own origins (see .env.example for the exact create
// command), not a secret — it ships to every browser that loads the app
// either way, since the Picker widget needs it client-side to run at all.
// The alternative (an env var read at `npm run build` time) does not
// actually work with this project's deploy pipeline: `gcloud builds submit`
// auto-generates a .gcloudignore from .gitignore when none exists, and
// `.env*` is gitignored, so a real .env file never reaches the Cloud Build
// context — `npm run build` inside the Docker stage would never have seen
// it. VITE_GOOGLE_PICKER_API_KEY is kept as an override for anyone running a
// different deployment with its own key.
//
// Optional chaining on `.env` itself, not just the key: this file is imported
// by googleScopes.test.ts, which runs under plain `tsx` (no Vite), where
// `import.meta.env` doesn't exist at all rather than being empty.
export const GOOGLE_PICKER_API_KEY: string | undefined =
  (import.meta.env?.VITE_GOOGLE_PICKER_API_KEY as string | undefined) ||
  'AIzaSyB465xLFo3mzTqo__w7J2nV27r2BAy_l9U';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/**
 * Pure so the conditional itself is testable without faking `import.meta.env`
 * — the module-level exports below just call this with the real value.
 */
export function driveScopeFor(pickerApiKey: string | undefined): string {
  return pickerApiKey ? DRIVE_FILE_SCOPE : DRIVE_READONLY_SCOPE;
}

export const DRIVE_SCOPE_IS_NARROW = Boolean(GOOGLE_PICKER_API_KEY);

export const GOOGLE_SCOPES = [driveScopeFor(GOOGLE_PICKER_API_KEY), GOOGLE_CALENDAR_SCOPE];
