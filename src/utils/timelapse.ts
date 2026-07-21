// Client-side "growing-up" timelapse generator.
//
// Draws a sequence of yearly birthday photos onto an offscreen canvas, captures
// the canvas as a MediaStream (canvas.captureStream) and records it to a webm
// blob with MediaRecorder — entirely in the user's browser. No server, no
// ffmpeg/ffmpeg.wasm (this Cloud Run service runs cpu-throttled with minScale:0,
// so a heavy server pipeline is the wrong architecture — see feature brief).
//
// v1 keeps it deliberately tight: a fixed hard-cut transition (more reliable
// than a crossfade), a bounded 1280×720 output, ~1.8s per photo, and a small
// year label overlay.

import fixWebmDuration from 'fix-webm-duration';

export interface TimelapsePhoto {
  /** Storage download URL, or a base64 data URL. */
  url: string;
  /**
   * Optional same-origin source (a base64 data URL captured this session).
   * Preferred over `url` when present so a freshly-added photo can be rendered
   * without depending on the Storage bucket's CORS configuration.
   */
  localSrc?: string;
  year: number;
  ageYears?: number;
}

export interface TimelapseOptions {
  /** Milliseconds each photo is held on screen. Default 1800. */
  msPerPhoto?: number;
  /** Max output width in px (photos are letterboxed to fit). Default 1280. */
  maxWidth?: number;
  /** Max output height in px. Default 720. */
  maxHeight?: number;
  /** Capture/record frame rate. Default 30. */
  fps?: number;
  /** Draw the year (and age) label over each photo. Default true. */
  showYearLabel?: boolean;
  /** Called as source images preload, so the UI can show progress. */
  onProgress?: (loaded: number, total: number) => void;
}

export interface TimelapseResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
}

/** Fewer than this and there is nothing to animate — show a friendly message. */
export const MIN_TIMELAPSE_PHOTOS = 2;

// Preference order: VP9 (best quality/size) → VP8 → generic webm → mp4 (Safari).
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

/** The first MediaRecorder mimeType this browser supports, or null. */
export function pickTimelapseMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

/** True when this browser can generate a timelapse (canvas capture + recorder). */
export function isTimelapseSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickTimelapseMimeType() !== null
  );
}

/** A file extension that matches the recorded mimeType. */
export function extensionForMime(mimeType: string): string {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Only opt into CORS for remote http(s) sources; data:/blob: are same-origin
    // and setting crossOrigin on them is unnecessary. A remote image that fails
    // the anonymous CORS fetch rejects here (rather than silently tainting the
    // canvas), which lets the caller surface a precise error.
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = src;
  });
}

/**
 * Build a timelapse video from a set of birthday photos (already sorted or not —
 * this sorts by year ascending). Resolves with a playable/downloadable blob.
 * Rejects with a clear Error the UI can show verbatim.
 */
