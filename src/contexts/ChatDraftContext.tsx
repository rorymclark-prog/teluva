import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export interface ChatAttachmentDraft {
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface ChatDraft {
  text: string;
  attachment?: ChatAttachmentDraft;
}

interface ChatDraftContextValue {
  /** Hand a photo + prefilled message to the assistant panel — it opens itself
      and loads the draft in, ready for the user to review and send. Used by
      CopyableValue's "Scan" action so a long-press anywhere in the app can
      route a photo into the same AI pipeline that already files documents,
      assets, medical records etc., instead of needing a bespoke upload spot
      for every field. */
  requestChatDraft: (draft: ChatDraft) => void;
  /** Bumped on every requestChatDraft call — AssistantBubble watches this. */
  draftSignal: number;
  /** Read-and-clear: called once by AssistantBubble when it opens for a draft,
      so a later manual open of the panel never replays a stale one. */
  consumeChatDraft: () => ChatDraft | null;
}

const ChatDraftContext = createContext<ChatDraftContextValue | null>(null);

export function ChatDraftProvider({ children }: { children: React.ReactNode }) {
  const draftRef = useRef<ChatDraft | null>(null);
  const [draftSignal, setDraftSignal] = useState(0);

  const requestChatDraft = useCallback((d: ChatDraft) => {
    draftRef.current = d;
    setDraftSignal((s) => s + 1);
  }, []);

  const consumeChatDraft = useCallback(() => {
    const d = draftRef.current;
    draftRef.current = null;
    return d;
  }, []);

  const value = React.useMemo(
    () => ({ requestChatDraft, draftSignal, consumeChatDraft }),
    [requestChatDraft, draftSignal, consumeChatDraft],
  );

  return <ChatDraftContext.Provider value={value}>{children}</ChatDraftContext.Provider>;
}

export function useChatDraft(): ChatDraftContextValue {
  const ctx = useContext(ChatDraftContext);
  if (!ctx) throw new Error('useChatDraft must be used within a ChatDraftProvider');
  return ctx;
}
