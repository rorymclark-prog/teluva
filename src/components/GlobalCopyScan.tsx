import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Share2, Check, Camera, X } from 'lucide-react';
import { canShare } from '../utils/share';
import { useChatDraft } from '../contexts/ChatDraftContext';

// ---------------------------------------------------------------------------
// GlobalCopyScan — the "long-press must work everywhere" fallback.
//
// CopyableValue.tsx is an explicit opt-in wrap, applied field-by-field. That
// approach is whack-a-mole: every screen we didn't get to (Check-ups,
// appointments, ID & Passports, ...) has no long-press at all, so the OS's
// own text-selection bubble shows instead. This component is the opposite —
// mounted ONCE near the app root, it listens for a genuine long-press
// ANYWHERE and works out what to do from the DOM at that point, with no
// per-field wiring required. New screens get it automatically.
//
// It backs off completely inside anything already handled: form controls,
// links/buttons, and any CopyableValue instance (marked data-copy-scan) —
// those keep their own simpler, better-labelled Copy/Share/Scan popover.
//
// Two behaviours, chosen from the DOM shape under the press:
//  - Atomic field (e.g. a label+value pair like "SV Number" / "1234567890"):
//    grow the smallest clean block around the press and offer Copy/Share/Scan
//    on the WHOLE thing, formatted "Label: value" — not just the bare value.
//  - A list of repeated items (e.g. two appointment cards, three ID rows —
//    detected by sibling tag-name homogeneity, the reliable signature of a
//    .map()-rendered list in this codebase): enter a WhatsApp-forward-style
//    selection mode. Checkboxes appear on every item in that list, the
//    pressed one is pre-ticked, and a floating bar offers Copy/Share for
//    whatever's ticked.
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 12;
const MAX_TEXT_LEN = 500;

const EXCLUDE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [contenteditable="true"], ' +
  '[data-copy-scan], [data-gcs-ui], svg, nav, header';

function isExcluded(el: Element | null): boolean {
  return !!el?.closest(EXCLUDE_SELECTOR);
}

function hasInteractiveDescendant(el: Element): boolean {
  return !!el.querySelector('button, a, input, textarea, select, [role="button"], [contenteditable="true"]');
}

