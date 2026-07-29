import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import AIChatbot, { AiEdit } from './AIChatbot';
import type { UndoRecord } from '../utils/aiUndo';
import type { FamilyMember, FamilyDocument, ReferralRecord } from '../types';
import { useT } from '../i18n/LangContext';
import SheetGrabber from './SheetGrabber';

interface Props {
  members: FamilyMember[];
  onApplyEdits: (edits: AiEdit[]) => Promise<UndoRecord[] | void>;
  onAddMemberDoc: (memberId: string, doc: FamilyDocument) => Promise<void>;
  onAddReferral: (memberId: string, rec: ReferralRecord) => Promise<void>;
  demo?: boolean;
  isBusinessSpace?: boolean;
  onOpenFunAvatar?: () => void;
  onGo?: (memberId: string, tab: string) => void;
  onGoView?: (view: string) => void;
  onUndoEdits?: (records: UndoRecord[]) => Promise<{ undone: number; missing: number }>;
  /** Bump to open the panel from outside — e.g. the pending-changes banner. */
  openSignal?: number;
}

/**
 * Floating assistant launcher — a bubble in the bottom-right that expands into
 * the AI chat on ANY screen (replaces the old full-width Assistant tab). The
 * launcher toggles to a close (X); clicking anywhere outside the panel (or Esc,
 * or the mobile backdrop) also closes it.
 */
export default function AssistantBubble({ members, onApplyEdits, onAddMemberDoc, onAddReferral, demo, isBusinessSpace, onOpenFunAvatar, onGo, onGoView, onUndoEdits, openSignal }: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // Opened from outside. Guarded on a truthy signal so the initial render
  // doesn't pop the panel open on every page load.
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);

  // Close on any click outside the panel (the launcher is excluded — it toggles
  // itself) and on Escape. This is what makes clicking the page dismiss the chat.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (launcherRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {open && (
        <>
          {/* Mobile backdrop — dims the page + tap to dismiss */}
          <div
            className="fixed inset-0 z-40 bg-ink-900/25 sm:hidden anim-fade"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Chat panel — bottom sheet on mobile, anchored popover on desktop.
              Sits above the launcher (bottom-24) so the launcher's X stays tappable.
              Frosted glass — the one sanctioned .glass surface in the app.

              Height is an explicit dvh figure, NOT a top+bottom inset pair. A
              fixed element's containing block on iOS Safari is the LARGE
              viewport — the one you get with the toolbars retracted — so
              `top-16 bottom-24` produced a panel whose bottom edge sat behind
              the browser chrome whenever the toolbars were showing. The message
              list scrolled fine; the part you needed was simply off-screen, and
              no amount of scrolling brings back something the viewport does not
              reach. That is what made "Apply" untappable on an iPhone. */}
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t.nav_assistant}
            className="fixed z-40 flex flex-col glass rounded-2xl overflow-hidden border border-cream-300 shadow-lift anim-sheet
                       inset-x-3 bottom-24 h-[min(72dvh,calc(100dvh-8rem))]
                       sm:inset-auto sm:right-4 sm:bottom-24 sm:top-auto sm:h-[min(620px,calc(100dvh-9rem))]
                       sm:w-[400px]"
          >
            {/* Mobile grabber bar */}
            <SheetGrabber onClose={() => setOpen(false)} />

            {demo ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3">
                <div className="w-12 h-12 rounded-full bg-clay-50 text-clay-500 flex items-center justify-center">
                  <Sparkles className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-ink-900">{t.nav_assistant}</p>
                <p className="text-[13px] text-ink-500 max-w-[240px]">
                  Sign in to chat with your family assistant — ask questions, scan documents, and update details by voice.
                </p>
                {/* Same one-way-door problem as the footer: this told people to sign
                    in without giving them anywhere to do it, and an installed app
                    has no address bar to escape the demo with. */}
                <a href="/" className="btn-primary px-4 py-2 text-[13px] no-underline">
                  Sign in with Google
                </a>
              </div>
            ) : (
              <AIChatbot
                members={members}
                onApplyEdits={onApplyEdits}
                onAddMemberDoc={onAddMemberDoc}
                onAddReferral={onAddReferral}
                isBusinessSpace={isBusinessSpace}
                onOpenFunAvatar={onOpenFunAvatar ? () => { setOpen(false); onOpenFunAvatar(); } : undefined}
                onGo={onGo ? (memberId, tab) => { setOpen(false); onGo(memberId, tab); } : undefined}
                onGoView={onGoView ? (view) => { setOpen(false); onGoView(view); } : undefined}
                onUndoEdits={onUndoEdits}
              />
            )}
          </div>
        </>
      )}

      <button
        ref={launcherRef}
        data-tour="ai-assistant"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? t.btn_close : t.nav_assistant}
        aria-expanded={open}
        className="fixed z-30 bottom-4 right-4 w-14 h-14 rounded-full text-white flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        style={{
          backgroundImage: 'linear-gradient(135deg, var(--color-clay-500), var(--color-clay-600))',
          boxShadow: 'var(--shadow-glow)',
        }}
      >
        {open ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </button>
    </>
  );
}
