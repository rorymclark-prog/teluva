import React, { useRef } from 'react';

/**
 * The grey line at the top of every bottom sheet — now an actual handle.
 *
 * It has looked draggable since the day it was added and did nothing, which is
 * worse than not drawing it at all: a sheet that shows the affordance for
 * swipe-to-dismiss and then ignores the swipe reads as broken. Grab the line and
 * pull down and the sheet follows your finger; past roughly a quarter of its own
 * height, or on a fast flick, it closes.
 *
 * Two design notes:
 *  - The drag moves the PANEL (this element's parent), not the handle. Panels
 *    across the app are variously plain divs and framer-motion elements, so the
 *    move is a direct transform on the DOM node rather than anything that
 *    assumes an animation library is present.
 *  - The visible line stays 4px, but the touch target is padded out to 28px.
 *    A 4px grab handle is not hittable with a thumb.
 *
 * Phone-only by construction: the wrapper carries `sm:hidden`, exactly as the
 * static bar it replaces did.
 */
export default function SheetGrabber({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startT: number; panel: HTMLElement } | null>(null);

  const panelOf = (el: HTMLElement | null) => el?.parentElement ?? null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelOf(ref.current);
    if (!panel) return;
    drag.current = { startY: e.clientY, startT: e.timeStamp, panel };
    panel.style.transition = 'none';
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Downward only. Rubber-banding upward would imply the sheet expands, which
    // none of these do.
    const dy = Math.max(0, e.clientY - d.startY);
    d.panel.style.transform = `translateY(${dy}px)`;
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const dy = Math.max(0, e.clientY - d.startY);
    const dt = Math.max(1, e.timeStamp - d.startT);
    const velocity = dy / dt; // px per ms
    const far = dy > Math.min(140, d.panel.offsetHeight * 0.25);
    const flick = velocity > 0.5 && dy > 40;

    if (far || flick) {
      // Carry the sheet the rest of the way out before unmounting, so the close
      // continues the gesture instead of the sheet vanishing under the thumb.
      d.panel.style.transition = 'transform 180ms ease-out, opacity 180ms ease-out';
      d.panel.style.transform = `translateY(${d.panel.offsetHeight}px)`;
      d.panel.style.opacity = '0';
      window.setTimeout(onClose, 170);
      return;
    }

    d.panel.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
    d.panel.style.transform = '';
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label="Close"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClose();
        }
      }}
      // touch-none stops the browser claiming the gesture as a page scroll
      // before the handler ever sees it.
      className={`mx-auto -mb-2 flex h-7 w-16 cursor-grab touch-none items-center justify-center active:cursor-grabbing sm:hidden ${className}`}
    >
      <div className="h-1 w-9 rounded-full bg-cream-400" />
    </div>
  );
}
