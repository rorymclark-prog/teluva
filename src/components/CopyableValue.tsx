import React, { useCallback, useRef, useState } from 'react';
import { Copy, Share2, Check, Camera } from 'lucide-react';
import { canShare } from '../utils/share';
import { useChatDraft } from '../contexts/ChatDraftContext';

const LONG_PRESS_MS = 450;

interface Props {
  /** The raw value to copy/share — e.g. the actual SV number, not display formatting. */
  value: string;
  /** What this value IS, used as the share sheet's title (e.g. "SV number"). */
  label?: string;
  className?: string;
  /** What to render as the visible text — defaults to `value` itself. */
  children?: React.ReactNode;
}

// Wraps a READ-ONLY displayed number/value (an ID number, IBAN, phone number
// — anything someone might need to relay to a doctor, a form, a phone call)
// with a long-press-to-copy-or-share gesture. Nothing here is a text input —
// those already support the browser's native tap-and-hold select/copy, so
// this is only for plain display text that currently has no way to lift the
// value off the screen at all.
//
// Both a genuine long-press (touch-and-hold, ~450ms — the mobile "hold on a
// value" gesture the request was for) AND a plain click/tap open the same
// menu, so this works the same way with a mouse on desktop, where there is
// no long-press gesture to hold in the first place.
export default function CopyableValue({ value, label, className, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const { requestChatDraft } = useChatDraft();
  const scanInputRef = useRef<HTMLInputElement>(null);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const startPress = useCallback(() => {
    firedRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setMenuOpen(true);
      try { navigator.vibrate?.(10); } catch { /* unsupported — purely a nicety */ }
    }, LONG_PRESS_MS);
  }, []);

  const cancelPress = useCallback(() => clearTimer(), []);

  const openOnPlainClick = useCallback(() => {
    if (!firedRef.current) setMenuOpen(true);
  }, []);

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — nothing to fall back to, fail quiet */ }
    setMenuOpen(false);
  };

  const doShare = async () => {
    try {
      await navigator.share({ title: label, text: value });
    } catch { /* share sheet cancelled/unavailable — not an error worth surfacing */ }
    setMenuOpen(false);
  };

  // "Scan" — take/pick a photo relevant to this exact field (a medication box,
  // an insurance card, proof of an allergy) and hand it straight to the AI
  // assistant, pre-attached with a message naming what it's for. Deliberately
  // does NOT try to save the photo anywhere itself — there's no per-field photo
  // slot in the data model for "Chronic conditions" or "Blood type", and there
  // doesn't need to be: the assistant already knows how to read a photo and
  // file it into the right place (a document, a medical record, an asset), so
  // this just gets the photo to that same pipeline with better-than-nothing
  // context about which field prompted it.
  const doScan = () => {
    setMenuOpen(false);
    scanInputRef.current?.click();
  };

  const onScanFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (typeof dataUrl !== 'string') return;
      requestChatDraft({
        text: label
          ? `Here's a photo for "${label}"${value ? ` (currently on file: ${value})` : ''}.`
          : "Here's a photo — please file it in the right place.",
        attachment: { name: file.name || 'scan.jpg', mimeType: file.type || 'image/jpeg', dataUrl },
      });
    };
    reader.readAsDataURL(file);
  };

  if (!value) return <>{children}</>;

  // Divs, not spans: `children` is often block-level (a <p>, e.g. the big
  // number in ShowCardModal), and a block element inside an inline <span> is
  // invalid HTML. "relative inline-block" keeps the same visual sizing a
  // span would have had.
  return (
    <div className={`relative inline-block ${className || ''}`}>
      <div
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onClick={(e) => { e.stopPropagation(); openOnPlainClick(); }}
        onContextMenu={(e) => e.preventDefault()}
        className="cursor-pointer select-none"
        style={{ WebkitTouchCallout: 'none' }}
      >
        {children ?? value}
      </div>

      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onScanFile}
        className="hidden"
      />

      {copied && (
        <span className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-ink-900 text-white text-[11px] font-semibold px-2.5 py-1 whitespace-nowrap pointer-events-none z-10">
          <Check className="w-3 h-3" /> Copied
        </span>
      )}

      {menuOpen && (
        <>
          {/* Full-screen scrim to close on outside tap — stopPropagation above
              keeps a tap ON the value from also hitting this and re-toggling. */}
          <div
            className="fixed inset-0 z-[210]"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}
          />
          <div className="absolute z-[211] top-full left-1/2 -translate-x-1/2 mt-1.5 flex items-center gap-1 rounded-xl bg-ink-900 text-white p-1 shadow-lift">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void doCopy(); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" /> Copy
            </button>
            {canShare && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void doShare(); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5" /> Share
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); doScan(); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5" /> Scan
            </button>
          </div>
        </>
      )}
    </div>
  );
}