export async function buildTimelapseVideo(
  photos: TimelapsePhoto[],
  opts: TimelapseOptions = {},
): Promise<TimelapseResult> {
  const {
    msPerPhoto = 1800,
    maxWidth = 1280,
    maxHeight = 720,
    fps = 30,
    showYearLabel = true,
    onProgress,
  } = opts;

  const ordered = [...photos].sort((a, b) => a.year - b.year);

  if (ordered.length < MIN_TIMELAPSE_PHOTOS) {
    throw new Error(`Add at least ${MIN_TIMELAPSE_PHOTOS} yearly photos to build a timelapse.`);
  }

  const mimeType = pickTimelapseMimeType();
  if (!mimeType || !isTimelapseSupported()) {
    throw new Error("This browser can't generate video. Try the latest Chrome, Edge or Safari.");
  }

  // Preload every frame first so the recording itself never stalls on the network.
  const loaded: { img: HTMLImageElement; year: number; ageYears?: number }[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    try {
      const img = await loadImage(p.localSrc || p.url);
      loaded.push({ img, year: p.year, ageYears: p.ageYears });
    } catch {
      throw new Error(
        "Couldn't load one of the photos to build the video. If this keeps happening, the photo storage may need a CORS setting.",
      );
    }
    onProgress?.(i + 1, ordered.length);
  }

  // Bounded, even output size. Keep dimensions even (some encoders dislike odd).
  const width = maxWidth % 2 === 0 ? maxWidth : maxWidth - 1;
  const height = maxHeight % 2 === 0 ? maxHeight : maxHeight - 1;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't prepare the canvas for video.");

  const drawFrame = (index: number) => {
    const frame = loaded[index];
    // Letterbox background (classic dark slideshow matte).
    ctx.fillStyle = '#17150f';
    ctx.fillRect(0, 0, width, height);

    const iw = frame.img.naturalWidth || frame.img.width;
    const ih = frame.img.naturalHeight || frame.img.height;
    if (iw > 0 && ih > 0) {
      const scale = Math.min(width / iw, height / ih);
      const dw = Math.round(iw * scale);
      const dh = Math.round(ih * scale);
      const dx = Math.round((width - dw) / 2);
      const dy = Math.round((height - dh) / 2);
      ctx.drawImage(frame.img, dx, dy, dw, dh);
    }

    if (showYearLabel) {
      const pad = Math.round(width * 0.02);
      const fontPx = Math.max(18, Math.round(height * 0.05));
      ctx.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'alphabetic';
      const label =
        frame.ageYears != null ? `${frame.year} · age ${frame.ageYears}` : `${frame.year}`;
      const metrics = ctx.measureText(label);
      const boxW = Math.round(metrics.width) + pad * 2;
      const boxH = fontPx + pad;
      const boxX = pad;
      const boxY = height - boxH - pad;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, boxX + pad, boxY + boxH - Math.round(pad * 0.9));
    }
  };

  // fps=0 puts the track in "manual" mode — WE decide exactly when a frame is
  // captured via track.requestFrame(), rather than relying on the browser's own
  // automatic periodic sampling. The automatic (fixed-fps) mode has proven
  // unreliable for a detached, off-DOM canvas in some environments — it can
  // silently produce a recording whose own internal duration comes out as ~1ms
  // even after several real seconds of drawing, because frame capture ends up
  // tied to actual compositor/vsync activity rather than real elapsed time.
  // Explicit requestFrame() calls sidestep that entirely.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  } catch {
    // Some browsers reject explicit bitrate/mimeType combos — retry with just the type.
    recorder = new MediaRecorder(stream, { mimeType });
  }

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const totalMs = ordered.length * msPerPhoto;

  await new Promise<void>((resolve, reject) => {
    let rafId = 0;
    let stopped = false;

    const finish = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(rafId);
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch (e) {
        reject(e instanceof Error ? e : new Error('recorder-stop-failed'));
      }
    };

    recorder.onstop = () => resolve();
    recorder.onerror = () => {
      cancelAnimationFrame(rafId);
      reject(new Error('Recording failed while generating the video.'));
    };

    // Paint the first frame before recording starts so frame 0 is never blank,
    // then explicitly push it into the manual-mode track before anything else.
    drawFrame(0);
    track.requestFrame();
    try {
      recorder.start();
    } catch (e) {
      reject(e instanceof Error ? e : new Error('recorder-start-failed'));
      return;
    }

    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      if (elapsed >= totalMs) {
        drawFrame(ordered.length - 1); // ensure the last frame is the final paint
        track.requestFrame();
        finish();
        return;
      }
      const index = Math.min(ordered.length - 1, Math.floor(elapsed / msPerPhoto));
      drawFrame(index);
      track.requestFrame();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    // Safety valve: never hang forever if 'stop' never fires (add generous slack).
    setTimeout(finish, totalMs + 5000);
  });

  const rawBlob = new Blob(chunks, { type: mimeType });
  if (rawBlob.size === 0) {
    throw new Error("The video came out empty. Please try again.");
  }

  // MediaRecorder + canvas.captureStream() writes WebM files with no duration
  // in the container header (a well-known Chrome limitation) — without this,
  // the <video> element treats playback as ending almost instantly and the
  // seek bar never works, even though every frame's pixel data is genuinely
  // there. Patches the missing EBML duration element into the blob in place;
  // a no-op (returns the blob unchanged) for mp4 output or if duration is
  // already present, so this is safe to always call.
  const blob = mimeType.includes('webm')
    ? await fixWebmDuration(rawBlob, totalMs, { logger: false })
    : rawBlob;

  return { blob, mimeType, durationMs: totalMs, width, height };
}