// Smallest nearby element that reads as a plain block of text: has its own
// content, isn't huge, and isn't itself hosting another tappable control.
function findLeaf(start: Element | null): HTMLElement | null {
  let el = start as HTMLElement | null;
  for (let i = 0; i < 5 && el; i++) {
    if (isExcluded(el)) return null;
    const text = el.innerText?.trim();
    if (text && text.length > 0 && text.length <= MAX_TEXT_LEN && !hasInteractiveDescendant(el)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// Grows the leaf upward into its cohesive field (e.g. a caption above a
// value) while it stays clean — stops at anything interactive, anything too
// big, or any ancestor with more than a handful of direct children (that's
// "a section", not "a field").
function growBlock(leaf: HTMLElement): HTMLElement {
  let best = leaf;
  let el: HTMLElement = leaf;
  for (let i = 0; i < 4; i++) {
    const parent = el.parentElement;
    if (!parent || isExcluded(parent)) break;
    const text = parent.innerText?.trim();
    if (!text || text.length > MAX_TEXT_LEN) break;
    if (hasInteractiveDescendant(parent)) break;
    if (parent.children.length > 4) break;
    best = parent;
    el = parent;
  }
  return best;
}

// Walking up from the leaf, find the nearest ancestor whose direct children
// are a repeated-item list: >= 2 children, each with its own text and no
// interactive descendant, all sharing a tag name. Same-tag siblings is the
// reliable fingerprint of a .map()-rendered list (or repeated helper
// component) in this codebase — a single card's internal parts (a title
// <p>, a date <p>, a pill <span>) don't share one tag, so they're correctly
// left alone as one atomic block instead.
function findListBox(leaf: HTMLElement): { box: HTMLElement; items: HTMLElement[] } | null {
  let el: HTMLElement | null = leaf.parentElement;
  for (let i = 0; i < 5 && el; i++) {
    if (isExcluded(el)) return null;
    const kids = Array.from(el.children).filter((k): k is HTMLElement => {
      if (!(k instanceof HTMLElement)) return false;
      if (isExcluded(k)) return false;
      const text = k.innerText?.trim();
      return !!text && text.length <= MAX_TEXT_LEN && !hasInteractiveDescendant(k);
    });
    if (kids.length >= 2 && kids.every((k) => k.tagName === kids[0].tagName)) {
      return { box: el, items: kids };
    }
    el = el.parentElement;
  }
  return null;
}

function formatBlockText(el: HTMLElement): string {
  const raw = (el.innerText || '').trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 2) return `${lines[0]}: ${lines[1]}`;
  return lines.join('\n');
}

// The release-click of the same touch/mouse gesture that fired a long-press
// must not also trigger whatever the pressed element normally does (open a
// detail modal, follow a link). One-shot capture-phase swallow.
function suppressNextClick() {
  const handler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.removeEventListener('click', handler, true);
  };
  document.addEventListener('click', handler, true);
  // Belt and braces: if no click ever comes (e.g. a pure keyboard/other
  // dismissal), don't leave a stray listener behind forever.
  setTimeout(() => document.removeEventListener('click', handler, true), 2000);
}

type Popover = { x: number; y: number; text: string };
type SelectState = { items: HTMLElement[]; selected: Set<number> };

function clampX(x: number, width: number): number {
  const margin = 10;
  return Math.min(Math.max(x, margin + width / 2), window.innerWidth - margin - width / 2);
}

export default function GlobalCopyScan() {
  const [popover, setPopover] = useState<Popover | null>(null);
  const [select, setSelect] = useState<SelectState | null>(null);
  const [rects, setRects] = useState<DOMRect[]>([]);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const highlightRef = useRef<HTMLElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanContextRef = useRef<string>('');
  const { requestChatDraft } = useChatDraft();

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const clearHighlight = () => {
    if (highlightRef.current) {
      highlightRef.current.style.outline = '';
      highlightRef.current.style.outlineOffset = '';
      highlightRef.current.style.borderRadius = '';
      highlightRef.current = null;
    }
  };

  const closeAll = useCallback(() => {
    setPopover(null);
    setSelect(null);
    clearHighlight();
  }, []);

  // ---- long-press detection (document-level, registered once) ----
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popover || select) return; // one interaction at a time
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (isExcluded(hit)) return;
      const leaf = findLeaf(hit);
      if (!leaf) return;
      startPos.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      timerRef.current = setTimeout(() => {
        startPos.current = null;
        suppressNextClick();
        try { navigator.vibrate?.(10); } catch { /* unsupported — purely a nicety */ }

        const listBox = findListBox(leaf);
        if (listBox) {
          const pressedIdx = listBox.items.findIndex((it) => it === leaf || it.contains(leaf));
          const initial = pressedIdx >= 0 ? new Set([pressedIdx]) : new Set(listBox.items.map((_, i) => i));
          setSelect({ items: listBox.items, selected: initial });
          return;
        }

        const block = growBlock(leaf);
        highlightRef.current = block;
        block.style.outline = '2px solid rgba(180,83,9,0.35)';
        block.style.outlineOffset = '2px';
        block.style.borderRadius = '4px';
        setPopover({ x: e.clientX, y: e.clientY, text: formatBlockText(block) });
      }, LONG_PRESS_MS);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!startPos.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) { clearTimer(); startPos.current = null; }
    };
    const onPointerUp = () => { clearTimer(); startPos.current = null; };

    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointercancel', onPointerUp, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    };
    // popover/select read via closure guard at the top — re-registering on
    // every open/close keeps that guard honest without needing refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover, select]);

  // ---- selection-mode: tap an item to toggle, tap outside to exit ----
  useEffect(() => {
    if (!select) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest('[data-gcs-ui]')) return;
      const idx = select.items.findIndex((it) => it === target || it.contains(target));
      e.preventDefault();
      e.stopPropagation();
      if (idx >= 0) {
        setSelect((s) => {
          if (!s) return s;
          const next = new Set(s.selected);
          if (next.has(idx)) next.delete(idx); else next.add(idx);
          return { ...s, selected: next };
        });
      } else {
        closeAll();
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [select, closeAll]);

  // ---- keep selection-mode overlays glued to their items while visible ----
  useEffect(() => {
    if (!select) { setRects([]); return; }
    let raf: number;
    const tick = () => {
      setRects(select.items.map((it) => it.getBoundingClientRect()));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [select]);

  // ---- dismiss the atomic popover on outside tap / Escape ----
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [popover, closeAll]);

  useEffect(() => clearHighlight, []);

  const doCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — nothing to fall back to, fail quiet */ }
  };

  const doShareText = async (text: string) => {
    try { await navigator.share({ text }); } catch { /* cancelled/unsupported — not an error */ }
  };

  const doScan = (context: string) => {
    scanContextRef.current = context;
    scanInputRef.current?.click();
  };

  const onScanFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') return;
      const ctx = scanContextRef.current;
      requestChatDraft({
        text: ctx
          ? `Here's a photo related to: "${ctx}". Please file it in the right place.`
          : "Here's a photo — please file it in the right place.",
        attachment: { name: file.name || 'scan.jpg', mimeType: file.type || 'image/jpeg', dataUrl },
      });
    };
    reader.readAsDataURL(file);
  };

  const menuButtonClass =
    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap';

  return (
    <>
      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onScanFile}
        className="hidden"
        data-gcs-ui="1"
      />

      {copied && createPortal(
        <span
          data-gcs-ui="1"
          className="fixed left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-ink-900 text-white text-[12px] font-semibold px-3 py-1.5 whitespace-nowrap pointer-events-none z-[220]"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <Check className="w-3.5 h-3.5" /> Copied
        </span>,
        document.body,
      )}

      {popover && createPortal(
        <div data-gcs-ui="1">
          <div className="fixed inset-0 z-[210]" onClick={closeAll} />
          <div
            className="fixed z-[211] flex items-center gap-1 rounded-xl bg-ink-900 text-white p-1 shadow-lift"
            style={{ left: clampX(popover.x, 220), top: Math.min(popover.y + 16, window.innerHeight - 60) }}
          >
            <button type="button" className={menuButtonClass} onClick={() => { void doCopyText(popover.text); closeAll(); }}>
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            {canShare && (
              <button type="button" className={menuButtonClass} onClick={() => { void doShareText(popover.text); closeAll(); }}>
                <Share2 className="w-3.5 h-3.5" /> Share
              </button>
            )}
            <button type="button" className={menuButtonClass} onClick={() => { doScan(popover.text); closeAll(); }}>
              <Camera className="w-3.5 h-3.5" /> Scan
            </button>
          </div>
        </div>,
        document.body,
      )}

      {select && createPortal(
        <div data-gcs-ui="1">
          {rects.map((r, i) => {
            const isSelected = select.selected.has(i);
            return (
              <React.Fragment key={i}>
                <div
                  className="fixed pointer-events-none z-[205] transition-colors"
                  style={{
                    left: r.left - 4,
                    top: r.top - 4,
                    width: r.width + 8,
                    height: r.height + 8,
                    borderRadius: 12,
                    background: isSelected ? 'rgba(196,120,56,0.14)' : 'transparent',
                    outline: isSelected ? '2px solid rgba(196,120,56,0.55)' : '2px dashed rgba(120,113,108,0.25)',
                  }}
                />
                <div
                  className="fixed pointer-events-none z-[206] w-5 h-5 rounded-md border-2 flex items-center justify-center"
                  style={{
                    left: r.right - 22,
                    top: r.top + 4,
                    background: isSelected ? 'var(--color-clay-600)' : 'var(--color-cream-50)',
                    borderColor: isSelected ? 'var(--color-clay-600)' : 'var(--color-cream-400)',
                  }}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
              </React.Fragment>
            );
          })}

          <div
            className="fixed left-1/2 -translate-x-1/2 z-[211] flex items-center gap-2 rounded-2xl bg-ink-900 text-white px-2 py-2 shadow-lift"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <button type="button" className="p-2 rounded-lg hover:bg-white/10 cursor-pointer" onClick={closeAll} title="Cancel">
              <X className="w-4 h-4" />
            </button>
            <span className="text-[13px] font-semibold px-1 tabular-nums">
              {select.selected.size} selected
            </span>
            <button
              type="button"
              className={menuButtonClass}
              disabled={select.selected.size === 0}
              style={select.selected.size === 0 ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
              onClick={() => {
                const text = select.items
                  .filter((_, i) => select.selected.has(i))
                  .map((it) => formatBlockText(it))
                  .join('\n\n');
                void doCopyText(text);
                closeAll();
              }}
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            {canShare && (
              <button
                type="button"
                className={menuButtonClass}
                disabled={select.selected.size === 0}
                style={select.selected.size === 0 ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                onClick={() => {
                  const text = select.items
                    .filter((_, i) => select.selected.has(i))
                    .map((it) => formatBlockText(it))
                    .join('\n\n');
                  void doShareText(text);
                  closeAll();
                }}
              >
                <Share2 className="w-3.5 h-3.5" /> Share
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
