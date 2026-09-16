/* ---------------------------------------------------------------------------
 * Getting pixels INTO the scanner: a still from the live camera, a photo from
 * the phone's own camera app, an uploaded image, or an uploaded PDF.
 *
 * Every image path ends in the same place — a canvas at the best resolution
 * the source offers, handed to scanPipeline.ts — so a photo taken with the
 * camera app is detected, verified, straightened and enhanced exactly like an
 * in-app capture.
 * ------------------------------------------------------------------------- */

import { renderDocPages } from './docText';

/* The largest canvas we will draw a source into.
 *
 * iOS Safari refuses to allocate a canvas over 16.7M pixels (4096x4096) and
 * does so SILENTLY — the canvas simply comes back blank. iPhones from the 15
 * Pro onward save 24MP photos by default (5712x4284 = 24.5M px), so a photo
 * from the camera app would scan as an empty page. 12.6M keeps a 12MP
 * (4032x3024) photo at full size and scales anything larger down to it, which
 * is still far above the 2200px the page is stored at. */
export const MAX_CAPTURE_PIXELS = 12_600_000;

/** Scale that brings w×h under MAX_CAPTURE_PIXELS (1 when it already fits). */
export function captureScale(w: number, h: number, maxPixels = MAX_CAPTURE_PIXELS): number {
  if (w <= 0 || h <= 0) return 1;
  const px = w * h;
  return px <= maxPixels ? 1 : Math.sqrt(maxPixels / px);
}

/** The canvas size a w×h source is drawn at. Floored, not rounded: rounding
 *  both sides up can land a few hundred pixels over the cap. */
export function captureSize(w: number, h: number): { width: number; height: number } {
  const k = captureScale(w, h);
  return { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)) };
}

function canvasFrom(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const size = captureSize(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!ctx) throw new Error('No 2D context for the capture');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The current video frame at the stream's native resolution. */
export function videoFrameCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  return canvasFrom(video, video.videoWidth || 1280, video.videoHeight || 720);
}

// ImageCapture is in Chrome (Android and desktop) but not Safari or Firefox,
// and not in TypeScript's DOM lib — so it is declared, and feature-tested.
interface PhotoCapabilitiesLike { imageWidth?: { max?: number } }
interface ImageCaptureLike {
  takePhoto(settings?: { imageWidth?: number }): Promise<Blob>;
  getPhotoCapabilities?(): Promise<PhotoCapabilitiesLike>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

export function hasImageCapture(): boolean {
  return typeof (globalThis as { ImageCapture?: unknown }).ImageCapture === 'function';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  // An <img> rather than createImageBitmap: it honours the EXIF orientation of
  // a camera-app photo in every browser this app supports, so a page shot in
  // portrait does not arrive lying on its side.
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That image could not be opened.'));
      el.src = url;
    });
    return canvasFrom(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Still {
  canvas: HTMLCanvasElement;
  /** 'photo' = a full sensor still from ImageCapture; 'video' = a frame of the preview stream. */
  kind: 'photo' | 'video';
}

/* A still from the live camera.
 *
 * Where the browser has ImageCapture (Chrome on Android), takePhoto() returns
 * a real photo at the sensor's full resolution — typically 12MP against the
 * preview stream's 1080p or 4K — so it is used first, at its largest size.
 * It is given a short deadline: on some Android devices takePhoto() stalls
 * while the camera reconfigures, and a shutter that hangs is worse than a
 * shutter that returns the video frame. Safari has no ImageCapture, so on an
 * iPhone this is always the video frame; the camera-app option in the modal
 * is the route to a full-resolution still there. */
export async function takeStill(video: HTMLVideoElement, track: MediaStreamTrack | null, timeoutMs = 2500): Promise<Still> {
  // Grab the frame FIRST, so the fallback is the moment the shutter fired,
  // not whatever the stream shows after a stalled takePhoto().
  const frame = videoFrameCanvas(video);
  if (track && track.readyState === 'live' && hasImageCapture()) {
    try {
      const Ctor = (globalThis as unknown as { ImageCapture: ImageCaptureCtor }).ImageCapture;
      const ic = new Ctor(track);
      const caps = ic.getPhotoCapabilities ? await withTimeout(ic.getPhotoCapabilities(), 800).catch(() => null) : null;
      const maxW = caps?.imageWidth?.max;
      const blob = await withTimeout(ic.takePhoto(maxW ? { imageWidth: maxW } : undefined), timeoutMs);
      const canvas = await blobToCanvas(blob);
      // Only worth it if it is bigger than the frame we already have AND the
      // same way up. Some Android devices hand back the photo in the sensor's
      // native landscape while the preview is portrait; a sideways page is a
      // worse result than a lower-resolution upright one.
      const sameWayUp = (canvas.width >= canvas.height) === (frame.width >= frame.height);
      if (sameWayUp && canvas.width * canvas.height > frame.width * frame.height) return { canvas, kind: 'photo' };
    } catch (err) {
      console.warn('takePhoto unavailable, using the video frame:', err);
    }
  }
  return { canvas: frame, kind: 'video' };
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

/* An uploaded PDF too big for the record, as page images.
 *
 * Rendered at the same 2200px the scanner stores a page at, one page at a
 * time (renderDocPages releases each canvas before the next). One page more
 * than `maxPages` is asked for, so the caller can tell "fits" from "too many
 * pages" without a second pass over the file. */
export async function rasterisePdf(dataUrl: string, maxPages: number): Promise<{ pages: string[]; tooMany: boolean }> {
  const wanted = Array.from({ length: maxPages + 1 }, (_, i) => i + 1);
  const rendered = await renderDocPages(dataUrl, wanted);
  const pages = rendered.map((p) => `data:image/jpeg;base64,${p.image}`);
  return { pages: pages.slice(0, maxPages), tooMany: pages.length > maxPages };
}

/* Scanner debug mode: `?scandebug=1` turns it on (and remembers it on this
 * device), `?scandebug=0` turns it off. Shows the stream resolution, the live
 * detector's timing and why a capture was or was not accepted — the numbers
 * needed to tune this on a real phone without a laptop attached. */
const DEBUG_KEY = 'teluva.scandebug';
export function scanDebugEnabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('scandebug');
    if (q === '1') localStorage.setItem(DEBUG_KEY, '1');
    if (q === '0') localStorage.removeItem(DEBUG_KEY);
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}
