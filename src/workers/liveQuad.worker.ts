/* ---------------------------------------------------------------------------
 * Viewfinder page detection, off the main thread.
 *
 * The modal posts a small RGBA copy of the current video frame (its buffer is
 * transferred, not copied) and gets back the live quad in that frame's
 * pixels. One frame is in flight at a time — the modal waits for the reply
 * before sending the next — so a slow phone simply sees fewer updates rather
 * than a queue of stale frames. See utils/liveQuad.ts for what "good" means.
 * ------------------------------------------------------------------------- */

import { detectLive } from '../utils/liveQuad';

export interface LiveRequest {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

self.onmessage = async (e: MessageEvent<LiveRequest>) => {
  const { id, width, height, buffer } = e.data;
  try {
    const img = new ImageData(new Uint8ClampedArray(buffer), width, height);
    const r = await detectLive(img);
    (self as unknown as Worker).postMessage({ id, ok: true, width, height, ...r });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
