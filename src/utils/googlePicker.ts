// Google's own file-picking UI, as the replacement for GoogleDriveSync.tsx's
// hand-rolled folder browser.
//
// WHY THIS EXISTS
// The old browser called Drive's files.list on whatever folder the user
// navigated to, which only works under `drive.readonly` — a scope that grants
// read access to the user's ENTIRE Drive and requires an annual CASA security
// assessment before this app can go public (see googleScopes.ts). The Picker
// is Google's own UI running in an iframe under Google's origin, so the app
// never sees a Drive listing it wasn't explicitly handed: the user picks
// files (or a folder) inside Google's widget, and only THOSE ids come back.
// That is what lets the OAuth scope narrow to `drive.file`.
//
// This file only loads and drives the widget. GoogleDriveSync.tsx decides
// what to do with what comes back.

import { GOOGLE_PICKER_API_KEY } from './googleScopes';

export interface PickedItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  webViewLink?: string;
  sizeBytes?: number;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GAPI_SRC = 'https://apis.google.com/js/api.js';

// googleToken.ts already declares a global `Window.google` (for GIS's
// oauth2 namespace) with a specific, incompatible shape — TypeScript requires
// every `declare global` augmentation of the same property to match exactly,
// so this file does NOT redeclare `google`. It only adds `gapi` (which
// nothing else declares) and reaches `window.google.picker` through a loose
// local cast instead. The real type comes from a Google-hosted script with no
// first-party TypeScript types, so this was already structural, not exact.
declare global {
  interface Window {
    gapi?: {
      load: (mod: string, cb: () => void) => void;
    };
  }
}

interface GoogleDocsView {
  setIncludeFolders: (v: boolean) => GoogleDocsView;
  setSelectFolderEnabled: (v: boolean) => GoogleDocsView;
  setMimeTypes?: (v: string) => GoogleDocsView;
}
interface GooglePickerBuilder {
  addView: (view: GoogleDocsView | unknown) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setCallback: (cb: (data: Record<string, any>) => void) => GooglePickerBuilder;
  enableFeature: (feature: unknown) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
}
interface GooglePickerNamespace {
  PickerBuilder: new () => GooglePickerBuilder;
  DocsView: new (viewId?: unknown) => GoogleDocsView;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: unknown; NAV_HIDDEN: unknown };
  Document: { ID: string; NAME: string; MIME_TYPE: string; URL: string; SIZE_BYTES: string };
  Response: { ACTION: string; DOCUMENTS: string };
}

/** `window.google.picker`, typed only here — see the comment above. */
function pickerNamespace(): GooglePickerNamespace | undefined {
  return (window as unknown as { google?: { picker?: GooglePickerNamespace } }).google?.picker;
}

let loadPromise: Promise<boolean> | null = null;

/** Loads the gapi loader script, then the 'picker' module. Never rejects. */
function loadPicker(): Promise<boolean> {
  if (pickerNamespace()) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<boolean>((resolve) => {
    const ready = () => {
      if (!window.gapi) return resolve(false);
      window.gapi.load('picker', () => resolve(!!pickerNamespace()));
    };

    if (window.gapi) return ready();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GAPI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', ready);
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const s = document.createElement('script');
    s.src = GAPI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = ready;
    s.onerror = () => {
      console.warn('[googlePicker] gapi script did not load');
      resolve(false);
    };
    document.head.appendChild(s);
  });

  return loadPromise;
}

/**
 * Open Google's Picker for the signed-in user's Drive. Resolves with
 * whatever the user picked — files and/or a folder, multi-select on — or an
 * empty array if they cancelled, the widget failed to load, or the developer
 * key isn't configured.
 *
 * `token` is the same Drive-scoped OAuth access token the rest of the app
 * already holds (see googleToken.ts). The Picker widget needs it to show the
 * user's own Drive; it never sees or stores it beyond that.
 */
export function openDrivePicker(token: string): Promise<PickedItem[]> {
  if (!GOOGLE_PICKER_API_KEY) {
    console.warn('[googlePicker] VITE_GOOGLE_PICKER_API_KEY is not set — cannot open the Picker');
    return Promise.resolve([]);
  }

  return loadPicker().then((ok) => {
    const picker = ok ? pickerNamespace() : undefined;
    if (!picker) return [];

    return new Promise<PickedItem[]>((resolve) => {
      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true);

      const builder = new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_PICKER_API_KEY as string)
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data: Record<string, any>) => {
          if (data[picker.Response.ACTION] !== picker.Action.PICKED) {
            if (data[picker.Response.ACTION] === picker.Action.CANCEL) resolve([]);
            return;
          }
          const docs = (data[picker.Response.DOCUMENTS] || []) as Record<string, any>[];
          resolve(docs.map((d) => ({
            id: d[picker.Document.ID],
            name: d[picker.Document.NAME],
            mimeType: d[picker.Document.MIME_TYPE],
            isFolder: d[picker.Document.MIME_TYPE] === FOLDER_MIME,
            webViewLink: d[picker.Document.URL],
            sizeBytes: d[picker.Document.SIZE_BYTES] ? Number(d[picker.Document.SIZE_BYTES]) : undefined,
          })));
        });

      builder.build().setVisible(true);
    });
  });
}

/**
 * List the immediate contents of a folder the user just handed the app
 * through the Picker. Only reachable AFTER a Picker pick — under `drive.file`
 * the app has no standing ability to list an arbitrary folder id, only one it
 * was just granted access to.
 */
export async function listPickedFolder(token: string, folderId: string): Promise<PickedItem[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=200&orderBy=name&fields=files(id,name,mimeType,size,webViewLink)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive returned ${res.status} listing a picked folder`);
  const data = await res.json();
  const files: Array<{ id: string; name: string; mimeType: string; size?: string; webViewLink?: string }> = data.files || [];
  return files
    .filter((f) => f.mimeType !== FOLDER_MIME)   // one level deep — nested folders are not auto-synced
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: false,
      webViewLink: f.webViewLink,
      sizeBytes: f.size ? Number(f.size) : undefined,
    }));
}
