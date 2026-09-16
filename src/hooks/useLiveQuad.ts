/* ---------------------------------------------------------------------------
 * The scanner viewfinder's live page outline and auto-capture.
 *
 * A few times a second a small copy of the video frame (LIVE_LONG_EDGE px) is
 * sent to workers/liveQuad.worker.ts, which finds and verifies the page off
 * the main thread. The outline it returns is drawn over the video, and the
 * shutter fires by itself once the SAME verified page has been found
 * LIVE_STABLE_COUNT times in a row without moving — "the page is in view and
 * you are holding still", which is what Apple's scanner waits for.
 *
 * What replaced what: auto-capture used to fire when the picture stopped
 * changing, with no idea whether a page was in it — it shot a blank desk just
 * as happily, and shot a page with its bottom edge out of frame, which then
 * got cropped to the wrong quad. That heuristic survives only as the fallback
 * for a browser where the worker cannot start or is too slow to be useful.
 *
 * One frame is in flight at a time and the next is scheduled from the reply,
 * with the interval stretched to at least the time detection took, so a slow
 * phone gets fewer updates rather than a backlog — and never a janky preview.
 * ------------------------------------------------------------------------- */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { isQuadRunStable, touchesFrame, type Quad } from '../utils/scanGeometry';
import { LIVE_LONG_EDGE, type LiveResult } from '../utils/liveQuad';

export type LiveStatus =
  | 'idle' // not running
  | 'dark' // frame too dark to judge (lens covered, exposure still settling)
  | 'searching' // running, no verified page yet
  | 'edge' // a page was found but runs out of the frame
  | 'holding' // verified page in view, waiting for it to hold still
  | 'firing'; // stable — the shutter has been triggered

export interface LiveHint {
  /** Quad in the pixels of the small frame it was found in. */
  quad: Quad;
  width: number;
  height: number;
}

export interface LiveState {
  status: LiveStatus;
  /** Last quad worth drawing (verified, or one that only fails for touching the frame). */
  quad: Quad | null;
  good: boolean;
  frame: { width: number; height: number } | null;
  engine: 'worker' | 'stillness' | null;
  lastMs: number | null;
}

// Aim for ~5 checks a second when detection is fast.
const LIVE_BASE_INTERVAL_MS = 200;
// ...and never slower than one a second, however slow it gets.
const LIVE_MAX_INTERVAL_MS = 1000;
// Consecutive verified sightings required before auto-capture. At ~200-300ms
// each this is most of a second of holding still, about what Apple waits.
const LIVE_STABLE_COUNT = 3;
// "Not moving": no corner shifts more than this share of the frame's long
// edge between sightings (≈8px at 640). Hand shake at arm's length is 2-5px
// here; reframing is 20+.
const LIVE_STABLE_TOLERANCE = 0.012;
// The first reply pays for loading scanic into the worker, so it gets longer.
const LIVE_FIRST_REPLY_TIMEOUT_MS = 8000;
const LIVE_REPLY_TIMEOUT_MS = 3000;
// Slower than this LIVE_SLOW_STRIKES times running → the phone cannot keep up,
// and the stillness fallback gives a better experience than a laggy outline.
const LIVE_SLOW_MS = 900;
const LIVE_SLOW_STRIKES = 3;

// The stillness fallback — the previous auto-capture, unchanged.
const STILL_INTERVAL_MS = 280;
const STILL_CHECKS = 3;
const STILL_DIFF_THRESHOLD = 8;

/* A brand new camera stream (first open, or right after Retake) renders a
 * handful of near-black frames while auto-exposure converges, and a finger
 * over the lens looks the same. Anything this dark (average luma, 0-255) is
 * treated as not-yet-usable: it resets the run of sightings and never fires. */
export const MIN_FRAME_BRIGHTNESS = 35;

const IDLE: LiveState = { status: 'idle', quad: null, good: false, frame: null, engine: null, lastMs: null };

interface Reply extends Partial<LiveResult> {
  id: number;
  ok: boolean;
  width?: number;
  height?: number;
  error?: string;
}

function meanLuma(data: Uint8ClampedArray, stride = 16): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * stride) {
    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    n++;
  }
  return n ? sum / n : 0;
}

