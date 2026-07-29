import { useEffect } from 'react';

// Stops the page BEHIND a full-screen overlay from scrolling while the
// overlay is open, on desktop and iOS Safari alike.
//
// WHY THIS EXISTS
// ----------------
// `overscroll-behavior: contain` (see index.css) stops scroll CHAINING —
// once the finger/pointer is already scrolling a panel and hits its end,
// the rest of the gesture no longer leaks to <body>. But it does nothing for
// a gesture that STARTS on the backdrop (or on any part of the fixed overlay
// that isn't itself a scroll container): that scroll goes straight to
// <body> and the dashboard behind the modal visibly moves. On iOS this also
// desyncs the page's scroll position — you close the modal and find
// yourself somewhere else on the page.
//
// WHY NOT `body { overflow: hidden }` ALONE
// ------------------------------------------
// Two problems:
//   1. iOS Safari does not honour `overflow: hidden` on <body> for a
//      finger-drag gesture — the page behind a fixed overlay still pans.
//      The reliable fix (used by every major overlay library) is to pin
//      the body with `position: fixed`, shift it up by the current scroll
//      offset via a negative `top`, and restore the exact scroll position
//      on unlock.
//   2. A blind global CSS selector keyed off `.fixed.inset-0` existing
//      anywhere in the DOM is unsafe in this app: several overlays are
//      permanently mounted and only conditionally render their content
//      (FirstRunTour, FamilyInterview, HubSettingsModal, etc. all guard
//      internally rather than being conditionally mounted by their
//      parent). If any such element were ever left in a "present but
//      should-be-invisible" state, the page would lock forever. A hook
//      that a component calls explicitly, driven by its own open/active
//      boolean, has no such failure mode.
//
// REFERENCE COUNTING
// -------------------
// Modals in this app stack (an open modal can open a confirm dialog on top
// of itself, e.g. ConfirmDeleteButton inside EditMemberModal). Each nested
// lock increments a module-level counter; only the LAST unlock actually
// restores the page. This makes the hook safe to use from multiple
// simultaneously-open overlays without them fighting over body state.
let lockCount = 0;
let savedScrollY = 0;
let savedBodyStyle: {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
  paddingRight: string;
} | null = null;

function lockBodyScroll() {
  lockCount += 1;
  if (lockCount > 1) return; // already locked elsewhere — just bump the refcount, no-op otherwise

  savedScrollY = window.scrollY || window.pageYOffset || 0;

  // Scrollbar-width compensation: locking removes the vertical scrollbar on
  // desktop, which would otherwise shift all fixed/centered content a few
  // pixels sideways for the duration of the modal. Measure the gap between
  // the viewport and the (still-scrollable, pre-lock) document and pad it
  // back in as padding-right so nothing jumps.
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

  const bodyStyle = document.body.style;
  savedBodyStyle = {
    position: bodyStyle.position,
    top: bodyStyle.top,
    left: bodyStyle.left,
    right: bodyStyle.right,
    width: bodyStyle.width,
    overflow: bodyStyle.overflow,
    paddingRight: bodyStyle.paddingRight,
  };

  bodyStyle.position = 'fixed';
  bodyStyle.top = `-${savedScrollY}px`;
  bodyStyle.left = '0';
  bodyStyle.right = '0';
  bodyStyle.width = '100%';
  bodyStyle.overflow = 'hidden';

  if (scrollbarWidth > 0) {
    const existingPaddingRight = parseFloat(getComputedStyle(document.body).paddingRight || '0') || 0;
    bodyStyle.paddingRight = `${existingPaddingRight + scrollbarWidth}px`;
  }
}

function unlockBodyScroll() {
  if (lockCount === 0) return; // already unlocked — no-op
  lockCount -= 1;
  if (lockCount > 0) return; // a nested overlay is still holding the lock

  const bodyStyle = document.body.style;
  if (savedBodyStyle) {
    bodyStyle.position = savedBodyStyle.position;
    bodyStyle.top = savedBodyStyle.top;
    bodyStyle.left = savedBodyStyle.left;
    bodyStyle.right = savedBodyStyle.right;
    bodyStyle.width = savedBodyStyle.width;
    bodyStyle.overflow = savedBodyStyle.overflow;
    bodyStyle.paddingRight = savedBodyStyle.paddingRight;
  }
  savedBodyStyle = null;

  // Undo the `top: -scrollY` shift by restoring the exact scroll position —
  // position:fixed on body would otherwise leave the page at the top.
  window.scrollTo(0, savedScrollY);
}

/**
 * Lock <body> scroll while `active` is true. Call unconditionally at the top
 * of any overlay/modal component (before any early `return null`), passing
 * the same boolean that gates whether the overlay is visible — e.g.
 * `useBodyScrollLock(isOpen)`, `useBodyScrollLock(open)`,
 * `useBodyScrollLock(status === 'active')`.
 *
 * Reference-counted and idempotent: safe to use from several
 * simultaneously-mounted/active overlays (stacked modals) at once.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined') return;

    lockBodyScroll();
    return () => unlockBodyScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
