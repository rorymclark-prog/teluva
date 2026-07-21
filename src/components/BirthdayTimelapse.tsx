import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FamilyMember, BirthdayPhoto } from '../types';
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
  Loader2, Cake, Check, X, AlertCircle, Calendar,
} from 'lucide-react';

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

      onUpdateMember({ ...member, birthdayPhotos: [...kept, newPhoto] });
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
              <label className="field-label">Photo</label>
              <div
                className="w-full min-h-[110px] border-2 border-dashed border-cream-300 rounded-xl bg-white flex flex-col items-center justify-center p-3 cursor-pointer hover:bg-cream-50 transition-colors"
                onClick={() => document.getElementById('bday-photo-file')?.click()}
              >
                <input
                  id="bday-photo-file"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFile}
                />
                {uploadedBase64 ? (
                  <div className="relative w-full flex items-center justify-center">
                    <img
                      src={uploadedBase64}
                      alt="Preview"
                      className="max-h-32 object-contain rounded-lg border border-cream-300"
                      referrerPolicy="no-referrer"
                    />
                    {uploadFileName && (
                      <div className="absolute bottom-1 bg-ink-900/75 text-white text-[11px] font-mono px-1.5 py-0.5 rounded">
                        {uploadFileName.slice(0, 22)}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-ink-400 mb-1" />
                    <p className="text-[12px] font-semibold text-ink-600">Tap to choose a photo</p>
                    <p className="text-[11px] text-ink-400 mt-0.5">JPG / PNG — one per birthday</p>
                  </>
                )}
              </div>
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
        <div className="text-center py-16 border border-dashed border-cream-300 rounded-2xl bg-cream-50 p-5 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-dusk-50 text-dusk-500 border border-dusk-100 flex items-center justify-center mx-auto">
            <Film className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h4 className="text-[13px] font-semibold text-ink-800">No birthday photos yet</h4>
            <p className="text-[13px] text-ink-400 leading-relaxed">
              Add one photo of {firstName(member)} each birthday. Once there are a couple of years,
              you can watch a little growing-up film.
            </p>
          </div>
          <button onClick={() => setIsAdding(true)} className="btn-primary mx-auto">
            Add the first birthday photo
          </button>
        </div>
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
                className="w-full bg-ink-900 max-h-[70vh]"
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
