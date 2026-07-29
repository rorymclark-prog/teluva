import React, { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from 'firebase/firestore';
import {
  db,
  auth,
  googleSignIn,
  initAuth,
  getAccessToken,
  logout,
  handleFirestoreError,
  OperationType
} from '../utils/firebase';
import { FAMILY_ID } from '../utils/db';
import {
  Cloud,
  CloudLightning,
  Check,
  Trash2,
  ExternalLink,
  Search,
  FileText,
  FileSpreadsheet,
  Sliders,
  Loader2,
  RefreshCcw,
  Lock,
  User,
  AlertCircle,
  FileCode,
  File,
  Folder,
  ChevronRight,
  HardDrive
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import EmptyState from './EmptyState';
import { openDrivePicker, listPickedFolder, PickedItem } from '../utils/googlePicker';
import { DRIVE_SCOPE_IS_NARROW } from '../utils/googleScopes';

interface SharedDoc {
  id: string; // matches Google Drive fileId
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  syncedBy: string;
  syncedAt: any;
  size?: number;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  size?: string;
}

export default function GoogleDriveSync() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Lists
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [sharedDocs, setSharedDocs] = useState<SharedDoc[]>([]);

  // Folder navigation — breadcrumb trail starting at the Drive root
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'My Drive' }]);
  const [isSyncingFolder, setIsSyncingFolder] = useState(false);

  // UX states
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [isSyncingFileId, setIsSyncingFileId] = useState<string | null>(null);
  const [driveSearch, setDriveSearch] = useState('');
  const [sharedSearch, setSharedSearch] = useState('');
  const [driveError, setDriveError] = useState<string | null>(null);

  // Picker path (drive.file scope) — see googleScopes.ts / googlePicker.ts.
  const [isPicking, setIsPicking] = useState(false);
  const [pickerNote, setPickerNote] = useState<string | null>(null);

  // Initialize Auth listeners
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, cachedToken) => {
        setUser(currentUser);
        setToken(cachedToken);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
        setUser(null);
        setToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Listen to Firestore sharedDriveDocs in real-time — scoped to the signed-in user
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      // No authenticated user — clear list, do not subscribe
      setSharedDocs([]);
      return;
    }

    // Shared household path: families/{FAMILY_ID}/sharedDriveDocs
    const docsRef = collection(db, 'families', FAMILY_ID, 'sharedDriveDocs');
    const unsubscribe = onSnapshot(docsRef, (snapshot) => {
      const docs: SharedDoc[] = [];
      snapshot.forEach((firestoreDoc) => {
        const data = firestoreDoc.data();
        docs.push({
          id: firestoreDoc.id,
          fileId: data.fileId || firestoreDoc.id,
          name: data.name || '',
          mimeType: data.mimeType || '',
          webViewLink: data.webViewLink || '',
          syncedBy: data.syncedBy || 'Family Member',
          syncedAt: data.syncedAt,
          size: data.size
        });
      });
      setSharedDocs(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sharedDriveDocs');
    });

    return () => unsubscribe();
  // Re-subscribe if the Firebase auth user changes
  }, [auth.currentUser?.uid]);

  // Fetch the current folder's contents when token or folder changes.
  // Skipped entirely under drive.file: that scope has no standing ability to
  // list an arbitrary folder (not even 'root'), only files/folders the Picker
  // has explicitly handed the app — see handleOpenPicker below.
  useEffect(() => {
    if (token && !DRIVE_SCOPE_IS_NARROW) {
      fetchFolder(folderPath[folderPath.length - 1].id);
    }
  }, [token, folderPath]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setDriveError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err: any) {
      console.error('Google Auth login failed:', err);
      setDriveError('Failed to sign in with Google or fetch credentials.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setToken(null);
      setUser(null);
      setDriveFiles([]);
      setFolders([]);
      setFolderPath([{ id: 'root', name: 'My Drive' }]);
      setNeedsAuth(true);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Fetch the folders + files inside a Drive folder (root = 'root')
  const fetchFolder = async (folderId: string) => {
    if (!token) return;
    setIsDriveLoading(true);
    setDriveError(null);
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=200&orderBy=name&fields=files(id,name,mimeType,size,webViewLink)`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, require reauth
          setNeedsAuth(true);
          setToken(null);
          throw new Error('Google authorisation token has expired. Please sign in again.');
        }
        if (response.status === 403) {
          throw new Error('Google Drive permission missing — sign out and sign in again, ticking the Google Drive box.');
        }
        throw new Error(`Google API returned error status: ${response.status}`);
      }

      const data = await response.json();
      const all: DriveFile[] = data.files || [];
      const FOLDER_MIME = 'application/vnd.google-apps.folder';
      setFolders(all.filter(f => f.mimeType === FOLDER_MIME));
      setDriveFiles(all.filter(f => f.mimeType !== FOLDER_MIME));
    } catch (err: any) {
      console.error('Google Drive Fetch Error:', err);
      setDriveError(err.message || 'Error communicating with Google Drive services.');
    } finally {
      setIsDriveLoading(false);
    }
  };

  // Drill into a subfolder / jump back via the breadcrumb
  const openFolder = (folder: DriveFile) => {
    setDriveSearch('');
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
  };
  const goToCrumb = (index: number) => {
    setDriveSearch('');
    setFolderPath(prev => prev.slice(0, index + 1));
  };

  // Sync EVERY file in the current folder to the family vault in one go
  const handleSyncFolder = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !user || driveFiles.length === 0) return;
    setIsSyncingFolder(true);
    try {
      await Promise.all(driveFiles.map(file =>
        setDoc(doc(db, 'families', FAMILY_ID, 'sharedDriveDocs', file.id), {
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          syncedBy: user.displayName || user.email || 'Family Admin',
          syncedAt: serverTimestamp(),
          size: file.size ? parseInt(file.size, 10) : null
        })
      ));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'sharedDriveDocs (folder sync)');
    } finally {
      setIsSyncingFolder(false);
    }
  };

  // Sync a local Google Drive document metadata to Firestore — scoped to the signed-in user
  const handleSyncToFamily = async (file: DriveFile) => {
    if (!user) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setIsSyncingFileId(file.id);
    try {
      // Shared household path: families/{FAMILY_ID}/sharedDriveDocs/{fileId}
      const firestoreDocRef = doc(db, 'families', FAMILY_ID, 'sharedDriveDocs', file.id);
      await setDoc(firestoreDocRef, {
        fileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        syncedBy: user.displayName || user.email || 'Family Admin',
        syncedAt: serverTimestamp(),
        size: file.size ? parseInt(file.size, 10) : null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `sharedDriveDocs/${file.id}`);
    } finally {
      setIsSyncingFileId(null);
    }
  };

  // Write picked items to the shared catalog — the drive.file counterpart of
  // handleSyncToFamily/handleSyncFolder above, taking whatever the Picker (or
  // a folder listed via listPickedFolder) handed back instead of a DriveFile
  // read from an open-ended folder browse.
  const syncPickedItems = async (items: PickedItem[]) => {
    if (!user || !items.length) return;
    await Promise.all(items.map((item) =>
      setDoc(doc(db, 'families', FAMILY_ID, 'sharedDriveDocs', item.id), {
        fileId: item.id,
        name: item.name,
        mimeType: item.mimeType,
        webViewLink: item.webViewLink || '',
        syncedBy: user.displayName || user.email || 'Family Admin',
        syncedAt: serverTimestamp(),
        size: item.sizeBytes ?? null,
      })));
  };

  // Open Google's Picker, then sync whatever came back. A picked FOLDER is
  // listed one level deep and every file inside it is synced too — that only
  // works because drive.file access to a folder's contents is granted the
  // instant the user selects it through the Picker (see googlePicker.ts).
  const handleOpenPicker = async () => {
    if (!token) return;
    setIsPicking(true);
    setDriveError(null);
    setPickerNote(null);
    try {
      const picked = await openDrivePicker(token);
      if (!picked.length) return;   // cancelled — not an error

      const files = picked.filter((p) => !p.isFolder);
      const folders = picked.filter((p) => p.isFolder);

      const fromFolders = (await Promise.all(
        folders.map((f) => listPickedFolder(token, f.id).catch((e) => {
          console.error('[GoogleDriveSync] could not list a picked folder:', e);
          return [] as PickedItem[];
        })),
      )).flat();

      const all = [...files, ...fromFolders];
      if (!all.length) {
        setPickerNote(folders.length ? 'That folder had nothing in it to sync.' : null);
        return;
      }
      await syncPickedItems(all);
      setPickerNote(`Synced ${all.length} ${all.length === 1 ? 'file' : 'files'} to the family vault.`);
    } catch (err: any) {
      console.error('[GoogleDriveSync] Picker error:', err);
      setDriveError(err?.message || 'Could not open Google Drive just now.');
    } finally {
      setIsPicking(false);
    }
  };

  // Remove a synced document from Firestore — scoped to the signed-in user
  const handleRemoveSynced = async (sharedDoc: SharedDoc) => {
    // Explicit user confirmation dialog as mandated by workspace skill
    const confirmed = window.confirm(
      `Remove document "${sharedDoc.name}" from the secure family shared catalog? Other household members will immediately lose access to this link.`
    );
    if (!confirmed) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      // Shared household path: families/{FAMILY_ID}/sharedDriveDocs/{fileId}
      const firestoreDocRef = doc(db, 'families', FAMILY_ID, 'sharedDriveDocs', sharedDoc.fileId);
      await deleteDoc(firestoreDocRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `sharedDriveDocs/${sharedDoc.fileId}`);
    }
  };

  const getMimeInfo = (mimeType: string) => {
    switch (mimeType) {
      case 'application/vnd.google-apps.document':
        return { label: 'Google Doc', chipClass: 'bg-dusk-100 text-dusk-700 border-dusk-100', icon: FileText };
      case 'application/vnd.google-apps.spreadsheet':
        return { label: 'Google Sheet', chipClass: 'bg-sage-100 text-sage-700 border-sage-200', icon: FileSpreadsheet };
      case 'application/vnd.google-apps.presentation':
        return { label: 'Google Slide', chipClass: 'bg-honey-100 text-honey-700 border-honey-200', icon: FileCode };
      case 'application/pdf':
        return { label: 'PDF Document', chipClass: 'bg-rosa-100 text-rosa-700 border-rosa-100', icon: File };
      default:
        return { label: 'File', chipClass: 'bg-cream-100 text-ink-500 border-cream-300', icon: File };
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '—';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Filter listings
  const filteredDriveFiles = driveFiles.filter(f =>
    f.name.toLowerCase().includes(driveSearch.toLowerCase())
  );

  const filteredFolders = folders.filter(f =>
    f.name.toLowerCase().includes(driveSearch.toLowerCase())
  );

  const filteredSharedDocs = sharedDocs.filter(f =>
    f.name.toLowerCase().includes(sharedSearch.toLowerCase())
  );

  return (
    <div className="card overflow-hidden min-h-[500px] flex flex-col font-sans">
      {/* Tab Banner Header info */}
      <div className="p-5 border-b border-cream-200 bg-cream-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-2 rounded-xl bg-ink-800 text-white shrink-0">
            <Cloud className="w-5 h-5 text-cream-100" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
              Google Drive Sync
              <span className="chip bg-dusk-100 text-dusk-700 border border-dusk-100">
                Drive API v3
              </span>
            </h2>
            <p className="text-[13px] font-semibold text-ink-500 mt-0.5">
              Securely index and synchronise household documentation from Google Drive
            </p>
          </div>
        </div>

        {/* User state connection dashboard / Google Sign-in */}
        <div>
          {needsAuth ? (
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="btn-primary disabled:opacity-50"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.62-.63-1.04-1.37-1.19-2.63z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Connect Google account</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center space-x-3.5">
              <div className="text-right hidden sm:block">
                <p className="text-[13px] font-semibold text-ink-800 flex items-center gap-1.5 justify-end">
                  <span className="w-1.5 h-1.5 bg-sage-500 rounded-full"></span>
                  Connected
                </p>
                <p className="text-[13px] text-ink-400 truncate max-w-[200px]">
                  {user?.email}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="btn-quiet text-sm px-3 py-1.5"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-cream-200">

        {/* Drive Explorer (Only visible when signed in) */}
        <div className="lg:col-span-6 p-5 flex flex-col min-h-[300px]">
          <div className="flex items-center justify-between pb-3 border-b border-cream-200">
            <h3 className="text-[13px] font-semibold text-ink-800 flex items-center gap-1.5">
              My Google Drive
              {!DRIVE_SCOPE_IS_NARROW && (
                <span className="chip bg-cream-200 text-ink-600 font-mono">
                  {needsAuth ? 0 : filteredFolders.length + filteredDriveFiles.length}
                </span>
              )}
            </h3>

            {!needsAuth && !DRIVE_SCOPE_IS_NARROW && (
              <div className="flex items-center gap-2">
                {driveFiles.length > 0 && (
                  <button
                    onClick={handleSyncFolder}
                    disabled={isSyncingFolder}
                    className="btn-primary text-xs px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50"
                    title="Sync every file in this folder to the family"
                  >
                    {isSyncingFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
                    <span>Sync folder ({driveFiles.length})</span>
                  </button>
                )}
                <button
                  onClick={() => fetchFolder(folderPath[folderPath.length - 1].id)}
                  disabled={isDriveLoading}
                  className="btn-quiet text-sm px-2.5 py-1.5 flex items-center gap-1"
                  title="Refresh this folder"
                >
                  <RefreshCcw className={`w-3 h-3 ${isDriveLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
            )}
          </div>

          {driveError && (
            <div className="mt-3 p-3 bg-rosa-50 border border-rosa-100 text-rosa-700 rounded-2xl text-[13px] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rosa-500 mt-0.5 shrink-0" />
              <p className="leading-relaxed">{driveError}</p>
            </div>
          )}

          {needsAuth ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-dusk-50 text-dusk-500 flex items-center justify-center border border-dusk-100 shadow-soft">
                <Lock className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-[13px] font-semibold text-ink-700">Account connection locked</h4>
                <p className="text-[13px] text-ink-400 max-w-xs font-light leading-relaxed">
                  Authenticate your Google profile to securely retrieve digital certifications, plans, or medical records directly from your personal Drive space.
                </p>
              </div>
              <button
                onClick={handleLogin}
                className="btn-quiet"
              >
                Sign in with Google
              </button>
            </div>
          ) : DRIVE_SCOPE_IS_NARROW ? (
            // Picker path: no folder browser, because drive.file grants no
            // standing ability to list one — only files/folders the user just
            // handed the app through Google's own widget (googlePicker.ts).
            <div className="flex-1 mt-4 flex flex-col items-center justify-center text-center gap-4 p-8">
              <div className="w-12 h-12 rounded-2xl bg-dusk-50 text-dusk-500 flex items-center justify-center border border-dusk-100 shadow-soft">
                <HardDrive className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-[13px] font-semibold text-ink-700">Choose what to share</h4>
                <p className="text-[13px] text-ink-400 max-w-xs font-light leading-relaxed">
                  Open Google&rsquo;s own picker to choose files or a whole folder. Teluva only ever
                  sees what you pick there — nothing else in your Drive.
                </p>
              </div>
              <button
                onClick={handleOpenPicker}
                disabled={isPicking}
                className="btn-primary disabled:opacity-50"
              >
                {isPicking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                <span>{isPicking ? 'Opening…' : 'Choose from Google Drive'}</span>
              </button>
              {pickerNote && (
                <p className="text-[12.5px] text-sage-700 bg-sage-50 border border-sage-200 rounded-xl px-3 py-2 max-w-xs">
                  {pickerNote}
                </p>
              )}
            </div>
          ) : (
            <div className="flex-1 mt-4 flex flex-col">
              {/* Breadcrumb */}
              <div className="flex items-center flex-wrap gap-0.5 mb-3 text-[12px] font-semibold">
                {folderPath.map((crumb, i) => (
                  <span key={crumb.id} className="flex items-center gap-0.5">
                    {i > 0 && <ChevronRight className="w-3 h-3 text-ink-300" />}
                    <button
                      onClick={() => goToCrumb(i)}
                      disabled={i === folderPath.length - 1}
                      className={`px-1.5 py-0.5 rounded-md flex items-center gap-1 ${
                        i === folderPath.length - 1
                          ? 'text-ink-800'
                          : 'text-ink-400 hover:text-ink-700 hover:bg-cream-100'
                      }`}
                    >
                      {i === 0 && <HardDrive className="w-3 h-3" />}
                      <span className="truncate max-w-[140px]">{crumb.name}</span>
                    </button>
                  </span>
                ))}
              </div>

              {/* Filter */}
              <div className="relative mb-3.5">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-ink-400" />
                <input
                  type="text"
                  placeholder="Search this folder…"
                  value={driveSearch}
                  onChange={(e) => setDriveSearch(e.target.value)}
                  className="field pl-8.5"
                />
              </div>

              {/* Folders in this directory */}
              {!isDriveLoading && filteredFolders.length > 0 && (
                <div className="space-y-2 mb-2">
                  {filteredFolders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => openFolder(folder)}
                      className="w-full p-3 border border-cream-300 rounded-2xl hover:bg-cream-50 flex items-center justify-between gap-3 transition-colors text-[13px] text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded-xl shrink-0 bg-honey-100 text-honey-700">
                          <Folder className="w-4 h-4" />
                        </div>
                        <h4 className="font-semibold text-ink-800 truncate" title={folder.name}>{folder.name}</h4>
                      </div>
                      <ChevronRight className="w-4 h-4 text-ink-300 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* Loader */}
              {isDriveLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-ink-700 animate-spin mb-2" />
                  <p className="text-[13px] font-semibold text-ink-400">Querying cloud files…</p>
                </div>
              ) : filteredDriveFiles.length === 0 ? (
                filteredFolders.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-ink-400">
                    <p className="text-[13px] italic">{driveSearch ? 'Nothing matches your search here.' : 'This folder is empty.'}</p>
                    <p className="text-[13px] mt-1 text-ink-400 max-w-[240px] font-light leading-snug">
                      Open a folder above, or add files to it in Google Drive.
                    </p>
                  </div>
                ) : null
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2 max-h-[340px] pr-1.5">
                  {filteredDriveFiles.map((file) => {
                    const mime = getMimeInfo(file.mimeType);
                    const Icon = mime.icon;
                    const isSynced = sharedDocs.some(sd => sd.fileId === file.id);

                    return (
                      <div
                        key={file.id}
                        className="p-3 border border-cream-300 rounded-2xl hover:bg-cream-50 flex items-center justify-between gap-3 transition-colors text-[13px]"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className={`p-2 rounded-xl shrink-0 border chip ${mime.chipClass}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-ink-800 truncate" title={file.name}>
                              {file.name}
                            </h4>
                            <p className="text-[13px] font-semibold text-ink-500 mt-0.5">
                              {mime.label}
                            </p>
                          </div>
                        </div>

                        <div>
                          {isSynced ? (
                            <span className="chip bg-sage-100 text-sage-700 border border-sage-200 whitespace-nowrap">
                              <Check className="w-3 h-3 text-sage-600" />
                              Synced
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSyncToFamily(file)}
                              disabled={isSyncingFileId === file.id}
                              className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap disabled:opacity-40"
                            >
                              {isSyncingFileId === file.id ? 'Syncing…' : 'Sync file'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sync Panel List (Visible to all members) */}
        <div className="lg:col-span-6 p-5 flex flex-col bg-cream-50 min-h-[300px]">
          <div className="pb-3 border-b border-cream-200">
            <h3 className="text-[13px] font-semibold text-ink-800 flex items-center gap-1.5">
              Synced family documents
              <span className="chip bg-ink-800 text-white font-mono">
                {sharedDocs.length}
              </span>
            </h3>
          </div>

          <div className="flex-1 mt-4 flex flex-col">
            <div className="relative mb-3.5">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-ink-400" />
              <input
                type="text"
                placeholder="Find shared docs…"
                value={sharedSearch}
                onChange={(e) => setSharedSearch(e.target.value)}
                className="field pl-8.5"
              />
            </div>

            {filteredSharedDocs.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  icon={CloudLightning}
                  dashed
                  tone="dusk"
                  title="No docs synced yet"
                  description="Documents selected in your Google Drive window will sync here for family viewing instantly."
                />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[340px] pr-1.5">
                {filteredSharedDocs.map((doc) => {
                  const mime = getMimeInfo(doc.mimeType);
                  const Icon = mime.icon;

                  return (
                    <div
                      key={doc.id}
                      className="p-3 bg-white border border-cream-300 rounded-2xl hover:border-cream-400 shadow-soft flex items-center justify-between gap-3 text-[13px]"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className={`p-2 rounded-xl shrink-0 border chip ${mime.chipClass}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-ink-900 truncate" title={doc.name}>
                            {doc.name}
                          </h4>
                          <p className="text-[13px] font-semibold text-ink-500 flex items-center gap-1 flex-wrap mt-0.5">
                            <span>{mime.label}</span>
                            <span>·</span>
                            <span>By {doc.syncedBy.split(' ')[0]}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 select-none shrink-0">
                        <a
                          href={doc.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-quiet text-xs px-2.5 py-1.5 flex items-center gap-1"
                          title="Open document in Google"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>View</span>
                        </a>
                        <button
                          onClick={() => handleRemoveSynced(doc)}
                          className="p-1.5 hover:bg-rosa-50 text-ink-400 hover:text-rosa-700 rounded-xl transition-colors cursor-pointer"
                          title="Remove from shared catalog"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
