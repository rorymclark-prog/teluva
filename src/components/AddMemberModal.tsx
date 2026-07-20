import React, { useState, useRef, useEffect } from 'react';
import { X, UserPlus, Sparkles, Camera, Upload, RefreshCcw } from 'lucide-react';
import { FamilyMember, MemberRole } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { AVATAR_COLORS, warmAvatarColor } from '../utils/avatarPalette';
import { compressImageToAvatar } from '../utils/imageCompress';
import { BUSINESS_ROLE_PRESETS } from '../utils/businessRoles';

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (member: Omit<FamilyMember, 'documents' | 'favorites'>) => void;
  /** True when adding a member of a business space — no children hired here. */
  isBusinessSpace?: boolean;
}

export default function AddMemberModal({ isOpen, onClose, onAdd, isBusinessSpace = false }: AddMemberModalProps) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<MemberRole>(isBusinessSpace ? 'Employee' : 'Child');
  const [customRole, setCustomRole] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [isOnline, setIsOnline] = useState(true);

  // New Avatar Image Upload/Camera states
  const [avatarMode, setAvatarMode] = useState<'color' | 'upload' | 'camera'>('color');
  const [uploadedBase64, setUploadedBase64] = useState<string>('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      setCameraError('Please check permissions & camera connections.');
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
        stopCamera();
        setUploadFileName('snapshot.jpg');
        setAvatarMode('upload');
        compressImageToAvatar(dataUrl).then(setUploadedBase64);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Please provide a valid image file format.');
        return;
      }
      setUploadFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = async () => {
        if (typeof reader.result === 'string') {
          const small = await compressImageToAvatar(reader.result);
          setUploadedBase64(small);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleModalClose = () => {
    stopCamera();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const finalRole = isBusinessSpace && role === 'Custom' ? (customRole.trim() || 'Employee') : role;

    onAdd({
      id: Date.now().toString(),
      name: name.trim(),
      nickname: nickname.trim() || undefined,
      role: finalRole,
      birthdate: birthdate || undefined,
      avatarColor: selectedColor,
      avatarUrl: avatarMode === 'upload' && uploadedBase64 ? uploadedBase64 : undefined,
      isOnline,
      clothingSizes: {}
    });

    // Reset form
    setName('');
    setNickname('');
    setRole(isBusinessSpace ? 'Employee' : 'Child');
    setCustomRole('');
    setBirthdate('');
    setSelectedColor(AVATAR_COLORS[0]);
    setIsOnline(true);
    setAvatarMode('color');
    setUploadedBase64('');
    setUploadFileName('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleModalClose}
            className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm anim-fade"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="card relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl p-6 anim-pop"
          >
            {/* Mobile grabber bar */}
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-cream-400 sm:hidden" />

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-cream-200">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-lg bg-clay-50 text-clay-600">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-ink-900">Add Family Member</h3>
                  <p className="text-[13px] font-semibold text-ink-500">Create a profile for clothes sizes, passports, and secure files.</p>
                </div>
              </div>
              <button
                onClick={handleModalClose}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Full name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Charlie"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Nickname</label>
                  <input
                    type="text"
                    placeholder="e.g. Charlie-bear"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">{isBusinessSpace ? 'Title' : 'Role'}</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as MemberRole)}
                    className="field"
                  >
                    {isBusinessSpace ? (
                      <>
                        {BUSINESS_ROLE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                        <option value="Custom">Custom…</option>
                      </>
                    ) : (
                      <>
                        <option value="Child">Child</option>
                        <option value="Parent">Parent</option>
                        <option value="Grandparent">Grandparent</option>
                        <option value="Other">Other</option>
                      </>
                    )}
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

              {isBusinessSpace && role === 'Custom' && (
                <input
                  type="text"
                  required
                  placeholder="e.g. Head Chef, Bookkeeper"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  className="field"
                />
              )}

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
                    onClick={() => { stopCamera(); setAvatarMode('color'); }}
                    className={`flex-1 py-1.5 text-[13px] font-semibold rounded-lg transition-all text-center ${
                      avatarMode === 'color'
                        ? 'bg-white text-ink-900 shadow-soft'
                        : 'text-ink-500 hover:text-ink-800'
                    }`}
                  >
                    Color Initials
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
                    Upload File
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
                    Take Photo
                  </button>
                </div>

                {/* Case 1: Color Initials */}
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

                {/* Case 2: Upload File */}
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
                          <span>Select image</span>
                          <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                        </label>
                        <p className="text-[13px] font-semibold text-ink-400 truncate max-w-[200px]">
                          {uploadFileName || 'No photo uploaded yet.'}
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
                        <div className="aspect-square w-full max-w-[220px] mx-auto rounded-2xl overflow-hidden bg-ink-900 border border-cream-300 relative">
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
                            <span>Capture Portrait</span>
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
                              <RefreshCcw className="w-3 h-3" /> Retry Camera
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
                              Open Webcam / Lens
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
                  onClick={handleModalClose}
                  className="btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                >
                  Create Profile
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
