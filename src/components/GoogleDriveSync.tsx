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
  File
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  const [sharedDocs, setSharedDocs] = useState<SharedDoc[]>([]);
  
  // UX states
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [isSyncingFileId, setIsSyncingFileId] = useState<string | null>(null);
  const [driveSearch, setDriveSearch] = useState('');
  const [sharedSearch, setSharedSearch] = useState('');
  const [driveError, setDriveError] = useState<string | null>(null);

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

  // Listen to Firestore sharedDriveDocs in real-time
  useEffect(() => {
    const docsRef = collection(db, 'sharedDriveDocs');
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
  }, []);

  // Fetch from Google Drive when token becomes available
  useEffect(() => {
    if (token) {
      fetchDriveFiles();
    }
  }, [token]);

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
      setNeedsAuth(true);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Fetch real files from Google Drive REST API
  const fetchDriveFiles = async () => {
    if (!token) return;
    setIsDriveLoading(true);
    setDriveError(null);
    try {
      // Query parameters to get relevant formats (Docs, Sheets, Slides, PDFs)
      const q = encodeURIComponent(
        "mimeType = 'application/vnd.google-apps.document' or " +
        "mimeType = 'application/vnd.google-apps.spreadsheet' or " +
        "mimeType = 'application/vnd.google-apps.presentation' or " +
        "mimeType = 'application/pdf'"
      );
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=50&fields=files(id,name,mimeType,size,webViewLink)`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      // Check token scopes first if possible
      try {
        const tokenInfoRes = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`);
        if (tokenInfoRes.ok) {
          const tokenInfo = await tokenInfoRes.json();
          if (tokenInfo.scope && !tokenInfo.scope.includes('drive.readonly') && !tokenInfo.scope.includes('drive')) {
            setNeedsAuth(true);
            setToken(null);
            throw new Error('You did not grant Google Drive permissions. You MUST check the box for Google Drive on the sign-in screen.');
          }
        }
      } catch (e) {
        // Ignore tokeninfo fetch errors and proceed
      }

      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, require reauth
          setNeedsAuth(true);
          setToken(null);
          throw new Error('Google authorization token has expired. Please sign in again.');
        }
        throw new Error(`Google API returned error status: ${response.status}`);
      }

      const data = await response.json();
      setDriveFiles(data.files || []);
    } catch (err: any) {
      console.error('Google Drive Fetch Error:', err);
      setDriveError(err.message || 'Error communicating with Google Drive services.');
    } finally {
      setIsDriveLoading(false);
    }
  };

  // Sync a local Google Drive document metadata to Firestore shared collection
  const handleSyncToFamily = async (file: DriveFile) => {
    if (!user) return;
    setIsSyncingFileId(file.id);
    try {
      const firestoreDocRef = doc(db, 'sharedDriveDocs', file.id);
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

  // Remove a synced document from Firestore shared collection (Gated by confirmation dialog)
  const handleRemoveSynced = async (sharedDoc: SharedDoc) => {
    // Explicit user confirmation dialog as mandated by workspace skill
    const confirmed = window.confirm(
      `Remove document "${sharedDoc.name}" from the secure family shared catalog? Other household members will immediately lose access to this link.`
    );
    if (!confirmed) return;

    try {
      const firestoreDocRef = doc(db, 'sharedDriveDocs', sharedDoc.fileId);
      await deleteDoc(firestoreDocRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `sharedDriveDocs/${sharedDoc.fileId}`);
    }
  };

  const getMimeInfo = (mimeType: string) => {
    switch (mimeType) {
      case 'application/vnd.google-apps.document':
        return { label: 'Google Doc', color: 'text-blue-600 bg-blue-50 border-blue-100', icon: FileText };
      case 'application/vnd.google-apps.spreadsheet':
        return { label: 'Google Sheet', color: 'text-emerald-700 bg-emerald-50 border-emerald-100', icon: FileSpreadsheet };
      case 'application/vnd.google-apps.presentation':
        return { label: 'Google Slide', color: 'text-amber-600 bg-amber-50 border-amber-100', icon: FileCode };
      case 'application/pdf':
        return { label: 'PDF Document', color: 'text-red-600 bg-red-50 border-red-100', icon: File };
      default:
        return { label: 'File', color: 'text-gray-500 bg-gray-50 border-gray-100', icon: File };
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
  
  const filteredSharedDocs = sharedDocs.filter(f => 
    f.name.toLowerCase().includes(sharedSearch.toLowerCase())
  );

  return (
    <div className="bg-white border border-gray-150 rounded-2xl shadow-xs overflow-hidden min-h-[500px] flex flex-col font-sans">
      {/* Tab Banner Header info */}
      <div className="p-5 border-b border-gray-100 bg-gray-50/25 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-2 rounded-xl bg-gray-900 text-white shrink-0">
            <Cloud className="w-5 h-5 text-gray-100" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900 tracking-tight flex items-center gap-2">
              Google Drive Cloud Sync
              <span className="text-[10px] bg-sky-50 text-sky-700 px-2.5 py-0.5 rounded-full uppercase tracking-wider font-extrabold border border-sky-100">
                Drive API V3
              </span>
            </h2>
            <p className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wider font-bold">
              Securely index and synchronize critical household documentation from Google Drive
            </p>
          </div>
        </div>

        {/* User state connection dashboard / Google Sign-in */}
        <div>
          {needsAuth ? (
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="px-4 py-2 bg-gray-950 hover:bg-black disabled:bg-gray-400 text-white rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer flex items-center gap-2.5 shadow-xs select-none"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.62-.63-1.04-1.37-1.19-2.63z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Connect Google Account</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex items-center space-x-3.5">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5 justify-end">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                  Connected
                </p>
                <p className="text-[10px] text-gray-400 truncate max-w-[200px]">
                  {user?.email}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 border border-gray-200 text-gray-650 hover:bg-gray-50 text-[10px] font-bold uppercase tracking-wider rounded-xl cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-gray-150">
        
        {/* Drive Explorer (Only Visible when signed in) */}
        <div className="lg:col-span-6 p-5 flex flex-col min-h-[300px]">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
              My Google Drive
              <span className="text-[10px] bg-gray-100 text-gray-650 px-2 py-0.5 rounded-full font-mono font-bold">
                {needsAuth ? 0 : filteredDriveFiles.length}
              </span>
            </h3>

            {!needsAuth && (
              <button
                onClick={fetchDriveFiles}
                disabled={isDriveLoading}
                className="p-1 px-2 hover:bg-gray-100 text-gray-500 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                title="Refresh Google Drive files list"
              >
                <RefreshCcw className={`w-3 h-3 ${isDriveLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            )}
          </div>

          {driveError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-150 text-red-700 rounded-xl text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <p className="leading-relaxed">{driveError}</p>
            </div>
          )}

          {needsAuth ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-100 shadow-2xs">
                <Lock className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Account Connection Locked</h4>
                <p className="text-xs text-gray-400 max-w-xs font-light leading-relaxed">
                  Authenticate your Google profile to securely retrieve digital certifications, plans, or medical records directly from your personal Drive space.
                </p>
              </div>
              <button
                onClick={handleLogin}
                className="px-4 py-2 bg-sky-50 hover:bg-sky-100/80 border border-sky-200 text-sky-800 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer"
              >
                Sign In With Google
              </button>
            </div>
          ) : (
            <div className="flex-1 mt-4 flex flex-col">
              {/* Filter */}
              <div className="relative mb-3.5">
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Query Docs, Sheets, PDFs in your Drive..."
                  value={driveSearch}
                  onChange={(e) => setDriveSearch(e.target.value)}
                  className="w-full pl-8.5 pr-4 py-1.5 border border-gray-250 rounded-xl text-xs focus:ring-1 focus:ring-gray-900 focus:outline-none focus:border-gray-900 placeholder:text-gray-400"
                />
              </div>

              {/* Loader */}
              {isDriveLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-gray-800 animate-spin mb-2" />
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Querying Cloud Files Catalog...</p>
                </div>
              ) : filteredDriveFiles.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-gray-400">
                  <p className="text-xs italic">No compatible files found in this Drive folder.</p>
                  <p className="text-[10px] mt-1 text-gray-350 max-w-[240px] font-light leading-snug">
                    Upload a file (Google Doc, Sheet, or PDF) to your personal Google Drive account to list it here.
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2 max-h-[340px] pr-1.5">
                  {filteredDriveFiles.map((file) => {
                    const mime = getMimeInfo(file.mimeType);
                    const Icon = mime.icon;
                    const isSynced = sharedDocs.some(sd => sd.fileId === file.id);

                    return (
                      <div
                        key={file.id}
                        className="p-3 border border-gray-150 rounded-xl hover:bg-gray-50/50 flex items-center justify-between gap-3 transition-colors text-xs"
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className={`p-2 rounded-lg shrink-0 border ${mime.color}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-gray-900 truncate" title={file.name}>
                              {file.name}
                            </h4>
                            <p className="text-[9px] text-gray-440 font-bold uppercase tracking-wider mt-0.5">
                              {mime.label}
                            </p>
                          </div>
                        </div>

                        <div>
                          {isSynced ? (
                            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-lg text-[9px] font-extrabold uppercase tracking-wider border border-emerald-100 flex items-center gap-1 whitespace-nowrap">
                              <Check className="w-3 h-3 text-emerald-600" />
                              Synced
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSyncToFamily(file)}
                              disabled={isSyncingFileId === file.id}
                              className="px-3 py-1 bg-gray-950 hover:bg-black text-white rounded-lg text-[9px] font-bold uppercase tracking-wider cursor-pointer whitespace-nowrap disabled:opacity-40"
                            >
                              {isSyncingFileId === file.id ? 'Syncing...' : 'Sync File'}
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
        <div className="lg:col-span-6 p-5 flex flex-col bg-gray-50/25 min-h-[300px]">
          <div className="pb-3 border-b border-gray-100">
            <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
              Synced Family Documentation
              <span className="text-[10px] bg-gray-950 text-white px-2.5 py-0.5 rounded-full font-mono font-bold">
                {sharedDocs.length}
              </span>
            </h3>
          </div>

          <div className="flex-1 mt-4 flex flex-col">
            <div className="relative mb-3.5">
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Find shared docs seen by the household..."
                value={sharedSearch}
                onChange={(e) => setSharedSearch(e.target.value)}
                className="w-full pl-8.5 pr-4 py-1.5 border border-gray-250 bg-white rounded-xl text-xs focus:ring-1 focus:ring-gray-900 focus:outline-none focus:border-gray-900 placeholder:text-gray-400"
              />
            </div>

            {filteredSharedDocs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-400 border border-dashed border-gray-200 rounded-2xl bg-white">
                <CloudLightning className="w-8 h-8 text-gray-300 mb-2.5" />
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">No Docs Synced Yet</h4>
                <p className="text-[11px] text-gray-400 mt-1 max-w-[240px] leading-relaxed font-light">
                  Documents selected in your personal Google Drive window will sync down here for general family viewing instantly!
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[340px] pr-1.5">
                {filteredSharedDocs.map((doc) => {
                  const mime = getMimeInfo(doc.mimeType);
                  const Icon = mime.icon;

                  return (
                    <div
                      key={doc.id}
                      className="p-3 bg-white border border-gray-150 rounded-xl hover:border-gray-300 shadow-2xs flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className={`p-2 rounded-lg shrink-0 border ${mime.color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-semibold text-gray-950 truncate" title={doc.name}>
                            {doc.name}
                          </h4>
                          <p className="text-[9px] text-gray-450 font-bold uppercase tracking-wider flex items-center gap-1 flex-wrap mt-0.5">
                            <span>{mime.label}</span>
                            <span>•</span>
                            <span>By {doc.syncedBy.split(' ')[0]}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5 select-none shrink-0">
                        <a
                          href={doc.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 px-2.5 border border-gray-150 hover:bg-gray-50 text-gray-700 hover:text-gray-950 rounded-lg text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors"
                          title="Open document in Google client window"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>View</span>
                        </a>
                        <button
                          onClick={() => handleRemoveSynced(doc)}
                          className="p-1 px-1.5 hover:bg-red-50 text-gray-400 hover:text-red-650 rounded-lg transition-colors cursor-pointer"
                          title="Unsync and wipe metadata"
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
