import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';

/**
 * Shared delete affordance. Two jobs:
 *  1. Guarantee a >=44px tap target (Apple's minimum) for every delete action,
 *     icon-only or labeled.
 *  2. For anything genuinely hard to lose (irreversible, sensitive, or hard to
 *     recreate), require an in-place two-step confirm — Dashboard.tsx already
 *     had this exact pattern for removing a family member (deleteConfirmMemberId);
 *     this just makes it reusable instead of a bare window.confirm(), which
 *     looks and behaves like a broken webpage on iOS Safari/PWA.
 *
 * Trivial, easily-recreated deletes should pass confirm={false} — an
 * in-place confirm on EVERY delete trains people to tap through without
 * reading, which defeats the ones that matter.
 */
interface ConfirmDeleteButtonProps {
  onConfirm: () => void | Promise<void>;
  /** Accessible name for the idle trigger, e.g. "Delete Barclays current account". */
  ariaLabel: string;
  /** Show the inline Delete/Cancel step first. Default true. */
  confirm?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  /** True while onConfirm's promise is in flight, if the caller tracks it separately. */
  busy?: boolean;
  /**
   * 'quiet' (default) — muted icon that reddens on hover, for list rows on a
   * light background. 'solid' — a filled rosa button, for placement over dark
   * imagery (e.g. a photo hover-overlay) where the quiet variant has no contrast.
   * Kept as a variant rather than letting callers pass conflicting color
   * classes via `className`: two Tailwind utility classes for the same
   * property don't reliably resolve by source order, only by each utility's
   * fixed position in the generated stylesheet, so ad-hoc overrides are unsafe.
   */
  variant?: 'quiet' | 'solid' | 'danger-text';
  /** Extra classes merged onto the idle trigger (spacing, opacity/visibility, etc — avoid color utilities, use `variant` instead). */
  className?: string;
  /** Custom idle-trigger content. Defaults to a bare trash icon. */
  children?: React.ReactNode;
  /**
   * Short clarifying line shown above Delete/Cancel while confirming — e.g.
   * "Only removes the note; the attached scan stays in the Document Vault."
   * Use for the handful of deletes where the scope of "delete" isn't obvious
   * from the row itself. Read to screen readers via aria-describedby.
   */
  hint?: string;
}

const TRIGGER_VARIANT: Record<'quiet' | 'solid' | 'danger-text', string> = {
  quiet: 'text-ink-400 hover:text-rosa-500 hover:bg-cream-100',
  solid: 'bg-rosa-500 hover:bg-rosa-700 text-white active:scale-95',
  // Always-red label, e.g. a "Delete" text button in a form footer.
  'danger-text': 'text-rosa-600 hover:bg-rosa-50',
};

export default function ConfirmDeleteButton({
  onConfirm,
  ariaLabel,
  confirm = true,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  disabled = false,
  busy = false,
  variant = 'quiet',
  className = '',
  children,
  hint,
}: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const hintId = useRef(`confirm-delete-hint-${Math.random().toString(36).slice(2)}`).current;

  // Move focus to Cancel when the confirm step appears, so a screen reader
  // or keyboard user lands somewhere sane rather than on nothing.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  // Escape backs out without deleting — same convention as AiConsentModal.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirming(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirming]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const runConfirm = async () => {
    setConfirming(false);
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  const isBusy = busy || pending;

  if (confirming) {
    return (
      <span
        className="relative inline-flex items-center gap-1.5 shrink-0"
        onClick={stop}
        onPointerDownCapture={stop}
      >
        {hint && (
          <span
            id={hintId}
            role="status"
            className="absolute bottom-full right-0 mb-1.5 w-max max-w-[220px] rounded-lg bg-ink-900 text-cream-50 text-[11px] leading-snug px-2.5 py-1.5 shadow-lift z-10"
          >
            {hint}
          </span>
        )}
        <button
          type="button"
          onClick={runConfirm}
          disabled={isBusy}
          aria-describedby={hint ? hintId : undefined}
          className="inline-flex items-center justify-center gap-1 min-w-[44px] min-h-[44px] px-2.5 bg-rosa-500 hover:bg-rosa-700 text-white rounded-lg text-[12px] font-semibold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : confirmLabel}
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isBusy}
          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-2.5 border border-cream-300 text-ink-500 rounded-lg bg-white hover:bg-cream-100 text-[12px] font-semibold cursor-pointer disabled:opacity-60"
        >
          {cancelLabel}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        if (disabled || isBusy) return;
        if (confirm) setConfirming(true);
        else runConfirm();
      }}
      onPointerDownCapture={stop}
      disabled={disabled || isBusy}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] shrink-0 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed motion-reduce:transition-none ${TRIGGER_VARIANT[variant]} ${className}`}
    >
      {isBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : (children ?? <Trash2 className="w-4 h-4" aria-hidden="true" />)}
    </button>
  );
}
