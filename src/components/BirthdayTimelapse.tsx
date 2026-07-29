import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FamilyMember, BirthdayPhoto, TimelapseGuide } from '../types';
import { compressImageToAvatar } from '../utils/imageCompress';
import { uploadBirthdayPhoto, deleteBirthdayPhoto } from '../utils/db';
import { isDemoMode } from '../utils/demoData';
import { ageOnBirthday } from '../utils/birthday';
import {
  buildTimelapseVideo,
  isTimelapseSupported,
  extensionForMime,
  MIN_TIMELAPSE_PHOTOS,
  type TimelapsePhoto,
} from '../utils/timelapse';
import {
  Clapperboard, Film, ImagePlus, Upload, Trash2, Download, Play,
  Loader2, Cake, Check, X, AlertCircle, Calendar, Camera, RefreshCcw, Lightbulb,
} from 'lucide-react';
import EmptyState from './EmptyState';

// Default alignment guide for a member who hasn't dragged one into place yet —
// roughly where a head-and-shoulders portrait's eyes fall in a portrait-ish frame.
const DEFAULT_GUIDE: TimelapseGuide = { eyeLineY: 0.4, centerX: 0.5 };

interface BirthdayTimelapseProps {
  member: FamilyMember;
  onUpdateMember: (updatedMember: FamilyMember) => void;
}

const firstName = (m: FamilyMember) => m.name.split(/\s+/)[0] || m.name;

