import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember } from '../types';
import { auth } from '../lib/firebase';
import { loadFamilyInfo, loadHousehold, loadFinances, loadTimeline } from '../utils/db';
import {
  Sparkles, Send, Loader2, Check, X, Wand2, User, Bot, MessageSquarePlus
} from 'lucide-react';

const CHAT_KEY = 'assistant_chat_v1';

export type AiEdit =
  | { kind: 'member'; member: string; field: string; value: string }
  | { kind: 'passport'; member: string; country: string; number: string; expiry?: string }
  | { kind: 'contact'; name: string; relation?: string; phone?: string; email?: string }
  | { kind: 'number'; label: string; value: string };

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  edits?: AiEdit[];
  applied?: boolean;
}

interface Props {
  members: FamilyMember[];
  onApplyEdits: (edits: AiEdit[]) => Promise<void>;
}

// Strip heavy base64 (avatars, document file data) before sending as context.
function slimMembers(members: FamilyMember[]) {
  return members.map(m => {
    const { avatarUrl, documents, ...rest } = m as any;
    return {
      ...rest,
      documents: (documents || []).map((d: any) => ({ name: d.name, category: d.category, uploadedAt: d.uploadedAt })),
    };
  });
}

const SUGGESTIONS = [
  "What's Mia's shoe size?",
  'When does my residence permit expire?',
  "Ben is allergic to penicillin",
  "Add the school office number: 01 234 5678",
];

export default function AIChatbot({ members, onApplyEdits }: Props) {
  // Conversation persists across tab switches and refreshes until "New chat".
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { const raw = localStorage.getItem(CHAT_KEY); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Keep the conversation saved on this device.
  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-60))); } catch { /* ignore */ }
  }, [messages]);

  const startNewChat = () => {
    setMessages([]);
    setError(null);
    setInput('');
    try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
  };

  const buildContext = async () => {
    const [info, household, finances, timeline] = await Promise.all([
      loadFamilyInfo(), loadHousehold(), loadFinances(), loadTimeline(),
    ]);
    return { members: slimMembers(members), info, household, finances, timeline };
  };

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    setError(null);
    setInput('');
    const history = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in first.');
      const token = await user.getIdToken();
      const context = await buildContext();

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: msg, context, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'The assistant is unavailable right now.');

      const edits: AiEdit[] = Array.isArray(data.edits) ? data.edits : [];
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply || '…', edits: edits.length ? edits : undefined }]);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
      setMessages(prev => [...prev, { role: 'assistant', text: "Sorry — I couldn't reach the assistant just now." }]);
    } finally {
      setLoading(false);
    }
  };

  const applyEdits = async (idx: number, edits: AiEdit[]) => {
    setApplyingIdx(idx);
    try {
      await onApplyEdits(edits);
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, applied: true } : m));
    } catch (e: any) {
      setError(e?.message || "Couldn't save those changes.");
    } finally {
      setApplyingIdx(null);
    }
  };

  const dismissEdits = (idx: number) => {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, edits: undefined } : m));
  };

  return (
    <div className="card overflow-hidden h-[640px] flex flex-col font-sans">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-cream-200 bg-cream-50 flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-clay-500 text-white shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-ink-900">Family assistant</h2>
          <p className="text-[13px] text-ink-500 font-medium truncate">Ask about anything, or just tell me a fact and I'll file it for you.</p>
        </div>
        {messages.length > 0 && (
          <button onClick={startNewChat} className="btn-quiet text-xs px-3 py-1.5 ml-auto shrink-0" title="Clear and start a fresh conversation">
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New chat</span>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-white">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 space-y-5">
            <div className="w-14 h-14 rounded-3xl bg-clay-50 text-clay-500 flex items-center justify-center">
              <Wand2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-lg font-semibold text-ink-900">How can I help?</h3>
              <p className="text-[13px] text-ink-500 max-w-sm">
                Try telling me something like “Mia wears EU 30 shoes and is allergic to peanuts”, or ask “when does Papa's passport expire?”
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} className="chip bg-cream-100 text-ink-600 border border-cream-300 hover:bg-cream-200 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-soft ${m.role === 'user' ? 'bg-dusk-500 text-white' : 'bg-clay-500 text-white'}`}>
              {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] space-y-2 ${m.role === 'user' ? 'items-end' : ''}`}>
              <div className={`p-3 rounded-2xl text-[14px] leading-relaxed ${m.role === 'user' ? 'bg-dusk-500 text-white rounded-tr-md' : 'bg-cream-100 text-ink-800 rounded-tl-md'}`}>
                {m.text}
              </div>

              {m.edits && m.edits.length > 0 && (
                <div className="rounded-2xl border border-clay-200 bg-clay-50/70 p-3 space-y-2">
                  <p className="text-[12px] font-semibold text-clay-700 flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5" /> I'd like to save these — apply?
                  </p>
                  <ul className="space-y-1">
                    {m.edits.map((e, j) => (
                      <li key={j} className="text-[13px] text-ink-700 flex items-start gap-1.5">
                        <span className="text-clay-400 mt-0.5">•</span>
                        <span>{describeEdit(e)}</span>
                      </li>
                    ))}
                  </ul>
                  {m.applied ? (
                    <p className="text-[12px] font-semibold text-sage-700 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Saved to the vault.
                    </p>
                  ) : (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => applyEdits(i, m.edits!)}
                        disabled={applyingIdx === i}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        {applyingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Apply
                      </button>
                      <button onClick={() => dismissEdits(i)} className="btn-quiet text-xs px-3 py-1.5">
                        <X className="w-3.5 h-3.5" /> Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-clay-500 text-white flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="p-3 rounded-2xl bg-cream-100 text-ink-400 flex items-center gap-2 text-[13px]">
              <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-cream-200 bg-white">
        {error && <p className="text-[12px] text-rosa-700 mb-2">{error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Ask or tell me something…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            className="field flex-1"
          />
          <button type="submit" disabled={!input.trim() || loading} className="btn-primary px-3 py-2.5 shrink-0 disabled:opacity-40">
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[11px] text-ink-400 mt-2 text-center">The assistant suggests changes — nothing is saved until you tap Apply.</p>
      </div>
    </div>
  );
}

function describeEdit(e: AiEdit): string {
  if (e.kind === 'member') return `${e.member}: set ${e.field.replace(/_/g, ' ')} → “${e.value}”`;
  if (e.kind === 'passport') return `${e.member}: add ${e.country} passport ${e.number}${e.expiry ? ` (exp ${e.expiry})` : ''}`;
  if (e.kind === 'contact') return `Add contact ${e.name}${e.relation ? ` (${e.relation})` : ''}${e.phone ? ` · ${e.phone}` : ''}`;
  if (e.kind === 'number') return `Add number “${e.label}” → ${e.value}`;
  return JSON.stringify(e);
}