export function useLiveQuad(videoRef: RefObject<HTMLVideoElement | null>, onFire: (hint: LiveHint | null) => void) {
  const [state, setState] = useState<LiveState>(IDLE);
  const onFireRef = useRef(onFire);
  useEffect(() => {
    onFireRef.current = onFire;
  }, [onFire]);

  const workerRef = useRef<Worker | null>(null);
  const workerBrokenRef = useRef(false);
  const workerAnsweredRef = useRef(false);
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<(Quad | null)[]>([]);
  const smallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const slowStrikesRef = useRef(0);
  const reqIdRef = useRef(0);
  const prevSampleRef = useRef<Uint8ClampedArray | null>(null);
  const stillCountRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const schedule = (gen: number, ms: number, fn: (gen: number) => void) => {
    clearTimer();
    timerRef.current = setTimeout(() => fn(gen), ms);
  };

  const getWorker = (): Worker | null => {
    if (workerBrokenRef.current) return null;
    if (!workerRef.current) {
      try {
        workerRef.current = new Worker(new URL('../workers/liveQuad.worker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        console.warn('Live page detection unavailable:', err);
        workerBrokenRef.current = true;
        return null;
      }
    }
    return workerRef.current;
  };

  const retireWorker = (why: unknown) => {
    console.warn('Live page detection off for this session:', why);
    workerBrokenRef.current = true;
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  const ask = (worker: Worker, width: number, height: number, buffer: ArrayBuffer): Promise<Reply> => {
    const id = ++reqIdRef.current;
    const timeout = workerAnsweredRef.current ? LIVE_REPLY_TIMEOUT_MS : LIVE_FIRST_REPLY_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(t);
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onErr);
      };
      const t = setTimeout(() => {
        cleanup();
        reject(new Error('no reply'));
      }, timeout);
      const onMsg = (e: MessageEvent<Reply>) => {
        if (e.data?.id !== id) return;
        cleanup();
        resolve(e.data);
      };
      const onErr = (e: ErrorEvent) => {
        cleanup();
        reject(e.error ?? new Error(e.message || 'worker error'));
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', onErr);
      worker.postMessage({ id, width, height, buffer }, [buffer]);
    });
  };

  const grabSmall = (video: HTMLVideoElement): ImageData | null => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const k = Math.min(1, LIVE_LONG_EDGE / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * k));
    const h = Math.max(1, Math.round(vh * k));
    if (!smallCanvasRef.current) smallCanvasRef.current = document.createElement('canvas');
    const c = smallCanvasRef.current;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  };

  // ── the stillness fallback ────────────────────────────────────────────────
  const stillTick = (gen: number) => {
    if (gen !== genRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return schedule(gen, STILL_INTERVAL_MS, stillTick);
    if (!smallCanvasRef.current) smallCanvasRef.current = document.createElement('canvas');
    const c = smallCanvasRef.current;
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, 64, 48);
    const frame = ctx.getImageData(0, 0, 64, 48).data;
    if (meanLuma(frame, 1) < MIN_FRAME_BRIGHTNESS) {
      stillCountRef.current = 0;
      prevSampleRef.current = null;
      setState((s) => ({ ...s, status: 'dark', engine: 'stillness' }));
      return schedule(gen, STILL_INTERVAL_MS, stillTick);
    }
    const prev = prevSampleRef.current;
    prevSampleRef.current = frame;
    if (prev) {
      let diff = 0;
      for (let i = 0; i < frame.length; i += 4) {
        diff += Math.abs(frame[i] - prev[i]) + Math.abs(frame[i + 1] - prev[i + 1]) + Math.abs(frame[i + 2] - prev[i + 2]);
      }
      if (diff / ((frame.length / 4) * 3) < STILL_DIFF_THRESHOLD) {
        stillCountRef.current += 1;
        if (stillCountRef.current >= STILL_CHECKS) {
          setState((s) => ({ ...s, status: 'firing', engine: 'stillness' }));
          onFireRef.current(null);
          return;
        }
        setState((s) => ({ ...s, status: 'holding', engine: 'stillness' }));
      } else {
        stillCountRef.current = 0;
        setState((s) => ({ ...s, status: 'searching', engine: 'stillness' }));
      }
    }
    schedule(gen, STILL_INTERVAL_MS, stillTick);
  };

  const startStillness = (gen: number) => {
    stillCountRef.current = 0;
    prevSampleRef.current = null;
    setState({ ...IDLE, status: 'searching', engine: 'stillness' });
    schedule(gen, STILL_INTERVAL_MS, stillTick);
  };

  // ── the live detector ─────────────────────────────────────────────────────
  const liveTick = async (gen: number) => {
    if (gen !== genRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return schedule(gen, LIVE_BASE_INTERVAL_MS, liveTick);
    const img = grabSmall(video);
    if (!img) return schedule(gen, LIVE_BASE_INTERVAL_MS, liveTick);
    const frame = { width: img.width, height: img.height };

    if (meanLuma(img.data) < MIN_FRAME_BRIGHTNESS) {
      historyRef.current = [];
      setState((s) => ({ ...s, status: 'dark', quad: null, good: false, frame, engine: 'worker' }));
      return schedule(gen, LIVE_BASE_INTERVAL_MS, liveTick);
    }

    const worker = getWorker();
    if (!worker) return startStillness(gen);
    const t0 = performance.now();
    let reply: Reply;
    try {
      reply = await ask(worker, img.width, img.height, img.data.buffer as ArrayBuffer);
    } catch (err) {
      retireWorker(err);
      if (gen === genRef.current) startStillness(gen);
      return;
    }
    if (gen !== genRef.current) return;
    if (!reply.ok) {
      retireWorker(reply.error);
      return startStillness(gen);
    }
    workerAnsweredRef.current = true;
    const elapsed = performance.now() - t0;
    slowStrikesRef.current = elapsed > LIVE_SLOW_MS ? slowStrikesRef.current + 1 : 0;
    if (slowStrikesRef.current >= LIVE_SLOW_STRIKES) {
      // Keep the worker (a later page may be quicker) but stop relying on it now.
      console.warn(`Live page detection too slow (${Math.round(elapsed)}ms); using stillness auto-capture`);
      workerBrokenRef.current = true;
      return startStillness(gen);
    }

    const q = reply.corners ?? null;
    const good = !!(q && reply.good);
    const history = historyRef.current;
    history.push(good ? q : null);
    if (history.length > 8) history.shift();
    const stable = good && isQuadRunStable(history, LIVE_STABLE_COUNT, LIVE_STABLE_TOLERANCE * Math.max(img.width, img.height));
    const edge = !good && !!q && touchesFrame(q, img.width, img.height);
    const status: LiveStatus = stable ? 'firing' : good ? 'holding' : edge ? 'edge' : 'searching';
    setState({ status, quad: good || edge ? q : null, good, frame, engine: 'worker', lastMs: Math.round(elapsed) });

    if (stable && q) {
      onFireRef.current({ quad: q, width: img.width, height: img.height });
      return;
    }
    const delay = Math.min(LIVE_MAX_INTERVAL_MS, Math.max(LIVE_BASE_INTERVAL_MS - elapsed, elapsed));
    schedule(gen, delay, liveTick);
  };

  /** Begin (or restart) watching the video. Safe to call from onPlaying. */
  const start = () => {
    const gen = ++genRef.current;
    clearTimer();
    historyRef.current = [];
    slowStrikesRef.current = 0;
    if (workerBrokenRef.current) return startStillness(gen);
    setState({ ...IDLE, status: 'searching', engine: 'worker' });
    void liveTick(gen);
  };

  /** Stop watching; any reply still in flight is ignored. */
  const stop = () => {
    genRef.current++;
    clearTimer();
    historyRef.current = [];
    setState(IDLE);
  };

  /** Stop and release the worker (modal closed). */
  const dispose = () => {
    stop();
    workerRef.current?.terminate();
    workerRef.current = null;
    workerAnsweredRef.current = false;
    // A fresh open gets a fresh chance: "too slow" may have been one bad moment.
    workerBrokenRef.current = false;
  };

  useEffect(
    () => () => {
      genRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { state, start, stop, dispose };
}
