import React, { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Camera, Upload, RefreshCcw, Save, Trash2 } from 'lucide-react';
import { FamilyMember, MemberRole } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface EditMemberModalProps {
  isOpen: boolean;
  member: FamilyMember | undefined;
  onClose: () => void;
  onSave: (updatedMember: FamilyMember) => void;
}

const AVATAR_COLORS = [
  { name: 'emerald', class: 'bg-emerald-500' },
  { name: 'indigo', class: 'bg-indigo-500' },
  { name: 'rose', class: 'bg-rose-500' },
  { name: 'amber', class: 'bg-amber-500' },
  { name: 'violet', class: 'bg-violet-500' },
  { name: 'sky', class: 'bg-sky-500' },
  { name: 'fuchsia', class: 'bg-fuchsia-500' }
];

export default function EditMemberModal({ isOpen, member, onClose, onSave }: EditMemberModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('Child');
  const [birthdate, setBirthdate] = useState('');
  const [selectedColor, setSelectedColor] = useState('bg-indigo-500');
  const [isOnline, setIsOnline] = useState(false);

  // Profile Image states
  const [avatarMode, setAvatarMode] = useState<'current' | 'color' | 'upload' | 'camera'>('current');
  const [uploadedBase64, setUploadedBase64] = useState<string>('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize values when member changes
  useEffect(() => {
    if (member) {
      setName(member.name);
      setRole(member.role);
      setBirthdate(member.birthdate || '');
      setSelectedColor(member.avatarColor);
      setIsOnline(member.isOnline ?? false);
      if (member.avatarUrl) {
        setAvatarMode('current');
        setUploadedBase64(member.avatarUrl);
      } else {
        setAvatarMode('color');
        setUploadedBase64('');
      }
    }
  }, [member, isOpen]);

  const startCamera = async () => {
    setIsCameraActive(true);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 350 }, height: { ideal: 350 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error(err);
      setCameraError('Permission check or camera offline.');
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 350;
      canvas.height = videoRef.current.videoHeight || 350;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setUploadedBase64(dataUrl);
        setUploadFileName('snapshot.jpg');
        stopCamera();
        setAvatarMode('upload');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file formats.');
        return;
      }
      setUploadFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setUploadedBase64(reader.result);
          setAvatarMode('upload');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleClearImage = () => {
    setUploadedBase64('');
    setUploadFileName('');
    setAvatarMode('color');
  };

  const handleCancelClose = () => {
    stopCamera();
    onClose();
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !member) return;

    let finalAvatarUrl: string | undefined = undefined;
    if (avatarMode === 'current' || avatarMode === 'upload') {
      finalAvatarUrl = uploadedBase64 || undefined;
    }

    const updated: FamilyMember = {
      ...member,
      name: name.trim(),
      role,
      birthdate: birthdate || undefined,
      avatarColor: selectedColor,
      avatarUrl: finalAvatarUrl,
      isOnline
    };

    onSave(updated);
    stopCamera();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && member && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancelClose}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white p-6 shadow-xl border border-slate-150 z-10"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-rose-100">
              <div className="flex items-center space-x-2">
                <div className={`p-2 rounded-lg bg-indigo-50 text-indigo-600`}>
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 font-sans tracking-tight">Edit Profile Settings</h3>
                  <p className="text-xs text-slate-500">Update name, theme color and custom portrait picture.</p>
                </div>
              </div>
              <button
                onClick={handleCancelClose}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 tracking-wide uppercase mb-1">
                  Full Name / Nickname
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Charlie"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 tracking-wide uppercase mb-1">
                    Role
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as MemberRole)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm"
                  >
                    <option value="Child">Child</option>
                    <option value="Parent">Parent</option>
                    <option value="Grandparent">Grandparent</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 tracking-wide uppercase mb-1">
                    Birthdate
                  </label>
                  <input
                    type="date"
                    value={birthdate}
                    onChange={(e) => setBirthdate(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm text-slate-800"
                  />
                </div>
              </div>

              {/* Online Status Toggle */}
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Online Status</h4>
                  <p className="text-[10px] text-slate-500">Render as live and active in directory.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isOnline}
                    onChange={(e) => setIsOnline(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {/* Profile Avatar Selection Section */}
              <div className="space-y-2.5">
                <label className="block text-xs font-semibold text-slate-700 tracking-wide uppercase">
                  Profile Representation / Photo
                </label>
                
                {/* Mode Selector Tabs */}
                <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold select-none border border-slate-200">
                  <button
                    type="button"
                    onClick={() => { stopCamera(); setAvatarMode(uploadedBase64 ? 'current' : 'color'); }}
                    className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all text-center ${
                      avatarMode === 'current' || (avatarMode === 'color' && !uploadedBase64)
                        ? 'bg-white text-indigo-700 shadow-xs' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {uploadedBase64 ? 'Current Portrait' : 'Initials'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { stopCamera(); setAvatarMode('upload'); }}
                    className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                      avatarMode === 'upload' 
                        ? 'bg-white text-indigo-700 shadow-xs' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Upload className="w-3 h-3 text-indigo-500" />
                    Upload Image
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAvatarMode('camera'); startCamera(); }}
                    className={`flex-1 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                      avatarMode === 'camera' 
                        ? 'bg-white text-indigo-700 shadow-xs' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Camera className="w-3 h-3 text-indigo-500" />
                    Take Snapshot
                  </button>
                </div>

                {/* Case 1: Colors & Initials */}
                {avatarMode === 'color' && (
                  <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Select Color Palette</p>
                    <div className="flex items-center flex-wrap gap-2">
                      {AVATAR_COLORS.map((color) => (
                        <button
                          key={color.class}
                          type="button"
                          onClick={() => setSelectedColor(color.class)}
                          className={`relative w-8 h-8 rounded-xl ${color.class} transition-transform hover:scale-105 focus:outline-none`}
                        >
                          {selectedColor === color.class && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <Sparkles className="w-4 h-4 text-white drop-shadow-sm" />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Case 1.1: Current Portrait Loaded */}
                {avatarMode === 'current' && (
                  <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 bg-white shadow-xs">
                        <img src={uploadedBase64} alt="Avatar profile direct view" className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-800">Has Custom Photo</p>
                        <p className="text-[10px] text-slate-500">Stored locally in secure index sandbox.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearImage}
                      className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-650 rounded-lg transition-colors cursor-pointer"
                      title="Delete profile picture and return to standard color"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Case 2: Upload File Image */}
                {avatarMode === 'upload' && (
                  <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                    <div className="flex items-center gap-3">
                      {uploadedBase64 ? (
                        <div className="w-12 h-12 rounded-xl border border-slate-200 overflow-hidden shrink-0 bg-white shadow-xs">
                          <img src={uploadedBase64} alt="Avatar profile snapshot" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className={`w-12 h-12 rounded-xl ${selectedColor} text-white font-bold text-lg flex items-center justify-center shrink-0 uppercase shadow-xs`}>
                          {name.trim() ? name.trim().charAt(0) : '?'}
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100/80 rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-all border border-indigo-250">
                          <Upload className="w-3 h-3" />
                          <span>Choose New Image</span>
                          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                        </label>
                        <p className="text-[10px] text-slate-400 truncate max-w-[200px]">
                          {uploadFileName || 'No new image chosen.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Case 3: Live Camera Snapshot */}
                {avatarMode === 'camera' && (
                  <div className="p-4 bg-slate-50 border border-slate-150 rounded-xl space-y-3">
                    {isCameraActive ? (
                      <div className="space-y-2.5">
                        <div className="aspect-square w-full max-w-[200px] mx-auto rounded-xl overflow-hidden bg-black border border-slate-250 relative">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover scale-x-[-1]"
                          />
                          <div className="absolute inset-0 border border-slate-50/15 pointer-events-none rounded-xl"></div>
                        </div>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={capturePhoto}
                            className="px-4 py-1.5 bg-red-650 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all cursor-pointer flex items-center gap-1"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Capture snap</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 bg-slate-100 border border-dashed border-slate-200 rounded-lg">
                        {cameraError ? (
                          <div className="space-y-2 px-3">
                            <p className="text-[10px] text-red-650 font-medium">{cameraError}</p>
                            <button
                              type="button"
                              onClick={startCamera}
                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded-md text-[10px] font-semibold hover:bg-slate-50"
                            >
                              <RefreshCcw className="w-3 h-3 animate-spin duration-1000" /> Wait &amp; Retry
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {uploadedBase64 ? (
                              <div className="w-16 h-16 rounded-xl border border-slate-200 overflow-hidden mx-auto bg-white shadow-xs">
                                <img src={uploadedBase64} alt="Captured portrait avatar" className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mx-auto">
                                <Camera className="w-5 h-5" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={startCamera}
                              className="px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-slate-50 transition-colors"
                            >
                              Activate Stream / webcam
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCancelClose}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer font-bold uppercase tracking-wider"
                >
                  <Save className="w-4 h-4" />
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
