import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import AIChatbot, { AiEdit } from './AIChatbot';
import type { FamilyMember, FamilyDocument } from '../types';
import { useT } from '../i18n/LangContext';

interface Props {
  members: FamilyMember[];
  onApplyEdits: (edits: AiEdit[]) => Promise<void>;
  onAddMemberDoc: (memberId: string, doc: FamilyDocument) => Promise<void>;
  demo?: boolean;
}

/**
 * Floating assistant launcher — a bubble in the bottom-right that expands into
 * the AI chat on ANY screen (replaces the old full-width Assistant tab). The
 * launcher toggles to a close (X), so there's no separate close control to
 * collide with the chat's own header; on mobile a backdrop tap also closes.
 */
export default function AssistantBubble({ members, onApplyEdits, onAddMemberDoc, demo }: Props) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <>
          {/* Mobile backdrop — tap anywhere to dismiss */}
          <div
            className="fixed inset-0 z-40 bg-ink-900/25 sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Chat panel — bottom sheet on mobile, anchored popover on desktop.
              Sits above the launcher (bottom-24) so the launcher's X stays tappable. */}
          <div
            role="dialog"
            aria-label={t.nav_assistant}
            className="fixed z-40 flex flex-col bg-white rounded-2xl overflow-hidden border border-cream-300 shadow-lift
                       inset-x-3 top-16 bottom-24
                       sm:inset-auto sm:right-4 sm:bottom-24 sm:top-auto
                       sm:w-[400px] sm:h-[min(620px,calc(100vh-9rem))]"
          >
            {demo ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 bg-white">
                <div className="w-12 h-12 rounded-full bg-clay-50 text-clay-500 flex items-center justify-center">
                  <Sparkles className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-ink-900">{t.nav_assistant}</p>
                <p className="text-[13px] text-ink-500 max-w-[240px]">
                  Sign in to chat with your family assistant — ask questions, scan documents, and update details by voice.
                </p>
              </div>
            ) : (
              <AIChatbot members={members} onApplyEdits={onApplyEdits} onAddMemberDoc={onAddMemberDoc} />
            )}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? t.btn_close : t.nav_assistant}
        aria-expanded={open}
        className="fixed z-50 bottom-4 right-4 w-14 h-14 rounded-full bg-clay-500 hover:bg-clay-600 text-white shadow-lift flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
      >
        {open ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </button>
    </>
  );
}
