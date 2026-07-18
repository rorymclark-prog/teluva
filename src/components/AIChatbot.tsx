import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember, VaultCategory, VaultDocument, FamilyDocument } from '../types';
import { auth } from '../lib/firebase';
import {
  loadFamilyInfo, loadHousehold, loadFinances, loadTimeline,
  loadDocuments, saveDocuments, uploadVaultFile, loadCalendarEvents,
  loadChatHistory, saveChatHistory,
} from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { useT } from '../i18n/LangContext';
import { compressImageToAvatar } from '../utils/imageCompress';
import {
  Sparkles, Send, Loader2, Check, X, Wand2, User, Bot, MessageSquarePlus,
  Paperclip, FileText, Image as ImageIcon, Mic, MicOff,
} from 'lucide-react';

// Web Speech API — may be undefined in unsupported browsers
const SR: any = (typeof window !== 'undefined')
  ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  : undefined;

const CHAT_KEY = 'assistant_chat_v1';
const newId = () => Date.now().toString() + Math.floor(Math.random() * 1000);

export type AiEdit =
  | { kind: 'new_member'; name: string; role?: string; nickname?: string; birthdate?: string }
  | { kind: 'member'; member: string; field: string; value: string }
  | { kind: 'passport'; member: string; country: string; number: string; expiry?: string }
  | { kind: 'contact'; name: string; relation?: string; phone?: string; email?: string }
  | { kind: 'number'; label: string; value: string }
  | { kind: 'document'; name: string; category: VaultCategory; member?: string }
  | { kind: 'calendar_event'; title: string; date: string; time?: string; category?: string; memberNames?: string[] }
  | { kind: 'list_add'; list: 'vehicles' | 'pets' | 'utilities' | 'banks' | 'insurance' | 'benefits' | 'timeline' | 'shopping'; item: Record<string, string> }
  | { kind: 'asset'; name: string; category?: string; assignedMember?: string; make?: string; model?: string; serialNumber?: string; purchaseDate?: string; purchasePrice?: string; notes?: string }
  | { kind: 'household_set'; field: 'address' | 'doorCode' | 'wifiName' | 'wifiPassword' | 'garageCode'; value: string }
  | { kind: 'transit_pass'; member: string; name: string; operator?: string; cardNumber?: string; zone?: string; validFrom?: string; validUntil?: string; notes?: string }
  | { kind: 'care_schedule'; member: string; careKind: string; provider?: string; lastVisit?: string; intervalMonths?: number; nextDue?: string; notes?: string };

interface Attachment { name: string; mimeType: string; dataUrl: string; }

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  edits?: AiEdit[];
  applied?: boolean;
  image?: string;            // dataUrl preview on a user message (stripped from storage)
  sourceImage?: Attachment;  // carried on the assistant message so 'document' edits can file the scan
}

interface Props {
  members: FamilyMember[];
  onApplyEdits: (edits: AiEdit[]) => Promise<void>;
  // File a scanned document into a member's own Documents tab (in addition to the vault)
  onAddMemberDoc: (memberId: string, doc: FamilyDocument) => Promise<void>;
}