export default function BirthdayTimelapse({ member, onUpdateMember }: BirthdayTimelapseProps) {
  const photos = useMemo(
    () => [...(member.birthdayPhotos || [])].sort((a, b) => a.year - b.year),
    [member.birthdayPhotos],
  );

  const demo = isDemoMode();
  const supported = useMemo(() => isTimelapseSupported(), []);

  // --- Add-photo form state ---
  const currentYear = new Date().getFullYear();
  const [isAdding, setIsAdding] = useState(false);
  const [year, setYear] = useState<number>(currentYear);
  const [uploadedBase64, setUploadedBase64] = useState('');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Photos added THIS session keep their local data URL, so the timelapse can be
  // built from same-origin pixels without depending on Storage bucket CORS.
  const sessionSrc = useRef<Record<string, string>>({});

  // --- Live camera capture state ---
  // Feature-detected once: absent on insecure (non-https/non-localhost)
  // origins and unsupported browsers, so the tab simply doesn't offer itself
  // rather than opening onto a guaranteed failure.
  const cameraSupported = useMemo(
    () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    [],
  );
  const [captureMode, setCaptureMode] = useState<'camera' | 'file'>(cameraSupported ? 'camera' : 'file');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  // The eye-line/centre-line the family drags into place over the ghost photo.
  // Starts from whatever was saved on the member last year, if anything.
  const [guide, setGuide] = useState<TimelapseGuide>(member.timelapseGuide || DEFAULT_GUIDE);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const guideBoxRef = useRef<HTMLDivElement>(null);
  const draggingGuideRef = useRef<'h' | 'v' | null>(null);

  // Last year's (or, failing that, the most recent) photo — shown translucent
  // over the live preview so the parent can line the child up against it.
  const ghostPhoto = useMemo(() => {
    const before = photos.filter((p) => p.year < year);
    return before[before.length - 1] || photos[photos.length - 1] || null;
  }, [photos, year]);
  const ghostSrc = ghostPhoto ? sessionSrc.current[ghostPhoto.id] || ghostPhoto.url : null;

  // Re-sync the guide to what's saved on the member whenever the form opens,
  // in case a photo was added on another device since this component mounted.
  useEffect(() => {
    if (isAdding) setGuide(member.timelapseGuide || DEFAULT_GUIDE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdding]);

  // Opens (and, on cleanup, always stops) the camera stream whenever the form
  // is open, "Camera" is the active tab, and there's no captured photo waiting
  // to be reviewed yet. Re-runs on facingMode change to switch lenses, and its
  // cleanup fires on every one of those transitions plus unmount — so the
  // stream is never left running behind the user's back.
  useEffect(() => {
    if (!isAdding || captureMode !== 'camera' || uploadedBase64) return;
    let cancelled = false;
    setCameraError(null);
    setCameraReady(false);

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setCameraError("This browser can't use the camera here.");
          setCaptureMode('file');
        }
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
      } catch (e) {
        console.error('Camera access failed:', e);
        if (!cancelled) {
          // Covers permission denied, no camera present, and camera already in
          // use — never leave the parent stuck at a black rectangle.
          setCameraError("Couldn't reach the camera — permission denied, unavailable, or already in use. Choose a photo instead.");
          setCaptureMode('file');
        }
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraReady(false);
    };
  }, [isAdding, captureMode, facingMode, uploadedBase64]);

  const startGuideDrag = (axis: 'h' | 'v') => (e: React.PointerEvent) => {
    draggingGuideRef.current = axis;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const handleGuidePointerMove = (e: React.PointerEvent) => {
    if (!draggingGuideRef.current || !guideBoxRef.current) return;
    const box = guideBoxRef.current.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    setGuide((g) => (draggingGuideRef.current === 'h' ? { ...g, eyeLineY: y } : { ...g, centerX: x }));
  };

  const handleGuidePointerUp = () => {
    draggingGuideRef.current = null;
  };

  const handleFlipCamera = () => {
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'));
  };

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setUploadFileName(`${firstName(member)}-${year}-camera.jpg`);
    // Same bounded-size compression path as the file picker, so both routes
    // produce comparable Storage/Firestore payloads.
    void compressImageToAvatar(dataUrl, 1280, 0.82).then(setUploadedBase64);
  };

  const handleRetake = () => {
    setUploadedBase64('');
    setUploadFileName('');
  };

  // --- Video generation state ---
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMime, setVideoMime] = useState<string>('video/webm');
  const videoUrlRef = useRef<string | null>(null);

  // Revoke any object URL we created when it changes or on unmount.
  useEffect(() => {
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);
  useEffect(() => () => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  const yearOptions = useMemo(() => {
    let start = currentYear - 15;
    if (member.birthdate) {
      const by = new Date(member.birthdate).getFullYear();
      if (!isNaN(by)) start = by;
    }
    const years: number[] = [];
    for (let y = currentYear; y >= start; y--) years.push(y);
    return years;
  }, [member.birthdate, currentYear]);

  const yearTaken = photos.some((p) => p.year === year);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    setError(null);
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = async () => {
      if (typeof reader.result !== 'string') return;
      // Bound the source frame so both Storage and the video output stay small.
      const compressed = await compressImageToAvatar(reader.result, 1280, 0.82);
      setUploadedBase64(compressed);
    };
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setUploadedBase64('');
    setUploadFileName('');
    setIsAdding(false);
  };

  const handleSave = async () => {
    if (!uploadedBase64) return;
    setUploading(true);
    setError(null);
    try {
      const id = 'bday-' + year + '-' + Date.now();
      let url = uploadedBase64;
      let storagePath: string | undefined;

      if (!demo) {
        const up = await uploadBirthdayPhoto(uploadedBase64, member.id, year);
        url = up.url;
        storagePath = up.storagePath;
      }

      const newPhoto: BirthdayPhoto = {
        id,
        year,
        url,
        storagePath,
        ageYears: ageOnBirthday(member, year),
        addedAt: new Date().toISOString(),
      };

      // Cache the local (same-origin) source for this session.
      sessionSrc.current[id] = uploadedBase64;

      // One photo per year: replace any existing entry for the same year.
      const kept = (member.birthdayPhotos || []).filter((p) => p.year !== year);
      const removed = (member.birthdayPhotos || []).find((p) => p.year === year);
      if (removed?.storagePath && !demo) {
        // Best-effort cleanup of the photo being replaced.
        void deleteBirthdayPhoto(removed.storagePath);
      }

      const updatedMember: FamilyMember = { ...member, birthdayPhotos: [...kept, newPhoto] };
      // Remember the guide the family just lined up against, so next year's
      // ghost overlay starts from the same eye-line/centre-line.
      if (captureMode === 'camera') updatedMember.timelapseGuide = guide;
      onUpdateMember(updatedMember);
      resetForm();
    } catch (e) {
      console.error('Birthday photo save failed:', e);
      setError(
        demo
          ? "Couldn't add the photo in demo mode."
          : "Couldn't save the photo. Check your connection and try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (photo: BirthdayPhoto) => {
    if (photo.storagePath && !demo) void deleteBirthdayPhoto(photo.storagePath);
    delete sessionSrc.current[photo.id];
    onUpdateMember({
      ...member,
      birthdayPhotos: (member.birthdayPhotos || []).filter((p) => p.id !== photo.id),
    });
  };

  const clearVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
  };

  const handleGenerate = async () => {
    if (photos.length < MIN_TIMELAPSE_PHOTOS || generating) return;
    setGenerating(true);
    setError(null);
    setProgress({ loaded: 0, total: photos.length });
    clearVideo();
    try {
      const input: TimelapsePhoto[] = photos.map((p) => ({
        url: p.url,
        localSrc: sessionSrc.current[p.id],
        year: p.year,
        ageYears: p.ageYears ?? ageOnBirthday(member, p.year),
      }));
      const result = await buildTimelapseVideo(input, {
        msPerPhoto: 1800,
        maxWidth: 1280,
        maxHeight: 720,
        fps: 30,
        showYearLabel: true,
        // Aligned photos (via the ghost-overlay guide) are what makes a
        // crossfade read as a morph rather than a smear — safe to turn on now
        // that alignment exists. See timelapse.ts for why the recording loop
        // itself is untouched by this.
        crossfadeMs: 350,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
      });
      const url = URL.createObjectURL(result.blob);
      setVideoMime(result.mimeType);
      setVideoUrl(url);
    } catch (e) {
      console.error('Timelapse generation failed:', e);
      setError(e instanceof Error ? e.message : 'Could not generate the video.');
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const span = photos.length
    ? `${photos[0].year}–${photos[photos.length - 1].year}`
    : '';
  const downloadName = `${firstName(member)}-timelapse${span ? '-' + span : ''}.${extensionForMime(videoMime)}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cream-200 pb-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-ink-900 flex flex-wrap items-center gap-2">
            <span className="w-1.5 h-3.5 bg-dusk-500 rounded-full inline-block"></span>
            <span>Birthday timelapse</span>
            <span className="chip bg-dusk-100 text-dusk-700 border border-dusk-100">
              <Clapperboard className="w-3 h-3" /> Growing up
            </span>
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">
            Add one photo of {firstName(member)} each birthday. Every year the film grows —
            press play to watch them grow up.
          </p>
        </div>

        <button
          type="button"
          onClick={() => { setIsAdding((v) => !v); setError(null); }}
          className="btn-primary"
        >
          {isAdding ? (
            <><X className="w-3.5 h-3.5" /><span>Cancel</span></>
          ) : (
            <><ImagePlus className="w-3.5 h-3.5" /><span>Add this year&apos;s photo</span></>
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rosa-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Add photo form */}
      {isAdding && (
        <div className="bg-cream-100 p-5 rounded-2xl border border-cream-300 shadow-soft space-y-4">
          <h4 className="text-[13px] font-semibold text-ink-600 flex items-center gap-1.5">
            <Cake className="w-3.5 h-3.5 text-clay-500" />
            New birthday photo
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="field-label">Birthday year</label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10))}
                className="field"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}{ageOnBirthday(member, y) != null ? ` · age ${ageOnBirthday(member, y)}` : ''}
                  </option>
                ))}
              </select>
              {yearTaken && (
                <p className="text-[11px] text-honey-700 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {year} already has a photo — saving replaces it.
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className="field-label mb-0">Photo</label>
                {cameraSupported && !uploadedBase64 && (
                  <div className="flex items-center gap-1 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setCaptureMode('camera')}
                      className={`px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
                        captureMode === 'camera' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-cream-200'
                      }`}
                    >
                      <Camera className="w-3 h-3" /> Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => setCaptureMode('file')}
                      className={`px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
                        captureMode === 'file' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-cream-200'
                      }`}
                    >
                      <Upload className="w-3 h-3" /> Choose file
                    </button>
                  </div>
                )}
              </div>

              {cameraError && (
                <p className="text-[11px] text-rosa-700 mb-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0" /> {cameraError}
                </p>
              )}

              {uploadedBase64 ? (
                <div className="relative w-full min-h-[110px] border-2 border-dashed border-cream-300 rounded-xl bg-white flex items-center justify-center p-3">
                  <div className="relative w-full flex items-center justify-center">
                    <img
                      src={uploadedBase64}
                      alt="Preview"
                      className="max-h-40 object-contain rounded-lg border border-cream-300"
                      referrerPolicy="no-referrer"
                    />
                    {uploadFileName && (
                      <div className="absolute bottom-1 bg-ink-900/75 text-white text-[11px] font-mono px-1.5 py-0.5 rounded">
                        {uploadFileName.slice(0, 22)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={captureMode === 'camera' ? handleRetake : () => document.getElementById('bday-photo-file')?.click()}
                    className="absolute top-2 right-2 btn-quiet px-2.5 py-1 text-[11px]"
                  >
                    {captureMode === 'camera' ? (
                      <><RefreshCcw className="w-3 h-3" /><span>Retake</span></>
                    ) : (
                      <span>Change</span>
                    )}
                  </button>
                </div>
              ) : captureMode === 'camera' ? (
                <div className="relative aspect-square sm:aspect-video rounded-xl overflow-hidden bg-ink-900 border border-cream-300">
                  <video ref={videoRef} playsInline autoPlay muted className="absolute inset-0 w-full h-full object-cover" />

                  {/* Ghost overlay: last year's photo, semi-transparent, to line the child up against */}
                  {ghostSrc && (
                    <img
                      src={ghostSrc}
                      alt=""
                      aria-hidden="true"
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 w-full h-full object-cover opacity-35 pointer-events-none"
                    />
                  )}

                  {/* Alignment guide: horizontal eye-line + vertical centre-line,
                      both draggable, remembered on the member for next year. */}
                  <div
                    ref={guideBoxRef}
                    className="absolute inset-0 touch-none"
                    onPointerMove={handleGuidePointerMove}
                    onPointerUp={handleGuidePointerUp}
                    onPointerCancel={handleGuidePointerUp}
                  >
                    <div
                      className="absolute left-0 right-0 h-px bg-honey-500 cursor-ns-resize"
                      style={{ top: `${guide.eyeLineY * 100}%` }}
                      onPointerDown={startGuideDrag('h')}
                    >
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-honey-500 border-2 border-white shadow-soft" />
                    </div>
                    <div
                      className="absolute top-0 bottom-0 w-px bg-dusk-500 cursor-ew-resize"
                      style={{ left: `${guide.centerX * 100}%` }}
                      onPointerDown={startGuideDrag('v')}
                    >
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-dusk-500 border-2 border-white shadow-soft" />
                    </div>
                  </div>

                  {!cameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-ink-900/60 text-white text-[12px] font-semibold">
                      <Loader2 className="w-4 h-4 animate-spin" /> Starting camera…
                    </div>
                  )}

                  {ghostSrc && cameraReady && (
                    <div className="absolute top-2 left-2 chip bg-ink-900/70 text-white backdrop-blur-sm">
                      Ghost · {ghostPhoto?.year}
                    </div>
                  )}

                  {cameraReady && (
                    <>
                      <button
                        type="button"
                        onClick={handleFlipCamera}
                        title="Flip camera"
                        className="absolute top-2 right-2 p-2 rounded-full bg-ink-900/60 hover:bg-ink-900/80 text-white transition-colors"
                      >
                        <RefreshCcw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleShutter}
                        title="Capture photo"
                        className="absolute bottom-3 left-1/2 -translate-x-1/2 p-3 bg-clay-500 hover:bg-clay-600 text-white rounded-full border-4 border-white shadow-soft active:scale-95 transition-transform"
                      >
                        <div className="w-5 h-5 rounded-full border-2 border-white" />
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div
                  className="w-full min-h-[110px] border-2 border-dashed border-cream-300 rounded-xl bg-white flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-cream-50 transition-colors"
                  onClick={() => document.getElementById('bday-photo-file')?.click()}
                >
                  <Upload className="w-6 h-6 text-ink-400 mb-1" />
                  <p className="text-[12px] font-semibold text-ink-600">Tap to choose a photo</p>
                  <p className="text-[11px] text-ink-400 mt-0.5">JPG / PNG — one per birthday</p>
                </div>
              )}

              {/* Lives outside the branches above so "Change" from the preview
                  state, and the file-mode dropzone, can both trigger it — the
                  fallback path stays reachable no matter which branch is showing. */}
              <input
                id="bday-photo-file"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFile}
              />

              <p className="text-[11px] text-ink-400 mt-1.5 flex items-start gap-1">
                <Lightbulb className="w-3 h-3 text-honey-500 shrink-0 mt-0.5" />
                <span>
                  Best results: same wall or spot, same distance and camera height, and around the
                  same time of year — line up against the faint ghost photo above.
                </span>
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1 border-t border-cream-200">
            <button type="button" onClick={resetForm} className="btn-quiet">Cancel</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!uploadedBase64 || uploading}
              className="btn-primary disabled:opacity-40"
            >
              {uploading ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Saving…</span></>
              ) : (
                <><Check className="w-3.5 h-3.5" /><span>Save photo</span></>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Empty / single-photo friendly states */}
      {photos.length === 0 ? (
        <EmptyState
          icon={Film}
          dashed
          title="No birthday photos yet"
          description={<>Add one photo of {firstName(member)} each birthday. Once there are a couple of years, you can watch a little growing-up film.</>}
          action={{ label: 'Add the first birthday photo', onClick: () => setIsAdding(true) }}
        />
      ) : (
        <>
          {/* Watch / generate panel */}
          <div className="card p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-11 h-11 rounded-2xl bg-dusk-100 text-dusk-500 flex items-center justify-center shrink-0">
                <Clapperboard className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-ink-900">
                  {photos.length} year{photos.length !== 1 ? 's' : ''} on film{span ? ` · ${span}` : ''}
                </p>
                <p className="text-[12px] text-ink-400">
                  {photos.length < MIN_TIMELAPSE_PHOTOS
                    ? `Add ${MIN_TIMELAPSE_PHOTOS - photos.length} more year${MIN_TIMELAPSE_PHOTOS - photos.length !== 1 ? 's' : ''} to build a video.`
                    : '~1.8s per photo · plays in your browser'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={photos.length < MIN_TIMELAPSE_PHOTOS || generating || !supported}
              className="btn-primary disabled:opacity-40 shrink-0"
              title={!supported ? "This browser can't generate video" : undefined}
            >
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{progress ? `Building ${progress.loaded}/${progress.total}…` : 'Building…'}</span>
                </>
              ) : (
                <><Play className="w-3.5 h-3.5" /><span>{videoUrl ? 'Rebuild timelapse' : 'Watch timelapse'}</span></>
              )}
            </button>
          </div>

          {!supported && (
            <p className="text-[12px] text-ink-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              This browser can&apos;t build the video. Try the latest Chrome, Edge or Safari.
            </p>
          )}

          {/* Rendered video */}
          {videoUrl && (
            <div className="card overflow-hidden">
              <video
                key={videoUrl}
                src={videoUrl}
                controls
                autoPlay
                playsInline
                className="w-full bg-ink-900 max-h-[70dvh]"
              />
              <div className="px-5 py-3 border-t border-cream-200 flex items-center justify-between gap-3">
                <span className="text-[12px] text-ink-400 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5" /> {extensionForMime(videoMime).toUpperCase()} · generated on this device
                </span>
                <a href={videoUrl} download={downloadName} className="btn-quiet">
                  <Download className="w-3.5 h-3.5" /><span>Download</span>
                </a>
              </div>
            </div>
          )}

          {/* Photo grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
            {photos.map((photo) => {
              const age = photo.ageYears ?? ageOnBirthday(member, photo.year);
              return (
                <div
                  key={photo.id}
                  className="bg-white border border-cream-300/70 rounded-2xl shadow-soft overflow-hidden group relative"
                >
                  <div className="aspect-square relative overflow-hidden bg-cream-100">
                    <img
                      src={sessionSrc.current[photo.id] || photo.url}
                      alt={`${firstName(member)} ${photo.year}`}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-2 left-2 chip bg-ink-900/70 text-white backdrop-blur-sm shadow-soft tabular-nums">
                      {photo.year}
                    </div>
                    <div className="absolute inset-0 bg-ink-900/40 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={() => handleDelete(photo)}
                        className="btn-danger p-2 rounded-xl text-[12px] active:scale-95"
                        title="Remove photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between text-[11px] text-ink-500 font-mono">
                    <span className="flex items-center gap-1 tabular-nums">
                      <Calendar className="w-3 h-3" /> {photo.year}
                    </span>
                    {age != null && <span className="tabular-nums">age {age}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
