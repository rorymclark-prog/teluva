import React, { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Camera, Upload, RefreshCcw, Save, Trash2 } from 'lucide-react';
import { FamilyMember, MemberRole } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { AVATAR_COLORS, warmAvatarColor } from '../utils/avatarPalette';

interface EditMemberModalProps {
  isOpen: boolean;
  member: FamilyMember | undefined;
  onClose: () => void;
  onSave: (updatedMember: FamilyMember) => void;
}

export default function EditMemberModal({ isOpen, member, onClose, onSave }: EditMemberModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('Child');
  const [birthdate, setBirthdate] = useState('');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
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
      setSelectedColor(warmAvatarColor(member.avatarColor));
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

  // Belt-and-braces: stop camera when modal closes or component unmounts
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

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
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="card relative w-full max-w-md overflow-hidden rounded-3xl p-6 z-10"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-cream-200">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-lg bg-clay-50 text-clay-600">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-ink-900">Edit Profile Settings</h3>
                  <p className="text-[13px] font-semibold text-ink-500">Update name, theme color and custom portrait picture.</p>
                </div>
              </div>
              <button
                onClick={handleCancelClose}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveSubmit} className="mt-4 space-y-4">
              <div>
                <label className="field-label">Full Name / Nickname</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Charlie"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as MemberRole)}
                    className="field"
                  >
                    <option value="Child">Child</option>
                    <option value="Parent">Parent</option>
                    <option value="Grandparent">Grandparent</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="field-label">Birthdate</label>
                  <input
                    type="date"
                    value={birthdate}
                    onChange={(e) => setBirthdate(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              {/* Online Status Toggle */}
              <div className="bg-sage-50 border border-sage-100 rounded-2xl p-3 flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold text-ink-800">Online Status</h4>
                  <p className="text-[13px] font-semibold text-ink-500">Render as live and active in directory.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isOnline}
                    onChange={(e) => setIsOnline(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-cream-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cream-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sage-500"></div>
                </label>
              </div>

              {/* Profile Avatar Selection Section */}
              <div className="space-y-2.5">
                <label className="field-label">Profile Representation / Photo</label>

                {/* Mode Selector Tabs */}
                <div className="flex bg-cream-100 p-1 rounded-xl select-none border border-cream-300">
                  <button
                    type="button"
                    onClick={() => { stopCamera(); setAvatarMode(uploadedBase64 ? 'current' : 'color'); }}
                    className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all text-center ${
                      avatarMode === 'current' || (avatarMode === 'color' && !uploadedBase64)
                        ? 'bg-white text-ink-900 shadow-soft'
                        : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    {uploadedBase64 ? 'Current Portrait' : 'Initials'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { stopCamera(); setAvatarMode('upload'); }}
                    className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                      avatarMode === 'upload'
                        ? 'bg-white text-ink-900 shadow-soft'
                        : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    <Upload className="w-3 h-3" />
                    Upload Image
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAvatarMode('camera'); startCamera(); }}
                    className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all text-center flex items-center justify-center gap-1 ${
                      avatarMode === 'camera'
                        ? 'bg-white text-ink-900 shadow-soft'
                        : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    <Camera className="w-3 h-3" />
                    Take Snapshot
                  </button>
                </div>

                {/* Case 1: Colors & Initials */}
                {avatarMode === 'color' && (
                  <div className="p-3 bg-cream-50 border border-cream-300 rounded-2xl space-y-2">
                    <p className="section-label">Select color palette</p>
                    <div className="flex items-center flex-wrap gap-2">
                      {AVATAR_COLORS.map((colorClass) => (
                        <button
                          key={colorClass}
                          type="button"
                          onClick={() => setSelectedColor(colorClass)}
                          className={`relative w-8 h-8 rounded-xl ${colorClass} transition-transform hover:scale-105 focus:outline-none ${
                            selectedColor === colorClass
                              ? 'ring-2 ring-ink-900 ring-offset-2 ring-offset-white'
                              : ''
                          }`}
                        >
                          {selectedColor === colorClass && (
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
                  <div className="p-3 bg-cream-50 border border-cream-300 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden border border-cream-300 bg-white shadow-soft">
                        <img src={uploadedBase64} alt="Avatar profile direct view" className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-ink-800">Has Custom Photo</p>
                        <p className="text-[13px] font-semibold text-ink-500">Stored locally in secure index sandbox.</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearImage}
                      className="p-1.5 hover:bg-rosa-50 text-ink-400 hover:text-rosa-700 rounded-lg transition-colors cursor-pointer"
                      title="Delete profile picture and return to standard color"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Case 2: Upload File Image */}
                {avatarMode === 'upload' && (
                  <div className="p-4 bg-cream-100 border border-cream-300 rounded-2xl space-y-3">
                    <div className="flex items-center gap-3">
                      {uploadedBase64 ? (
                        <div className="w-12 h-12 rounded-xl border border-cream-300 overflow-hidden shrink-0 bg-white shadow-soft">
                          <img src={uploadedBase64} alt="Avatar profile snapshot" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className={`w-12 h-12 rounded-xl ${warmAvatarColor(selectedColor)} text-white font-bold text-lg flex items-center justify-center shrink-0 uppercase shadow-soft`}>
                          {name.trim() ? name.trim().charAt(0) : '?'}
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="inline-flex items-center gap-1 px-3 py-1.5 bg-dusk-50 text-dusk-700 hover:bg-dusk-100/80 rounded-lg text-[13px] font-semibold cursor-pointer transition-all border border-dusk-200">
                          <Upload className="w-3 h-3" />
                          <span>Choose New Image</span>
                          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                        </label>
                        <p className="text-[13px] font-semibold text-ink-400 truncate max-w-[200px]">
                          {uploadFileName || 'No new image chosen.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Case 3: Live Camera Snapshot */}
                {avatarMode === 'camera' && (
                  <div className="p-4 bg-cream-100 border border-cream-300 rounded-2xl space-y-3">
                    {isCameraActive ? (
                      <div className="space-y-2.5">
                        <div className="aspect-square w-full max-w-[200px] mx-auto rounded-2xl overflow-hidden bg-ink-900 border border-cream-300 relative">
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover scale-x-[-1]"
                          />
                          <div className="absolute inset-0 border border-white/10 pointer-events-none rounded-2xl"></div>
                        </div>
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={capturePhoto}
                            className="btn-danger flex items-center gap-1"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            <span>Capture snap</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 bg-cream-100 border border-dashed border-cream-300 rounded-2xl">
                        {cameraError ? (
                          <div className="space-y-2 px-3">
                            <p className="text-[13px] font-semibold text-rosa-700">{cameraError}</p>
                            <button
                              type="button"
                              onClick={startCamera}
                              className="btn-quiet inline-flex items-center gap-1.5"
                            >
                              <RefreshCcw className="w-3 h-3" /> Wait &amp; Retry
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {uploadedBase64 ? (
                              <div className="w-16 h-16 rounded-2xl border border-cream-300 overflow-hidden mx-auto bg-white shadow-soft">
                                <img src={uploadedBase64} alt="Captured portrait avatar" className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-dusk-100 text-dusk-500 flex items-center justify-center mx-auto">
                                <Camera className="w-5 h-5" />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={startCamera}
                              className="btn-quiet"
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
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-cream-200">
                <button
                  type="button"
                  onClick={handleCancelClose}
                  className="btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
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