function slimMembers(members: FamilyMember[]) {
  return members.map(m => {
    const { avatarUrl, documents, digitalAccounts, favorites, growthHistory, ...rest } = m as any;
    return {
      ...rest,
      documents: (documents || []).map((d: any) => ({ name: d.name, category: d.category, uploadedAt: d.uploadedAt })),
      // NEVER send stored passwords to the AI; keep only what lets it answer "what accounts does X have"
      digitalAccounts: (digitalAccounts || []).map((a: any) => ({ service: a.service, username: a.username })),
      // Strip base64 wishlist images (huge + would truncate the whole context)
      favorites: (favorites || []).map((f: any) => ({ name: f.name, price: f.price, notes: f.notes })),
      // Keep only the latest growth entry — history is bulky and rarely asked
      growthHistory: (growthHistory || []).slice(-1),
    };
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

const firstName = (m: FamilyMember): string => (m.nickname || m.name).trim().split(/\s+/)[0];

// Starter suggestions built from the REAL family, not placeholders.
function buildSuggestions(members: FamilyMember[]): string[] {
  if (!members.length) {
    return [
      'Add a new family member',
      'What can you help me with?',
      'What’s coming up on the calendar?',
    ];
  }
  const kids = members.filter(m => m.role === 'Child');
  const a = kids[0] || members[0];
  const b = kids[1] || kids[0] || members[0];
  return Array.from(new Set([
    `What’s ${firstName(a)}’s shoe size?`,
    'When does my residence permit expire?',
    `How old is ${firstName(b)} and what clothes size should I get?`,
    'Whose passport expires soonest?',
  ]));
}

export default function AIChatbot({ members, onApplyEdits, onAddMemberDoc }: Props) {
  const { uid } = useFamilyCtx();
  const { lang, t } = useT();
  const suggestions = buildSuggestions(members);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { const raw = localStorage.getItem(CHAT_KEY); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  });
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  // Clean up speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!uid) { setMessages([]); return; }
    loadChatHistory(uid).then(history => {
      if (history.length > 0) setMessages(history);
    });
  }, [uid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Strip heavy/base64 fields (image, sourceImage) before persisting; keep
  // edits + applied so cards restore their applied state.
  const slimForCloud = (msgs: ChatMessage[]) =>
    msgs.map(({ image, sourceImage, ...m }) => m);

  // Persist the conversation (minus heavy image data) on this device.
  useEffect(() => {
    try {
      const slim = slimForCloud(messages.slice(-60));
      localStorage.setItem(CHAT_KEY, JSON.stringify(slim));
    } catch { /* ignore */ }
  }, [messages]);

  const startNewChat = () => {
    setMessages([]);
    setError(null);
    setInput('');
    setAttachment(null);
    try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
    if (uid) saveChatHistory(uid, []);
  };

  const buildContext = async () => {
    const [info, household, finances, timeline, docs, events] = await Promise.all([
      loadFamilyInfo(), loadHousehold(), loadFinances(), loadTimeline(), loadDocuments(), loadCalendarEvents(),
    ]);
    const documents = (docs || []).map(d => ({ name: d.name, category: d.category, memberId: d.memberId, uploadedAt: d.uploadedAt }));
    return { members: slimMembers(members), info, household, finances, timeline, documents, calendar: events || [] };
  };

  const onPasteImage = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items) as DataTransferItem[]) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        try {
          let dataUrl = await fileToDataUrl(file);
          dataUrl = await compressImageToAvatar(dataUrl, 1600, 0.82);
          setAttachment({ name: 'screenshot.jpg', mimeType: 'image/jpeg', dataUrl });
          setError(null);
        } catch {
          setError("Couldn't read the pasted image.");
        }
        return;
      }
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError('That file is over 20MB — please use a smaller scan.'); return; }
    try {
      let dataUrl = await fileToDataUrl(file);
      let mimeType = file.type || 'application/octet-stream';
      // Shrink photos before sending — a raw phone photo is too big for the
      // request and slows the scan; 1600px is plenty for OCR. PDFs pass through.
      if (mimeType.startsWith('image/')) {
        // 1200px @ 0.75 is plenty for OCR and keeps the payload small on mobile
        dataUrl = await compressImageToAvatar(dataUrl, 1200, 0.75);
        mimeType = 'image/jpeg';
      }
      setAttachment({ name: file.name, mimeType, dataUrl });
      setError(null);
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const toggleVoice = () => {
    if (!SR) return;

    if (listening) {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      return; // onend will set listening=false
    }

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;

    rec.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    rec.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const send = async (text: string, retryAtt?: Attachment | null) => {
    const msg = text.trim();
    const att = retryAtt !== undefined ? retryAtt : attachment;
    if ((!msg && !att) || loading) return;
    setError(null);
    setInput('');
    setAttachment(null);
    setIsScanning(!!att);

    const history = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(prev => [...prev, { role: 'user', text: msg || `📎 ${att?.name}`, image: att?.dataUrl }]);
    setLoading(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Please sign in first.');
      const token = await user.getIdToken();
      const context = await buildContext();

      const body: any = { message: msg, context, history, lang };
      if (att) body.image = { mimeType: att.mimeType, data: att.dataUrl.split(',')[1] };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'The assistant is unavailable right now.');

      const rawEdits: AiEdit[] = Array.isArray(data.edits) ? data.edits : [];
      // Backfill the owner on scanned documents so the preview shows "+ <name>'s
      // profile" and Apply files onto the person, even when the AI left it blank.
      const edits: AiEdit[] = rawEdits.map(e => {
        if (e.kind !== 'document') return e;
        const owner = inferDocOwner(e, rawEdits);
        return owner ? { ...e, member: owner.name } : e;
      });
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        text: data.reply || '…',
        edits: edits.length ? edits : undefined,
        sourceImage: att || undefined,
      };
      setMessages(prev => {
        const updatedMessages = [...prev, assistantMsg];
        if (uid) saveChatHistory(uid, slimForCloud(updatedMessages));
        return updatedMessages;
      });
    } catch (e: any) {
      const raw = e?.message || 'Something went wrong.';
      // "Load failed" is Safari/iOS's fetch abort error — surface a clearer message
      // and restore the attachment + text so the user can retry without re-uploading.
      const errMsg = raw === 'Load failed' || raw === 'Failed to fetch'
        ? 'Network error — the scan timed out. Tap Retry to try again.'
        : raw;
      setMessages(prev => prev.slice(0, -1)); // remove optimistic user message
      setInput(msg);                           // restore text
      if (att) setAttachment(att);             // restore attachment
      setError(errMsg);
    } finally {
      setLoading(false);
      setIsScanning(false);
    }
  };

  // Vault categories → member-document categories (two historic enums)
  const MEMBER_DOC_CAT: Record<VaultCategory, FamilyDocument['category']> = {
    Identity: 'ID', Medical: 'Health', Education: 'Education', Travel: 'Travel',
    Financial: 'Other', Other: 'Other',
  };

  const resolveMemberByName = (name?: string): FamilyMember | undefined => {
    const q = (name || '').trim().toLowerCase();
    if (!q) return undefined;
    return members.find(m => m.name.toLowerCase() === q || (m.nickname || '').toLowerCase() === q)
      || members.find(m => m.name.toLowerCase().split(/\s+/)[0] === q.split(/\s+/)[0]);
  };

  // Safety net: work out who a scanned document belongs to even when the AI
  // forgets to tag "member" — so a passport/ID reliably lands on the person's
  // OWN Documents tab, not just the shared vault. Tries, in order: the AI's own
  // tag → a member named in the document title → (for personal docs) the single
  // person referenced elsewhere in the same batch (e.g. a passport edit for Sophie
  // means this Identity scan is Sophie's).
  const inferDocOwner = (
    doc: Extract<AiEdit, { kind: 'document' }>,
    batch: AiEdit[],
  ): FamilyMember | undefined => {
    const explicit = resolveMemberByName(doc.member);
    if (explicit) return explicit;

    const nameL = (doc.name || '').toLowerCase();
    const byTitle = members.find(m => {
      const first = m.name.toLowerCase().split(/\s+/)[0];
      return (m.name && nameL.includes(m.name.toLowerCase()))
        || (m.nickname && nameL.includes(m.nickname.toLowerCase()))
        || (first.length >= 3 && nameL.includes(first));
    });
    if (byTitle) return byTitle;

    const PERSONAL: VaultCategory[] = ['Identity', 'Medical', 'Education', 'Travel'];
    if (PERSONAL.includes(doc.category)) {
      const names = new Set<string>();
      for (const e of batch) {
        if ((e.kind === 'passport' || e.kind === 'member') && e.member) names.add(e.member.toLowerCase());
        else if (e.kind === 'new_member' && e.name) names.add(e.name.toLowerCase());
      }
      if (names.size === 1) return resolveMemberByName([...names][0]);
    }
    return undefined;
  };

  // File the scanned image for any 'document' edits: always into the shared
  // Document Vault, AND into the named member's own Documents tab when the AI
  // says who the document belongs to (e.g. Sophie's passport).
  const fileScans = async (docEdits: AiEdit[], src: Attachment) => {
    const blob = dataUrlToBlob(src.dataUrl);
    const file = new File([blob], src.name, { type: src.mimeType });
    const existing = await loadDocuments();
    const today = new Date().toISOString().slice(0, 10);
    const by = auth.currentUser?.displayName || auth.currentUser?.email || 'Family';
    const added: VaultDocument[] = [];

    for (const e of docEdits) {
      if (e.kind !== 'document') continue;
      const id = newId();
      const { storagePath, downloadUrl } = await uploadVaultFile(file, id);
      added.push({
        id, name: e.name, category: e.category,
        fileName: src.name, fileType: src.mimeType, fileSize: blob.size,
        storagePath, downloadUrl, uploadedAt: today, uploadedBy: by,
      });

      // Also file on the member's profile when the doc names its owner. Store the
      // Storage download URL (not the base64 image) so the member's Firestore doc
      // stays tiny and can never blow the 1 MiB limit — it renders the same, since
      // MemberDocuments/DocumentViewer use fileData directly as an <img src>.
      const owner = resolveMemberByName(e.member);
      if (owner) {
        await onAddMemberDoc(owner.id, {
          id: 'doc-' + id,
          name: e.name,
          category: MEMBER_DOC_CAT[e.category] || 'Other',
          fileType: src.mimeType,
          fileName: src.name,
          fileSize: blob.size,
          uploadedAt: today,
          fileData: downloadUrl,
        });
      }
    }
    if (added.length) await saveDocuments([...added, ...existing]);
  };

  const applyEdits = async (idx: number, edits: AiEdit[]) => {
    setApplyingIdx(idx);
    try {
      const dataEdits = edits.filter(e => e.kind !== 'document');
      // Re-resolve the scan's owner at APPLY time too (not just parse time), so
      // re-applying an older card — whose stored edit predates the fix and has no
      // member — still files onto the person's Documents, not just the vault.
      const docEdits = edits
        .filter((e): e is Extract<AiEdit, { kind: 'document' }> => e.kind === 'document')
        .map(e => {
          if (resolveMemberByName(e.member)) return e;
          const owner = inferDocOwner(e, edits);
          return owner ? { ...e, member: owner.name } : e;
        });
      if (dataEdits.length) await onApplyEdits(dataEdits);
      const src = messages[idx]?.sourceImage;
      if (docEdits.length && src) {
        await fileScans(docEdits, src);
      } else if (docEdits.length && !src) {
        // Image is stripped from persisted history — after a reload we can't
        // file the scan. Don't fail silently: the data edits applied, but the
        // user must re-attach the photo to store the document itself.
        setError('Your other changes were saved, but the photo itself is no longer in this chat (it was cleared when the app reloaded). Please re-attach the photo and send it again to file the document.');
      }
      setMessages(prev => {
        const updated = prev.map((m, i) => i === idx ? { ...m, applied: true } : m);
        // Persist the applied flag to cloud so the card stays "Applied" after a
        // reload or on another device — otherwise the Apply button reappears.
        if (uid) saveChatHistory(uid, slimForCloud(updated));
        return updated;
      });
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
    <div className="overflow-hidden h-full flex flex-col font-sans bg-white">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-cream-200 bg-cream-50 flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-clay-500 text-white shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0 hidden sm:block">
          <h2 className="font-display text-xl font-semibold text-ink-900">Family assistant</h2>
          <p className="text-[13px] text-ink-500 font-medium truncate">Ask, tell me a fact, or attach a document to scan.</p>
        </div>
        <h2 className="font-display text-lg font-semibold text-ink-900 sm:hidden">Assistant</h2>
        <button
          onClick={startNewChat}
          disabled={loading || messages.length === 0}
          className="btn-quiet text-xs px-3.5 py-2 ml-auto shrink-0 border border-cream-300 disabled:opacity-40"
          title="Clear the conversation and start fresh"
        >
          <MessageSquarePlus className="w-4 h-4" />
          <span>New chat</span>
        </button>
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
                Tell me a fact like “Mia wears EU 30 shoes”, ask “when does Papa's passport expire?”, or 📎 attach a passport/certificate and I'll read it and file it.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {suggestions.map(s => (
                <button key={s} onClick={() => send(s)} className="chip bg-cream-100 text-ink-600 border border-cream-300 hover:bg-cream-200 transition-colors">
                  {s}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-sm pt-1">
              <button
                onClick={() => send("Give me a quick check-up across the whole family: anything expired or expiring soon (passports, residence permits, visas, driver's licenses), anyone missing a blood type or emergency contact, and anything important that looks incomplete.")}
                className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
              >
                🩺 Family check-up
              </button>
              <button
                onClick={() => send("Suggest birthday and Christmas gift ideas for each child, based on their likes, wishlist and current sizes.")}
                className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
              >
                🎁 Gift ideas
              </button>
              <button
                onClick={() => send("What's coming up on the family calendar in the next few weeks?")}
                className="chip bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 transition-colors px-3 py-1.5 text-[12px]"
              >
                📅 What's coming up
              </button>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-primary mt-1"
            >
              <Paperclip className="w-4 h-4" />
              Scan a document
            </button>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-soft ${m.role === 'user' ? 'bg-dusk-500 text-white' : 'bg-clay-500 text-white'}`}>
              {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] space-y-2 ${m.role === 'user' ? 'items-end' : ''}`}>
              {m.image && (
                <img src={m.image} alt="attachment" className="max-w-[180px] rounded-2xl border border-cream-300 shadow-soft" />
              )}
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
                      <Check className="w-3.5 h-3.5" /> {t.ai_applied}
                    </p>
                  ) : (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => applyEdits(i, m.edits!)}
                        disabled={applyingIdx === i}
                        className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                      >
                        {applyingIdx === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {t.btn_apply}
                      </button>
                      <button onClick={() => dismissEdits(i)} className="btn-quiet text-xs px-3 py-1.5">
                        <X className="w-3.5 h-3.5" /> {t.btn_cancel}
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
              <Loader2 className="w-4 h-4 animate-spin" /> {isScanning ? 'Reading the document…' : 'Thinking…'}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-cream-200 bg-white">
        {error && <p className="text-[12px] text-rosa-700 mb-2">{error}</p>}

        {attachment && (
          <div className="mb-2 flex items-center gap-2 p-2 rounded-xl bg-cream-100 border border-cream-300 w-fit max-w-full">
            {attachment.mimeType.startsWith('image/') ? (
              <img src={attachment.dataUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-cream-300" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-rosa-100 text-rosa-700 flex items-center justify-center"><FileText className="w-4 h-4" /></div>
            )}
            <span className="text-[12px] font-semibold text-ink-700 truncate max-w-[180px]">{attachment.name}</span>
            <button onClick={() => setAttachment(null)} className="p-1 text-ink-400 hover:text-rosa-500 rounded-lg"><X className="w-3.5 h-3.5" /></button>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 items-center">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onPickFile} className="hidden" />
          {SR && (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={loading}
              title={listening ? 'Stop recording' : 'Speak your message'}
              className={`px-3 py-2.5 shrink-0 rounded-2xl border font-semibold text-sm transition-colors disabled:opacity-40 ${
                listening
                  ? 'bg-rosa-500 text-white border-rosa-500 animate-pulse'
                  : 'bg-white hover:bg-cream-100 text-ink-700 border-cream-300'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            title="Attach a photo, PDF or file — or paste a screenshot with Ctrl+V / Cmd+V. For Google Drive files, open the file in Drive and use File → Download first."
            className="btn-quiet px-3 py-2.5 shrink-0 disabled:opacity-40"
          >
            <Paperclip className="w-4 h-4" />
            <span className="hidden sm:inline">Attach</span>
          </button>
          <input
            type="text"
            placeholder={attachment ? 'Add a note, or just send to scan…' : 'Ask or tell me something…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPasteImage}
            disabled={loading}
            className="field flex-1"
          />
          <button type="submit" disabled={(!input.trim() && !attachment) || loading} className="btn-primary px-3 py-2.5 shrink-0 disabled:opacity-40">
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[11px] text-ink-400 mt-2 text-center">
          {t.ai_hint.split('Ctrl+V').length > 1
            ? <>{t.ai_hint.split('Ctrl+V')[0]}<kbd className="px-1 py-0.5 bg-cream-200 rounded text-[10px] font-mono">Ctrl+V</kbd>{t.ai_hint.split('Ctrl+V')[1]}</>
            : t.ai_hint
          }
        </p>
      </div>
    </div>
  );
}

function describeEdit(e: AiEdit): string {
  if (e.kind === 'new_member') return `Add a new ${(e.role || 'family member').toLowerCase()}: ${e.name}${e.nickname ? ` “${e.nickname}”` : ''}`;
  if (e.kind === 'member') return `${e.member}: set ${e.field.replace(/_/g, ' ')} → “${e.value}”`;
  if (e.kind === 'passport') return `${e.member}: add ${e.country} passport ${e.number}${e.expiry ? ` (exp ${e.expiry})` : ''}`;
  if (e.kind === 'contact') return `Add contact ${e.name}${e.relation ? ` (${e.relation})` : ''}${e.phone ? ` · ${e.phone}` : ''}`;
  if (e.kind === 'number') return `Add number “${e.label}” → ${e.value}`;
  if (e.kind === 'document') return `Save the scan “${e.name}” to Documents (${e.category})${e.member ? ` + ${e.member}’s profile` : ''}`;
  if (e.kind === 'calendar_event') return `Add to calendar: “${e.title}” on ${e.date}${e.time ? ' at ' + e.time : ''}`;
  if (e.kind === 'list_add') return `Add to ${e.list}: ${Object.values(e.item).filter(Boolean).slice(0, 3).join(' · ')}`;
  if (e.kind === 'household_set') return `Set household ${e.field.replace(/([A-Z])/g, ' $1').toLowerCase()}: "${e.value}"`;
  if (e.kind === 'asset') return `Add asset: ${e.name}${e.category ? ` (${e.category})` : ''}`;
  if (e.kind === 'transit_pass') return `${e.member}: add travel pass “${e.name}”${e.validUntil ? ` (valid to ${e.validUntil})` : ''}`;
  if (e.kind === 'care_schedule') return `${e.member}: add ${e.careKind}${e.intervalMonths ? ` every ${e.intervalMonths} mo` : ''}${e.lastVisit ? ` (last ${e.lastVisit})` : ''}`;
  return JSON.stringify(e);
}
